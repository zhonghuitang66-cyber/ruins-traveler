import {perimeterMountainWalls} from './perimeter-layout.js';
import {addRaidBuildings,activityReward} from './raid-interactions.js';
import {RAID_SECONDS,resetRaid,tickRaid,repairPlayerPosition} from './raid-rules.js';
import {scenePlacements} from './scene-layout.js';
import {packItems} from './inventory.js';
import {rollLootContainer} from './loot-containers.js';
import {createNavigator} from './navigation.js';
import {CLASSES,TYPES,ZONES,ITEMS,ARCHER_AUTO_TARGET_RANGE,PLAYER_BASE_SPEED} from './data.js';
import {attackTiming} from './attack-timing.js';
import {equipmentSkillOutcome,equipmentBasicAttackBonus,getEquipmentEffects,ITEM_DEFINITIONS,sanitizeItemRow,isEquipment,canEquip,getEquipmentStats,itemValue,EQUIPMENT_SLOTS} from './equipment.js';
import {packGrid,canPlace,gridSize} from './grid-inventory.js';
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const TIME_EPS=1e-8;
// Scale first so large finite direction inputs cannot overflow normalization.
export function normalizeDirection(dir){if(!dir||!Number.isFinite(dir.x)||!Number.isFinite(dir.z))return null;const scale=Math.max(Math.abs(dir.x),Math.abs(dir.z));if(!scale)return null;const x=dir.x/scale,z=dir.z/scale,d=Math.hypot(x,z);return {x:x/d,z:z/d}}
const controlled=body=>body.stun>0||body.knockup>0;
const safeAim=dir=>normalizeDirection(dir)||{x:0,z:-1};
export function blocked(x,z,r,walls){return Math.abs(x)>89-r||Math.abs(z)>89-r||walls.some(w=>{const qx=clamp(x,w.x-w.w/2,w.x+w.w/2),qz=clamp(z,w.z-w.d/2,w.z+w.d/2);return Math.hypot(x-qx,z-qz)<r})}
export function move(body,dx,dz,walls){if(!Number.isFinite(dx)||!Number.isFinite(dz)||!Number.isFinite(Math.hypot(dx,dz)))return;const length=Math.hypot(dx,dz);if(length>360)return;const n=Math.max(1,Math.ceil(length/.18));for(let i=0;i<n;i++){if(!blocked(body.x+dx/n,body.z,body.radius,walls))body.x+=dx/n;if(!blocked(body.x,body.z+dz/n,body.radius,walls))body.z+=dz/n}}
export function lineClear(a,b,walls,r=.08){const n=Math.max(1,Math.ceil(dist(a,b)/.25));for(let i=1;i<=n;i++)if(blocked(a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n,r,walls))return false;return true}
export const zoneAt=p=>clamp(Math.floor((p.z+90)/60),0,2)*3+clamp(Math.floor((p.x+90)/60),0,2);
export function makeWorld(){
 const walls=[],trees=[],stones=[],floors=[],spawns=[],chests=[],ruins=[];
 const wall=(x,z,w,d,h=2.6)=>walls.push({x,z,w,d,h});
 for(let i=0;i<9;i++){
  const cx=(i%3-1)*60,cz=(Math.floor(i/3)-1)*60,core=i===4||i===5;
  const hx=core?11:9,hz=core?10:7;
  // A 4 m wide entrance on the south wall, 4 m wide opening on the north.
  wall(cx-hx,cz,1,hz*2);wall(cx+hx,cz,1,hz*2);
  wall(cx-hx/2-1,cz+hz,hx-2,1);wall(cx+hx/2+1,cz+hz,hx-2,1);
  wall(cx-hx/2-1,cz-hz,hx-2,1);wall(cx+hx/2+1,cz-hz,hx-2,1);
  if(core){wall(cx+3,cz,1,9,2.8);floors.push({x:cx,z:cz,w:22,d:20,core:true})}
  else floors.push({x:cx,z:cz,w:18,d:14,core:false});
  chests.push({id:`chest-${i}`,x:cx-5,z:cz-2,zone:i,type:'small',capacity:30,name:'遗迹小宝箱',opened:false,packId:null});
  for(let j=0;j<7;j++){const angle=j*2.399+i*.7;const x=cx+Math.cos(angle)*(19+j%3*3),z=cz+Math.sin(angle)*(19+j%2*4);if(Math.abs(x)<86&&Math.abs(z)<86)trees.push({x,z,scale:1+(j%3)*.25})}
  for(let j=0;j<7;j++)stones.push({x:cx+Math.sin(j*12.5+i)*23,z:cz+Math.cos(j*7.3+i)*23,scale:.3+(j%4)*.2});
  const types=['spear','sword','bow','mage','spear','hammer','sword','bow'];
  for(let j=0;j<ZONES[i][2];j++)spawns.push({x:cx-6+(j%3)*5,z:cz+15+Math.floor(j/3)*4,type:types[j],zone:i});
 }
 for(const [i,[cx,cz]]of [[-34,-28],[34,28],[30,-34]].entries()){
  const ruin={id:`enhanced-ruin-${i}`,x:cx,z:cz,w:18,d:16,type:'enhanced'};ruins.push(ruin);floors.push({...ruin,core:false});
  wall(cx-9,cz,1,16,3.2);wall(cx+9,cz,1,16,3.2);
  for(const dz of [-8,8]){wall(cx-5.5,cz+dz,7,1,3.2);wall(cx+5.5,cz+dz,7,1,3.2)}
  wall(cx+2,cz-4,1,5,2.5);wall(cx-5,cz+2,5,1,1.6);wall(cx+6,cz+3,4,1,1.6);
  chests.push({id:`chest-white-${i}`,x:cx-4,z:cz-4,zone:zoneAt({x:cx,z:cz}),type:'white',capacity:30,name:'白色加强宝箱',ruinId:ruin.id,opened:false,packId:null});
 }
 for(let i=spawns.length-1;i>=0;i--){const s=spawns[i];if(s.zone===6&&(s.type==='mage'||s.type==='bow'||i%2===0))spawns.splice(i,1)}
 const scenery=scenePlacements(floors);for(const p of scenery)if(p.solid)walls.push({x:p.x,z:p.z,w:p.width,d:p.depth,h:p.height,scenery:true});
 walls.push(...perimeterMountainWalls());return {walls,trees,stones,floors,spawns,chests,ruins,scenery,exits:[{x:-76,z:76},{x:76,z:-76}]};
}
export function rollLoot(type,zone,rng=Math.random){return rollLootContainer(type,{zone,rng}).items}

export function addItems(bag,items,{capacity=24}={}){const result=packGrid(bag,items,{capacity});bag.splice(0,bag.length,...result.bag);return result.remainder}
export class Game{
 constructor(emit=()=>{}){this.emit=emit;this.world=makeWorld();this.nav=createNavigator(this.world.walls);this.bossNav=createNavigator(this.world.walls,{radius:1.2});this.nextNav=0;this.time=0;this.running=false;this.enemies=[];this.shots=[];this.events=[];this.packs=[];this.bag=[];this.cool=[0,0,0];this.input={x:0,z:0};this.aim={x:0,z:-1};this.exitProgress=0;this.extractHeld=false;this.nextId=1;this.nextAttackId=1;this.pendingAttack=null}
 start(kind='swordsman',{bagCapacity=24,loadout,cargo={}}={}){this.networkPassive=false;this.networkSession=false;for(const e of this.enemies||[])if(e.type==='boss')this.cancelBossAction(e,'start');this.cancelAttack('start');this.kind=Object.hasOwn(CLASSES,kind)?kind:'swordsman';this.baseStats=CLASSES[this.kind];this.stats={...this.baseStats};this.bagCapacity=gridSize(bagCapacity===28?28:24).capacity;this.equipment={};this.moveSpeedBonus=0;this.speedPotionUntil=0;this.burstSpeedUntil=0;this.player={x:-76,z:66,radius:.48,hp:this.stats.hp,mp:this.stats.mp,stun:0,shield:0,angle:0,knockup:0,frostMarks:[],slow:[],burnMarks:[],nextBurnAt:0};this.time=0;this.nextNav=0;this.bag=[];this.packs=[];this.shots=[];this.events=[];this.cool=[0,0,0];this.autoCd=0;this.speedBuff=0;this.healing=0;this.invis=0;this.guard=0;this.thunder=0;this.thunderExpire=0;this.thunderMarks=[];this.thunderHistory=[];this.healingUntil=0;this.nextHealAt=0;this.windActive=false;this.frost=0;this.frostCharges=0;this.frostVersion=0;this.comboStage=0;this.comboExpiresAt=0;this.attackLock=0;this.cast=0;this.castVersion=0;this.jumpCd=0;this.dodge=null;this.potionCd=0;this.extractHeld=false;this.enemies=this.world.spawns.map(s=>this.enemy(s));this.enemies.push(this.enemy({x:0,z:0,type:'boss',zone:4}));this.world.chests.forEach(c=>{c.opened=false;c.packId=null});this.running=true;this.exitProgress=0;if(loadout&&typeof loadout==='object'){for(const slot of EQUIPMENT_SLOTS){const row=sanitizeItemRow(loadout[slot]);if(row&&canEquip(row,this.kind,slot)&&!Object.values(this.equipment).some(e=>e.uid===row.uid))this.equipment[slot]=row}this.refreshEquipment();this.player.hp=this.stats.hp;this.player.mp=this.stats.mp}this.bag=packGrid([],Object.entries(cargo).map(([id,n])=>({id,n})),{capacity:this.bagCapacity}).bag;resetRaid(this);addRaidBuildings(this);this.lastLegalPosition={x:this.player.x,z:this.player.z};if(this.kind=='paladin')this.cool[2]=70;this.emit('start',{})}
 enemy(s){const t=TYPES[s.type];return {...s,id:this.nextId++,hp:t.hp,maxHp:t.hp,radius:s.type==='boss'?1.2:.48,stun:0,knockup:0,slow:[],frostMarks:[],cd:1,charge:0,chargeDuration:0,chargeStartedAt:0,chargeEndsAt:0,chargePhase:null,bossActionId:null,shield:s.type==='boss'?t.shield:0,maxShield:s.type==='boss'?t.shield:0,home:{x:s.x,z:s.z},out:0,aggro:false,skill:0,combatVersion:0}}
 botLoot(e){let rows=[...(e.inventory||[]),...Object.values(e.equipment||{})],first=null,index=0;while(rows.length){const result=packGrid([],rows,{capacity:30,sort:true});if(!result.bag.length)break;const container={type:'bot',name:'遗迹猎手遗物',capacity:30,items:result.bag};if(!first)first=container;else this.packs.push({x:e.x,z:e.z,id:`bot-${e.id}-extra-${index++}`,...container});rows=result.remainder}return first||{type:'bot',name:'遗迹猎手遗物',capacity:30,items:[]}}
 later(delay,fn){this.events.push({at:this.time+delay,fn})}
 effect(x,z,r,color=0xffe6a0,life=.35){this.emit('effect',{x,z,r,color,life,owner:'enemy'})}
 playerEffect(x,z,r,color=0xffe6a0,life=.35){this.emit('effect',{x,z,r,color,life,owner:'player'})}
 interruptPlayer(reason='controlled'){this.cancelAttack(reason);if(this.cast>0||this.healing>0||this.windActive)this.emit('cancel-cast',{});this.castVersion++;this.healing=0;this.healingUntil=0;this.nextHealAt=0;this.cast=0;if(this.windActive){this.windActive=false;this.attackLock=0}}
 applyControl(target,{stun=0,knockup=0}={}){
  if(target?.networkTarget)return target.networkTarget.applyControl(target.networkTarget.player,{stun,knockup});
  stun=Number.isFinite(stun)?Math.max(0,stun):0;knockup=Number.isFinite(knockup)?Math.max(0,knockup):0;
  const hold=Math.max(stun,knockup);if(!hold||target.hp<=0)return;
  target.stun=Math.max(target.stun||0,hold);target.knockup=Math.max(target.knockup||0,knockup);
  if(target===this.player){this.interruptPlayer();this.dodge=null;}else{target.charge=0;target.cd=Math.max(target.cd||0,TYPES[target.type].interval);target.combatVersion++;if(target.bot){target.botWindup=null;target.botCd=Math.max(target.botCd||0,1.8)}if(target.type==='boss')this.cancelBossAction(target,'control');if(target.type==='mage'){target.mageStage=0;target.arcTarget=null;target.target=null}}
 }
 tickFrost(target){
  const marks=target.frostMarks||[];
  for(const mark of marks){
   while(mark.nextDrainAt<=Math.min(this.time,mark.expiresAt)+TIME_EPS){if(typeof target.mp==='number'&&Number.isFinite(target.mp))target.mp=Math.max(0,target.mp-1);mark.nextDrainAt+=1}
  }
  target.frostMarks=marks.filter(mark=>mark.expiresAt>this.time+TIME_EPS);target.slow=target.frostMarks.map(mark=>mark.expiresAt);
 }
 applyFrost(target){
  if(target?.networkTarget)return target.networkTarget.applyFrost(target.networkTarget.player);
  if(target.hp<=0)return false;this.tickFrost(target);if(target.frostMarks.length>=10)return false;
  target.frostMarks.push({expiresAt:this.time+5,nextDrainAt:this.time+1});target.slow=target.frostMarks.map(mark=>mark.expiresAt);return true;
 }
 applyBurn(stacks=2){
  const p=this.player;if(!this.running||p.hp<=0||!Number.isInteger(stacks)||stacks<1)return false;
  p.burnMarks.push({stacks,expiresAt:this.time+5});
  if(!p.nextBurnAt||p.nextBurnAt<=this.time)p.nextBurnAt=this.time+.5;
  this.emit('burn',{x:p.x,z:p.z,stacks:p.burnMarks.reduce((n,m)=>n+m.stacks,0)});return true;
 }
 tickBurn(){
  const p=this.player;
  while(p.nextBurnAt>0&&p.nextBurnAt<=this.time+TIME_EPS){
   const stacks=p.burnMarks.filter(m=>m.expiresAt+TIME_EPS>=p.nextBurnAt).reduce((n,m)=>n+m.stacks,0);
   if(stacks){const damage=p.hp*.01*stacks,absorbed=Math.min(p.shield||0,damage);p.shield=Math.max(0,(p.shield||0)-absorbed);const hpDamage=Math.min(p.hp,damage-absorbed);p.hp=Math.max(0,p.hp-hpDamage);this.emit('number',{x:p.x,z:p.z,text:(absorbed+hpDamage).toFixed(1),type:'hurt',shieldDamage:absorbed,hpDamage});if(p.hp<=0){this.finish(false);return}}
   p.nextBurnAt+=.5;
  }
  p.burnMarks=p.burnMarks.filter(m=>m.expiresAt>this.time+TIME_EPS);if(!p.burnMarks.length)p.nextBurnAt=0;
 }
 attackInterval(){return this.stats.interval/((this.speedBuff>0?1.4:1)*(this.kind==='archer'&&this.invis>0?1.3:1))}
 arcFireball(owner,target,amount){
  if(this.shots.length>=40)return false;const duration=1.1,start={x:owner.x,z:owner.z};
  const a=normalizeDirection({x:target.x-start.x,z:target.z-start.z})||{x:0,z:1};
  this.shots.push({x:start.x,z:start.z,y:1,dx:a.x,dz:a.z,life:duration,speed:0,amount,enemy:true,radius:.55,fire:true,magic:true,arc:true,elapsed:0,duration,start,target:{...target}});return true;
 }
 frostMovementScale(target){return Math.max(.5,1-Math.min(10,(target.slow||[]).length)*.05)}
 hurt(e,amount,magic=false,stun=0,remote=false,knockup=0){if(e?.networkTarget){const owner=e.networkTarget,previous=owner.damageSource;owner.damageSource=this.damageSource||this.player;try{return owner.hurt(owner.player,amount,magic,stun,remote,knockup)}finally{owner.damageSource=previous}}if(e.hp<=0)return;const player=e===this.player;const defense=player?(magic?this.stats.mdef:this.stats.def):(magic?TYPES[e.type].mdef:TYPES[e.type].def);const attempted=player&&remote&&this.guard>0?1:Math.max(1,Math.round(amount*100/(100+defense))),shieldDamage=Math.min(attempted,Math.max(0,e.shield||0)),hpDamage=Math.min(e.hp,attempted-shieldDamage),damage=shieldDamage+hpDamage;e.shield=Math.max(0,(e.shield||0)-shieldDamage);e.hp=Math.max(0,e.hp-hpDamage);this.applyControl(e,{stun,knockup});this.emit('number',{x:e.x,z:e.z,text:String(damage),type:player?'hurt':'damage',shieldDamage,hpDamage});const hitSource=this.damageSource||(player?this.enemies.filter(t=>t.hp>0).sort((a,b)=>dist(a,e)-dist(b,e))[0]:this.player);this.emit('hit',{id:e.id,x:e.x,z:e.z,dx:e.x-(hitSource?.x??e.x),dz:e.z-(hitSource?.z??e.z),player,magic,damage,shieldDamage,hpDamage});if(player)this.emit('shake',{});if(!player&&e.hp===0){if(e.type==='boss')this.cancelBossAction(e,'death');const loot=e.bot?this.botLoot(e):rollLootContainer(e.type,{zone:e.zone});this.packs.push({x:e.x,z:e.z,id:e.id,...loot});this.emit('death',{id:e.id,type:e.type,bot:!!e.bot,playerKill:!this.damageSource})}if(player&&e.hp===0)this.finish(false)}
 area(x,z,r,amount,magic=false,stun=0,knock=0,knockup=0){const source={x,z};for(const e of this.enemies){if(e.hp>0&&dist(source,e)<r+e.radius&&lineClear(source,e,this.world.walls)){this.hurt(e,amount,magic,stun,false,knockup);if(knock){const d=dist(source,e)||1;move(e,(e.x-x)/d*knock,(e.z-z)/d*knock,this.world.walls)}}}}
 autoTarget(){if(!this.player)return null;const range=this.kind==='archer'?ARCHER_AUTO_TARGET_RANGE:18;return this.enemies.filter(e=>e.hp>0&&dist(e,this.player)<=range&&lineClear(this.player,e,this.world.walls)).sort((a,b)=>dist(a,this.player)-dist(b,this.player))[0]||null}
 facing(){const fallback=safeAim(this.aim),e=this.autoTarget();return e?normalizeDirection({x:e.x-this.player.x,z:e.z-this.player.z})||fallback:fallback}
 cone(range,angle,amount,stun=0,a=this.aim){for(const e of this.enemies){const d=dist(e,this.player);if(e.hp>0&&d<range+e.radius&&((e.x-this.player.x)*a.x+(e.z-this.player.z)*a.z)/Math.max(d,.001)>Math.cos(angle/2)&&lineClear(this.player,e,this.world.walls))this.hurt(e,amount,false,stun)}}
 projectile(owner,dir,amount,opts={}){
  const a=normalizeDirection(dir),speed=opts.speed??22,range=opts.range??20;
  if(this.shots.length>=40||!a||!owner||!Number.isFinite(owner.x)||!Number.isFinite(owner.z)||!Number.isFinite(amount)||amount<0||!Number.isFinite(speed)||speed<=0||speed>360||!Number.isFinite(range)||range<=0||!Number.isFinite(range/speed))return false;
  // Accept combat modifiers, but keep position, normalized direction and lifetime authoritative.
  const {fire=false,magic=false,frost=false,stun=0,knock=0,bonusMagic=0,bladeWind=false}=opts;
  if(!Number.isFinite(stun)||stun<0||!Number.isFinite(knock)||knock<0)return false;
  this.shots.push({x:owner.x,z:owner.z,dx:a.x,dz:a.z,life:range/speed,speed,amount,enemy:owner!==this.player,radius:fire?.55:.12,fire,magic,frost,stun,knock,bonusMagic,bladeWind});return true;
 }
 attack(manual=false){
  if(!this.running||!this.player||this.player.hp<=0||!Number.isFinite(this.player.x)||!Number.isFinite(this.player.z)||controlled(this.player)||this.cast>0||this.autoCd>TIME_EPS||this.attackLock>TIME_EPS||this.pendingAttack)return false;
  const timing=attackTiming(this.kind,this.attackInterval());if(!timing)return false;
  const target=manual?null:this.autoTarget();
  const aim=manual?safeAim(this.aim):target?normalizeDirection({x:target.x-this.player.x,z:target.z-this.player.z})||safeAim(this.aim):safeAim(this.aim);this.aim={...aim};this.autoCd=timing.duration;
  const comboStage=this.time<=this.comboExpiresAt?this.comboStage:0;this.comboStage=(comboStage+1)%4;this.comboExpiresAt=this.time+1.3;
  const attack={...timing,comboStage,role:this.kind,aim:{...aim},player:this.player,attackId:this.nextAttackId++,impactAt:this.time+timing.impactDelay,amount:this.stats.atk,range:this.stats.range*(this.kind==='archer'?1:comboStage===3?1.2:1.05)};this.pendingAttack=attack;
  this.emit('swing',this.attackPayload(attack));return true;
 }
 attackPayload(attack){return {role:attack.role,comboStage:attack.comboStage,x:this.player.x,z:this.player.z,dx:attack.aim.x,dz:attack.aim.z,duration:attack.duration,impactDelay:attack.impactDelay,attackId:attack.attackId}}
 cancelAttack(reason='cancelled'){
  const attack=this.pendingAttack;if(!attack)return false;this.pendingAttack=null;
  this.emit('attack-cancel',{...this.attackPayload(attack),reason});return true;
 }
 releaseAttack(){
  const attack=this.pendingAttack;if(!attack||this.time+TIME_EPS<attack.impactAt)return false;
  if(!this.running||this.player!==attack.player||this.player.hp<=0||!Number.isFinite(this.player.x)||!Number.isFinite(this.player.z)||controlled(this.player)||this.cast>0||this.windActive){this.cancelAttack(this.player?.hp<=0?'death':'invalidated');return false}
  this.pendingAttack=null;const p=this.player,a=attack.aim;const gearAttack=equipmentBasicAttackBonus(this.equipment,this.kind,this.stats.matk);
  const impact=()=>{this.emit('attack-impact',this.attackPayload(attack));return this.running&&this.player===attack.player&&p.hp>0};
  if(attack.role==='archer'){
   if(!impact())return false;
   if(this.projectile(p,a,attack.amount,{range:attack.range,bonusMagic:gearAttack.magicDamage})&&this.frost>0&&this.frostCharges>0){const version=this.frostVersion;this.frostCharges--;for(const delay of [.3,.6])this.later(delay,()=>{if(!this.running||p!==this.player||p.hp<=0||controlled(p)||this.frost<=0||version!==this.frostVersion)return;if(this.projectile(p,a,attack.amount,{frost:true,range:attack.range}))this.emit('frost-volley',{x:p.x,z:p.z,dx:a.x,dz:a.z,delay})})}
  }else{
   if(attack.role==='paladin'&&this.thunder>0&&this.thunderExpire>0){
    const start={x:p.x,z:p.z};move(p,a.x*.8,a.z*.8,this.world.walls);this.emit('displacement',{...start,endX:p.x,endZ:p.z,kind:'thunder'});
    if(!impact())return false;
    this.cone(4,Math.PI,attack.amount,0,a);const mark={x:p.x+a.x*2,z:p.z+a.z*2,at:this.time,index:4-this.thunder};if(!lineClear(p,mark,this.world.walls))Object.assign(mark,{x:p.x,z:p.z});
    this.thunderMarks.push(mark);this.thunder--;this.emit('thunder-mark',{...mark,remaining:this.thunder,expiresIn:this.thunderExpire});this.playerEffect(mark.x,mark.z,1,0x98d4e5);
    if(!this.thunder){this.area(mark.x,mark.z,3.5,attack.amount*1.8,true);this.playerEffect(mark.x,mark.z,3.5,0x98d4e5);this.thunderHistory=this.thunderMarks.map(m=>({...m}));this.thunderMarks=[];this.thunderExpire=0}
   }else{if(!impact())return false;this.cone(attack.range,1.92,attack.amount,0,a)}
   if(gearAttack.bladeWind){this.projectile(p,a,Math.max(1,attack.amount*.35),{range:6,speed:12,bladeWind:true});this.emit('blade-wind',{x:p.x,z:p.z,dx:a.x,dz:a.z})}this.playerEffect(p.x+a.x,p.z+a.z,1.4);
  }return true;
 }
 skill(index,dir){if(!this.running||!this.player||this.player.hp<=0||controlled(this.player)||this.cast>0||this.windActive||!Number.isInteger(index)||index<0||index>2||this.cool[index]>0||this.player.mp<this.stats.cost[index])return false;const a=dir==null?this.facing():normalizeDirection(dir);if(!a)return false;this.cancelAttack('skill');this.attackLock=Math.max(this.attackLock,.03);this.aim={...a};this.player.mp-=this.stats.cost[index];this.cool[index]=this.stats.cd[index];const gearSkill=equipmentSkillOutcome(this.equipment,this.kind,{hp:this.player.hp,maxHp:this.stats.hp});this.player.hp=gearSkill.hp;if(gearSkill.speedDuration)this.burstSpeedUntil=this.time+gearSkill.speedDuration;const p=this.player,atk=this.stats.atk,start={x:this.player.x,z:this.player.z};
  if(this.kind==='swordsman'){
   if(index===0){const castVersion=++this.castVersion;this.cast=1;this.later(.792,()=>{if(this.running&&p.hp>0&&p.stun<=0&&(p.knockup||0)<=0&&castVersion===this.castVersion&&this.cast>0)this.emit('charge-release-start',{role:this.kind,index:0,duration:.4,x:p.x,z:p.z,dx:a.x,dz:a.z})});this.emit('warning',{x:p.x+a.x*4.5,z:p.z+a.z*4.5,r:1,w:2,length:9,angle:Math.atan2(a.x,a.z),life:1,color:0xf1bf66,owner:'player'});this.later(1,()=>{if(p.stun>0||castVersion!==this.castVersion)return;this.attackLock=Math.max(this.attackLock,.03);this.emit('skill-impact',{role:this.kind,index:0,x:p.x,z:p.z,dx:a.x,dz:a.z,length:9,width:2});for(const e of this.enemies){const dx=e.x-p.x,dz=e.z-p.z,forward=dx*a.x+dz*a.z,side=Math.abs(dx*a.z-dz*a.x);if(e.hp>0&&forward>0&&forward<9&&side<1+e.radius&&lineClear(p,e,this.world.walls))this.hurt(e,atk*2.2,false,1.2)}this.playerEffect(p.x+a.x*4,p.z+a.z*4,3)})}
   if(index===1){const start={x:p.x,z:p.z};move(p,a.x*5,a.z*5,this.world.walls);const end={x:p.x,z:p.z};this.emit('displacement',{...start,endX:end.x,endZ:end.z,kind:'dash'});for(const e of this.enemies){const length=dist(start,end);const t=length?clamp(((e.x-start.x)*(end.x-start.x)+(e.z-start.z)*(end.z-start.z))/(length*length),0,1):0;if(e.hp>0&&Math.hypot(e.x-start.x-(end.x-start.x)*t,e.z-start.z-(end.z-start.z)*t)<1&&lineClear(start,e,this.world.walls))this.hurt(e,atk*.7)}this.speedBuff=4;this.playerEffect(p.x,p.z,1.5)}
   if(index===2){const origin={x:p.x,z:p.z};move(p,a.x*4,a.z*4,this.world.walls);this.emit('displacement',{...origin,endX:p.x,endZ:p.z,kind:'slam'});this.emit('jump',{});this.area(p.x,p.z,3,atk*1.5,false,0,0,1);this.playerEffect(p.x,p.z,3);const x=p.x,z=p.z;this.later(.25,()=>{this.emit('skill-impact',{role:this.kind,index:2,x,z,dx:a.x,dz:a.z});this.area(x,z,3,atk*.6);this.playerEffect(x,z,3)})}
  }
  if(this.kind==='paladin'){if(index===0)this.guard=5;if(index===1){this.thunder=3;this.thunderExpire=8;this.thunderMarks=[];this.thunderHistory=[]}if(index===2){this.healing=12;this.healingUntil=this.time+12;this.nextHealAt=this.time+.5}this.playerEffect(p.x,p.z,2,0xffeb9c)}
  if(this.kind==='archer'){
   const volley=(spread,mult,options={})=>{for(let i=-1;i<=1;i++){const ang=Math.atan2(a.x,a.z)+i*spread/2;this.projectile(p,{x:Math.sin(ang),z:Math.cos(ang)},atk*mult,options)}};
   if(index===0){this.invis=0;volley(5*Math.PI/180,.75,{stun:.8})}
   if(index===1){this.invis=0;this.frost=5;this.frostCharges=2;this.frostVersion++}
   if(index===2){const version=++this.castVersion;this.windActive=true;this.attackLock=.65;const active=()=>this.running&&p.hp>0&&p.stun<=0&&(p.knockup||0)<=0&&this.windActive&&version===this.castVersion;const wave=round=>{if(!active())return;volley(15*Math.PI/180,.45,{knock:.35});this.emit('wind-volley',{round,at:this.time,arrows:3,x:p.x,z:p.z,dx:a.x,dz:a.z});if(round===3){this.windActive=false;this.invis=3}};wave(1);this.later(.3,()=>wave(2));this.later(.6,()=>wave(3))}
  }this.emit('skill',{role:this.kind,index,x:start.x,z:start.z,endX:p.x,endZ:p.z,dx:a.x,dz:a.z});return true;
 }
 jump(){if(!this.running||!this.player||this.player.hp<=0||this.jumpCd>0||controlled(this.player)||this.cast>0)return false;this.cancelAttack('dodge');this.aim=safeAim(this.aim);this.dodge={remaining:.18,duration:.18,dx:this.aim.x,dz:this.aim.z,speed:(getEquipmentEffects(this.equipment,this.kind).blinkBoots?4:2)/.18};this.jumpCd=2;this.emit('dodge',{x:this.player.x,z:this.player.z,dx:this.aim.x,dz:this.aim.z,duration:.18});return true}
 lootAccess(source){if(this.player&&this.player.hp<=0)return 'dead';if(!this.running||!this.player)return 'not_running';if(!source)return 'not_found';if(dist(source,this.player)>2.4)return 'out_of_range';if(!lineClear(source,this.player,this.world.walls))return 'blocked';return null}
 nearbyLoot(){
  if(this.lootAccess(this.player))return Object.freeze([]);
  const rows=[];
  for(const pack of this.packs){if(this.lootAccess(pack)||!pack.items.length)continue;rows.push(Object.freeze({kind:'pack',name:pack.name||'战利品包裹',type:pack.type||'drop',capacity:pack.capacity||30,id:pack.id,x:pack.x,z:pack.z,distance:dist(pack,this.player),items:Object.freeze(pack.items.map(item=>Object.freeze(structuredClone(item))))}))}
  for(const chest of this.world.chests){if(this.lootAccess(chest)||chest.opened)continue;rows.push(Object.freeze({kind:'chest',name:chest.name||'遗迹小宝箱',type:chest.type||'small',capacity:chest.capacity||30,id:chest.id,x:chest.x,z:chest.z,zone:chest.zone,distance:dist(chest,this.player),opened:false,items:Object.freeze([])}))}
  return Object.freeze(rows.sort((a,b)=>a.distance-b.distance));
 }
 openChest(idOrZone){
  const chest=this.world.chests.find(c=>c.id===idOrZone)||(Number.isInteger(idOrZone)?this.world.chests.find(c=>c.zone===idOrZone):undefined);
  const reason=this.lootAccess(chest);if(reason)return {ok:false,reason};
  if(chest.opened)return {ok:false,reason:'already_opened',packId:chest.packId};
  const packId=`chest-loot-${chest.id}`;
  // Opening rolls once and leaves the items on the ground for explicit selection.
  if(chest.type==='apothecary')return {ok:false,reason:'choose_purchase'};if(chest.type==='synthesis'&&(!chest.craft||this.time+TIME_EPS<chest.craft.readyAt))return {ok:false,reason:'not_ready'};const special=chest.type==='synthesis'?chest.craft.output:activityReward(chest);const container=chest.activity?{type:chest.type,name:chest.name,capacity:30,items:special?packGrid([],[special],{capacity:30}).bag:[]}:rollLootContainer(chest.type||'small',{zone:chest.zone}),items=container.items;chest.opened=true;chest.packId=packId;
  this.packs.push({x:chest.x,z:chest.z,id:packId,...container});
  return {ok:true,packId,items:items.map(item=>structuredClone(item))};
 }
 takeLoot(packId,itemIndex,quantity){
  const pack=this.packs.find(p=>p.id===packId),reason=this.lootAccess(pack);if(reason)return {ok:false,reason,taken:0};
  if(!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=pack.items.length)return {ok:false,reason:'invalid_item',taken:0};
  const item=pack.items[itemIndex];if(!sanitizeItemRow(item))return {ok:false,reason:'invalid_item',taken:0};
  const requested=quantity===undefined?item.n:quantity;if(!Number.isSafeInteger(requested)||requested<=0)return {ok:false,reason:'invalid_quantity',taken:0};
  if(item.uid&&(this.bag.some(r=>r.uid===item.uid)||Object.values(this.equipment).some(r=>r.uid===item.uid)))return {ok:false,reason:'duplicate_uid',taken:0};
  const offered=Math.min(requested,item.n),result=packItems(this.bag,[{...structuredClone(item),n:offered}],{capacity:this.bagCapacity});
  const taken=offered-result.remainder.reduce((sum,row)=>sum+row.n,0);
  if(!taken)return {ok:false,reason:'bag_full',taken:0,remaining:item.n};
  this.bag=result.bag;item.n-=taken;const remaining=item.n;
  if(!item.n)pack.items.splice(itemIndex,1);if(!pack.items.length)this.packs=this.packs.filter(p=>p!==pack);
  return {ok:true,packId,itemId:item.id,taken,remaining,partial:taken<offered};
 }
 pickup(){
  if(this.lootAccess(this.player))return;let found=false;
  // Snapshot sources and visit slots backwards so removals cannot shift an unvisited slot.
  for(const pack of [...this.packs])for(let i=pack.items.length-1;i>=0;i--)if(this.takeLoot(pack.id,i).ok)found=true;
  for(const chest of this.world.chests)if(!chest.opened&&this.openChest(chest.id).ok)found=true;
  if(found)this.emit('toast',{text:'战利品已收取 · 再次交互可拾取宝箱内容'});else this.emit('toast',{text:packGrid(this.bag,[],{capacity:this.bagCapacity}).used>=this.bagCapacity?'背包已满':'靠近包裹或宝箱后拾取'});
 }
 use(id){
  if(!this.running||!this.player||this.player.hp<=0)return {ok:false,reason:'not_running'};
  if(id!=='health'&&id!=='mana'&&id!=='speed_potion')return {ok:false,reason:'invalid_item'};
  if(this.potionCd>0)return {ok:false,reason:'cooldown'};
  const slot=this.bag.find(s=>s.id===id&&Number.isSafeInteger(s.n)&&s.n>0);if(!slot)return {ok:false,reason:'not_found'};
  if(id==='speed_potion'){slot.n--;this.bag=this.bag.filter(s=>s.n>0);this.potionCd=5;this.speedPotionUntil=this.time+15;return {ok:true,amount:.1}}const stat=id==='health'?'hp':'mp',amount=Math.min(id==='health'?120:45,this.stats[stat]-this.player[stat]);
  if(!Number.isFinite(amount)||amount<=0)return {ok:false,reason:'full'};
  slot.n--;this.bag=this.bag.filter(s=>s.n>0);this.potionCd=5;this.player[stat]+=amount;
  if(id==='health')this.emit('number',{x:this.player.x,z:this.player.z,text:'+'+Math.round(amount),type:'heal'});
  return {ok:true,amount};
 }
 inventoryAccess(){return !this.running||!this.player?'not_running':this.player.hp<=0?'dead':null}
 refreshEquipment(){const bonus=getEquipmentStats(this.equipment,this.kind),base=this.baseStats||CLASSES[this.kind];this.stats={...base};for(const k of ['atk','def','mdef','hp','mp'])this.stats[k]=base[k]+bonus[k];this.stats.interval=base.interval/(1+bonus.attackSpeed);this.stats.matk=(base.matk||0)+bonus.matk;this.stats.hp=Math.round(this.stats.hp*(1+bonus.hpPercent));this.moveSpeedBonus=bonus.moveSpeed+bonus.moveRating/100;if(this.player){this.player.hp=Math.min(this.player.hp,this.stats.hp);this.player.mp=Math.min(this.player.mp,this.stats.mp)}return bonus}
 sortBag(){const reason=this.inventoryAccess();if(reason)return {ok:false,reason};const result=packGrid(this.bag,[],{capacity:this.bagCapacity,sort:true});if(result.remainder.length)return {ok:false,reason:'invalid_bag'};this.bag=result.bag;return {ok:true}}
 moveBagItem(index,x,y,{rotated=false}={}){const reason=this.inventoryAccess();if(reason)return {ok:false,reason};if(!Number.isInteger(index)||!this.bag[index])return {ok:false,reason:'invalid_item'};const row=this.bag[index],others=this.bag.filter((_,i)=>i!==index);if(!canPlace(others,row,x,y,{capacity:this.bagCapacity,rotated}))return {ok:false,reason:'no_space'};this.bag=this.bag.map((r,i)=>i===index?{...r,x,y,rotated}:r);return {ok:true}}
 equipItem(index){const reason=this.inventoryAccess();if(reason)return {ok:false,reason};if(!Number.isInteger(index))return {ok:false,reason:'invalid_item'};const row=sanitizeItemRow(this.bag[index]);if(!row||!isEquipment(row))return {ok:false,reason:'not_equipment'};if(!canEquip(row,this.kind))return {ok:false,reason:'wrong_class'};const slot=ITEM_DEFINITIONS[row.id].slot,old=this.equipment[slot],remaining=this.bag.filter((_,i)=>i!==index),result=packGrid(remaining,old?[old]:[],{capacity:this.bagCapacity});if(result.remainder.length)return {ok:false,reason:'bag_full'};const equipped={...row};delete equipped.x;delete equipped.y;delete equipped.rotated;this.bag=result.bag;this.equipment={...this.equipment,[slot]:equipped};this.refreshEquipment();return {ok:true,slot,item:structuredClone(equipped)}}
 unequipItem(slot){const reason=this.inventoryAccess();if(reason)return {ok:false,reason};if(!EQUIPMENT_SLOTS.includes(slot)||!this.equipment[slot])return {ok:false,reason:'empty_slot'};const row=this.equipment[slot],result=packGrid(this.bag,[row],{capacity:this.bagCapacity});if(result.remainder.length)return {ok:false,reason:'bag_full'};this.bag=result.bag;delete this.equipment[slot];this.refreshEquipment();return {ok:true,slot}}
 dropItem(index){const reason=this.inventoryAccess();if(reason)return {ok:false,reason};if(!Number.isInteger(index)||!this.bag[index])return {ok:false,reason:'invalid_item'};const row=structuredClone(this.bag[index]);delete row.x;delete row.y;delete row.rotated;this.bag=this.bag.filter((_,i)=>i!==index);const packId=`drop-${this.nextId++}`;this.packs.push({id:packId,x:this.player.x,z:this.player.z,type:'drop',name:'放下的物品',capacity:30,items:packGrid([],[row],{capacity:30}).bag});return {ok:true,packId}}
 finish(success,reason=null){if(!this.running)return;if(!this.networkSession)for(const e of this.enemies)if(e.type==='boss')this.cancelBossAction(e,'finish');this.interruptPlayer(this.player?.hp<=0?'death':'finish');this.invis=0;this.running=false;const loot=success?[...this.bag,...Object.values(this.equipment).filter(row=>!row.starter)].map(row=>structuredClone(row)):[];const value=loot.reduce((s,row)=>s+itemValue(row),0);if(!success){this.bag=[];this.equipment={};this.refreshEquipment()}this.emit('finish',{success,reason,bag:loot,value})}
 cancelMageCharge(e){e.charge=0;e.mageStage=0;e.arcTarget=null;e.target=null;e.cd=Math.max(e.cd||0,TYPES.mage.interval)}
 cancelBossAction(e,reason='cancelled'){
  const actionId=e.bossActionId;if(actionId)this.emit('warning-cancel',{owner:'enemy',bossId:e.id,actionId,reason});
  e.combatVersion=(e.combatVersion||0)+1;e.bossActionId=null;e.charge=0;e.chargeDuration=0;e.chargeStartedAt=0;e.chargeEndsAt=0;e.chargePhase=null;
 }
 bossAction(e,target=this.player){
  this.cancelBossAction(e,'replaced');const p=target,sessionPlayer=this.player,version=e.combatVersion,n=e.skill++%3,actionId=`boss-${e.id}-${version}-${e.skill}`;e.bossAction=n;e.bossActionId=actionId;
  const active=()=>this.running&&this.player===sessionPlayer&&p.hp>0&&e.hp>0&&e.aggro&&e.combatVersion===version&&!controlled(e);
  const done=()=>{if(e.bossActionId===actionId){e.cd=Math.max(e.cd||0,TYPES.boss.interval);e.recoveryUntil=this.time+.45;e.bossActionId=null;e.charge=0;e.chargeDuration=0;e.chargePhase=null}};
  const phase=(delay,duration,name,spots,fire,last=false)=>{duration=3;
   const begin=()=>{if(!active())return;e.charge=duration;e.chargeDuration=duration;e.chargeStartedAt=this.time;e.chargeEndsAt=this.time+duration;e.chargePhase=name;
    spots.forEach((spot,i)=>this.emit('warning',{...spot,life:duration,owner:'enemy',bossId:e.id,action:n,actionId,phase:name,warningId:`${actionId}-${name}-${i}`,startsAt:this.time,impactAt:this.time+duration,color:0xe0a44d}));
    this.later(duration,()=>{if(!active())return;spots.forEach((_s,i)=>this.emit('warning-cancel',{owner:'enemy',bossId:e.id,actionId,phase:name,warningId:`${actionId}-${name}-${i}`,reason:'impact'}));if(e.chargePhase===name){e.charge=0;e.chargeDuration=0;e.chargePhase=null}this.emit('enemy-attack',{id:e.id,type:e.type,x:e.x,z:e.z,attackId:`${actionId}-${name}`,dx:p.x-e.x,dz:p.z-e.z,duration:.45});fire();if(last)done()});
   };if(delay>0)this.later(delay,begin);else begin();
  };
  if(n===0){const origin={x:p.x,z:p.z};for(let j=0;j<3;j++){const spots=Array.from({length:3},(_,i)=>({x:origin.x+(i-1)*4+j*1.5,z:origin.z+(i%2)*3,r:2.9}));phase(j*3,3,`eruption-${j}`,spots,()=>{for(const spot of spots){if(!active())return;this.effect(spot.x,spot.z,2.4,0xd2ac65);if(dist(p,spot)<spot.r&&lineClear(spot,p,this.world.walls))this.hurt(p,j===0?45:30,true,j===0?.6:.4)}},j===2)}}
  if(n===1){const d=dist(p,e)||1,a={x:(p.x-e.x)/d,z:(p.z-e.z)/d},origin={x:e.x,z:e.z},ghost={...origin,radius:e.radius};for(let i=0;i<40;i++)move(ghost,a.x*.25,a.z*.25,this.world.walls);const length=dist(origin,ghost),warning={x:(origin.x+ghost.x)/2,z:(origin.z+ghost.z)/2,shape:'capsule',r:1.8,w:3.6,length:length+3.6,pathLength:length,startX:origin.x,startZ:origin.z,endX:ghost.x,endZ:ghost.z,angle:Math.atan2(ghost.x-origin.x,ghost.z-origin.z)};
   const followup=i=>{if(!active())return;const len=dist(e,p)||1,spot={x:e.x,z:e.z,radius:e.radius};move(spot,(p.x-e.x)/len,(p.z-e.z)/len,this.world.walls);phase(0,.4,`rush-hit-${i}`,[{x:spot.x,z:spot.z,r:3}],()=>{move(e,spot.x-e.x,spot.z-e.z,this.world.walls);this.effect(spot.x,spot.z,2);if(dist(p,spot)<3&&lineClear(spot,p,this.world.walls))this.hurt(p,40);if(i<2)followup(i+1)},i===2)};
   phase(0,.7,'rush',[warning],()=>{let hit=false;for(let i=0;i<40;i++){if(!active())return;move(e,a.x*.25,a.z*.25,this.world.walls);if(dist(e,p)<1.8&&!hit&&lineClear(e,p,this.world.walls)){this.hurt(p,90);hit=true}}if(active()&&dist(e,p)<3.5)followup(0);else done()});
  }
  if(n===2){for(let i=0;i<3;i++){const begin=()=>{if(!active())return;const r=3*Math.pow(1.2,i),spot={x:e.x,z:e.z,r:r+p.radius};phase(0,.5,`pulse-${i}`,[spot],()=>{this.effect(spot.x,spot.z,r,0xf0b775);if(dist(p,spot)<spot.r&&lineClear(spot,p,this.world.walls))this.hurt(p,42)},i===2)};if(i===0)begin();else this.later(i*3,begin)}}
  e.cd=n===0?12:n===1?9:7;
 }

 update(dt){if(!this.running||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);const p=this.player;if(!p||p.hp<=0){this.finish(false);return}repairPlayerPosition(this,{blocked});this.time+=dt;if(!this.networkPassive)tickRaid(this,dt,{move,dist,lineClear});for(const k of ['autoCd','speedBuff','invis','frost','guard','thunderExpire','jumpCd','potionCd','cast','attackLock'])this[k]=Math.max(0,(this[k]||0)-dt);if(!this.frost)this.frostCharges=0;if(!this.thunderExpire){this.thunder=0;this.thunderMarks=[]}if(p.stun>0||(p.knockup||0)>0){if(this.healing>0||this.windActive||this.cast>0||this.pendingAttack)this.interruptPlayer()}p.stun=Math.max(0,p.stun-dt);p.knockup=Math.max(0,(p.knockup||0)-dt);this.tickFrost(p);this.tickBurn();if(!this.running)return;this.cool=this.cool.map(c=>Math.max(0,c-dt));p.mp=Math.min(this.stats.mp,p.mp+dt*3);
  if(this.healing>0){while(this.nextHealAt<=Math.min(this.time,this.healingUntil)+TIME_EPS){const amount=Math.min(this.stats.hp-p.hp,this.stats.hp*(.01+.03*(1-p.hp/this.stats.hp)));p.hp+=amount;if(amount>0)this.emit('number',{x:p.x,z:p.z,text:'+'+Math.round(amount),type:'heal'});this.nextHealAt+=.5}this.healing=this.time+TIME_EPS>=this.healingUntil?0:this.healingUntil-this.time}
  if(this.dodge&&!controlled(p)){const step=Math.min(dt,this.dodge.remaining);move(p,this.dodge.dx*this.dodge.speed*step,this.dodge.dz*this.dodge.speed*step,this.world.walls);this.dodge.remaining-=step;if(this.dodge.remaining<=TIME_EPS)this.dodge=null;}else if(!controlled(p)&&this.cast<=0){const direction=normalizeDirection(this.input),d=direction?Math.hypot(this.input.x,this.input.z):0;if(d>.05){const speed=PLAYER_BASE_SPEED*(1+this.moveSpeedBonus)*(this.speedPotionUntil>this.time?1.1:1)*(this.burstSpeedUntil>this.time?1.2:1)*(this.healing>0||this.invis>0?1.2:1)*this.frostMovementScale(p);move(p,direction.x*Math.min(1,d)*speed*dt,direction.z*Math.min(1,d)*speed*dt,this.world.walls);this.aim=direction}}
  const ready=this.events.filter(e=>e.at<=this.time+TIME_EPS);this.events=this.events.filter(e=>e.at>this.time+TIME_EPS);for(const e of ready){if(!this.running)return;e.fn();if(!this.running)return}
  if(!this.networkPassive)for(const e of this.enemies){if(e.networkHuman)continue;if(e.bot){e.stun=Math.max(0,e.stun-dt);e.knockup=Math.max(0,e.knockup-dt);continue}if(!this.running)return;if(e.hp<=0){if(e.type==='boss'&&e.bossActionId)this.cancelBossAction(e,'death');continue}if(e.type==='boss'&&controlled(e)&&e.bossActionId)this.cancelBossAction(e,'control');e.stun=Math.max(0,e.stun-dt);e.knockup=Math.max(0,(e.knockup||0)-dt);this.tickFrost(e);const p=[this.player,...(this.bots||[]).filter(b=>b.hp>0&&(e.type!=='boss'||b.networkHuman))].filter(b=>b.hp>0).sort((a,b)=>dist(e,a)-dist(e,b))[0]||this.player;e.combatTarget=p;const t=TYPES[e.type],d=dist(e,p),boss=e.type==='boss';if(d>45&&!boss)continue;
   if(boss){if(dist(p,e.home)<26&&d<26&&!(p.networkTarget?p.networkTarget.invis>0:p===this.player&&this.invis>0))e.aggro=true;if(e.aggro){e.out=dist(p,e.home)>26?e.out+dt:0;if(e.out>=10){e.aggro=false;this.cancelBossAction(e,'disengage');e.path=null;e.hp=e.maxHp;e.shield=e.maxShield;e.out=0;e.charge=0;e.cd=3;e.x=e.home.x;e.z=e.home.z;continue}}if(!e.aggro)continue}else if(d>(e.type==='mage'?t.aggroRange:18)||(p.networkTarget?p.networkTarget.invis>0:p===this.player&&this.invis>0)){if(e.type==='mage')this.cancelMageCharge(e);continue;}
   if(e.type==='mage'&&e.charge>0&&(d>t.range||!lineClear(e,p,this.world.walls)))this.cancelMageCharge(e);
   e.cd-=dt;if(controlled(e))continue;
   if(e.charge>0){e.charge=boss?Math.max(0,e.chargeEndsAt-this.time):e.charge-dt;if(e.charge<=TIME_EPS&&!boss){const target=e.target,dd=dist(e,p);e.recoveryUntil=this.time+.45;this.emit('enemy-attack',{id:e.id,type:e.type,x:e.x,z:e.z,attackId:`enemy-${e.id}-${this.time}`,dx:target?.x||0,dz:target?.z||1,duration:.45});if(e.type==='mage'){if(e.mageStage===2){this.arcFireball(e,e.arcTarget,t.atk);e.mageStage=0;e.arcTarget=null;e.cd=t.interval;}else{this.projectile(e,target,t.atk,{speed:10,fire:true,magic:true,range:t.projectileRange});e.mageStage=2;e.charge=2;e.arcTarget={x:p.x,z:p.z};this.emit('warning',{...e.arcTarget,r:2.6,life:3.1,color:0xed602b,owner:'enemy'});this.emit('mage-charge',{x:e.x,z:e.z,duration:2});}}else if(e.type==='bow'){this.projectile(e,target,t.atk,{speed:18,range:18})}else if(dd<t.range+p.radius&&lineClear(e,p,this.world.walls)){const dot=((p.x-e.x)*target.x+(p.z-e.z)*target.z)/Math.max(dd,.01);if(e.type==='hammer'||dot>(e.type==='spear'?.92:.57))this.hurt(p,t.atk,false,e.type==='hammer'?1:0)}if(!this.running)return;if(e.type!=='mage')this.effect(e.x+target.x,e.z+target.z,e.type==='hammer'?2.8:1,0xd6b59c);if(e.type!=='mage'||e.mageStage!==2)e.cd=t.interval}continue}
   if(e.recoveryUntil>this.time)continue;const ranged=e.type==='bow'||e.type==='mage',desired=boss?3:e.type==='mage'?t.desiredRange:ranged?10:t.range*.8;
   if(d>desired||ranged&&d<6){const sign=ranged&&d<6?-1:1;let target=p;
    if(sign>0&&!lineClear(e,p,this.world.walls,e.radius)){
      if(this.time>=(e.pathAt||0)&&this.time>=this.nextNav){e.path=(boss?this.bossNav:this.nav).findPath(e,p);e.pathAt=this.time+.8;this.nextNav=this.time+.05}
      if(e.path?.length){if(Math.hypot(e.path[0]-e.x,e.path[1]-e.z)<.4)e.path.splice(0,2);if(e.path.length)target={x:e.path[0],z:e.path[1]}}
    }else e.path=null;
    const td=dist(e,target)||1,dx=(target.x-e.x)/td*sign,dz=(target.z-e.z)/td*sign;const start={x:e.x,z:e.z};move(e,dx*t.speed*dt*this.frostMovementScale(e),dz*t.speed*dt*this.frostMovementScale(e),this.world.walls);if(dist(start,e)<dt*.1){move(e,-dz*t.speed*dt,dx*t.speed*dt,this.world.walls)}}
   if(e.cd<=0&&d<(boss?18:e.type==='mage'?t.range:t.range+1)&&lineClear(e,p,this.world.walls)){if(boss)this.bossAction(e,p);else{if(e.type==='mage')e.mageStage=1;e.charge=t.charge;e.target={x:(p.x-e.x)/Math.max(d,.01),z:(p.z-e.z)/Math.max(d,.01)};if(e.type==='hammer')this.emit('warning',{x:e.x,z:e.z,r:2.8,life:1.1})}}
  }
  this.releaseAttack();if(!this.running)return;
  for(const shot of this.shots){
   if(shot.arc){shot.elapsed=Math.min(shot.duration,shot.elapsed+dt);shot.life=shot.duration-shot.elapsed;const t=shot.elapsed/shot.duration;shot.x=shot.start.x+(shot.target.x-shot.start.x)*t;shot.z=shot.start.z+(shot.target.z-shot.start.z)*t;shot.y=(1-t)+Math.sin(Math.PI*t)*5;
    if(shot.life<=TIME_EPS){shot.life=0;this.effect(shot.x,shot.z,2.6,0xf36d24,.6);this.emit('fire-impact',{x:shot.x,z:shot.z,r:2.6,arc:true});for(const target of [p,...(this.bots||[]).filter(b=>b.hp>0)])if(dist(target,shot)<2.6+target.radius&&lineClear(shot,target,this.world.walls)){this.hurt(target,shot.amount,true,0,true);if(!this.running)return;if(target===p)this.applyBurn(2);else if(target.networkTarget)target.networkTarget.applyBurn(2)}}continue;
   }
   const travel=Math.min(dt,Math.max(0,shot.life));shot.life-=dt;
   const steps=Math.max(1,Math.ceil(shot.speed*travel/.15));
   const explode=()=>{if(shot.exploded||!shot.fire)return;shot.exploded=true;this.emit('fire-impact',{x:shot.x,z:shot.z,r:1.8,arc:false});this.effect(shot.x,shot.z,1.8,0xf7984c);if(shot.enemy)for(const target of [p,...(this.bots||[]).filter(b=>b.hp>0)])if(dist(target,shot)<1.8+target.radius&&lineClear(shot,target,this.world.walls))this.hurt(target,shot.amount,true,0,true)};
   let ended=false;
   for(let step=0;step<steps&&!ended;step++){
    const nx=shot.x+shot.dx*shot.speed*travel/steps,nz=shot.z+shot.dz*shot.speed*travel/steps;
    if(blocked(nx,nz,shot.radius,this.world.walls)){shot.life=0;explode();if(!this.running)return;ended=true;break}
    shot.x=nx;shot.z=nz;
    for(const e of (shot.enemy?[p,...(this.bots||[]).filter(b=>b.hp>0)]:this.enemies)){
     if(e.hp<=0||dist(e,shot)>=e.radius+shot.radius)continue;
     if(shot.fire){explode();if(!this.running)return}else{
      this.hurt(e,shot.amount,shot.magic||false,shot.stun||0,shot.enemy);if(!this.running)return;
      if(shot.bonusMagic&&e!==p)this.hurt(e,shot.bonusMagic,true);if(shot.frost&&e!==p){this.hurt(e,this.stats.atk*.35,true);this.applyFrost(e);this.emit('frost-hit',{x:e.x,z:e.z})}
      if(shot.knock)move(e,shot.dx*shot.knock,shot.dz*shot.knock,this.world.walls);
     }shot.life=0;ended=true;break;
    }
   }if(shot.life<=0){explode();if(!this.running)return}
  }
  this.shots=this.shots.filter(s=>s.life>0);const near=this.world.exits.some(e=>dist(p,e)<3);this.exitProgress=near&&this.extractHeld?this.exitProgress+dt:0;if(this.exitProgress+TIME_EPS>=3){this.finish(true);return}if(this.time>=RAID_SECONDS){this.emit('toast',{text:'试炼超时迷失，本局物品全部遗失'});this.finish(false,'timeout')};
 }
}


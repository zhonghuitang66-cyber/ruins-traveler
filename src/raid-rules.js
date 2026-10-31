import {packGrid} from './grid-inventory.js';
import {ITEM_DEFINITIONS,isEquipment,canEquip,getEquipmentStats} from './equipment.js';
import {rollLootContainer} from './loot-containers.js';

export const RAID_SECONDS=480;
export const CORNERS=[{x:-76,z:-76},{x:76,z:-76},{x:76,z:76},{x:-76,z:76}];
export function resetRaid(game,rng=Math.random){
 const corner=Math.min(3,Math.floor(rng()*4));Object.assign(game.player,CORNERS[corner]);
 game.spawnCorner=corner;game.nextHunterAt=0;game.hunterOrder=0;game.nextExitAt=null;
 game.world.exits=[rng()<.5?{x:7,z:7}:{x:(rng()-.5)*100,z:-48}];
 game.bots=CORNERS.filter((_,i)=>i!==corner).map((p,i)=>Object.assign(game.enemy({...p,type:'sword',zone:Math.floor((p.z+90)/60)*3+Math.floor((p.x+90)/60)}),{bot:true,botOrder:i,state:'scavenge',hp:350,maxHp:350,inventory:[],equipment:{},visited:[],readyAt:null,botCd:0,botWindup:null}));
 game.enemies.push(...game.bots);
}

// One departure per game minute. Readiness is latched; later bots cannot jump the queue.
export function tickRaid(game,dt,{move,dist,lineClear}){
 const walls=game.world.walls;
 for(const b of game.bots||[]){
  if(b.hp<=0)continue;
  if(b.state==='scavenge'&&(b.clearedBlock||game.time>=180)){b.state='queued';b.readyAt=game.time}
 }
 const next=(game.bots||[]).find(b=>b.hp>0&&b.state==='queued');
 if(next&&game.time+1e-8>=game.nextHunterAt){next.state='hunt';next.departedAt=game.time;game.nextHunterAt=game.time+60;game.emit('toast',{text:'一名遗迹猎手开始追踪你'})}
 for(const b of game.bots||[]){
  if(b.hp<=0||b.stun>0||b.knockup>0)continue;if(b.hp<80&&b.inventory.length&&game.world.exits.length)b.state='extract';if(b.state==='extract'){const exit=game.world.exits[0];if(!exit){b.state='hunt';continue}const d=dist(b,exit);if(d<3){b.extractProgress=(b.extractProgress||0)+dt;if(b.extractProgress>=3){b.hp=0;b.extracted=true;game.world.exits.shift();if(game.nextExitAt===null)game.nextExitAt=game.time+300;game.emit('toast',{text:'一名猎手已撤离，5分钟后中央刷新法阵'})}}else{b.extractProgress=0;move(b,(exit.x-b.x)/d*2.8*dt,(exit.z-b.z)/d*2.8*dt,walls)}continue}
  b.botCd=Math.max(0,b.botCd-dt);
  const target=b.state==='hunt'?game.player:game.enemies.filter(e=>!e.bot&&e.type!=='boss'&&e.hp>0&&dist(e,b)<13).sort((a,c)=>dist(a,b)-dist(c,b))[0];
  if(b.botWindup){const w=b.botWindup;b.charge=Math.max(0,w.at-game.time);if(game.time>=w.at){b.botWindup=null;b.botCd=1.8;b.botRecoveryUntil=game.time+.35;const t=w.target;if(t.hp>0&&dist(b,t)<3&&lineClear(b,t,walls)){game.damageSource=b;try{game.hurt(t,28+(getEquipmentStats(b.equipment,'swordsman').atk||0))}finally{game.damageSource=null}}}continue}
  if(b.botRecoveryUntil>game.time)continue;let destination=target;
  if(target&&dist(b,target)<2.4&&lineClear(b,target,walls)){if(b.botCd<=0){b.botWindup={target,at:game.time+.55};b.charge=.55;b.chargeEndsAt=game.time+.55}continue}
  b.charge=0;
  if(!destination){
   const pack=game.packs.find(p=>!b.visited.includes(p.id)&&dist(b,p)<25),chest=game.world.chests.find(c=>!c.activity&&!c.opened&&!b.visited.includes(c.id)&&c.zone===b.zone);
   destination=pack||chest;
   if(destination&&dist(b,destination)<2){
    if(!b.search||b.search.id!==destination.id)b.search={id:destination.id,until:game.time+4};
    if(game.time>=b.search.until){
     const rows=destination.items||rollLootContainer(destination.type,{zone:b.zone}).items;
     const remaining=[];for(const row of rows){if(isEquipment(row)&&canEquip(row,'swordsman')){const slot=ITEM_DEFINITIONS[row.id].slot;if(!b.equipment[slot]){b.equipment[slot]=row;continue}}const result=packGrid(b.inventory,[row],{capacity:24});b.inventory=result.bag;remaining.push(...result.remainder)}
     b.visited.push(destination.id);if(destination.items){destination.items=remaining;if(!remaining.length)game.packs=game.packs.filter(p=>p!==destination)}else{destination.opened=true;if(remaining.length){destination.packId=`bot-open-${destination.id}`;game.packs.push({id:destination.packId,x:destination.x,z:destination.z,type:'chest',capacity:30,name:destination.name,items:remaining})}}b.search=null;
    }continue;
   }
   if(!destination){b.clearedBlock=true;continue}
  }
  const distance=dist(b,destination);if(distance>.1){
   let point=destination;
   if(!lineClear(b,destination,walls)){if(game.time>=(b.pathAt||0)){b.path=game.nav.findPath(b,destination);b.pathAt=game.time+1}while(b.path?.length&&Math.hypot(b.x-b.path[0],b.z-b.path[1])<.7)b.path.splice(0,2);point=b.path?.length?{x:b.path[0],z:b.path[1]}:b}
   const length=dist(b,point)||1;move(b,(point.x-b.x)/length*2.8*dt,(point.z-b.z)/length*2.8*dt,walls);
  }
 }
 if(game.nextExitAt!==null&&game.time>=game.nextExitAt){game.world.exits.push({x:(Math.random()-.5)*34,z:(Math.random()-.5)*34});game.nextExitAt+=300;game.emit('toast',{text:'中央区域出现新的蓝色撤离法阵'})}
}

export function repairPlayerPosition(game,{blocked}){
 const p=game.player;if(Number.isFinite(p.x)&&Number.isFinite(p.z)&&!blocked(p.x,p.z,p.radius,game.world.walls)){game.lastLegalPosition={x:p.x,z:p.z};return false}
 const x=Number.isFinite(p.x)?Math.max(-88,Math.min(88,p.x)):game.lastLegalPosition?.x??-76,z=Number.isFinite(p.z)?Math.max(-88,Math.min(88,p.z)):game.lastLegalPosition?.z??-76;
 for(let r=0;r<=180;r+=1)for(let i=0;i<16;i++){const a=i*Math.PI/8,c={x:Math.max(-88,Math.min(88,x+Math.cos(a)*r)),z:Math.max(-88,Math.min(88,z+Math.sin(a)*r))};if(!blocked(c.x,c.z,p.radius,game.world.walls)){Object.assign(p,c);game.lastLegalPosition=c;game.emit('toast',{text:'已回到可通行的地图边缘'});return true}}
 return false;
}

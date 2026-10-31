import {createCloakWind} from './cloak-wind.js';
import {createGroundWarnings} from './ground-warnings.js';
import {createHolyShield} from './holy-shield.js';
import {lineClear} from './core.js';
import {createSpriteVFX} from './sprite-vfx.js';
import {VFX_CATALOG} from './vfx-catalog.js';
const direction=d=>{const x=Number.isFinite(d.dx)?d.dx:0,z=Number.isFinite(d.dz)?d.dz:1,n=Math.hypot(x,z)||1;return {x:x/n,z:z/n}};
/** Authored combat frames, exact hazard footprints and separate sparse cloak wind ribbons. */
export function createSkillVFX(scene,{maxEffects=24,maxParticles=192,loadTexture=null,catalog=VFX_CATALOG}={}){
 const sprites=createSpriteVFX(scene,{catalog,maxEffects,loadTexture}),cloakWind=createCloakWind(scene),shield=createHolyShield(scene),warnings=createGroundWarnings(scene),auras=new Map();let worldRef=null,reducedFlash=false,time=0,trailAt=0,lastPosition=null,dodge=null,footAt=0,side=1,quality='detail',released=false;
 const asset=(key,fallback)=>catalog[key]?key:fallback;
 const spawn=(key,x,z,o={})=>sprites.spawn(key,{x,z,...o});
 function sweep(d,big=false,hammer=false){const a=direction(d),strength=1+(d.comboStage||0)*.1;spawn(asset('promare-slash','slash'),d.x+a.x*1.1,d.z+a.z*1.1,{ground:true,y:big?1.2:1.05,angle:Math.atan2(a.x,a.z)+Math.PI/2,width:(big?7.2:hammer?4.8:4.2)*strength,height:(big?5:hammer?3.4:2.9)*strength,life:big?.48:.34,tint:hammer?0xffd583:0xffffff,tag:hammer?'hammer-sweep':'horizontal-slash'})}
 function impact(d,{enemy=false,r=d.r||2}={}){spawn(enemy?'ember':asset('promare-impact','hit'),d.x,d.z,{y:.8,width:r*2.2,height:r*1.6,life:d.life||.48,tag:enemy?'enemy-impact':'impact',tint:enemy?0xffb875:0xffffff})}
 function displacement(d){
  if(![d.x,d.z,d.endX,d.endZ].every(Number.isFinite))return;const dx=d.endX-d.x,dz=d.endZ-d.z,length=Math.hypot(dx,dz);if(length<.015||length>12)return;
  const n=Math.min(4,Math.max(1,Math.ceil(length/1.1))),angle=Math.atan2(dx,dz);
  for(let i=0;i<n;i++){const f=(i+.5)/n;spawn('wind',d.x+dx*f,d.z+dz*f,{y:.09,ground:true,width:.7,height:length/n,angle,life:.27,tag:'displacement',tint:d.kind==='thunder'?0xc8c4ff:0xc3efff})}
 }
 function windVolley(d){const a=direction(d);spawn(asset('semantic-arrows','wind'),d.x+a.x*1.2,d.z+a.z*1.2,{ground:true,angle:Math.atan2(a.x,a.z),y:1,width:2.5,height:3,life:.25,tag:'arrow-volley'})}
 function fissure(d){const a=direction(d);let length=d.length||9;const origin={x:d.x,z:d.z};if(worldRef?.world?.walls)for(let n=.25;n<=length;n+=.25)if(!lineClear(origin,{x:d.x+a.x*n,z:d.z+a.z*n},worldRef.world.walls)){length=Math.max(0,n-.25);break}if(length<.1)return;spawn(asset('semantic-fissure','ember'),d.x+a.x*length/2,d.z+a.z*length/2,{ground:true,y:.045,angle:Math.atan2(a.x,a.z),width:d.width||2,height:length,life:.7,tag:'ground-fissure'})}
 function emit(type,d={}){
  if(released)return;
  if(type==='enemy-attack'&&!['bow','mage'].includes(d.type)){const a=direction(d);spawn(asset('monster-white-slash','slash'),d.x+a.x,d.z+a.z,{ground:true,y:1,angle:Math.atan2(a.x,a.z)+Math.PI/2,width:d.type==='boss'?5:3,height:d.type==='boss'?3.5:2,life:.28,tag:'enemy-white-slash'})}if(type==='warning'||type==='warning-cancel'){warnings.emit(type,d);return}
  if(type==='effect'){if(d.owner==='player')return;impact(d,{enemy:d.owner!=='player'&&d.color!==undefined,r:d.r||1});return}
  if(type==='dodge'&&Number.isFinite(d.x)&&Number.isFinite(d.z))dodge={x:d.x,z:d.z,left:Number.isFinite(d.duration)?Math.min(.5,Math.max(0,d.duration)):.18};
  if(type==='displacement'){displacement(d);lastPosition=null}
  if(type==='skill'){
   const k=d.role+':'+d.index;
   // Charge is a dedicated pose and weapon glow, with no airborne slash or ground energy bar.
   if(k==='swordsman:1')spawn('wind',d.endX??d.x,d.endZ??d.z,{y:.8,width:3,height:2.1,life:.32,tag:'thrust'});
   if(k==='swordsman:2')spawn('aegis',d.endX??d.x,d.endZ??d.z,{y:1.4,width:4,height:3.8,life:.45,tag:'slam-launch'});
   // Holy guard uses the real three-dimensional shield shell driven by world.guard.
   // Thunder readiness is shown on the held hammer, not as a vortex.
   if(k==='paladin:2')spawn(asset('semantic-seal','heal'),d.x,d.z,{y:.055,ground:true,width:4.3,height:4.3,life:.7,tag:'heal-cast'});
   if(k==='archer:0')windVolley(d);
   if(k==='archer:1')spawn(asset('semantic-frost','slash'),d.x,d.z,{y:1.1,width:2,height:2,life:.35,tag:'ice-cast',tint:0xc2eeff});
   if(k==='archer:2')windVolley(d);
  }
  if(type==='skill-impact'){sprites.cancel(e=>e.tag==='charge');if(d.index===0)fissure(d);else impact(d,{r:3.5})}
  if(type==='attack-impact'&&d.role!=='archer'){if(d.role==='paladin'&&worldRef?.thunder>0){const a=direction(d);spawn(asset('semantic-lightning','aegis'),d.x+a.x*2,d.z+a.z*2,{y:2.6,width:2.8,height:5,life:.28,tag:'thunder-swing'})}else sweep(d,false,d.role==='paladin')}
  if(type==='attack-impact'&&d.role==='archer'){const a=direction(d);spawn(asset('semantic-arrows','wind'),d.x+a.x,d.z+a.z,{ground:true,angle:Math.atan2(a.x,a.z),y:1,width:1.2,height:2,life:.22,tag:'arrow-release'})}
  if(type==='thunder-mark')spawn(asset('semantic-lightning','aegis'),d.x,d.z,{y:2.6,width:d.remaining===0?4.5:2.5,height:d.remaining===0?7:4.5,life:.45,tag:'thunder-strike'});
  if(type==='wind-volley')windVolley(d);
  if(type==='fire-impact')impact(d,{enemy:true,r:Math.min(4,Math.max(1,d.r||1.8))});
  if(type==='frost-release'){const a=direction(d);spawn(asset('semantic-arrows','wind'),d.x+a.x,d.z+a.z,{ground:true,angle:Math.atan2(a.x,a.z),y:1,width:1.3,height:2.3,life:.22,tint:0x9ae5ff,tag:'frost-release'})}
  if(type==='frost-hit')spawn(asset('semantic-frost','slash'),d.x,d.z,{y:.8,width:2.7,height:2.7,life:.42,tag:'frost-hit',tint:0xa1e5ff});
  if(type==='hit')spawn(d.player?(d.magic?'slash':'hit'):asset('promare-impact','hit'),d.x,d.z,{y:1,width:d.player?1.1:1.6,height:1.6,life:.22,tag:'hit',opacity:.8});
  if(type==='heal')spawn('heal',d.x,d.z,{y:1.2,width:1.4,height:1.4,life:.6,tag:'heal-tick',opacity:.6});
  if(type==='cancel-cast')sprites.cancel(e=>e.tag==='charge'||e.tag==='warning'&&e.owner==='player');
 }
 function aura(key,enabled,p,asset,o){
  let e=auras.get(key);if(!enabled){if(e)sprites.cancel(v=>v===e);auras.delete(key);return}
  if(!e||!e.slot.used||e.slot.mesh.name!=='vfx-aura-'+key){e=spawn(asset,p.x,p.z,{life:3600,loop:true,anchor:p,tag:'aura-'+key,priority:true,loopFrames:asset==='aegis'?6:asset==='slash'?4:null,...o});if(e)auras.set(key,e)}
 }
 function update(dt,{paused=false,world=null}={}){
  if(released||paused||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(.05,dt);time+=dt;worldRef=world;shield.update(dt,{world,paused:false,reducedFlash});cloakWind.update(dt,{world,reducedFlash});warnings.update(dt);sprites.update(dt);
  const p=world?.player,live=Boolean(world?.running&&p?.hp>0);
  if(!live){lastPosition=null;dodge=null}else{
   const old=lastPosition;lastPosition={x:p.x,z:p.z};if(old){const dx=p.x-old.x,dz=p.z-old.z,len=Math.hypot(dx,dz);
    if(len>.015&&len<.65&&(world.speedBuff>0||world.healing>0||world.invis>0)&&!world.dodge&&!dodge&&time>=footAt){footAt=time+(quality==='economy'?.14:.09);side*=-1;spawn('ember',old.x+dz/len*.17*side,old.z-dx/len*.17*side,{y:.065,ground:true,width:.48,height:.85,angle:Math.atan2(dx,dz),life:.24,tag:'orange-footstep'})}
   }
   if(dodge){displacement({x:dodge.x,z:dodge.z,endX:p.x,endZ:p.z,kind:'dash'});dodge.x=p.x;dodge.z=p.z;dodge.left-=dt;if(dodge.left<=0)dodge=null}
  }
  // Three-dimensional guard shell is updated separately from sprite auras.
  aura('heal',live&&world.healing>0,p,asset('semantic-seal','heal'),{y:.055,ground:true,width:3.8,height:3.8,opacity:.8});
  // Frost readiness is kept near the bow, never an unrelated sword crescent beneath the feet.
  aura('frost',live&&world.frost>0,p,asset('semantic-frost','slash'),{y:1.15,width:.9,height:.9,opacity:.65,tint:0x96e8ff});
  if(live&&time>=trailAt){trailAt=time+(quality==='economy'?.18:.1);for(const s of world.shots||[])if(s.bladeWind){spawn(asset('monster-white-slash','slash'),s.x,s.z,{ground:true,y:.9,width:1.8,height:1.2,angle:Math.atan2(s.dx,s.dz)+Math.PI/2,life:.16,tag:'blade-wind'})}else if(s.fire||s.frost||s.knock)spawn(s.fire?'ember':s.frost?'slash':'wind',s.x,s.z,{y:s.y??1,width:s.fire?1.1:1.5,height:1,life:.22,tag:'projectile-trail',opacity:.65})}
 }
 function reset(){worldRef=null;cloakWind.reset();shield.reset();warnings.reset();sprites.reset();auras.clear();lastPosition=null;dodge=null;footAt=trailAt=time=0;side=1}
 function release(){if(released)return;reset();released=true;cloakWind.release();shield.release();warnings.release();sprites.release()}
 function configure(o={}){if(typeof o.reducedFlash==='boolean')reducedFlash=o.reducedFlash;if(['economy','standard','detail'].includes(o.quality))quality=o.quality;sprites.configure(o)}
 return {emit,update,reset,release,configure,ready:sprites.ready,isReady:sprites.isReady,getStats:()=>({...sprites.getStats(),cloakWind:cloakWind.getStats(),shield:shield.getStats(),warnings:warnings.getStats(),maxParticles:Math.floor(maxParticles*(quality==='economy'?.5:quality==='standard'?.75:1)),auras:[...auras].filter(([k,e])=>e.slot.used&&e.slot.mesh.visible&&e.slot.mesh.name==='vfx-aura-'+k).map(([k])=>k)})};
}

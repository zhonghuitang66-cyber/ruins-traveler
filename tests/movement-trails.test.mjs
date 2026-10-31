import test from 'node:test';import assert from 'node:assert/strict';
import {Scene,Vector3,Texture} from '../vendor/three.module.js';import {createSkillVFX} from '../src/skill-vfx.js';import {Game} from '../src/core.js';
const ready=async v=>{await v.ready;return v};
const make=(s)=>createSkillVFX(s,{loadTexture:async()=>new Texture()});
const meshes=scene=>scene.children[0].children.filter(o=>o.visible&&!o.isInstancedMesh);
test('all instantaneous movement kinds draw only actual forward segment for sixteen directions',async()=>{
 for(const kind of ['dash','slam','thunder'])for(let i=0;i<16;i++){const scene=new Scene(),vfx=await ready(make(scene));const a=i*Math.PI/8,dx=Math.sin(a),dz=Math.cos(a),length=kind==='thunder'?.8:4;vfx.emit('displacement',{x:0,z:0,endX:dx*length,endZ:dz*length,kind});vfx.update(.01);scene.updateMatrixWorld(true);const strips=meshes(scene).filter(o=>o.name==='vfx-displacement');assert.ok(strips.length);for(const m of strips){assert.equal(m.position.y,.09);const axis=new Vector3(0,1,0).applyQuaternion(m.quaternion);assert.ok(axis.x*dx+axis.z*dz>.9999);const mid=m.position.x*dx+m.position.z*dz;assert.ok(mid-m.scale.y/2>=-1e-6&&mid+m.scale.y/2<=length+1e-6)}vfx.release()}
});
test('zero or malformed displacement does not invent a requested-range trail',async()=>{
 const scene=new Scene(),vfx=await ready(make(scene));for(const d of [{x:0,z:0,endX:0,endZ:0},{x:0,z:0,endX:NaN,endZ:5},{x:0,z:0,endX:Infinity,endZ:1}])vfx.emit('displacement',d);assert.equal(vfx.getStats().effects,0);vfx.release()
});
test('actual dash slam and thunder moves emit one authoritative path including wall-shortened endpoint',async()=>{
 for(const [role,index,kind] of [['swordsman',1,'dash'],['swordsman',2,'slam'],['paladin',1,'thunder']]){
  const scene=new Scene(),vfx=await ready(make(scene)),events=[];const g=new Game((t,d)=>{if(t==='displacement')events.push(d);vfx.emit(t,d)});g.start(role);g.enemies=[];g.player.x=g.player.z=0;g.world.walls=[{x:0,z:1.5,w:10,d:1}];g.aim={x:0,z:1};assert.ok(g.skill(index,g.aim));if(kind==='thunder'){for(let i=0;i<50;i++)g.update(.01);assert.ok(g.attack(true));assert.equal(events.length,0);for(let left=g.pendingAttack.impactDelay;left>1e-9;){const dt=Math.min(.05,left);g.update(dt);left-=dt}}assert.equal(events.length,1);const d=events[0];assert.equal(d.kind,kind);assert.equal(d.x,0);assert.equal(d.z,0);assert.equal(d.endX,g.player.x);assert.equal(d.endZ,g.player.z);assert.ok(d.endZ>=0&&d.endZ<1);vfx.update(.01);const strips=meshes(scene).filter(m=>m.name==='vfx-displacement'&&m.position.y===.09);for(const m of strips)assert.ok(m.position.z+m.scale.y/2<=g.player.z+1e-6);vfx.release()
 }
});
test('speed buff emits orange foot traces only while moving, not idle paused dead or ended',async()=>{
 const scene=new Scene(),vfx=await ready(make(scene)),world={running:true,player:{hp:10,x:0,z:0},speedBuff:4,shots:[]};for(let i=0;i<15;i++)vfx.update(.05,{world});assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().particles,0);world.player.z=.2;vfx.update(.05,{world});const feet=meshes(scene).filter(m=>m.name==='vfx-orange-footstep');assert.ok(feet.length);assert.ok(feet.every(m=>m.position.y===.065&&m.name==='vfx-orange-footstep'));const before=vfx.getStats();world.player.z=.3;vfx.update(.05,{world,paused:true});assert.deepEqual(vfx.getStats(),before);world.speedBuff=0;for(let i=0;i<30;i++)vfx.update(.05,{world});assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().particles,0);world.speedBuff=4;world.player.hp=0;world.player.z=1;vfx.update(.05,{world});assert.equal(vfx.getStats().particles,0);world.player.hp=10;world.running=false;world.player.z=2;vfx.update(.05,{world});assert.equal(vfx.getStats().particles,0);vfx.release()
});
test('many displacements and speed steps stay bounded in economy mode and reset has no delayed trails',async()=>{
 const scene=new Scene(),vfx=await ready(make(scene)),world={running:true,player:{hp:10,x:0,z:0},speedBuff:4,shots:[]};vfx.configure({quality:'economy'});for(let i=0;i<150;i++){vfx.emit('displacement',{x:0,z:0,endX:0,endZ:5,kind:'dash'});world.player.x+=.15;vfx.update(.016,{world})}assert.ok(vfx.getStats().effects<=12&&vfx.getStats().particles<=96);vfx.reset();world.speedBuff=0;vfx.update(.016,{world});assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().particles,0);vfx.release()
});

test('real regeneration and wind invisibility movement both produce orange foot traces without speedBuff',async()=>{
 for(const role of ['paladin','archer']){
  const scene=new Scene(),vfx=await ready(make(scene)),g=new Game((type,data)=>vfx.emit(type,data));g.start(role);g.enemies=[];g.world.walls=[];assert.ok(g.skill(2,{x:0,z:1}));for(let i=0;i<45;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.equal(g.speedBuff,0);assert.ok(role==='paladin'?g.healing>0:g.invis>0);
  const orange=()=>meshes(scene).filter(m=>m.position.y===.065&&m.name==='vfx-orange-footstep');assert.equal(orange().length,0,'stationary '+role+' must not create orange footsteps');g.input={x:0,z:1};for(let i=0;i<12;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.ok(orange().length>0,'missing orange movement trace for '+role);vfx.release()
 }
});

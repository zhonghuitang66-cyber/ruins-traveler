import test from 'node:test';import assert from 'node:assert/strict';
import {Scene,Vector3,Texture} from '../vendor/three.module.js';import {createSkillVFX} from '../src/skill-vfx.js';import {Game} from '../src/core.js';

const ready=async scene=>{const v=createSkillVFX(scene,{loadTexture:async()=>new Texture()});await v.ready;return v};

test('sixteen actual dash directions align the ground strip with real world XZ displacement',async()=>{
 for(let i=0;i<16;i++){const scene=new Scene(),vfx=await ready(scene);const g=new Game((t,d)=>vfx.emit(t,d));g.start('swordsman');g.enemies=[];g.world.walls=[];g.player.x=g.player.z=0;const a=i*Math.PI/8,dir={x:Math.sin(a),z:Math.cos(a)};g.skill(1,dir);vfx.update(.01);scene.updateMatrixWorld(true);const strips=scene.children[0].children.filter(m=>m.name==='vfx-displacement'&&m.visible);assert.ok(strips.length);for(const m of strips){const axis=new Vector3(0,1,0).applyQuaternion(m.quaternion);assert.ok(axis.x*dir.x+axis.z*dir.z>.99999,'mirrored beam at '+i);const along=m.position.x*dir.x+m.position.z*dir.z;assert.ok(along>=0&&along<=Math.hypot(g.player.x,g.player.z));assert.ok(Math.abs(m.position.x*dir.z-m.position.z*dir.x)<1e-6)}vfx.release()}
});
test('sword and hammer texture negative-X forward follows sixteen actual directions on a waist-high plane',async()=>{
 for(const kind of ['sword','hammer'])for(let i=0;i<16;i++){
  const scene=new Scene(),vfx=await ready(scene),a=i*Math.PI/8,dx=Math.sin(a),dz=Math.cos(a);vfx.emit(kind==='charged'?'skill-impact':'attack-impact',{role:kind==='hammer'?'paladin':'swordsman',index:0,x:3,z:-2,dx,dz});vfx.update(.03);scene.updateMatrixWorld(true);
  const m=scene.getObjectByName(kind==='hammer'?'vfx-hammer-sweep':'vfx-horizontal-slash');assert.ok(m?.visible);assert.equal(m.userData.billboard,false);assert.equal(m.userData.key,'promare-slash');
  const forward=new Vector3(-1,0,0).applyQuaternion(m.quaternion),normal=new Vector3(0,0,1).applyQuaternion(m.quaternion);assert.ok(forward.x*dx+forward.z*dz>.999999);assert.ok(Math.abs(normal.y)>.999999);
  assert.ok(m.position.y>=1&&m.position.y<=1.2);assert.ok(Math.abs((m.position.x-3)*dz-(m.position.z+2)*dx)<1e-8);assert.ok((m.position.x-3)*dx+(m.position.z+2)*dz>1);
  const p=new Vector3();for(let j=0;j<4;j++){p.fromBufferAttribute(m.geometry.attributes.position,j).applyMatrix4(m.matrixWorld);assert.ok(Math.abs(p.y-m.position.y)<1e-8,'sweep is not horizontal')}
  assert.ok(m.scale.x>=4.2&&m.scale.y>=2.9);vfx.release()
 }
});
test('cloak storm persists and follows actual player through entire status, respects pause and expires',async()=>{
 const scene=new Scene(),vfx=await ready(scene),world={running:true,player:{hp:10,x:1,z:2},invis:3,shots:[]};vfx.update(.05,{world});const storm=scene.getObjectByName('CloakWindWisps');assert.ok(storm?.visible);assert.equal(storm.children.length,3);assert.equal(storm.children[0].material.map,null);const angle=storm.rotation.y;world.player.x=7;vfx.update(.05,{world,paused:true});assert.equal(storm.position.x,1);assert.equal(storm.rotation.y,angle);for(let i=0;i<55;i++)vfx.update(.05,{world});assert.equal(storm.position.x,7);assert.ok(storm.visible);assert.notEqual(storm.rotation.y,angle);assert.ok(storm.children[0].material.opacity>.3&&storm.children[0].material.opacity<.7);world.invis=0;vfx.update(.01,{world});assert.equal(storm.visible,false);vfx.release()
});
test('dodge trail samples only actual movement, stays on ground and cannot predict a wall-crossing endpoint',async()=>{
 const scene=new Scene(),vfx=await ready(scene),world={running:true,player:{hp:10,x:0,z:0},shots:[]};vfx.emit('dodge',{x:0,z:0,dx:0,dz:1,endX:0,endZ:200,duration:.18});vfx.update(.03,{world});assert.equal(vfx.getStats().effects,0,'stationary against wall should have no invented path');world.player.z=.4;vfx.update(.03,{world});scene.updateMatrixWorld(true);const strips=scene.children[0].children.filter(m=>m.visible&&m.name==='vfx-displacement');assert.ok(strips.length>0);for(const m of strips){assert.equal(m.position.y,.09);assert.ok(m.position.z>0&&m.position.z<.4);assert.ok(m.scale.y<.5)}vfx.reset();assert.equal(vfx.getStats().effects,0);vfx.update(.03,{world});assert.equal(vfx.getStats().effects,0);vfx.release()
});

test('real core ground dodge produces only actual behind-player afterimages, never a jump height',async()=>{
 const scene=new Scene(),vfx=await ready(scene),g=new Game((t,d)=>vfx.emit(t,d));g.start('swordsman');g.world.walls=[];g.enemies=[];g.player.x=g.player.z=0;g.aim={x:1,z:0};assert.ok(g.jump());for(let i=0;i<8;i++){g.update(1/60);vfx.update(1/60,{world:g})}const ghosts=scene.children[0].children.filter(o=>o.name==='vfx-displacement'&&o.visible);assert.ok(ghosts.length>0);for(const m of ghosts){assert.equal(m.position.y,.09);assert.ok(m.position.x>=0&&m.position.x<=g.player.x);assert.equal(m.position.z,0)}assert.ok(vfx.getStats().effects<=24);vfx.release()
});

test('real wind three-round sequence opens a following storm until actual invisibility expiry',async()=>{
 const scene=new Scene(),vfx=await ready(scene),events=[];const g=new Game((t,d)=>{events.push(t);vfx.emit(t,d)});g.start('archer');g.enemies=[];g.world.walls=[];assert.ok(g.skill(2,{x:1,z:0}));for(let i=0;i<40;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.equal(events.filter(t=>t==='wind-volley').length,3);const storm=scene.getObjectByName('CloakWindWisps');assert.ok(g.invis>2.8&&storm?.visible);g.input={x:1,z:0};for(let i=0;i<100;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.ok(storm.visible);assert.equal(storm.position.x,g.player.x);for(let i=0;i<90;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.equal(g.invis,0);assert.equal(storm.visible,false);vfx.release()
});

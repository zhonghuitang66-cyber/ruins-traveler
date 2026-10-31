import test from 'node:test';import assert from 'node:assert/strict';
import {Scene,Texture} from '../vendor/three.module.js';
import {createSkillVFX} from '../src/skill-vfx.js';import {VFX_CATALOG} from '../src/vfx-catalog.js';import {Game} from '../src/core.js';
const make=async(options={})=>{const scene=new Scene(),vfx=createSkillVFX(scene,{...options,loadTexture:async()=>new Texture()});await vfx.ready;return {scene,vfx}};
test('all nine skills map to bounded real frame assets, with no procedural ring geometry',async()=>{const {scene,vfx}=await make({maxEffects:12});for(let n=0;n<5;n++)for(const role of ['swordsman','paladin','archer'])for(let index=0;index<3;index++)vfx.emit('skill',{role,index,x:0,z:0,endX:1,endZ:2});assert.equal(vfx.getStats().effects,12);assert.equal(vfx.getStats().pooledMeshes,12);assert.ok(scene.children[0].children.every(m=>m.geometry.type==='PlaneGeometry'&&m.material.map));vfx.release()});
test('pause freezes frames and status auras cancel when their actual status ends',async()=>{const {vfx}=await make();vfx.emit('skill',{role:'swordsman',index:0,x:0,z:0});vfx.emit('warning',{x:3,z:4,r:2,life:3,warningId:'paused-enemy'});const before=vfx.getStats();vfx.update(.05,{paused:true});assert.deepEqual(vfx.getStats(),before);const world={running:true,player:{hp:10,x:2,z:3},guard:1,frost:1};vfx.update(.01,{world});assert.deepEqual(vfx.getStats().auras,['frost']);assert.equal(vfx.getStats().shield.visible,true);world.guard=world.frost=0;vfx.update(.01,{world});assert.deepEqual(vfx.getStats().auras,[]);assert.equal(vfx.getStats().shield.visible,false);vfx.emit('cancel-cast');assert.equal(vfx.getStats().effects,0);vfx.release()});
test('quality trims transient quad budget while real atlas textures stay shared',async()=>{const {vfx}=await make();for(let i=0;i<50;i++)vfx.emit('thunder-mark',{x:0,z:0,remaining:0});vfx.configure({quality:'economy'});assert.equal(vfx.getStats().maxEffects,12);assert.ok(vfx.getStats().effects<=12);assert.equal(vfx.getStats().textures,Object.keys(VFX_CATALOG).length);vfx.configure({quality:'detail'});assert.equal(vfx.getStats().maxEffects,24);vfx.release()});
test('weakened flashes lower actual textured quad opacity without changing source frame or events',async()=>{const a=await make(),b=await make();b.vfx.configure({reducedFlash:true});for(const v of [a.vfx,b.vfx]){v.emit('thunder-mark',{x:0,z:0,remaining:0});v.update(.03)}assert.deepEqual(a.vfx.getStats().frames,b.vfx.getStats().frames);assert.ok(b.scene.children[0].children[0].material.opacity<a.scene.children[0].children[0].material.opacity);a.vfx.release();b.vfx.release()});
test('enemy danger uses its own meter SDF and preserves lifetime while ordinary hits fill the sprite pool',async()=>{
 const {scene,vfx}=await make();vfx.emit('warning',{x:3,z:4,r:2.6,life:3.1,owner:'enemy',warningId:'mage-arc'});
 const m=scene.getObjectByName('GroundWarning');assert.ok(m.visible);assert.equal(m.scale.x,5.2);assert.equal(m.scale.y,5.2);assert.equal(m.material.type,'ShaderMaterial');assert.equal(m.material.map,undefined);assert.equal(m.position.y,.04);
 assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().warnings.active,1);assert.equal(vfx.getStats().warnings.warnings[0].warningId,'mage-arc');assert.equal(vfx.getStats().warnings.warnings[0].radius,2.6);
 for(let i=0;i<100;i++)vfx.emit('hit',{x:0,z:0});assert.equal(vfx.getStats().warnings.active,1);assert.equal(vfx.getStats().frames.some(f=>f.tag==='warning'),false);
 for(let i=0;i<61;i++)vfx.update(.05);assert.ok(m.visible);vfx.update(.05);assert.equal(m.visible,false);assert.equal(vfx.getStats().warnings.active,0);vfx.release();
});
test('player charge does not create a ground warning and cast cancellation preserves enemy danger',async()=>{
 const {scene,vfx}=await make();vfx.emit('warning',{x:1,z:2,w:2,length:9,angle:.7,life:1,owner:'player'});assert.equal(scene.getObjectByName('GroundWarning'),undefined);assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().warnings.active,0);
 vfx.emit('warning',{x:3,z:3,r:2,life:3,owner:'enemy',warningId:'enemy-only'});vfx.emit('cancel-cast');assert.equal(vfx.getStats().effects,0);assert.equal(vfx.getStats().warnings.active,1);assert.equal(vfx.getStats().warnings.warnings[0].warningId,'enemy-only');
 vfx.emit('warning-cancel',{warningId:'unrelated'});assert.equal(vfx.getStats().warnings.active,1);vfx.emit('warning-cancel',{warningId:'enemy-only'});assert.equal(vfx.getStats().warnings.active,0);vfx.release();
});
test('charged attack plays multiple actual source frames at existing impact time',async()=>{const {vfx}=await make(),events=[];const g=new Game((t,d)=>{events.push({t,time:g.time});vfx.emit(t,d)});g.start('swordsman');g.enemies=[];g.skill(0,{x:0,z:1});for(let i=0;i<62;i++){g.update(1/60);vfx.update(1/60,{world:g})}assert.ok(events.find(e=>e.t==='skill-impact').time>=1);const f0=vfx.getStats().frames.find(f=>f.tag==='ground-fissure').frame;for(let i=0;i<8;i++)vfx.update(1/60,{world:g});assert.ok(vfx.getStats().frames.find(f=>f.tag==='ground-fissure').frame>f0);vfx.release()});
test('skill event occurs only for successful cast; charge release never survives interrupt',()=>{
 const events=[],g=new Game((type,data)=>events.push({type,data}));g.start('swordsman');g.enemies=[];
 assert.equal(g.skill(0,{x:0,z:1}),true);assert.equal(g.skill(0,{x:0,z:1}),false);
 assert.equal(events.filter(e=>e.type==='skill').length,1);
 g.applyControl(g.player,{stun:.1});for(let i=0;i<70;i++)g.update(1/60);
 assert.equal(events.filter(e=>e.type==='skill-impact').length,0);assert.equal(events.filter(e=>e.type==='cancel-cast').length,1);
});
test('real charged strike and jump secondary present at their existing combat times',()=>{
 const events=[],g=new Game((type,data)=>events.push({type,data,time:g.time}));g.start('swordsman');g.enemies=[];
 g.skill(0,{x:0,z:1});for(let i=0;i<61;i++)g.update(1/60);
 const impact=events.find(e=>e.type==='skill-impact');assert.ok(impact.time>=1&&impact.time<1.02);
 events.length=0;g.cast=0;g.skill(2,{x:0,z:1});for(let i=0;i<16;i++)g.update(1/60);
 assert.equal(events.filter(e=>e.type==='skill-impact'&&e.data.index===2).length,1);
});


test('skills use distinct semantic assets while danger keeps original footprint and cloak loops sustained frames',async()=>{const {vfx}=await make();for(const role of ['swordsman','paladin','archer'])for(let index=0;index<3;index++)vfx.emit('skill',{role,index,x:0,z:0});const keys=vfx.getStats().frames.map(f=>f.key);assert.ok(keys.includes('semantic-seal'));assert.ok(keys.includes('semantic-frost'));assert.ok(keys.includes('semantic-arrows'));assert.equal(keys.includes('promare-storm'),false);vfx.reset();const world={running:true,player:{hp:10,x:0,z:0},invis:3};for(let i=0;i<80;i++){vfx.update(.05,{world});assert.equal(vfx.getStats().cloakWind.visible,true);assert.equal(vfx.getStats().cloakWind.wisps,3)}vfx.emit('warning',{owner:'enemy',x:0,z:0,r:2,life:1});assert.equal(vfx.getStats().warnings.active,1);assert.equal(vfx.getStats().warnings.warnings[0].shape,'circle');assert.equal(vfx.getStats().warnings.warnings[0].radius,2);assert.equal(vfx.getStats().frames.some(f=>f.tag==='warning'),false);vfx.release()});

import test from 'node:test';import assert from 'node:assert/strict';import {Game} from '../src/core.js';
function game(role){const events=[],g=new Game((type,data)=>events.push({type,data}));g.start(role);g.world.walls=[];g.enemies=[];g.player.x=g.player.z=0;g.aim={x:0,z:1};return {g,events}}
function tick(g,t){for(let left=t;left>1e-9;){const dt=Math.min(.01,left);g.update(dt);left-=dt}}
test('all successful skills retain their minimum presentation against held basic attack without locking movement',()=>{
 for(const role of ['swordsman','paladin','archer'])for(let index=0;index<3;index++){const {g,events}=game(role);assert.ok(g.skill(index,{x:0,z:1}));assert.ok(g.attackLock>=.5);const x=g.player.x;g.input={x:1,z:0};for(let i=0;i<49;i++){assert.equal(g.attack(true),false);g.update(.01)}assert.equal(events.filter(e=>e.type==='swing').length,0);if(!(role==='swordsman'&&index===0))assert.ok(g.player.x>x,'visual presentation must not add a movement lock');const until=role==='swordsman'&&index===0?1.4:role==='archer'&&index===2?.65:.5;tick(g,until-.49);assert.ok(g.attack(true),role+':'+index+' should release basic lock after cue duration')}
});
test('charged slash release holds authority lock for .4 seconds and is not replaced by basic on same tick',()=>{
 const {g,events}=game('swordsman');g.skill(0);tick(g,1);assert.equal(events.filter(e=>e.type==='skill-impact').length,1);assert.ok(g.attackLock>=.4-1e-8);assert.equal(g.attack(true),false);tick(g,.39);assert.equal(g.attack(true),false);tick(g,.01);assert.ok(g.attack(true))
});
test('failed resource cooldown or direction skill requests add no presentation lock',()=>{
 for(const why of ['resource','cooldown','direction']){const {g}=game('swordsman');if(why==='resource')g.player.mp=0;if(why==='cooldown')g.cool[1]=2;assert.equal(g.skill(1,why==='direction'?{x:0,z:0}:{x:0,z:1}),false);assert.equal(g.attackLock,0);assert.ok(g.attack(true))}
});
test('control still cancels charged release so the later animation lock cannot resurrect',()=>{
 const {g,events}=game('swordsman');g.skill(0);tick(g,.2);g.applyControl(g.player,{stun:.01});tick(g,1.3);assert.equal(events.filter(e=>e.type==='skill-impact').length,0);assert.equal(g.cast,0);assert.equal(g.attackLock,0)
});

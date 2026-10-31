import test from 'node:test';import assert from 'node:assert/strict';import {Game} from '../src/core.js';
function game(role){const events=[],g=new Game((type,data)=>events.push({type,data}));g.start(role);g.world.walls=[];g.enemies=[];g.bots=[];g.cool[2]=0;g.player.x=g.player.z=0;g.aim={x:0,z:1};return {g,events}}
function tick(g,t){for(let left=t;left>1e-9;){const dt=Math.min(.01,left);g.update(dt);left-=dt}}
test('skills allow rapid followup after0.03seconds while charged slash and wind retain their actual cast sequence',()=>{
 for(const role of ['swordsman','paladin','archer'])for(let index=0;index<3;index++){const {g,events}=game(role);assert.ok(g.skill(index,{x:0,z:1}));const until=role==='swordsman'&&index===0?1.03:role==='archer'&&index===2?.65:.03;assert.ok(Math.abs(g.attackLock-(role==='archer'&&index===2?.65:.03))<1e-8);const x=g.player.x;g.input={x:1,z:0};for(let left=until-.001;left>1e-9;){assert.equal(g.attack(true),false);const dt=Math.min(.001,left);g.update(dt);left-=dt}assert.equal(events.filter(e=>e.type==='swing').length,0);assert.equal(g.attack(true),false);tick(g,.001);if(!(role==='swordsman'&&index===0))assert.ok(g.player.x>x,'skill followup timing must not add a movement lock');assert.ok(g.attack(true),role+':'+index+' should permit basic after actual action ends');assert.equal(g.attack(true),false,'basic cooldown still prevents duplicate release')}
});
test('charged slash holds its one-second charge then permits a basic after0.03second release without duplicate damage',()=>{
 const {g,events}=game('swordsman');g.skill(0);tick(g,.99);assert.equal(events.filter(e=>e.type==='skill-impact').length,0);assert.equal(g.attack(true),false);tick(g,.01);assert.equal(events.filter(e=>e.type==='skill-impact').length,1);assert.ok(Math.abs(g.attackLock-.03)<1e-8);assert.equal(g.attack(true),false);tick(g,.02);assert.equal(g.attack(true),false);tick(g,.01);assert.ok(g.attack(true));tick(g,.1);assert.equal(events.filter(e=>e.type==='skill-impact').length,1)
});
test('failed resource cooldown or direction skill requests add no presentation lock',()=>{
 for(const why of ['resource','cooldown','direction']){const {g}=game('swordsman');if(why==='resource')g.player.mp=0;if(why==='cooldown')g.cool[1]=2;assert.equal(g.skill(1,why==='direction'?{x:0,z:0}:{x:0,z:1}),false);assert.equal(g.attackLock,0);assert.ok(g.attack(true))}
});
test('control still cancels charged release so the later animation lock cannot resurrect',()=>{
 const {g,events}=game('swordsman');g.skill(0);tick(g,.2);g.applyControl(g.player,{stun:.01});tick(g,1.3);assert.equal(events.filter(e=>e.type==='skill-impact').length,0);assert.equal(g.cast,0);assert.equal(g.attackLock,0)
});

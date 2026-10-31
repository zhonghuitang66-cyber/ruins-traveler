import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationClock} from '../src/simulation-clock.js';
import {Game} from '../src/core.js';

test('30/60/144Hz render schedules advance identical fixed combat ticks',()=>{
 const states=[];
 for(const hz of [30,60,144]){
  const g=new Game();g.start('archer');g.enemies=[];g.player.x=-76;g.player.z=50;g.input={x:0,z:1};g.cool[0]=5;g.player.mp=30;
  let ticks=0;
  const clock=createSimulationClock(dt=>{ticks++;assert.equal(dt,1/60);g.update(dt)});
  for(let i=0;i<hz*2;i++)clock.advance(1/hz);
  states.push({ticks,time:g.time,z:g.player.z,mp:g.player.mp,cool:g.cool[0]});
 }
 assert.deepEqual(states[0],states[1]);assert.deepEqual(states[1],states[2]);assert.equal(states[0].ticks,120);
});
test('pause/resume discards partial and background time; stalls stay bounded',()=>{
 let ticks=0;const clock=createSimulationClock(()=>{ticks++});
 assert.equal(clock.advance(.01),0);clock.advance(300,false);
 assert.equal(clock.advance(.01),0);assert.equal(clock.advance(.007),1);
 assert.equal(clock.advance(20),3);assert.equal(ticks,4);
 clock.reset();assert.equal(clock.advance(.01),0);
});
test('terminal step stops remaining frame work and invalid intervals cannot corrupt clock',()=>{
 let ticks=0;const clock=createSimulationClock(()=>{ticks++;return false});
 assert.equal(clock.advance(.05),1);assert.equal(ticks,1);
 for(const bad of [NaN,Infinity,-1,0])assert.equal(clock.advance(bad),0);
 assert.equal(clock.advance(1/60),1);assert.equal(ticks,2);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {Game} from '../src/core.js';import {ATTACK_RELEASE_PHASE,attackTiming} from '../src/attack-timing.js';
function fixture(role='swordsman'){const events=[],g=new Game((type,data)=>events.push({type,data,time:g.time}));g.start(role);g.world.walls=[];g.enemies=[];g.bots=[];g.player.x=g.player.z=0;g.aim={x:0,z:1};return {g,events}}
function tick(g,t){for(let left=t;left>1e-10;){const dt=Math.min(.01,left);g.update(dt);left-=dt}}
function target(g,x=0,z=1.5){const e=g.enemy({x,z,type:'sword',zone:0});e.stun=99;g.enemies.push(e);return e}
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-6,`${x} != ${y}`);

test('each class starts its animation and CD immediately but only releases at its own cue once',()=>{
 for(const role of ['swordsman','paladin','archer']){const {g,events}=fixture(role),e=target(g,0,role==='archer'?6:1.5);assert.ok(g.attack(true));const start=events.find(e=>e.type==='swing');near(start.data.duration,g.stats.interval);near(start.data.impactDelay,g.stats.interval*ATTACK_RELEASE_PHASE[role]);near(g.autoCd,start.data.duration);assert.equal(g.shots.length,0);assert.equal(e.hp,e.maxHp);assert.equal(g.attack(true),false);tick(g,start.data.impactDelay-.001);assert.equal(e.hp,e.maxHp);assert.equal(g.shots.length,0);assert.equal(events.filter(e=>e.type==='attack-impact').length,0);tick(g,.001);assert.equal(events.filter(e=>e.type==='attack-impact').length,1);const impact=events.find(e=>e.type==='attack-impact');assert.equal(impact.data.attackId,start.data.attackId);if(role==='archer')assert.equal(g.shots.length,1);else assert.ok(e.hp<e.maxHp);tick(g,.1);assert.equal(events.filter(e=>e.type==='attack-impact').length,1)}
 assert.equal(attackTiming('missing',1),null);assert.equal(attackTiming('swordsman',NaN),null)
});
test('movement during windup changes actual release origin while locked attack direction cannot overwrite movement aim',()=>{
 const {g,events}=fixture();const delay=g.stats.interval*.5,e=target(g,3*delay,1.5);g.attack(true);g.input={x:1,z:0};tick(g,delay);const impact=events.find(e=>e.type==='attack-impact');near(impact.data.x,g.player.x);near(impact.data.x,3*delay);assert.equal(impact.data.dx,0);assert.equal(impact.data.dz,1);assert.deepEqual(g.aim,{x:1,z:0});assert.ok(e.hp<e.maxHp,'must hit locked +Z from moved origin, not movement +X')
});
test('wall visibility is checked at release and melee cannot damage across a newly blocking wall',()=>{
 const {g,events}=fixture(),e=target(g);g.attack(true);g.world.walls=[{x:0,z:.8,w:10,d:.3}];tick(g,g.pendingAttack.impactDelay);assert.equal(e.hp,e.maxHp);assert.equal(events.filter(e=>e.type==='attack-impact').length,1)
});
test('brief stun, knockup and directly set control cancel unreleased attack exactly once without spending frost',()=>{
 for(const how of ['stun','knockup','direct']){const {g,events}=fixture('archer');g.frost=5;g.frostCharges=2;g.attack(true);tick(g,.1);if(how==='direct')g.player.stun=.001;else g.applyControl(g.player,{[how]:.001});tick(g,1);assert.equal(g.shots.length,0);near(g.frost,3.9);assert.equal(g.frostCharges,2);assert.equal(events.filter(e=>e.type==='attack-cancel').length,1);assert.equal(events.filter(e=>e.type==='attack-impact').length,0)}
});
test('successful active skills and dodge cancel windup, failed skill requests leave it pending',()=>{
 for(const action of ['skill','dodge']){const {g,events}=fixture('paladin');g.thunder=3;g.thunderExpire=8;g.attack(true);assert.ok(action==='skill'?g.skill(0):g.jump());assert.equal(g.thunder,3);tick(g,.8);assert.equal(events.filter(e=>e.type==='attack-cancel').length,1);assert.equal(events.filter(e=>e.type==='attack-impact').length,0);assert.equal(events.filter(e=>e.type==='thunder-mark').length,0)}
 const {g,events}=fixture();g.attack(true);g.player.mp=0;assert.equal(g.skill(1),false);assert.ok(g.pendingAttack);tick(g,.5);assert.equal(events.filter(e=>e.type==='attack-cancel').length,0);assert.equal(events.filter(e=>e.type==='attack-impact').length,1)
});
test('death, finish and start isolate pending attacks and IDs stay unique across a restart',()=>{
 for(const action of ['death','finish','start']){const {g,events}=fixture('archer');g.attack(true);const old=events.find(e=>e.type==='swing').data.attackId;if(action==='death')g.hurt(g.player,99999);else if(action==='finish')g.finish(false);else g.start('archer');assert.equal(events.filter(e=>e.type==='attack-cancel').length,1);tick(g,1);assert.equal(events.filter(e=>e.type==='attack-impact'&&e.data.attackId===old).length,0);assert.equal(g.shots.length,0);g.start('archer');g.enemies=[];g.world.walls=[];g.attack(true);assert.ok(events.filter(e=>e.type==='swing').at(-1).data.attackId>old);tick(g,g.pendingAttack.impactDelay);assert.equal(events.filter(e=>e.type==='attack-impact').length,1)}
});
test('an already released arrow survives later skill use or player control and retains its lifetime',()=>{
 const {g}=fixture('archer');g.attack(true);tick(g,g.pendingAttack.impactDelay);const shot=g.shots[0],life=shot.life;assert.ok(g.skill(1));g.applyControl(g.player,{stun:.1});tick(g,.1);assert.ok(g.shots.includes(shot));assert.ok(shot.life<life);assert.equal(shot.frost,false);near(g.frost,4.9);assert.equal(g.frostCharges,2)
});
test('full shot pool retains two frost enhancements and successful primary consumes only one then releases extras',()=>{
 const {g}=fixture('archer');g.frost=5;g.frostCharges=2;for(let i=0;i<40;i++)assert.ok(g.projectile(g.player,{x:0,z:1},1,{speed:1,range:100}));g.attack(true);assert.equal(g.frostCharges,2);tick(g,g.pendingAttack.impactDelay);assert.equal(g.shots.length,40);assert.equal(g.frostCharges,2);assert.ok(g.frost>4);g.shots=[];g.autoCd=0;g.attack(true);assert.equal(g.frostCharges,2);tick(g,g.pendingAttack.impactDelay);assert.equal(g.shots.length,1);assert.equal(g.shots[0].frost,false);assert.equal(g.frostCharges,1);tick(g,.3);assert.equal(g.shots.filter(s=>s.frost).length,1);tick(g,.3);assert.equal(g.shots.filter(s=>s.frost).length,2);assert.equal(g.frostCharges,1)
});

test('thunder dash, marks and charges occur only on release at current wall-clipped position',()=>{
 const {g,events}=fixture('paladin');g.skill(1);assert.equal(g.attack(true),false);tick(g,.5);g.attack(true);assert.equal(g.thunder,3);assert.equal(g.player.z,0);assert.equal(g.thunderMarks.length,0);g.world.walls=[{x:0,z:1.1,w:10,d:.4}];tick(g,g.pendingAttack.impactDelay);assert.equal(g.thunder,2);assert.equal(g.thunderMarks.length,1);assert.ok(g.player.z>=0&&g.player.z<.8);const impact=events.find(e=>e.type==='attack-impact');near(impact.data.z,g.player.z);assert.equal(events.filter(e=>e.type==='displacement').length,1);
 const expired=fixture('paladin');expired.g.thunder=3;expired.g.thunderExpire=.1;expired.g.attack(true);tick(expired.g,.6);assert.equal(expired.g.thunderMarks.length,0);assert.equal(expired.events.filter(e=>e.type==='displacement').length,0)
});
test('duration and impact timing lock the start-time haste snapshot even when buffs expire during windup',()=>{
 const {g,events}=fixture('archer');g.speedBuff=.02;g.invis=.02;const duration=.7/1.4/1.3;g.attack(true);near(g.autoCd,duration);const pending=g.pendingAttack;near(pending.impactDelay,duration*.5);tick(g,pending.impactDelay-.001);assert.equal(g.invis,0);assert.equal(g.speedBuff,0);assert.equal(g.shots.length,0);tick(g,.001);near(events.find(e=>e.type==='attack-impact').time,pending.impactAt);near(events.find(e=>e.type==='attack-impact').data.duration,duration);tick(g,duration);g.attack(true);near(g.pendingAttack.duration,.7)
});
test('invalid time steps do not release early and invalid player coordinates cannot lock an attack',()=>{
 const {g,events}=fixture();g.attack(true);for(const dt of [0,-1,NaN,Infinity])g.update(dt);assert.equal(g.time,0);assert.equal(events.filter(e=>e.type==='attack-impact').length,0);g.update(100);near(g.time,.05);assert.ok(g.pendingAttack);const bad=fixture().g;bad.player.x=NaN;assert.equal(bad.attack(true),false);assert.equal(bad.autoCd,0)
});

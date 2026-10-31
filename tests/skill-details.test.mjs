import test from 'node:test';import assert from 'node:assert/strict';
import {Game} from '../src/core.js';
function fixture(kind='paladin'){const events=[],g=new Game((type,data)=>events.push({type,data}));g.start(kind);g.world.walls=[];g.enemies=[];g.player.x=0;g.player.z=0;g.aim={x:1,z:0};return {g,events}}
function tick(g,seconds){let remaining=seconds;while(remaining>1e-9){const dt=Math.min(.05,remaining);g.update(dt);remaining-=dt}}
const almost=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);

test('thunder records three distinct impact points and only third adds magic damage',()=>{
 const {g,events}=fixture(),e=g.enemy({x:7.5,z:0,type:'sword',zone:4});g.enemies=[e];
 assert.equal(g.skill(1,{x:1,z:0}),true);assert.equal(g.thunderMarks.length,0);
 e.stun=99;tick(g,.5);g.attack(true);assert.equal(g.thunderMarks.length,0);tick(g,g.pendingAttack.impactDelay);assert.equal(e.hp,e.maxHp);assert.equal(g.thunderMarks.length,1);almost(g.thunderMarks[0].x,2.8);
 g.autoCd=0;g.attack(true);tick(g,g.pendingAttack.impactDelay);assert.equal(e.hp,e.maxHp);assert.equal(g.thunderMarks.length,2);
 g.autoCd=0;g.attack(true);tick(g,g.pendingAttack.impactDelay);assert.equal(e.hp,e.maxHp-Math.round(g.stats.atk*1.8*100/105));
 assert.equal(g.thunder,0);assert.equal(g.thunderMarks.length,0);assert.equal(g.thunderHistory.length,3);
 assert.deepEqual(g.thunderHistory.map(m=>m.index),[1,2,3]);almost(g.thunderHistory[2].x,4.4);assert.equal(events.filter(e=>e.type==='thunder-mark').length,3);
});
test('unused thunder marks expire without a delayed explosion',()=>{
 const {g,events}=fixture();g.skill(1);tick(g,.5);g.attack(true);tick(g,g.pendingAttack.impactDelay);assert.equal(g.thunderMarks.length,1);tick(g,8.1);
 assert.equal(g.thunder,0);assert.deepEqual(g.thunderMarks,[]);assert.equal(events.filter(e=>e.type==='thunder-mark').length,1);
});
test('regeneration starts at .5 seconds, applies exactly 24 ticks and ends at 12 seconds',()=>{
 const {g,events}=fixture();g.player.hp=1;g.skill(2);tick(g,.49);assert.equal(g.player.hp,1);tick(g,.01);
 let expected=1;expected+=540*(.01+.03*(1-expected/540));almost(g.player.hp,expected);
 tick(g,11.5);for(let i=1;i<24;i++)expected+=Math.min(540-expected,540*(.01+.03*(1-expected/540)));
 almost(g.player.hp,expected);assert.equal(events.filter(e=>e.type==='number'&&e.data.type==='heal').length,24);assert.equal(g.healing,0);
 const hp=g.player.hp;tick(g,.5);almost(g.player.hp,hp);
});
test('regeneration scales with missing health, cannot overflow, and has 20 percent movement bonus',()=>{
 const low=fixture().g,high=fixture().g;low.player.hp=40;high.player.hp=500;low.skill(2);high.skill(2);tick(low,.5);tick(high,.5);assert.ok(low.player.hp-40>high.player.hp-500);
 const full=fixture().g;full.player.hp=539;full.skill(2);full.input={x:1,z:0};tick(full,.5);assert.equal(full.player.hp,540);almost(full.player.x,1.8);
});
test('stun and knockup each immediately interrupt regeneration and prevent future heal ticks',()=>{
 for(const control of [{stun:.1},{knockup:.1}]){const {g}=fixture();g.player.hp=100;g.skill(2);tick(g,.5);const hp=g.player.hp;g.applyControl(g.player,control);assert.equal(g.healing,0);tick(g,1);almost(g.player.hp,hp)}
 const {g}=fixture();g.player.hp=100;g.skill(2);g.player.knockup=.1;tick(g,.7);assert.equal(g.healing,0);assert.equal(g.player.hp,100);
});
test('frost caps ten independent marks, fifty percent slow and five MP drain ticks per mark',()=>{
 const {g}=fixture('archer'),e=g.enemy({x:20,z:0,type:'mage',zone:4});e.mp=100;g.enemies=[e];
 for(let i=0;i<10;i++)assert.equal(g.applyFrost(e),true);assert.equal(g.applyFrost(e),false);assert.equal(e.frostMarks.length,10);assert.equal(g.frostMovementScale(e),.5);
 tick(g,.99);assert.equal(e.mp,100);tick(g,.01);assert.equal(e.mp,90);tick(g,2);assert.equal(e.mp,70);assert.equal(e.frostMarks.length,10);tick(g,2);assert.equal(e.mp,50);assert.equal(e.frostMarks.length,0);assert.equal(e.slow.length,0);assert.equal(g.frostMovementScale(e),1);
});
test('staggered frost applications keep their own five-second expiry and MP schedule',()=>{
 const {g}=fixture('archer'),e=g.enemy({x:20,z:0,type:'mage',zone:4});e.mp=100;g.enemies=[e];g.applyFrost(e);tick(g,1.5);g.applyFrost(e);tick(g,1.5);
 assert.equal(e.frostMarks.length,2);assert.equal(e.mp,96);tick(g,2);assert.equal(e.frostMarks.length,1);assert.equal(e.mp,92);tick(g,1.5);assert.equal(e.frostMarks.length,0);assert.equal(e.mp,90);
});
test('frost without MP only slows and mana never becomes negative',()=>{
 const {g}=fixture('archer'),e=g.enemy({x:20,z:0,type:'spear',zone:4});g.enemies=[e];g.applyFrost(e);tick(g,1);assert.equal(Object.hasOwn(e,'mp'),false);assert.equal(e.slow.length,1);
 e.mp=.5;tick(g,1);assert.equal(e.mp,0);tick(g,3);assert.equal(e.slow.length,0);
});
test('frost window empowers two basics with normal primaries plus four extra damage arrows',()=>{
 const {g,events}=fixture('archer'),e=g.enemy({x:1,z:0,type:'sword',zone:4});e.hp=e.maxHp=1000;e.stun=99;g.enemies=[e];g.skill(1,{x:1,z:0});assert.equal(g.shots.length,0);assert.equal(g.frost,5);assert.equal(g.frostCharges,2);
 tick(g,.5);g.attack(true);assert.equal(g.frostCharges,2);assert.equal(g.shots.length,0);tick(g,g.pendingAttack.impactDelay-.001);assert.equal(g.shots.length,0);tick(g,.001);assert.equal(g.frostCharges,1);assert.equal(g.shots[0].frost,false);tick(g,.05);const normal=Math.round(40*100/112),magic=Math.round(40*.35*100/105);assert.equal(e.hp,1000-normal);assert.equal(e.frostMarks.length,0);tick(g,.6);assert.equal(e.hp,1000-3*normal-2*magic);assert.equal(e.frostMarks.length,2);assert.equal(events.filter(r=>r.type==='frost-volley').length,2);
 g.autoCd=0;g.attack(true);tick(g,g.pendingAttack.impactDelay);assert.equal(g.frostCharges,0);tick(g,.65);assert.equal(events.filter(r=>r.type==='frost-volley').length,4);assert.equal(e.frostMarks.length,4);assert.equal(e.hp,1000-6*normal-4*magic);assert.ok(g.frost>0);
});

test('wind volleys fire three arrows at 0/.3/.6 and cloak starts after final volley',()=>{
 const {g,events}=fixture('archer');g.skill(2,{x:1,z:0});assert.equal(g.shots.length,3);assert.equal(g.invis,0);assert.equal(g.skill(0),false);
 tick(g,.25);assert.equal(g.shots.length,3);tick(g,.05);assert.equal(g.shots.length,6);assert.equal(g.invis,0);
 tick(g,.3);assert.equal(g.shots.length,9);almost(g.invis,3);assert.equal(g.windActive,false);const rounds=events.filter(e=>e.type==='wind-volley');assert.deepEqual(rounds.map(e=>e.data.round),[1,2,3]);rounds.forEach((e,i)=>almost(e.data.at,i*.3));
 g.input={x:1,z:0};tick(g,.1);almost(g.player.x,.36);g.input={x:0,z:0};tick(g,2.9);assert.ok(g.invis<1e-8);
});
test('brief wind stun/knockup cancels remaining waves and cannot grant a delayed cloak',()=>{
 for(const control of [{stun:.1},{knockup:.1}]){const {g,events}=fixture('archer');g.skill(2);tick(g,.15);g.applyControl(g.player,control);tick(g,.55);assert.equal(events.filter(e=>e.type==='wind-volley').length,1);assert.equal(g.invis,0);assert.equal(g.windActive,false)}
 const {g,events}=fixture('archer');g.skill(2);g.player.stun=.1;tick(g,.7);assert.equal(events.filter(e=>e.type==='wind-volley').length,1);assert.equal(g.invis,0);
});
test('death cancels wind sequence and offensive skill explicitly breaks an existing cloak',()=>{
 const {g,events}=fixture('archer');g.skill(2);g.hurt(g.player,99999);tick(g,1);assert.equal(events.filter(e=>e.type==='wind-volley').length,1);assert.equal(g.invis,0);assert.equal(g.windActive,false);
 const other=fixture('archer').g;other.invis=3;other.skill(0);assert.equal(other.invis,0);
});

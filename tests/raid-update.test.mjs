import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,blocked,move,dist,lineClear} from '../src/core.js';
import {resetRaid,tickRaid,repairPlayerPosition,RAID_SECONDS} from '../src/raid-rules.js';
import {prepareSynthesis,preparePotionPurchase} from '../src/raid-interactions.js';
import {captureRaid,restoreRaid,createRaidCheckpoint} from '../src/raid-checkpoint.js';
import {rollEquipment} from '../src/equipment.js';

test('four distinct corners, three bots, initial paladin ultimate cooldown',()=>{
 const seen=new Set();for(let i=0;i<4;i++){const g=new Game();g.start('paladin');resetRaid(g,()=>i/4+.01);seen.add(`${g.player.x},${g.player.z}`);assert.equal(g.bots.length,3);assert.ok(g.bots.every(b=>dist(b,g.player)>100));assert.equal(g.cool[2],70)}assert.equal(seen.size,4);
});
test('queued hunters depart only one per minute even after large time advance',()=>{
 const g=new Game();g.start();g.enemies=g.bots;g.time=180;tickRaid(g,.05,{move,dist,lineClear});assert.equal(g.bots.filter(b=>b.state==='hunt').length,1);
 g.time=239;tickRaid(g,.05,{move,dist,lineClear});assert.equal(g.bots.filter(b=>b.state==='hunt').length,1);
 g.time=240;tickRaid(g,.05,{move,dist,lineClear});assert.equal(g.bots.filter(b=>b.state==='hunt').length,2);
 g.time=300;tickRaid(g,.05,{move,dist,lineClear});assert.equal(g.bots.filter(b=>b.state==='hunt').length,3);
});
test('8 minute timeout removes bag and equipment; initial blue exit is legal',()=>{
 const g=new Game();g.start();g.enemies=[];g.bots=[];g.bag=[{id:'ruby_heart',n:1}];g.time=RAID_SECONDS-.02;g.update(.05);assert.equal(g.running,false);assert.deepEqual(g.bag,[]);
});
test('invalid/outside player coordinates recover into a walkable legal position',()=>{
 const g=new Game();g.start();Object.assign(g.player,{x:NaN,z:900});assert.equal(repairPlayerPosition(g,{blocked}),true);assert.equal(blocked(g.player.x,g.player.z,.48,g.world.walls),false);assert.ok(Number.isFinite(g.player.x));
});
test('every boss warning phase has a full three second charge with no early hit',()=>{
 for(let skill=0;skill<3;skill++){const events=[],g=new Game((type,data)=>events.push({type,...data}));g.start();g.bots=[];const b=g.enemies.find(e=>e.type==='boss');g.enemies=[b];g.player.x=2;g.player.z=0;b.aggro=true;b.skill=skill;g.bossAction(b);const hp=g.player.hp;for(let i=0;i<59;i++)g.update(.05);assert.equal(g.player.hp,hp);assert.ok(events.filter(e=>e.type==='warning'&&e.bossId).every(e=>e.life===3))}
});
test('synthesis reserves only two units, immutable preparation, red cap, empty result',()=>{
 const g=new Game();g.start();g.bag=[{id:'ruby_heart',n:2},{id:'scrap',n:3}];const c=g.world.chests.find(c=>c.type==='synthesis'),before=structuredClone(g.bag);
 const r=prepareSynthesis(g,c,[0,1],{rng:()=>0});assert.equal(r.ok,true);assert.deepEqual(g.bag,before);assert.equal(r.rarity,'red');assert.equal(r.bag.reduce((n,r)=>n+r.n,0),3);assert.ok(r.output);
 const fail=prepareSynthesis(g,c,[0,1],{rng:()=>.9});assert.equal(fail.output,null);assert.equal(prepareSynthesis(g,c,[0,0]).ok,false);
});
test('potion purchase uses five times price, no live mutation, capacity and balance guards',()=>{
 const g=new Game();g.start();const c=g.world.chests.find(c=>c.type==='apothecary');g.bag=[{id:'coin',n:60}];const r=preparePotionPurchase(g,c,'health');assert.equal(r.ok,true);assert.equal(r.price,60);assert.ok(r.bag.some(r=>r.id==='health'));assert.equal(g.bag[0].n,60);g.bag=[];assert.equal(preparePotionPurchase(g,c,'health').reason,'insufficient_coins');
});
test('checkpoint serializes active AI references and restores once-consumed craft state',()=>{
 const g=new Game();g.start();g.enemies[0].combatTarget=g.player;g.bots[0].botWindup={target:g.enemies[0]};const c=g.world.chests.find(c=>c.type==='synthesis');c.craft={output:{id:'ruby_heart',n:1},readyAt:3};g.bag=[];
 const data=captureRaid(g,'raid-test');let saved=null;const store=createRaidCheckpoint({getItem(){return saved},setItem(k,v){saved=v}});assert.equal(store.write(data),true);const h=new Game();h.start();assert.equal(restoreRaid(h,store.read()),true);assert.deepEqual(h.bag,[]);assert.equal(h.world.chests.find(c=>c.type==='synthesis').craft.output.id,'ruby_heart');assert.equal(h.events.length,0);
 const failing=createRaidCheckpoint({setItem(){throw Error('full')}});assert.equal(failing.write(data),false);
});
test('new equipment stats and effects are applied in the live game',()=>{
 const g=new Game();g.start('paladin',{loadout:{chest:rollEquipment('guardian_robe'),boots:rollEquipment('burst_boots')}});assert.ok(g.stats.hp>540);g.player.hp=200;const before=g.player.hp;assert.equal(g.skill(0),true);assert.ok(g.player.hp<before);assert.equal(g.burstSpeedUntil,5);assert.equal(g.skill(0),false);
 const h=new Game();h.start('archer',{loadout:{weapon:rollEquipment('ruin_pearl'),boots:rollEquipment('blink_boots')}});assert.ok(h.stats.matk>=5);h.jump();assert.equal(h.dodge.speed,4/.18);
});

test('cross-class recovery uses saved class stats and closed journal retains unsaved extraction',()=>{
 const archer=new Game();archer.start('archer');const data=captureRaid(archer,'class-recovery');const other=new Game();other.start('paladin');assert.equal(restoreRaid(other,data),true);assert.equal(other.stats.hp,340);assert.equal(other.kind,'archer');
 let saved=null;const store=createRaidCheckpoint({getItem(){return saved},setItem(k,v){saved=v}});const pending={id:'class-recovery',bag:[{id:'ruby_heart',n:1}],value:1000};assert.equal(store.close('class-recovery',[],pending),true);assert.deepEqual(store.read().pendingSettlement,pending);
});

test('corrupt enemy or world shape cannot replace the live game',()=>{const g=new Game();g.start();const data=captureRaid(g,'bad-shape'),before=g.player;data.enemies=[null];assert.equal(restoreRaid(g,data),false);assert.equal(g.player,before);data.enemies=[];delete data.world.chests;assert.equal(restoreRaid(g,data),false)});

test('control cancels bot windup and oversized bot loot is conserved in overflow containers',()=>{const g=new Game();g.start();const b=g.bots[0];b.botWindup={target:g.player,at:1};g.applyControl(b,{stun:1});assert.equal(b.botWindup,null);b.inventory=Array.from({length:8},()=>({id:'crimson_orrery',n:1}));b.equipment={};g.hurt(b,10000);assert.equal(g.packs.filter(p=>p.type==='bot').flatMap(p=>p.items).reduce((n,r)=>n+r.n,0),8)});

test('boss cannot damage colocated bots and retains recovery after its three charged pulses',()=>{const g=new Game();g.start();const boss=g.enemies.find(e=>e.type==='boss'),bot=g.bots[0];g.bots=[bot];g.enemies=[boss,bot];Object.assign(bot,{x:0,z:1,stun:100});Object.assign(g.player,{x:1,z:0,hp:100000});boss.aggro=true;boss.skill=2;g.bossAction(boss);const hp=bot.hp;for(let i=0;i<181;i++)g.update(.05);assert.equal(bot.hp,hp);assert.ok(boss.cd>2.8);assert.equal(boss.bossActionId,null)});

test('blue speed potion applies 10 percent for 15 game seconds and cannot leak into the next run',()=>{const g=new Game();g.start();g.bots=[];g.enemies=[];Object.assign(g.player,{x:0,z:20});g.bag=[{id:'speed_potion',n:1}];assert.equal(g.use('speed_potion').ok,true);assert.equal(g.speedPotionUntil,15);g.input={x:1,z:0};for(let i=0;i<10;i++)g.update(.05);assert.ok(Math.abs(g.player.x-1.65)<1e-7);g.start();assert.equal(g.speedPotionUntil,0);assert.equal(g.burstSpeedUntil,0)});

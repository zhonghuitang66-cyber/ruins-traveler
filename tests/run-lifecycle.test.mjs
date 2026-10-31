import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/core.js';
import {createWarehouseStore,WAREHOUSE_SAVE_KEY} from '../src/inventory.js';
import {rollEquipment} from '../src/equipment.js';
import {createRaidCheckpoint,captureRaid} from '../src/raid-checkpoint.js';
import {enterCampRaid,abandonCampRaid} from '../src/run-lifecycle.js';
import {parseMinimumCellValue,cleanSettings} from '../src/preferences.js';

function fixture(){const rows=new Map();let blocked=false;const storage={getItem:k=>rows.get(k)??null,setItem(k,v){if(blocked&&k===WAREHOUSE_SAVE_KEY)throw Error('quota');rows.set(k,v)}},store=createWarehouseStore({storage}),checkpoint=createRaidCheckpoint(storage),world=new Game();const sword=rollEquipment('rust_sword',{uid:'owned-sword',rarity:'blue',rng:()=>.3});assert.ok(store.settle('seed',[sword,{id:'health',n:5},{id:'mana',n:5},{id:'coin',n:100}]).ok);store.setCampEquipment('swordsman','weapon',sword.uid);store.setCampCargo('health',3);store.setCampCargo('mana',2);return {store,checkpoint,world,storage,sword,block:v=>blocked=v}}

test('saved camp equipment and five carried units move into battle and are lost on abandon',()=>{
 const f=fixture(),entered=enterCampRaid({...f,kind:'swordsman',idFactory:()=> 'run-1'});assert.ok(entered.ok);assert.equal(f.world.equipment.weapon.uid,f.sword.uid);assert.equal(f.world.bag.reduce((n,r)=>n+r.n,0),5);assert.equal(f.store.load().gear.length,0);assert.equal(f.store.load().items.health,2);f.world.finish(false,'abandon');assert.ok(abandonCampRaid({...f,id:'run-1'}).ok);assert.equal(f.store.load().expedition,null);assert.equal(f.store.load().gear.length,0);assert.deepEqual(f.world.bag,[]);assert.equal(f.checkpoint.read().state,'closed');
});
test('checkpoint and launch failures return reserved camp gear and cargo exactly once',()=>{
 for(const type of ['checkpoint','launch']){const f=fixture(),checkpoint=type==='checkpoint'?{read:()=>null,write:()=>false,close:()=>true}:f.checkpoint,store=type==='launch'?{...f.store,launchRun:()=>({ok:false,status:'write_failed'})}:f.store;assert.equal(enterCampRaid({...f,store,checkpoint,kind:'swordsman',idFactory:()=>type}).ok,false);const camp=f.store.load();assert.equal(camp.gear.length,1);assert.equal(camp.items.health,5);assert.equal(camp.items.mana,5);assert.equal(camp.expedition,null);assert.equal(f.world.running,false)}
});
test('crash after prepare/checkpoint resumes and launches the same reservation without duplication',()=>{
 const f=fixture(),prepared=f.store.prepareRun('recover','swordsman');f.world.start('swordsman',{loadout:prepared.expedition.loadout,cargo:prepared.expedition.cargo});f.checkpoint.write(captureRaid(f.world,'recover'));const entered=enterCampRaid({...f,kind:'archer'});assert.ok(entered.resumed);assert.equal(entered.id,'recover');assert.equal(f.world.kind,'swordsman');assert.equal(f.store.load().expedition.phase,'active');assert.equal(f.store.load().items.health,2);assert.equal(f.world.bag.reduce((n,r)=>n+r.n,0),5);
});
test('loss write failure persists an abandon intent and retries without refunding the lost loadout',()=>{
 const f=fixture();enterCampRaid({...f,kind:'swordsman',idFactory:()=> 'loss'});f.world.finish(false);f.block(true);assert.equal(abandonCampRaid({...f,id:'loss'}).ok,false);assert.equal(f.checkpoint.read().pendingAbandon,'loss');assert.equal(f.store.load().expedition.phase,'active');f.block(false);assert.ok(abandonCampRaid({...f,id:'loss'}).ok);assert.ok(abandonCampRaid({...f,id:'loss'}).ok);assert.equal(f.store.load().gear.length,0);assert.equal(f.store.load().items.health,2);
});
test('minimum cell value accepts only a positive safe decimal integer and defaults to forty',()=>{
 assert.equal(cleanSettings({}).minimumCellValue,40);for(const value of ['40','00042',1,9007199254740991])assert.ok(parseMinimumCellValue(value)>0);for(const value of ['','0','-1','+2','1.5','1e2',' 40 ','<script>40</script>',"40;DROP TABLE items",'9007199254740992',NaN,Infinity,null,{},true])assert.equal(parseMinimumCellValue(value),null);assert.equal(cleanSettings({minimumCellValue:'<img onerror=alert(1)>'}).minimumCellValue,40);
});

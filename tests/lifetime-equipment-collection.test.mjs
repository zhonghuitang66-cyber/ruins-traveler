import test from 'node:test';import assert from 'node:assert/strict';
import {rollEquipment,sanitizeItemRow,getEquipmentStats,equipmentSkillOutcome,equipmentBasicAttackBonus,BIG_RED_ITEMS,itemDimensions,sellPerCell} from '../src/equipment.js';
import {createWarehouseStore,WAREHOUSE_SAVE_KEY,parseWarehouseSave} from '../src/inventory.js';
const memory=()=>{const rows=new Map();return {fail:false,getItem:k=>rows.get(k)??null,setItem(k,v){if(this.fail)throw Error('quota');rows.set(k,v)}}};
test('unique equipment preserves fixed rarity and rolled ranges across serialization',()=>{
 for(const rng of [()=>0,()=>.999999])for(const id of ['blade_wind','guardian_robe','ruin_pearl','burst_boots','blink_boots']){
  const row=rollEquipment(id,{rng});assert.ok(row);assert.deepEqual(sanitizeItemRow(JSON.parse(JSON.stringify(row))),row);
  const stats=getEquipmentStats({[id.includes('boots')?'boots':id==='guardian_robe'?'chest':'weapon']:row},id==='ruin_pearl'?'archer':'swordsman');
  if(id==='guardian_robe'){assert.ok(stats.hpPercent>=.05&&stats.hpPercent<=.07);assert.ok(stats.mdef>=10&&stats.mdef<=22)}
  if(id.includes('boots'))assert.ok(stats.moveRating>0&&stats.moveRating<=30);
 }
 const row=rollEquipment('guardian_robe');row.baseRolls.hpPercent=.08;assert.equal(sanitizeItemRow(row),null);
});
test('equipment skill trigger heals once and explosive boots never spend final hit point',()=>{
 const equipment={chest:rollEquipment('guardian_robe'),boots:rollEquipment('burst_boots')};
 const result=equipmentSkillOutcome(equipment,'swordsman',{hp:50,maxHp:100});assert.equal(result.healed,1);assert.equal(result.healthCost,5);assert.equal(result.hp,46);assert.equal(result.speedDuration,5);
 assert.equal(equipmentSkillOutcome({boots:equipment.boots},'swordsman',{hp:1,maxHp:100}).hp,1);
 assert.equal(equipmentSkillOutcome(equipment,'swordsman',{hp:0,maxHp:100}).hp,0);
 assert.equal(equipmentBasicAttackBonus({weapon:rollEquipment('ruin_pearl')},'archer',0).magicDamage,1);
 assert.equal(equipmentBasicAttackBonus({weapon:rollEquipment('ruin_pearl')},'archer',20).magicDamage,6);
});
test('five big reds have required footprint and lower cell price than compact reds',()=>{
 assert.deepEqual(BIG_RED_ITEMS.map(id=>{const d=itemDimensions({id,n:1});return d.w*d.h}),[6,4,8,9,2]);
 for(const id of BIG_RED_ITEMS)assert.ok(sellPerCell({id,n:1})<sellPerCell({id:'ruby_heart',n:1}));
});
test('first kills persist reward and marker atomically, retry after failure, no reroll after reload',()=>{
 const storage=memory(),store=createWarehouseStore({storage});storage.fail=true;assert.equal(store.claimFirstKill('mage').status,'write_failed');assert.deepEqual(store.load().firstKills,[]);
 storage.fail=false;for(const type of ['mage','sword','spear','boss'])assert.equal(store.claimFirstKill(type,{rng:()=>0}).status,'rewarded');
 const before=storage.getItem(WAREHOUSE_SAVE_KEY);assert.equal(createWarehouseStore({storage}).claimFirstKill('boss').status,'duplicate');assert.equal(storage.getItem(WAREHOUSE_SAVE_KEY),before);
 const state=store.load();assert.equal(state.items.ruby_heart,1);assert.equal(state.items.sun_medallion,1);assert.equal(state.items.crimson_garden,1);assert.equal(state.gear[0].id,'blade_wind');assert.equal(state.gear[0].rarity,'purple');
});
test('collection transfers conserve red quantity, coins and gear; failure never consumes',()=>{
 const storage=memory(),store=createWarehouseStore({storage});store.settle('seed',[{id:'ruby_heart',n:2},{id:'coin',n:15},rollEquipment('blink_boots',{uid:'boots-red'})]);
 assert.equal(store.transferCollection('deposit','coin').status,'red_only');assert.equal(store.transferCollection('deposit','ruby_heart').ok,true);assert.equal(store.transferCollection('deposit','boots-red').ok,true);
 assert.equal(store.load().collection.length,2);assert.equal(store.load().items.ruby_heart,1);assert.equal(store.load().items.coin,15);assert.equal(store.load().gear.length,0);
 const before=storage.getItem(WAREHOUSE_SAVE_KEY);storage.fail=true;assert.equal(store.transferCollection('withdraw',0).status,'write_failed');assert.equal(storage.getItem(WAREHOUSE_SAVE_KEY),before);storage.fail=false;
 assert.equal(store.transferCollection('withdraw',1).ok,true);assert.equal(store.transferCollection('withdraw',0).ok,true);assert.equal(store.load().items.ruby_heart,2);assert.equal(store.load().gear[0].uid,'boots-red');assert.equal(store.load().collectionValue,0);
 const raw=JSON.parse(storage.getItem(WAREHOUSE_SAVE_KEY));raw.collection=[raw.gear[0]];assert.equal(parseWarehouseSave(JSON.stringify(raw)).readOnly,true);
});

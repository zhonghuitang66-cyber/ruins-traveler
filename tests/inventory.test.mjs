import test from 'node:test';import assert from 'node:assert/strict';
import {cleanWarehouse,depositLoot,cleanBag,packItems,rollChestLoot} from '../src/inventory.js';
test('warehouse rejects hostile counts, unknown and inherited properties',()=>{
 const raw=Object.assign(Object.create({coin:20}),{scrap:NaN,amber:Infinity,herb:-1,health:1.2,mana:'3',blade:true,crown:2,ghost:5});
 Object.defineProperty(raw,'armor',{enumerable:true,get(){throw Error('must not invoke')}});
 assert.deepEqual(cleanWarehouse(raw),{crown:2});assert.deepEqual(cleanWarehouse(null),{});assert.deepEqual(cleanWarehouse([]),{});
});
test('deposit accepts new known items, saturates overflow, never mutates inputs',()=>{
 const raw=Object.freeze({coin:Number.MAX_SAFE_INTEGER-1,ghost:3}),loot=Object.freeze([Object.freeze({id:'coin',n:10}),Object.freeze({id:'amber',n:2}),{id:'ghost',n:9},{id:'scrap',n:-2}]);
 assert.deepEqual(depositLoot(raw,loot),{coin:Number.MAX_SAFE_INTEGER,amber:2});assert.equal(raw.coin,Number.MAX_SAFE_INTEGER-1);assert.deepEqual(loot[1],{id:'amber',n:2});
});
test('packing respects existing stack capacity, twenty-four cells and exact leftovers',()=>{
 const source=[{id:'health',n:4},...Array.from({length:23},()=>({id:'blade',n:1}))];const before=structuredClone(source);
 const result=packItems(source,[{id:'health',n:3},{id:'amber',n:2}]);
 assert.equal(result.bag.length,24);assert.equal(result.bag[0].n,5);assert.deepEqual(result.remainder,[{id:'health',n:2},{id:'amber',n:2}]);assert.deepEqual(source,before);
 assert.equal(cleanBag([{id:'health',n:99},{id:'ghost',n:2},{id:'coin',n:4}]).reduce((n,r)=>n+r.n,0),103);
});
test('chest branch thresholds, quantity bounds and zone equipment chance are exact',()=>{
 const seq=(values)=>{let i=0;return()=>values[i++]??.99};
 assert.deepEqual(rollChestLoot(0,()=>.99),[{id:'coin',n:25}]);
 assert.deepEqual(rollChestLoot(0,()=>0),[{id:'coin',n:15},{id:'scrap',n:2},{id:'health',n:1},{id:'blade',n:1}]);
 assert.deepEqual(rollChestLoot(0,seq([.5,.7,.35,.03])),[{id:'coin',n:20}]);
 assert.deepEqual(rollChestLoot(4,seq([.5,.99,.99,.074,.99])),[{id:'coin',n:20},{id:'charm',n:1}]);
 assert.deepEqual(rollChestLoot(0,seq([.5,.99,.99,.074])),[{id:'coin',n:20}]);
});
test('invalid RNG values and zone cannot create invalid items or quantities',()=>{
 for(const raw of [NaN,Infinity,-1,1,2]){const loot=rollChestLoot(-99,()=>raw);assert.ok(loot[0].n>=15&&loot[0].n<=25);assert.ok(loot.every(s=>Number.isSafeInteger(s.n)&&s.n>0))}
});

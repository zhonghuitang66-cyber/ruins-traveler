import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeWarehouse} from '../src/warehouse-view.js';

test('warehouse detail matches actual deposited stacks without consuming them',()=>{
 const raw={coin:28,scrap:2};const snapshot={...raw};
 const view=summarizeWarehouse(raw);assert.equal(view.totalValue,'40');
 assert.deepEqual(view.rows.map(r=>[r.id,r.count,r.totalValue]),[['coin',28,'28'],['scrap',2,'12']]);
 view.rows[0].count=0;assert.deepEqual(raw,snapshot);
});
test('safe stock counts produce exact large value totals, not rounded Numbers',()=>{
 const n=Number.MAX_SAFE_INTEGER;
 const view=summarizeWarehouse({coin:n,crown:n});
 assert.equal(view.totalValue,(BigInt(n)*301n).toString());
 assert.equal(view.rows[0].id,'crown');
});
test('untrusted or unknown warehouse rows do not appear in presentation',()=>{
 const raw=JSON.parse('{"coin":1,"crown":-1,"unknown":9,"__proto__":100}');
 assert.equal(summarizeWarehouse(raw).totalValue,'1');
 assert.equal(summarizeWarehouse(raw).rows.length,1);
 assert.deepEqual(summarizeWarehouse(null),{rows:[],totalValue:'0',gearCount:0,capacity:24});
});

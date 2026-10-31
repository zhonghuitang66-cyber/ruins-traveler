import test from 'node:test';import assert from 'node:assert/strict';
import {createWarehouseStore,parseWarehouseSave,WAREHOUSE_SAVE_KEY} from '../src/inventory.js';

function memoryStorage(seed={}){
 const values=new Map(Object.entries(seed));let writes=0;
 return {values,get writes(){return writes},getItem:k=>values.has(k)?values.get(k):null,setItem(k,v){writes++;values.set(k,String(v))}};
}
const encoded=(items,settlements=[])=>JSON.stringify({version:1,items,settlements});

test('legacy warehouse migrates only on a successful commit and old key remains intact',()=>{
 const old=JSON.stringify({coin:14,scrap:1,ghost:3,health:-1}),storage=memoryStorage({'autumn-warehouse':old}),store=createWarehouseStore({storage});
 assert.deepEqual(store.load().items,{coin:14,scrap:1});assert.equal(store.load().fromLegacy,true);assert.equal(storage.writes,0);
 const result=store.settle('run-a',[{id:'amber',n:2}]);assert.equal(result.ok,true);assert.deepEqual(result.items,{coin:14,scrap:1,amber:2});
 assert.equal(storage.getItem('autumn-warehouse'),old);assert.equal(JSON.parse(storage.getItem(WAREHOUSE_SAVE_KEY)).version,2);
 assert.deepEqual(createWarehouseStore({storage}).load().items,result.items);
});

test('corrupt current data is preserved and cannot silently fall back then overwrite',()=>{
 for(const text of ['{bad','null','[]','42',encoded({},['']),JSON.stringify({version:1,items:{},settlements:'run'})]){
  const storage=memoryStorage({[WAREHOUSE_SAVE_KEY]:text,'autumn-warehouse':'{"coin":20}'}),store=createWarehouseStore({storage});
  assert.equal(store.load().readOnly,true);assert.equal(store.settle('run-a',[{id:'coin',n:5}]).ok,false);assert.equal(storage.getItem(WAREHOUSE_SAVE_KEY),text);assert.equal(storage.writes,0);
 }
});

test('unsupported save versions are read-only rather than downgraded',()=>{
 const text=JSON.stringify({version:3,items:{coin:88},settlements:[],futureField:1}),storage=memoryStorage({[WAREHOUSE_SAVE_KEY]:text});
 assert.equal(parseWarehouseSave(text).status,'unsupported_version');assert.equal(createWarehouseStore({storage}).settle('new-run',[]).status,'unsupported_version');assert.equal(storage.writes,0);
});

test('v1 sanitization rejects unknown/hostile amounts and deduplicates valid receipts',()=>{
 const state=parseWarehouseSave('{"version":1,"items":{"coin":7,"amber":1.5,"scrap":"9","mana":-1,"charm":1e300,"ghost":2,"__proto__":{"polluted":true}},"settlements":["a","a"]}');
 assert.equal(state.status,'normalized');assert.deepEqual(state.items,{coin:7});assert.deepEqual(state.settlements,['a']);assert.equal({}.polluted,undefined);
});

test('duplicate extraction is rejected across store instances and reloads',()=>{
 const storage=memoryStorage(),a=createWarehouseStore({storage}),b=createWarehouseStore({storage});
 assert.equal(a.settle('run-unique',[{id:'coin',n:9}]).status,'settled');
 assert.equal(b.settle('run-unique',[{id:'coin',n:999}]).status,'duplicate');assert.equal(storage.writes,1);assert.deepEqual(b.load().items,{coin:9});
 assert.equal(b.settle('another-run',[{id:'coin',n:1}]).ok,true);assert.deepEqual(a.load().items,{coin:10});
});

test('storage denial and quota failure never optimistically deposit or mark a receipt',()=>{
 const denied=createWarehouseStore({storage:{getItem(){throw Error('denied')},setItem(){throw Error('denied')}}});
 assert.equal(denied.load().status,'storage_unavailable');assert.equal(denied.settle('a',[]).ok,false);
 const base=memoryStorage({[WAREHOUSE_SAVE_KEY]:encoded({coin:4})});let blocked=true;
 const storage={getItem:base.getItem,setItem(k,v){if(blocked)throw Error('QuotaExceededError');base.setItem(k,v)}},store=createWarehouseStore({storage});
 assert.deepEqual(store.settle('retry-safe',[{id:'coin',n:6}]),{ok:false,status:'write_failed',duplicate:false,items:{coin:4}});
 assert.deepEqual(store.load().settlements,[]);blocked=false;assert.equal(store.settle('retry-safe',[{id:'coin',n:6}]).ok,true);assert.deepEqual(store.load().items,{coin:10});
});

test('death, malformed loot and bad run identifiers cannot alter the warehouse',()=>{
 const storage=memoryStorage(),store=createWarehouseStore({storage});
 assert.equal(store.settle('dead',[{id:'coin',n:5}],{success:false}).status,'not_extracted');
 for(const id of ['',null,' x','x '.repeat(100)])assert.equal(store.settle(id,[]).status,'invalid_extraction_id');
 for(const loot of [null,[{id:'ghost',n:1}],[{id:'coin',n:NaN}],[{id:'coin',n:Infinity}],[{id:'coin',n:1.5}],[{id:'coin',n:0}],[{id:'coin',n:3},{id:'mana',n:-1}]])assert.equal(store.settle('bad',loot).status,'invalid_loot');
 assert.equal(storage.writes,0);assert.deepEqual(store.load().items,{});
});

test('empty successful extraction still has a durable receipt',()=>{
 const storage=memoryStorage(),store=createWarehouseStore({storage});
 assert.equal(store.settle('empty-run',[]).ok,true);assert.equal(store.settle('empty-run',[{id:'coin',n:1}]).status,'duplicate');assert.deepEqual(store.load().items,{});
});

test('warehouse counts are not limited to backpack stacks, while overflow fails atomically',()=>{
 const storage=memoryStorage({[WAREHOUSE_SAVE_KEY]:encoded({coin:Number.MAX_SAFE_INTEGER-1})}),store=createWarehouseStore({storage});
 assert.equal(store.settle('overflow',[{id:'herb',n:5},{id:'coin',n:2}]).status,'count_overflow');assert.deepEqual(store.load().items,{coin:Number.MAX_SAFE_INTEGER-1});assert.equal(storage.writes,0);
 assert.equal(store.settle('last-unit',[{id:'coin',n:1},{id:'blade',n:13}]).ok,true);assert.deepEqual(store.load().items,{coin:Number.MAX_SAFE_INTEGER,blade:13});
});

test('write detects a changed save instead of replacing newer inventory',()=>{
 const original=encoded({coin:2}),updated=encoded({coin:12},['other-tab-run']);let reads=0,writes=0;
 const storage={getItem(k){if(k!==WAREHOUSE_SAVE_KEY)return null;return ++reads===1?original:updated},setItem(){writes++}};
 assert.equal(createWarehouseStore({storage}).settle('run-a',[{id:'coin',n:3}]).status,'save_conflict');assert.equal(writes,0);
});

test('returned snapshots cannot mutate the persisted record',()=>{
 const storage=memoryStorage({[WAREHOUSE_SAVE_KEY]:encoded({coin:3},['a'])}),store=createWarehouseStore({storage});
 const state=store.load();state.items.coin=999;state.settlements.push('b');assert.deepEqual(store.load().items,{coin:3});assert.deepEqual(store.load().settlements,['a']);
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const show=source.slice(source.indexOf('function showPendingResult(){'),source.indexOf('function commitAbandon(){'));
const start=source.slice(source.indexOf('async function start(){'),source.indexOf('const artMotion='));
test('cold recovery exposes a reachable retry result for both failed extraction and failed abandon saves',async()=>{
 for(const kind of ['pendingSettlement','pendingAbandon']){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true});return nodes.get(id)},saved={state:'closed',sessionId:'pending',...(kind==='pendingSettlement'?{pendingSettlement:{id:'pending',bag:[{id:'coin',n:10}],value:10}}:{pendingAbandon:'pending'})};let calls=0;
 const factory=new Function('deps',`const {$,saved,onCommit}=deps;const vfx={isReady:()=>true},raidCheckpoint={read:()=>saved},warehouseStore={load:()=>({settlements:[]})},playerSpriteRuntimeManifest=Promise.resolve({}),monsterCatalog=Promise.resolve({}),monsterModelCatalog=Promise.resolve({});let startingPlayer=false,activeMonsterCatalog,activeMonsterModelCatalog,pendingSettlement=null,pendingAbandon=null,paused=false;const toast=()=>{},itemValue=row=>row.n,renderExtractionItems=()=>{};function commitSettlement(){onCommit()}function commitAbandon(){onCommit();return false}
${show}
${start}
return {start};`);
 const ui=factory({$,saved,onCommit:()=>calls++});await ui.start();assert.equal(calls,1);assert.equal($('result').hidden,false);assert.equal($('menu').hidden,true);assert.equal($('retrySettlement').hidden,false);assert.equal($('againBtn').disabled,true);await ui.start();assert.equal($('retrySettlement').hidden,false);
 }
});

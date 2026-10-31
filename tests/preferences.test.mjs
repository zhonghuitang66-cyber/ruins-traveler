import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSettings,cleanLayout} from '../src/preferences.js';
import {LAYOUT} from '../src/data.js';

test('old settings migrate without losing vibration choice',()=>{
 assert.deepEqual(cleanSettings({shake:0}),{volume:.6,muted:false,reducedFlash:false,shake:0,quality:'detail',minimumCellValue:40});
 assert.deepEqual(cleanSettings({volume:.6,muted:false,reducedFlash:false,shake:2,quality:'economy'}),{volume:.6,muted:false,reducedFlash:false,shake:2,quality:'economy',minimumCellValue:40});
});
test('damaged saved settings cannot select inherited presets or nonfinite vibration',()=>{
 for(const value of [null,[],false,'oops',{quality:['economy']},{shake:Infinity,quality:'constructor'},{shake:NaN,quality:'__proto__'}])assert.deepEqual(cleanSettings(value),{volume:.6,muted:false,reducedFlash:false,shake:1,quality:'detail',minimumCellValue:40});
 assert.equal(cleanSettings({shake:5}).shake,3);
});
test('partial layouts retain defaults, valid zero coordinates and finite limits',()=>{
 const raw={stick:{x:0,y:1,size:999},attack:null,skill1:{x:NaN,y:'broken',size:0}};
 const fixed=cleanLayout(raw);
 assert.deepEqual(fixed.stick,{x:0,y:1,size:260});
 assert.deepEqual(fixed.attack,LAYOUT.attack);
 assert.deepEqual(fixed.skill1,{...LAYOUT.skill1,size:64});
 assert.equal(raw.stick.size,999);
 for(const value of [null,[],false])assert.deepEqual(cleanLayout(value),LAYOUT);
 fixed.attack.x=0;assert.notEqual(LAYOUT.attack.x,0);
});

test('reduced flash setting migrates disabled and only accepts a real boolean',()=>{assert.equal(cleanSettings({}).reducedFlash,false);assert.equal(cleanSettings({reducedFlash:'true'}).reducedFlash,false);assert.equal(cleanSettings({reducedFlash:true}).reducedFlash,true)});

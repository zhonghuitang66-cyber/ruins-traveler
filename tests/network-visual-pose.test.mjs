import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNetworkPose,appendNetworkPose,sampleNetworkPose} from '../src/network-visual-pose.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('8Hz motion interpolates between snapshots, holds run, and never sweeps through a teleport or death',()=>{
 let state=emptyNetworkPose();state=appendNetworkPose(state,{x:0,z:0},0,1);state=appendNetworkPose(state,{x:.375,z:0},.125,2);state=appendNetworkPose(state,{x:.75,z:0},.25,3);
 near(sampleNetworkPose(state,.3125).x,.5625);assert.equal(sampleNetworkPose(state,.3125).moving,true);
 const unchanged=appendNetworkPose(state,{x:99,z:0},.3,3);assert.equal(unchanged,state,'rendering the same snapshot must not manufacture new motion');
 state=appendNetworkPose(state,{x:.75,z:0},.375,4);near(sampleNetworkPose(state,.5).x,.75);assert.equal(sampleNetworkPose(state,.5).moving,false);
 state=appendNetworkPose(state,{x:8,z:-2},.5,5);near(sampleNetworkPose(state,.501).x,8);assert.equal(state.samples.length,1);
 state=appendNetworkPose(state,{x:9,z:-2,alive:false},.625,6);near(sampleNetworkPose(state,.626).x,9);assert.equal(sampleNetworkPose(state,.626).alive,false);assert.equal(sampleNetworkPose(state,.626).moving,false);
});

test('missing packets cannot extrapolate beyond the short distance cap and reconnection discards stale history',()=>{
 let state=appendNetworkPose(emptyNetworkPose(),{x:0,z:0},0,1);state=appendNetworkPose(state,{x:1,z:0},.125,2);
 near(sampleNetworkPose(state,.6).x,1.35);near(sampleNetworkPose(state,20).x,1.35);assert.equal(sampleNetworkPose(state,20).moving,false);
 near(sampleNetworkPose(state,.6,{connected:false}).x,1);assert.equal(sampleNetworkPose(state,.6,{connected:false}).moving,false);
 state=appendNetworkPose(state,{x:1.1,z:0},1,3);near(sampleNetworkPose(state,1.01).x,1.1);assert.equal(state.samples.length,1);
 assert.equal(appendNetworkPose(state,{x:9,z:0},.5,4),state,'late data cannot overwrite the new connection pose');
});

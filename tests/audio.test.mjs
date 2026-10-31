import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioManager,basicAttackSound} from '../src/audio.js';
function fixture({delay=false,fail=false,maxVoices=2}={}){
 let clock=0,resolve,reads=0,decodes=0;const sources=[],gains=[];
 class Context{
  state='suspended';destination={};async resume(){this.state='running'}async close(){this.state='closed'}
  createGain(){const g={gain:{value:1},connect(){},disconnect(){this.disconnected=true}};gains.push(g);return g}
  createBufferSource(){const s={connect(){},disconnect(){this.disconnected=true},start(){this.started=true},stop(){this.stopped=true;this.onended?.()}};sources.push(s);return s}
  async decodeAudioData(){decodes++;if(fail)throw Error('decode');if(delay)return await new Promise(r=>resolve=r);return {duration:.2}}
 }
 const visibility=new EventTarget();visibility.hidden=false;
 const fetch=async url=>{reads++;return {ok:true,json:async()=>({sounds:{hit:{url:'hit.wav',minIntervalMs:80},other:{url:'hit.wav'},bad:{url:'missing.wav'}}}),arrayBuffer:async()=>new ArrayBuffer(4)}};
 const audio=createAudioManager({AudioContext:Context,fetch,maxVoices,now:()=>clock,visibilityTarget:visibility});
 return {audio,sources,gains,visibility,tick:()=>clock+=100,resolve:()=>resolve({duration:.2}),counts:()=>({reads,decodes})};
}
test('requires explicit unlock; lazy fetch/decode deduplicate and same-key requests throttle',async()=>{
 const f=fixture();assert.equal(await f.audio.play('hit'),false);assert.equal(f.counts().reads,0);await f.audio.unlock();
 assert.deepEqual(await Promise.all([f.audio.play('hit'),f.audio.play('hit')]),[true,false]);assert.deepEqual(f.counts(),{reads:2,decodes:1});
 assert.equal(await f.audio.play('other'),true);assert.equal(f.counts().decodes,1);assert.equal(await f.audio.play('missing'),false);await f.audio.release();
});
test('voice cap, end cleanup, mute and volume never grow active playback unbounded',async()=>{
 const f=fixture({maxVoices:1});await f.audio.unlock();assert.equal(await f.audio.play('hit'),true);assert.equal(await f.audio.play('other'),false);
 f.sources[0].onended();assert.equal(f.audio.getStatus().activeVoices,0);f.tick();assert.equal(await f.audio.play('other'),true);
 f.audio.setVolume(.25);assert.equal(f.gains[0].gain.value,.25);f.audio.setMuted(true);assert.equal(f.audio.getStatus().activeVoices,0);assert.equal(f.sources[1].stopped,true);assert.equal(await f.audio.play('hit'),false);
 assert.throws(()=>f.audio.setVolume(NaN));assert.throws(()=>f.audio.setVolume(2));await f.audio.release();
});
test('pause invalidates in-flight decoding; resume cannot replay queued sounds; release is terminal',async()=>{
 const f=fixture({delay:true});await f.audio.unlock();const pending=f.audio.play('hit');while(!f.counts().decodes)await new Promise(r=>setImmediate(r));
 f.audio.setPaused(true);f.audio.setPaused(false);f.resolve();assert.equal(await pending,false);assert.equal(f.sources.length,0);
 f.tick();assert.equal(await f.audio.play('hit'),true);await f.audio.release();assert.equal(f.sources[0].stopped,true);assert.equal(f.gains[1].disconnected,true);assert.equal(await f.audio.unlock(),false);assert.equal(await f.audio.play('hit'),false);await f.audio.release();
});
test('hidden document stops voices, becoming visible does not override manual pause',async()=>{
 const f=fixture();await f.audio.unlock();await f.audio.play('hit');f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(f.sources[0].stopped,true);
 f.audio.setPaused(true);f.visibility.hidden=false;f.visibility.dispatchEvent(new Event('visibilitychange'));f.tick();assert.equal(await f.audio.play('hit'),false);f.audio.setPaused(false);assert.equal(await f.audio.play('hit'),true);await f.audio.release();
});
test('network/decode/unavailable WebAudio fail silent without rejected gameplay calls',async()=>{
 const f=fixture({fail:true});await f.audio.unlock();assert.equal(await f.audio.play('hit'),false);f.tick();assert.equal(await f.audio.play('hit'),false);assert.equal(f.counts().decodes,1);await f.audio.release();
 const a=createAudioManager({AudioContext:null});assert.equal(await a.unlock(),false);assert.equal(await a.play('hit'),false);await a.release();
 const b=createAudioManager({AudioContext:class {state='running';destination={};createGain(){return {gain:{},connect(){},disconnect(){}}}resume(){}close(){}},fetch:async()=>{throw Error('offline')}});await b.unlock();assert.equal(await b.play('hit'),false);await b.release();
});

test('HTTP missing file and delayed manifest cannot create playback after release',async()=>{
 class Context {state='running';destination={};createGain(){return {gain:{},connect(){},disconnect(){}}}resume(){}close(){}createBufferSource(){throw Error('must not play')} }
 let reads=0;const missing=createAudioManager({AudioContext:Context,fetch:async()=>++reads===1?{ok:true,json:async()=>({sounds:{missing:'missing.wav'}})}:{ok:false}});
 await missing.unlock();assert.equal(await missing.play('missing'),false);assert.equal(reads,2);await missing.release();
 let resolve;const delayed=createAudioManager({AudioContext:Context,fetch:()=>new Promise(r=>resolve=r)});await delayed.unlock();const pending=delayed.play('hit');await delayed.release();resolve({ok:true,json:async()=>({sounds:{hit:'hit.wav'}})});assert.equal(await pending,false);
});

test('new UI sounds may play during manual pause but cannot bypass hidden/mute/zero volume',async()=>{
 const f=fixture();await f.audio.unlock();f.audio.setPaused(true);assert.equal(await f.audio.play('hit'),false);assert.equal(await f.audio.play('hit',{ui:true}),true);
 f.audio.setMuted(true);f.tick();assert.equal(await f.audio.play('hit',{ui:true}),false);f.audio.setMuted(false);f.audio.setVolume(0);assert.equal(await f.audio.play('hit',{ui:true}),false);
 f.audio.setVolume(.5);f.visibility.hidden=true;f.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(await f.audio.play('hit',{ui:true}),false);await f.audio.release();assert.equal(await f.audio.play('hit',{ui:true}),false);
});
test('UI flag cannot resurrect a request started before pause invalidated it',async()=>{
 const f=fixture({delay:true});await f.audio.unlock();const pending=f.audio.play('hit',{ui:true});while(!f.counts().decodes)await new Promise(r=>setImmediate(r));
 f.audio.setPaused(true);f.resolve();assert.equal(await pending,false);assert.equal(f.sources.length,0);f.tick();assert.equal(await f.audio.play('hit',{ui:true}),true);assert.equal(f.audio.getStatus().paused,true);await f.audio.release();
});

test('optional compressor sits after master gain and disconnects on release',async()=>{
 const nodes=[];let limiter;
 class Context {state='running';destination={};resume(){}close(){}createGain(){const n={gain:{},connect(target){this.target=target},disconnect(){this.disconnected=true}};nodes.push(n);return n}createDynamicsCompressor(){limiter={threshold:{},knee:{},ratio:{},attack:{},release:{},connect(target){this.target=target},disconnect(){this.disconnected=true}};return limiter}}
 const audio=createAudioManager({AudioContext:Context});await audio.unlock();assert.equal(nodes[0].target,limiter);assert.equal(limiter.threshold.value,-8);assert.equal(limiter.ratio.value,12);audio.setVolume(1);assert.equal(nodes[0].gain.value,1);await audio.release();assert.equal(limiter.disconnected,true);
});

test('free whoosh manifest keeps impact-only basic keys and adds distinct frost impact',async()=>{const {readFile}=await import('node:fs/promises');const manifest=JSON.parse(await readFile(new URL('../assets/audio/manifest.json',import.meta.url),'utf8')),sounds=manifest.sounds;assert.equal(basicAttackSound('swing','paladin'),null);assert.equal(basicAttackSound('attack-impact','paladin'),'paladin_attack');for(const key of ['paladin_attack','archer_attack','arrow_volley','frost_arrow']){assert.equal(sounds[key].sourceByteIdentical,false);assert.ok(sounds[key].sourceFiles.some(s=>s.sourceFile==='Audio/knifeSlice.ogg'));assert.equal(sounds[key].license,'CC0-1.0');assert.equal(sounds[key].aliasOf,undefined)}assert.equal(sounds.frost_impact.sourceFile,'Audio/impactGlass_light_000.ogg');assert.notEqual(sounds.frost_arrow.sha256,sounds.frost_impact.sha256);assert.ok(sounds.archer_attack.duration<.22);assert.ok(sounds.arrow_volley.duration>sounds.archer_attack.duration);assert.match(sounds.paladin_attack.processing,/no metal impact/i)});
test('updated free sound files match declared hashes and bundled licenses',async()=>{const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');const manifest=JSON.parse(await readFile(new URL('../assets/audio/manifest.json',import.meta.url),'utf8'));for(const key of ['paladin_attack','archer_attack','arrow_volley','frost_arrow','frost_impact']){const e=manifest.sounds[key],data=await readFile(new URL('../assets/audio/'+e.url,import.meta.url));assert.equal(data.subarray(0,4).toString(),'OggS');assert.equal(createHash('sha256').update(data).digest('hex'),e.sha256);assert.equal(data.length,e.bytes);assert.match(await readFile(new URL('../assets/audio/'+e.licenseFile,import.meta.url),'utf8'),/Creative Commons Zero|CC0/)}assert.equal(manifest.totalUniqueFiles,19);assert.equal(Object.keys(manifest.sounds).length,20)});

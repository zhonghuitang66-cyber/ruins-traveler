/** Basic attack sound follows the confirmed release, never animation startup/cancellation. */
const BASIC_ATTACK_SOUNDS=Object.freeze({swordsman:'sword_attack',paladin:'paladin_attack',archer:'archer_attack'});
export function basicAttackSound(eventType,role){return eventType==='attack-impact'&&Object.hasOwn(BASIC_ATTACK_SOUNDS,role)?BASIC_ATTACK_SOUNDS[role]:null}
/** File-backed one-shot effects. Call unlock directly from a user gesture. */
export function createAudioManager({manifestUrl='assets/audio/manifest.json',baseUrl=globalThis.document?.baseURI||'http://localhost/',fetch:fetcher=globalThis.fetch,AudioContext:Context=globalThis.AudioContext||globalThis.webkitAudioContext,maxVoices=8,now=()=>globalThis.performance.now(),visibilityTarget=globalThis.document}={}){
 const limit=Number.isInteger(maxVoices)&&maxVoices>0?Math.min(maxVoices,32):8;
 let context=null,master=null,limiter=null,manifestPromise=null,unlocked=false,paused=false,hidden=Boolean(visibilityTarget?.hidden),released=false,epoch=0,volume=.6,muted=false;
 const buffers=new Map(),voices=new Map(),last=new Map();
 const manifestAddress=new URL(manifestUrl,baseUrl).href;
 const gain=()=>{if(master)master.gain.value=muted?0:volume};
 function stop(){epoch++;for(const [voice,node] of [...voices]){try{voice.stop()}catch{}try{voice.disconnect();node.disconnect()}catch{}}voices.clear()}
 async function unlock(){
  if(released||hidden||!Context)return false;
  try{
   if(!context){context=new Context();master=context.createGain();
    if(typeof context.createDynamicsCompressor==='function'){
     try{limiter=context.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=12;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.18;limiter.connect(context.destination)}catch{try{limiter?.disconnect()}catch{}limiter=null}
    }
    master.connect(limiter||context.destination);gain()
   }
   await context.resume();unlocked=!released&&context.state==='running';return unlocked;
  }catch{return false}
 }
 async function manifest(){
  if(!manifestPromise)manifestPromise=(async()=>{try{const r=await fetcher(manifestAddress);if(!r.ok)return {};const data=await r.json();return data?.sounds&&typeof data.sounds==='object'?data.sounds:{}}catch{return {}}})();
  return manifestPromise;
 }
 async function buffer(url){
  if(!buffers.has(url))buffers.set(url,(async()=>{try{const r=await fetcher(url);if(!r.ok)return null;const bytes=await r.arrayBuffer();if(released)return null;return await context.decodeAudioData(bytes)}catch{return null}})());
  return buffers.get(url);
 }
 async function play(key,{volume:localVolume=1,ui=false}={}){
  const blocked=()=>released||(paused&&ui!==true)||hidden||muted||volume===0;
  if(blocked()||!unlocked||context?.state!=='running'||typeof key!=='string'||!Number.isFinite(localVolume)||localVolume<=0)return false;
  const generation=epoch,entries=await manifest();if(blocked()||epoch!==generation)return false;
  if(!Object.hasOwn(entries,key))return false;
  const entry=typeof entries[key]==='string'?{url:entries[key]}:entries[key];
  if(!entry||typeof entry.url!=='string')return false;
  const interval=Number.isFinite(entry.minIntervalMs)?Math.max(0,entry.minIntervalMs):70,time=now();
  if(time-(last.get(key)??-Infinity)<interval)return false;last.set(key,time);
  let address;try{address=new URL(entry.url,manifestAddress).href}catch{return false}
  const data=await buffer(address);
  if(!data||blocked()||epoch!==generation||context.state!=='running'||voices.size>=limit)return false;
  let source,node;
  try{
   source=context.createBufferSource();node=context.createGain();source.buffer=data;
   node.gain.value=Math.min(1,localVolume)*Math.min(1,Math.max(0,Number.isFinite(entry.volume)?entry.volume:1));
   source.connect(node);node.connect(master);voices.set(source,node);
   source.onended=()=>{voices.delete(source);try{source.disconnect();node.disconnect()}catch{}};
   source.start();return true;
  }catch{voices.delete(source);try{source?.disconnect();node?.disconnect()}catch{}return false}
 }
 function setVolume(value){if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Volume must be 0..1');volume=value;gain();if(!value)stop()}
 function setMuted(value){muted=Boolean(value);gain();if(muted)stop()}
 function setPaused(value){paused=Boolean(value);if(paused)stop();/* Resume only permits new plays; pending requests are invalidated. */}
 const visibility=()=>{hidden=Boolean(visibilityTarget?.hidden);if(hidden)stop()};visibilityTarget?.addEventListener?.('visibilitychange',visibility);
 async function release(){if(released)return;released=true;unlocked=false;stop();buffers.clear();last.clear();visibilityTarget?.removeEventListener?.('visibilitychange',visibility);try{master?.disconnect();limiter?.disconnect();await context?.close()}catch{}}
 return {unlock,play,setVolume,setMuted,setPaused,stop,release,getStatus:()=>({unlocked,paused,hidden,released,volume,muted,activeVoices:voices.size,cachedSounds:buffers.size,maxVoices:limit})};
}

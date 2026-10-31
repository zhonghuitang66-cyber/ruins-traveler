import {ITEM_DEFINITIONS,isEquipment,itemValue,sanitizeItemRow} from './equipment.js';

export const ONLINE_DEVICE_KEY='autumn-online-device-v1';
export const ONLINE_TOKEN_KEY='autumn-online-token-v1';
export const ONLINE_USERNAME_KEY='autumn-online-username-v1';
export const ONLINE_REFRESH_MS=600000;
export const ONLINE_MATCH_MS=30000;
const own=(v,k)=>{if(!v||typeof v!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const clone=v=>structuredClone(v);
const payloadBytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
export function validOnlineUsername(value){return typeof value==='string'&&value===value.trim()&&/^[\p{L}\p{N}_-]{2,16}$/u.test(value.normalize('NFKC'))}
/** Decimal strings preserve large warehouse values without floating-point rounding. */
export function calculateOnlineWealth(snapshot){
 let total=0n;const uids=new Set();
 for(const [id,n]of Object.entries(snapshot?.items||{})){const d=ITEM_DEFINITIONS[id];if(d&&!isEquipment(id)&&Number.isSafeInteger(n)&&n>0)total+=BigInt(d.value)*BigInt(n)}
 for(const raw of [...(Array.isArray(snapshot?.gear)?snapshot.gear:[]),...(Array.isArray(snapshot?.collection)?snapshot.collection:[])]){const row=sanitizeItemRow(raw);if(!row)continue;if(isEquipment(row)){if(uids.has(row.uid))continue;uids.add(row.uid)}const price=itemValue(row);if(Number.isSafeInteger(price)&&price>=0)total+=BigInt(price)}
 return total.toString();
}
function cleanDelta(value,depth=0){
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('invalid_delta');return value}
 if(typeof value==='string'){if(value.length>128)throw Error('invalid_delta');return value}
 if(depth>=12)throw Error('invalid_delta');
 if(Array.isArray(value)){if(value.length>256)throw Error('invalid_delta');return value.map(v=>v===undefined?null:cleanDelta(v,depth+1))}
 if(!plain(value)||Object.keys(value).length>128)throw Error('invalid_delta');const out={};for(const key of Object.keys(value)){if(key.length>128||['__proto__','prototype','constructor'].includes(key))throw Error('invalid_delta');const entry=own(value,key);if(entry!==undefined)out[key]=cleanDelta(entry,depth+1)}return out;
}
function mergeDelta(a,b){const out={...a};for(const [key,v]of Object.entries(b))out[key]=plain(v)&&plain(out[key])?mergeDelta(out[key],v):v;return out}

/** Optional offline-safe adapter. Main owns simulation, bots, UI and settlement. */
export function createOnlineClient({endpoint='',storage,fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,cryptoImpl=globalThis.crypto,onEvent=()=>{},now=()=>Date.now(),setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout,maxHz=10,maxBufferedBytes=65536}={}){
 let base=null;if(endpoint){base=new URL(endpoint);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('online_endpoint_must_be_fixed_https_origin')}
 const targetStorage=()=>storage===undefined?globalThis.localStorage:storage;
 const emit=(type,data={})=>{try{onEvent(type,clone(data))}catch{}};
 let token=null,wealthKnown=false;let disposed=false,identity=null,profile=null,loginPromise=null,wealthPromise=null,wealthDirty=false,wealthValue='0',lastWealthAt=-Infinity,lastWealthAttempt=-Infinity,rankingPromise=null,rankingCache=null,rankingAt=-Infinity;
 let matchPromise=null,resolveMatch=null;function finishMatch(result){const resolve=resolveMatch;resolveMatch=null;matchPromise=null;resolve?.(result)}
 let socket=null,socketGeneration=0,matchTimer=null,matchDeadline=0,matchState='idle',roomId=null,pendingDelta=null,lastDeltaAt=-Infinity,sequence=0,fallbackGeneration=-1;const commandQueue=new Map();let commandSequence=0,lastCommandAt=-Infinity;
 const deltaInterval=1000/Math.min(20,Math.max(1,Number.isFinite(maxHz)?maxHz:10));
 const fail=status=>({ok:false,status});
 function getIdentity(){if(identity)return {...identity};const target=targetStorage();if(!target||typeof target.getItem!=='function'||typeof target.setItem!=='function')throw Error('identity_storage_unavailable');let deviceId=target.getItem(ONLINE_DEVICE_KEY);if(!/^[a-f0-9]{48}$/.test(deviceId||'')){if(typeof cryptoImpl?.getRandomValues!=='function')throw Error('secure_random_unavailable');const bytes=new Uint8Array(24);cryptoImpl.getRandomValues(bytes);deviceId=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');target.setItem(ONLINE_DEVICE_KEY,deviceId)}const username=target.getItem(ONLINE_USERNAME_KEY);identity={deviceId,username:validOnlineUsername(username)?username:''};return {...identity}}
 async function request(path,{method='GET',body,authenticated=false}={}){if(disposed)throw Error('disposed');if(!base)throw Error('offline');if(typeof fetchImpl!=='function')throw Error('fetch_unavailable');const controller=typeof globalThis.AbortController==='function'?new AbortController():null;const timeout=controller?globalThis.setTimeout(()=>controller.abort(),10000):null;try{const response=await fetchImpl(new URL(path,base).href,{method,...(controller?{signal:controller.signal}:{}),headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},credentials:'omit',keepalive:path==='/api/wealth',cache:'no-store',redirect:'error',...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(typeof data?.error==='string'?data.error:typeof data?.code==='string'?data.code:`http_${response.status}`);return data}catch(error){if(controller?.signal.aborted)throw Error('request_timeout');throw error}finally{if(timeout!==null)globalThis.clearTimeout(timeout)}}
 async function login(username){if(disposed)return fail('disposed');if(!base)return fail('offline');if(!validOnlineUsername(username))return fail('invalid_username');if(loginPromise)return loginPromise;
  let id;try{id=getIdentity()}catch(error){return fail(error.message)}
  loginPromise=(async()=>{try{const storedToken=targetStorage().getItem(ONLINE_TOKEN_KEY);if(storedToken!==null&&(!/^[A-Za-z0-9_\-.]{32,512}$/.test(storedToken)))return fail('invalid_stored_token');token=storedToken;const result=token?await request('/api/login',{method:'POST',body:{},authenticated:true}):await request('/api/register',{method:'POST',body:{deviceId:id.deviceId,username}});if(disposed)return fail('disposed');if(!token){if(typeof result.token!=='string'||!/^[A-Za-z0-9_\-.]{32,512}$/.test(result.token))throw Error('invalid_registration_token');token=result.token;targetStorage().setItem(ONLINE_TOKEN_KEY,token)}if(!plain(result.profile))throw Error('invalid_profile');profile=result.profile;identity={deviceId:id.deviceId,username:validOnlineUsername(profile.username)?profile.username:username};try{targetStorage().setItem(ONLINE_USERNAME_KEY,identity.username)}catch{emit('storage-error',{reason:'username_write_failed'})}emit('login',{profile,username});return {ok:true,profile:clone(profile),identity:{...identity}}}catch(error){emit('online-error',{operation:'login',reason:error.message});return fail(error.message)}finally{loginPromise=null}})();return loginPromise;
 }
 function markWealthDirty(snapshot){const next=calculateOnlineWealth(snapshot);if(!wealthKnown||next!==wealthValue){wealthValue=next;wealthDirty=true;wealthKnown=true}return wealthValue}
 async function flushWealth({reason='periodic'}={}){if(disposed)return fail('disposed');if(!base)return fail('offline');if(!identity?.username||!profile)return fail('not_logged_in');if(!wealthDirty)return {ok:true,status:'clean'};if(BigInt(wealthValue)>BigInt(Number.MAX_SAFE_INTEGER))return fail('wealth_out_of_range');if(wealthPromise)return wealthPromise;const forced=['exit','settlement'].includes(reason),at=now();if(!forced&&at-lastWealthAt<ONLINE_REFRESH_MS)return {ok:true,status:'throttled'};if(at-lastWealthAttempt<5000)return {ok:true,status:'retry_throttled'};const submitted=wealthValue;lastWealthAttempt=at;
  wealthPromise=(async()=>{try{const result=await request('/api/wealth',{method:'POST',body:{wealth:submitted},authenticated:true});if(disposed)return fail('disposed');lastWealthAt=now();if(submitted===wealthValue)wealthDirty=false;emit('wealth-saved',{wealth:submitted,result});return {ok:true,status:'saved',wealth:submitted}}catch(error){emit('online-error',{operation:'wealth',reason:error.message});return fail(error.message)}finally{wealthPromise=null}})();return wealthPromise;
 }
 async function leaderboard(){if(disposed)return fail('disposed');if(!base)return fail('offline');if(rankingCache&&now()-rankingAt<ONLINE_REFRESH_MS)return {ok:true,status:'cached',...clone(rankingCache)};if(rankingPromise)return rankingPromise;
  rankingPromise=(async()=>{try{const result=await request('/api/leaderboard'),rows=Array.isArray(result)?result:result.rows;if(!Array.isArray(rows)||rows.length>1000)throw Error('invalid_leaderboard');rankingCache={rows:clone(rows),updatedAt:result.updatedAt??now()};rankingAt=now();emit('leaderboard',rankingCache);return {ok:true,status:'fresh',...clone(rankingCache)}}catch(error){emit('online-error',{operation:'leaderboard',reason:error.message});return rankingCache?{ok:true,status:'stale',...clone(rankingCache)}:fail(error.message)}finally{rankingPromise=null}})();return rankingPromise;
 }
 function clearMatchTimer(){if(matchTimer!==null)clearTimeoutImpl?.(matchTimer);matchTimer=null;matchDeadline=0}
 function disconnect(){finishMatch(fail('cancelled'));clearMatchTimer();const old=socket;socket=null;socketGeneration++;pendingDelta=null;roomId=null;for(const entry of commandQueue.values())emit('command-failed',{id:entry.id,reason:'disconnected'});commandQueue.clear();if(old){old.onopen=old.onmessage=old.onerror=old.onclose=null;try{old.close(1000,'leave')}catch{}}}
 function fallback(reason){const generation=socketGeneration;if(fallbackGeneration===generation)return;fallbackGeneration=generation;const previousRoom=roomId;finishMatch({ok:false,status:'bot-fallback',reason,roomId:previousRoom});disconnect();matchState='bot-fallback';emit('bot-fallback',{reason,roomId:previousRoom})}
 function send(message){if(!socket||socket.readyState!==1)return false;try{socket.send(JSON.stringify(message));return true}catch{return false}}
 function match({role='swordsman'}={}){if(disposed)return Promise.resolve(fail('disposed'));if(!base)return Promise.resolve(fail('offline'));if(!profile||!identity?.username)return Promise.resolve(fail('not_logged_in'));if(!['swordsman','paladin','archer'].includes(role))return Promise.resolve(fail('invalid_role'));if(socket&&['connecting','waiting','matched'].includes(matchState))return matchPromise??Promise.resolve({ok:true,status:matchState,roomId});if(typeof WebSocketImpl!=='function')return Promise.resolve(fail('websocket_unavailable'));disconnect();const generation=socketGeneration;fallbackGeneration=-1;matchState='connecting';sequence=0;lastDeltaAt=-Infinity;matchDeadline=now()+ONLINE_MATCH_MS;
  const resultPromise=matchPromise=new Promise(resolve=>resolveMatch=resolve);try{const url=new URL('/ws',base);url.protocol='wss:';socket=new WebSocketImpl(url.href)}catch(error){fallback('connect_failed');return resultPromise}
  const current=socket,active=()=>!disposed&&socket===current&&generation===socketGeneration;
  current.onopen=()=>{if(!active())return;matchState='waiting';if(!send({type:'join',token,role})){fallback('send_failed');return}emit('waiting',{deadline:matchDeadline})};
  current.onmessage=event=>{if(!active()||typeof event.data!=='string'||event.data.length>65536)return;let message;try{message=JSON.parse(event.data)}catch{return}if(!plain(message)||typeof message.type!=='string')return;
   if(message.type==='matched'){if(matchState!=='waiting'&&matchState!=='connecting')return;if(typeof message.roomId!=='string'||!message.roomId||message.roomId.length>128||!Array.isArray(message.players)||message.players.length!==2)return;clearMatchTimer();roomId=message.roomId;matchState='matched';finishMatch({ok:true,status:'matched',...clone(message)});emit('matched',message)}
   else if(message.type==='waiting'){if(matchState==='waiting')emit('waiting',{deadline:matchDeadline})}
   else if(message.type==='delta'){if(matchState==='matched'&&(!message.roomId||message.roomId===roomId)&&plain(message.delta)){try{message.delta=cleanDelta(message.delta);emit('delta',message)}catch{}}}
   else if(message.type==='command'){if(matchState==='matched'&&typeof message.id==='string'&&message.id.length<=128&&Number.isSafeInteger(message.seq)&&message.seq>0&&plain(message.command)){try{message.command=cleanDelta(message.command);emit('command',message)}catch{}}}
   else if(message.type==='command-accepted'){const entry=commandQueue.get(message.id);if(entry&&entry.seq===message.seq){entry.accepted=true;emit('command-accepted',message)}}
   else if(message.type==='command-ack'){const entry=commandQueue.get(message.id);if(entry&&entry.seq===message.seq){commandQueue.delete(message.id);emit('command-ack',message)}}
   else if(message.type==='peer-left'){if(matchState==='matched')emit('peer-left',message)}
   else if(message.type==='bot-fallback')fallback(typeof message.reason==='string'?message.reason:'server_fallback');
   else if(message.type==='error')emit('online-error',{operation:'match',reason:message.reason||'server_error'});
  };
  current.onerror=()=>{if(active())fallback('connection_error')};current.onclose=()=>{if(active())fallback('disconnected')};
  if(typeof setTimeoutImpl==='function')matchTimer=setTimeoutImpl(()=>{if(active()&&matchState!=='matched')fallback('match_timeout')},ONLINE_MATCH_MS);
  emit('connecting',{deadline:matchDeadline});return resultPromise;
 }
 function sendDelta(delta){if(disposed||matchState!=='matched')return false;let clean;try{if(!plain(delta))return false;clean=cleanDelta(delta);const merged=mergeDelta(pendingDelta||{},clean);if(payloadBytes(merged)>60000)return false;pendingDelta=merged}catch{return false}pumpDelta();return true}
 function pumpDelta(){if(!pendingDelta||matchState!=='matched'||!socket||socket.readyState!==1||now()-lastDeltaAt<deltaInterval||socket.bufferedAmount>maxBufferedBytes)return false;const value=pendingDelta;if(!send({type:'delta',seq:sequence+1,delta:value})){fallback('send_failed');return false}sequence++;pendingDelta=null;lastDeltaAt=now();return true}
 function sendCommand(command,{id}={}){if(disposed||matchState!=='matched'||commandQueue.size>=64)return fail('not_available');let clean;try{if(!plain(command))return fail('invalid_command');clean=cleanDelta(command);if(payloadBytes(clean)>60000)return fail('invalid_command')}catch{return fail('invalid_command')}const next=commandSequence+1,commandId=id??`${identity.deviceId.slice(0,12)}-${next}`;if(typeof commandId!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(commandId))return fail('invalid_command_id');if(commandQueue.has(commandId))return fail('duplicate_command_id');commandSequence=next;commandQueue.set(commandId,{id:commandId,seq:next,command:clean,sentAt:null,attempts:0,accepted:false});pumpCommands();return {ok:true,id:commandId,seq:next}}
 function ackCommand(id,seq){if(typeof id!=='string'||id.length>128||!Number.isSafeInteger(seq)||seq<=0||matchState!=='matched')return false;return send({type:'command-ack',id,seq})}
 function pumpCommands(){if(!socket||socket.readyState!==1||socket.bufferedAmount>maxBufferedBytes||now()-lastCommandAt<50)return;for(const entry of commandQueue.values()){if(entry.sentAt!==null&&now()-entry.sentAt<2000)continue;if(entry.attempts>=3){commandQueue.delete(entry.id);emit('command-failed',{id:entry.id,seq:entry.seq,reason:'ack_timeout'});continue}if(!send({type:'command',id:entry.id,seq:entry.seq,command:entry.command})){fallback('send_failed');return}entry.sentAt=now();entry.attempts++;lastCommandAt=now();break}}
 function tick(){if(disposed)return;if(matchDeadline&&now()>=matchDeadline&&matchState!=='matched')fallback('match_timeout');pumpDelta();pumpCommands();if(wealthDirty&&now()-lastWealthAt>=ONLINE_REFRESH_MS&&now()-lastWealthAttempt>=30000)void flushWealth()}
 function leave({reason='exit'}={}){if(disposed)return Promise.resolve(fail('disposed'));if(socket)send({type:'leave',roomId});disconnect();matchState='idle';return flushWealth({reason})}
 function dispose(){if(disposed)return;disposed=true;finishMatch(fail('disposed'));disconnect();matchState='disposed';rankingCache=null;profile=null}
 return {login,getIdentity,markWealthDirty,flushWealth,leaderboard,match,sendDelta,sendCommand,ackCommand,tick,leave,dispose,getStatus:()=>({enabled:!!base,loggedIn:!!profile,matchState,roomId,deadline:matchDeadline,wealthDirty,wealth:wealthValue,hasPendingDelta:!!pendingDelta,sequence,pendingCommands:commandQueue.size})};
}

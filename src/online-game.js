import {Game,move,dist,normalizeDirection} from './core.js';
import {PLAYER_BASE_SPEED} from './data.js';
import {createNavigator} from './navigation.js';
import {sanitizeItemRow,canEquip,getEquipmentStats,sellPerCell} from './equipment.js';
import {prepareSynthesis,preparePotionPurchase} from './raid-interactions.js';
import {packGrid} from './grid-inventory.js';

const copy=v=>structuredClone(v);
const q=v=>Number.isFinite(v)?Math.round(v*100)/100:0;
const privateKeys=['networkInventoryRevision','kind','time','nextId','nextExitAt','nextHunterAt','spawnCorner','running','bag','bagCapacity','equipment','player','cool','stats','aim','exitProgress','autoCd','attackLock','cast','jumpCd','potionCd','speedBuff','healing','invis','guard','thunder','thunderExpire','thunderMarks','frost','frostCharges','moveSpeedBonus','speedPotionUntil','burstSpeedUntil','comboStage','comboExpiresAt'];
const snapshotPrivate=g=>Object.fromEntries(privateKeys.filter(k=>g[k]!==undefined).map(k=>[k,copy(g[k])]));
const publicPlayer=(g,id)=>({id,role:g.kind,x:q(g.player.x),z:q(g.player.z),hp:q(g.player.hp),maxHp:g.stats.hp,mp:q(g.player.mp),aim:copy(g.aim),running:g.running,invis:g.invis,guard:g.guard,cast:g.cast});
const cleanEnemy=e=>{const r={...e};for(const k of ['botWindup','combatTarget','target','path','networkTarget'])delete r[k];return JSON.parse(JSON.stringify(r))};
const inventoryMethods=new Set(['use','equipItem','unequipItem','moveBagItem','dropItem','sortBag','openChest','takeLoot','synthesis','purchase','takeAllLoot']);
const methods=new Set(['attack','skill','jump','use','equipItem','unequipItem','moveBagItem','dropItem','sortBag','openChest','takeLoot','pickup']);
function humanProxy(owner,id){
 const proxy={id:`human-${id}`,type:'sword',zone:0,bot:true,networkHuman:true,networkId:id,networkRole:owner.kind,home:{x:owner.player.x,z:owner.player.z},state:'hunt',visited:[],botCd:999,cd:999,charge:0,combatVersion:0};
 Object.defineProperty(proxy,'networkTarget',{value:owner,enumerable:false});
 for(const k of ['x','z','hp','mp','radius','stun','knockup','shield','frostMarks','slow'])Object.defineProperty(proxy,k,{enumerable:true,get:()=>k==='hp'&&!owner.running?0:owner.player[k]??0,set:v=>owner.player[k]=v});
 Object.defineProperty(proxy,'maxHp',{enumerable:true,get:()=>owner.stats.hp});
 Object.defineProperty(proxy,'inventory',{enumerable:true,get:()=>owner.bag});
 Object.defineProperty(proxy,'equipment',{enumerable:true,get:()=>owner.equipment});return proxy;
}

/** Two complete player simulations; one shared AI/loot authority. No inventory RPC
 * invokes a local guest mutation. Main continues to own rendering and camp saves. */
export function createOnlineGame({game,client,localId,onEvent=()=>{},onRemoteEvent=()=>{},persistAuthority=()=>true,frameHz=8}={}){
 if(!game||!client)throw Error('online_game_requires_game_and_client');
 const originalEmit=game.emit,originalFinish=game.finish;let active=false,guest=false,match=null,peerId=null,peerRole=null,peerGame=null,peerProxy=null,hostProxy=null,remotePlayers=[],ready=false,stopped=false;
 let elapsed=0,lastFrame=-Infinity,lastInput=-Infinity,requestSerial=0,inputSerial=0,attackIntent=0,lastRemoteAttack=0,lastRemoteInputTime=0,heldAttack=false,remoteHeldAttack=false,worldRevision=0,lastWorldSignature='',lastEnemySignature=new Map(),incomingWorld=null,lastFrameSeq=0,frameSeq=0;
 let lastInputSignature='',lastKeyframe=-Infinity;const lastPrivateSignature=new Map();
 let worldInitialized=false,pendingReady=null,lastWorldAt=-Infinity;const fieldSignatures=new Map();
 const reliable=[],eventBatch=[],processed=new Map(),receivedEvents=new Set(),originalMethods={};
 const notify=(type,data)=>{try{onEvent(type,data)}catch{}};
 const queue=command=>{if(reliable.length>=256){stop({fallback:true});notify('network-overload',{reason:'reliable_queue_full'});return false}reliable.push(command);return true};
 const pump=()=>{while(reliable.length){const result=client.sendCommand(reliable[0]);if(!result?.ok)break;reliable.shift()}};
 function emitPlayer(owner,id,type,data){
  const payload={...copy(data),networkPlayerId:id};
  if(id===localId)originalEmit(type,payload);else onRemoteEvent(type,payload);
  if(active&&!guest&&type!=='start')eventBatch.push({type,data:payload,playerId:id});
  if(type==='finish'&&data.success){const exit=owner.world.exits.find(e=>dist(e,owner.player)<3);if(exit){owner.world.exits=owner.world.exits.filter(e=>e!==exit);const driver=game.running?game:peerGame;if(driver&&driver.nextExitAt===null)driver.nextExitAt=driver.time+300}}
 }
 function addDeathPack(owner,id,loot){if(!loot.length)return;let remaining=loot,index=0;while(remaining.length){const packed=packGrid([],remaining,{capacity:30,sort:true});if(!packed.bag.length)break;game.packs.push({id:`human-drop-${id}-${index++}`,x:owner.player.x,z:owner.player.z,type:'bot',name:'敌方旅者遗物',capacity:30,items:packed.bag});remaining=packed.remainder}}
 function wrapFinish(owner,id){const prior=owner.finish;owner.finish=function(success,reason){if(this.networkSession&&this.running&&!success&&this.player.hp<=0)addDeathPack(this,id,[...this.bag,...Object.values(this.equipment)]);return prior.call(this,success,reason)}}
 function reliableWorld(full=false){
  if(!full&&(elapsed-lastWorldAt<.2||reliable.length>8||(client.getStatus?.().pendingCommands||0)>=24))return;
  const data=full?{...game.world,enemies:game.enemies.filter(e=>!e.networkHuman).map(cleanEnemy),packs:copy(game.packs)}:{};
  for(const field of ['chests','exits','packs']){const rows=field==='packs'?game.packs:game.world[field],signature=JSON.stringify(rows);if(full||fieldSignatures.get(field)!==signature){data[field]=copy(rows);fieldSignatures.set(field,signature)}}
  if(!Object.keys(data).length)return;lastWorldAt=elapsed;const revision=++worldRevision;
  if(!full&&new TextEncoder().encode(JSON.stringify(data)).length<=45000){queue({kind:'world-patch',revision,data});return}
  const fields=Object.keys(data);queue({kind:'world-start',revision,fields,full});
  for(const field of fields){let chunk=[];for(const row of data[field]||[]){if(chunk.length&&new TextEncoder().encode(JSON.stringify([...chunk,row])).length>18000){queue({kind:'world-part',revision,field,rows:chunk});chunk=[]}chunk.push(copy(row))}queue({kind:'world-part',revision,field,rows:chunk})}
  queue({kind:'world-end',revision});
 }
 function ensurePeerSession(command){
  if(peerGame)return {ok:true};if(!['swordsman','paladin','archer'].includes(command.role)||![24,28].includes(command.capacity)||!command.loadout||!Array.isArray(command.bag))return {ok:false,reason:'invalid_entry'};
  const loadout={},uids=new Set();for(const [slot,raw]of Object.entries(command.loadout)){const row=sanitizeItemRow(raw);if(!row||!canEquip(row,command.role,slot)||uids.has(row.uid))return {ok:false,reason:'invalid_loadout'};uids.add(row.uid);loadout[slot]=row}
  const bag=command.bag.map(sanitizeItemRow);if(bag.some(r=>!r)||bag.some(r=>r.uid&&(uids.has(r.uid)||!uids.add(r.uid))))return {ok:false,reason:'invalid_bag'};const packed=packGrid([],bag,{capacity:command.capacity});if(packed.remainder.length)return {ok:false,reason:'bag_full'};
  peerGame=new Game((type,data)=>emitPlayer(peerGame,peerId,type,data));peerGame.start(command.role,{bagCapacity:command.capacity,loadout});peerGame.bag=packed.bag;peerGame.world=game.world;peerGame.nav=game.nav;peerGame.bossNav=game.bossNav;peerGame.time=game.time;peerGame.networkInventoryRevision=0;peerGame.networkPassive=true;peerGame.networkSession=true;peerGame.nextId=game.nextId+1000;
  const displaced=(game.bots||[]).find(b=>!b.networkHuman&&b.hp>0);if(displaced){Object.assign(peerGame.player,{x:displaced.x,z:displaced.z});game.enemies=game.enemies.filter(e=>e!==displaced);game.bots=game.bots.filter(e=>e!==displaced)}else Object.assign(peerGame.player,{x:-game.player.x,z:-game.player.z});
  peerProxy=humanProxy(peerGame,peerId);hostProxy=humanProxy(game,localId);game.enemies.push(peerProxy);game.bots.push(peerProxy);Object.defineProperty(peerGame,'enemies',{configurable:true,get:()=>game.enemies.filter(e=>e!==peerProxy).concat(hostProxy),set:()=>{}});Object.defineProperty(peerGame,'bots',{configurable:true,get:()=>game.bots.filter(e=>e!==peerProxy).concat(hostProxy),set:()=>{}});Object.defineProperty(peerGame,'packs',{configurable:true,get:()=>game.packs,set:v=>game.packs=v});Object.defineProperty(peerGame,'nextId',{configurable:true,get:()=>game.nextId,set:v=>game.nextId=Math.max(game.nextId,v)});wrapFinish(peerGame,peerId);lastRemoteInputTime=elapsed;reliableWorld(true);queue({kind:'ready',self:snapshotPrivate(peerGame),other:publicPlayer(game,localId)});notify('synchronizing',{authority:true});return {ok:true};
 }
 function authorityAction(owner,method,args){
  if(!owner?.running||owner.player.hp<=0)return {ok:false,reason:'inactive'};
  if(method==='setExtractHeld'){owner.extractHeld=args[0]===true;return {ok:true}}
  if(method==='synthesis'||method==='purchase'){
   const chest=owner.world.chests.find(c=>c.id===args[0]),reason=owner.lootAccess(chest);if(reason)return {ok:false,reason};if(method==='synthesis'&&chest.craft)return {ok:false,reason:'already_used'};
   const result=method==='synthesis'?prepareSynthesis(owner,chest,args[1]):preparePotionPurchase(owner,chest,args[1]);if(!result.ok)return result;const bag=owner.bag,previous=copy(chest);owner.bag=result.bag;
   if(method==='synthesis')chest.craft={output:result.output,readyAt:result.readyAt,resultText:result.resultText};else chest.opened=true;
   game.networkPeers=peerGame?[{id:peerId,state:snapshotPrivate(peerGame)}]:[];
   if(persistAuthority(owner,method)===false){owner.bag=bag;Object.keys(chest).forEach(k=>delete chest[k]);Object.assign(chest,previous);return {ok:false,reason:'write_failed'}}owner.networkInventoryRevision=(owner.networkInventoryRevision||0)+1;return {...result,bag:undefined};
  }
  if(method==='takeAllLoot'){const minimum=args[0],allowed=args[1];if(!Number.isSafeInteger(minimum)||minimum<=0||!Array.isArray(allowed))return {ok:false,reason:'invalid_args'};const oldBag=copy(owner.bag),oldPacks=copy(game.packs);let taken=0;for(const pack of [...owner.packs])if(allowed.includes(pack.id)&&!owner.lootAccess(pack))for(let i=pack.items.length-1;i>=0;i--)if(sellPerCell(pack.items[i])>=minimum){const result=owner.takeLoot(pack.id,i);if(result.ok)taken+=result.taken}if(taken&&persistAuthority(owner,method)===false){owner.bag=oldBag;game.packs=oldPacks;return {ok:false,reason:'write_failed'}}if(taken)owner.networkInventoryRevision=(owner.networkInventoryRevision||0)+1;return {ok:true,taken}}
  if(!methods.has(method))return {ok:false,reason:'unknown_method'};const changesInventory=['takeLoot','equipItem','unequipItem','moveBagItem','dropItem','sortBag','openChest','use'].includes(method);const before=changesInventory?{state:snapshotPrivate(owner),packs:copy(game.packs),chests:copy(game.world.chests)}:null;const result=owner[method](...args);if(before&&result?.ok&&persistAuthority(owner,method)===false){const player=owner.player;for(const key of privateKeys)if(before.state[key]!==undefined)owner[key]=copy(before.state[key]);Object.assign(player,owner.player);owner.player=player;game.packs=before.packs;game.world.chests=before.chests;return {ok:false,reason:'write_failed'}}if(before&&result?.ok)owner.networkInventoryRevision=(owner.networkInventoryRevision||0)+1;return result;
 }
 function start(value){
  if(active)stop();match=value;localId=String(localId??client.getIdentity?.().deviceId??'');const me=value.players.find(p=>String(p.id)===localId);if(!me)throw Error('local_player_missing_from_match');const other=value.players.find(p=>String(p.id)!==localId);if(!other)throw Error('peer_missing_from_match');peerId=String(other.id);peerRole=other.role;guest=String(value.authorityId)!==localId;active=true;stopped=false;ready=false;worldInitialized=false;pendingReady=null;lastWorldAt=-Infinity;fieldSignatures.clear();elapsed=0;lastFrame=lastInput=-Infinity;lastFrameSeq=frameSeq=0;processed.clear();receivedEvents.clear();lastEnemySignature.clear();lastPrivateSignature.clear();lastInputSignature='';lastKeyframe=-Infinity;game.networkSession=true;
  if(guest){game.networkPassive=true;queue({kind:'enter',role:game.kind,capacity:game.bagCapacity,loadout:copy(game.equipment),bag:copy(game.bag)})}
  else {game.emit=(type,data)=>emitPlayer(game,localId,type,data);wrapFinish(game,localId)}pump();return {ok:true,isGuest:guest};
 }
 function call(method,args=[]){
  if(!active)return authorityAction(game,method,args);if(!Array.isArray(args)||args.length>5)return {ok:false,reason:'invalid_args'};
  if(!ready)return {ok:false,reason:'synchronizing'};
  if(!guest){const result=authorityAction(game,method,args);return result}
  if(!ready)return {ok:false,reason:'synchronizing'};
  if(method==='attack'){attackIntent++;sendInput(true);return {ok:true,pending:true}}
  if(!methods.has(method)&&!['setExtractHeld','synthesis','purchase','takeAllLoot'].includes(method))return {ok:false,reason:'unknown_method'};
  const requestId=`rpc-${localId}-${++requestSerial}`;const expectedItem=method==='takeLoot'?game.packs.find(p=>p.id===args[0])?.items?.[args[1]]:null;queue({kind:'rpc',requestId,method,args:copy(args),inventoryRevision:game.networkInventoryRevision||0,...(expectedItem?{expectedItem:{id:expectedItem.id,uid:expectedItem.uid}}:{})});pump();return {ok:true,pending:true,requestId};
 }
 function sendInput(force=false){if(!guest||!ready||!active)return;const state={input:copy(game.input),aim:copy(game.aim),extractHeld:game.extractHeld===true,attackHeld:heldAttack,attackIntent},signature=JSON.stringify(state),moving=Math.hypot(game.input.x||0,game.input.z||0)>0||heldAttack||game.extractHeld;if(!force&&signature===lastInputSignature&&(!moving||elapsed-lastInput<.5))return;if(client.sendDelta({kind:'input',inputSeq:++inputSerial,...state})!==false){lastInput=elapsed;lastInputSignature=signature}}
 function applyPrivate(state){if(!state||typeof state!=='object'||(!ready&&(!state.player||!Array.isArray(state.cool)||!Array.isArray(state.bag))))return false;const input=game.input,aim=game.aim,predicted={x:game.player.x,z:game.player.z};for(const key of privateKeys)if(state[key]!==undefined)game[key]=copy(state[key]);game.input=input;game.aim=aim;if(ready&&game.running&&Math.hypot(predicted.x-game.player.x,predicted.z-game.player.z)<.45){game.player.x=(predicted.x+game.player.x)/2;game.player.z=(predicted.z+game.player.z)/2}game.pendingAttack=null;game.events=[];return true}
 function predict(dt){if(!game.running||!game.player||game.player.hp<=0)return;game.time+=dt;for(const k of ['cast','attackLock','autoCd','jumpCd','potionCd'])game[k]=Math.max(0,(game[k]||0)-dt);game.cool=game.cool.map(v=>Math.max(0,v-dt));const p=game.player;if(p.stun>0||p.knockup>0||game.cast>0)return;const direction=normalizeDirection(game.input);if(!direction)return;const strength=Math.min(1,Math.hypot(game.input.x,game.input.z)),speed=PLAYER_BASE_SPEED*(1+game.moveSpeedBonus)*(game.speedPotionUntil>game.time?1.1:1)*(game.burstSpeedUntil>game.time?1.2:1)*(game.healing>0||game.invis>0?1.2:1)*game.frostMovementScale(p);move(p,direction.x*strength*speed*dt,direction.z*strength*speed*dt,game.world.walls)}
 function sendFrame(){if(!peerGame)return;const full=elapsed-lastKeyframe>=1,changes={},enemySignatures=new Map(),self={},privateSignatures=new Map(),state=snapshotPrivate(peerGame);if(state.player){state.player.x=q(state.player.x);state.player.z=q(state.player.z)}for(const [key,value]of Object.entries(state)){const signature=JSON.stringify(value);privateSignatures.set(key,signature);if(full||lastPrivateSignature.get(key)!==signature)self[key]=value}for(const e of game.enemies.filter(e=>!e.networkHuman)){const row=[e.id,q(e.x),q(e.z),q(e.hp),q(e.shield),q(e.stun),q(e.knockup),q(e.charge),q(e.chargeDuration),q(e.chargeEndsAt),e.chargePhase||''],signature=JSON.stringify(row);enemySignatures.set(e.id,signature);if(full||lastEnemySignature.get(e.id)!==signature)changes[String(e.id)]=row}const accepted=client.sendDelta({kind:'state',frameSeq:++frameSeq,self,other:publicPlayer(game,localId),enemies:changes,shots:[...game.shots.map(s=>({...s,enemy:true})),...peerGame.shots.map(s=>({...s,enemy:false}))]});if(accepted!==false){lastEnemySignature=enemySignatures;for(const [key,value]of privateSignatures)lastPrivateSignature.set(key,value);if(full)lastKeyframe=elapsed}}
 function update(dt){if(!active||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(.05,dt);elapsed+=dt;
  if(!ready){if(elapsed>=15){stop({fallback:true});notify('fallback',{reason:'initialization_timeout'});return}pump();client.tick?.();return}
  if(guest){if(ready)predict(dt);sendInput()}
  else {if(peerGame&&elapsed-lastRemoteInputTime>1){peerGame.input={x:0,z:0};remoteHeldAttack=false;peerGame.extractHeld=false}if(game.running){game.networkPassive=false;game.update(dt);if(peerGame?.running){peerGame.nextExitAt=game.nextExitAt;peerGame.nextHunterAt=game.nextHunterAt;peerGame.networkPassive=true;if(remoteHeldAttack)peerGame.attack(true);peerGame.update(dt)}}else if(peerGame?.running){if(peerGame.networkPassive){for(const e of game.enemies)if(e.type==='boss')game.cancelBossAction(e,'network-driver-change');peerGame.shots.push(...game.shots.map(s=>({...s,enemy:true})));game.shots=[]}peerGame.networkPassive=false;if(remoteHeldAttack)peerGame.attack(true);peerGame.update(dt);game.time=peerGame.time}if(peerGame){game.networkPeers=[{id:peerId,state:snapshotPrivate(peerGame)}];remotePlayers=[publicPlayer(peerGame,peerId)];reliableWorld();if(elapsed-lastFrame>=1/frameHz){lastFrame=elapsed;sendFrame()}}if(eventBatch.length)queue({kind:'events',events:eventBatch.splice(0,64)})}
  pump();client.tick?.();
 }
 function commitIncomingWorld(){const incoming=incomingWorld;if(!incoming?.ended||incoming.fields.some(k=>!incoming.received.has(k)))return;for(const key of incoming.fields){if(key==='enemies')game.enemies=incoming.rows[key];else if(key==='packs')game.packs=incoming.rows[key];else game.world[key]=incoming.rows[key]}game.bots=game.enemies.filter(e=>e.bot);if(incoming.fields.includes('walls')){game.nav=createNavigator(game.world.walls);game.bossNav=createNavigator(game.world.walls,{radius:1.2})}if(incoming.full)worldInitialized=true;notify('world-synced',{revision:incoming.revision});incomingWorld=null;if(pendingReady&&worldInitialized)acceptReady(pendingReady)}
 function acceptReady(data){if(!worldInitialized){pendingReady=data;return}pendingReady=null;applyPrivate(data.self);remotePlayers=[data.other];ready=true;queue({kind:'peer-ready'});notify('ready',{authority:false})}
 function receive(type,message){if(!active)return false;
  if(type==='delta'){
   const data=message.delta;if(!data||message.from&&String(message.from)!==peerId)return false;
   if(!guest&&data.kind==='input'&&peerGame){peerGame.input=normalizeDirection(data.input)?{x:Math.max(-1,Math.min(1,data.input.x)),z:Math.max(-1,Math.min(1,data.input.z))}:{x:0,z:0};const aim=normalizeDirection(data.aim);if(aim)peerGame.aim=aim;peerGame.extractHeld=data.extractHeld===true;remoteHeldAttack=data.attackHeld===true;lastRemoteInputTime=elapsed;if(Number.isSafeInteger(data.attackIntent)&&data.attackIntent>lastRemoteAttack){lastRemoteAttack=data.attackIntent;peerGame.attack(true)}return true}
   if(guest&&ready&&data.kind==='state'&&Number.isSafeInteger(data.frameSeq)&&data.frameSeq>lastFrameSeq){lastFrameSeq=data.frameSeq;applyPrivate(data.self);remotePlayers=[data.other];for(const row of Object.values(data.enemies||{})){const e=game.enemies.find(e=>e.id===row[0]);if(e)Object.assign(e,{x:row[1],z:row[2],hp:row[3],shield:row[4],stun:row[5],knockup:row[6],charge:row[7],chargeDuration:row[8],chargeEndsAt:row[9],chargePhase:row[10]||null})}game.shots=copy(data.shots||[]);return true}return false;
  }
  if(type==='peer-left'||type==='bot-fallback'){stop({fallback:true});notify('fallback',{reason:message?.reason||'peer_left'});return true}
  if(type!=='command'||message.from&&String(message.from)!==peerId)return false;const data=message.command;if(!data||typeof data.kind!=='string')return false;
  const key=message.id;if(processed.has(key)){client.ackCommand?.(message.id,message.seq);const response=processed.get(key);if(response)queue(response);pump();return true}
  let response=null;
  if(!guest&&data.kind==='enter'){const result=ensurePeerSession(data);if(!result.ok)response={kind:'entry-rejected',reason:result.reason}}
  else if(!guest&&data.kind==='rpc'&&peerGame){let result;try{const current=data.method==='takeLoot'?peerGame.packs.find(p=>p.id===data.args?.[0])?.items?.[data.args?.[1]]:null;if(inventoryMethods.has(data.method)&&data.inventoryRevision!==(peerGame.networkInventoryRevision||0))result={ok:false,reason:'inventory_changed'};else if(data.expectedItem&&(!current||current.id!==data.expectedItem.id||current.uid!==data.expectedItem.uid))result={ok:false,reason:'item_changed'};else result=authorityAction(peerGame,data.method,data.args||[])}catch{result={ok:false,reason:'invalid_action'}}response={kind:'rpc-result',requestId:data.requestId,method:data.method,result:result===undefined?{ok:true}:typeof result==='boolean'?{ok:result}:result,self:snapshotPrivate(peerGame)};reliableWorld()}
  else if(guest&&data.kind==='world-start'){incomingWorld={revision:data.revision,fields:data.fields,full:data.full===true,rows:{},received:new Set(),ended:false}}
  else if(guest&&data.kind==='world-part'&&incomingWorld?.revision===data.revision){incomingWorld.rows[data.field]??=[];incomingWorld.rows[data.field].push(...copy(data.rows));incomingWorld.received.add(data.field);commitIncomingWorld()}
  else if(guest&&data.kind==='world-end'&&incomingWorld?.revision===data.revision){incomingWorld.ended=true;commitIncomingWorld()}
  else if(guest&&data.kind==='ready')acceptReady(data);
  else if(!guest&&data.kind==='peer-ready'&&peerGame){ready=true;peerGame.time=game.time;notify('ready',{authority:true})}
  else if(guest&&data.kind==='world-patch'){for(const field of ['chests','exits','packs'])if(Array.isArray(data.data?.[field])){if(field==='packs')game.packs=copy(data.data[field]);else game.world[field]=copy(data.data[field])}notify('world-synced',{revision:data.revision})}
  else if(guest&&data.kind==='events'){for(const item of data.events||[]){const eventId=`${message.id}-${item.playerId}-${receivedEvents.size}`;if(receivedEvents.has(eventId))continue;receivedEvents.add(eventId);if(item.playerId===localId){if(item.type==='finish')game.running=false;originalEmit(item.type,item.data)}else onRemoteEvent(item.type,item.data)}}
  else if(guest&&data.kind==='rpc-result'){if(data.self)applyPrivate(data.self);notify('rpc-result',data)}
  else if(guest&&data.kind==='entry-rejected'){stop({fallback:true});notify('entry-rejected',data)}
  processed.set(key,response);if(processed.size>512)processed.delete(processed.keys().next().value);if(response)queue(response);client.ackCommand?.(message.id,message.seq);pump();return true;
 }
 function stop({fallback=false}={}){if(!active)return;active=false;stopped=true;game.networkSession=false;game.networkPassive=false;game.emit=originalEmit;game.finish=originalFinish;
  if(fallback){if(guest){for(const p of remotePlayers)if(p?.hp>0){const bot=game.enemy({x:p.x,z:p.z,type:'sword',zone:0});Object.assign(bot,{bot:true,hp:p.hp,maxHp:p.maxHp,inventory:[],equipment:{},visited:[],state:'hunt',botCd:1,botWindup:null});game.enemies.push(bot)}game.bots=game.enemies.filter(e=>e.bot&&!e.networkHuman)}else if(peerProxy){const row=cleanEnemy(peerProxy);delete row.networkHuman;delete row.networkId;delete row.networkRole;row.inventory=copy(peerGame.bag);row.equipment=copy(peerGame.equipment);row.state='hunt';row.botCd=1;row.botWindup=null;game.enemies=game.enemies.filter(e=>e!==peerProxy).concat(row);game.bots=game.enemies.filter(e=>e.bot)}for(const e of game.enemies){e.charge=0;e.botWindup=null;if(e.type==='boss')game.cancelBossAction(e,'network-fallback');if(e.type==='mage')game.cancelMageCharge(e)}}
  else if(peerProxy){game.enemies=game.enemies.filter(e=>e!==peerProxy);game.bots=game.bots.filter(e=>e!==peerProxy)}
  reliable.length=eventBatch.length=0;peerGame=null;peerProxy=hostProxy=null;remotePlayers=[];game.networkPeers=[];notify('stopped',{fallback});
 }
 return {setAttackHeld(value){heldAttack=value===true},start,call,update,receive,stop,isGuest:()=>active&&guest,isActive:()=>active,isReady:()=>ready,getRemotePlayers:()=>copy(remotePlayers),getProjectiles:()=>active&&!guest&&peerGame?[...game.shots,...peerGame.shots]:game.shots,getStatus:()=>({active,isGuest:guest,ready,peerId,roomId:match?.roomId,reliableQueued:reliable.length}),getAuthorityPeer:()=>!guest?peerGame:null};
}

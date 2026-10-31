export const LOOT_INTERACTION_SECONDS=Object.freeze({monster:3,chest:4,white:6,bot:6,garden:4,pond:20,synthesis:3});

/** bonus is a fraction: 1 = +100% interaction speed. Never reduce time by more than 80%. */
export function lootInteractionDuration(kind,bonus=0,baseOverride=null){
 const base=baseOverride??LOOT_INTERACTION_SECONDS[kind];
 if(!Number.isFinite(base)||base<=0)return null;
 const speed=Number.isFinite(bonus)?Math.max(0,bonus):0;return Math.max(base*.2,base/(1+speed));
}
const point=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z)?{x:p.x,z:p.z}:null;
const validId=id=>typeof id==='string'?id.trim().length>0:typeof id==='number'&&Number.isFinite(id);

/** Per-run read controller. It emits intents only; the game owns containers, loot and modal state. */
export function createLootInteractionController(){
 const unlocked=new Set();let active=null,opened=null,state='idle',reason=null,sequence=0;
 const keyOf=source=>`${source.kind}:${typeof source.id}:${source.id}`;
 function open(source,alreadyUnlocked){
  active=null;opened={...source};unlocked.add(source.key);state='open';reason=null;
  return {type:'open',id:source.id,kind:source.kind,position:source.position?{...source.position}:null,duration:source.duration,alreadyUnlocked,sequence:++sequence};
 }
 function cancel(why='cancelled'){
  const previous=active??opened;active=null;opened=null;state='cancelled';reason=why;
  return previous?{type:'cancel',id:previous.id,kind:previous.kind,reason:why}:null;
 }
 function begin(source,{interactionSpeed=0,position=null,sessionId}={}){
  if(!source||!validId(source.id)||!Object.hasOwn(LOOT_INTERACTION_SECONDS,source.kind))return {ok:false,reason:'invalid_source'};
  const duration=lootInteractionDuration(source.kind,interactionSpeed,source.durationSeconds??null);
  if(duration===null)return {ok:false,reason:'invalid_duration'};
  const origin=position===null?null:point(position);if(position!==null&&!origin)return {ok:false,reason:'invalid_position'};
  const at=source.position===undefined?null:point(source.position);if(source.position!==undefined&&!at)return {ok:false,reason:'invalid_source_position'};
  const candidate={id:source.id,kind:source.kind,position:at,duration,origin,sessionId};candidate.key=keyOf(candidate);
  if(active?.key===candidate.key)return {ok:true,status:'already_reading',duration:active.duration,intent:null};
  if(opened?.key===candidate.key)return {ok:true,status:'already_open',duration:opened.duration,intent:null};
  active=null;opened=null;reason=null;
  if(unlocked.has(candidate.key))return {ok:true,status:'open',duration:0,intent:open(candidate,true)};
  active={...candidate,elapsed:0};state='reading';return {ok:true,status:'reading',duration,intent:null};
 }
 function update(dt,{running=true,alive=true,moving=false,position=null,inRange=true,visible=true,controlled=false,sourceExists=true,sessionId}={}){
  if(!active)return null;
  const interruption=!running?'not_running':!alive?'dead':controlled?'controlled':!sourceExists?'source_removed':!inRange?'out_of_range':!visible?'blocked':moving?'moved':active.sessionId!==undefined&&sessionId!==undefined&&active.sessionId!==sessionId?'new_session':null;
  if(interruption){cancel(interruption);return null}
  if(active.sessionId===undefined&&sessionId!==undefined)active.sessionId=sessionId;
  if(position!==null){const current=point(position);if(!current){cancel('invalid_position');return null}if(!active.origin)active.origin=current;else if(Math.hypot(current.x-active.origin.x,current.z-active.origin.z)>1e-4){cancel('moved');return null}}
  if(!Number.isFinite(dt)||dt<=0)return null;
  active.elapsed=Math.min(active.duration,active.elapsed+dt);
  // A small tolerance avoids requiring an extra frame after 180 steps of 1/60s.
  return active.elapsed+1e-9>=active.duration?open(active,false):null;
 }
 function close(){active=null;opened=null;state='idle';reason=null}
 function reset(){unlocked.clear();active=null;opened=null;state='idle';reason=null}
 function getStatus(){const source=active??opened;return {state,reason,id:source?.id??null,kind:source?.kind??null,position:source?.position?{...source.position}:null,reading:!!active,open:!!opened,duration:source?.duration??0,elapsed:active?.elapsed??(opened?opened.duration:0),remaining:active?Math.max(0,active.duration-active.elapsed):0,progress:active?Math.min(1,active.elapsed/active.duration):opened?1:0,unlockedCount:unlocked.size}}
 return {begin,update,cancel,close,reset,getStatus,status:getStatus,isUnlocked:(id,kind)=>unlocked.has(keyOf({id,kind}))};
}

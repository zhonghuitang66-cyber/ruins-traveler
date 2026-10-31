import {captureRaid,restoreRaid} from './raid-checkpoint.js';

/** Reserve ownership, checkpoint, then launch. Controls are enabled only afterward. */
export function enterCampRaid({world,store,checkpoint,kind,idFactory=()=>globalThis.crypto.randomUUID()}){
 const saved=checkpoint.read();let camp=store.load();
 const fail=status=>{world.running=false;world.player=null;world.enemies=[];return {ok:false,status}};
 if(saved?.invalid)return fail('corrupt_checkpoint');if(camp.readOnly)return fail(camp.status);
 if(saved?.pendingSettlement&&!camp.settlements.includes(saved.pendingSettlement.id))return fail('pending_settlement');
 if(saved?.pendingAbandon&&camp.expedition?.id===saved.pendingAbandon)return fail('pending_abandon');
 const resume=saved?.state==='active'&&!camp.settlements.includes(saved.sessionId);
 if(camp.expedition?.phase==='prepared'&&(!resume||camp.expedition.id!==saved.sessionId)){
  const cancelled=store.cancelPreparedRun(camp.expedition.id);if(!cancelled.ok)return fail(cancelled.status);camp=store.load();
 }
 if(resume){
  if(camp.expedition&&camp.expedition.id!==saved.sessionId)return fail('expedition_pending');
  world.start(saved.kind,{bagCapacity:camp.capacity});if(!restoreRaid(world,saved))return fail('corrupt_checkpoint');
  if(camp.expedition?.phase==='prepared'){const launched=store.launchRun(saved.sessionId);if(!launched.ok)return fail(launched.status)}
  return {ok:true,id:saved.sessionId,resumed:true};
 }
 if(camp.expedition)return fail('expedition_pending');
 const id=idFactory(),prepared=store.prepareRun(id,kind);if(!prepared.ok)return fail(prepared.status);
 world.start(kind,{bagCapacity:prepared.capacity,loadout:prepared.expedition.loadout,cargo:prepared.expedition.cargo});
 if(!checkpoint.write(captureRaid(world,id))){store.cancelPreparedRun(id);return fail('checkpoint_write_failed')}
 const launched=store.launchRun(id);
 if(!launched.ok){const cancelled=store.cancelPreparedRun(id);if(cancelled.ok)checkpoint.close(id);return fail(launched.status)}
 return {ok:true,id,resumed:false};
}

export function abandonCampRaid({store,checkpoint,id,pendingFirstKills=[]}){
 const state=store.load();let result={ok:true,status:'already_closed'};
 if(state.readOnly)result={ok:false,status:state.status};
 else if(state.expedition){
  if(state.expedition.id!==id)result={ok:false,status:'expedition_pending'};
  else result=state.expedition.phase==='active'?store.abandonRun(id):store.cancelPreparedRun(id);
 }
 checkpoint.close(id,pendingFirstKills,null,result.ok?null:id);
 return result;
}

/** Display-only history. These functions never write authoritative bodies. */
export const NETWORK_VISUAL_DEFAULTS=Object.freeze({delay:.125,maxExtrapolation:.1,maxExtrapolationDistance:.35,teleportDistance:3,resetGap:.6,movingHold:.2});
export const emptyNetworkPose=()=>({samples:[],lastKey:null,movingUntil:-Infinity,direction:null});

/** Pure reducer: a snapshot key identifies reception, not a render frame. */
export function appendNetworkPose(state,pose,at,key,options={}){
 const config={...NETWORK_VISUAL_DEFAULTS,...options};
 if(!pose||![pose.x,pose.z,at].every(Number.isFinite)||key===state.lastKey)return state;
 const previous=state.samples.at(-1);if(previous&&at<=previous.at)return state;
 const alive=pose.alive!==false,distance=previous?Math.hypot(pose.x-previous.x,pose.z-previous.z):0;
 const reset=!previous||!alive||!previous.alive||distance>config.teleportDistance||at-previous.at>config.resetGap;
 const sample={x:pose.x,z:pose.z,alive,at},moved=!reset&&distance>.001;
 return {samples:reset?[sample]:[...state.samples.filter(row=>row.at>=at-.5).slice(-63),sample],lastKey:key,movingUntil:!alive||reset?-Infinity:moved?at+config.movingHold:state.movingUntil,direction:reset?null:moved?{x:pose.x-previous.x,z:pose.z-previous.z}:state.direction};
}

/** Pure sampler: delayed interpolation and bounded short extrapolation only. */
export function sampleNetworkPose(state,now,{connected=true,...options}={}){
 const config={...NETWORK_VISUAL_DEFAULTS,...options},samples=state.samples,last=samples.at(-1);if(!last)return null;
 const result={x:last.x,z:last.z,alive:last.alive,moving:connected&&last.alive&&now<state.movingUntil,direction:state.direction};
 if(!connected||!last.alive||samples.length<2)return {...result,moving:false};
 const target=now-config.delay;
 if(target<=samples[0].at)return {...result,x:samples[0].x,z:samples[0].z};
 for(let i=1;i<samples.length;i++)if(target<=samples[i].at){const a=samples[i-1],b=samples[i],t=(target-a.at)/(b.at-a.at);return {...result,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t}}
 const previous=samples.at(-2),duration=last.at-previous.at;
 if(duration<=0)return {...result,moving:false};
 const ahead=Math.max(0,Math.min(config.maxExtrapolation,target-last.at)),dx=(last.x-previous.x)/duration*ahead,dz=(last.z-previous.z)/duration*ahead,length=Math.hypot(dx,dz),scale=length>config.maxExtrapolationDistance?config.maxExtrapolationDistance/length:1;
 return {...result,x:last.x+dx*scale,z:last.z+dz*scale};
}

export function createNetworkVisualPose(options){let state=emptyNetworkPose();return {push(pose,at,key){state=appendNetworkPose(state,pose,at,key,options)},sample(now,extra){return sampleNetworkPose(state,now,{...options,...extra})},reset(){state=emptyNetworkPose()}}}

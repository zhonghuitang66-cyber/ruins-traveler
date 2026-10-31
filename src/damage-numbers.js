// Formatting never parses/rounds a combat value: the core's original text is authoritative.
const TYPES=new Set(['damage','hurt','heal']);
export function describeDamageNumber(value,type='damage'){
 const text=String(value),bitmap=text.length<=32&&/^[+-]?\d+(?:\.\d+)?$/.test(text);
 return {text,type:TYPES.has(type)?type:'damage',bitmap,tokens:bitmap?Array.from(text,c=>c==='.'?-1:'0123456789+-'.indexOf(c)):[]};
}
export const NUMBER_LANES=Object.freeze([Object.freeze({xOffset:0,yOffset:0}),Object.freeze({xOffset:-48,yOffset:-32}),Object.freeze({xOffset:48,yOffset:-32}),Object.freeze({xOffset:0,yOffset:-64})]);
// Reuse the existing capped active-number list; no accumulating position map/timer queue.
export function placeDamageNumber(active,source,time){
 const counts=[0,0,0,0];
 if(Number.isFinite(time)&&Number.isFinite(source?.x)&&Number.isFinite(source?.z))for(let i=Math.max(0,active.length-24);i<active.length;i++){
  const n=active[i],age=time-n.bornAt;
  if(age>=0&&age<=1&&Math.hypot(n.x-source.x,n.z-source.z)<=1.5&&Number.isInteger(n.lane)&&n.lane>=0&&n.lane<4)counts[n.lane]++;
 }
 const lane=counts.indexOf(Math.min(...counts));return {lane,...NUMBER_LANES[lane],bornAt:Number.isFinite(time)?time:0};
}


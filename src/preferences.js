import {LAYOUT} from './data.js';

export const QUALITY={
 economy:{pixelRatio:1,shadows:false},
 standard:{pixelRatio:1.5,shadows:true},
 detail:{pixelRatio:2,shadows:true}
};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value,fallback,min,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
export function parseMinimumCellValue(value){
 if(typeof value==='string'){if(!/^[0-9]{1,16}$/.test(value))return null;value=Number(value)}
 return Number.isSafeInteger(value)&&value>0?value:null;
}
export function cleanSettings(value){
 const raw=record(value)?value:{};
 return {volume:bounded(raw.volume,.6,0,1),muted:raw.muted===true,reducedFlash:raw.reducedFlash===true,shake:Math.round(bounded(raw.shake,1,0,3)),quality:typeof raw.quality==='string'&&Object.hasOwn(QUALITY,raw.quality)?raw.quality:'detail',minimumCellValue:parseMinimumCellValue(raw.minimumCellValue)??40};
}
export function cleanLayout(value){
 const raw=record(value)?value:{};
 return Object.fromEntries(Object.entries(LAYOUT).map(([id,def])=>{
  const v=record(raw[id])?raw[id]:{};
  return [id,{x:bounded(v.x,def.x,0,1),y:bounded(v.y,def.y,0,1),size:bounded(v.size,def.size,64,260)}];
 }));
}

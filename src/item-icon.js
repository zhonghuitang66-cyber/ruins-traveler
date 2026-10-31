import {ITEM_DEFINITIONS,itemRarity,RARITY_META} from './equipment.js';
/** Runtime alpha-silhouette outline, so rolled equipment quality never bakes into art. */
export function applyQualityOutline(img,rarity='white'){
 const key=Object.hasOwn(RARITY_META,rarity)?rarity:'white',color=RARITY_META[key].color;
 // Four composed cardinal shadows produce a thin closed outline, including alpha holes.
 const outline=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>`drop-shadow(${x}px ${y}px 0 ${color})`).join(' ');
 img.style.setProperty('--item-outline',outline);img.style.setProperty('--item-quality-color',color);
 if(!String(img.className||'').split(/\s+/).includes('item-icon'))img.className=(String(img.className||'')+' item-icon').trim();
 return img;
}
export function createItemIcon(row,{alt=''}={}){
 const def=ITEM_DEFINITIONS[row?.id];if(!def)return null;const img=document.createElement('img');img.src=`assets/item-icons/${row.id}.webp`;img.alt=alt;img.draggable=false;img.decoding='async';img.onerror=()=>img.remove();return applyQualityOutline(img,itemRarity(row));
}

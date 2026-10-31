import {createItemIcon} from './item-icon.js';
import {ITEM_DEFINITIONS,itemDimensions,itemRarity,RARITY_META,itemValue,sellPerCell} from './equipment.js';
import {gridSize,packGrid} from './grid-inventory.js';
export function renderLootContainer(entry,{take,open,describe}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const section=el('section',undefined,'loot-container'),heading=el('div',entry.name,'loot-heading');section.append(heading);
 if(entry.kind==='chest'){const b=el('button',entry.interactionLabel||'打开宝箱');b.onclick=()=>open(entry);heading.append(b);return section}
 const capacity=entry.capacity||20,size=gridSize(capacity),packed=packGrid(entry.items,[],{capacity}),grid=el('div',undefined,'bag-grid loot-grid');grid.style.setProperty('--cols',size.width);grid.style.setProperty('--rows',size.height);heading.append(el('small',` ${packed.used}/${capacity} 格`));section.append(grid);
 for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){const cell=el('span',undefined,'bag-cell');cell.style.gridColumn=x+1;cell.style.gridRow=y+1;grid.append(cell)}
 // The view may pack missing legacy positions, but pickup always uses the original row index.
 const mapped=new Set();packed.bag.forEach((row,index)=>{const original=entry.items.findIndex((r,i)=>!mapped.has(i)&&(row.uid?r.uid===row.uid:r.id===row.id&&r.n===row.n));mapped.add(original);const d=itemDimensions(row),b=el('button',undefined,'grid-item loot-icon');b.style.gridColumn=`${row.x+1} / span ${d.w}`;b.style.gridRow=`${row.y+1} / span ${d.h}`;b.style.setProperty('--rarity',RARITY_META[itemRarity(row)].color);b.title=describe(row);b.setAttribute('aria-label',`${ITEM_DEFINITIONS[row.id].name}，${itemValue(row)}价值，点击查看`);const img=createItemIcon(row,{alt:ITEM_DEFINITIONS[row.id].name});b.append(img);if(row.n>1)b.append(el('small','×'+row.n));b.onclick=()=>{section.querySelector('.loot-detail')?.remove();const detail=el('div',undefined,'loot-detail');detail.append(el('span',`${ITEM_DEFINITIONS[row.id].name} · ${RARITY_META[itemRarity(row)].name} · ${d.w}×${d.h}格 · ${itemValue(row)}价值 · 单格${sellPerCell(row).toFixed(1)}`));const pick=el('button','拾取');pick.onclick=()=>take(entry,original>=0?original:index);detail.append(pick);section.append(detail)};grid.append(b)});
 return section;
}

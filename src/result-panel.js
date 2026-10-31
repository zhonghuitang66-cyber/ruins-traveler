import {createItemIcon} from './item-icon.js';
import {ITEM_DEFINITIONS,itemRarity,itemValue,RARITY_META} from './equipment.js';

export function renderExtractionItems(root,items,{sold=false}={}){
 root.replaceChildren();root.classList.add('result-icon-grid');
 for(const row of items){
  if(sold&&row.id!=='coin'&&['white','green','blue'].includes(itemRarity(row)))continue;
  const card=document.createElement('div');card.className='result-item';card.style.setProperty('--rarity',RARITY_META[itemRarity(row)].color);
  const icon=createItemIcon(row,{alt:ITEM_DEFINITIONS[row.id].name});if(icon)card.append(icon);
  const name=document.createElement('strong');name.textContent=ITEM_DEFINITIONS[row.id].name;
  const text=document.createElement('span');text.textContent=`×${row.n} · ${itemValue(row)}价值`;card.append(name,text);root.append(card);
 }
 if(!root.children.length){const empty=document.createElement('p');empty.textContent=sold?'蓝色及以下物品已出售。':'本次没有带回物品。';root.append(empty)}
}

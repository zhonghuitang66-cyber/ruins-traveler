import {createItemIcon} from './item-icon.js';
import {ITEM_DEFINITIONS,EQUIPMENT_SLOTS,SLOT_NAMES,STAT_NAMES,RARITY_META,itemRarity,itemDimensions,itemValue,sellPerCell,isEquipment,canEquip} from './equipment.js';
import {gridSize} from './grid-inventory.js';
export function createInventoryPanel({world,toast,usePotion}){
 const formatStat=(stat,value)=>stat==='hpPercent'||stat.includes('Speed')?`${Math.round(value*10000)/100}%`:stat==='moveRating'?`${value}（+${value}%基础移速）`:value;
 const effectDescriptions={bladeWind:'普攻额外释放一段剑气。',guardianRobe:'每次成功施放技能回复1%最大生命。',ruinPearl:'普攻附加30%魔攻的魔法伤害，最低1点。',burstBoots:'每次成功施放技能扣除5%最大生命（最低保留1生命），移速额外提高20%，持续5秒。',blinkBoots:'闪避距离翻倍。'};
 const root=document.getElementById('bagItems');let selection=null;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node};
 function button(text,action,parent){const b=el('button',text);b.type='button';b.onclick=action;parent.append(b);return b}
 function run(action,{clearOnSuccess=false}={}){const result=action();if(result?.ok===false)toast(({wrong_class:'职业无法使用这类武器',bag_full:'背包没有足够的连续空格',no_space:'该位置放不下物品',inactive:'当前无法操作'})[result.reason]||'当前无法操作');if(clearOnSuccess&&result?.ok===true)selection=null;render()}
 function itemButton(row){const meta=RARITY_META[itemRarity(row)],b=el('button',undefined,'grid-item');b.style.setProperty('--rarity',meta.color);b.title=ITEM_DEFINITIONS[row.id].name;const img=createItemIcon(row);b.append(img,el('span',ITEM_DEFINITIONS[row.id].name));if(row.n>1)b.append(el('small','×'+row.n));return b}
 function render(){
  root.replaceChildren();const shell=el('div',undefined,'bag-columns'),equipped=el('div',undefined,'equipped-grid'),bag=el('div',undefined,'bag-region'),details=el('div',undefined,'item-details');shell.append(equipped,bag,details);root.append(shell);
  for(const slot of EQUIPMENT_SLOTS){const row=world.equipment?.[slot],wrap=el('div',undefined,'equipment-slot');wrap.append(el('small',SLOT_NAMES[slot]));const b=itemButton(row||{id:({weapon:world.kind==='archer'?'short_bow':'rust_sword',head:'iron_helm',chest:'leather_coat',gloves:'leather_gloves',legs:'guard_legs',boots:'path_boots',ring:'amber_ring',amulet:'dawn_amulet'})[slot],n:1});if(!row){b.className+=' empty-equipment';b.title=SLOT_NAMES[slot]+' · 未穿戴'}b.onclick=()=>{selection={slot};render()};wrap.append(b);equipped.append(wrap)}
  const size=gridSize(world.bagCapacity),used=world.bag.reduce((n,r)=>{const d=itemDimensions(r);return n+d.w*d.h},0);bag.append(el('p',`随身背包 ${used} / ${size.capacity} 格`));const grid=el('div',undefined,'bag-grid');grid.style.setProperty('--cols',size.width);bag.append(grid);
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){const cell=el('button',undefined,'bag-cell');cell.setAttribute('aria-label',`第${y+1}行第${x+1}格`);cell.style.gridColumn=x+1;cell.style.gridRow=y+1;cell.onclick=()=>{if(selection?.index!==undefined){const row=world.bag[selection.index];run(()=>world.moveBagItem(selection.index,x,y,{rotated:!!row?.rotated}))}};grid.append(cell)}
  world.bag.forEach((row,index)=>{const d=itemDimensions(row),b=itemButton(row);b.style.gridColumn=`${row.x+1} / span ${d.w}`;b.style.gridRow=`${row.y+1} / span ${d.h}`;b.classList.toggle('selected',selection?.index===index);b.onclick=()=>{selection={index};render()};grid.append(b)});
  button('一键整理',()=>run(()=>{const result=world.sortBag();if(result.ok)selection=null;return result}),bag);bag.append(el('small','选择物品，再点空格移动；可旋转。已装备不占背包。','bag-help'));
  const row=selection?.slot?world.equipment?.[selection.slot]:world.bag[selection?.index];
  if(!row){details.append(el('h3','遗迹行囊'),el('p','选择装备或背包物品查看详情。'),el('p','成功撤离才能保住战利品，死亡会失去局内装备。'));return}
  const def=ITEM_DEFINITIONS[row.id],d=itemDimensions(row),meta=RARITY_META[itemRarity(row)];details.append(el('h3',def.name),el('p',`${meta.name} · ${d.w}×${d.h} 格`));details.firstChild.style.color=meta.color;
  details.append(el('p',`总价值 ${itemValue(row)} · 单格 ${sellPerCell(row).toFixed(1)}`));
  for(const [stat,value]of Object.entries({...def.baseStats,...row.baseRolls}))details.append(el('div',`${STAT_NAMES[stat]} +${formatStat(stat,value)}`));
  for(const a of row.affixes||[])details.append(el('div',`${STAT_NAMES[a.stat]} +${formatStat(a.stat,a.value)}`,'item-affix'));
  if(effectDescriptions[def.effect])details.append(el('p',effectDescriptions[def.effect]));
  if(def.description)details.append(el('p',def.description));
  if(selection.slot)button('卸下装备',()=>{const slot=selection.slot;run(()=>world.unequipItem(slot),{clearOnSuccess:true})},details);
  else{const index=selection.index;if(isEquipment(row)){const b=button(canEquip(row,world.kind)?'装备':'职业不符',()=>run(()=>world.equipItem(index),{clearOnSuccess:true}),details);b.disabled=!canEquip(row,world.kind)}if(['health','mana','speed_potion'].includes(row.id))button('使用药水',()=>{if(usePotion(row.id))selection=null;render()},details);button('旋转',()=>run(()=>world.moveBagItem(index,row.x,row.y,{rotated:!row.rotated})),details);button('放在脚下',()=>run(()=>world.dropItem(index),{clearOnSuccess:true}),details)}
 }
 return {render,reset(){selection=null;render()}};
}

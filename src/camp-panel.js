import {ITEM_DEFINITIONS,EQUIPMENT_SLOTS,SLOT_NAMES,STAT_NAMES,RARITY_META,itemRarity,itemValue,canEquip,isEquipment,getEquipmentStats} from './equipment.js';
import {canCarryFromCamp} from './inventory.js';
import {createItemIcon} from './item-icon.js';

/** Persistent selections are references, not copies. Ownership moves at prepareRun. */
export function createCampPanel({store,getRole=()=> 'swordsman',onChange=()=>{},onCollection=()=>{},toast=()=>{}}){
 let root=null;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const button=(text,fn,parent)=>{const n=el('button',text);n.type='button';n.onclick=fn;parent.append(n);return n};
 const role=()=>typeof getRole==='function'?getRole():getRole;
 const errors={write_failed:'保存失败，选择和物品均已保留',save_conflict:'仓库已更新，请重新选择',cargo_limit:'作战包最多携带5件，总数量不能超过5',insufficient_items:'仓库物品不足',wrong_class:'当前职业无法使用',expedition_pending:'请先处理未结束的出战',gear_not_found:'装备已不在仓库'};
 function change(action){const result=action();if(!result.ok)toast(errors[result.status]||'暂时无法保存选择');else onChange(result);render();return result}
 function card(row,parent){const d=ITEM_DEFINITIONS[row.id],n=el('div',undefined,'camp-item');n.style.setProperty('--rarity',RARITY_META[itemRarity(row)].color);const icon=createItemIcon(row,{alt:d.name});if(icon)n.append(icon);n.append(el('strong',d.name),el('span',`${RARITY_META[itemRarity(row)].name} · ${itemValue(row)}价值${row.n>1?' · ×'+row.n:''}`));parent.append(n);return n}
 function render(target){if(target)root=target;if(!root)return;root.replaceChildren();const state=store.load(),currentRole=role(),selection=state.campSelections[currentRole]||{},selected=new Set(Object.values(selection)),blocked=state.readOnly||!!state.expedition;
  root.append(el('h3','营地出战准备'),el('p','点击仓库装备穿戴；出发时装备与作战包从营地移入本局。死亡或迷失会失去本局携带物。'));
  if(state.readOnly)root.append(el('p','存档暂不可写，原数据已保留。'));
  const loadout=el('div',undefined,'camp-loadout');root.append(loadout);const actual={};
  for(const slot of EQUIPMENT_SLOTS){const wrap=el('div',undefined,'camp-equipment-slot'),uid=selection[slot],row=state.gear.find(r=>r.uid===uid)||Object.values(state.expedition?.loadout||{}).find(r=>r.uid===uid);wrap.append(el('small',SLOT_NAMES[slot]));if(row){actual[slot]=row;card(row,wrap);button('卸下',()=>change(()=>store.setCampEquipment(currentRole,slot,null)),wrap).disabled=blocked}else{wrap.append(el('span',uid?'装备已失去，请重新选择':'未穿戴'));if(uid)button('清除失效选择',()=>change(()=>store.setCampEquipment(currentRole,slot,null)),wrap).disabled=blocked}loadout.append(wrap)}
  const stats=getEquipmentStats(actual,currentRole),summary=Object.entries(stats).filter(([,v])=>v).map(([k,v])=>`${STAT_NAMES[k]} +${k.includes('Speed')||k==='hpPercent'?Math.round(v*10000)/100+'%':k==='moveRating'?v+'点（'+v+'%）':Math.round(v*100)/100}`).join(' · ');if(summary)root.append(el('p',summary,'camp-stats'));
  const cargo=state.campCargo,total=Object.values(cargo).reduce((n,v)=>n+v,0),pack=el('div',undefined,'camp-cargo');pack.append(el('h3',`作战包 ${total}/5件`),el('p','按物品总数量计数，最多5件；仅携带道具、材料、消耗品。金币与收藏宝物留在营地。'));
  const cargoItems=Object.entries(state.items).filter(([id,n])=>canCarryFromCamp(id)&&n>0);for(const [id,n]of cargoItems){const row=card({id,n},pack),amount=cargo[id]||0;button('−',()=>change(()=>store.setCampCargo(id,Math.max(0,amount-1))),row).disabled=blocked||amount===0;row.append(el('b',`${amount}件`));button('+',()=>change(()=>store.setCampCargo(id,amount+1)),row).disabled=blocked||total>=5||amount>=n}
  if(!cargoItems.length)pack.append(el('p','营地暂无可携带道具。'));root.append(pack);
  const warehouse=el('div',undefined,'camp-warehouse');warehouse.append(el('h3',`营地仓库 · ${state.items.coin||0}旧金币`));
  for(const row of state.gear){const n=card(row,warehouse),equippable=canEquip(row,currentRole),isSelected=selected.has(row.uid);const b=button(isSelected?'已穿戴':equippable?'穿戴 / 替换':'职业不符',()=>change(()=>store.setCampEquipment(currentRole,ITEM_DEFINITIONS[row.id].slot,row.uid)),n);b.disabled=blocked||!equippable||isSelected}
  for(const [id,n]of Object.entries(state.items))if(id!=='coin')card({id,n},warehouse);if(!state.gear.length&&!Object.keys(state.items).some(id=>id!=='coin'))warehouse.append(el('p','仓库暂无物品。'));root.append(warehouse);button(`打开红色收藏 · ${state.collection.length}/100`,()=>onCollection(state),root);
 }
 return {render,getLoadout(){return {...(store.load().campSelections[role()]||{})}},getCargo(){return {...store.load().campCargo}}};
}

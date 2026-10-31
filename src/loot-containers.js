import {ITEM_DEFINITIONS,isEquipment,itemDimensions,itemRarity,rollEquipment,rollLootEquipment} from './equipment.js';
import {packGrid} from './grid-inventory.js';
const sample=rng=>{const n=rng();return Number.isFinite(n)?Math.max(0,Math.min(1-Number.EPSILON,n)):.5};
const choose=(rows,rng)=>rows[Math.floor(sample(rng)*rows.length)];
const area=row=>{const d=itemDimensions(row);return d.w*d.h};
const collectibles=Object.keys(ITEM_DEFINITIONS).filter(id=>ITEM_DEFINITIONS[id].kind==='collectible'||['coin','scrap','amber','herb','health','mana'].includes(id));
const lootRow=(id,rng)=>({id,n:id==='coin'?5+Math.floor(sample(rng)*21):1});
export const LOOT_CONTAINER_RULES={melee:{capacity:20,maxCells:6,name:'近战哥布林遗骸'},ranged:{capacity:20,maxCells:10,name:'远程哥布林遗骸'},small:{capacity:30,maxCells:10,name:'遗迹小宝箱'},white:{capacity:30,maxCells:15,name:'白色加强宝箱'},boss:{capacity:30,maxCells:25,name:'领主遗骸'}};
export function rollLootContainer(type,{rng=Math.random,zone=0}={}){
 const kind=type==='boss'?'boss':type==='white'?'white':type==='small'?'small':type==='bow'||type==='mage'?'ranged':'melee',rule=LOOT_CONTAINER_RULES[kind];
 const budget=1+Math.floor(sample(rng)*rule.maxCells);let bag=[];const seen=new Set();
 function add(row){if(!row||seen.has(row.id))return false;const result=packGrid(bag,[row],{capacity:rule.capacity});if(result.remainder.length||result.used>budget)return false;bag=result.bag;seen.add(row.id);return true}
 if(kind==='white')add({id:'silver_coin',n:1});
 if(kind==='boss'){const rolled=rollLootEquipment('boss',{rng,zone})[0];if(area(rolled)<=budget)add(rolled);else add(rollEquipment('amber_ring',{rarity:rolled.rarity,rng}))}
 else if(sample(rng)<.08){const family=kind==='ranged'?'ranged':'melee',pool=Object.keys(ITEM_DEFINITIONS).filter(id=>{const d=ITEM_DEFINITIONS[id];return isEquipment(id)&&area({id})<=budget&&(d.slot!=='weapon'||d.family===family)});if(pool.length)add(rollEquipment(choose(pool,rng),{rarity:sample(rng)<.65?'white':sample(rng)<.8?'green':'blue',rng}))}
 for(let attempt=0;attempt<50;attempt++){
  const used=bag.reduce((s,row)=>s+area(row),0),remaining=budget-used;if(!remaining)break;
  const tier=sample(rng),rarity=tier<.55?'white':tier<.8?'green':tier<.93?'blue':tier<.98?'purple':tier<.997?'orange':'red';
  const available=collectibles.filter(id=>!seen.has(id)&&area({id})<=remaining),preferred=available.filter(id=>itemRarity({id})===rarity);if(!available.length)break;
  add(lootRow(choose(preferred.length?preferred:available,rng),rng));
 }
 // Singleton fallback fills any geometric pocket without increasing stack counts.
 for(const id of collectibles.filter(id=>area({id})===1&&!seen.has(id))){if(bag.reduce((s,row)=>s+area(row),0)>=budget)break;add(lootRow(id,rng))}
 return {type:kind,name:rule.name,capacity:rule.capacity,budget,used:bag.reduce((s,row)=>s+area(row),0),items:bag};
}

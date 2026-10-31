import {ITEM_DEFINITIONS,itemRarity,RARITIES,isEquipment,rollEquipment,sanitizeItemRow,getEquipmentStats} from './equipment.js';
import {packGrid} from './grid-inventory.js';

const pick=(rows,rng)=>rows[Math.min(rows.length-1,Math.floor(rng()*rows.length))];
export function rewardAtRarity(rarity,rng=Math.random){
 const pool=Object.keys(ITEM_DEFINITIONS).filter(id=>{const d=ITEM_DEFINITIONS[id];return isEquipment(id)?!d.fixedRarity||d.fixedRarity===rarity:(d.kind==='collectible'&&d.rarity===rarity)});
 if(!pool.length)return null;const id=pick(pool,rng);return isEquipment(id)?rollEquipment(id,{rarity,rng}):{id,n:1};
}
export function addRaidBuildings(game,rng=Math.random){
 const positions=game.world.floors.filter(f=>!f.ruinId&&f.type!=='enhanced').map(f=>({x:f.x-5,z:f.z+4,zone:Math.floor((f.z+90)/60)*3+Math.floor((f.x+90)/60)}));
 const choose=()=>positions.splice(Math.floor(rng()*positions.length),1)[0];
 game.world.chests=game.world.chests.filter(c=>!c.activity);
 const add=(type,name,at,seconds)=>game.world.chests.push({...at,id:`activity-${type}-${game.world.chests.length}`,activity:true,type,name,seconds,capacity:30,opened:false,packId:null});
 // The sphere stands directly across from the central chest, outside the walking corridor.
 add('synthesis','一次性合成球',{x:5,z:2,zone:4},3);
 for(let i=0;i<2;i++)add('apothecary','一次性药剂铺',choose(),0);
 const garden=choose();for(let i=0;i<4;i++)add('garden','金叶菜田',{...garden,x:garden.x+i*2},4);
 add('pond','遗迹池塘',choose(),20);
}
export function activityReward(chest,rng=Math.random){return chest.type==='garden'?rewardAtRarity(pick(['white','green','blue'],rng),rng):chest.type==='pond'?rewardAtRarity(pick(['blue','purple','orange'],rng),rng):null}

// Prepare without mutating the live bag: persistence must succeed before publish.
export function prepareSynthesis(game,chest,indices,{rng=Math.random}={}){
 if(chest.opened||chest.type!=='synthesis'||!Array.isArray(indices)||indices.length!==2||new Set(indices).size!==2)return {ok:false,reason:'invalid_selection'};
 const rows=indices.map(i=>Number.isInteger(i)?sanitizeItemRow(game.bag[i]):null);if(rows.some(r=>!r))return {ok:false,reason:'invalid_selection'};
 const highest=Math.max(...rows.map(r=>RARITIES.indexOf(itemRarity(r)))),chance=rng(),rarity=RARITIES[Math.min(5,highest+(chance<.2?1:0))];
 const output=chance<.5?rewardAtRarity(rarity,rng):null;
 const bag=game.bag.map(r=>structuredClone(r));for(const i of [...indices].sort((a,b)=>b-a)){if(bag[i].n===1)bag.splice(i,1);else bag[i].n--}
 const packed=packGrid(bag,[],{capacity:game.bagCapacity});if(packed.remainder.length)return {ok:false,reason:'invalid_bag'};
 return {ok:true,bag:packed.bag,output,rarity,resultText:output?`合成得到${ITEM_DEFINITIONS[output.id].name}`:'合成未产出物品',readyAt:game.time+Math.max(.6,3/(1+Math.max(0,getEquipmentStats(game.equipment,game.kind).interactionSpeed||0)))};
}
export function preparePotionPurchase(game,chest,id){
 if(chest.opened||chest.type!=='apothecary'||!['health','speed_potion'].includes(id))return {ok:false,reason:'invalid_purchase'};
 const price=ITEM_DEFINITIONS[id].value*5,coins=game.bag.filter(r=>r.id==='coin').reduce((n,r)=>n+r.n,0);if(coins<price)return {ok:false,reason:'insufficient_coins'};
 const bag=game.bag.map(r=>structuredClone(r));let cost=price;for(const row of bag)if(row.id==='coin'){const n=Math.min(cost,row.n);row.n-=n;cost-=n}
 const result=packGrid(bag.filter(r=>r.n>0),[{id,n:1}],{capacity:game.bagCapacity});if(result.remainder.length)return {ok:false,reason:'bag_full'};
 return {ok:true,bag:result.bag,price};
}

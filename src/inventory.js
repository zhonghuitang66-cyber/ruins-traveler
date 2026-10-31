import {ITEMS,ZONES} from './data.js';
import {sanitizeItemRow,isEquipment,canEquip,EQUIPMENT_SLOTS,itemRarity,itemValue,firstKillReward} from './equipment.js';
import {packGrid} from './grid-inventory.js';
import {ADDITIONAL_ITEMS} from './item-catalog.js';
import {findShopOffer,purchaseRow,shopPurchasePrice,resolveSale,shopSalePrice} from './shop.js';

// OpenCode Go supplied validation suggestions; Sol corrected item whitelisting
// so a new item can enter an empty warehouse. Never invoke stored accessors.
export const BAG_CAPACITY=24;
const known=id=>typeof id==='string'&&Object.hasOwn(ITEMS,id);
const count=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
const value=(obj,key)=>{
 if(!obj||typeof obj!=='object')return undefined;
 const d=Object.getOwnPropertyDescriptor(obj,key);
 return d&&Object.hasOwn(d,'value')?d.value:undefined;
};
export function cleanWarehouse(raw){
 const out={};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
 for(const id of Object.keys(ITEMS)){const n=value(raw,id);if(count(n)&&!isEquipment(id))out[id]=n}
 return out;
}
export function depositLoot(raw,loot){
 const next=cleanWarehouse(raw);
 if(!Array.isArray(loot))return next;
 for(const row of loot){const id=value(row,'id'),n=value(row,'n');if(!known(id)||!count(n))continue;next[id]=Math.min(Number.MAX_SAFE_INTEGER,(next[id]||0)+n)}
 return next;
}
export function packItems(rawBag,items,{capacity=BAG_CAPACITY}={}){return packGrid(rawBag,items,{capacity})}
export const cleanBag=(raw,options)=>packItems(raw,[],options).bag;

export const WAREHOUSE_SAVE_VERSION=2;
// Keep the existing key so corrupt/future records cannot be bypassed by a new key.
export const WAREHOUSE_SAVE_KEY='autumn-warehouse-v1';
const LEGACY_WAREHOUSE_KEY='autumn-warehouse';
const plainRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validReceipt=id=>typeof id==='string'&&id.length>0&&id.length<=128&&id===id.trim();
const clone=v=>structuredClone(v);
const emptySave=(status,readOnly=false)=>({status,readOnly,version:WAREHOUSE_SAVE_VERSION,items:{},gear:[],talents:{bagExpansion:false},capacity:24,settlements:[],expedition:null,commerceReceipts:[],firstKills:[],collection:[],campSelections:{},campCargo:{},extractionManifests:[]});
function cleanGear(raw){
 if(!Array.isArray(raw))return null;const rows=[],uids=new Set();
 for(const value of raw){const row=sanitizeItemRow(value);if(!row||!isEquipment(row)||uids.has(row.uid))return null;uids.add(row.uid);delete row.x;delete row.y;delete row.rotated;rows.push(row)}return rows;
}
const roles=['swordsman','paladin','archer'];
const selectionKey=selection=>JSON.stringify(Object.entries(selection).sort(([a],[b])=>a.localeCompare(b)));
function cleanExpedition(raw,gear,settlements){
 if(raw===null||raw===undefined)return null;
 if(!plainRecord(raw)||!validReceipt(raw.id)||!roles.includes(raw.role)||!['prepared','active'].includes(raw.phase)||!plainRecord(raw.loadout)||settlements.includes(raw.id))return false;
 const loadout={},uids=new Set(gear.map(r=>r.uid));
 for(const slot of Object.keys(raw.loadout)){const row=sanitizeItemRow(raw.loadout[slot]);if(!EQUIPMENT_SLOTS.includes(slot)||!row||!canEquip(row,raw.role,slot)||uids.has(row.uid))return false;uids.add(row.uid);delete row.x;delete row.y;delete row.rotated;loadout[slot]=row}
 const cargo=cleanCampCargo(raw.cargo??{});if(!cargo)return false;return {id:raw.id,role:raw.role,phase:raw.phase,loadout,cargo};
}
export function canCarryFromCamp(id){const d=ITEMS[id];return !!d&&id!=='coin'&&!isEquipment(id)&&d.kind!=='collectible'&&(d.kind==='consumable'||d.kind==='material'||['scrap','amber','herb','health','mana','blade','armor','charm'].includes(id))}
function cleanCampCargo(raw){if(!plainRecord(raw))return null;const out={};let total=0;for(const id of Object.keys(raw)){const n=value(raw,id);if(!canCarryFromCamp(id)||!count(n)||(total+=n)>5)return null;out[id]=n}return out}
function cleanCampSelections(raw){if(!plainRecord(raw))return null;const out={};for(const role of Object.keys(raw)){if(!roles.includes(role)||!plainRecord(raw[role]))return null;const slots={},seen=new Set();for(const slot of Object.keys(raw[role])){const uid=value(raw[role],slot);if(!EQUIPMENT_SLOTS.includes(slot)||typeof uid!=='string'||!uid.length||uid.length>128||seen.has(uid))return null;seen.add(uid);slots[slot]=uid}out[role]=slots}return out}
function cleanExtractionManifests(raw,settlements){if(!Array.isArray(raw))return null;const out=[],seen=new Set();for(const entry of raw){if(!plainRecord(entry)||!validReceipt(entry.id)||seen.has(entry.id)||!settlements.includes(entry.id)||typeof entry.sold!=='boolean'||!Array.isArray(entry.loot))return null;seen.add(entry.id);const loot=entry.loot.map(sanitizeItemRow);if(loot.some(r=>!r))return null;const uids=new Set();for(const r of loot)if(isEquipment(r)){if(uids.has(r.uid))return null;uids.add(r.uid)}out.push({id:entry.id,sold:entry.sold,loot})}return out}
// Item counts are fungible. Every camp withdrawal retires the oldest matching
// extraction entitlement, so later sales cannot reach pre-existing camp stock.
function retireExtractionLoot(state,extra){const manifests=clone(state.extractionManifests);for(const [id,n]of Object.entries(state.items)){let removed=Math.max(0,n-((extra.items??state.items)[id]||0));for(const m of manifests)for(const r of m.loot)if(!isEquipment(r)&&r.id===id&&removed>0){const take=Math.min(removed,r.n);r.n-=take;removed-=take}}
 const owned=new Set((extra.gear??state.gear).map(r=>r.uid));for(const m of manifests)m.loot=m.loot.filter(r=>isEquipment(r)?owned.has(r.uid):r.n>0);return manifests}
function cleanCommerce(raw){if(raw===undefined)return [];if(!Array.isArray(raw))return null;const seen=new Set(),rows=[];for(const r of raw){if(!plainRecord(r)||!validReceipt(r.id)||seen.has(r.id)||!['buy','sell'].includes(r.kind)||typeof r.signature!=='string'||!r.signature.length||r.signature.length>262144||!Number.isSafeInteger(r.coinsDelta)||(r.kind==='buy'?r.coinsDelta>=0:r.coinsDelta<=0))return null;seen.add(r.id);rows.push({id:r.id,kind:r.kind,signature:r.signature,coinsDelta:r.coinsDelta})}return rows}
const saleSignature=(selection,confirmedHighRarity)=>JSON.stringify([confirmedHighRarity===true,Array.isArray(selection)?selection.map(r=>[value(r,'kind'),value(r,'id')??value(r,'uid'),value(r,'n')??1]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):null]);
export function parseWarehouseSave(text){
 if(text===null||text===undefined)return emptySave('empty');
 if(typeof text!=='string')return emptySave('corrupt',true);
 let raw;try{raw=JSON.parse(text)}catch{return emptySave('corrupt',true)}
 if(!plainRecord(raw))return emptySave('corrupt',true);
 if(Object.hasOwn(raw,'version')){
  if(raw.version!==1&&raw.version!==2)return emptySave('unsupported_version',true);
  if(!plainRecord(raw.items)||!Array.isArray(raw.settlements)||!raw.settlements.every(validReceipt))return emptySave('corrupt',true);
  const items=cleanWarehouse(raw.items),settlements=[...new Set(raw.settlements)];
  const normalized=JSON.stringify(items)!==JSON.stringify(raw.items)||settlements.length!==raw.settlements.length;
  if(raw.version===1)return {...emptySave(normalized?'normalized':'migrated_v1'),items,settlements};
  const gear=cleanGear(raw.gear);if(!gear||!plainRecord(raw.talents)||typeof raw.talents.bagExpansion!=='boolean')return emptySave('corrupt',true);
  const expedition=cleanExpedition(raw.expedition,gear,settlements);if(expedition===false)return emptySave('corrupt',true);
  const commerceReceipts=cleanCommerce(raw.commerceReceipts);if(!commerceReceipts)return emptySave('corrupt',true);
  const firstKills=raw.firstKills??[],collection=raw.collection??[];if(!Array.isArray(firstKills)||!firstKills.every(t=>['mage','sword','spear','boss'].includes(t))||new Set(firstKills).size!==firstKills.length||!Array.isArray(collection)||collection.length>100)return emptySave('corrupt',true);const cleanedCollection=collection.map(sanitizeItemRow);if(cleanedCollection.some(r=>!r||r.n!==1||itemRarity(r)!=='red')||new Set([...gear,...Object.values(expedition?.loadout||{}),...cleanedCollection.filter(isEquipment)].map(r=>r.uid)).size!==gear.length+Object.keys(expedition?.loadout||{}).length+cleanedCollection.filter(isEquipment).length)return emptySave('corrupt',true);const campSelections=cleanCampSelections(raw.campSelections??{}),campCargo=cleanCampCargo(raw.campCargo??{}),extractionManifests=cleanExtractionManifests(raw.extractionManifests??[],settlements);if(!campSelections||!campCargo||!extractionManifests)return emptySave('corrupt',true);const talents={bagExpansion:raw.talents.bagExpansion};return {...emptySave(normalized?'normalized':'current'),items,gear,talents,capacity:talents.bagExpansion?28:24,settlements,expedition,commerceReceipts,firstKills:[...firstKills],collection:cleanedCollection,campSelections,campCargo,extractionManifests};
 }
 return {...emptySave('legacy'),items:cleanWarehouse(raw)};
}
/** Atomic single-client persistence; stale snapshots fail rather than overwrite. */
export function createWarehouseStore({storage,key=WAREHOUSE_SAVE_KEY,legacyKey=LEGACY_WAREHOUSE_KEY}={}){
 const resolveStorage=()=>{const candidate=storage===undefined?globalThis.localStorage:storage;if(!candidate||typeof candidate.getItem!=='function'||typeof candidate.setItem!=='function')throw Error('Storage unavailable');return candidate};
 function snapshot(){try{const target=resolveStorage(),current=target.getItem(key),legacy=current===null?target.getItem(legacyKey):null;return {...parseWarehouseSave(current===null?legacy:current),target,current,legacy,fromLegacy:current===null&&legacy!==null}}catch{return {...emptySave('storage_unavailable',true),fromLegacy:false}}}
 const publicState=s=>({status:s.status,readOnly:s.readOnly,version:s.version,items:{...s.items},gear:clone(s.gear),talents:{...s.talents},capacity:s.capacity,settlements:[...s.settlements],expedition:clone(s.expedition),commerceReceipts:clone(s.commerceReceipts),firstKills:[...s.firstKills],collection:clone(s.collection),collectionValue:s.collection.reduce((n,r)=>n+itemValue(r),0),collectionCapacity:100,campSelections:clone(s.campSelections),campCargo:clone(s.campCargo),extractionManifests:clone(s.extractionManifests),fromLegacy:s.fromLegacy});
 function commit(state,record){try{if(state.target.getItem(key)!==state.current||(state.fromLegacy&&state.target.getItem(legacyKey)!==state.legacy))return 'save_conflict';state.target.setItem(key,JSON.stringify(record));return null}catch{return 'write_failed'}}
 const record=(s,extra)=>{const next={version:2,items:{...s.items},gear:clone(s.gear),talents:{...s.talents},settlements:[...s.settlements],expedition:clone(s.expedition),commerceReceipts:clone(s.commerceReceipts),firstKills:[...s.firstKills],collection:clone(s.collection),campSelections:clone(s.campSelections),campCargo:clone(s.campCargo),extractionManifests:retireExtractionLoot(s,extra),...extra};const owned=new Map([...next.gear,...Object.values(next.expedition?.loadout||{})].map(r=>[r.uid,r]));for(const [role,slots]of Object.entries(next.campSelections))for(const [slot,uid]of Object.entries(slots))if(!owned.has(uid)||!canEquip(owned.get(uid),role,slot))delete slots[slot];for(const [id,n]of Object.entries(next.campCargo)){const available=(next.items[id]||0)+(next.expedition?.cargo?.[id]||0);if(available<n){if(available>0)next.campCargo[id]=available;else delete next.campCargo[id]}}return next};
 return {
  load(){return publicState(snapshot())},
  setCampEquipment(role,slot,uid){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(state.expedition)return fail('expedition_pending');if(!roles.includes(role)||!EQUIPMENT_SLOTS.includes(slot))return fail('invalid_loadout');const campSelections=clone(state.campSelections),selection={...(campSelections[role]||{})};if(uid===null){delete selection[slot]}else{const row=state.gear.find(r=>r.uid===uid);if(!row)return fail('gear_not_found');if(!canEquip(row,role,slot))return fail('wrong_class');selection[slot]=uid}campSelections[role]=selection;const next=record(state,{campSelections}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'selected'}},
  setCampCargo(id,n){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(state.expedition)return fail('expedition_pending');if(!canCarryFromCamp(id)||!Number.isSafeInteger(n)||n<0)return fail('invalid_cargo');if(n>(state.items[id]||0))return fail('insufficient_items');const campCargo={...state.campCargo};if(n)campCargo[id]=n;else delete campCargo[id];if(!cleanCampCargo(campCargo))return fail('cargo_limit');const next=record(state,{campCargo}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'selected'}},
  sellExtractionLowRarity(extractionId){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(state.expedition)return fail('expedition_pending');const manifest=state.extractionManifests.find(r=>r.id===extractionId);if(!manifest)return fail('extraction_not_found');if(manifest.sold)return {ok:true,...publicState(state),status:'duplicate',duplicate:true,proceeds:0};const items={...state.items},gear=clone(state.gear);let proceeds=0n;
   for(const row of manifest.loot){if(row.id==='coin'||!['white','green','blue'].includes(itemRarity(row)))continue;if(isEquipment(row)){const index=gear.findIndex(r=>r.uid===row.uid);if(index<0)return fail('manifest_conflict');gear.splice(index,1)}else{if((items[row.id]||0)<row.n)return fail('manifest_conflict');items[row.id]-=row.n;if(!items[row.id])delete items[row.id]}const price=shopSalePrice(row);if(price===null)return fail('count_overflow');proceeds+=BigInt(price)}
   if(proceeds+BigInt(items.coin||0)>BigInt(Number.MAX_SAFE_INTEGER))return fail('count_overflow');if(proceeds>0n)items.coin=Number(BigInt(items.coin||0)+proceeds);const extractionManifests=clone(state.extractionManifests);const target=extractionManifests.find(r=>r.id===extractionId);target.sold=true;target.loot=target.loot.filter(r=>r.id==='coin'||!['white','green','blue'].includes(itemRarity(r)));const next=record(state,{items,gear,extractionManifests}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'sold',duplicate:false,proceeds:Number(proceeds)};
  },
  // Lifetime guarantees are deposited directly into camp storage in the same write
  // as the flag: failed writes remain retryable; death cannot erase a first reward.
  claimFirstKill(type,{rng=Math.random}={}){
   const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!['mage','sword','spear','boss'].includes(type))return fail('invalid_enemy_type');if(state.firstKills.includes(type))return {ok:true,...publicState(state),status:'duplicate',duplicate:true};
   const row=firstKillReward(type,{rng});if(!row)return fail('invalid_reward');const items={...state.items},gear=clone(state.gear);if(isEquipment(row)){if([...gear,...state.collection,...Object.values(state.expedition?.loadout||{})].some(r=>r.uid===row.uid))return fail('duplicate_gear_uid');gear.push(row)}else{if((items[row.id]||0)>=Number.MAX_SAFE_INTEGER)return fail('count_overflow');items[row.id]=(items[row.id]||0)+1}
   const next=record(state,{items,gear,firstKills:[...state.firstKills,type]}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'rewarded',duplicate:false,reward:clone(row)};
  },
  // 100 independent one-item slots; free withdrawal, no coins or warehouse slots.
  transferCollection(direction,reference){
   const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(state.expedition)return fail('expedition_pending');const items={...state.items},gear=clone(state.gear),collection=clone(state.collection);let row;
   if(direction==='deposit'){if(collection.length>=100)return fail('collection_full');const index=gear.findIndex(r=>r.uid===reference);if(index>=0){row=gear[index];if(itemRarity(row)!=='red')return fail('red_only');gear.splice(index,1)}else{if(typeof reference!=='string'||!Object.hasOwn(ITEMS,reference)||(items[reference]||0)<1)return fail('item_not_found');row=sanitizeItemRow({id:reference,n:1});if(!row||itemRarity(row)!=='red')return fail('red_only');if(--items[reference]===0)delete items[reference]}collection.push(row)}
   else if(direction==='withdraw'){if(!Number.isSafeInteger(reference)||reference<0||reference>=collection.length)return fail('item_not_found');[row]=collection.splice(reference,1);if(isEquipment(row)){if(gear.some(r=>r.uid===row.uid))return fail('duplicate_gear_uid');gear.push(row)}else{if((items[row.id]||0)>=Number.MAX_SAFE_INTEGER)return fail('count_overflow');items[row.id]=(items[row.id]||0)+1}}
   else return fail('invalid_direction');const next=record(state,{items,gear,collection}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'transferred',item:clone(row)};
  },
  buyItem(transactionId,offerId,quantity=1){
   const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!validReceipt(transactionId))return fail('invalid_transaction_id');const signature=JSON.stringify([offerId,quantity]),previous=state.commerceReceipts.find(r=>r.id===transactionId);
   if(previous)return previous.kind==='buy'&&previous.signature===signature?{ok:true,...publicState(state),status:'duplicate',duplicate:true,coinsDelta:previous.coinsDelta}:fail('transaction_conflict');if(state.expedition)return fail('expedition_pending');const offer=findShopOffer(offerId),row=purchaseRow(offer,quantity);if(!row)return fail('invalid_offer');const price=shopPurchasePrice(row);if(price===null||price<=0)return fail('count_overflow');if((state.items.coin||0)<price)return fail('insufficient_coins');const items={...state.items},gear=clone(state.gear);items.coin-=price;if(!items.coin)delete items.coin;
   if(isEquipment(row)){if(gear.some(r=>r.uid===row.uid))return fail('duplicate_gear_uid');gear.push(row)}else{const n=items[row.id]||0;if(row.n>Number.MAX_SAFE_INTEGER-n)return fail('count_overflow');items[row.id]=n+row.n}
   const next=record(state,{items,gear,commerceReceipts:[...state.commerceReceipts,{id:transactionId,kind:'buy',signature,coinsDelta:-price}]}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'bought',duplicate:false,coinsDelta:-price,item:clone(row)};
  },
  quoteSale(selection,options={}){const state=snapshot();if(state.readOnly)return {ok:false,status:state.status};if(state.expedition)return {ok:false,status:'expedition_pending'};return resolveSale(state,selection,options)},
  sellItems(transactionId,selection,{confirmedHighRarity=false}={}){
   const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!validReceipt(transactionId))return fail('invalid_transaction_id');const signature=saleSignature(selection,confirmedHighRarity),previous=state.commerceReceipts.find(r=>r.id===transactionId);
   if(previous)return previous.kind==='sell'&&previous.signature===signature?{ok:true,...publicState(state),status:'duplicate',duplicate:true,coinsDelta:previous.coinsDelta}:fail('transaction_conflict');if(state.expedition)return fail('expedition_pending');const result=resolveSale(state,selection,{confirmedHighRarity});if(!result.ok)return fail(result.status);
   const next=record(state,{items:result.items,gear:result.gear,commerceReceipts:[...state.commerceReceipts,{id:transactionId,kind:'sell',signature,coinsDelta:result.proceeds}]}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'sold',duplicate:false,coinsDelta:result.proceeds};
  },
  prepareRun(id,role,selection,cargo){
   const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});
   if(state.readOnly)return fail(state.status);selection=selection??state.campSelections[role]??{};cargo=cargo??state.campCargo;if(!validReceipt(id))return fail('invalid_extraction_id');if(!roles.includes(role)||!plainRecord(selection)||!cleanCampCargo(cargo))return fail('invalid_loadout');if(state.settlements.includes(id))return fail('run_closed');
   if(state.expedition){if(state.expedition.id===id&&state.expedition.role===role&&state.expedition.phase==='prepared'&&selectionKey(Object.fromEntries(Object.entries(state.expedition.loadout).map(([slot,row])=>[slot,row.uid])))===selectionKey(selection)&&selectionKey(state.expedition.cargo)===selectionKey(cargo))return {ok:true,...publicState(state),status:'already_prepared'};return fail('expedition_pending')}
   const loadout={},used=new Set();for(const [slot,uid]of Object.entries(selection)){if(!EQUIPMENT_SLOTS.includes(slot)||typeof uid!=='string'||used.has(uid))return fail('invalid_loadout');const row=state.gear.find(r=>r.uid===uid);if(!row)return fail('gear_not_found');if(!canEquip(row,role,slot))return fail('wrong_class');used.add(uid);loadout[slot]=clone(row)}
   const items={...state.items};for(const [itemId,n]of Object.entries(cargo)){if((items[itemId]||0)<n)return fail('insufficient_items');items[itemId]-=n;if(!items[itemId])delete items[itemId]}const expedition={id,role,phase:'prepared',loadout,cargo:clone(cargo)},next=record(state,{items,gear:state.gear.filter(r=>!used.has(r.uid)),expedition}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'prepared'};
  },
  launchRun(id){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!validReceipt(id))return fail('invalid_extraction_id');if(!state.expedition||state.expedition.id!==id)return fail('run_not_found');if(state.expedition.phase==='active')return {ok:true,...publicState(state),status:'already_active'};const next=record(state,{expedition:{...state.expedition,phase:'active'}}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'active'}},
  cancelPreparedRun(id){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!validReceipt(id))return fail('invalid_extraction_id');if(!state.expedition||state.expedition.id!==id)return fail(state.settlements.includes(id)?'run_closed':'run_not_found');if(state.expedition.phase!=='prepared')return fail('run_active');const items={...state.items};for(const [itemId,n]of Object.entries(state.expedition.cargo)){if(n>Number.MAX_SAFE_INTEGER-(items[itemId]||0))return fail('count_overflow');items[itemId]=(items[itemId]||0)+n}const next=record(state,{items,gear:[...state.gear,...Object.values(state.expedition.loadout)],expedition:null,settlements:[...state.settlements,id]}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'cancelled'}},
  abandonRun(id){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(!validReceipt(id))return fail('invalid_extraction_id');if(!state.expedition||state.expedition.id!==id)return fail(state.settlements.includes(id)?'run_closed':'run_not_found');if(state.expedition.phase!=='active')return fail('run_not_active');const next=record(state,{expedition:null,settlements:[...state.settlements,id]}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next}),status:'abandoned'}},
  unlockBagTalent(){const state=snapshot(),fail=status=>({ok:false,...publicState(state),status});if(state.readOnly)return fail(state.status);if(state.talents.bagExpansion)return {ok:true,...publicState(state),status:'already_unlocked'};if((state.items.coin||0)<100)return fail('insufficient_coins');const items={...state.items,coin:state.items.coin-100};if(!items.coin)delete items.coin;const next=record(state,{items,talents:{bagExpansion:true}}),error=commit(state,next);if(error)return fail(error);return {ok:true,...publicState({...state,...next,capacity:28,status:'unlocked'})}},
  settle(extractionId,loot,{success=true}={}){
   const state=snapshot(),fail=status=>({ok:false,status,duplicate:false,items:{...state.items}});
   if(success!==true)return fail('not_extracted');if(!validReceipt(extractionId))return fail('invalid_extraction_id');if(state.readOnly)return fail(state.status);
   if(state.settlements.includes(extractionId))return {ok:true,status:'duplicate',duplicate:true,items:{...state.items},gear:clone(state.gear)};
   if(state.expedition&&(state.expedition.id!==extractionId||state.expedition.phase!=='active'))return fail('expedition_pending');
   if(!Array.isArray(loot))return fail('invalid_loot');const next={...state.items},gear=clone(state.gear),uids=new Set([...gear,...state.collection.filter(isEquipment)].map(r=>r.uid)),manifestLoot=[];
   for(const value of loot){const row=sanitizeItemRow(value);if(!row)return fail('invalid_loot');const tracked=manifestLoot.find(r=>!isEquipment(r)&&r.id===row.id);if(tracked){if(row.n>Number.MAX_SAFE_INTEGER-tracked.n)return fail('count_overflow');tracked.n+=row.n}else manifestLoot.push(clone(row));if(isEquipment(row)){if(uids.has(row.uid))return fail('duplicate_gear_uid');uids.add(row.uid);delete row.x;delete row.y;delete row.rotated;const reserved=Object.values(state.expedition?.loadout||{}).find(r=>r.uid===row.uid);if(reserved&&JSON.stringify(row)!==JSON.stringify(reserved))return fail('altered_reserved_gear');gear.push(row);continue}const existing=next[row.id]||0;if(row.n>Number.MAX_SAFE_INTEGER-existing)return fail('count_overflow');next[row.id]=existing+row.n}
   // Camp-owned returns are deposited normally but never become sale-button loot.
   // Stack identity cannot survive consumption/merging, so conservatively protect
   // up to the entire starting cargo quantity of each returned item type.
   const broughtUids=new Set(Object.values(state.expedition?.loadout||{}).map(r=>r.uid));
   const newlyAcquired=manifestLoot.filter(row=>{if(isEquipment(row))return !broughtUids.has(row.uid);row.n-=Math.min(row.n,state.expedition?.cargo?.[row.id]||0);return row.n>0});
   const error=commit(state,record(state,{items:next,gear,expedition:null,settlements:[...state.settlements,extractionId],extractionManifests:[...state.extractionManifests,{id:extractionId,sold:false,loot:newlyAcquired}]}));if(error)return fail(error);
   return {ok:true,status:'settled',duplicate:false,items:{...next},gear:clone(gear)};
  }
 };
}

export function rollChestLoot(zone=0,rng=Math.random){
 const sample=()=>{const n=rng();return typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(1-Number.EPSILON,n)):.5};
 const integer=(min,max)=>min+Math.floor(sample()*(max-min+1));
 const pick=ids=>ids[integer(0,ids.length-1)];
 const index=Number.isInteger(zone)&&zone>=0&&zone<ZONES.length?zone:0;
 const out=[{id:'coin',n:integer(15,25)}];
 if(sample()<.7)out.push({id:pick(['scrap','amber','herb']),n:integer(2,4)});
 if(sample()<.35)out.push({id:pick(['health','mana']),n:1});
 if(sample()<Math.min(.12,ZONES[index][1]*.03))out.push({id:pick(['blade','armor','charm']),n:1});
 return out;
}

/** Salvage batches remain independently priced rather than rarity-scaled duplicates. */
export function rollCollectibleLoot(zone=0,rng=Math.random){
 const sample=()=>{const n=rng();return Number.isFinite(n)?Math.max(0,Math.min(1-Number.EPSILON,n)):.5};
 if(sample()>=.3)return [];
 const tier=sample(),batch=tier<.65?0:tier<.94?1:2,ids=Object.keys(ADDITIONAL_ITEMS).filter(id=>ADDITIONAL_ITEMS[id].kind==='collectible').slice(batch*4,batch*4+4);
 return [{id:ids[Math.floor(sample()*ids.length)],n:1}];
}

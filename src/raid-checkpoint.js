import {CLASSES} from './data.js';
import {sanitizeItemRow,canEquip} from './equipment.js';
const KEY='autumn-active-raid-v1';
const fields=['kind','time','bag','bagCapacity','equipment','player','cool','world','enemies','spawnCorner','nextHunterAt','nextExitAt','nextId','lastLegalPosition','speedPotionUntil','burstSpeedUntil','pendingFirstKills'];
export function captureRaid(game,sessionId){
 const data={version:1,sessionId,state:'active'};
 for(const key of fields)data[key]=structuredClone(key==='enemies'?game.enemies.map(e=>{const row={...e};if(row.networkHuman){row.botCd=1;row.cd=1;row.state='hunt'}delete row.networkHuman;delete row.networkId;delete row.networkRole;delete row.botWindup;delete row.combatTarget;delete row.target;delete row.path;row.charge=0;row.bossActionId=null;return row}):game[key]);
 data.packs=structuredClone(game.packs);return data;
}
export function createRaidCheckpoint(storage=globalThis.localStorage){
 return {
  read(){try{const raw=storage.getItem(KEY);if(!raw)return null;const d=JSON.parse(raw);if(d.version!==1||typeof d.sessionId!=='string'||!['active','closed'].includes(d.state))return {invalid:true};if(d.pendingFirstKills!==undefined&&(!Array.isArray(d.pendingFirstKills)||d.pendingFirstKills.some(t=>!['mage','sword','spear','boss'].includes(t))))return {invalid:true};if(d.pendingAbandon!==undefined&&d.pendingAbandon!==null&&d.pendingAbandon!==d.sessionId)return {invalid:true};if(d.pendingSettlement&&(!Array.isArray(d.pendingSettlement.bag)||d.pendingSettlement.id!==d.sessionId||d.pendingSettlement.bag.some(r=>!sanitizeItemRow(r))))return {invalid:true};return d}catch{return {invalid:true}}},
  write(data){try{storage.setItem(KEY,JSON.stringify(data));return true}catch{return false}},
  close(sessionId,pendingFirstKills=[],pendingSettlement=null,pendingAbandon=null){return this.write({version:1,sessionId,state:'closed',pendingFirstKills,pendingSettlement,pendingAbandon})},
 };
}
export function restoreRaid(game,data){
 if(data?.state!=='active'||!Array.isArray(data.bag)||!Array.isArray(data.enemies)||!data.player||!Array.isArray(data.world?.walls)||!Number.isFinite(data.time)||data.time<0||data.time>=480)return false;
 if(![24,28].includes(data.bagCapacity)||!Array.isArray(data.cool)||data.cool.length!==3||data.cool.some(n=>!Number.isFinite(n)||n<0)||!data.equipment||Array.isArray(data.equipment)||Object.entries(data.equipment).some(([slot,row])=>!canEquip(row,data.kind,slot))||!Number.isFinite(data.player.mp)||!Number.isFinite(data.player.radius)||data.player.radius<=0||!Array.isArray(data.packs)||data.packs.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Array.isArray(p.items)||p.items.some(r=>!sanitizeItemRow(r))))return false;if(['chests','floors','trees','exits','spawns','scenery'].some(k=>!Array.isArray(data.world[k])||data.world[k].some(r=>!r||!Number.isFinite(r.x)||!Number.isFinite(r.z))))return false;if(data.enemies.some(e=>!e||!e.home||!Number.isFinite(e.home.x)||!Number.isFinite(e.home.z)||e.bot&&(!Array.isArray(e.inventory)||!Array.isArray(e.visited)||!e.equipment||!['scavenge','queued','hunt','extract'].includes(e.state))||!['sword','spear','hammer','bow','mage','boss'].includes(e.type)||!Number.isFinite(e.x)||!Number.isFinite(e.z)||!Number.isFinite(e.hp))||data.world.walls.some(w=>!w||![w.x,w.z,w.w,w.d].every(Number.isFinite))||data.bag.some(row=>!sanitizeItemRow(row))||!Number.isFinite(data.player.hp)||!['swordsman','paladin','archer'].includes(data.kind))return false;for(const key of fields)if(data[key]!==undefined)game[key]=structuredClone(data[key]);
 game.baseStats=CLASSES[game.kind];game.packs=structuredClone(data.packs||[]);game.bots=game.enemies.filter(e=>e.bot);game.events=[];game.shots=[];game.pendingAttack=null;game.cast=0;game.windActive=false;game.refreshEquipment();return true;
}

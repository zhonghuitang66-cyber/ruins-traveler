import {ITEMS} from './data.js';
import {ADDITIONAL_ITEMS} from './item-catalog.js';
export const ITEM_DEFINITIONS={...ITEMS,...ADDITIONAL_ITEMS};
export const RARITIES=['white','green','blue','purple','orange','red'];
export const EQUIPMENT_SLOTS=['weapon','head','chest','gloves','legs','boots','ring','amulet'];
export const EQUIPMENT_STATS=['atk','matk','def','mdef','hp','hpPercent','mp','moveRating','moveSpeed','attackSpeed','interactionSpeed'];
const read=(o,k)=>{if(!o||typeof o!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(o,k);return d&&Object.hasOwn(d,'value')?d.value:undefined};
const def=row=>ITEM_DEFINITIONS[typeof row==='string'?row:read(row,'id')];
const random=rng=>{const n=rng();return Number.isFinite(n)?Math.max(0,Math.min(1-Number.EPSILON,n)):0};
export const isEquipment=row=>def(row)?.kind==='equipment';
export function itemRarity(row){const d=def(row);return isEquipment(row)?(RARITIES.includes(read(row,'rarity'))?read(row,'rarity'):'white'):(d?.rarity??'white')}
export function itemDimensions(row){const d=def(row),w=d?.w??1,h=d?.h??1;return read(row,'rotated')===true?{w:h,h:w}:{w,h}}
export function sanitizeItemRow(raw){const id=read(raw,'id'),d=typeof id==='string'&&Object.hasOwn(ITEM_DEFINITIONS,id)?ITEM_DEFINITIONS[id]:null,n=read(raw,'n');if(!d||!Number.isSafeInteger(n)||n<=0)return null;const out={id,n:isEquipment(id)?1:Math.min(n,Number.MAX_SAFE_INTEGER)};if(isEquipment(id)){
 const uid=read(raw,'uid');if(typeof uid!=='string'||!uid.length||uid.length>128||!/^[-\w:.]+$/.test(uid)||n!==1)return null;
 const rarity=read(raw,'rarity');if(!RARITIES.includes(rarity)||d.fixedRarity&&d.fixedRarity!==rarity)return null;const affixes=read(raw,'affixes');if(!Array.isArray(affixes)||affixes.length!==RARITIES.indexOf(rarity))return null;
 const seen=new Set();out.uid=uid;out.rarity=rarity;out.affixes=[];for(const a of affixes){const stat=read(a,'stat'),value=read(a,'value');if(!EQUIPMENT_STATS.includes(stat)||seen.has(stat)||!Number.isFinite(value)||value<=0||value>(['moveSpeed','attackSpeed','interactionSpeed'].includes(stat)?.5:200))return null;seen.add(stat);out.affixes.push({stat,value})}
 }if(isEquipment(id)&&d.statRanges){const rolls=read(raw,'baseRolls');out.baseRolls={};for(const [stat,[min,max]] of Object.entries(d.statRanges)){const v=rolls===undefined?min:read(rolls,stat);if(!Number.isFinite(v)||v<min||v>max)return null;out.baseRolls[stat]=v}}if(!isEquipment(id)){const rarity=read(raw,'rarity'),variant=read(raw,'variant');if(rarity!==undefined){if(!RARITIES.includes(rarity))return null;out.rarity=rarity}if(variant!==undefined){if(typeof variant!=='string'||variant.length>64)return null;out.variant=variant}}const x=read(raw,'x'),y=read(raw,'y');if(Number.isSafeInteger(x)&&x>=0&&Number.isSafeInteger(y)&&y>=0){out.x=x;out.y=y}if(read(raw,'rotated')===true)out.rotated=true;return out}
export function canEquip(row,role,slot=def(row)?.slot){const clean=sanitizeItemRow(row),d=def(clean);return !!(clean&&isEquipment(clean)&&EQUIPMENT_SLOTS.includes(slot)&&slot===d.slot&&['swordsman','paladin','archer'].includes(role)&&(slot!=='weapon'||d.family===(role==='archer'?'ranged':'melee')))}
export function getEquipmentStats(equipment,role){const result=Object.fromEntries(EQUIPMENT_STATS.map(k=>[k,0])),seen=new Set();const entries=Array.isArray(equipment)?equipment.map(row=>[def(row)?.slot,row]):Object.entries(equipment||{});for(const [slot,raw]of entries){const row=sanitizeItemRow(raw);if(!row||!isEquipment(row)||seen.has(slot)||role&&!canEquip(row,role,slot)||slot!==def(row).slot)continue;seen.add(slot);for(const [stat,value]of Object.entries(def(row).baseStats||{}))if(EQUIPMENT_STATS.includes(stat)&&Number.isFinite(value))result[stat]+=value;for(const [stat,value]of Object.entries(row.baseRolls||{}))result[stat]+=value;for(const a of row.affixes)result[a.stat]+=a.value}return result}
let serial=0;
export function rollEquipment(id,{rarity='white',rng=Math.random,uid}={}){if(!isEquipment(id))return null;rarity=def(id).fixedRarity||rarity;if(!RARITIES.includes(rarity))return null;const pool=EQUIPMENT_STATS.filter(s=>!['moveRating','hpPercent'].includes(s)),affixes=[];for(let i=0;i<RARITIES.indexOf(rarity);i++){const stat=pool.splice(Math.floor(random(rng)*pool.length),1)[0],ratio=['moveSpeed','attackSpeed','interactionSpeed'].includes(stat),max=ratio?.06:stat==='hp'||stat==='mp'?24:7,value=ratio?Math.round((.02+random(rng)*max)*1000)/1000:Math.ceil(2+random(rng)*max);affixes.push({stat,value})}const baseRolls=Object.fromEntries(Object.entries(def(id).statRanges||{}).map(([stat,[min,max]])=>[stat,stat==='hpPercent'?Math.round((min+random(rng)*(max-min))*10000)/10000:Math.floor(min+random(rng)*(max-min+1))]));return sanitizeItemRow({id,n:1,baseRolls,uid:uid??globalThis.crypto?.randomUUID?.()??`gear-${Date.now()}-${++serial}`,rarity,affixes})}
export function itemValue(raw){const row=sanitizeItemRow(raw);if(!row)return 0;const d=def(row);if(!isEquipment(row))return d.value*row.n;const quality=[1,1.3,1.8,2.5,3.5,5][RARITIES.indexOf(row.rarity)],roll=row.affixes.reduce((s,a)=>s+a.value*(['moveSpeed','attackSpeed','interactionSpeed'].includes(a.stat)?100:1),0);return Math.floor(d.value*quality+roll*2)}
export function sellPerCell(row){const {w,h}=itemDimensions(row);return itemValue(row)/(w*h)}
export const EQUIPMENT_DROP_RATES={normal:.08,boss:1,bossRarity:{green:.45,blue:.35,purple:.15,orange:.045,red:.005},normalRarity:{white:.6,green:.28,blue:.1,purple:.018,orange:.002,red:0}};
export function rollLootEquipment(type,{rng=Math.random,zone=0}={}){void zone;if(type!=='boss'&&random(rng)>=EQUIPMENT_DROP_RATES.normal)return [];const probabilities=type==='boss'?EQUIPMENT_DROP_RATES.bossRarity:EQUIPMENT_DROP_RATES.normalRarity;let r=random(rng),rarity='green';for(const [key,p]of Object.entries(probabilities)){r-=p;if(r<0){rarity=key;break}}const ranged=type==='bow'||type==='mage',family=ranged?'ranged':'melee',templates=Object.keys(ADDITIONAL_ITEMS).filter(id=>isEquipment(id)&&(!def(id).fixedRarity||def(id).fixedRarity===rarity)),preferred=templates.filter(id=>{const d=def(id);return d.slot==='weapon'?d.family===family:d.slot==='chest'}),pool=random(rng)<.75?preferred:templates;return [rollEquipment(pool[Math.floor(random(rng)*pool.length)],{rarity,rng})]}
export const RARITY_META={white:{name:'普通',color:'#d8d8ce',affixCount:0},green:{name:'优秀',color:'#72bd78',affixCount:1},blue:{name:'稀有',color:'#70a8ed',affixCount:2},purple:{name:'史诗',color:'#ba88e7',affixCount:3},orange:{name:'传说',color:'#eead5d',affixCount:4},red:{name:'神话',color:'#ed7373',affixCount:5}};
export const SLOT_NAMES={weapon:'武器',head:'头盔',chest:'上衣',gloves:'手套',legs:'护腿',boots:'鞋靴',ring:'戒指',amulet:'项链'};
export const STAT_NAMES={atk:'攻击',matk:'魔攻',hpPercent:'生命加成',moveRating:'移速点数',def:'物防',mdef:'魔防',hp:'生命',mp:'法力',moveSpeed:'移速',attackSpeed:'攻速',interactionSpeed:'交互速度'};
export const validateItem=row=>sanitizeItemRow(row)!==null;

// One speed rating point = 1% of the 3m/s base speed (10 points = +10%).
export const MOVE_RATING_SCALE=.01;
export function getEquipmentEffects(equipment,role){
 const effects={bladeWind:false,ruinPearl:false,guardianRobe:false,burstBoots:false,blinkBoots:false};
 for(const [slot,raw]of Object.entries(equipment||{})){const row=sanitizeItemRow(raw);if(row&&canEquip(row,role,slot)&&def(row).effect)effects[def(row).effect]=true}return effects;
}
/** Call only after a skill successfully spends mana/starts cooldown, once per cast. */
export function equipmentSkillOutcome(equipment,role,{hp,maxHp}={}){
 const fx=getEquipmentEffects(equipment,role),max=Number.isFinite(maxHp)?Math.max(1,maxHp):1,current=Number.isFinite(hp)?Math.max(0,Math.min(max,hp)):0;
 if(current<=0)return {hp:0,healed:0,healthCost:0,speedMultiplier:1,speedDuration:0};
 const healed=fx.guardianRobe?Math.min(max-current,max*.01):0;
 const healthCost=fx.burstBoots?Math.min(Math.max(0,current+healed-1),max*.05):0;
 return {hp:current+healed-healthCost,healed,healthCost,speedMultiplier:fx.burstBoots?1.2:1,speedDuration:fx.burstBoots?5:0};
}
export function equipmentBasicAttackBonus(equipment,role,magicAttack=0){const fx=getEquipmentEffects(equipment,role);return {bladeWind:fx.bladeWind,magicDamage:fx.ruinPearl?Math.max(1,(Number.isFinite(magicAttack)?Math.max(0,magicAttack):0)*.3):0}}
export const BIG_RED_ITEMS=['crimson_garden','crimson_obelisk','crimson_throne','crimson_orrery','crimson_scepter'];
export function firstKillReward(type,{rng=Math.random}={}){if(type==='mage')return {id:'ruby_heart',n:1};if(type==='sword')return rollEquipment('blade_wind',{rarity:'purple',rng});if(type==='spear')return {id:'sun_medallion',n:1};if(type==='boss')return {id:BIG_RED_ITEMS[Math.floor(random(rng)*BIG_RED_ITEMS.length)],n:1};return null}

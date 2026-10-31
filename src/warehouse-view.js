import {cleanWarehouse} from './inventory.js';
import {ITEMS} from './data.js';
import {ITEM_DEFINITIONS,sanitizeItemRow,isEquipment,itemValue,itemDimensions,itemRarity,sellPerCell} from './equipment.js';
/** Read-only view accepts legacy item maps or the v2 load() snapshot. */
export function summarizeWarehouse(raw,rawGear=[]){
 const snapshot=raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.hasOwn(raw,'items')?raw:null;
 const items=cleanWarehouse(snapshot?snapshot.items:raw),gear=snapshot?snapshot.gear:rawGear;
 const rows=Object.entries(items).map(([id,count])=>({id,name:ITEMS[id].name,count,unitValue:ITEMS[id].value,totalValue:(BigInt(count)*BigInt(ITEMS[id].value)).toString()}));
 const seen=new Set();for(const value of Array.isArray(gear)?gear:[]){const row=sanitizeItemRow(value);if(!row||!isEquipment(row)||seen.has(row.uid))continue;seen.add(row.uid);const price=itemValue(row);rows.push({...row,name:ITEM_DEFINITIONS[row.id].name,count:1,unitValue:price,totalValue:String(price),dimensions:itemDimensions(row),rarity:itemRarity(row),sellPerCell:sellPerCell(row),equipment:true})}
 rows.sort((a,b)=>{const av=BigInt(a.totalValue),bv=BigInt(b.totalValue);return av===bv?a.id.localeCompare(b.id):av>bv?-1:1});
 return {rows,totalValue:rows.reduce((sum,row)=>sum+BigInt(row.totalValue),0n).toString(),gearCount:seen.size,capacity:snapshot?.capacity===28?28:24};
}

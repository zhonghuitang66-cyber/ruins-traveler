import {ADDITIONAL_ITEMS} from './item-catalog.js';
export const PLAYER_BASE_SPEED=3;
const GOBLIN_SWORD_HP=190;
export const CLASSES={
 swordsman:{name:'剑士',title:'破阵之刃',hp:420,mp:100,atk:44,def:18,mdef:10,interval:.65,range:2.2,color:0xd38b38,skills:['爆裂斩击','勇猛突刺','跳跃猛击'],cost:[25,18,30],cd:[9,7,12]},
 paladin:{name:'圣骑士',title:'曙光守望',hp:540,mp:120,atk:38,def:28,mdef:22,interval:.8,range:2,color:0xe9dca2,skills:['圣光护罩','雷霆制裁','回光返照'],cost:[24,28,35],cd:[14,11,22]},
 archer:{name:'弓箭手',title:'逐风猎影',hp:340,mp:110,atk:40,def:10,mdef:14,interval:.7,range:18,color:0x608773,skills:['惩戒射击','冰霜箭矢','风魔乱舞'],cost:[20,16,32],cd:[8,3,15]}
};
// Five times the largest other melee class base attack range.
export const ARCHER_AUTO_TARGET_RANGE=5*Math.max(CLASSES.swordsman.range,CLASSES.paladin.range);
export const TYPES={
 spear:{name:'长枪哥布林',hp:140,atk:22,def:8,mdef:5,speed:3.2,range:2.8,charge:.4,interval:1.8,color:0x7c9060},
 sword:{name:'大剑哥布林',hp:GOBLIN_SWORD_HP,atk:30,def:12,mdef:5,speed:2.8,range:2.3,charge:.55,interval:2.1,color:0x729160},
 hammer:{name:'锤哥布林',hp:280,atk:48,def:18,mdef:8,speed:2.3,range:2.8,charge:1.1,interval:3.4,color:0x8c8052},
 bow:{name:'弓箭哥布林',hp:115,atk:24,def:5,mdef:5,speed:2.7,range:16,charge:2,interval:3,color:0x8fa573},
 mage:{name:'法师哥布林',hp:135,atk:38,def:5,mdef:16,speed:2.4,range:9.1,projectileRange:9.8,aggroRange:12.6,desiredRange:7,charge:3,interval:4,color:0x8e7597},
 boss:{name:'哥布林领主',hp:GOBLIN_SWORD_HP*3,shield:GOBLIN_SWORD_HP*2,atk:42,def:35,mdef:25,speed:PLAYER_BASE_SPEED*1.2,range:3,charge:3,interval:3,color:0xbba56a}
};
export const ZONES=[['金叶入口',1,4],['断桥庭园',1.2,5],['哨塔遗址',1.4,6],['落日回廊',1.4,6],['王庭废墟',2.5,8],['炼金旧所',2,7],['旅人营地',1,4],['枯泉祭坛',1.8,7],['琥珀石阵',2.2,8]];
export const ITEMS={...ADDITIONAL_ITEMS,coin:{name:'旧金币',value:1,stack:999},scrap:{name:'铁片',value:6,stack:20},amber:{name:'琥珀',value:18,stack:20},herb:{name:'金叶草',value:8,stack:20},health:{name:'生命药水',value:60,stack:5},mana:{name:'法力药水',value:60,stack:5},blade:{name:'遗迹短刃',value:50,stack:1},armor:{name:'守卫护甲',value:60,stack:1},charm:{name:'琥珀护符',value:120,stack:1},crown:{name:'领主残冠',value:300,stack:1}};
export const LAYOUT={stick:{x:.115,y:.80,size:188},attack:{x:.919,y:.855,size:174},jump:{x:.768,y:.907,size:116},skill1:{x:.779,y:.707,size:112},skill2:{x:.857,y:.593,size:112},skill3:{x:.951,y:.582,size:112}};

import {Group} from '../vendor/three.module.js';
import {createSpriteCharacter} from './sprite-character.js';
import {createCharacterVisual} from './character-visual.js';
import {ATTACK_RELEASE_PHASE} from './attack-timing.js';

/** Stable game root prefers approved Meowa frames; absent or failed assets retain the old actor. */
export function createPreferredPlayerVisual({role,spriteCatalog,legacyCatalog,placeholder=null,camera=null,prepareModel,createSprite=createSpriteCharacter,createLegacy=createCharacterVisual}={}){
 const root=new Group();root.name='PreferredPlayerVisual';const entry=spriteCatalog?.roles?.[role],preferSprite=entry?.approved===true&&entry.clips?.idle;
 const genericCast=preferSprite&&!entry.clips.cast&&!!entry.clips.attack;
 const spriteManifest=preferSprite?{...entry,clips:{...entry.clips,...(genericCast?{cast:entry.clips.attack}:{})},baseUrl:entry.baseUrl??new URL('../assets/player-sprites/player-runtime.json',import.meta.url).href,cues:{attack:ATTACK_RELEASE_PHASE[role],...entry.cues}}:null;
 let source=preferSprite?'meowa_sprite':'legacy_3d',fallbackReason=preferSprite?null:'missing_sprite_role',released=false,generation=0;
 let active=preferSprite?createSprite({placeholder,camera}):createLegacy({placeholder,prepareModel});root.add(active.root);
 async function load(){const ticket=++generation;if(released)return {ok:false,reason:'released'};
  if(source==='meowa_sprite'){
   const result=await active.load(spriteManifest);if(ticket!==generation||released)return {ok:false,reason:'stale'};
   if(result.ok)return result;
   active.release();source='legacy_3d';fallbackReason='sprite_load_failed';active=createLegacy({placeholder,prepareModel});root.add(active.root);
  }
  const catalog=await legacyCatalog;if(ticket!==generation||released)return {ok:false,reason:'stale'};
  return active.load({...catalog?.roles?.[role],layered:true,anchorHips:true});
 }
 const forward=name=>(...args)=>released?false:active[name]?.(...args);
 function release(){if(released)return;released=true;generation++;active.release();root.removeFromParent()}
 return {root,load,release,setState:forward('setState'),setFacing:forward('setFacing'),setLocomotion:forward('setLocomotion'),playAttack:forward('playAttack'),playSkill:forward('playSkill'),setCharge:forward('setCharge'),cancelAttack:forward('cancelAttack'),setOpacity:forward('setOpacity'),setWeaponGlow:forward('setWeaponGlow'),update:forward('update'),reset:forward('reset'),getStatus:()=>({...active.getStatus(),source,spriteFallbackReason:fallbackReason,spriteDerivedFallbacks:source==='meowa_sprite'&&genericCast?['cast_uses_attack_frames']:[]})};
}

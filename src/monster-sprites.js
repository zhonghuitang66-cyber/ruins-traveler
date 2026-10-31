import {createSpriteCharacter} from './sprite-character.js';
import {TextureLoader} from '../vendor/three.module.js';

export const MONSTER_SPRITE_TYPES=['sword','hammer','spear','boss','bow','mage'];
const sharedTextures=new Map(),textureLoader=new TextureLoader();
/** Clones share Source/GPU upload while each visual owns its disposable Texture. */
async function sharedTexture(url){if(!sharedTextures.has(url))sharedTextures.set(url,textureLoader.loadAsync(url).catch(error=>{sharedTextures.delete(url);throw error}));return (await sharedTextures.get(url)).clone()}
export function releaseMonsterSpriteTextures(){for(const promise of sharedTextures.values())void promise.then(texture=>texture.dispose()).catch(()=>{});sharedTextures.clear()}
/** Actions use authored frames; fallback remains the original mesh until load succeeds. */
export function createMonsterSprite({type,catalog,placeholder,camera,loadTexture}={}){
 const spec=catalog?.monsters?.[type==='archer'?'bow':type],visual=createSpriteCharacter({placeholder,camera,height:type==='boss'?4.4:2.1,loadTexture:loadTexture??sharedTexture,maxTextures:2});
 let previous={x:null,z:null},state='idle',lastAttack=null,released=false;
 async function load(){return spec?visual.load({...spec,baseUrl:spec.baseUrl??new URL('../assets/monster-sprites/monster-runtime.json',import.meta.url).href}):{ok:false,reason:'missing_monster_manifest'}}
 function update(dt,enemy,{paused=false,held=false,aim,camera:nextCamera,visualMoving}={}){
  if(released||!enemy||paused)return;const moving=typeof visualMoving==='boolean'?visualMoving:previous.x!==null&&Math.hypot(enemy.x-previous.x,enemy.z-previous.z)>.001;previous={x:enemy.x,z:enemy.z};
  if(held)return;visual.setFacing(aim,nextCamera??camera);
  if(enemy.charge>0){visual.setLocomotion('idle');if(state!=='charge'){visual.cancelAttack();visual.setCharge(true)}state='charge'}
  else{if(state==='charge')visual.setCharge(false);state=moving?'run':'idle';visual.setLocomotion(state,{aim,camera:nextCamera??camera})}
  visual.update(dt,{paused,camera:nextCamera??camera,aim});
 }
 function attack({id=null,durationSeconds=.45,aim}={}){if(id!==null&&id===lastAttack)return false;lastAttack=id;visual.setCharge(false);state='attack';return visual.playAttack({durationSeconds,aim})}
 function reset(){previous={x:null,z:null};state='idle';lastAttack=null;visual.reset()}
 function release(){released=true;visual.release()}
 return {...visual,load,update,attack,reset,release};
}

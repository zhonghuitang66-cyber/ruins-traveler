import {Group,Box3,Vector3,AnimationMixer,LoopOnce,LoopRepeat} from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/addons/loaders/GLTFLoader.js';
import {createMonsterSprite} from './monster-sprites.js';

const sources=new Map(),loader=new GLTFLoader();
const modelUrl=url=>new URL(url,new URL('../assets/monster-models/monster-runtime.json',import.meta.url)).href;
async function sharedSource(url){if(!sources.has(url))sources.set(url,loader.loadAsync(url).catch(error=>{sources.delete(url);throw error}));return sources.get(url)}
/** Clone hierarchy and skeletons; geometry/textures remain owned by source cache. */
export function cloneMonsterScene(source){const root=source.clone(true),mapping=new Map(),materials=new Map();
 function pair(a,b){mapping.set(a,b);for(let i=0;i<a.children.length;i++)pair(a.children[i],b.children[i])}pair(source,root);
 root.traverse(node=>{if(!node.isMesh)return;const clone=material=>{if(!materials.has(material))materials.set(material,material.clone());return materials.get(material)};node.material=Array.isArray(node.material)?node.material.map(clone):clone(node.material);if(node.isSkinnedMesh){const original=[...mapping].find(([,value])=>value===node)[0];node.skeleton=original.skeleton.clone();node.skeleton.bones=original.skeleton.bones.map(bone=>{const target=mapping.get(bone);if(!target)throw Error('Skinned bone outside model root');return target});node.bindMatrix.copy(original.bindMatrix);node.bindMatrixInverse.copy(original.bindMatrixInverse)}});
 return {root,materials:[...materials.values()]};
}
export function releaseMonsterModelCache(){for(const promise of sources.values())void promise.then(gltf=>{const geometries=new Set(),materials=new Set(),textures=new Set();gltf.scene.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value)}});for(const value of [...geometries,...materials,...textures])value.dispose()}).catch(()=>{});sources.clear()}

export function createMonsterModel({type,catalog,placeholder=null,loadGLTF=sharedSource}={}){
 type=type==='archer'?'bow':type;const spec=catalog?.monsters?.[type],root=new Group();root.name='MonsterModel:'+type;if(placeholder)root.add(placeholder);
 let released=false,epoch=0,mixer=null,model=null,normalization=null,ownedMaterials=[],actions=new Map(),current=null,currentKey=null,ready=false,previous=null,attackId=null,attackRemaining=0,status={load:'placeholder',fallback:true,reason:'not_loaded'};
 function play(key,{duration=null,once=false}={}){if(!ready||!actions.has(key))return false;const next=actions.get(key);if(next===current&&key!=='attack')return true;next.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity).setEffectiveTimeScale(duration>0?next.getClip().duration/duration:1).setEffectiveWeight(1).play();next.clampWhenFinished=once;if(current&&current!==next)next.crossFadeFrom(current,.055,false);current=next;currentKey=key;status.played=key;return true}
 async function load(){if(released)return {ok:false,reason:'released'};if(spec?.approved!==true||typeof spec.url!=='string')return {ok:false,reason:'unapproved_or_missing_model'};const ticket=++epoch;status={load:'loading',fallback:true};
  try{const gltf=await loadGLTF(modelUrl(spec.url));if(released||ticket!==epoch)return {ok:false,reason:'stale'};for(const key of ['idle','run','attack','charge'])if(!gltf.animations?.some(clip=>clip.name===spec.clips?.[key]))throw Error('Missing real monster clip '+key);
   const instance=cloneMonsterScene(gltf.scene);model=instance.root;ownedMaterials=instance.materials;normalization=new Group();normalization.name='MonsterModelNormalization';normalization.rotation.y=spec.yawRadians??0;normalization.add(model);root.add(normalization);model.updateMatrixWorld(true);const box=new Box3().setFromObject(model),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3());if(!Number.isFinite(size.y)||size.y<=0)throw Error('Invalid model bounds');const scale=(spec.height??(type==='boss'?4.4:2.1))/size.y;model.position.sub(new Vector3(center.x,box.min.y,center.z));normalization.scale.setScalar(scale);
   mixer=new AnimationMixer(model);for(const key of ['idle','run','attack','charge'])actions.set(key,mixer.clipAction(gltf.animations.find(clip=>clip.name===spec.clips[key])));ready=true;if(placeholder)placeholder.visible=false;status={load:'ready',fallback:false,representation:'rigged_3d',clips:Object.keys(spec.clips),source:spec.source??'Tripo P2 three-view model'};play('idle');return {ok:true};
  }catch(error){clear();if(!released){status={load:'error',fallback:true,reason:String(error.message)};if(placeholder)placeholder.visible=true}return {ok:false,reason:'model_load_failed'}}
 }
 function update(dt,enemy,{paused=false,held=false}={}){if(released||paused||!enemy||!Number.isFinite(dt)||dt<=0)return;const moving=previous&&Math.hypot(enemy.x-previous.x,enemy.z-previous.z)>.001;previous={x:enemy.x,z:enemy.z};if(!ready||held)return;dt=Math.min(.1,dt);attackRemaining=Math.max(0,attackRemaining-dt);if(enemy.charge>0)play('charge');else if(attackRemaining<=0)play(moving?'run':'idle');mixer.update(dt)}
 function attack({id=null,durationSeconds=.45}={}){if(id!==null&&id===attackId)return false;attackId=id;attackRemaining=Number.isFinite(durationSeconds)&&durationSeconds>0?durationSeconds:.45;return play('attack',{duration:attackRemaining,once:true})}
 function clear(){ready=false;if(mixer){mixer.stopAllAction();if(model)mixer.uncacheRoot(model)}mixer=null;normalization?.removeFromParent();for(const material of ownedMaterials)material.dispose();ownedMaterials=[];model=normalization=null;actions.clear();current=currentKey=null}
 function reset(){previous=null;attackId=null;attackRemaining=0;if(ready)play('idle')}
 function release(){if(released)return;released=true;epoch++;clear();root.removeFromParent();if(placeholder)placeholder.visible=true;status={load:'released',fallback:true}}
 return {root,load,update,attack,reset,release,isReady:()=>ready,getStatus:()=>({...status,played:currentKey,attackRemaining})};
}

/** Complete sprite fallback until an explicitly approved four-state model loads. */
export function createPreferredMonsterVisual({type,modelCatalog,spriteCatalog,placeholder,camera,loadGLTF,loadTexture}={}){
 const sprite=createMonsterSprite({type,catalog:spriteCatalog,placeholder,camera,loadTexture}),model=createMonsterModel({type,catalog:modelCatalog,placeholder:sprite.root,loadGLTF});let released=false;
 async function load(){const result=await model.load();if(released)return {ok:false,reason:'released'};if(result.ok){sprite.release();return result}return sprite.load()}
 function update(dt,enemy,options){if(model.isReady())model.update(dt,enemy,options);else sprite.update(dt,enemy,options)}
 return {root:model.root,load,update,attack:options=>model.isReady()?model.attack(options):sprite.attack(options),reset(){model.reset();sprite.reset()},release(){if(released)return;released=true;model.release();sprite.release()},isReady:()=>model.isReady()||sprite.isReady(),getStatus:()=>({...model.isReady()?model.getStatus():sprite.getStatus(),model:model.getStatus()})};
}

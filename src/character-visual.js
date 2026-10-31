import {Group,Box3,Vector3,AnimationMixer,AnimationClip,Quaternion,LoopOnce,LoopRepeat,Color} from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/addons/loaders/GLTFLoader.js';

export function smoothFacingYaw(current,target,dt,response=14){if(!Number.isFinite(current))current=0;if(!Number.isFinite(target)||!Number.isFinite(dt)||dt<=0)return current;const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+delta*(1-Math.exp(-dt*(Number.isFinite(response)&&response>0?response:14)))}

const STATES=new Set(['idle','run','attack','hit','death','jump','skill']);
const ONCE=new Set(['attack','hit','death','jump','skill']);

/** Dispose only freshly loaded, exclusively owned GLTF resources. Never the caller's placeholder. */
export function disposeCharacterGLTF(gltf){
 const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set(),skeletons=new Set();
 for(const scene of new Set([gltf?.scene,...(gltf?.scenes||[])].filter(Boolean)))scene.traverse(o=>{
  if(o.geometry)geometries.add(o.geometry);
  for(const material of (Array.isArray(o.material)?o.material:[o.material]))if(material)materials.add(material);
  if(o.skeleton)skeletons.add(o.skeleton);
 });
 for(const material of materials){for(const value of Object.values(material))if(value?.isTexture)textures.add(value);for(const uniform of Object.values(material.uniforms||{}))if(uniform?.value?.isTexture)textures.add(uniform.value)}
 for(const texture of textures){const data=texture.source?.data;if(data&&typeof data.close==='function')images.add(data);texture.dispose()}
 for(const image of images)image.close();
 for(const material of materials)material.dispose();
 for(const geometry of geometries)geometry.dispose();
 for(const skeleton of skeletons)skeleton.dispose();
}

/** Outer normalization group keeps animation tracks from overwriting height, feet or configured yaw. */
export function normalizeCharacter(model,{height=2,yawRadians=0,anchorHips=false}={}){
 if(!Number.isFinite(height)||height<=0||!Number.isFinite(yawRadians))throw new Error('Invalid character dimensions or yaw');
 const normalization=new Group(),orientation=new Group();orientation.rotation.y=yawRadians;orientation.add(model);normalization.add(orientation);
 normalization.updateMatrixWorld(true);const box=new Box3().setFromObject(normalization,true),size=box.getSize(new Vector3());
 if(box.isEmpty()||!Number.isFinite(size.y)||size.y<1e-6)throw new Error('Character has no measurable geometry');
 const scale=height/size.y,center=box.getCenter(new Vector3());if(anchorHips){let hips=null;model.traverse(o=>{if(/(?:mixamorig:?)?Hips$/.test(o.name))hips=o});if(hips){const point=hips.getWorldPosition(new Vector3());center.x=point.x;center.z=point.z}}normalization.scale.setScalar(scale);normalization.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);normalization.updateMatrixWorld(true);
 return normalization;
}

/**
 * Manifest: {approved:true,url,clips:{idle:'Idle',run:['Run','Walk'],skill1:'Cast'},height?:2,yawRadians?:0}.
 * Missing clips are reported as fallback; no synthetic animation is advertised as a model clip.
 * A loaded GLTF must be exclusively owned. Do not inject cached/shared scene objects as loader results.
 */
export function createCharacterVisual({placeholder=null,loader=new GLTFLoader(),height=2,prepareModel=()=>{},onStatus=()=>{}}={}){
 const root=new Group();root.name='CharacterVisual';if(placeholder)root.add(placeholder);
 let generation=0,released=false,gltf=null,model=null,normalization=null,mixer=null,actions=new Map(),currentAction=null,manifest=null;
 let request={state:'idle',clipKey:'idle',returnTo:'idle'},status={load:'placeholder',requested:'idle',played:null,fallback:true,oneShot:false,reason:'not_loaded',clips:[]};
 let currentReturn='idle',terminal=false,visualTime=0,pendingOverlay=null;
 // One latest intent, aged only by unpaused simulation updates (including loading).
 function resumePending(){const pending=pendingOverlay;pendingOverlay=null;if(!pending||pending.generation!==generation)return;const clip=resolveClip(pending.key),duration=pending.durationSeconds??manifest?.durations[pending.key]??clip?.duration,age=visualTime-pending.startedAt;if(!clip||!duration||(!pending.loop&&age>=duration))return;if(!playOverlay(pending.key,pending.state,duration,pending.loop))return;const time=(pending.loop?age%duration:age)*clip.duration/duration;if(layer.attack){layer.attack.time=time;layer.attack.stopFading().setEffectiveWeight(1);layer.upper?.stopFading().setEffectiveWeight(0);if(layer.lowerAttackActive){layer.lowerAttack.time=time;layer.lowerAttack.stopFading().setEffectiveWeight(1);layer.lower?.stopFading().setEffectiveWeight(0)}mixer.update(0)}else if(currentAction){currentAction.time=time;mixer.update(0)}}
 let layer={state:'idle',lower:null,upper:null,attack:null,lowerAttack:null,lowerAttackActive:false,active:false,overlayKey:'attack',overlayState:'attack',charging:false,loop:false,offset:0,appliedOffset:0},layerActions=new Map(),spines=[],opacity=1,lastAppliedOpacity=null,hipsAnchor=null,hipAnchorError=0;
 const spineBaseQuaternions=new Map(),hipInterpolants=new Map(),hipRotationCompensation=new Quaternion();let hipCompensation=0;
 const opacityBindings=new Map(),opacityMaterials=new Map(),opacityBases=new Map();
 const weaponBindings=new Map(),weaponMaterials=new Map(),weaponBases=new Map(),weaponTints={charge:new Color(0xff7b36),thunder:new Color(0x72e9ff)};let weaponGlow={charge:0,thunder:false};
 function clearWeaponGlow(){for(const [mesh,material]of weaponBindings)mesh.material=material;for(const material of weaponMaterials.values())material.dispose();weaponBindings.clear();weaponMaterials.clear();weaponBases.clear()}
 function prepareWeaponGlow(){const names=new Set(manifest?.weaponNodes||['local_debug_sword_not_final_weapon','local_right_hand_hammer_candidate','local_debug_bow_not_final_weapon']);model.traverse(o=>{if(!o.isMesh||!names.has(o.name))return;weaponBindings.set(o,o.material);const clone=original=>{if(!weaponMaterials.has(original)){const material=original.clone();weaponMaterials.set(original,material);weaponBases.set(material,{color:original.color?.clone(),emissive:original.emissive?.clone(),emissiveIntensity:original.emissiveIntensity??1})}return weaponMaterials.get(original)};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material)});applyWeaponGlow()}
 function applyWeaponGlow(){if(!weaponBases.size)return;const pulse=.82+.18*Math.sin(visualTime*(weaponGlow.thunder?28:15)),strength=Math.max(weaponGlow.charge,weaponGlow.thunder?1:0)*pulse,tint=weaponGlow.thunder?weaponTints.thunder:weaponTints.charge;for(const [material,base]of weaponBases)for(const target of [material,opacityMaterials.get(material)].filter(Boolean)){if(base.color)target.color.copy(base.color).lerp(tint,strength*.5);if(base.emissive){target.emissive.copy(base.emissive).lerp(tint,strength);target.emissiveIntensity=base.emissiveIntensity+strength*2.2}}}
 function setWeaponGlow({charge=0,thunder=false}={}){if(!Number.isFinite(charge)||charge<0||charge>1||typeof thunder!=='boolean')return false;if(released)return false;weaponGlow={charge,thunder};applyWeaponGlow();return true}
 const upperTrack=t=>/(?:Spine|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand)/.test(t.name);
 function clearOpacity(){for(const [mesh,material] of opacityBindings)mesh.material=material;for(const material of opacityMaterials.values())material.dispose();opacityBindings.clear();opacityMaterials.clear();opacityBases.clear();lastAppliedOpacity=null}
 function setOpacity(value){if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid character opacity');opacity=value;if(lastAppliedOpacity===value)return;lastAppliedOpacity=value;for(const target of [model,placeholder].filter(Boolean))target.traverse(o=>{if(!o.isMesh)return;if(!opacityBindings.has(o)){const original=o.material;opacityBindings.set(o,original);const clone=m=>{if(!opacityMaterials.has(m)){const cloned=m.clone();opacityMaterials.set(m,cloned);opacityBases.set(cloned,m)}return opacityMaterials.get(m)};o.material=Array.isArray(original)?original.map(clone):clone(original)}for(const material of Array.isArray(o.material)?o.material:[o.material]){const base=opacityBases.get(material),transparent=value<1||base.transparent;if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true}material.opacity=base.opacity*value;material.depthWrite=value<1?false:base.depthWrite}})}
 function splitAction(key,upper){const clip=resolveClip(key);if(!clip)return null;const id=key+(upper?':upper':':lower');if(!layerActions.has(id)){const tracks=clip.tracks.filter(t=>upperTrack(t)===upper).map(t=>t.clone());if(!tracks.length)return null;layerActions.set(id,mixer.clipAction(new AnimationClip(clip.name+(upper?'__upper':'__lower'),clip.duration,tracks)))}return layerActions.get(id)}
 function syncAttackLower(state){
  if(layer.active&&state==='idle'){
   const action=splitAction(layer.overlayKey||'attack',false);if(!action||layer.lowerAttackActive)return;
   layer.lowerAttack=action;layer.lowerAttackActive=true;layer.lower?.stopFading().fadeOut(.06);
   action.reset().setLoop(layer.loop?LoopRepeat:LoopOnce,layer.loop?Infinity:1).setEffectiveTimeScale(layer.attack.getEffectiveTimeScale()).setEffectiveWeight(1).fadeIn(.06).play();action.time=layer.attack.time;action.clampWhenFinished=true;
  }else if(layer.lowerAttackActive){
   layer.lowerAttackActive=false;layer.lowerAttack.paused=true;layer.lowerAttack.enabled=true;layer.lowerAttack.stopFading().setEffectiveWeight(1).fadeOut(.08);
   if(layer.lower){layer.lower.enabled=true;layer.lower.paused=false;layer.lower.stopFading().setEffectiveWeight(1).fadeIn(.08).play()}
  }
 }
 function setLocomotion(state,{facingOffset=0,rate=1}={}){if(!['idle','run'].includes(state))throw Error('Invalid locomotion');layer.offset=Number.isFinite(facingOffset)?Math.max(-Math.PI*70/180,Math.min(Math.PI*70/180,Math.atan2(Math.sin(facingOffset),Math.cos(facingOffset)))):0;if(!manifest?.layered||!mixer){layer.state=state;return false}const lower=splitAction(state,false),upper=splitAction(state,true);if(!lower)return false;if(layer.lower!==lower){lower.reset().setLoop(LoopRepeat,Infinity).setEffectiveWeight(1).play();if(layer.lower)lower.crossFadeFrom(layer.lower,.08,false);layer.lower=lower}if(layer.upper!==upper&&upper){upper.reset().setLoop(LoopRepeat,Infinity).setEffectiveWeight(layer.active?0:1).play();upper.time=lower.time;if(layer.upper)upper.crossFadeFrom(layer.upper,.08,false);layer.upper=upper}lower.setEffectiveTimeScale(Number.isFinite(rate)&&rate>0?rate:1);upper?.setEffectiveTimeScale(Number.isFinite(rate)&&rate>0?rate:1);layer.state=state;syncAttackLower(state);publish({requested:layer.active?layer.overlayState:state,played:resolveClip(layer.active?layer.overlayKey:state)?.name,fallback:false,layered:true,locomotion:state,upperAttack:layer.active,charge:layer.charging,overlay:layer.active?layer.overlayKey:null});return true}
 function playOverlay(key,state,durationSeconds=null,loop=false){
  if(released||durationSeconds!==null&&(!Number.isFinite(durationSeconds)||durationSeconds<=0))return false;
  if(!mixer){if(generation>0&&status.load!=='loading')return false;pendingOverlay={key,state,durationSeconds:durationSeconds??manifest?.durations[key]??null,loop,startedAt:visualTime,generation};publish({requested:state,reason:'waiting_model'});return true}
  pendingOverlay=null;
  if(!manifest?.layered){if(!resolveClip(key))return false;return setState(loop?'idle':state,{clipKey:key,force:true,durationSeconds})}
  if(!mixer)return false;const action=splitAction(key,true),clip=resolveClip(key);if(!action||!clip)return false;
  if(layer.lowerAttackActive){layer.active=false;syncAttackLower(layer.state)}
  if(layer.attack&&layer.attack!==action){layer.attack.paused=true;layer.attack.enabled=true;layer.attack.stopFading().setEffectiveWeight(1).fadeOut(.06)}else layer.attack?.stop();
  layer.attack=action;layer.active=true;layer.overlayKey=key;layer.overlayState=state;layer.charging=loop&&key==='charge';layer.loop=loop;layer.upper?.stopFading().fadeOut(.06);
  const duration=durationSeconds??manifest.durations[key]??clip.duration;action.reset().setLoop(loop?LoopRepeat:LoopOnce,loop?Infinity:1).setEffectiveTimeScale(clip.duration/duration).setEffectiveWeight(1).fadeIn(.06).play();action.clampWhenFinished=!loop;syncAttackLower(layer.state);
  publish({requested:state,played:clip.name,fallback:false,oneShot:!loop,layered:true,upperAttack:true,charge:layer.charging,overlay:key,clipDuration:clip.duration,playDuration:duration});return true;
 }
 function playAttack({durationSeconds=null}={}){return playOverlay('attack','attack',durationSeconds)}
 function playSkill({index,durationSeconds=null}={}){return Number.isInteger(index)&&index>=0&&index<=2?playOverlay('skill'+index,'skill',durationSeconds):false}
 function setCharge(active){if(typeof active!=='boolean')return false;if(active){if(layer.charging&&layer.active||pendingOverlay?.key==='charge')return true;return playOverlay('charge','skill',null,true)}if(pendingOverlay?.key==='charge')pendingOverlay=null;setWeaponGlow({...weaponGlow,charge:0});if(layer.charging)cancelAttack();return true}

 function cancelAttack(){const wasCharging=layer.charging||pendingOverlay?.key==='charge';pendingOverlay=null;if(wasCharging)setWeaponGlow({...weaponGlow,charge:0});if(!layer.active)return;layer.active=false;layer.charging=false;syncAttackLower(layer.state);if(layer.attack){layer.attack.paused=true;layer.attack.enabled=true;layer.attack.stopFading().setEffectiveWeight(1).fadeOut(.08)}if(layer.upper){layer.upper.enabled=true;layer.upper.paused=false;layer.upper.stopFading().setEffectiveWeight(1).fadeIn(.08).play()}publish({requested:layer.state,played:resolveClip(layer.state)?.name,upperAttack:false,charge:false,overlay:null,oneShot:false})}
 const publish=(patch)=>{status={...status,...patch};try{onStatus({...status,clips:[...status.clips]})}catch{/* host callback cannot corrupt loader lifecycle */}};
 const placeholderVisible=visible=>{if(placeholder)placeholder.visible=visible};
 function clearLoaded(){
  clearOpacity();clearWeaponGlow();layerActions.clear();hipInterpolants.clear();hipCompensation=0;hipRotationCompensation.identity();layer={state:layer.state,lower:null,upper:null,attack:null,lowerAttack:null,lowerAttackActive:false,active:false,overlayKey:'attack',overlayState:'attack',charging:false,loop:false,offset:0,appliedOffset:0};spines=[];spineBaseQuaternions.clear();hipsAnchor=null;hipAnchorError=0;
  if(mixer){mixer.removeEventListener('finished',finished);mixer.stopAllAction();if(model)mixer.uncacheRoot(model)}
  normalization?.removeFromParent();if(gltf)disposeCharacterGLTF(gltf);
  gltf=null;model=null;normalization=null;mixer=null;currentAction=null;actions.clear();terminal=false;
 }
 function resolveClip(key){const names=manifest?.clips?.[key]??key;for(const name of Array.isArray(names)?names:[names]){if(typeof name!=='string')continue;const clip=gltf?.animations?.find(c=>c.name===name)||gltf?.animations?.find(c=>c.name.toLowerCase()===name.toLowerCase());if(clip)return clip}return null}
 function finished(event){if(released)return;if(manifest?.layered&&event.action===layer.attack){cancelAttack();return}if(event.action!==currentAction)return;if(currentReturn===null){terminal=true;return}setState(currentReturn,{force:true})}
 function setState(state,{clipKey=state,force=false,returnTo='idle',durationSeconds=null}={}){
  if(!STATES.has(state))throw new Error('Unknown character visual state: '+state);
  if(returnTo!==null&&!STATES.has(returnTo))throw new Error('Unknown return state');
  if(durationSeconds!==null&&(!Number.isFinite(durationSeconds)||durationSeconds<=0))throw new Error('Invalid animation duration');
  if(released)return false;
  if(!force&&request.state===state&&request.clipKey===clipKey&&request.durationSeconds===durationSeconds&&currentAction)return !status.fallback;
  request={state,clipKey,returnTo,durationSeconds};terminal=false;
  if(!mixer){publish({requested:state,played:null,fallback:true,oneShot:false,reason:status.load==='loading'?'loading':'not_loaded'});return false}
  const clip=resolveClip(clipKey),fallback=!clip,resolved=clip||resolveClip('idle');
  currentReturn=returnTo;
  if(!resolved){currentAction?.stop();currentAction=null;publish({requested:state,played:null,fallback:true,oneShot:false,reason:'missing_clip'});return false}
  let action=actions.get(resolved);if(!action){action=mixer.clipAction(resolved);actions.set(resolved,action)}
  // Missing attack/skill/etc plays only actual idle if present; it is never labeled as that requested clip.
  const once=!fallback&&ONCE.has(state),duration=!fallback?(durationSeconds??manifest.durations?.[clipKey]):null;
  const timeScale=duration&&resolved.duration>0?resolved.duration/duration:1;
  action.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;action.enabled=true;action.setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play();
  if(currentAction&&currentAction!==action)action.crossFadeFrom(currentAction,.12,false);
  currentAction=action;publish({requested:state,played:resolved.name,fallback,oneShot:once,clipDuration:resolved.duration,playDuration:resolved.duration/timeScale,reason:fallback?'missing_clip':null});return !fallback;
 }
 async function load(nextManifest){
  if(released)return {ok:false,reason:'released'};
  const firstIntent=generation===0?pendingOverlay:null;if(generation>0)weaponGlow={charge:0,thunder:false};const ticket=++generation;pendingOverlay=firstIntent?{...firstIntent,generation:ticket}:null;clearLoaded();placeholderVisible(true);if(opacity<1)setOpacity(opacity);
  // Explicit review gate: never infer approval from a file existing or a provider task succeeding.
  if(nextManifest?.approved!==true||typeof nextManifest.url!=='string'||!nextManifest.url.trim()){
   pendingOverlay=null;manifest=null;publish({load:'placeholder',played:null,fallback:true,reason:'unapproved_or_missing_model',clips:[]});return {ok:false,reason:'unapproved_or_missing_model'};
  }
  manifest={url:nextManifest.url,height:nextManifest.height??height,yawRadians:nextManifest.yawRadians??0,anchorHips:nextManifest.anchorHips===true,layered:nextManifest.layered===true,compensateUpperHips:nextManifest.compensateUpperHips===true,weaponNodes:Array.isArray(nextManifest.weaponNodes)?nextManifest.weaponNodes.filter(n=>typeof n==='string'):undefined,clips:{},durations:{}};
  for(const [key,value]of Object.entries(nextManifest.durations||{}))if(Number.isFinite(value)&&value>0)manifest.durations[key]=value;
  for(const [key,value] of Object.entries(nextManifest.clips||{}))manifest.clips[key]=Array.isArray(value)?[...value]:value;
  publish({load:'loading',played:null,fallback:true,reason:'loading',clips:[]});let incoming=null;
  try{
   incoming=await loader.loadAsync(manifest.url);
   if(ticket!==generation||released){disposeCharacterGLTF(incoming);return {ok:false,reason:'stale'}}
   if(!incoming?.scene)throw new Error('GLTF has no scene');
   gltf=incoming;model=incoming.scene;prepareModel(model);prepareWeaponGlow();normalization=normalizeCharacter(model,manifest);model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});root.add(normalization);
   mixer=new AnimationMixer(model);mixer.addEventListener('finished',finished);placeholderVisible(false);
   model.traverse(o=>{if(o.isBone&&/Spine\d*$/.test(o.name))spines.push(o);if(o.isBone&&/Hips$/.test(o.name))hipsAnchor=o});lastAppliedOpacity=null;if(opacity<1)setOpacity(opacity);publish({load:'ready',clips:(incoming.animations||[]).map(c=>c.name),reason:null});if(manifest.layered)setLocomotion(layer.state);else setState(request.state,{...request,force:true});resumePending();return {ok:true};
  }catch(error){
   if(ticket!==generation||released){if(incoming)disposeCharacterGLTF(incoming);return {ok:false,reason:'stale'}}
   // Normalization/parse failures also release any model data that did arrive.
   if(gltf)clearLoaded();else if(incoming)disposeCharacterGLTF(incoming);placeholderVisible(true);
   pendingOverlay=null;publish({load:'error',played:null,fallback:true,reason:'load_failed',error:String(error?.message||error),clips:[]});return {ok:false,reason:'load_failed'};
  }
 }
 function anchorCurrentHips(){if(!manifest?.anchorHips||!hipsAnchor||!normalization)return;root.updateMatrixWorld(true);const local=root.worldToLocal(hipsAnchor.getWorldPosition(new Vector3()));normalization.position.x-=local.x;normalization.position.z-=local.z;root.updateMatrixWorld(true);const after=root.worldToLocal(hipsAnchor.getWorldPosition(new Vector3()));hipAnchorError=Math.hypot(after.x,after.z)}
 function update(dt,{paused=false}={}){
  if(released||paused||terminal||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.1);visualTime+=dt;if(pendingOverlay&&!pendingOverlay.loop&&pendingOverlay.durationSeconds!==null&&visualTime-pendingOverlay.startedAt>=pendingOverlay.durationSeconds)pendingOverlay=null;if(!mixer)return;
  // Restore the mixer's unmodified pose first: constant tracks may skip writes when unchanged.
  if(manifest?.layered)for(const [spine,quaternion] of spineBaseQuaternions)spine.quaternion.copy(quaternion);
  mixer.update(dt);
  if(manifest?.layered){
   layer.appliedOffset=smoothFacingYaw(layer.appliedOffset,layer.active?layer.offset:0,dt,14);
   for(const spine of spines)spineBaseQuaternions.set(spine,spine.quaternion.clone());
   if(manifest.compensateUpperHips&&hipsAnchor&&layer.active){
    if(!hipInterpolants.has(layer.overlayKey)){const track=resolveClip(layer.overlayKey)?.tracks.find(t=>/Hips\.quaternion$/.test(t.name));hipInterpolants.set(layer.overlayKey,track?.createInterpolant()??null)}
    const sampler=hipInterpolants.get(layer.overlayKey);
    if(sampler){model.updateMatrixWorld(true);const parent=hipsAnchor.parent.getWorldQuaternion(new Quaternion()),authored=parent.multiply(new Quaternion().fromArray(sampler.evaluate(layer.attack.time))),actual=hipsAnchor.getWorldQuaternion(new Quaternion()),delta=authored.multiply(actual.invert());hipRotationCompensation.copy(delta).normalize()}else hipRotationCompensation.identity();
   }else hipRotationCompensation.slerp(new Quaternion(),1-Math.exp(-28*dt));
   hipCompensation=2*Math.acos(Math.min(1,Math.abs(hipRotationCompensation.w)));
   const torsoRotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),layer.appliedOffset).multiply(hipRotationCompensation),torsoAngle=2*Math.acos(Math.min(1,Math.abs(torsoRotation.w)));
   if(torsoAngle>.00001&&spines.length){const part=new Quaternion().slerp(torsoRotation,1/spines.length);for(const spine of spines){model.updateMatrixWorld(true);const parent=spine.parent.getWorldQuaternion(new Quaternion()),delta=part.clone();spine.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent))}model.updateMatrixWorld(true)}
  }
  anchorCurrentHips();applyWeaponGlow();
 }
 function setPlaybackRate(rate){if(!Number.isFinite(rate)||rate<.1||rate>2)throw new Error('Playback rate must be between 0.1 and 2');if(mixer)mixer.timeScale=rate}
 function seekNormalized(progress){
  if(!Number.isFinite(progress)||progress<0||progress>1)throw new Error('Animation position must be between zero and one');
  if(released||!mixer||!currentAction||currentAction.getClip().duration<=0)return false;
  // Review one action without leftover crossfade weights obscuring the sampled pose.
  for(const action of actions.values())if(action!==currentAction)action.stop();
  terminal=false;currentAction.stopFading().setEffectiveWeight(1);currentAction.enabled=true;currentAction.paused=false;
  currentAction.time=Math.min(progress,1-Number.EPSILON)*currentAction.getClip().duration;
  mixer.update(0);return true;
 }
 function release(){if(released)return;released=true;generation++;pendingOverlay=null;weaponGlow={charge:0,thunder:false};clearLoaded();placeholderVisible(true);root.removeFromParent();publish({load:'released',played:null,fallback:true,reason:'released',clips:[]})}
 return {root,load,setState,setLocomotion,playAttack,playSkill,setCharge,cancelAttack,setOpacity,setWeaponGlow,update,setPlaybackRate,seekNormalized,release,getStatus:()=>({...status,weaponGlow:{...weaponGlow,meshes:weaponBindings.size},pendingOverlay:pendingOverlay?.key??null,pendingAge:pendingOverlay?visualTime-pendingOverlay.startedAt:0,clips:[...status.clips],lowerTime:layer.lower?.time??0,upperAttackTime:layer.attack?.time??0,fullBodyAttack:layer.lowerAttackActive,lowerAttackWeight:layer.lowerAttack?.getEffectiveWeight()??0,upperAttackWeight:layer.attack?.getEffectiveWeight()??0,upperLocomotionWeight:layer.upper?.getEffectiveWeight()??0,appliedFacingOffset:layer.appliedOffset,upperHipCompensation:hipCompensation,opacity,hipAnchorError,clipTime:currentAction?.time??0,normalizedTime:currentAction&&currentAction.getClip().duration>0?currentAction.time/currentAction.getClip().duration:0})};
}

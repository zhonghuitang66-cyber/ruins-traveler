import {Group,Mesh,PlaneGeometry,MeshBasicMaterial,TextureLoader,Quaternion,Vector3,SRGBColorSpace,LinearFilter,DoubleSide} from '../vendor/three.module.js';

export const SPRITE_DIRECTIONS=['n','ne','e','se','s','sw','w','nw'];
/** Directions are camera-relative views of a world-space heading. No UV mirroring. */
export function spriteFacingDirection(aim,cameraYaw=Math.PI){
 const x=aim?.x??aim?.dx,z=aim?.z??aim?.dz;
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.hypot(x,z)<1e-8)return 's';
 const right=-x*Math.cos(cameraYaw)+z*Math.sin(cameraYaw),up=x*Math.sin(cameraYaw)+z*Math.cos(cameraYaw);
 const index=(Math.round(Math.atan2(right,up)/(Math.PI/4))+8)%8;return SPRITE_DIRECTIONS[index];
}
const isAttackKey=key=>/^attack(?:[1-4])?$/.test(key);
const durationOf=spec=>spec.durations.reduce((n,v)=>n+v,0);
function disposeTextures(textures){const images=new Set();for(const texture of new Set(textures)){const data=texture.source?.data??texture.image;if(data&&typeof data.close==='function')images.add(data);texture.dispose()}for(const image of images)image.close()}
function frameAt(spec,seconds,{loop=false,duration=null}={}){
 const source=durationOf(spec);let time=Math.max(0,seconds)*(duration>0?source/duration:1);time=loop?time%source:Math.min(time,source-1e-8);let at=0;
 for(let i=0;i<spec.frames.length;i++){at+=spec.durations[i];if(time+1e-9<at)return {index:i,cell:spec.frames[i]}}
 return {index:spec.frames.length-1,cell:spec.frames.at(-1)};
}
function cleanAtlas(raw,baseUrl){
 if(!raw||typeof raw.url!=='string'||!raw.url.trim())throw Error('Sprite direction has no URL');
 const columns=raw.columns??1,rows=raw.rows??1;
 if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>4096)throw Error('Invalid sprite atlas grid');
 if(raw.frames!==undefined&&!Array.isArray(raw.frames)&&(!Number.isInteger(raw.frames)||raw.frames<1))throw Error('Invalid frame count');
 const frames=Array.isArray(raw.frames)?[...raw.frames]:Array.from({length:raw.frames??columns*rows},(_,i)=>i);
 if(!frames.length||frames.length>512||frames.some(v=>!Number.isInteger(v)||v<0||v>=columns*rows))throw Error('Invalid sprite frame sequence');
 const durations=raw.durations?[...raw.durations]:frames.map(()=>1/(raw.fps??8));
 if(durations.length!==frames.length||durations.some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid sprite durations');
 const anchor=raw.anchor??null;if(anchor&&(!Array.isArray(anchor)||anchor.length!==2||anchor.some(v=>!Number.isFinite(v)||v<0||v>1)))throw Error('Invalid foot anchor');
 const height=raw.height??null;if(height!==null&&(!Number.isFinite(height)||height<=0))throw Error('Invalid clip height');
 return {url:baseUrl?new URL(raw.url,baseUrl).href:raw.url,columns,rows,frames,durations,anchor,aspect:raw.aspect??null,height,sourceFacing:raw.sourceFacing==='left'||raw.sourceFacing==='right'?raw.sourceFacing:null};
}
function cleanManifest(raw){
 if(raw?.approved!==true||!raw.clips||typeof raw.clips!=='object')throw Error('Unapproved or missing sprite manifest');
 const height=raw.height??2,anchor=raw.anchor??[.5,1];if(!Number.isFinite(height)||height<=0||!Array.isArray(anchor)||anchor.length!==2||anchor.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Invalid character height or anchor');
 const clips={};for(const [key,entry]of Object.entries(raw.clips)){
  if(!entry?.directions||typeof entry.directions!=='object')throw Error('Clip needs actual direction atlases');
  const directions={};for(const [direction,spec]of Object.entries(entry.directions)){if(!SPRITE_DIRECTIONS.includes(direction))throw Error('Unknown sprite direction');if(spec?.approved===false)continue;directions[direction]=cleanAtlas(spec,raw.baseUrl)}
  if(!Object.keys(directions).length)throw Error('Empty sprite clip');
  const duration=entry.durationSeconds??raw.durations?.[key]??null,cue=entry.cue??raw.cues?.[key]??.65;
  if(duration!==null&&(!Number.isFinite(duration)||duration<=0)||!Number.isFinite(cue)||cue<0||cue>1)throw Error('Invalid clip timing');
  clips[key]={directions,duration,cue};
 }
 if(!clips.idle)throw Error('An actual idle clip is required');return {height,anchor,clips,allowTemporaryMirror:raw.allowTemporaryMirror===true,sourceFacing:raw.sourceFacing==='left'||raw.sourceFacing==='right'?raw.sourceFacing:null};
}

/** One owned textured quad. Atlases returned by loadTexture must be exclusively owned. */
export function createSpriteCharacter({placeholder=null,camera=null,height=2,loadTexture=null,maxTextures=4,onStatus=()=>{}}={}){
 const root=new Group();root.name='SpriteCharacter';if(placeholder)root.add(placeholder);
 const geometry=new PlaneGeometry(1,1),material=new MeshBasicMaterial({transparent:true,opacity:1,alphaTest:.04,depthWrite:false,depthTest:true,side:DoubleSide,toneMapped:false}),quad=new Mesh(geometry,material);quad.name='SpriteCharacterQuad';quad.frustumCulled=false;quad.visible=false;root.add(quad);
 const textureBudget=Math.max(2,Math.min(12,Math.floor(maxTextures)||4));let pendingTextures=new Map(),failedTextures=new Set(),usage=new Map(),useTick=0,idleUrl=null;
 const loader=loadTexture??(url=>new TextureLoader().loadAsync(url));let manifest=null,textures=new Map(),generation=0,released=false,clock=0,locomotion='idle',locomotionTime=0,locomotionRate=1,overlay=null,pending=null,opacity=1,viewYaw=Math.PI,viewCamera=camera,aim={x:0,z:1},glow={charge:0,thunder:false},lastFacingSide=0,stopRemaining=0,idleTime=0,lastGeometry='',lastUV='';
 let status={load:'placeholder',requested:'idle',played:null,direction:null,requestedDirection:'s',frame:0,fallback:true,reason:'not_loaded',strategy:'placeholder'};
 function publish(patch){status={...status,...patch};try{onStatus({...status})}catch{/* Host callbacks cannot break resource ownership. */}}
 function clearLoaded(){quad.visible=false;material.map=null;material.needsUpdate=true;disposeTextures(textures.values());textures.clear();pendingTextures=new Map();failedTextures.clear();usage.clear();idleUrl=null;manifest=null;stopRemaining=idleTime=0;quad.scale.set(1,1,1);lastGeometry=lastUV='';if(placeholder)placeholder.visible=true}
 function captureAim(value){const x=value?.x??value?.dx,z=value?.z??value?.dz,n=Math.hypot(x,z);return Number.isFinite(x)&&Number.isFinite(z)&&n>1e-8?{x:x/n,z:z/n}:null}
 function setFacing(value,nextCamera){if(released)return false;const next=captureAim(value);if(next)aim=next;if(nextCamera)viewCamera=nextCamera;selectFrame();return !!next}
 function cameraHeading(nextCamera){if(!nextCamera?.getWorldDirection)return;const forward=nextCamera.getWorldDirection(new Vector3());if(Math.hypot(forward.x,forward.z)>1e-6)viewYaw=Math.atan2(forward.x,forward.z)}
 function applyPresentation(){
  let x=1,y=1;
  if(!overlay&&locomotion==='idle'){
   if(stopRemaining>0){const pulse=Math.sin(Math.PI*(1-stopRemaining/.16));x+=.018*pulse;y-=.03*pulse}
   else{const breath=Math.sin(idleTime/1.8*Math.PI*2);x-=.003*breath;y+=.006*breath}
  }else if(overlay?.comboStage!==null&&overlay?.comboStage!==undefined&&isAttackKey(status.played)){
   const pulse=Math.sin(Math.PI*Math.min(1,overlay.time/overlay.duration));x+=(.02+overlay.comboStage*.012)*pulse;y-=(.015+overlay.comboStage*.006)*pulse;
  }
  quad.scale.set(x,y,1);
 }
 function available(key,direction,loadedOnly=false){const clip=manifest?.clips[key];if(!clip)return null;const names=Object.keys(clip.directions).filter(d=>!loadedOnly||textures.has(clip.directions[d].url));if(!names.length)return null;if(names.includes(direction))return {clip,spec:clip.directions[direction],direction,missingDirection:false};
  const requested=SPRITE_DIRECTIONS.indexOf(direction),closest=names.sort((a,b)=>{const distance=d=>{const n=Math.abs(SPRITE_DIRECTIONS.indexOf(d)-requested);return Math.min(n,8-n)};return distance(a)-distance(b)||SPRITE_DIRECTIONS.indexOf(a)-SPRITE_DIRECTIONS.indexOf(b)})[0];return {clip,spec:clip.directions[closest],direction:closest,missingDirection:true};
 }
 function prepareTexture(texture){texture.colorSpace=SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true}
 function trimTextures(){while(textures.size>textureBudget){const oldest=[...textures.keys()].filter(url=>url!==idleUrl&&textures.get(url)!==material.map).sort((a,b)=>(usage.get(a)||0)-(usage.get(b)||0))[0];if(!oldest)break;const texture=textures.get(oldest);textures.delete(oldest);usage.delete(oldest);if(![...textures.values()].includes(texture))disposeTextures([texture])}}
 function requestTexture(url){
  if(released||!manifest||textures.has(url)||failedTextures.has(url)||pendingTextures.has(url)||pendingTextures.size>=2)return;
  const job={generation};pendingTextures.set(url,job);job.promise=Promise.resolve().then(()=>loader(url)).then(texture=>{
   if(!texture?.isTexture)throw Error('Texture loader returned no texture');
   if(released||job.generation!==generation){disposeTextures([texture]);return}
   prepareTexture(texture);textures.set(url,texture);usage.set(url,++useTick);selectFrame();trimTextures();
  }).catch(()=>{if(!released&&job.generation===generation){failedTextures.add(url);selectFrame()}}).finally(()=>{if(pendingTextures.get(url)===job)pendingTextures.delete(url)});
 }
 function requestedKey(){
  if(!overlay)return {key:locomotion,time:locomotionTime,loop:true,duration:null,strategy:'locomotion'};
  let key=overlay.key;if(isAttackKey(key)&&glow.thunder){const variant=overlay.comboStage===null?'thunderAttack':'thunderAttack'+(overlay.comboStage+1);if(manifest.clips[variant])key=variant;else if(manifest.clips.thunderAttack)key='thunderAttack'};if(key==='charge'&&glow.charge>0&&manifest.clips.chargeGlow)key='chargeGlow';
  if(locomotion==='run'){
   const actionKey=overlay.key,moving=isAttackKey(actionKey)?(overlay.comboStage!==null&&manifest.clips['moveAttack'+(overlay.comboStage+1)]?'moveAttack'+(overlay.comboStage+1):'moveAttack'):actionKey==='charge'?'moveCharge':actionKey.startsWith('skill')?'move'+actionKey[0].toUpperCase()+actionKey.slice(1):actionKey==='cast'?'moveCast':null;
   if(moving&&manifest.clips[moving])return {key:moving,time:overlay.time,loop:overlay.loop,duration:overlay.duration,strategy:'authored_moving_action'};
   if(overlay.key==='charge')return {key:'run',time:locomotionTime,loop:true,duration:null,strategy:'moving_charge_locomotion',fallback:true};
   if(moving){const cue=overlay.cuePhase??manifest.clips[key]?.cue??.65,start=Math.max(0,cue*overlay.duration-.08),end=Math.min(overlay.duration,cue*overlay.duration+.10);if(overlay.time<start||overlay.time>end)return {key:'run',time:locomotionTime,loop:true,duration:null,strategy:'run_with_action_cue',fallback:true};return {key,time:overlay.time,loop:overlay.loop,duration:overlay.duration,strategy:'run_with_action_cue',fallback:true}}
  }
  return {key,time:overlay.time,loop:overlay.loop,duration:overlay.duration,strategy:'whole_sprite_action'};
 }
 function selectFrame(){
  if(!manifest||released)return;cameraHeading(viewCamera);const request=requestedKey(),requestedDirection=spriteFacingDirection(overlay?.aim??aim,viewYaw);let key=request.key,selected=available(key,requestedDirection),reason=null,fallback=!!request.fallback||!!overlay?.fallbackReason;
  if(!selected){key='idle';selected=available(key,requestedDirection);fallback=true;reason='missing_'+request.key}
  if(selected.missingDirection){fallback=true;reason='missing_direction'}
  let spec=selected.spec,texture=textures.get(spec.url);
  if(!texture){const requestedUrl=spec.url;requestTexture(requestedUrl);const same=available(key,requestedDirection,true),idle=available('idle',requestedDirection,true);selected=same??idle;if(!selected){publish({fallback:true,reason:'direction_texture_loading'});return}if(!same)key='idle';spec=selected.spec;texture=textures.get(spec.url);fallback=true;reason=failedTextures.has(requestedUrl)?'direction_texture_failed':'direction_texture_loading'}
  usage.set(spec.url,++useTick);
  const side=/(?:^e$|ne|se)/.test(requestedDirection)?1:/(?:^w$|nw|sw)/.test(requestedDirection)?-1:0;if(side)lastFacingSide=side;const sourceFacing=spec.sourceFacing??manifest.sourceFacing,sourceSide=sourceFacing==='left'?-1:sourceFacing==='right'?1:0,mirrored=manifest.allowTemporaryMirror&&selected.missingDirection&&sourceSide!==0&&lastFacingSide!==0&&sourceSide!==lastFacingSide;if(mirrored){fallback=true;reason='temporary_direction_mirror'}
  const segment=overlay?.frameRange&&key===overlay.key?overlay.frameRange:null,actualCue=key===overlay?.key?overlay.cuePhase:null,authoredCue=manifest.clips[key]?.cue??.65,retimed=!segment&&actualCue>0&&actualCue<1,progress=overlay?Math.min(1,request.time/overlay.duration):0,mapped=retimed?(progress<=actualCue?progress/actualCue*authoredCue:authoredCue+(progress-actualCue)/(1-actualCue)*(1-authoredCue)):0,sourceTime=segment?durationOf(spec)*(segment[0]+(segment[1]-segment[0])*progress):retimed?durationOf(spec)*mapped:request.time;const frame=frameAt(spec,sourceTime,{loop:segment||retimed?false:request.loop,duration:segment||retimed?null:request.duration}),uvKey=spec.url+':'+spec.columns+':'+spec.rows+':'+frame.cell+':'+mirrored;
  if(lastUV!==uvKey){const u=frame.cell%spec.columns,v=Math.floor(frame.cell/spec.columns),uv=geometry.attributes.uv;const left=(mirrored?u+1:u)/spec.columns,right=(mirrored?u:u+1)/spec.columns;uv.setXY(0,left,1-v/spec.rows);uv.setXY(1,right,1-v/spec.rows);uv.setXY(2,left,1-(v+1)/spec.rows);uv.setXY(3,right,1-(v+1)/spec.rows);uv.needsUpdate=true;lastUV=uvKey}
  const image=texture.image||texture.source?.data,aspect=Number.isFinite(spec.aspect)&&spec.aspect>0?spec.aspect:image?.width>0&&image?.height>0?(image.width/spec.columns)/(image.height/spec.rows):1,authoredAnchor=spec.anchor??manifest.anchor,anchor=mirrored?[1-authoredAnchor[0],authoredAnchor[1]]:authoredAnchor,h=spec.height??manifest.height,w=h*aspect,geometryKey=[w,h,...anchor].join(':');
  if(lastGeometry!==geometryKey){const p=geometry.attributes.position,left=-anchor[0]*w,right=(1-anchor[0])*w,bottom=-(1-anchor[1])*h,top=anchor[1]*h;p.setXYZ(0,left,top,0);p.setXYZ(1,right,top,0);p.setXYZ(2,left,bottom,0);p.setXYZ(3,right,bottom,0);p.needsUpdate=true;geometry.computeBoundingSphere();lastGeometry=geometryKey}
  if(material.map!==texture){material.map=texture;material.needsUpdate=true}material.opacity=opacity;quad.visible=true;if(placeholder)placeholder.visible=false;
  publish({requested:overlay?.requested??locomotion,played:key,direction:mirrored?({nw:'ne',w:'e',sw:'se',ne:'nw',e:'w',se:'sw'}[selected.direction]??selected.direction):selected.direction,authoredDirection:selected.direction,sourceFacing,mirrored,temporaryMirror:mirrored,requestedDirection,frame:frame.index,frameCount:spec.frames.length,animated:spec.frames.length>1,cell:frame.cell,cue:overlay?(overlay.cuePhase??manifest.clips[overlay.key]?.cue??null):null,fallback,reason:reason??(request.fallback?request.strategy:overlay?.fallbackReason??null),strategy:request.strategy,oneShot:!!overlay&&!overlay.loop,clipDuration:durationOf(spec),playDuration:request.duration??durationOf(spec)});applyPresentation();
 }
 quad.onBeforeRender=(_renderer,_scene,nextCamera)=>{if(released||!nextCamera)return;viewCamera=nextCamera;selectFrame();root.updateWorldMatrix(true,false);quad.quaternion.copy(root.getWorldQuaternion(new Quaternion()).invert().multiply(nextCamera.getWorldQuaternion(new Quaternion())));quad.updateMatrixWorld(true)};
 function defaultDuration(key){const clip=manifest?.clips[key];if(!clip)return null;return clip.duration??durationOf(Object.values(clip.directions)[0])}
 function begin(key,{durationSeconds=null,loop=false,requested=key,aim:nextAim=null,comboStage=null,impactDelay=null}={}){
  if(released||durationSeconds!==null&&(!Number.isFinite(durationSeconds)||durationSeconds<=0)||impactDelay!==null&&(!Number.isFinite(impactDelay)||impactDelay<0))return false;const facing=captureAim(nextAim)??{...aim};
  if(!manifest){if(status.load!=='loading'&&generation>0)return false;pending={key,duration:durationSeconds,loop,requested,aim:facing,comboStage,impactDelay,startedAt:clock,generation};publish({requested,reason:'waiting_sprite',fallback:true});return true}
  const resolved=manifest.clips[key]?key:/^attack[1-4]$/.test(key)&&manifest.clips.attack?'attack':key.startsWith('skill')&&manifest.clips.cast?'cast':null;
  if(!resolved){publish({requested,fallback:true,reason:'missing_'+key});return false}
  const duration=durationSeconds??defaultDuration(resolved);if(impactDelay!==null&&impactDelay>duration)return false;const segmented=/^attack[1-4]$/.test(key)&&resolved==='attack';overlay={key:resolved,requested,loop,time:0,duration,aim:facing,cuePhase:impactDelay===null?null:impactDelay/duration,comboStage,comboSource:comboStage===null?null:segmented?'existing_attack_segment':'authored_stage',frameRange:segmented?[comboStage/4,(comboStage+1)/4]:null,fallbackReason:segmented?'existing_attack_segment':resolved!==key?'generic_cast':null};pending=null;selectFrame();return true;
 }
 function playAttack({comboStage=null,...options}={}){if(comboStage!==null&&(!Number.isInteger(comboStage)||comboStage<0||comboStage>3))return false;return begin(comboStage===null?'attack':'attack'+(comboStage+1),{...options,comboStage,requested:'attack'})}
 function playSkill({index,durationSeconds=null,aim:nextAim=null}={}){return Number.isInteger(index)&&index>=0&&index<=2?begin('skill'+index,{durationSeconds,aim:nextAim,requested:'skill'+index}):false}
 function cancelAttack(){pending=null;overlay=null;glow.charge=0;selectFrame()}
 function setCharge(active){if(typeof active!=='boolean'||released)return false;if(active){if(overlay?.key==='charge'||overlay?.key==='chargeGlow'||pending?.key==='charge')return true;return begin('charge',{loop:true,requested:'charge'})}if(pending?.key==='charge')pending=null;if(overlay?.key==='charge'||overlay?.key==='chargeGlow')overlay=null;glow.charge=0;selectFrame();return true}
 function setLocomotion(state,{rate=1,aim:nextAim=null,camera:nextCamera=null}={}){if(!['idle','run'].includes(state))throw Error('Invalid sprite locomotion');if(released)return false;if(state!==locomotion){stopRemaining=state==='idle'?.16:0;idleTime=0;locomotion=state;locomotionTime=0}locomotionRate=Number.isFinite(rate)&&rate>0?rate:1;if(nextAim)aim=captureAim(nextAim)??aim;if(nextCamera)viewCamera=nextCamera;selectFrame();return !!manifest?.clips[state]}
 function setState(state,{durationSeconds=null,clipKey=null}={}){if(state==='idle'||state==='run')return setLocomotion(state);if(state==='attack')return playAttack({durationSeconds});if(state==='skill')return begin(clipKey??'cast',{durationSeconds,requested:state});if(state==='hit'||state==='hurt')return begin('hurt',{durationSeconds,requested:state});if(state==='death'||state==='jump')return begin(state,{durationSeconds,requested:state});throw Error('Unknown sprite visual state')}
 function setOpacity(value){if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid sprite opacity');opacity=value;material.opacity=value}
 function setWeaponGlow({charge=0,thunder=false}={}){if(released||!Number.isFinite(charge)||charge<0||charge>1||typeof thunder!=='boolean')return false;glow={charge,thunder};selectFrame();return (!charge||!!manifest?.clips.chargeGlow)&&(!thunder||!!manifest?.clips.thunderAttack)}
 function update(dt,{paused=false,camera:nextCamera=null,aim:nextAim=null}={}){if(released||paused||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.1);clock+=dt;locomotionTime+=dt*locomotionRate;if(locomotion==='idle'&&!overlay){const previous=stopRemaining;stopRemaining=Math.max(0,stopRemaining-dt);idleTime+=Math.max(0,dt-previous)}if(nextCamera)viewCamera=nextCamera;if(nextAim)aim=captureAim(nextAim)??aim;if(pending&&!pending.loop&&pending.duration!==null&&clock-pending.startedAt>=pending.duration)pending=null;if(overlay){overlay.time+=dt;if(!overlay.loop&&overlay.time>=overlay.duration)overlay=null}selectFrame()}
 function reset(){pending=null;overlay=null;clock=locomotionTime=0;lastFacingSide=0;stopRemaining=idleTime=0;locomotion='idle';locomotionRate=1;glow={charge:0,thunder:false};selectFrame()}
 async function load(raw){
  if(released)return {ok:false,reason:'released'};const first=generation===0?pending:null,ticket=++generation;pending=first?{...first,generation:ticket}:null;lastFacingSide=0;overlay=null;glow={charge:0,thunder:false};clearLoaded();let incoming;
  try{incoming=cleanManifest({...raw,height:raw?.height??height})}catch(error){pending=null;publish({load:'placeholder',played:null,fallback:true,reason:String(error.message),clips:[]});return {ok:false,reason:'invalid_manifest'}}
  publish({load:'loading',played:null,fallback:true,reason:'loading',clips:Object.keys(incoming.clips)});cameraHeading(viewCamera);const view=spriteFacingDirection(aim,viewYaw),seeds=[];
  for(const key of ['idle',locomotion,pending?.key,'attack','charge',...Object.keys(incoming.clips)]){const clip=incoming.clips[key];if(!clip)continue;const names=Object.keys(clip.directions),index=SPRITE_DIRECTIONS.indexOf(view),best=names.includes(view)?view:names.sort((a,b)=>{const d=name=>{const n=Math.abs(SPRITE_DIRECTIONS.indexOf(name)-index);return Math.min(n,8-n)};return d(a)-d(b)})[0],url=clip.directions[best].url;if(key==='idle'&&!idleUrl)idleUrl=url;if(!seeds.includes(url)&&seeds.length<textureBudget)seeds.push(url)}
  const urls=seeds,loaded=new Map();
  const settled=await Promise.allSettled(urls.map(async url=>{const texture=await loader(url);if(!texture?.isTexture)throw Error('Texture loader returned no texture');loaded.set(url,texture);return texture}));
  if(ticket!==generation||released){disposeTextures(loaded.values());return {ok:false,reason:'stale'}}
  if(settled.some(r=>r.status==='rejected')){disposeTextures(loaded.values());pending=null;publish({load:'error',played:null,fallback:true,reason:'texture_load_failed'});return {ok:false,reason:'texture_load_failed'}}
  for(const texture of loaded.values())prepareTexture(texture)
  manifest=incoming;textures=loaded;for(const url of textures.keys())usage.set(url,++useTick);publish({load:'ready',reason:null,clips:Object.keys(manifest.clips)});
  const intent=pending;pending=null;if(intent?.generation===ticket){const age=clock-intent.startedAt;if(begin(intent.key,{durationSeconds:intent.duration,loop:intent.loop,requested:intent.requested,aim:intent.aim,comboStage:intent.comboStage,impactDelay:intent.impactDelay})){const duration=overlay.duration;if(!intent.loop&&age>=duration)overlay=null;else overlay.time=intent.loop?age%duration:age}}
  selectFrame();return {ok:true};
 }
 function release(){if(released)return;released=true;generation++;pending=null;overlay=null;glow={charge:0,thunder:false};clearLoaded();geometry.dispose();material.dispose();root.removeFromParent();publish({load:'released',played:null,fallback:true,reason:'released',clips:[]})}
 return {root,load,isReady:()=>status.load==='ready',setState,setFacing,setLocomotion,playAttack,playSkill,setCharge,cancelAttack,setOpacity,setWeaponGlow,update,reset,release,getStatus:()=>({...status,clips:[...(status.clips||[])],opacity,locomotion,lowerTime:locomotionTime,upperAttack:!!overlay,upperAttackTime:overlay?.time??0,comboStage:overlay?.comboStage??null,comboSource:overlay?.comboSource??null,stopRemaining,idleBreathing:locomotion==='idle'&&!overlay&&stopRemaining===0,proceduralScale:{x:quad.scale.x,y:quad.scale.y},layered:false,fullBodyAttack:!!overlay&&status.played!==locomotion,charge:overlay?.key==='charge'||overlay?.key==='chargeGlow',overlay:overlay?.key??null,pendingOverlay:pending?.key??null,pendingAge:pending?clock-pending.startedAt:0,weaponGlow:{...glow,supported:(!glow.charge||!!manifest?.clips.chargeGlow)&&(!glow.thunder||!!manifest?.clips.thunderAttack)},textures:textures.size,maxTextures:textureBudget,loadingTextures:pendingTextures.size,availableDirections:Object.fromEntries(Object.entries(manifest?.clips||{}).map(([key,clip])=>[key,Object.keys(clip.directions)]))})};
}

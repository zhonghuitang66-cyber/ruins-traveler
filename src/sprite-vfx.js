import * as T from '../vendor/three.module.js';

/** Real source-frame timing. A long browser stall never advances simulation by itself. */
export function atlasFrame(durations,elapsed,{loop=false,duration=null}={}){
 const total=durations.reduce((a,b)=>a+b,0);if(!total||!Number.isFinite(elapsed))return 0;
 let t=Math.max(0,elapsed);if(duration>0)t=t/duration*total;
 t=loop?t%total:Math.min(t,total-1e-8);let sum=0;
 for(let i=0;i<durations.length;i++){sum+=durations[i];if(t<sum)return i}return durations.length-1;
}
export function applyAtlasUV(geometry,frame,columns,rows){
 const x=frame%columns,y=Math.floor(frame/columns),uv=geometry.attributes.uv;
 // PlaneGeometry top-left, top-right, bottom-left, bottom-right. PNG rows run downward.
 uv.setXY(0,x/columns,1-y/rows);uv.setXY(1,(x+1)/columns,1-y/rows);
 uv.setXY(2,x/columns,1-(y+1)/rows);uv.setXY(3,(x+1)/columns,1-(y+1)/rows);uv.needsUpdate=true;
}

/** One shared GPU texture per atlas, bounded reusable quads; no per-frame texture clones. */
export function createSpriteVFX(scene,{catalog={},maxEffects=24,loadTexture=null}={}){
 const root=new T.Group();root.name='SkillVFX';scene.add(root);const slots=[],active=[],textures=new Map();
 let released=false,generation=0,budget=Math.max(1,Math.min(48,Math.floor(Number(maxEffects))||24)),quality='detail',reducedFlash=false,ready=false,error=null;
 const capacity=budget,loader=loadTexture||((url)=>new T.TextureLoader().loadAsync(url));
 const readyPromise=Promise.all(Object.entries(catalog).map(async([key,spec])=>{
  const texture=await loader(spec.url);if(released){texture.dispose();return}texture.colorSpace=T.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;textures.set(key,texture);
 })).then(()=>{ready=!released;return ready}).catch(e=>{error=String(e?.message||e);return false});
 function remove(i){const e=active[i];e.slot.used=false;e.slot.mesh.visible=false;active.splice(i,1)}
 function spawn(key,{x=0,z=0,y=.1,width=2,height=width,life=.5,loop=false,loopFrames=null,ground=false,angle=0,tint=0xffffff,opacity=1,tag='',owner='',priority=false,anchor=null}={}){
  if(released||!ready||!catalog[key]||![x,z,y,width,height,life,angle].every(Number.isFinite)||life<=0||width<=0||height<=0)return null;
  if(active.length>=budget){let i=active.findIndex(e=>!e.priority);if(i<0){if(!priority)return null;i=0}remove(i)}
  let slot=slots.find(s=>!s.used);if(!slot){
   const geometry=new T.PlaneGeometry(1,1),material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,toneMapped:false,alphaTest:.03});
   const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=3;root.add(mesh);slot={mesh,used:false};slots.push(slot);
   mesh.onBeforeRender=(_r,_s,camera)=>{if(mesh.userData.billboard){mesh.quaternion.copy(camera.quaternion);mesh.updateMatrixWorld(true)}};
  }
  slot.used=true;const m=slot.mesh;m.visible=true;m.name='vfx-'+(tag||key);m.userData={billboard:!ground,key,frame:0};m.position.set(x,y,z);m.rotation.set(ground?Math.PI/2:0,0,ground?-angle:0);m.scale.set(width,height,1);m.material.map=textures.get(key);m.material.color.setHex(tint);m.material.opacity=opacity*(reducedFlash?.5:1);m.material.needsUpdate=true;
  const e={slot,key,elapsed:0,life,loop,loopFrames,opacity,tag,owner,priority,anchor,generation};active.push(e);applyAtlasUV(m.geometry,0,catalog[key].columns,catalog[key].rows);return e;
 }
 function update(dt,{paused=false}={}){
  if(released||paused||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);
  for(let i=active.length-1;i>=0;i--){const e=active[i];e.elapsed+=dt;if(e.elapsed>=e.life||e.generation!==generation){remove(i);continue}
   const spec=catalog[e.key],durations=e.loop&&e.loopFrames?spec.durations.slice(0,e.loopFrames):spec.durations,m=e.slot.mesh,f=atlasFrame(durations,e.elapsed,{loop:e.loop,duration:e.loop?null:e.life});applyAtlasUV(m.geometry,f,spec.columns,spec.rows);m.userData.frame=f;
   if(e.anchor){m.position.x=e.anchor.x;m.position.z=e.anchor.z}
   // The animation supplies its own emergence/dissipation. Only the final edge is eased.
   const fade=e.priority?1:Math.min(1,(e.life-e.elapsed)/Math.min(.08,e.life*.15));m.material.opacity=e.opacity*fade*(reducedFlash?(e.priority?.78:.5):1);
  }
 }
 function cancel(predicate){for(let i=active.length-1;i>=0;i--)if(predicate(active[i]))remove(i)}
 function reset(){generation++;cancel(()=>true)}
 function configure(o={}){if(['economy','standard','detail'].includes(o.quality))quality=o.quality;if(typeof o.reducedFlash==='boolean')reducedFlash=o.reducedFlash;budget=Math.max(1,Math.floor(capacity*(quality==='economy'?.5:quality==='standard'?.75:1)));while(active.length>budget){const i=active.findIndex(e=>!e.priority);if(i<0)break;remove(i)}}
 function release(){if(released)return;reset();released=true;ready=false;root.removeFromParent();for(const s of slots){s.mesh.geometry.dispose();s.mesh.material.dispose()}for(const t of textures.values())t.dispose();textures.clear()}
 return {root,spawn,update,cancel,reset,configure,release,ready:readyPromise,isReady:()=>ready,getStats:()=>({ready,error,effects:active.length,particles:0,pooledMeshes:slots.length,maxEffects:budget,quality,reducedFlash,textures:textures.size,frames:active.map(e=>({key:e.key,frame:e.slot.mesh.userData.frame,tag:e.tag,owner:e.owner}))})};
}

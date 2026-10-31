import * as T from '../vendor/three.module.js';
/** Meter-based warning footprints. Texture-free circle/capsule SDF; unrelated to hero attack art. */
export function createGroundWarnings(scene){
 const root=new T.Group();root.name='GroundWarnings';scene.add(root);const slots=[],active=[];let released=false,serial=0;
 const vertex=`varying vec2 vMeters;uniform vec2 uSize;void main(){vMeters=position.xy*uSize;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
 const fragment=`varying vec2 vMeters;uniform float uRadius;uniform float uHalfPath;uniform float uProgress;void main(){vec2 q=vec2(vMeters.x,vMeters.y-clamp(vMeters.y,-uHalfPath,uHalfPath));float sd=length(q)-uRadius;float cover=1.0-smoothstep(-0.025,0.025,sd);if(cover<0.01)discard;float edge=1.0-smoothstep(0.035,0.10,abs(sd));vec3 fill=mix(vec3(1.0,0.30,0.035),vec3(1.0,0.10,0.025),uProgress);vec3 color=mix(fill,vec3(1.0,0.68,0.15),edge);float alpha=(0.22+0.14*uProgress+edge*0.35)*cover;gl_FragColor=vec4(color,alpha);}`;
 function remove(e){e.slot.mesh.visible=false;e.slot.used=false;const i=active.indexOf(e);if(i>=0)active.splice(i,1)}
 function makeSlot(){const uniforms={uSize:{value:new T.Vector2()},uRadius:{value:1},uHalfPath:{value:0},uProgress:{value:0}},geometry=new T.PlaneGeometry(1,1),material=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,toneMapped:false,uniforms,vertexShader:vertex,fragmentShader:fragment}),mesh=new T.Mesh(geometry,material);mesh.name='GroundWarning';mesh.visible=false;mesh.frustumCulled=false;mesh.rotation.x=-Math.PI/2;mesh.renderOrder=4;root.add(mesh);const s={mesh,used:false};slots.push(s);return s}
 function emit(type,d={}){
  if(released)return;
  if(type==='warning-cancel'){
   if(!d.warningId&&d.bossId===undefined&&!d.actionId)return;
   for(const e of [...active])if(d.warningId?e.warningId===d.warningId:(d.bossId===undefined||e.bossId===d.bossId)&&(!d.actionId||e.actionId===d.actionId))remove(e);return;
  }
  if(type!=='warning'||d.owner==='player'||![d.x,d.z].every(Number.isFinite))return;
  const life=Number.isFinite(d.life)?d.life:1;if(life<=0)return;
  const capsule=d.shape==='capsule'||Number.isFinite(d.length)&&d.length>0,r=capsule?(Number.isFinite(d.w)?d.w/2:d.r):d.r;
  const path=capsule?Math.max(0,Number.isFinite(d.pathLength)?d.pathLength:d.length||0):0;
  if(!Number.isFinite(r)||r<=0||!Number.isFinite(path))return;
  if(d.warningId)for(const e of [...active])if(e.warningId===d.warningId)remove(e);
  if(active.length>=24)remove(active[0]);const slot=slots.find(s=>!s.used)||makeSlot(),mesh=slot.mesh,width=2*r,length=path+2*r;slot.used=true;mesh.visible=true;mesh.position.set(d.x,.04,d.z);
  // Local +Y lies along world direction(sin(angle),cos(angle)).
  mesh.rotation.set(Math.PI/2,0,-(Number.isFinite(d.angle)?d.angle:0));mesh.scale.set(width,length,1);mesh.material.uniforms.uSize.value.set(width,length);mesh.material.uniforms.uRadius.value=r;mesh.material.uniforms.uHalfPath.value=path/2;mesh.material.uniforms.uProgress.value=0;
  const e={slot,serial:++serial,life,elapsed:0,bossId:d.bossId,actionId:d.actionId,warningId:d.warningId,phase:d.phase,shape:capsule?'capsule':'circle',radius:r,pathLength:path};active.push(e);return e;
 }
 function update(dt,{paused=false}={}){if(released||paused||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);for(const e of [...active]){e.elapsed+=dt;if(e.elapsed+1e-8>=e.life)remove(e);else e.slot.mesh.material.uniforms.uProgress.value=Math.min(1,e.elapsed/e.life)}}
 function reset(){for(const e of [...active])remove(e)}
 function release(){if(released)return;reset();released=true;root.removeFromParent();for(const s of slots){s.mesh.geometry.dispose();s.mesh.material.dispose()}}
 return {emit,update,reset,release,getStats:()=>({released,active:active.length,pooledMeshes:slots.length,maxEffects:24,warnings:active.map(e=>({bossId:e.bossId,actionId:e.actionId,warningId:e.warningId,phase:e.phase,shape:e.shape,radius:e.radius,pathLength:e.pathLength,elapsed:e.elapsed,life:e.life}))})};
}

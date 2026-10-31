import {Group,Mesh,PlaneGeometry,MeshBasicMaterial,DoubleSide} from '../vendor/three.module.js';

/** Presentation clock only: never delays damage, cooldowns, AI or simulation. */
export function impactSample(age,{reducedFlash=false}={}){
 const t=Number.isFinite(age)?Math.max(0,age):Infinity;
 return {white:reducedFlash?0:t<.065?1:t<.11?(.11-t)/.045:0,hold:t<.035,alive:t<.32};
}
export function hitDirection(event,source){
 const x=event.dx??(event.x-source?.x),z=event.dz??(event.z-source?.z),n=Math.hypot(x,z);
 return Number.isFinite(n)&&n>1e-6?{x:x/n,z:z/n}:{x:0,z:1};
}
export function hitSound(event){return event.shieldDamage>0?'guard':'hurt'}

/** Owns cloned materials, bounded red shards and a white silhouette shader.
 * Register actors after their asynchronous visual loads; unregister before disposal.
 * emit is called once from the confirmed hit event, alongside damage numbers.
 */
export function createImpactFeedback({scene,audio=null,maxShards=48}={}){
 const root=new Group();root.name='ImpactRedShards';scene?.add(root);
 const geometry=new PlaneGeometry(1,1),shardMaterial=new MeshBasicMaterial({color:0xe9322f,transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false});
 const count=Math.max(0,Math.min(96,Math.floor(maxShards)||0)),shards=[];
 for(let i=0;i<count;i++){const mesh=new Mesh(geometry,shardMaterial.clone());mesh.visible=false;root.add(mesh);shards.push({mesh,age:1,life:.28,vx:0,vz:0,vy:0})}
 const actors=new Map();let released=false,cursor=0;
 function unregister(id){const entry=actors.get(id);if(!entry)return;entry.uniform.value=0;for(const restore of entry.restores)restore();actors.delete(id)}
 function register(id,object,{dynamicMaterial=false}={}){if(released||!object)return false;unregister(id);const uniform={value:0},restores=[];
  object.traverse(mesh=>{if(!mesh.isMesh||!mesh.material)return;const original=mesh.material;
   // Only the sprite quad owns a runtime-mutated material. Hidden fallback mesh
   // materials can be shared by many actors and must still be cloned.
   const dynamic=dynamicMaterial&&mesh.name==='SpriteCharacterQuad';
   const install=material=>{const owned=dynamic?material:material.clone(),prior=owned.onBeforeCompile,priorKey=owned.customProgramCacheKey;
    const baseKey=priorKey?.call(owned)??'';
    owned.onBeforeCompile=function(shader,...args){prior?.call(this,shader,...args);shader.uniforms.impactWhite=uniform;shader.fragmentShader='uniform float impactWhite;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), impactWhite);')};owned.customProgramCacheKey=()=>`impact-white-v2:${baseKey}`;owned.needsUpdate=true;
    restores.push(()=>{if(dynamic){owned.onBeforeCompile=prior;owned.customProgramCacheKey=priorKey;owned.needsUpdate=true}else owned.dispose()});return owned};
   const owned=Array.isArray(original)?original.map(install):install(original);mesh.material=owned;if(!dynamic)restores.push(()=>{if(mesh.material===owned)mesh.material=original})
  });actors.set(id,{object,uniform,restores,age:Infinity});return true;
 }
 function emit(event,source,{reducedFlash=false}={}){if(released||!event||!Number.isFinite(event.damage)||event.damage<=0)return false;const entry=actors.get(event.id);if(entry){entry.age=0;entry.reducedFlash=reducedFlash;entry.uniform.value=reducedFlash?0:1}void audio?.play?.(hitSound(event),{volume:.55});
  if(Number.isFinite(event.x)&&Number.isFinite(event.z)&&shards.length){const direction=hitDirection(event,source),angle=Math.atan2(direction.z,direction.x);for(let i=0;i<6;i++){const shard=shards[cursor++%shards.length],theta=angle+(i-2.5)*.31,speed=1.3+i*.12;shard.age=0;shard.vx=Math.cos(theta)*speed;shard.vz=Math.sin(theta)*speed;shard.vy=1.4+(i%3)*.28;shard.mesh.position.set(event.x,.9,event.z);shard.mesh.scale.set(.045+(i%2)*.025,.12+(i%3)*.025,1);shard.mesh.rotation.set(-.4,theta,i*.9);shard.mesh.material.opacity=1;shard.mesh.visible=true}}return true;
 }
 function update(dt,{paused=false,camera=null}={}){if(released||paused||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.1);for(const entry of actors.values()){entry.age+=dt;entry.uniform.value=impactSample(entry.age,{reducedFlash:entry.reducedFlash}).white}for(const shard of shards){if(!shard.mesh.visible)continue;shard.age+=dt;if(shard.age>=shard.life){shard.mesh.visible=false;continue}shard.vy-=8*dt;shard.mesh.position.x+=shard.vx*dt;shard.mesh.position.z+=shard.vz*dt;shard.mesh.position.y+=shard.vy*dt;shard.mesh.material.opacity=1-shard.age/shard.life;if(camera)shard.mesh.quaternion.copy(camera.quaternion);shard.mesh.rotateZ(shard.age*7)}}
 function held(id){return impactSample(actors.get(id)?.age??Infinity).hold}
 function reset(){for(const entry of actors.values()){entry.age=Infinity;entry.uniform.value=0}for(const shard of shards)shard.mesh.visible=false}
 function release(){if(released)return;released=true;for(const id of [...actors.keys()])unregister(id);for(const shard of shards)shard.mesh.material.dispose();geometry.dispose();shardMaterial.dispose();root.removeFromParent()}
 return {root,register,unregister,emit,update,held,reset,release,getStats:()=>({actors:actors.size,activeShards:shards.filter(s=>s.mesh.visible).length,maxShards:count,released})};
}

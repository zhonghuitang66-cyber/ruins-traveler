import * as T from '../vendor/three.module.js';
/** One owned, genuinely spherical transparent shell; no camera-facing sprite. */
export function createHolyShield(scene){
 const geometry=new T.SphereGeometry(1.5,32,20),uniforms={uTime:{value:0},uEye:{value:new T.Vector3()},uIntensity:{value:1}};
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:T.DoubleSide,toneMapped:false,uniforms,
  vertexShader:`varying vec3 vWorldPosition;varying vec3 vWorldNormal;
   void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorldPosition=world.xyz;vWorldNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}`,
  fragmentShader:`uniform float uTime;uniform vec3 uEye;uniform float uIntensity;varying vec3 vWorldPosition;varying vec3 vWorldNormal;
   void main(){vec3 viewDir=normalize(uEye-vWorldPosition);float rim=pow(1.0-abs(dot(normalize(vWorldNormal),viewDir)),3.2);
    float pulse=0.94+0.06*sin(uTime*2.5);vec3 gold=vec3(1.0,0.83,0.39);vec3 cyan=vec3(0.55,0.95,1.0);vec3 shell=mix(gold,cyan,rim*0.65);shell=mix(shell,vec3(1.0),rim*0.6);
    float alpha=(0.018+0.24*rim)*pulse*uIntensity;gl_FragColor=vec4(shell,alpha);}`});
 const mesh=new T.Mesh(geometry,material);mesh.name='HolyShieldSphere';mesh.visible=false;mesh.renderOrder=2;mesh.frustumCulled=false;scene.add(mesh);let released=false;
 mesh.onBeforeRender=(_renderer,_scene,camera)=>{if(!released&&camera?.getWorldPosition)camera.getWorldPosition(uniforms.uEye.value)};
 function update(dt,{paused=false,world,reducedFlash=false}={}){
  if(released)return;const p=world?.player,active=world?.running===true&&p?.hp>0&&world.guard>0&&Number.isFinite(p.x)&&Number.isFinite(p.z);
  mesh.visible=!!active;if(!active||paused)return;
  mesh.position.set(p.x,1,p.z);uniforms.uIntensity.value=reducedFlash?.65:1;
  if(Number.isFinite(dt)&&dt>0)uniforms.uTime.value+=Math.min(dt,.05);
 }
 function reset(){if(released)return;mesh.visible=false;uniforms.uTime.value=0;uniforms.uIntensity.value=1;mesh.position.set(0,1,0)}
 function release(){if(released)return;reset();released=true;mesh.removeFromParent();geometry.dispose();material.dispose()}
 return {update,reset,release,getStats:()=>({visible:mesh.visible&&!released,released,elapsed:uniforms.uTime.value,meshes:released?0:1,geometries:released?0:1,materials:released?0:1})};
}

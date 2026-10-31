import * as T from '../vendor/three.module.js';
/** Three thin wind wisps orbit outside the character; no blade sprite on the body. */
export function createCloakWind(scene){
 const root=new T.Group();root.name='CloakWindWisps';root.visible=false;scene.add(root);const vertices=[],indices=[],segments=28;
 for(let i=0;i<=segments;i++){const t=i/segments,a=t*Math.PI*.65,r=1.4+.08*Math.sin(t*Math.PI),width=.045*Math.sin(t*Math.PI);for(const side of [-1,1])vertices.push(Math.cos(a)*(r+side*width),t*.32,Math.sin(a)*(r+side*width));if(i<segments){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2)}}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);const material=new T.MeshBasicMaterial({color:0x9be5ba,transparent:true,opacity:.56,depthWrite:false,side:T.DoubleSide,toneMapped:false});
 for(let i=0;i<3;i++){const m=new T.Mesh(geometry,material);m.rotation.y=i*Math.PI*2/3;m.position.y=.2+i*.27;root.add(m)}let elapsed=0,released=false;
 function update(dt,{world,paused=false,reducedFlash=false}={}){if(released)return;const p=world?.player;root.visible=!!(world?.running&&p?.hp>0&&world.invis>0);if(!root.visible||paused)return;root.position.set(p.x,0,p.z);material.opacity=reducedFlash?.35:.56;if(Number.isFinite(dt)&&dt>0)elapsed+=Math.min(dt,.05);root.rotation.y=elapsed*2.3}
 function reset(){root.visible=false;elapsed=0;root.rotation.y=0}
 function release(){if(released)return;reset();released=true;root.removeFromParent();geometry.dispose();material.dispose()}
 return {update,reset,release,getStats:()=>({visible:root.visible&&!released,elapsed,wisps:released?0:3,radius:1.4})};
}

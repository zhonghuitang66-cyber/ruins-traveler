import * as T from '../vendor/three.module.js';

// A logical object can span several instanced batches (trunk/crowns or wall/caps).
// Its alpha lives in an instance attribute, never in a shared world material.
export function createSceneryOcclusion({opacity=.3}={}){
 const groups=new Map(),batches=[],scratch=new T.Vector3();
 function register(batch,ids){
  batch.geometry=batch.geometry.clone();
  const values=new Float32Array(batch.count).fill(1),attribute=new T.InstancedBufferAttribute(values,1);
  batch.geometry.setAttribute('instanceFade',attribute);
  const multi=Array.isArray(batch.material),originals=multi?batch.material:[batch.material];
  const makeMaterial=(original,fade)=>{
   const material=original.clone(),previous=original.onBeforeCompile;material.transparent=fade;material.depthWrite=!fade;
   material.onBeforeCompile=shader=>{previous?.call(material,shader);shader.vertexShader='attribute float instanceFade; varying float sceneryFade;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsceneryFade = instanceFade;');shader.fragmentShader='varying float sceneryFade;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+(fade?'if (sceneryFade >= 0.99) discard;\ndiffuseColor.a *= sceneryFade;':'if (sceneryFade < 0.99) discard;'))};
   material.customProgramCacheKey=()=> 'logical-scenery-instance-fade-v2-'+(fade?'transparent':'opaque');return material;
  };
  const materials=originals.map(original=>makeMaterial(original,false)),fadeMaterials=originals.map(original=>makeMaterial(original,true));batch.material=multi?materials:materials[0];
  // Keep solid instances in the depth-writing opaque pass. Faded instances render
  // before transparent actor quads without writing depth, so they cannot hide them.
  const fadeBatch=new T.InstancedMesh(batch.geometry,multi?fadeMaterials:fadeMaterials[0],batch.count);fadeBatch.name='SceneryTransparentPass';fadeBatch.instanceMatrix=batch.instanceMatrix;fadeBatch.instanceColor=batch.instanceColor;fadeBatch.renderOrder=-10;fadeBatch.castShadow=false;fadeBatch.receiveShadow=batch.receiveShadow;fadeBatch.visible=false;batch.add(fadeBatch);batch.userData.sceneryFadePass=fadeBatch;
  batch.geometry.computeBoundingBox();const matrix=new T.Matrix4();batch.updateMatrixWorld(true);
  ids.forEach((id,index)=>{if(id==null)return;batch.getMatrixAt(index,matrix);matrix.premultiply(batch.matrixWorld);const bounds=batch.geometry.boundingBox.clone().applyMatrix4(matrix);let entry=groups.get(id);if(!entry){entry={bounds:new T.Box3(),parts:[],faded:false};groups.set(id,entry)}entry.bounds.union(bounds);entry.parts.push({attribute,index})});
  batches.push({batch,materials:[...materials,...fadeMaterials],fadeBatch,attribute});return batch;
 }
 function update(camera,player){
  if(!player||![player.x,player.z].every(Number.isFinite)){reset();return}
  const start=new T.Vector3(player.x,(player.y||0)+1.25,player.z),end=camera.getWorldPosition(scratch);
  for(const entry of groups.values()){
   const faded=segmentIntersectsBounds(start,end,entry.bounds),alpha=faded?opacity:1;
   if(faded===entry.faded)continue;entry.faded=faded;
   for(const part of entry.parts){part.attribute.setX(part.index,alpha);part.attribute.needsUpdate=true}
  }
  for(const row of batches)row.fadeBatch.visible=row.attribute.array.some(value=>value<.99);
 }
 function reset(){for(const entry of groups.values()){entry.faded=false;for(const p of entry.parts){p.attribute.setX(p.index,1);p.attribute.needsUpdate=true}}for(const row of batches)row.fadeBatch.visible=false}
 return {register,update,reset,groups,release(){reset();for(const {batch,materials,fadeBatch}of batches){fadeBatch.removeFromParent();delete batch.userData.sceneryFadePass;batch.geometry.dispose();for(const material of materials)material.dispose()}groups.clear();batches.length=0}};
}

export function segmentIntersectsBounds(a,b,bounds){
 let lo=.005,hi=.995;
 for(const key of ['x','y','z']){const delta=b[key]-a[key];if(Math.abs(delta)<1e-9){if(a[key]<bounds.min[key]||a[key]>bounds.max[key])return false;continue}let near=(bounds.min[key]-a[key])/delta,far=(bounds.max[key]-a[key])/delta;if(near>far)[near,far]=[far,near];lo=Math.max(lo,near);hi=Math.min(hi,far);if(lo>hi)return false}
 return true;
}

function instance(scene,geometry,material,rows,occlusion){
 const batch=new T.InstancedMesh(geometry,material,rows.length),temp=new T.Object3D();
 rows.forEach((r,i)=>{temp.position.set(r.x,r.y,r.z);temp.rotation.set(0,r.rot||0,0);temp.scale.set(r.sx,r.sy,r.sz);temp.updateMatrix();batch.setMatrixAt(i,temp.matrix)});
 batch.castShadow=batch.receiveShadow=true;scene.add(batch);occlusion.register(batch,rows.map(r=>r.id));return batch;
}

/** Replacement for the original tree loop: all tree dimensions are halved. */
export function createOccludingTrees(scene,trees,{trunkGeo,crownGeo,materials,occlusion}){
 const trunks=[],leaves=[[],[],[]];trees.forEach((tree,index)=>{const s=tree.scale*.5,id=`tree-${index}`;trunks.push({id,x:tree.x,y:1.9*s,z:tree.z,sx:s,sy:3.8*s,sz:s});for(let j=0;j<4;j++)leaves[j%3].push({id,x:tree.x+Math.sin(j*2.4)*s,y:(3.5+j*.4)*s,z:tree.z+Math.cos(j*2.4)*s,sx:(1.8+j*.15)*s,sy:(1.5+j*.1)*s,sz:(1.8+j*.1)*s,rot:j})});
 return [instance(scene,trunkGeo,materials.bark,trunks,occlusion),...leaves.map((rows,i)=>instance(scene,crownGeo,[materials.leaf,materials.leaf2,materials.leaf3][i],rows,occlusion))];
}

/** Batch the actual visible wall pieces, including their coping stones. */
export function batchStaticScenery(scene,staticGroup,walls,occlusion){
 staticGroup.updateMatrixWorld(true);const grouped=new Map(),wallRows=walls.filter(w=>!w.scenery);
 // Doorway-split halves on the same facade are one wall for visibility.
 const parents=wallRows.map((_,i)=>i),find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 for(let i=0;i<wallRows.length;i++)for(let j=i+1;j<wallRows.length;j++){
  const a=wallRows[i],b=wallRows[j],horizontal=a.w>=a.d;
  if(horizontal!==(b.w>=b.d))continue;
  const plane=horizontal?'z':'x',axis=horizontal?'x':'z',length=horizontal?'w':'d';
  if(Math.abs(a[plane]-b[plane])>.05)continue;
  const gap=Math.max(a[axis]-a[length]/2,b[axis]-b[length]/2)-Math.min(a[axis]+a[length]/2,b[axis]+b[length]/2);
  if(gap<=5)parents[find(j)]=find(i);
 }
 staticGroup.traverse(object=>{if(!object.isMesh)return;const key=object.geometry.uuid+object.material.uuid;let rows=grouped.get(key);if(!rows){rows=[];grouped.set(key,rows)}
  const position=object.getWorldPosition(new T.Vector3());
  const index=position.y>.3?wallRows.findIndex(w=>Math.abs(position.x-w.x)<=w.w/2+.05&&Math.abs(position.z-w.z)<=w.d/2+.05&&position.y<=w.h+.5):-1;
  rows.push({object,id:index>=0?`wall-${find(index)}`:null});
 });
 const results=[];for(const rows of grouped.values()){
  const batch=new T.InstancedMesh(rows[0].object.geometry,rows[0].object.material,rows.length);rows.forEach((row,i)=>batch.setMatrixAt(i,row.object.matrixWorld));batch.castShadow=batch.receiveShadow=true;scene.add(batch);
  if(rows.some(row=>row.id))occlusion.register(batch,rows.map(row=>row.id));results.push(batch);
 }
 staticGroup.visible=false;return results;
}

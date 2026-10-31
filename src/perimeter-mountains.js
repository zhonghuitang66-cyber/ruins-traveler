import * as T from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/addons/loaders/GLTFLoader.js';
import {perimeterMountainLayout} from './perimeter-layout.js';
export {perimeterMountainLayout,perimeterMountainWalls} from './perimeter-layout.js';

/** Inner rock edge is 89m, exactly the existing legal map boundary. */

/** One downloaded Tripo ridge is instanced around the boundary; no new API at runtime. */
export async function loadPerimeterMountains(scene,{occlusion,url='assets/scenery/perimeter-mountain.glb',placements=perimeterMountainLayout()}={}){
 const loader=new GLTFLoader(),gltf=await loader.loadAsync(url),source=gltf.scene;
 source.updateMatrixWorld(true);const box=new T.Box3().setFromObject(source),size=box.getSize(new T.Vector3()),center=new T.Vector3();
 // Providers may choose either horizontal major axis; normalize the long ridge to X.
 if(size.z>size.x){source.rotation.y+=Math.PI/2;source.updateMatrixWorld(true);box.setFromObject(source);box.getSize(size)}box.getCenter(center);
 if(![size.x,size.y,size.z].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid mountain bounds');
 const normalize=new T.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z),root=new T.Group(),batches=[],owned=new Set();root.name='TripoPerimeterMountains';scene.add(root);
 source.traverse(mesh=>{if(!mesh.isMesh)return;const batch=new T.InstancedMesh(mesh.geometry,mesh.material,placements.length),pose=new T.Object3D();
  placements.forEach((p,i)=>{pose.position.set(p.x,0,p.z);pose.rotation.set(0,p.rotation,0);pose.scale.set(p.width/size.x,p.height/size.y,p.depth/size.z);pose.updateMatrix();const matrix=pose.matrix.clone().multiply(normalize).multiply(mesh.matrixWorld);batch.setMatrixAt(i,matrix)});
  batch.castShadow=batch.receiveShadow=true;root.add(batch);occlusion?.register(batch,placements.map(p=>p.id));batches.push(batch);owned.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){owned.add(material);for(const value of Object.values(material))if(value?.isTexture)owned.add(value)}
 });
 return {root,count:placements.length,batches,release(){root.removeFromParent();for(const resource of owned)resource.dispose();owned.clear()}};
}

import * as T from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/addons/loaders/GLTFLoader.js';
/** Generated modular scenery; base walls remain usable if a module cannot decode. */
export async function loadSceneAssets(scene,{placements=[],manifestUrl='assets/scenery/scene-runtime.json'}={}){
 const root=new T.Group();root.name='TripoAcademyScenery';scene.add(root);const owned=new Set(),loaded={},failures=[];
 const response=await fetch(manifestUrl);if(!response.ok){root.removeFromParent();return {ok:false,count:0,release(){}}}const catalog=await response.json(),base=new URL(manifestUrl,location.href),loader=new GLTFLoader();
 await Promise.all(Object.entries(catalog.modules||{}).map(async([key,spec])=>{try{const gltf=await loader.loadAsync(new URL(spec.url,base).href),model=gltf.scene;model.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());if(Math.min(size.x,size.y,size.z)<=0)throw Error('empty module');model.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;owned.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){owned.add(m);for(const value of Object.values(m))if(value?.isTexture)owned.add(value)}}});loaded[key]={model,size,center,minY:bounds.min.y}}catch{failures.push(key)}}));
 let count=0;for(const p of placements){const t=loaded[p.module];if(!t)continue;const anchor=new T.Group(),copy=t.model.clone(true);copy.position.set(-t.center.x,-t.minY,-t.center.z);anchor.add(copy);anchor.scale.set(p.width/t.size.x,p.height/t.size.y,p.depth/t.size.z);anchor.position.set(p.x,.05,p.z);anchor.name=p.id;root.add(anchor);count++}
 return {ok:count>0,count,failures,root,release(){root.removeFromParent();for(const resource of owned)resource.dispose();owned.clear()}};
}

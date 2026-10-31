import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {createSceneryOcclusion,createOccludingTrees,batchStaticScenery,segmentIntersectsBounds} from '../src/scenery-occlusion.js';
import {perimeterMountainLayout,perimeterMountainWalls} from '../src/perimeter-mountains.js';

test('tree half scale and logical alpha cover trunk plus all crowns only for blocking tree',()=>{
 const scene=new T.Scene(),material=new T.MeshBasicMaterial(),occlusion=createSceneryOcclusion(),batches=createOccludingTrees(scene,[{x:0,z:0,scale:1},{x:-20,z:0,scale:1}],{trunkGeo:new T.BoxGeometry(1,1,1),crownGeo:new T.BoxGeometry(1,1,1),materials:{bark:material,leaf:material,leaf2:material,leaf3:material},occlusion});
 const matrix=new T.Matrix4(),position=new T.Vector3(),scale=new T.Vector3(),rotation=new T.Quaternion();batches[0].getMatrixAt(0,matrix);matrix.decompose(position,rotation,scale);assert.equal(scale.y,1.899999976158142);
 const camera=new T.PerspectiveCamera();camera.position.set(0,8,8);occlusion.update(camera,{x:0,z:-2});
 assert.equal(occlusion.groups.get('tree-0').parts.length,5);assert.equal(occlusion.groups.get('tree-0').faded,true);assert.equal(occlusion.groups.get('tree-1').faded,false);
 for(const p of occlusion.groups.get('tree-0').parts)assert.ok(Math.abs(p.attribute.getX(p.index)-.3)<1e-6);
 assert.equal(material.transparent,false);occlusion.reset();for(const p of occlusion.groups.get('tree-0').parts)assert.equal(p.attribute.getX(p.index),1);
});
test('visible wall and coping stones share logical occlusion while unrelated decoration stays opaque',()=>{
 const scene=new T.Scene(),group=new T.Group(),geo=new T.BoxGeometry(1,1,1),mat=new T.MeshBasicMaterial(),occlusion=createSceneryOcclusion();scene.add(group);
 for(const [x,y,z]of [[0,1.2,0],[0,2.52,0],[15,1.2,0]]){const mesh=new T.Mesh(geo,mat);mesh.position.set(x,y,z);group.add(mesh)}
 const batches=batchStaticScenery(scene,group,[{x:0,z:0,w:6,d:1,h:2.4}],occlusion);assert.equal(group.visible,false);assert.equal(batches.length,1);assert.equal(occlusion.groups.get('wall-0').parts.length,2);
 const camera=new T.PerspectiveCamera();camera.position.set(0,5,5);occlusion.update(camera,{x:0,z:-3});assert.equal(occlusion.groups.get('wall-0').faded,true);assert.equal(batches[0].geometry.attributes.instanceFade.getX(2),1);
});
test('finite ray segment excludes obstacles behind camera or player',()=>{
 const bounds=new T.Box3(new T.Vector3(-1,0,2),new T.Vector3(1,2,3));assert.equal(segmentIntersectsBounds({x:0,y:1,z:0},{x:0,y:1,z:5},bounds),true);assert.equal(segmentIntersectsBounds({x:0,y:1,z:4},{x:0,y:1,z:5},bounds),false);
});
test('a doorway-split facade fades as one wall and preserves toon shader hooks',()=>{
 const scene=new T.Scene(),group=new T.Group(),occlusion=createSceneryOcclusion(),mat=new T.MeshToonMaterial();let originalCalled=false;mat.onBeforeCompile=()=>{originalCalled=true};
 const walls=[{x:-4,z:0,w:4,d:1,h:3},{x:4,z:0,w:4,d:1,h:3}];
 for(const wall of walls){const mesh=new T.Mesh(new T.BoxGeometry(1,1,1),mat);mesh.position.set(wall.x,1.5,wall.z);mesh.scale.set(wall.w,wall.h,wall.d);group.add(mesh)}scene.add(group);
 const [batch]=batchStaticScenery(scene,group,walls,occlusion);assert.equal(occlusion.groups.size,1);assert.equal(occlusion.groups.get('wall-0').parts.length,2);
 const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};batch.material.onBeforeCompile(shader);assert.equal(originalCalled,true);assert.match(shader.vertexShader,/sceneryFade = instanceFade/);assert.match(shader.fragmentShader,/if \(sceneryFade < 0.99\) discard/);assert.equal(batch.material.isMeshToonMaterial,true);
 const fade=batch.userData.sceneryFadePass,fadeShader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};fade.material.onBeforeCompile(fadeShader);assert.match(fadeShader.fragmentShader,/diffuseColor.a \*= sceneryFade/);assert.match(fadeShader.fragmentShader,/if \(sceneryFade >= 0.99\) discard/);
 assert.equal(batch.material.transparent,false);assert.equal(batch.material.depthWrite,true);assert.equal(fade.material.transparent,true);assert.equal(fade.material.depthWrite,false);assert.ok(fade.renderOrder<new T.Mesh().renderOrder);assert.equal(fade.instanceMatrix,batch.instanceMatrix);assert.equal(fade.geometry,batch.geometry);
 const camera=new T.PerspectiveCamera();camera.position.set(-4,5,5);occlusion.update(camera,{x:-4,z:-3});assert.equal(fade.visible,true);occlusion.reset();assert.equal(fade.visible,false);
});
test('perimeter has continuous four-sided solid boundary at existing legal edge',()=>{
 const layout=perimeterMountainLayout(),walls=perimeterMountainWalls();assert.equal(layout.length,24);for(const w of walls)assert.equal(w.perimeter,true);
 for(let along=-88;along<=88;along++)for(const [x,z]of [[along,89],[along,-89],[89,along],[-89,along]])assert.ok(walls.some(w=>x>=w.x-w.w/2&&x<=w.x+w.w/2&&z>=w.z-w.d/2&&z<=w.z+w.d/2));
});

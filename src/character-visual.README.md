# 角色可视适配器 API

```js
import {createCharacterVisual} from './character-visual.js';
const visual=createCharacterVisual({placeholder:geometryActor,onStatus:status=>console.log(status)});
actorGroup.add(visual.root); // root的位置/朝向由主控更新；其内部自行归一化
await visual.load({approved:true,url:'assets/models/paladin.glb',height:2,yawRadians:0,
  clips:{idle:'Idle',run:['Run','Walk'],attack:'Attack',skill1:'HolyShield'}});
visual.root.position.set(player.x,0,player.z);
visual.root.rotation.y=playerFacing;
visual.setState('run');
visual.setState('skill',{clipKey:'skill1',force:true});
visual.update(deltaSeconds,{paused});
// 死亡若要维持最后一帧而非默认回idle，显式传returnTo:null。
visual.setState('death',{returnTo:null,force:true});
visual.release(); // 重开局先release旧适配器；不会dispose共享几何占位
```

`load()`读取manifest快照，不修改原对象。仅`approved===true`才加载，文件存在或生成任务成功不等于资产已验收。加载失败返回`{ok:false,reason:'load_failed'}`，保留占位；旧请求完成返回`stale`并释放其资源，不会污染新角色。`release`使正在加载的请求永久失效。

状态支持idle/run/attack/hit/death/jump/skill。真实clip不存在时`getStatus()`明确返回`fallback:true,reason:'missing_clip'`，`played`为实际Idle名称或null，绝不把静态模型说成已具有动作。单次动作结束默认回idle；重复触发攻击需force:true。逐帧不要force重置同一动作。缺少请求clip时仅回真实idle，不合成假动作。

主控要把战斗事件attack/hit/jump/skill映射到`setState`，不要每帧用idle/run立刻覆盖正在播放的一次性动作。可仅在`getStatus().oneShot===false`时按速度切换（缺clip的fallback也允许回移动）；事件完成会自动回idle。死亡若hold最后一帧，仍保留oneShot=true避免重新跑动。暂停不调用mixer.update，适配器update也会检查paused。

释放范围仅本次GLTFLoader独占新加载的场景资源（geometry/material/texture/ImageBitmap/skeleton）；不释放调用者传入的占位与外部共享材质。注入自定义loader仅用于测试或同样独占的加载器，禁止把缓存中多人共用的GLTF对象交给该适配器。默认没有全局模型缓存，不默认启用Draco/KTX2/meshopt；这类压缩模型需另行配置并验证解码器。

归一化基于实际Box3测得高度，默认2.0m、脚底y0、XZ居中；外层包装保持缩放/朝向独立于GLB动画轨道。clip移动根节点可能造成动画内位移，仍需资产验收时检查root motion与碰撞一致性。

官方依据：https://threejs.org/docs/pages/GLTFLoader.html ，https://threejs.org/docs/pages/AnimationMixer.html ，https://threejs.org/docs/pages/AnimationAction.html 。源码固定three@0.180.0，与现有REVISION180一致。

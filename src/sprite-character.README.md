# 帧动画角色运行时合同

`createSpriteCharacter({placeholder, camera, loadTexture, onStatus})` 使用一个真实透明贴图 billboard quad。根坐标是脚底世界坐标，不按武器轮廓或每帧包围盒重新居中。只换真实帧的 UV，没有假骨骼、程序摆手或全身染色冒充武器发光。默认不镜像；单方向临时过渡可由清单明确允许镜像，状态会如实标记。

## 清单

```js
{
  approved: true,
  height: 2,
  anchor: [.5, 1], // 图像从左上计，脚底在画布底边正中
  // baseUrl: absoluteManifestUrl, // 如清单URL不同于游戏页面，显式提供
  clips: {
    idle: {
      directions: {
        se: {
          approved: true,
          url: 'assets/characters/swordsman-idle-se.webp',
          columns: 4, rows: 2,
          frames: [0, 1, 2, 3, 4, 5, 6, 7],
          durations: [.1, .1, .1, .1, .1, .1, .1, .1]
          // anchor: [.5, .94], // 覆盖角色统一锚点，不能按武器bbox设置
        }
      }
    },
    attack: { durationSeconds: .65, cue: .72, directions: {/* 同上 */} }
  }
}
```

这是格式示例，不代表这些素材已经生成。`frames`也接受正整数帧数，表示从0顺序取格；未指定时使用全部格子。`durations`逐帧秒数；未给时默认8fps，可指定`fps`。每方向可用独立URL，也可引用同一atlas里的不同cell；同URL仅加载一张独占GPU纹理。默认按图像宽高/网格推导单帧长宽比，也可提供正数`aspect`。

方向为屏幕视图：n远离相机、s面向相机、e屏幕右、w屏幕左；其余ne/se/sw/nw是中间方向。相机水平投影将世界aim转换成这个方向，不能把世界+Z直接当屏幕n。只有实际存在的方向进入`availableDirections`；显式`approved:false`的方向不加载。缺方向选择最近实际方向，状态标注`missing_direction`，默认不通过mirror伪造相反握持；只有清单显式allowTemporaryMirror且sourceFacing声明实际源朝向时，才启用有诊断标记的临时左右镜像，不能称为已生成另一方向。

只要求真实`idle`存在即可加载；`isReady()`表示提供的资产已加载，不等于8方向/全部动作完成。单帧姿势会报告`animated:false`，不会称其为多帧动画。

## 与主游戏对接

- `setFacing({x,z},camera)` 显式传世界aim；`setLocomotion('idle'|'run',{rate:1,aim,camera})`和`update(dt,{paused,aim,camera})`也可传aim。billboard面向真实渲染相机，并抵消父级根旋转，不靠根旋转替代画面方向。
- `playAttack({durationSeconds,aim})`、`playSkill({index:0|1|2,durationSeconds,aim})`在启动时锁定世界aim。主控仍在core释放cue播放技能特效和伤害，运行时不修改战斗数值。
- `setCharge(true)`是幂等循环；`setCharge(false)`不会取消随后开始的`skill0`。`cancelAttack()`清除当前意图；`setState('hit')`使用真实`hurt`，缺动作返回false。
- 真正移动攻击优先`moveAttack`，移动施法优先`moveSkill0/1/2`或通用`moveCast`；缺失时run持续播放，仅在真实攻击cue前.08秒至后.10秒展示全身动作帧。状态`run_with_action_cue`明确这是短全身pose，不是上身分层。
- 移动蓄力优先`moveCharge`；缺失则继续run并标记`moving_charge_locomotion`。静止可播放真实charge。缺`skillN`可用真实通用`cast`，会标记`generic_cast`；缺attack/hurt则不假称有动作。
- `setOpacity(.35)`只改独占quad材质，不动调用方占位材质。`setWeaponGlow({charge,thunder})`只有提供真实`chargeGlow`/`thunderAttack`完整帧变体时支持；否则返回false，状态说明不支持，绝不把整个角色染色充当局部武器发光。
- `upperAttack`/`lowerTime`等字段是旧API兼容诊断；`layered:false`始终明确本实现不具备骨骼上下身分层。

## 生命周期与边界

纹理加载期间仅保留最新动作意图，按未暂停模拟时间老化；过期不补播，取消不复活。换代/释放会清掉旧意图，迟到纹理仅回收。每个atlas纹理独占，release/失败/旧代次仅dispose一次，ImageBitmap也会close。quad几何、材质仅各一份，release重复调用安全；不释放外部placeholder资源。

alphaTest .04、depthWrite=false、透明贴图避免低alpha暗边及透明矩形遮挡。原素材若是实色背景或实际脚锚错误，运行时不能凭空修复，必须资产验收。没有在此提交任何生成、修改旧3D角色、main、VFX或UI。

定向测试`tests/sprite-character.test.mjs` 18/18通过：8方向相机映射、父旋转下脚锚/朝向、无mirror UV、真帧、移动cue策略、暂停、加载竞态/回收、错误清单和诚实fallback。这里只是运行时测试，不代表Meowa角色资产或MuMu视觉已验收。

## 主游戏已启用的入口

main.js现在在开局读`assets/player-sprites/player-runtime.json.roles`，调用`createPreferredPlayerVisual`，不再默认只创建Tripo视觉。该角色有approved且实际idle条目时优先创建sprite；缺角色或纹理加载失败才用旧3D，同一外层世界根保留位置和控制。URL按sprite JSON所在目录解析，不按index页面猜相对路径。

世界aim与camera每帧传入运行时，普攻/技能事件另传启动方向；旧立绘/UI保留。角色清单在页面载入时读取，因此新增角色资产后的新包冷启或网页刷新可使用新条目，不宣称现有页面会监测磁盘文件自动热更新。

没有专用skillN/cast时，factory明确把已有真实attack帧作为通用cast；运行时仍标`generic_cast`，诊断额外给`spriteDerivedFallbacks:['cast_uses_attack_frames']`，不称九套独立技能动画。实际charge静态姿势直接来自清单，不替换成idle。

截至接入时只有剑士se方向run/attack真帧，idle与charge为真实静态key pose。圣骑士/弓箭手资产仍由对应任务制作，清单缺失期间使用旧3D回退；不是宣称三角色已全替换。必要集成3项+sprite运行时15项=18/18、main语法通过，未扩大旧GLB分析/未构建安装。


## 单方向过渡朝向修复

实际查看用户MuMu截图及全部六组首帧后，确认圣骑士源run/attack朝左，原se标签不符；世界→相机左右公式本身正确。现圣真实方向键改为sw，sourceFacing:left；剑士/弓手源画面偏右，sourceFacing:right。三角色显式allowTemporaryMirror:true，按请求的屏幕左右与实际源朝向决定是否在当前atlas格内交换U坐标，而不是所有角色盲反。

镜像时anchorX也反为1-anchorX，脚底仍固定根坐标。状态包含authoredDirection、sourceFacing、mirrored/temporaryMirror:true和reason:temporary_direction_mirror。源握持也会被翻转，属于当前单方向素材的临时妥协，不是新增真方向；待真实方向帧齐备后应关闭该标志。真正八方向run/attack仍由资产任务推进。新方向3项+原15项+factory3项共21/21通过，未重生成/更改源图、未改主控镜头或构建安装。


## 原像素清晰度与方向纹理缓存

现役6张atlas已从640源动画重导出为每格640×800、整页2560×1600：源640×640逐帧原像素贴在(0,140)，没有缩放、锐化或AI补细节；原先384×480格流程是0.6缩图后在Y84留白，首帧可见宽剑422→253、圣433→260、弓419→251px。新页height3.375/anchor(.5,.8)不变，所以世界大小和脚底位置不变。6张合计5374984B，每角色2页未压缩RGBA显存约32.768MB；全部6页同时显存约98.304MB，但主游戏只载当前角色。

6首帧解码RGBA与源粘贴区域逐字节一致；输出lossless WebP，四角alpha为0。源图的固有线条/低alpha边缘原样保留，不靠去白边或强锐化制造假细节。HD保持Linear采样；Nearest会明显出现锯齿。outputs/art/player-sprites/clarity-sampling-comparison.png是明确标注的CPU采样示意，不是GPU或MuMu截图，展示旧0.6导出+DPR1.25二次放大相较原像素+DPR2的差异。主控另处理标准档DPR2，不能把单独atlas像素检查当作实机清晰度验收。

为后续真实8方向避免一次全载几十页，运行时默认maxTextures=4，只预载当前视向idle/run/attack/charge等的少量页；其它方向按需，最多2张并发，LRU淘汰旧页（保当前帧和idle兜底）。新方向加载期间显示已载的真实最近方向并标direction_texture_loading，失败标direction_texture_failed；不会假称请求方向已经就绪。换代/释放后的迟到纹理照常回收。初始isReady表示初始显示页就绪，availableDirections为清单实际提供的方向，不表示所有页已驻显存。

现定向20项sprite+3项factory共23/23、语法通过。没有新付费，没有动八向候选，导出脚本work/player-sprites-native-atlas.py和native-atlas-report.json保留来源与像素证据。

## 真实跑步方向已接入正式清单

正式assets/player-sprites现有22个独立run方向：剑士8、弓箭手8、圣骑士6。圣骑士n/s候选未获认可，本批不加入，不阻塞其它方向。每个已加入run都有同方向idle，idle使用该run第一张真实静帧；停步保持视向，不回默认前斜角。

22run页URL已逐项可读并核对尺寸2560×1600、cell640×800、height3.375/anchor(.5,.8)。旧attack/charge不变：仍原单方向动作/静态蓄势，不宣称8向攻击。圣旧SW历史文件名paladin-run-se.webp保留，新实际SE为paladin-run-se-authored.webp，两个URL和hash不同，不能互相覆盖。各左右方向sourceFacing按真实候选填写，精确已画视向不镜像；缺向或纹理加载中的旧方向兜底仍如实标记临时回退。

合并证据outputs/art/player-sprites/directional-runtime-merge-report.json。定向运行时/主游戏factory共25/25，包含从实际清单遍历22个方向、停步idle不转向、URL存在、无mirror、缓存不超过4页。本模块没有新生成请求，没有修改75技能图标、其它资产、主场景或打包安装。

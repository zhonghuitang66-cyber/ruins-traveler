# 联机优化依据与实际选择

核验日期：2026-10-31，北京时间。

先尝试本机DeepSeek公开检索技能，两次返回PermissionError，后续审批等待被中断，未取得研究结果。没有把工程、存档或凭据发给研究模型。本机没有通用服务器部署技能；未安装未知服务器脚本。随后主控直接查阅以下原始资料。

## 可核实的资料

- [Riot：Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode)：讨论本地移动预测、权威纠正及网络延迟影响。它针对竞技FPS；本项目借鉴预测与平滑原则，没有照搬128tick或宣称同级反作弊。
- [MDN：WebSocket bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount)：该值反映尚未发出的排队字节，因此本项目以它限制发送积压，优先保留最新状态。
- [Android网络安全配置](https://developer.android.com/privacy-and-security/security-config)：可以为固定服务声明额外CA，而不关闭TLS校验或允许混合内容。本项目仅对游戏IP加入专用公开根证书，私钥不进入APK或仓库。
- [Let's Encrypt公网IP证书公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)与[挑战类型](https://letsencrypt.org/docs/challenge-types/)：公网IP可签短期证书，验证依赖规定入口。本机云平台实际在80返回域名白名单提示，并重置443带SNI验证，故未取得公开信任证书。已停止该方案，当前不运行443挑战服务。
- [Nginx ALPN预读文档](https://nginx.org/en/docs/stream/ngx_stream_ssl_preread_module.html)曾用于验证独立挑战分流。最终部署改为9443直接TLS，不依赖该分流。

Valve Source Multiplayer Networking页面此次返回403，未将其作为已读取证据。

## 已实现的低负担方案

服务器仅作二人匹配、消息转发、账号SQLite和财富榜缓存，不计算怪物AI、碰撞或战斗。一台玩家设备运行完整权威对局，另一台预测自身移动；这允许少量服务器CPU支撑更多房间，但不是反作弊架构。

| 内容 | 实际行为 |
|---|---|
| 匹配 | 一条WebSocket长连接，真人到达立即推送；30秒无真人推送人机回退 |
| 输入 | 变化时排队，SDK最多10Hz；持续移动、攻击或撤离每0.5秒续传；静止不重复发 |
| 状态 | 权威8Hz差量，位置厘米量化；每秒完整关键帧修复被合并的变化 |
| 物资 | 原子RPC、幂等编号、处理回执、库存版本及物品身份检查 |
| 世界变化 | 最多5Hz可靠合并；静态地图仅初始化时分片发送 |
| 显示 | 远端125ms插值；外推最多100ms和0.35米；奔跑姿态保持0.2秒 |
| 背压 | 限制排队字节、消息大小和速率，合并过期状态；可靠命令明确超时，不静默丢弃结算 |
| 心跳 | 服务端15秒ping，断线清房；剩余玩家保留当前对局转人机 |
| 财富榜 | 客户端本地算营地物品、装备与收藏，服务端信任财富值；缓存10分钟，前100名 |

没有为联机增加贴图或模型网络请求：APK内置运行资源，怪物GLB预加载与实际实例共用缓存。网页资源由独立站点提供。

## 验证范围

428项主工程测试通过，另有Node20项、Python10项及真实Python HTTP/WebSocket4项。公网使用与APK相同的公开CA、保持TLS验证开启：双人匹配、完整世界初始化、双方移动、共享拾取、双方PVP和服务端30秒回退全部通过；六个GLB与本地SHA256相同。

单次公网场景的WebSocket JSON共发送76,457字节、接收77,227字节，包含初始化和多项操作；这不是持续带宽上限或承载量承诺，也不包含TLS/TCP开销和模型下载。它不能替代两台手机、弱网、GPU、触控和音效验收。

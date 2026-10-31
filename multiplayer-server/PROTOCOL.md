# Ruins Traveler multiplayer protocol 1

独立账号/财富榜/二人房间转发服务。Python3.6+标准库版`server.py`与Node24.x版`server.mjs`实现相同HTTP JSON + WebSocket协议与SQLite账户字段；CentOS7无Node时用Python入口，不需要安装系统依赖。生产接入使用同一固定HTTPS origin；WebSocket使用该origin的`wss://.../ws`。此模块不运行游戏模拟、不验证财富来源、不部署网站。

## 账号与财富

所有成功响应含`ok:true`。失败使用对应HTTP状态与`{ok:false,error:"CODE",code:"CODE"}`。JSON响应设置`application/json`、`nosniff`与禁用脚本的CSP，输出额外转义HTML特殊符号。前端仍应使用textContent展示名称。

| 方法/路径 | 输入 | 成功输出 |
|---|---|---|
| GET `/health` | 无 | `{ok:true,service:"ruins-traveler-multiplayer",protocol:1}` |
| POST `/api/register` | `{deviceId,username}` | HTTP201 `{ok:true,token,profile}` |
| POST `/api/login` | Bearer token，body `{}` | `{ok:true,profile}` |
| POST `/api/wealth` | Bearer token，body `{wealth}` | `{ok:true,profile}` |
| GET `/api/leaderboard` | 无 | `{ok:true,rows,updatedAt,cachedUntil}` |

POST要求`Content-Type: application/json`，body最多4096 UTF-8字节。端点不接受查询参数。Bearer格式为`Authorization: Bearer <token>`。

`deviceId`为客户端持久生成的16–128位ASCII字母、数字、下划线或连字符；建议24随机字节hex。每个deviceId只注册一次。`username`先NFKC规范化，再允许Unicode字母/数字/下划线/连字符，长度2–16个字符；规范化后不区分大小写判重。一设备重复返回409 `DEVICE_ALREADY_REGISTERED`，重名返回409 `USERNAME_TAKEN`，不会静默注册新设备或换名字。

注册返回服务器加密安全随机32字节base64url token（43字符）。客户端需持久保存token；SQLite仅保存token的SHA256、设备码SHA256，不保存明文token。登录与财富更新只接受token。设备码/用户名/公开用户id都不是密码，没有凭设备码查询用户或找回token的接口；丢失token不会自动重新注册或冒认原账号。

`profile`为`{id,username,wealth,createdAt,updatedAt}`，时间为Unix毫秒。公开榜单行是`{id,username,wealth,rank}`，不会返回设备码、设备hash、token或token hash。

财富来源按当前产品规则信任客户端。`wealth`必须是0..9007199254740991的有限安全整数，或对应不带空白/符号/小数/指数/多余前导零的十进制字符串；`"0"`有效。零会实际覆盖数据库旧值；越界、负数、NaN、Infinity、小数等返回400 `INVALID_WEALTH`。SQLite所有用户输入均参数绑定。

财富写入立即持久化；榜单快照按请求时刻缓存600000ms，不因每次上传反复重算。过期后的下一次GET重新查询前100；按财富降序、注册时间升序、id升序稳定排序。`updatedAt/cachedUntil`明确该快照时间，最长10分钟延迟属于缓存规则。

## WebSocket匹配与权威

连接`/ws`后5秒内发送：

```json
{"type":"join","token":"保存的token","role":"swordsman"}
```

职业只允许`swordsman/paladin/archer`。不将token放URL或查询参数。同一账号只允许一个在线匹配连接，不能自己匹配自己。成功认证后服务器返回`{type:"waiting",deadline}`；排队满30秒仍无另一个真人，返回一次`{type:"bot-fallback",reason:"NO_HUMAN_WITHIN_30_SECONDS"}`，客户端关闭该WS并开始本地人机局。

两真人立即成房，最多2人：

```json
{
  "type":"matched",
  "roomId":"UUID",
  "players":[{"id":"用户UUID","username":"玩家甲","role":"swordsman"},{"id":"另一UUID","username":"玩家乙","role":"archer"}],
  "authorityId":"先入队的用户UUID",
  "seed":12345,
  "startAt":1793430000000
}
```

先入队客户端负责双方角色、怪物和游戏逻辑；另一客户端预测输入并按权威快照纠正。本服务器只转发，不为两客户端分别重建一局。`seed`为共同种子，`startAt`为当前服务器时间+1000ms。建立房间后第三名玩家留在独立队列。

房间成员断连/leave，剩余人收到：

```json
{"type":"peer-left","roomId":"UUID","playerId":"离开的用户UUID","authorityId":"剩余用户UUID","takeover":true}
```

剩余客户端从已有最新权威快照接管，把离开者转换为人机。服务器不保存游戏快照，也不伪造接管游戏结果；不能从服务器恢复未发出的状态。空房立即回收。房间最长20分钟，过期明确关闭连接，避免无限占用。

## 状态通道：允许覆盖

```json
{"type":"delta","seq":1,"delta":{"kind":"snapshot","x":3,"z":4}}
```

服务器转发`{type:"delta",from:"真实发送者id",seq,delta}`；目标房间由认证socket绑定，客户端提供的roomId不能向其他房间发包。`seq`为该连接单调增加的非负安全整数，重复/过期状态丢弃。每发送者最多向对方输出10Hz，积压时只保留最新整个delta；不是逐字段合并。因此权威应发送可独立使用的完整快照，或在客户端合并完状态再发送。

delta入站配额20/s、burst40；超额返回`DELTA_RATE_LIMIT`。客户端建议按10Hz发送，包体建议小于60000 UTF-8字节，为信封字段留空间。

## 控制通道：保持顺序，显式确认

```json
{"type":"command","id":"settlement:唯一事务ID","seq":1,"command":{"kind":"interaction","data":{}}}
```

转发`{type:"command",from,id,seq,command}`。控制消息用于加入配置、操作、交互及结算事务，不混入允许覆盖的状态通道。`id`允许ASCII字母/数字/`_-.:`，1–128字符；`seq`为非负安全整数。command配额独立20/s、burst40；ACK另有40/s、burst80，不与command争同一桶。

服务器成功放入可靠TCP转发队列后回复`{type:"command-accepted",id,seq}`。它表示接受转发，不表示对端已处理或游戏结算成功。

接收客户端完成幂等处理后发送：

```json
{"type":"command-ack","id":"settlement:唯一事务ID","seq":1}
```

服务器将`{type:"command-ack",from,id,seq}`转给原发送者。客户端可以2秒未收到ACK时重发原id/seq/同一payload。相同消息会重新relay；若服务已收到对端ACK则缓存并直接回ACK，避免ACK丢失永久卡住。相同id但不同seq或payload明确返回`COMMAND_ID_CONFLICT`。每房间缓存最近512个命令记录，客户端应在有限重试窗口内完成；接收端须按id重复ACK，不能重复结算。

控制队列不做latest覆盖。每socket最多64个待发控制包或256KiB控制/写缓冲；超限以1013明确断开，并通知对端接管。速率超限返回包含id/seq的`COMMAND_RATE_LIMIT`；没有对端时返回`PEER_UNAVAILABLE`。这些错误不算成功ACK，不能在客户端悄悄当成功。TCP断连不能承诺对端业务已执行，事务成功应以对端ACK及本地幂等落盘为准。

## 传输边界和清理

- 每条完整UTF-8 JSON（含信封）最大65536字节，超大包1009关闭。只接受文本，支持最多64段文本碎片和其间ping/pong；拒绝未masked客户端帧、RSV扩展位、非法长度/控制帧/UTF-8。
- 线帧最多128/s；应用消息60/s、burst90；超额明确1008关闭。delta、command、ACK有各自额度。
- payload只接受有限JSON数据，深度≤20、节点≤12000，拒绝`__proto__/constructor/prototype`字段。
- 15秒WS ping；下次心跳仍无pong则关闭；错误、关闭、认证超时、排队退出都回收队列/会话/房间引用。
- 默认最多200 WS、每来源IP8个WS，总TCP连接上限300。HTTP每来源IP180请求/分钟、注册30次/分钟。仅真实TCP对端为loopback时接受严格单个X-Real-IP（Nginx必须以$remote_addr覆盖来客header）；非法值回退TCP地址，非loopback完全忽略代理header。不读取X-Forwarded-For，避免公网来客伪造来源绕限额。
- WS错误为`{type:"error",code,reason:code,...可选id/seq}`；leave发送`{type:"leave"}`，响应`{type:"left"}`，连接仍可重新认证排队；客户端通常直接关闭离局连接。

正式TLS、域名、反向代理与新站点部署由主控处理；此服务只提供本机HTTP/WS入口，没有接触远程凭据或899旧站点。

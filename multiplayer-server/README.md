# 独立双人联机后端

提供同协议的两套独立入口，均不需要第三方依赖、不运行游戏模拟。实际CentOS7/glibc2.17旧服务器使用 **Python3.6+标准库版 `server.py`**；有Node24.x的开发环境也可用 `server.mjs`（原生HTTP/WebSocket与node:sqlite）。通信字段见[PROTOCOL.md](./PROTOCOL.md)。

Python生产兼容入口及标准库单测：

```sh
python3 -m py_compile server.py
python3 server.py
python3 -m unittest discover -s tests -p test_python.py -v
```

Python版使用一个asyncio事件循环与同线程SQLite连接，不依赖ThreadingHTTPServer、asyncio.run、pip、Docker或glibc升级。SQLite表不用新版本STRICT语法，保留同列、唯一约束、CHECK和参数绑定。新建数据库由两版本读取兼容；若已有Node创建的STRICT数据库，不应直接交给CentOS自带旧SQLite解析，需离线迁移，当前旧服务器此前未运行此Node服务。

Node开发入口：

```sh
node server.mjs
node --test --test-isolation=none tests/*.test.mjs
```

两个入口默认均仅监听`127.0.0.1:8787`，SQLite为本目录`data/accounts.sqlite`，环境变量一致。Python测试允许PORT=0自动选择空闲端口并在启动JSON输出真实端口，生产请明确8787。可用环境变量：

| 变量 | 用途 |
|---|---|
| `HOST` | 监听地址，默认127.0.0.1 |
| `PORT` | 独立端口，默认8787 |
| `DB_PATH` | SQLite文件绝对路径 |
| `ALLOWED_ORIGINS` | 额外允许的精确origin，逗号分隔，无通配符 |

同源请求默认允许；跨源浏览器/Android origin需明确列入ALLOWED_ORIGINS，`null`也只有显式列入才允许。无Origin的原生客户端允许，但账号仍必须使用随机Bearer token。进程只输出启动状态与端口，不记录凭据、token或设备码。

本机Nginx代理须设置`proxy_set_header X-Real-IP $remote_addr;`覆盖客户端原header。后端仅当真实TCP对端为loopback（127/8、::1及其IPv4-mapped形式）时，采纳严格有效的单个X-Real-IP供HTTP限流和WS每IP连接配额使用；非loopback对端一律忽略该header。拒绝多值、空白、端口、zone、模糊IPv4前导零，非法值回退真实socket地址；不读取X-Forwarded-For。直接native连接不带header仍正常。

未来部署可以将代码单独放在`/www/wwwroot/vibehack/multiplayer-server`，数据库放公开站点目录外，例如`/www/server/vibehack-data/accounts.sqlite`。新站点仅代理其`/api/`、`/ws`和`/health`到127.0.0.1:8787；WS代理需保留Upgrade/Connection且空闲读超时大于心跳间隔。不要将后端源码、数据库、WAL或测试临时文件作为静态文件公开。保留899旧站点配置。本次未执行这些部署步骤。

关闭进程时回收WS/匹配房间并关闭SQLite。重启会清空未结束的房间；账号、token hash和财富持久保存。SQLite运行文件与测试临时文件均已gitignore。

Node版20项定向测试通过。Python版10项标准库单测通过，覆盖SQLite重开/token持久、设备/用户名唯一、财富0与安全数、10分钟top100、30秒匹配、人机回退、接管、command重发/ACK、64KiB线协议/UTF8碎片/掩码/队列界限，以及loopback代理信任与公网伪造拒绝。另将真实HTTP+WebSocket测试启动器切为Python子进程，四个端到端协议用例均通过（注册/login/财富0/CORS/输入错误/二人匹配/relay/command+ACK/断连接管、代理用户HTTP限流与WS连接配额独立）。本机3.6语法解析已通过；本地运行解释器较新，真实CentOS3.6运行复核交主控执行，未假称已在生产验收。

开发环境需要复跑Python端的原HTTP/WS协议用例时，可设置BACKEND_RUNTIME=python、PYTHON_EXE=python3，再执行`node --test --test-isolation=none tests/service.test.mjs`。服务器本身不需要Node。未作远程部署或互联网压力测试。

运行时依据：[Node SQLite官方文档](https://nodejs.org/api/sqlite.html)、[Node HTTP](https://nodejs.org/api/http.html)、[RFC6455](https://www.rfc-editor.org/info/rfc6455/)。本机实际Node v24.22.1的DatabaseSync/参数化prepare/run/get/all已执行验证；最新版通用文档可能展示更高版本API，因此源码明确使用已实测24.x接口。

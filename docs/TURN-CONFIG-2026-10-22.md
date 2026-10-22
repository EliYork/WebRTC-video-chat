# 可选 TURN 短期凭据（2026-10-22，本地候选）

## 本轮改动

- 新增 `TURN_URLS`、`TURN_SHARED_SECRET`、`TURN_TTL_SECONDS`，默认不启用。地址与密钥必须成对配置；URL、协议、端口、数量和有效期均在监听前验证。错误输出不回显地址或密钥，未修改真实 `.env`。
- 按 coturn REST 模式签发到期时间加随机标识的用户名及 HMAC-SHA1/Base64 密码。共享密钥只用于服务器签名；HTML bootstrap 只包含原有 STUN 和启用布尔值，不包含 TURN 地址、临时密码或长期密钥。
- `rtc:ice` 只向请求的 Socket.IO 连接应答，要求连接使用有效固定频道，禁止客户端提供配置 payload。凭据按 socket 缓存，剩余半期内重新签发；每 socket 每分钟最多 6 次请求，每个进程每分钟最多 120 次新签发。断开时清除对应状态，不广播、不写入聊天存储或诊断。
- 浏览器在创建 Peer 之前取得当前配置；并发等待共用同一签发请求，同一语音 epoch 合并 Peer 创建。约剩余四分之一有效期时刷新；刷新失败保留仍有效配置、30 秒重试，已过期时阻止新加入。有效期以浏览器单调时钟计时并扣除请求耗时，避免本机与服务器时钟偏差导致直接误判。
- 刷新更新真实 PeerJS `options.config`，用于后续新建的 RTCPeerConnection；现有 Peer 和媒体连接不因刷新而重建。Socket.IO 重连重新取得凭据；等待凭据期间断线导致 epoch 变化时，新加入流程继续，旧请求不能接管。
- 离开语音会取消刷新并拒绝迟到结果。未启用 TURN 时不新增签发请求，继续使用原 STUN 配置。

## 验证

- 全量 `npm test`：**527/527 通过，0 失败、0 跳过**，比上一轮 513 项新增 14 项。
- 专项覆盖配置验证、签名公式、身份随机性、缓存更新、全局/单 socket 限流、断开清理、错误 payload、并发去重、刷新恢复、过期拒绝、离开取消和异步 Peer 创建归属。
- 真实隔离 Node + Socket.IO/WebSocket：页面无密钥与 TURN 地址；两个匿名连接取得不同签名凭据；无效频道与恶意 payload 被拒绝；限流只影响对应请求；凭据不广播到其他连接；错误配置非零退出且没有 HTTP 监听。
- `desktop/windows/test-turn-config.cjs`：独立 profile、隐藏、静音、禁止媒体权限的完整页面。真实 PeerJS 使用临时凭据创建浏览器 RTCPeerConnection，并读回配置。使用空 MediaStream，在应用 SDP 前立即关闭该测试连接，未采集媒体或发起公网 ICE 探测。
- 同一隐藏页面验证：自动刷新定时器已注册；Socket.IO 重连更新用户名并保留原 Peer；刷新失败仍保持加入状态；取消加入后迟到结果不创建 Peer；等待凭据期间断线重连后仍成功加入。结果：`integrations/piik/artifacts/turn-config/result.json`，其中明确标记 `relayVerified: false`。
- 首次隐藏页面测试因脚本返回不可序列化的 Socket 对象失败，修正测试返回值后重跑通过；不是产品代码异常。Node 测试最初受沙箱 `spawn EPERM` 限制，以获准的测试子进程权限重跑。

## 同日补充：每次媒体连接前校验凭据

此前只在创建 Peer 时等待配置，后台挂起或刷新长期失败后，后续 `peer.call()` 与 `call.answer()` 仍可能使用过期配置。本次在两个入口加入准备阶段；已有有效配置保持同步调用，过期配置共用刷新请求。等待期间的较新 generation、停止媒体、断线、离开及远端关闭均会取消旧操作，迟到结果不能重建连接或应答已关闭来电。准备失败保留已有发送及反向接收连接；签发恢复后自动重试待发送媒体，普通凭据刷新不重建媒体。

- 先增加发送和应答行为测试，确认原实现均未等待配置而失败，再修复入口。本次新增 8 项 Node 测试，覆盖同步配置克隆、过期拒绝、异步等待、代际替换、取消、故障保留与错误内容不外泄。
- 全量 `npm test`：**535/535 通过，0 失败、0 取消、0 跳过**；上面的 527 项为此前一轮结果。定向 ESLint 与 `git diff --check` 通过。
- 首次全量回归有 534 项通过，部署门禁测试在原 45 秒总时限处取消；单独重跑通过。该测试串行执行 8 次真实 Bash/curl/Node 检查，curl 每次最多等待 8 秒；本次增加每次 20 秒的子进程上限、相应总时限、逐项耗时诊断和退出清理，任何超时终止均使测试失败。HTTP/JSON 门禁条件未放宽，随后完整回归通过。
- `desktop/windows/test-turn-expiry.cjs`：独立 profile、隐藏静音页面，禁止真实媒体权限；本机 64×64 合成画布通过真实 PeerJS/RTCPeerConnection 解码视频帧。人为推进单调时钟并拒绝签发时，新接收和新发送均不创建使用旧凭据的 RTC；恢复签发后待发送媒体自动恢复，同一 Peer 与反向接收 RTC 保持连接。测试移除公网 STUN，假 TURN 只指向本机无服务端口；不构成中继验证。
- 上述结果位于 `integrations/piik/artifacts/turn-expiry/result.json`，`relayVerified: false`。既有 `desktop/windows/test-turn-config.cjs` 也已重跑通过。

## 发布与剩余验证

没有安装或启用 coturn，没有提供生产中继地址、密钥、证书或防火墙配置；没有打包、提交、推送、部署或升级版本。所有变更保留在原脏工作区；新增运行资源均位于现有发布白名单 `src/` 下，没有新增依赖。测试私有数据仅位于临时目录，输出不包含测试签名凭据。

当前匿名频道校验不是账号身份认证，临时凭据在到期前仍可被持有者使用。签发限流也不限制实际中继带宽，coturn 需另行配置容量与目标网段约束。本轮验证只证明签发及浏览器接入流程，不证明 TURN 分配、公网中继、长通话、手机或真实声音/画质通过。

使用真实服务后还需验收 relay 候选、持续数据、超过 TTL 的通话、新观看者及断线恢复；详情与部署配置见 [发布说明](RELEASE.md#可选-turn-中继)。Piik 自身的中继协议不由本模块配置。

协议参考：[coturn REST 模式](https://github.com/coturn/coturn/blob/master/README.turnserver)、[PeerJS config](https://peerjs.com/client/api/peer)、[WebRTC TURN](https://webrtc.org/getting-started/turn-server)。

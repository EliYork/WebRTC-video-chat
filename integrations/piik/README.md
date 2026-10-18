# Piik 融合开发版

本轮代码在 `codex/piik-integration` 分支。开发入口是现有语音平台；没有挂载 Piik 网站、React 页面、房间聊天或 iframe。生产配置、原 checkout 的 `native/` AV1 实验均未修改；未提交、Push、部署或生成发布 ZIP。

## 架构决定

选择 **A：Node 平台 + 受控 Piik Go 媒体子系统**。

| 评估项 | A：保留 Node 平台 | B：迁移到 Piik 底座 |
| --- | --- | --- |
| 固定频道、多人双向语音、成员与聊天 | 保留现有实现 | Piik 单 Host 房间不具备这些平台模型，需要迁移或重写 |
| 原舞台、Dock、独立音量 | 通过现有媒体源接口接入 | 需要重新移植交互和媒体生命周期 |
| 上游更新 | 固定源码版本，编译无 UI 适配器；Go 不打补丁 | 平台功能侵入 Piik 页面/房间模型，合并上游更困难 |
| 代价 | 维护 Node 到 Go 的身份授权桥和客户端适配器 | 同样要维护授权，另外承担多人语音和界面迁移 |

Piik 的一个房间只有一个 Host。本实现把**每次屏幕共享映射为一个独立媒体子房间**：一个语音频道可以有多个共享者，每个共享者有自己的 Piik Host 和观看者集合。这不要求把 Piik 改成多人 Host，也不重新实现频道系统。

```text
现有页面：频道 / 成员 / 聊天 / 双向语音 / Dock / 视频舞台
    │ Socket.IO（沿用实际 voice owner）
    ▼
Node PiikMediaGateway：授权、共享目录、会话生命周期
    │ loopback HTTP + WebSocket（房间凭据仅服务端保存）
    ▼
Piik Go：媒体图、路由 prepare/active、连接恢复决策
    │ 信令经 Node 转交现有页面
    ▼
上游 HostProvisionalChild / HostPeer ← 真正 WebRTC P2P → ViewerPeer
    └── 视频/共享音频送入现有媒体源与舞台
```

Node 只决定“谁有权参与哪个共享”；Piik 决定“媒体连接如何建立与切换”。适配器响应 Piik 的路由指令，没有另建选路算法。原 PeerJS 继续承担语音和摄像头；Piik 模式从这些连接中排除屏幕视频/屏幕音频，避免重复发送。`PIIK_ENABLED` 对整个开发实例单选共享 provider，默认不启用；旧 AV1/H.264/VP8 路径保留供回归与回滚。手动验收完成后再替换默认路径并删除旧共享路由控制，不能把两套路由都作为长期默认维护。

## 实际完成的闭环

- 在原频道加入语音、点击原“共享屏幕”，通过 Piik P2P 在另一成员的原舞台播放。
- 双向语音 RTP、原文字聊天可以同时工作。
- 同频道两名成员各自共享；停止自己的共享仍能观看另一人的共享。
- 停止/重开、发布者信令重连（保留采集）、观看者刷新/重新加入、发布者离开均有自动化覆盖。
- 验证未加入语音、跨频道、盗用媒体 session、过期 voice generation 被拒绝；取消后晚到房间创建不能恢复共享。
- 验证共享者只有一个活动视频 sender，没有旧 PeerJS 屏幕视频重复发送。

### 能力范围

| 能力 | 本轮状态 |
| --- | --- |
| 原 UI + Piik 真实 WebRTC P2P | 已实现，静音 headless Edge 自动化通过 |
| 现有双向语音、聊天 | 保留，合成媒体自动化通过；真实听感由用户验收 |
| 同频道多人分别共享 | 已实现，每路一个媒体子房间 |
| P2P 弱网恢复 | 复用上游 peer；信令重连已测，实际弱网/断网恢复未验收 |
| 观看者转发 | 未接入，观看者宣告 relay capacity = 0 |
| BrowserEncodingPool / 编码复用 | 未接入，多个直连观看者仍可能各占编码资源 |
| SFU 兜底 | 此开发实例禁用；不修改原 `.env` 或线上 SFU |
| Windows App / 原生采集编码 | 只完成源码边界分析，尚未接入 |
| 原生 AV1 / NVENC / 4K60 提升 | 未验证，不能由本轮 Piik 集成推导 |
| Android / 移动公网互通 | 尚待真实设备验收 |
| 统一诊断统计 | 有适配器摘要，尚未完整映射 Piik PC 到原诊断面板 |

当前是浏览器 `getDisplayMedia` 与浏览器 H.264/VP8 编码，固定每连接最大目标码率 15 Mbps、保持分辨率。这里不是实际码率保证。每路最多 3 个直连观看者；没有编码池时主机总上行可能接近单连接码率的 3 倍。Piik 模式隐藏 AV1 选项，未改变旧 provider 的 AV1 回退链。

## 身份、权限与清理

1. 浏览器仅发送 `publish/watch/list/send/close/stop`，不能提交可信的 Piik room、Host token 或 Viewer grant。
2. Gateway 从现有 `VoiceCallSignaling.getVoiceOwner(socket)` 读取 `{roomId, peerId, voiceSessionGeneration}` 快照；沿用现有频道准入政策，没有凭空增加账号登录。
3. 发布通过 Node 创建私有 Piik 房间；观看必须是当前同频道 voice owner。内部 Go 服务仅绑定 `127.0.0.1`。
4. 媒体 session 绑定 socket、owner generation、共享实例；每条媒体命令重新检查。客户端无法发送 authenticate、abandon-room、房间聊天等管理命令。Piik 协议由上游 schema 校验。
5. 停止/离开/换代/断连撤销授权，关闭信令和页面 peer；Host 发 abandon-room。迟到创建也主动认领并 abandon。

**已知服务端清理限制：** Piik 观看者 WebSocket 断开后默认保留约 20 秒重连宽限。页面连接和 Node 授权已清理，但 Go participant/容量可能暂留，3 个观看名额满时刷新可能短暂出现 `ROOM_FULL`。当前协议没有“服务端立即撤销指定 viewer”的接口。正式集成应在 Piik 的 broker/participant 边界补这一接口，并覆盖撤权测试。空房保留超时设为 60 秒；它不是观看者即时离开的替代实现。

## 源码依赖与许可证

- 上游：[TNTcraftHIM/Piik](https://github.com/TNTcraftHIM/Piik)。固定 commit：[`9925486cec9910c0a76e47208b29b6f39942e096`](https://github.com/TNTcraftHIM/Piik/tree/9925486cec9910c0a76e47208b29b6f39942e096)，协议 `piik-v24`，见 `source.json`。
- `.deps/upstream` 是可追踪的固定源码依赖，没有无来源地拷贝媒体实现。构建不修改上游；HEAD 不符或有本地改动时失败，不 reset 用户改动。
- 上游 MIT 原文保留在 `LICENSE-Piik.txt`。浏览器运行依赖 `sdp-transform@3.0.0`、`zod@4.4.3` 均 MIT；构建生成其完整 notices，页面通过 `/vendor/piik-licenses.txt` 提供。
- Go 构建沿用上游 `go.mod/go.sum`、依赖替换与 notice 收集器。生成 `.build/third-party-go.txt`，缺少可识别许可时构建失败；分发 Go 二进制时必须附带这份 notice 和 Piik MIT。
- Go 模块含 MIT/BSD/Apache 及组件自身的其他许可文本，不能笼统视为 Piik MIT。上游有固定 LiveKit fork `f10692c6f232790ab95a063e24220531eeda6032` 及少量维护过的依赖，来源/撤销条件在其 `internal/thirdparty/README.md`。未来原生 App 的 WebRTC/libvpx 等依赖还需单独审核；本轮未分发原生组件。
- `.deps/`、`.build/`、`artifacts/` 全部忽略。原发布 ZIP 白名单未增加这些资源，本轮不是正式发布候选包。

上游更新步骤：先审阅新 commit 的协议、peer 回调、路由状态机和许可变化；更新 `source.json` 和依赖 checkout，重新构建并跑 gateway/browser 回归，再做双设备验收。Go 不打补丁，但客户端 API 是源码接口，上游更新需要适配，不能宣称零成本升级。

## 编译、运行与停止（PowerShell）

在此分支 worktree 根目录执行。需要 Git、Node >= 22、npm、Go **1.27.2**（由上游 go.mod 要求）。本机已用 Node 24.15.0 / Go 1.27.2 构建成功。只编译浏览器与 Go server，不要求 C++/Windows SDK/NVIDIA SDK。

```powershell
Set-Location 'C:\Users\EliYork\.codex\worktrees\piik-integration\WebRTC-video-chat'
# 当前 worktree 已借用原 checkout 的 node_modules；新 checkout 才需要 npm ci。
$env:PIIK_GO = 'C:\Users\EliYork\.cache\piik-integration\toolchain\go\bin\go.exe'
npm run build:piik
$env:HOST = '127.0.0.1'
$env:PORT = '3300'
$env:USE_HTTPS = 'false'
npm run dev:piik
```

打开 `http://localhost:3300/room/lobby`（localhost 是媒体采集允许的本机上下文），两个成员分别加入语音，再开始共享。**本轮不会自动打开页面、采集屏幕、打开麦克风或播放声音。** 用户手动测试时自行控制设备与音量。

`Ctrl+C` 结束 launcher 会关闭其 Node/Go 子进程。Go 只在随机 loopback 高端口提供内部信令，用内存数据库；页面不用直接访问 Go，不新增公网 Go 端口。原项目自己的 `.env` 默认值仍适用，以上环境变量优先；不要在生产目录运行。

第一次构建下载上游源码、其 npm/Go 依赖，体积明显大于原 Node 工程。Go 官方工具链下载约 79 MB，本机缓存目录在用户 `.cache/piik-integration/toolchain`；没有安装到系统或修改系统 PATH。本机已生成 Go server 约 57 MB。`npm run build:piik -- --web-only` 可仅重建适配器/协议/网页 notices，要求已有 Go 二进制才能启动媒体服务。

### 自动化（全部无音频输出）

```powershell
npm test
npm run test:piik:gateway
npm run test:piik:browser
```

浏览器测试使用独立临时 profile 的静音 headless Edge：`--mute-audio`、假麦克风与动态 canvas；不访问真实屏幕/麦克风、不操作现有浏览器，不注入系统输入。可通过 `STAGE_TEST_BROWSER` 指定 Edge/Chromium 可执行文件。运行时的 RTP 音频用于验证双向传输，输出被静音。原 `test:stage-browser` 也已补 `--mute-audio`。

本地报告在 `artifacts/browser-report.json`，包含真实解码累计帧、字节、编码 MIME 与生命周期检查；累计帧不是稳定 FPS 测量。

## 手动验收与下一阶段门槛

### 本机功能

用两个浏览器窗口加入同一原频道：确认成员、聊天、独立音量、Dock、原舞台；共享动态窗口，检查双向语音。再验证双方同时共享、停止后继续观看、刷新重入、离开、信令重连，以及另一个频道不可观看。当前 `ROOM_FULL` 宽限问题可等待 20 秒后重新加入/重建共享；需记录发生条件，不能把此问题视为已修复。

### Windows + Android

两设备先用同一 Wi-Fi/LAN。需要手机可达的开发 Node 地址和**手机信任的 HTTPS**。可复用用户已有开发 HTTPS 入口（须同时代理 Socket.IO 和 PeerJS），或手动为 worktree 的 `cert/selfsigned.key`、`cert/selfsigned.crt` 提供与开发域名匹配且已信任的证书，设 `HOST=0.0.0.0`、`USE_HTTPS=true` 后启动。不要改生产域名/证书/代理配置；此轮没有自动安装证书或修改防火墙。现有 server 缺证书会回退 HTTP，启动后必须确认确实是 HTTPS。

当前 Go dev helper **无 STUN/TURN、无 SFU**，只证明 host candidate 可达的本机/LAN路径；LAN 隔离、mDNS或防火墙也可能导致失败。手机流量与电脑跨 NAT 的验收需要后续把现有 `iceServers.js` 的 STUN 转为 Piik `IceConfig` 的受控配置；不能声称当前 launcher 已支持跨公网。上游这一版本只接受普通 STUN，已移除普通 TURN 变量；不能把原平台 TURN 参数直接透传。Go hosted config 设置 STUN 还会建立自己的 STUN listener，应使用适合子系统的配置入口，不能为测试盲目开放公网 3478。

### 性能

首轮自动化仅验证 VP8、1280×720、30 FPS 目标的动态合成画面能够实际解码，不是目标帧率验收。没有本轮 4K、真实 NVIDIA 硬编或 Android 解码性能数据。

功能验收后再用相同动态内容、原始分辨率与码率比较旧路径和 Piik 路径：1080p60、1440p60、4K30、4K60，3/6/10/15 Mbps 按档位选用。先补完整统计，分别记录 capture / encode / send / receive / decode / render FPS、实际 codec、bitrate、drop、RTT、packet loss；用连续时间窗及两端时间戳定位瓶颈。浏览器路径对比不能替代“Piik App 原生采集/编码”的第三组测试。不得仅凭 NVENC/GPU 存在或编码器输出帧率宣称播放达到 60 FPS。

## 后续实施顺序与成本

1. **先收口本轮边界：** viewer 即时撤销、满员刷新、完整 Piik PC 统计、开发 HTTPS/受控 STUN配置、真实 H.264/VP8 双设备验收。工作主要在 gateway、adapter 和 Piik participant API；不迁移语音系统。
2. **接入 App：** 审查 approved site/local capability session、`src/client/native/{client,media-bridge,native-sender-peer,wire}.ts` 与 `native/capture/windows/README.md`，让 App 授权归属本平台频道。Windows 当前是 WGC/D3D11 + Media Foundation H.264 或 libvpx VP8，不能称为原生 AV1。编译 App 会引入原生 WebRTC/C++ 工具链，应另列依赖/构建成本后推进。
3. **编码复用与观看者转发：** 复用上游 BrowserEncodingPool/relay，逐项接入并验证准备、提交、撤销、转发者离开和弱网恢复；不复制 HostPage/ViewerPage 数千行 UI 逻辑。当前适配器只抽取了 peer 边界，后续需明确可维护的上游 orchestration API。
4. **SFU 有预算后才开：** Piik 当前 admission 的 ingress/egress capacity 按流数，不能代替 Mbps 预算。多个媒体子房间必须共用全站额度，20 Mbps 公网出口需给语音/信令/开销留余量（例如媒体最多 16 Mbps，实际要实测），还需基于实际出口和预留做准入/退出。预算授权应落在 Piik admission 边界，选路仍由 Piik 唯一控制。
5. **切换默认并退役旧共享路径：** 用户验收后单独确认切换；保留旧版本回滚，完成后去掉旧共享路由控制，保留现有语音/聊天/交互。原 NVENC AV1 实验继续独立，只有确实跑通原生 AV1 WebRTC 时才合并能力声明。

结论：A 已有可运行的最小闭环，值得继续验证 App/编码池/转发的收益。当前没有性能证据支持全面迁移 B 或承诺 4K60；App 能否通过稳定适配接口接入、全站出口预算与上游 API 更新成本，是决定正式 Windows 客户端投入的下一组门槛。

# AV1 屏幕共享与 P2P 优先（本地开发交付）

后续发布更新：用户确认后默认观看入口改为已有 P2P 优先机制；原自动策略仍可手动选择。初始预留改为 3.5 Mbps，就绪后按实际源流加 5% 更新，并复用两秒采样增加带滞回的总出站保护。下文描述首次开发交付时的历史状态；最新预算与发布状态见 `SFU-BANDWIDTH-REVIEW-2026-10-18.md` 及 `DEPLOYMENT-2026-10-18-AV1.md`。

## 状态与边界

- Phase 1 已接入真实 P2P 编码选择：AV1 本地编码实测、PeerJS offer/answer SDP、实际帧验证及逐连接兼容回退。不是只增加选项。
- Phase 2 已接入 SFU：Router 注册 AV1 profile 0；Producer 显式选 AV1、单编码 L1T1；Consumer 使用双方 RTP 能力匹配、实际解码首帧验证后才抑制重复 P2P。
- Phase 3 提供每位共享者独立的「P2P 优先（实验）」观看模式。全局「自动」仍使用原有策略。
- 本次未部署、未 Push/提交/打 Tag，未修改任何实际 `.env`。原工作区修改与自由桌面历史 Tag 保留。
- 未进行浏览器、in-app browser 或实机性能测试。自动化中的 Canvas/PeerConnection/PeerJS 使用可控测试替身；mediasoup 与 mediasoup-client 的 RTP 匹配测试使用本地安装的真实 ORTC 模块。不能据此声称浏览器 AV1 硬件编码或 4K60 已通过。

## 编码决策

共享设置增加「AV1 优先（实验）」。自动仍为实测 H.264，失败选 VP8。AV1 实验优先顺序为 AV1 → H.264 → VP8。

1. 检查 `RTCRtpSender.getCapabilities('video')` 的 AV1 编码声明；本地回环也检查 `RTCRtpReceiver` 解码声明（接口缺失记未知）。
2. 使用原分辨率运动 Canvas、无 STUN 的本地 PeerConnection 回环，明确只选择待测编码及修复编码。约 700ms 热身后测两个约一秒窗口；记录采集/编码 FPS、实际编码、尺寸及降分辨率证据。
3. 单次试验最长 6.5 秒，结束、超时、失败、取消都会释放回环连接、Canvas 轨道及定时器。AV1 已耗时的失败试验不会再串行启动一次长 H.264 测试；H.264 成为兼容偏好，后续仍须经过 SDP 与真实帧验证。能力立即不支持时允许运行原 H.264 检测。
4. 编码不足、格式错误、降尺寸、超时或缺少测量证据时不宣称 AV1 性能通过。若两个窗口可确认实际 AV1、原尺寸、有编码帧，但采集不足，允许明确的实验尝试，并保留 `probe-source-slow`。采集不足不等于编码不足。
5. offer 保留 AV1、兼容 H.264、VP8 以及匹配 RTX 的 apt、fmtp、反馈和其他合法属性；音频段保持原样。answer 使用浏览器真实能力生成的共同编码，不会往 SDP 凭空添加 AV1。接收端声明不支持 AV1 时优先兼容编码。
6. 现有采样检查已连接媒体是否产生编码/解码帧。八秒仍没有首个有效帧时请求兼容重协商（实际触发时间受现有采样节奏影响）。观看端通过同房间、同会话、限频、固定原因码反馈通知共享者；发送端还须核对当前 PeerJS call 的协商代次。
7. 回退按观看者隔离，使用原媒体更新队列分配代次。换轨、共享重开及摄像头转换正确触发重新协商；退役任务不能更改新连接。停用的 P2P 视频 sender 不触发编码启动误判。

能力声明、预选、SDP、RTP 实测分别呈现。硬件加速统一记「状态未知」；不会根据显卡名称或编码能效字段断言硬件编码。

## SFU 与混合设备

本地依赖保持 mediasoup 3.29.0 / mediasoup-client 3.24.5，无依赖升级或新增转码进程。服务端内置能力表已支持 `video/AV1`，客户端沿用 RTP 能力匹配。

- AV1 Producer 创建遇到编码不支持/编码器错误时依序尝试本机与 Router 共同支持的 H.264、VP8。新 Producer 必须仍通过原消费首帧验证。
- SFU 发送端编码启动无帧时，使用现有诊断采样触发兼容 Producer 重建，保留原采集轨道。
- 手机不能消费 AV1 Producer 时，`canConsume` 拒绝；释放预留，保留其 P2P 路径。此 P2P call 独立协商 H.264/VP8，其他 AV1 SFU 观看者不受影响。界面记录 `unsupported-codec`，不将手机标成 SFU 就绪。
- 不转码、不降低采集分辨率。兼容 P2P 需要共享者额外编码与上行；这不是零成本兜底。
- 原 SFU 首帧、接收健康、前台有效采样连续三次低于 5 FPS、两分钟冷却不变。AV1 没有绕开这些规则。

## P2P 优先（实验）

在 FPS 旁「切换」中选择，每位共享者单独生效，仅保留在当前语音会话。

- 初始跳过自动 SFU 订阅，先保留现有 PeerJS 媒体。
- 从实际选中候选对判定：双方均无 relay 为直连；任一侧 relay 为 TURN；证据缺失显示路径待确认。不会把 TURN 算成免中继流量。
- 前台下，连接失败/缺失给予十秒宽限，持续未连接给予二十秒；TURN 确认后可尝试 SFU；三个有效且相隔至少 900ms 的窗口持续收包但解码帧零增长，也可尝试 SFU。重复时间戳、计数器变化、静止无数据及后台不作为播放停滞证据。
- 两个及以上 P2P 观看者时，发送端连续三个有效采样显示编码受 CPU 限制且编码 FPS 低于采集的 80%，或明确带宽受限且实测发送总码率接近本地上行预算的 90%，才发送压力提示。人数本身不触发切换。提示按现有采样观察，最多十秒一次；转发端按会话校验并限频。
- SFU 仍须通过编码兼容、全局带宽和真实首帧验证；失败就继续保留 P2P。P2P 优先下的 SFU 兜底同样保留原 5 FPS 三次回退规则。
- 不在有画面的 SFU 与未验证的 P2P 之间自动来回抢切。想重试直连时再次点「P2P 优先」。手动 P2P、手动 SFU 和原自动仍可独立使用。
- 本阶段保留原可用的低码率闲置 SFU 上传作为快速兜底，并非完全按需才创建 Producer。不能声称服务器视频流量已经归零。

## 20 Mbps 出口建议

```dotenv
SFU_EGRESS_MBPS=20
SFU_RESERVED_MBPS=4
SFU_PAYLOAD_MBPS=16
SFU_VIDEO_MBPS=15
SFU_INITIAL_VIEWER_MBPS=5.5
```

这是新本地默认与示例，实际服务器需发布者单独确认并修改。校验视频+共享音频、初始接入预估不能超过媒体预算，媒体预算+全局预留不能超过声明出口。老的 22/23 Mbps 配置若未同步出口声明会被拒绝；应用记录配置错误后禁用 SFU、保留 P2P，不擅自改 `.env`。

全频道共用媒体预留，按实际入站码率及原有 20% 需求余量重平衡。超预算的需求会被拒绝，不能先截成预算上限再假装放得下。15 Mbps 是上限，不保证可持续使用该码率或接入固定人数；20% 的需求余量可能更早触发 P2P。协议、重传、其他站点与瞬时突发仍须在服务器实测。此控制不是网卡整形或物理出口上限的替代。

## 统计、事件与隐私

继续使用现有浮层、事件日志、全局唯一「复制诊断」。请求模式、本机预选、试验窗口、SDP 编码和实际 RTP 编码分开；各阶段 FPS 及码率保持原测量定义。新字段加入原白名单，没有第二套日志库或 getStats 高频循环。

同时修复已发现的播放提交回调漏采风险：统计面板关闭导致回调停止后，强制采样可以在同一个 video 上重新启动回调。没有数据时继续显示未采样，不能当成 0。

反馈只含固定原因码、会话/协商路由所需字段，不把 SDP、候选地址、设备标识或 URL 写入诊断；事件与历史继续保留原数量/大小上限与截断标记。

## 自动化结果

- 开发前基线：384/384。
- Phase 1 编码、PeerJS、采集生命周期、诊断及设置回归：66/66；后续增加重协商与多分辨率用例，全量回归包含这些用例。
- Phase 2 / Phase 3 路由、SFU 健康与预算联合回归：55/55。
- 本地真实 mediasoup/client ORTC 验证 AV1/RTX 映射、Consumer 能力相交，以及拒绝 VP8-only 接收端；不依赖浏览器或启动生产 worker。
- 最终 `npm test`：413/413，通过；失败、取消、跳过均为 0。`npx eslint src` 与本轮涉及测试文件通过，`git diff --check` 通过。没有浏览器/实机验收结果。

## 实机验收顺序

1. 两台 Windows，固定相同运动内容，先手动 P2P：1080p60 下分别测自动、VP8、AV1 优先。确认实际编码，记录开始后约 5/15/30 秒的采集、编码、发送、接收、解码与播放提交 FPS、码率、分辨率、限制原因及准确时间。不要只看目标 60。
2. 保持设备与内容，再依次测试 1440p60、4K60；每个分辨率保留 AV1 与 VP8/H.264 同条件对照。无法达到目标时据实保留采集不足/编码不足/网络收帧不足/解码与播放不足证据。
3. 加入 Android 或其他不支持 AV1 的设备，确认其 P2P 使用兼容编码、无永久黑屏；Windows 观看者可继续 AV1。再增加至 2、3 位观看者，检查共享者 CPU、编码阶段与总上行，而非只看服务器负载。
4. 在相同分辨率下手动切到服务器转发，核对实际 SFU 编码、首帧与音频；不支持 AV1 的手机必须明确回到兼容 P2P。模拟 SFU 卡顿/断开时确认原 5 FPS 三次规则、冷却和恢复。
5. 选择 P2P 优先，测试健康直连、能使用 TURN 的网络、P2P 连接失败及 SFU 容量不足；确认路径标签与事件原因一致。再点 P2P 优先重试，验证手动模式和原自动仍可用。
6. 停止/重开、检测中取消、摄像头切换、加入/离开、连接重建；测试共享音频、麦克风与音量。浮层普通/网页全屏、1080p/2K/4K/窄窗口/手机，以及菜单键盘操作按原有验收场景检查。

## 本轮修改文件清单

以下清单只列本轮触及内容，其他已有脏文件继续保留。

| 范围 | 文件 |
|---|---|
| 编码 / PeerJS | `src/views/js/voice/voice-screen-codecs.js`、`src/views/js/voice/voice-peer-registry.js` |
| SFU / 路由 | `src/views/js/voice/voice-screen-sfu-runtime.js`、`src/utils/ScreenSfuService.js`、`src/utils/ScreenSfuBudget.js` |
| 信令 / 配置检查 | `src/utils/VoiceCallSignaling.js`、`src/utils/SocketPacketValidation.js`、`src/server.js`、`.env.example` |
| 设置 / 集成 | `src/views/js/media/media-dock-runtime.js`、`src/views/js/voice/voice-media-lifecycle.js`、`src/views/script.js`、`src/views/room/index.ejs` |
| 统计 / 事件 | `src/views/js/voice/voice-share-diagnostics.js`、`src/views/js/voice/voice-share-stats-view.js`、`src/views/js/voice/voice-media-quality-runtime.js`、`src/views/js/voice/voice-media-quality-view.js`、`src/views/js/voice/voice-call-diagnostics.js`、`src/views/js/voice/voice-player-events.js`、`src/views/js/shared/voice-diagnostic-schema.js` |
| 测试 | `tests/screen_codecs_test.mjs`、`tests/voice_peer_registry_test.mjs`、`tests/screen_sfu_runtime_test.mjs`、`tests/screen_sfu_service_test.mjs`、`tests/share_diagnostics_test.mjs`、`tests/player_diagnostics_ui_test.mjs`、`tests/voice_media_quality_test.mjs`、`tests/av1_compatibility_test.mjs`（新）、`tests/p2p_first_test.mjs`（新） |
| 文档 | `docs/RELEASE.md`、本文件（新） |

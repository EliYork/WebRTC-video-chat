# AV1 首次双端传输修正与 SFU 丢包排查（2026-10-18）

本轮仅修改本地代码并自动验证，未提交、Push、打包或部署。服务器检查只读，未更改环境变量、网络参数或服务状态。没有进行浏览器或实机验收。

## 1. AV1 被提前排除的原因及修正

用户提供的 11:08:21 UTC 双端诊断显示：Windows Edge 发送端请求 AV1，但 3840×2160、目标 60 FPS 的本机回环预检两个窗口分别为：

| 窗口 | 采集 FPS | 编码 FPS | 实际编码 | 尺寸降低 |
| --- | ---: | ---: | --- | --- |
| 1 | 59.49 | 55.52 | video/AV1 | 否 |
| 2 | 60.50 | 48.60 | video/AV1 | 否 |

原逻辑要求达到目标帧率的 95%（60 FPS 对应 57），将此次 `encoder-slow` 直接转为 H.264 偏好，因此这轮没有进行真正的双端 AV1 传输。它证明本机 AV1 编码已有输出，不证明硬件编码或真实共享吞吐。

修正仅适用于明确选择的「AV1 优先（实验）」：两个有效窗口均有正的采集和编码进度、实际编码均为 AV1、尺寸均保持目标值，允许在 `encoder-slow` 或 `probe-source-slow` 时继续协商 AV1。严格预检结果仍是 `passed:false`，保留原始原因及各窗口数值，决策另记 `manual-av1-below-target`。统计浮层和现有事件日志明确提示“未达目标 FPS，继续实验”。

无编码输出、格式错误、分辨率降低、缺失统计、超时等情况继续兼容回退。双方 SDP 协商、实际 RTP 格式与启动帧验证继续使用现有机制；未出首帧仍会请求 AV1 → H.264 → VP8 兼容重建。自动模式的 H.264 → VP8 严格选择保持原样。没有修改码率、编码参数或采样周期。

增加显式 `2160p（4K）` 选项，可直接组合 4K30；既有 1440p 与 60 FPS 选项保持可用。该选项是采集请求，实际捕获尺寸仍以轨道设置和 RTP 统计为准。

## 2. P2P 优先及小范围显示修正

- 保留当前默认 `p2p-first`，不因 AV1 改为默认 SFU。手动 P2P、手动服务器、自动模式及原有恢复流程均保留。
- 实际 ICE 仍区分直连与 TURN，不能将所有 P2P 都称为直连。
- Android UA 中 `Version/4.0` 不再优先于 Chrome/Edge/Firefox；常见 Android WebView、Samsung Internet 与 iOS 浏览器标记也按明确顺序识别。不记录原始 UA。
- 用 `remoteSdpAV1` 代替含义含混的 `remoteAV1`，只说明当前远端 SDP 是否包含 AV1。未包含不代表对端浏览器不支持解码；不把当前 SDP 当作完整能力清单。
- SFU 发布连接单独导出 `uplinkStatus: none / idle / forwarding`。无服务器观看者时，操作栏、统计连接和事件显示“SFU 备用上传”，不再由 `hasUplink` 推断当前有人通过服务器观看。备用上传的实际统计仍保留。

## 3. SFU 丢包：现有证据与尚未确定的部分

### 用户双端诊断中的实际对照

- 两条路径实际都是 H.264，尚不能把这轮 SFU 故障归因于 AV1。
- 恢复 P2P 后，观看端近期完整接收与解码约 49.7–52.4 FPS，播放提交约 47–50 FPS；约 19–21 Mbps，区间丢包/NACK/PLI 为 0。发送端当时采集约 53.18 FPS、编码/发送约 51.38 FPS。
- SFU 异常窗口中，服务器视频入站和出站累计字节仍持续增长；约每 2 秒转发 2.1–3.06 MB 主视频数据，观看端接收字节也在增长，但完整帧和解码帧可连续降为 0。
- 同期每约 2 秒丢包增长 70–155、NACK 增长 108–208、PLI 增长 1–17。这些是区间计数，不是独立丢包数、丢包百分比或重传字节数。
- 部分窗口完整接收仍有几十帧而解码接近 0，随后完整接收也降为 0：既有收帧/组装异常，也有解码恢复困难，不能只看“仍有 Mbps”就认定视频正常。
- 本次选择的是手动服务器路径；它保留异常记录但不按自动策略回退。`最近回退` 为空并不表示缺少异常记录，原始窗口在 `最近异常` 中。
- 双端时钟有偏差，服务器统计距接收样本约 0.28–0.70 秒，各阶段不是严格同步测量；发送端同期 SFU 编码历史已不在精简最近采样中，无法补证。

### 生产服务器只读检查（11:17:28 UTC / 北京时间 19:17:28）

| 指标 | 结果与边界 |
| --- | --- |
| PM2 | voice-room PID 35385 online；另一业务 friend-footprints PID 1389 online；没有重启任何进程 |
| 网卡累计 RX/TX error/drop | 均为 0 |
| SFU UDP 44444 socket | RX/TX 队列为 0，socket drops 为 0 |
| 网卡 fq_codel | dropped / overlimits / requeues 均为 0，无 backlog |
| 系统 UDP | 累计 InErrors/RcvbufErrors 为 64，SndbufErrors 为 0；3 秒观察增量均为 0 |
| 内核默认/最大收发 socket buffer | 均为 212992 字节；只读记录，没有调整 |
| 现有 PM2 日志 | 应用输出日志全文件约 168 KB；未发现 SFU 出口接入暂停、持续出口压力释放观看者、采样失败记录 |
| 观察时负载/出口 | load average 0/0/0，约 0.012 Mbps；当时已空闲，不能代表故障发生时 |

系统累计 UDP 缓冲溢出属于整台主机约 21.8 小时的累计值，不能归属到 SFU；当前端口 drops 为 0，也不能排除公网中途丢包或云厂商在虚拟机外的限速。现有日志没有证明持续出口超预算，亦不能排除短时突发、协议和 RTX 开销。主视频的 8–12 Mbps 不等于服务器全部公网流量。

当前结论是：SFU 路径存在明确的丢包及关键帧恢复异常，P2P 同场对照正常；尚无足够证据将根因锁定为服务器 CPU、20 Mbps 出口限速、socket 缓冲或观看端解码器。暂不改 sysctl、SFU 码率、路由规则或 5 FPS × 3 次有效前台样本的判定，不新增监控系统。

后续用同一运动内容、单观看者固定一种实际编码对比 P2P / SFU。若复现，保持双方仍在通话并立即通过全局入口复制诊断；故障时再读取现有主机/端口计数增量及出口指标，才有条件区分上行、服务器转发和下行链路。不要用空闲时的指标替代故障窗口证据。

## 4. 自动化验证

- `npm test`：429/429 通过（0 失败、0 跳过）。
- 修改的 JS/MJS 文件 ESLint 通过；房间 EJS 编译通过；`git diff --check` 通过。
- 包括 1440p60 / 4K30 的生产预检编排及清理（模拟浏览器 API）、双端实际编码观察器（合成 RTC 报告）、低于目标 FPS 的 AV1 实验、零输出/降尺寸/缺统计拒绝、PeerJS 兼容重建、过期任务隔离、P2P 优先与 SFU 既有健康机制回归。
- 还覆盖 4K30 设置传入采集适配器、Android 识别、SDP 含义、SFU 备用标签和事件去重。
- 这些测试不证明真实浏览器能以指定分辨率和 FPS 双端运行。

## 5. 实机验收顺序

1. 使用包含本轮代码的版本，双方刷新。先用已知支持 WebRTC AV1 的两端；保持一个观看者与持续运动画面。
2. 选择 **1440p / 60 FPS / AV1 优先（实验）**，观看端保持 **P2P 优先**。确认双方统计中的实际编码都是 `video/AV1`，RTP 尺寸为 2560×1440，并核对路径是直连还是 TURN。设置选项和本机预检不算双端 AV1 成功。
3. 分别观察采集、编码、完整接收、解码和播放提交，在 5/15/30 秒通过全局入口留诊断。未达到 60 FPS 时先定位落差在哪一阶段；硬件加速仍记未知。
4. 停止重开，改为 **2160p / 30 FPS / AV1 优先（实验）**，重复验证；稳定后才考虑 4K60。
5. 再加入不支持 AV1 的观看设备，检查 H.264/VP8 兼容协商及音频；覆盖停止重开、摄像头恢复和重新加入。
6. 最后单独比较 SFU，固定相同内容、分辨率和实际编码。复现丢包时保留异常现场并立即复制双端诊断，不把备用 SFU 上传误认作当前观看路径。

## 6. 修改文件

运行代码：

- `src/views/js/voice/voice-screen-codecs.js`
- `src/views/js/voice/voice-media-lifecycle.js`
- `src/views/js/voice/voice-screen-sfu-runtime.js`（仅诊断快照字段）
- `src/views/js/voice/voice-call-diagnostics.js`
- `src/views/js/voice/voice-share-stats-view.js`
- `src/views/js/voice/voice-player-events.js`
- `src/views/js/shared/voice-diagnostic-schema.js`
- `src/views/js/media/media-dock-runtime.js`
- `src/views/room/index.ejs`

回归测试：`tests/screen_codecs_test.mjs`、`tests/voice_peer_registry_test.mjs`、`tests/voice_call_diagnostics_test.mjs`、`tests/player_diagnostics_ui_test.mjs`、`tests/media_dock_runtime_test.mjs`、`tests/screen_share_reload_regression_test.mjs`。

本说明：`docs/AV1-FIRST-TRANSFER-2026-10-18.md`。未更改依赖、生产配置、预算算法或媒体连接实现。

# Windows + Android 实机验收

日期：2026-10-19。分支：`codex/piik-integration`。第二阶段独立回退提交：`bd1ad99`。本文只用于开发 worktree，不是生产部署说明。

## 0. 当前能验收什么

- 原语音平台频道内发起 Piik App 原生 H.264，观看者使用原舞台，无需 App。
- Windows App 复用上游 WGC/D3D11、Media Foundation 硬件 H.264 和 Pion；不是独立 NVENC SDK/AV1 原型。
- 已通过静音合成输入的真实 App/Pion 三观看者链路、权限、聊天、双向语音 RTP、停止与清理测试。**真实 WGC、NVIDIA 编码、Android、4K60 均待你验收。**
- 当前只有直接 P2P，最多三名远端观看者/每路共享。无 ViewerRelay、SFU、Piik STUN/TURN；先测同一局域网。原语音 PeerJS 的 ICE 配置与屏幕路径不同。
- 编码输出复用已接入；兼容观看者复用输出，不同需求仍可派生编码输出。一个采集进程不等于一个硬件编码器。

## 1. 一条命令启动三项服务

打开 PowerShell，**先只测 Windows 本机功能**：

```powershell
Set-Location 'C:\Users\EliYork\.codex\worktrees\piik-integration\WebRTC-video-chat'
git branch --show-current  # 应为 codex/piik-integration
npm run dev:piik:acceptance
```

看到 `Ready: http://localhost:3300/room/lobby` 后，由你手动打开此地址。不要打开原 checkout 的旧服务地址。启动器自动启动本分支 Node、独立 Piik Go、Windows App，并将这个完整 Origin 批准给本次 App；**不会打开浏览器或开始屏幕/声音采集**。App 启动会探测编码能力，可能短暂使用 GPU。

终端同时打印三个 PID 和本次日志目录。按 **`Ctrl+C` 或输入 `q` 回车** 停止三项服务。建议保留终端，不直接关窗口。

运行目录为 ignored `integrations/piik/.build/acceptance/run-*`，每次独立 App 配置、聊天记录和日志；不读取 worktree `.env`，不改你已有 App 配置。Go 只绑定随机 loopback 端口，内存数据库；原 Node SFU 被明确禁用。Node 现在按 `HOST` 实际绑定；本机入口只监听 127.0.0.1，LAN 入口监听指定 IP（域名入口则监听所有网卡）。

### 构建产物缺失时

当前电脑已具备 Node 24.15.0、Go 1.27.2、VS C++/Windows SDK 和构建产物。通常不用重编；缺文件或更新源码后才运行：

```powershell
$env:PIIK_GO = 'C:\Users\EliYork\.cache\piik-integration\toolchain\go\bin\go.exe'
npm run build:piik:app
if ($LASTEXITCODE -ne 0) { throw '构建失败，先查看错误' }
```

上游 commit 固定为 `9925486cec9910c0a76e47208b29b6f39942e096`。首次原生编译会下载约 739 MB WebRTC SDK，后续使用缓存。SDK、二进制、证书、日志均不提交 Git。MIT 和第三方 notices 见 README，分发二进制时需附带。

### 需要分别启动时（替代一键入口）

以下示例是本机 HTTP，两个终端都在上述 worktree：

```powershell
# 终端 1：Node + Go
$env:HOST='127.0.0.1'; $env:PORT='3300'; $env:USE_HTTPS='false'; $env:SFU_ENABLED='false'
npm run dev:piik
```

```powershell
# 终端 2：App。此上游标准命令可能打开网站，由你选择执行。
& '.\integrations\piik\.build\piik-app.exe' --site 'http://localhost:3300' --config "$PWD\integrations\piik\.build\app-dev.json" --debug --log-dir "$PWD\integrations\piik\.build\app-logs"
```

两终端分别 `Ctrl+C`。分开启动会使用原 dev helper 的环境/.env 规则；推荐上面的一键隔离入口。**不要同时运行两种启动方式。**

## 2. 从原频道开始原生共享

1. Windows 发送端和观看者打开同一开发 Origin 的 `/room/lobby`，分别设置不同昵称、加入语音。观看者无需开麦，但必须加入同一语音频道。
2. 发送端点原来的“共享屏幕”，在设置中选择 **Piik App 原生屏幕共享 · H.264**。
3. 等待“App 已连接”，选择一个确实持续变化的显示器/窗口。先选 **1080p / 60 fps**，不要选“自动/原始分辨率”。共享源声音默认不勾选；通话麦克风仍由原平台独立管理。
4. 点开始，观看者在原 Dock/舞台打开该共享。共享者本地预览不占远端三个观看名额，但会有解码负载。
5. 如果浏览器询问本地网络访问权限，允许**这个开发 Origin**访问本机 App；不要全局关闭浏览器安全功能。[Chromium 本地网络权限说明](https://developer.chrome.com/blog/local-network-access)。
6. 一键入口已经通过 `--site` 批准完全相同的 Origin。如果改用了其他域名/IP/端口，先停止再以新 `--origin` 重启。也可在弹窗“查找 App 授权入口 → 打开 App 授权”，核对网站再批准，然后“重新连接 / 刷新来源”。不要进入 Piik 独立房间页。

App 找不到时先核对完整 Origin、App PID、浏览器本地网络权限和 `app-logs/client.log`。不要向外分享 `/health` 的原始结果或本机 control capability。

## 3. Android 同 LAN：一次性准备可信 HTTPS

两设备连接同一路由器；不要用访客隔离 Wi-Fi、手机流量或 VPN 路由做首次验收。本次检测电脑 `WLAN 2` 的地址为 **192.168.5.13**；每次仍先核实，DHCP 地址可能变化：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object InterfaceAlias,IPAddress
```

下面示例使用 `192.168.5.13:3443`。若 IP 变化，证书 SAN 和启动命令都要换成新地址。

### 3.1 生成开发证书（你手动执行一次）

本机未发现 mkcert。可从 [mkcert 官方 Releases](https://github.com/FiloSottile/mkcert/releases) 下载 Windows amd64 可执行文件，重命名为 `mkcert.exe`，放入 worktree 的 `integrations/piik/.build/tools/`。以下操作会创建本次专用 CA，并安装到 Windows 信任库；本轮自动化没有执行这些安装操作。

```powershell
Set-Location 'C:\Users\EliYork\.codex\worktrees\piik-integration\WebRTC-video-chat'
$mkcert = "$PWD\integrations\piik\.build\tools\mkcert.exe"
$env:CAROOT = "$PWD\integrations\piik\.build\acceptance-ca"
& $mkcert -install
if ($LASTEXITCODE -ne 0) { throw 'CA 安装失败' }
New-Item -ItemType Directory -Force cert | Out-Null
if ((Test-Path cert/selfsigned.key) -or (Test-Path cert/selfsigned.crt)) { throw '证书已存在，请先保留原文件，再自行决定是否换用测试证书' }
& $mkcert -key-file cert/selfsigned.key -cert-file cert/selfsigned.crt localhost 127.0.0.1 192.168.5.13
if ($LASTEXITCODE -ne 0) { throw '证书生成失败' }
Copy-Item -LiteralPath "$env:CAROOT\rootCA.pem" -Destination "$env:CAROOT\piik-acceptance-ca.crt"
```

只把 **`piik-acceptance-ca.crt`（根 CA 公钥证书）** 通过 USB 等方式传给手机。在 Android 设置搜索“安装证书”，选择 **CA 证书**，安装这一个专用 CA；不同系统菜单可能位于“安全与隐私 → 更多安全设置 → 加密与凭据”。不要选 Wi-Fi 证书或 VPN 用户身份凭证。不要传 `rootCA-key.pem` 或服务器 `selfsigned.key`。mkcert 的根 CA/移动端用法见[官方说明](https://github.com/FiloSottile/mkcert#mobile-devices)；Android 菜单因品牌而异，[Google 凭据管理说明](https://support.google.com/pixelphone/answer/2844832?hl=en)可用于定位凭据设置。

Windows 与 Android 浏览器完全重启后，必须无证书警告地打开下一步地址。受管理的手机可能禁止安装用户 CA，此时停止 HTTPS 验收并反馈政策限制。**点“仍然访问”、`--ignore-certificate-errors` 或 HTTP LAN 都不算可信 HTTPS 通过。** 当前 Node 是 HTTPS/TCP；Chromium 对本地信任的处理见[证书验证说明](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md#how-does-the-chrome-certificate-verifier-consider-local-trust-decisions)。Edge/具体手机是否已信任仍以实际无警告访问为准。

### 3.2 启动 LAN 验收

先结束本机 HTTP 会话，然后：

```powershell
npm run dev:piik:acceptance -- --origin https://192.168.5.13:3443
```

Windows **也使用** `https://192.168.5.13:3443/room/lobby`，Android Edge/Chrome 打开同一地址。启动器在缺证书、密钥不匹配、过期或 SAN 不匹配时提前失败，不接受原 server 的缺证书 HTTP fallback；本地 readiness 校验固定证书指纹，但**不替代手机/Windows 信任验收**。

若页面打不开，先核对 IP 和 Windows 防火墙。只有确需放行时，在管理员 PowerShell 手动添加本次专用规则；不要关闭防火墙、不要开放公网或路由器端口：

```powershell
# 先用 Get-NetConnectionProfile 确认当前家庭网络确实是 Private；不要把公共网络随意改成 Private。
Set-Location 'C:\Users\EliYork\.codex\worktrees\piik-integration\WebRTC-video-chat'
New-NetFirewallRule -Name 'PiikAcceptance-Node-3443' -DisplayName 'Piik acceptance Node 3443 LAN only' -Direction Inbound -Action Allow -Profile Private -RemoteAddress LocalSubnet -Program (Get-Command node).Source -Protocol TCP -LocalPort 3443
New-NetFirewallRule -Name 'PiikAcceptance-App-UDP' -DisplayName 'Piik acceptance App UDP LAN only' -Direction Inbound -Action Allow -Profile Private -RemoteAddress LocalSubnet -Program "$PWD\integrations\piik\.build\piik-app.exe" -Protocol UDP
```

HTTPS 页可达而共享不通时，查看 ICE candidate pair、App UDP 防火墙和 Wi-Fi 隔离。网页共享模式还可能需要浏览器自己的 LAN WebRTC UDP 许可；不要把页面 TCP 可达当成媒体 UDP 已通。无需向手机暴露 Go 或 App 的 HTTP loopback 端口。当前未接 Piik STUN/TURN/SFU，不将跨 NAT 失败算成 LAN 硬编失败。

## 4. 确认真正是 NVIDIA 硬件 H.264

当前适配器自动选择上游返回的第一个具备硬件 H.264 的 GPU，**没有 NVIDIA 手选控件**。不能用 UI 上的“H.264 硬件路径”文案替代实测。

复制启动器打印的本次 `Logs:` 路径到另一个 PowerShell：

```powershell
$run = '把本次 Logs 路径粘贴在这里'
Get-Content "$run\app-logs\client.log" -Wait | Select-String 'capture-state|capture-process|encoder-stats|encoder-initialization-failed|media-sample|capture-profile|capture-output'
```

至少保留同一次共享的三类证据：

1. `event=capture-state`、`state=starting`：`codec=h264`、`hardware=true`、`adapterName` 明确是 NVIDIA GeForce RTX 5070 Ti，`encoderName` 是相应硬件 H.264 MFT。`state=active` 证实编码流启动；active 行可能不重复 adapter 名称，用同一 share 和之前 starting 行关联。
2. 观看者 inbound RTP 的 `codecId` 指向 `video/H264`，实际尺寸与目标一致。
3. Windows 任务管理器“性能 → NVIDIA GPU → Video Encode”有与开始/停止同步的负载变化，结合 `piik-capture.exe` PID；或下方 nvidia-smi 连续采样。关闭其他录制/推流软件后比较基线，避免把它们的编码负载归到本次共享。

这里走 **Media Foundation 硬件 MFT**，不是直接调用 NVENC SDK。`hardware=true + NVIDIA adapter/encoder + 实际编码/接收` 才能确认本次 NVIDIA H.264 路径；如果选到 Intel/AMD，记录日志并停止“NVIDIA 已通过”的结论，不要为了测试禁用显卡。

本机只读识别到 RTX 5070 Ti、驱动 **617.14**；这是设备信息，不是性能验收。已验证此驱动支持以下查询：

```powershell
nvidia-smi --query-gpu=timestamp,name,driver_version,utilization.gpu,utilization.encoder,utilization.decoder --format=csv -l 1
# 要保留日志可在命令末尾加： | Tee-Object -FilePath "$run\gpu.csv"
# Ctrl+C 仅停止这个采样命令。
```

`utilization.encoder` 是整张卡的编码忙碌时间比例，不是编码实例数，也不是 Piik 独占占用；`encodeUsagePercent` 同样不是 GPU 利用率。查询能力和 WDDM 下每进程数据会因驱动不同而变化，见 [NVIDIA 官方文档](https://docs.nvidia.com/deploy/nvidia-smi/)。

## 5. FPS、码率、路径与播放如何记录

### 发送端：上游已有 debug 日志

一键入口已启用 App `--debug`，原生进程随之启用编码统计；不需要改媒体核心。打开上节的日志尾随命令。

| 位置/字段 | 能说明什么 | 不能据此断言什么 |
| --- | --- | --- |
| `capture-state` width/height/fps、outputs | 应用到采集/编码管线的尺寸与 FPS 目标、输出配置 | 实际稳定帧率 |
| `encoder-stats` 的 `inputFps` | 编码器入口输入节奏 | WGC 原始捕获 API 的独立 FPS；本版未单独暴露此项 |
| 同上 `encodeFps`、`encodedBitrate`、`outputWidth/Height` | 对应 output 的编码输出 FPS、bps 和实际尺寸 | 接收/播放 FPS |
| `averageEncodeTimeMs`、`dropped*` | 编码平均耗时和各类丢帧计数 | 包含捕获、网络、解码、显示的端到端延迟 |
| `media-sample` 的 `fps`、`bitrateKbps`、`width/height` | 每个 App Pion 连接约 1–5 秒窗口的发送帧/码率/尺寸；码率包含共享音频（若启用） | 物理编码器数；每个连接都打印不代表每个都重新编码 |

编码行在 JSON 的 `line` 字段中，以 `event=encoder-stats output=...` 开头；按同一 capture ID + output 分组。字段可能在预热初期为 0，使用稳定后的连续窗口。`fps` 目标 60 不能当测量结果；累计 frame/byte 必须用时间差计算。输出组闲置或退休后不再输出连续编码统计。

### 接收端：页面摘要 + 浏览器实际 WebRTC stats

原页面右上“复制诊断”的 `共享路径变化` 中有 Piik、`route=p2p`、received codec/FPS/resolution 摘要。这里 route 是当前配置摘要，**实际路径仍以选中的 ICE pair 为准**。旧发送诊断没有完整接入 App PC，空数据不表示没有发送；不要用旧 PeerJS sender 的 0 FPS 判断原生失败。

Windows Edge 先打开 `edge://webrtc-internals`，再加入频道/开始观看。选择包含 **inbound video/H264** 的连接（不要选 Opus 语音或本机预览）。Chrome 对应 `chrome://webrtc-internals`。查看：

- `inbound-rtp`：`codecId`、`frameWidth/Height`、`framesPerSecond`、`framesReceived`、`framesDecoded`、`framesDropped`、`bytesReceived`、`packetsLost`、`jitter`、`totalDecodeTime`。
- `transport.selectedCandidatePairId`（或被选中的 candidate-pair）：state/succeeded，local/remote candidate 类型、protocol、RTT、可见的地址是否为 LAN。当前应是直接 host/host；若没有候选对成功就不是已打通的 P2P。
- 采样窗口 10 秒：接收 Mbps = `ΔbytesReceived × 8 / Δ秒 / 1e6`；decode FPS = `ΔframesDecoded / Δ秒`；receive FPS = `ΔframesReceived / Δ秒`（字段未提供就记“不提供”，不能填目标值）。decode 平均耗时 = `ΔtotalDecodeTime / ΔframesDecoded × 1000 ms`。

Android 优先用现有 Edge 做体验验收；若其内部 WebRTC 页不提供数据，另用 Android Chrome 复测并明确记录浏览器版本，不能把 Chrome 数据算作 Edge 数据。详细诊断可由你手动启用手机 USB 调试，在 Windows Chrome 的 `chrome://inspect/#devices` 检查 Android Chrome 页面。**测帧率时关闭 DevTools screencast**，它会影响性能；见 [Chrome 官方 Android 调试步骤](https://developer.chrome.com/docs/devtools/remote-debugging/)。本任务不会自动连接你的手机或控制页面。

### 播放：单独看 video 元素的提交与丢帧

在观看页面 DevTools Console（Android 可用上述远程检查）手动执行下面的只读 10 秒采样。它不改采集、媒体路由或音量。共享应保持前台、舞台可见，不开摄像头，避免多路 video 混淆：

```javascript
await (async () => {
  const videos = [...document.querySelectorAll('video')]
    .filter(v => v.srcObject && v.getVideoPlaybackQuality);
  const before = videos.map(v => ({v, q: v.getVideoPlaybackQuality(), t: performance.now()}));
  await new Promise(r => setTimeout(r, 10000));
  const rows = before.map(({v,q,t}, index) => {
    const end = v.getVideoPlaybackQuality(), seconds = (performance.now()-t)/1000;
    const total = end.totalVideoFrames-q.totalVideoFrames;
    const dropped = end.droppedVideoFrames-q.droppedVideoFrames;
    return {index, width:v.videoWidth, height:v.videoHeight, paused:v.paused,
      submittedFPS:total/seconds, droppedFPS:dropped/seconds,
      presentedEstimateFPS:(total-dropped)/seconds};
  });
  console.table(rows); return rows;
})();
```

`presentedEstimateFPS` 是播放质量计数器估算，**不是屏幕面板实拍帧率，也不是端到端延迟**。后台/遮挡、手机刷新率和温度会影响播放；60 FPS 是否肉眼平滑仍由你判断。返回空列表表示此页/浏览器未提供适用 video 计数，标记缺测。

## 6. 按顺序实测，不用静止桌面证明 60 FPS

同一动态内容（连续游戏运动、窗口滚动或固定回放）、同一源显示器、相同画质；源显示器至少 60 Hz，源画面至少达到目标尺寸。每换分辨率先停止再开始共享，核对实际尺寸，避免 1080p 源拉伸后称为原生 4K。

本版 App 请求上限 **15 Mbps**（拥塞控制和初始预算会影响实际码率），没有 3/6/10 Mbps UI。不要把目标上限填作实际码率；本阶段不增加码率控制架构。

| 顺序 | 档位 | 观看者 | 时长与记录 |
| --- | --- | --- | --- |
| 1 | 1080p60 | Windows 或 Android 1 人 | 预热 30 秒，记录 2 分钟，确认硬编/权限/播放 |
| 2 | 1440p60 | 同一观看者 | 同内容，预热 30 秒，记录 2 分钟 |
| 3 | 4K60 | 同一观看者 | 同内容，预热 30 秒，记录至少 5 分钟；不足时可额外测 4K30 定位 |
| 4 | 1080p60、1440p60、4K60 各一轮 | 1 → 2 → 3 → 1 人 | 每段预热 30 秒、记录 60 秒；4K 三人稳定段至少 3 分钟 |

三观看者最好是三台独立设备/浏览器身份。只有 Windows + Android 时，可再开两个独立桌面 profile 作为额外观看者，但主机同时多路解码会污染 GPU/CPU 结果，必须标注“同机多观看者”；仅能作为负载/功能参考。不要把共享者自己的预览算作第三名远端。

三人测试重点：

1. 三个实际 inbound H.264 都在播放，并记录每一端尺寸、decode/播放 FPS 和 bitrate。
2. `capture-process-started mode=capture-video` 对应同一源，加入观看者不应变成每人一个 WGC 采集进程。用该 PID/日志观察，别只数进程名（共享音频或另一共享者会有别的进程）。
3. 比较相同稳定窗口中活跃的 capture/output、GPU encoder%、CPU、总上行与每条 Pion 发送统计。Piik 原生保留/派生输出可能本来就多于一个；当需求一致时编码负载应以复用为主，但**不能以 GPU 利用率不变证明只有一个物理编码器**。如果每加一人持续出现新的活跃输出和负载增长，保留日志再分析，不先改架构。
4. 编码复用不消除网络副本：三人各 15 Mbps 时主机 LAN 上行可能接近 45 Mbps 加协议开销。当前没有 SFU，测试不消耗服务器媒体出口，但 LAN/无线网络仍可能瓶颈。
5. 三人满员后，一人正常离开/切频道，立即让另一身份加入；不应等待约 20 秒。意外 Go 信令中断仍有重连保护；整个浏览器/Node 信令断开可能触发平台主动清理，不要把所有断网情形都预期为同一宽限行为。

### 功能与清理顺序

测试停止/重开三次、观看者刷新后重新加入语音、观看者切频道、共享者离开、App 退出。停止应清除共享目录/舞台并释放采集；其他频道不能获得观看权限。原生信令断开后需要手动重开共享，这是当前行为。一键入口将三个服务作为一次会话，App 或任一服务退出会结束整组，测试 App 退出后需重新运行启动命令。

最后再测原双向语音、聊天、独立音量、Dock；由你使用耳机控制真实音量。共享源声音先保持关闭，之后单独开启验收，避免共享整个系统声音将语音通话一起回送。

### 结果记录（每档、每观看人数一行）

```text
日期/起止时间；分支commit；Windows/驱动/浏览器；Android型号/系统/浏览器/刷新率
源内容/尺寸/Hz；目标尺寸/FPS/15Mbps；观看人数/设备分布；共享源声音开关
adapterName/encoderName/hardware；实际编码尺寸；inputFps/encodeFps/编码Mbps/耗时/丢帧
各 Pion 连接 sendFPS/Mbps；各接收端 H264/尺寸/receiveFPS/decodeFPS/播放估算FPS/Mbps/drop
ICE pair候选类型/UDP或TCP/RTT/loss；CPU；GPU encoder%/decoder%；活跃capture/output
1→2→3→1差异；停止重开/刷新/切频道/满员离开重入结果；日志目录；主观画质/卡顿/温度
```

若“编码60、接收40”：先比较每条 Pion send FPS、接收 RTP、丢包/RTT；若接收60、解码40则看 Android 解码耗时/负载；若解码60、播放40则看 video drop、前台状态、温度/刷新率。缺数据就保留缺测项，不能将编码 FPS 当成播放 FPS。

## 7. 停止与恢复

1. 页面点“停止共享”，各端离开测试语音频道。
2. 启动器终端 `q` 回车或 `Ctrl+C`，等 `Stopped this acceptance session`。App 先通过其 stdin 取消入口释放采集/Pion，随后结束 Node/Go；超时仅强制终止本次 App 进程树，不按进程名批量杀浏览器/Node。
3. GPU 采样终端 `Ctrl+C`；关闭你自己打开的测试页面，正常日常浏览器不受影响。诊断会话/ZIP/日志留在 ignored 目录。
4. 可读检查本次 `processes.json`（`stopped=true`）及 PID 是否已不存在；再查看是否还有本次 `piik-capture.exe`。极端情况下启动器被强制结束，先按终端记录核对 PID 和 ExecutablePath/CommandLine，确认属于本次实例，再手动结束该 PID 的进程树。**不要 `taskkill /IM node.exe`、`/IM msedge.exe` 或关闭所有 App。**

```powershell
Get-Content "$run\processes.json"
Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('piik-app.exe','piik-server.exe','piik-capture.exe') } | Select-Object ProcessId,ParentProcessId,ExecutablePath
# 紧急清理示例，仅在核对记录和路径后，用确切 PID 替换：
# taskkill /PID <本次AppPID> /T /F
# Stop-Process -Id <本次NodePID>,<本次GoPID>
```

5. **仅当你添加过**上述专用防火墙规则时，在管理员终端删除它们：

```powershell
Remove-NetFirewallRule -Name 'PiikAcceptance-Node-3443','PiikAcceptance-App-UDP' -ErrorAction SilentlyContinue
```

6. 如果不再需要开发 CA，在相同 worktree 手动执行：

```powershell
$mkcert = "$PWD\integrations\piik\.build\tools\mkcert.exe"
$env:CAROOT = "$PWD\integrations\piik\.build\acceptance-ca"
& $mkcert -uninstall
Remove-Item Env:CAROOT
```

手机“受信任的凭据/用户凭据”中只删除本次专用 CA，**不要“清除全部凭据”**。若你手动开启了 USB 调试，验收后关闭/撤销本次调试授权。保留或自行归档专用 cert/CA 文件；启动器不删除证书。关闭测试 PowerShell 会话即可清除临时环境变量，不修改系统 PATH。

原 checkout `C:\WebRTC-video-chat`、其 `native/` AV1 实验和生产环境均保留；本轮没有合并 main、Push、部署或打发布包。收到你这轮实测结果后，才讨论多级 P2P、跨 NAT 与 SFU 的实施顺序。

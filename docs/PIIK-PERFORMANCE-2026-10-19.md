# Piik H.264 流畅度优化记录（2026-10-19，本地未发布）

## 结论

保留三项修改：过滤依赖逐包调试日志、修正过短的播放统计窗口、用已链接的 WebRTC 帧率控制器替换 WGC 采集阶段误丢帧的节奏筛选。真实 WGC/NVIDIA H.264 动态窗口三轮编码由47.5～49.9提升至59.1～59.8 FPS，均保持4K。**浏览器软件提交仍约51 FPS，允许GPU的独立测试约58 FPS，尚未证明游戏或 Android 稳定4K60**。未增加码率、关闭限流或删除回退输出。

用户实机记录中的网络丢包为零、RTT 约 3～4 ms；发送偶发限流和接收播放丢帧应分别处理，目前没有依据调整服务器出口或 SFU。

## 固定条件与证据

- 工作区 `master`，开始时 HEAD `4e625e5`；用户诊断网页构建 `d35c4d894db402adf335030e97ef5fefef0dd8d2`、客户端 0.1.2。本轮修改未提交，安装版及生产未更新。
- Piik 来源：`TNTcraftHIM/Piik@9925486cec9910c0a76e47208b29b6f39942e096`；Go/native 构建 overlay 加窄补丁，升级上游时上下文不匹配即报错，上游 checkout 未修改。
- 编码测试：Windows x64、i5-14600K、RTX 5070 Ti、驱动 617.14；实际激活 `NVIDIA H.264 Encoder MFT`，复用 Piik 的 AdaptiveEncoder 与 Media Foundation 编码实现。不是直接调用 NVENC SDK，不涉及 AV1。
- WebRTC SDK：`m152.7977.0.2`，源码 commit `6f37672d358475cd17544121a12494da454d85fb`。
- 所有测试静音；独立 loopback Node/Piik、独立 headless Edge profile、预编码动态视频、NV12 GPU纹理或自建静音D3D动画窗口。用户明确允许测试后增加真实WGC；仅捕获自建窗口的HWND/PID/creationTime，测试包装器拒绝其他来源及音频，来源预览也仅允许该窗口。未捕获其他桌面内容、移动鼠标、使用物理麦克风或操作当前浏览器。
- 原始 JSON、有限轮转日志、合成媒体和 exe 均在 Git 忽略目录 `integrations/piik/.build/performance/`。`comparison.md` / `comparison.json` 由脚本从实测数据生成；不提交原始日志或媒体。

## 第一轮：逐包日志开销，保留修复

用户原生日志备份在约 6.1 秒内记录 18,895 行、8,388,564 字节，其中 18,875 行为 `stream: get next higher layer`。

真实调用链是 transport 的逐包活动触发层级探测，再经 LiveKit logger 同步格式化、过滤凭据、写轮转 JSON 文件。它不表示每行都创建新路由。保持正常反馈和路由调用，只在依赖 logger 的 `Enabled` 边界默认关闭低于 Info 的逐包 trace。

保留 App 的 `media-sample`、原生 `encoder-stats`、Info/Warn/Error。`PIIK_MEDIA_TRACE=1` 可显式恢复依赖 trace；日志脱敏和轮转继续有效。App 构建也应用 overlay，避免补丁只进入 server。

19,000 次真实 logger 调用，每版三次：

| 指标 | 原版 | 补丁 |
| --- | ---: | ---: |
| 每次调用耗时 | 36.3～44.7 µs | 0.034～0.104 µs |
| 每次调用日志字节 | 249.9 B | 0 B |
| 每次调用分配 | 约113 KB、186次 | 136 B、3次 |

真实 App/nativehost/Pion/P2P 链路使用相同缓存动态 H.264 输入；CPU 表示逻辑核数，日志表示结束时最多两个轮转文件的**保留量**，不是累计写入量。

| 场景 | App CPU 原版 → 补丁 | 保留日志 原版 → 补丁 | 可见提交 FPS 原版 → 补丁 | 可见播放丢帧 原版 → 补丁 |
| --- | ---: | ---: | ---: | ---: |
| 1080p，r2 | 0.69 → 0.09 核 | 11.04 → 0.051 MB | 60.00 → 60.00 | 0 → 0 |
| 1440p，r2 | 0.70 → 0.06 核 | 14.64 → 0.055 MB | 60.00 → 59.64 | 0 → 3 |
| 4K，首组 | 1.13 → 0.15 核 | 11.17 → 0.055 MB | 59.88 → 59.88 | 0 → 1 |
| 4K，r2 | 1.05 → 0.17 核 | 11.12 → 0.055 MB | 59.36 → 59.84 | 4 → 0 |
| 4K，r3 | 1.14 → 0.11 核 | 11.10 → 0.059 MB | 59.27 → 60.00 | 6 → 0 |

每组采样约8秒；r2 4K两版各排除一个后台区间，r3记录完整可见性变化并检查停止后的采集进程退出。各段按自己的采样窗口计算，不能相减得到精确逐帧丢失位置。

4K 实际 RTP 约17 Mbps，1080p约5.4 Mbps、1440p约8.43 Mbps。此测试是固定预编码回放，不执行实时编码码率控制，**不是15 Mbps实时4K60编码验收**。可确认 CPU/日志收益；帧率差异不一致且样本短，不宣称真实播放卡顿已解决。

## 第二轮：原生限流，复现但不绕过保护

输入为8张有明显变化的预上传 NV12 纹理，1秒预热、5秒测量、每档三次。复用真实 Piik 编码和适配逻辑；未包含 WGC、实际缩放或游戏 GPU 竞争。目标分别为1080p60/6 Mbps、1440p60/10 Mbps、4K60/15 Mbps。

| 目标 | 三次编码 FPS | 每次降尺寸帧 | 每次无输出 | 编码调用均值 / p95 |
| --- | --- | --- | --- | --- |
| 1080p60 | 60.17 / 60.18 / 59.77 | 0 / 0 / 0 | 0 / 0 / 2 | 约1.25 / 1.42～1.56 ms |
| 1440p60 | 59.77 / 59.77 / 59.77 | 117 / 117 / 117 | 0 / 0 / 0 | 约1.90 / 2.00～2.11 ms |
| 4K60 | 50.74 / 50.74 / 50.73 | 116 / 116 / 116 | 44 / 44 / 44 | 约2.89 / 4.20～4.23 ms |

4K 的周期计数复现 `droppedRateLimiter=44`，编码队列、编码器和拥塞窗口丢帧均为0；另有每次3个测试调度跳过。周期编码码率曾达到约20.77 Mbps（目标15 Mbps），随后限流和质量适配发生，实际输出降到2560×1440。因此1440p和4K这些结果**均不能算目标尺寸通过**。编码调用耗时不是端到端延迟。

已沿准确版本源码核实：WebRTC `VideoStreamEncoder` 的 FrameDropper 根据编码字节 `Fill`、目标码率 `SetRates` 和输入节奏 `Leak` 决定 `kMediaOptimization` 丢帧，映射至 `droppedRateLimiter`。Piik 的 `has_trusted_rate_controller=false`；Media Foundation 已配置并校验 CBR 和低延迟，不能仅因硬件编码就谎报可信码率控制。

本轮没有关闭 dropper、伪造 trusted、扩大缓冲、提高码率或降低产品分辨率。后续需针对 MFT 瞬时输出与 WebRTC 码率/质量适配做独立同画质实验；这些数据尚不能证明 NVENC 吞吐不足。

源码：[固定版本 VideoStreamEncoder](https://webrtc.googlesource.com/src/+/6f37672d358475cd17544121a12494da454d85fb/video/video_stream_encoder.cc)，本地同版本副本保存在忽略目录。

## 第三轮：接收端统计，保留测量修复

已复现：前一完整窗口50 FPS，16 ms后复制诊断，旧实现把单帧算成62.5 FPS且消费基线，掩盖前面的掉帧。修复为至少1000 ms窗口；短读返回未采样，保留基线，下个完整窗口仍报告50 FPS和10个丢帧。

新增采样窗口、最近帧解码准备、收齐至提交、回调滞后字段，进入原有白名单和详细统计。缺少浏览器元数据时返回空值。未增加新的高频写盘路径。

这是测量修复，没有改变浏览器解码或合成。`requestVideoFrameCallback` 表示提交合成器，回调可能延迟，不能证明显示器真实扫描输出；最近一帧的耗时也不是整个窗口平均或端到端延迟。[API语义](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)

实机观看端50～56 FPS且有播放丢帧仍是有效线索；窗口状态、刷新率、接收节奏、解码和合成需在同一场景中继续区分。

## 第四轮：双输出，验证后保留上游设计

`ScreenShareOutputs` 生成原尺寸与半尺寸输出；`planGroups` 在高层活跃时有意保留低层回退输出，上游测试与媒体标准均有明确约束。不是每个观看者增加一个编码器。

相同4K纹理和15 Mbps高层目标下：单输出高层50.73～50.74 FPS，双输出高层50.72～50.73 FPS；均为44次无输出、116帧降尺寸。半尺寸层约57.95 FPS。双输出有额外 CPU 和 GPU 成本，但本场景未增加高层限流丢帧，缺少依据删除它。

整卡 `nvidia-smi utilization.encoder`：单输出4K平均约8.1～9.9%，双输出约9.7～12.0%。包含初始化和其他进程，不作进程归因，不能据此保证真实游戏中仍有同样余量。

本轮未保留任何未证实有效的媒体参数调整；也没有先删除保护再以测试数字作为优化成果。

## 第五轮：真实 WGC 采集误丢帧，保留修复

上游 `RunVideoCapture` 使用 `next_output_timestamp` 网格与仅1/20帧容差。轻微提前的WGC帧被丢弃；稍晚的帧又让网格跨到下一格，导致持续动态60FPS输入被筛成约45～50FPS。临时原始计数曾测到 `rawFps=60.01 submittedFps=45.63 cadenceSkipped=29`（约2秒窗口）。这些是进入编码器前的丢帧，与第二轮的编码码率限流不同。

只扩大到半帧容差的试验仍仅54.35采集/50.73编码FPS，未保留。最终复用已经随SDK链接的 `webrtc::FramerateController`，将WGC的100ns时间戳转换为ns。保留正值/单调时间戳校验、最小化/退出处理、编码限流、码率与质量适配。永久补丁没有逐帧日志。

同一个自建D3D动态窗口、3840×2160、60FPS、15Mbps，原版/补丁串行交替三轮；每次90编码帧预热、测量8秒，真实NVIDIA MFT输出：

| 重复 | 原版采集接受 / 编码 FPS | 补丁采集接受 / 编码 FPS | 原版 / 补丁 Mbps | 降尺寸帧 |
| --- | --- | --- | --- | --- |
| 1 | 49.00 / 47.75 | 59.85 / 59.85 | 12.77 / 13.99 | 两版0 |
| 2 | 49.12 / 47.49 | 59.26 / 59.13 | 12.43 / 13.19 | 两版0 |
| 3 | 50.81 / 49.93 | 59.22 / 59.09 | 13.89 / 13.62 | 两版0 |

这里“采集接受”来自SMED FrameBegin，不是全部WGC回调；原始回调的计数来自单独临时探针。自建窗口持续运动，初始因fixture渲染错误形成的静态无效记录已排除，不能拿低码率静态图证明性能。原版/补丁均使用真实MFT并正常发送停止控制、退出0。

再使用**同一个已过滤逐包日志的App**，只替换采集exe，通过原有频道、真实Pion/P2P传给headless Edge（默认强制软件接收）。约3秒预热、8秒测量，各时钟独立加权：

| 重复 | 解码FPS 原版→补丁 | 提交FPS 原版→补丁 | 播放丢帧 原版→补丁 |
| --- | --- | --- | --- |
| 1 | 53.15→58.17 | 48.22→51.38 | 41→56 |
| 2 | 55.18→58.77 | 49.46→50.69 | 45→66 |
| 3 | 55.39→59.90 | 49.90→51.26 | 46→71 |

均无网络丢包/解码丢帧/降尺寸区间，只有一个采集worker；停止后包装器及真实采集子进程均退出，语音保持连接。App保留上游双输出，低层回退的限流需与4K高层分别看待。

允许GPU的另一次隔离浏览器测试：接收/解码59.25FPS、提交约57.84FPS、8秒11次播放丢帧、平均解码准备0.28ms（软件约4.4ms），保持4K且丢包0。这证明接收配置影响结果；允许GPU不等于已经通过API确认具体硬件解码器，headless提交也不等于物理显示。未修改产品接收缓冲、浏览器参数或游戏设置。

最后以常规 `build:piik:app` 完整构建产物复核允许GPU的同条件对照：原版接收/解码56.14、提交54.86FPS，补丁58.86、58.06FPS；8秒播放丢帧9→5，解码耗时均约0.26ms。两版均协商 `video/H264`，实际选中host→host/UDP候选；一个采集worker、停止清理通过、保持4K、丢包0。此配对样本只有一轮，不宣称长时间稳定。

真实记录的577个相对WGC时间戳重放：原算法48.29FPS、WebRTC59.65FPS；同一SDK回归覆盖60/120/160FPS输入的60FPS上限、暂停恢复、重复及倒退时间戳保护。第二轮复杂纹理限流问题仍未解决，这个修复不构成所有内容稳定4K60的承诺。

## 验证结果与当前限制

- 根自动测试447/447通过；ESLint、差异空白检查通过；播放短窗口与新增元数据、固定版本native补丁断言通过。
- 原生候选编译成功，上游capture geometry/control/target、output worker、MFT event reader、adaptive encoder检查均通过；新增真实时间戳节奏回归通过。
- 候选 overlay 的 Go diagnostics、forwarding、mediaedge、nativehost 测试通过；显式开启trace仍可记录且凭据脱敏，Info/Warn/Error和App采样保留。
- 候选App静音原生回归通过：三观看者共用一个采集worker、无网页重编码、频道鉴权、聊天和双向语音、切源、画质更新、窗口消失、停止重开、App退出清理。
- 网页共享静音回归通过：真实Piik P2P、切源取消、参数更新、双共享者、重连刷新和语音持续。
- 隐藏Electron完整smoke **未通过**：已有剪贴板快照逻辑遇到没有可识别MIME类型的系统条目，抛出 `ClipboardItem: at least one MIME type is required`。失败在测试写入前；未清空剪贴板或夹带剪贴板修复。标题/刷新相关前置检查已执行，但整个客户端smoke不能称通过。
- 所有本轮测试采集进程已退出；用户安装版App保留运行。无自动提交、Push、部署或安装版替换；原有未跟踪 `native/` 未改。

## 日志在哪里

- 安装版App：`%APPDATA%\EliYork Voice\native\logs\client.log` 和 `.1`，每文件约8 MiB上限，仅保留当前与一个轮转备份；高频日志会很快覆盖历史。
- Electron壳：`%APPDATA%\EliYork Voice\desktop.log`，记录原生进程启动/退出等，不是完整帧率日志；它目前没有Piik日志的轮转机制。
- 网页通话日志：按来源保存在 `localStorage[voice-call-diagnostics-v1]`，最多5个会话、每会话200事件/24历史采样，总序列化长度限制1,200,000字符；存储失败时仍可在当前页内存导出。复制是精简视图，完整日志用“最近通话日志”下载。
- 视频元素的即时RTC和播放基线主要在页面内存；导出通话诊断保存的是有界派生快照，不是全部逐帧数据。DevTools控制台不等于自动落盘。

## 修改文件

| 范围 | 文件 |
| --- | --- |
| 默认日志过滤及App构建生效 | `scripts/piik-media-log-filter.go`、`scripts/piik-go-overlay.mjs`、`scripts/build-piik.mjs` |
| WGC节奏修复及回归 | `scripts/piik-native-overlay.mjs`、`tests/piik_native_overlay_test.mjs`、`scripts/fixtures/piik-capture-cadence.cpp`、`piik-wgc-timestamps.txt` |
| 播放统计与界面 | `src/views/js/voice/voice-share-diagnostics.js`、`voice-share-stats-view.js`、`src/views/js/shared/voice-diagnostic-schema.js`、`tests/share_diagnostics_test.mjs` |
| 可重复测量及汇总 | `scripts/benchmark-piik-logging.mjs`、`benchmark-piik-native.mjs`、`build-piik-performance.ps1`、`piik-performance-scenario.mjs`、`report-piik-performance.mjs`，以及 `scripts/fixtures/piik-media-log_test.go`、`piik-encoder-performance.cpp` |
| 授权的真实WGC测试 | `scripts/benchmark-piik-wgc.mjs`、`scripts/fixtures/piik-motion-window.cpp`、`piik-owned-wgc.go`（只允许自建窗口） |
| 复用原有回归 | `scripts/test-piik-browser.mjs`增加性能入口；`scripts/piik-native-scenario.mjs`允许指定候选App；`desktop/windows/main.cjs`仅在smoke模式允许指定测试App，正常启动不变 |

## 复现与实机验收

以下命令假定已有本机固定上游、原生对象和WebRTC SDK；首次构建参考 `integrations/piik/README.md`。在项目根目录，Go不在PATH时设置 `PIIK_GO`。保留当前基线App，使用overlay单独构建候选（不覆盖安装版）：

```powershell
$env:PIIK_GO='C:\Users\EliYork\.cache\piik-integration\toolchain\go\bin\go.exe'
node scripts/benchmark-piik-logging.mjs
node scripts/benchmark-piik-logging.mjs --candidate
$candidateOverlay=node --input-type=module -e "import {preparePiikGoOverlay} from './scripts/piik-go-overlay.mjs'; import {resolve} from 'node:path'; process.stdout.write(preparePiikGoOverlay(resolve('integrations/piik/.deps/upstream'),resolve('integrations/piik/.build/performance')));"
$candidateApp=Join-Path $PWD 'integrations/piik/.build/performance/piik-app.exe'
& $env:PIIK_GO -C integrations/piik/.deps/upstream build -overlay $candidateOverlay -p 4 -o $candidateApp ./cmd/piik-app
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-piik-performance.ps1
node scripts/benchmark-piik-native.mjs
node scripts/benchmark-piik-native.mjs --two-outputs
```

原生纹理测试检测到正在运行的 `piik-capture` 会直接停止，不干预现有共享。不要与游戏、其他编码或性能测试同时运行。

候选App已位于 `integrations/piik/.build/performance/piik-app.exe`。构建逻辑在 `scripts/piik-go-overlay.mjs`，常规 `npm run build:piik:app` 会将补丁编入后续本地App构建。做P2P对照时，分别设置 `PIIK_PERF_APP` 为原版与候选绝对路径、设置不同 `PIIK_PERF_TAG`，运行：

```powershell
node scripts/test-piik-browser.mjs --performance=1080p
node scripts/test-piik-browser.mjs --performance=1440p
node scripts/test-piik-browser.mjs --performance=2160p
node scripts/report-piik-performance.mjs
```

这些命令不会自动生成安装包、部署或替换安装版。需要体验补丁的本地客户端时，先完成候选构建并按既有桌面打包流程制作；直接打开现有安装版仍然使用旧原生组件。网页统计修改同样尚未上线。

真实WGC测试会显示自己的静音动画窗口，需要显式 `--allow-window`。先构建常规App和测试fixture，命令如下（不要与游戏或其他性能测试并行）：

```powershell
npm run build:piik:app
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-piik-performance.ps1 -CaptureCadence
$env:PIIK_PERF_CAPTURE=Join-Path $PWD 'integrations/piik/.build/runtime/native/piik-capture.exe'
$env:PIIK_PERF_TAG='wgc-local'
node scripts/benchmark-piik-wgc.mjs --allow-window
node scripts/test-piik-browser.mjs --performance=2160p --real-wgc --allow-window
# 独立实验：不强制禁用GPU；实际解码器未由该开关保证
node scripts/test-piik-browser.mjs --performance=2160p --real-wgc --allow-window --gpu-receiver
```

实机对照应固定同一动态内容、同一码率/分辨率/FPS，每版至少60秒、重复三次。依次测1080p60、1440p60、4K60，然后三观看者；同时记录实际输出尺寸、编码FPS和限流增量、接收/解码FPS、播放窗口与丢帧、GPU编码及游戏负载。前台保持可见并记下显示器刷新率；发送与接收尽量在10～20秒内同时导出。任何降尺寸或后台区间应单独标注。

真实WGC→NVIDIA MFT→Pion→浏览器已经在自建动态窗口上验证。真实游戏GPU竞争、Electron硬件合成、Windows高刷新路径、Android解码/播放与长时间稳定性仍由实机验收决定，不能承诺稳4K60。

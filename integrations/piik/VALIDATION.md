# 本地验证记录

日期：2026-10-18。分支：`codex/piik-integration`。Piik：`9925486cec9910c0a76e47208b29b6f39942e096`。所有结果是本地开发验证，未发布。

## 第二阶段 · 2026-10-19

### 实机验收准备

第二阶段已独立提交为 **`bd1ad99`**。随后仅补验收指南及命令行入口，不扩展媒体路由：`npm run dev:piik:acceptance` 启动隔离 Node/Go/App，用户自行打开页面/采集，`q` 或 Ctrl+C 停止本次实例。

启动器使用合成 capture fixture 验证三进程启动与退出、本机 HTTP、HTTPS 固定证书 readiness、LAN HTTP 拒绝、缺证书及 SAN 不匹配拒绝。核对三个 PID 均结束，stdout 不泄露 capability。HTTPS smoke 临时生成未安装信任的证书，测试后删除；没有安装 CA、改防火墙、系统音量或桌面。指南包含由用户执行的可信 HTTPS/Android CA 设置步骤，此部分尚未实机验收。

发现原 Node 只打印 HOST、实际监听所有地址，已改为按 HOST 绑定。真实 server 回归原先未指定 HOST 却请求 127.0.0.1，绑定 localhost 后会落在 IPv6；测试 fixture 已明确 HOST=127.0.0.1。调整后 429/429 通过，gateway、静音网页与原生三观看者链路再次通过。JS ESLint 和 diff 检查通过。没有新增媒体算法、浏览器手动验收或性能数据。

只读 nvidia-smi 确认当前 RTX 5070 Ti / 617.14 支持指南中的 encoder/decoder utilization 查询；此设备信息不能证明实际原生共享使用该硬件。当前没有用户真实屏幕的 FPS/码率结果。测试结束后关闭本任务的服务/合成采集实例；等待用户实测反馈。

实机验收准备前复跑：429/429 单元测试、真实 Go gateway、静音网页及原生三观看者回归、web-only TypeScript/bundle 构建、新增 JS ESLint 和 Go overlay 的 signal/nativehost/mediaedge/loopback 四包测试均通过。复跑日志在 ignored `.build/acceptance-*.log`。原生报告本次一条接收采样累计 95 帧 / 416864 bytes，仍不代表真实硬编或稳定 FPS。上游 tracked 工作区干净。

先复跑第一阶段的 429 个单元测试、gateway 和静音浏览器回归，全部通过后，提交独立回退基线 **`378f2b8`**。未合并 main、Push 或部署。

本阶段完成 Windows 原生采集程序（MSVC C++）和 Piik App（Go）的实际编译，包含 SDK SHA256/NOTICE 校验。没有运行真实屏幕采集，也没有实测物理硬件编码。App 启动/播放验证使用独立合成采集输入，原 App 控制授权、nativehost、Pion、Node 频道、舞台均为真实实现。

静音 `test:piik:native` 验证：

- 未批准站点不能获得 App health/capability，错误 capability 不能打开 control。
- 原频道三名观看者实际解码 H.264；采集输入为 1280×720/30 FPS 目标动态画面。
- 三名观看者只有一个合成采集进程；共享者浏览器视频 sender 为 **0**，没有预览流重编码/旧 PeerJS 重复发送。
- 原双向 Opus RTP、聊天仍工作；网页 VP8 和 App H.264 两名共享者可以同时存在，停止网页共享保留原生共享。
- 跨频道访问拒绝；三个名额满时，连续三次主动离开/立即重入恢复播放，不等待 20 秒。
- 停止/重开、关闭 App 后原平台共享状态、Pion 与采集子进程清理。

编码输出复用通过上游同一 nativehost source/output-group 路径接入。合成输入不包含物理 MFT 编码器，不能把“一个采集进程”当成“实际 GPU 只有一个编码器”的测量；不同需求可让上游派生较低输出。上游 `TestOutputGroupsShareSplitRejoinAndRetire` 等分组检查随实际 mediaedge 包通过。

Go overlay 下 `./internal/server/signal`、`./internal/app/nativehost`、`./internal/app/mediaedge`、`./internal/app/loopback` 均通过；保留意外断连重连宽限的原信令测试也通过。网页 gateway/浏览器回归与 429 个单元测试通过。详细本地日志在 `.build/phase2-*.log`，原生报告在 `artifacts/native-browser-report.json`；累计解码帧与字节不代表稳定 FPS/码率。

剩余实机门槛：WGC、所选 H.264 硬件 MFT/驱动、系统声音、Android、跨 NAT、长时间多观看者与 4K 性能。网页 BrowserEncodingPool、多级 ViewerRelay、SFU 与原生 AV1 未启用。详见 README 的启动与验收步骤。

App 自动测试使用 `PIIK_CLIENT_GATE_NO_BROWSER=true`、独立配置、无桌面/音频设备的合成输入、静音 headless Edge。没有使用用户浏览器、in-app browser 或系统输入。生产配置、证书信任、系统音量、AV1 实验均未修改；SDK/二进制在 ignored 目录。第二阶段代码留在同一开发分支供审阅。

## 第一阶段已通过（基线记录）

| 检查 | 结果与证据 |
| --- | --- |
| `npm run build:piik` | 完整通过；上游源码未修改，TypeScript 检查、浏览器/协议 bundle、Go server、许可证 notices 均生成 |
| `npm test` | 429 tests，429 pass，0 fail |
| `npm run test:piik:gateway` | 使用实际 Go server；同频道授权、跨频道/未加入拒绝、凭据隔离、媒体 session 所有权、voice generation、多发布者、离开、晚到创建取消通过 |
| `npm run test:piik:browser` | 静音 headless Edge 155.0.4283.45；实际原页面、Node、Piik Go、WebRTC P2P，通过下列检查 |
| 上游 Go focused tests | `go test -p 4 ./internal/server/route ./internal/server/signal ./internal/server/app`，三包均通过 |
| 新增 JavaScript ESLint | gateway、构建/启动/测试脚本，0 errors / 0 warnings |
| `git diff --check` | 通过 |

浏览器回归覆盖：

- 在原频道、原舞台接收 Piik VP8 视频。
- 共享时保留原双向 Opus RTP 与文字聊天。
- 首个共享者的活动连接只有 **1 个视频 sender**，排除旧 PeerJS 屏幕视频重复发送。
- 未加入语音/不同频道的媒体访问被拒绝。
- 两名用户各自共享、停止自己的共享仍观看另一人、停止/重开。
- 发布者信令重连后保留原 capture 并重新建立媒体子房间。
- 观看者刷新后先失去权限，重新加入语音后恢复观看。
- 发布者离开后共享目录清空。

最近一次接收采样：VP8、1280×720 的动态 canvas（30 FPS 采集目标），累计 `framesDecoded=83`、视频 `bytesReceived=102900`；同一接收者有 Opus inbound `bytesReceived=9804` 与 outbound `bytesSent=8184`。这些是累计计数，**没有提供稳定 FPS 或平均 bitrate 的测量窗口**，不能推导已达到 720p30，更不能推导 4K60。

完整本地日志位于 ignored `.build/final-build.log`、`.build/final-unit-tests.log`、`.build/final-browser-test.log`；机器可读结果在 ignored `artifacts/browser-report.json`。构建产物/大型依赖未加入 Git。

## 第一阶段验收边界（历史）

本轮确认了**原平台界面通过 Piik P2P 播放浏览器采集的视频**。原生 NVENC AV1 A、原生 AV1 WebRTC B、真实双设备目标帧率 C 都不是本轮测试对象，不能标记成功。

尚未验收：实际屏幕/系统音频、真实麦克风听感、Android、可信 HTTPS 的双设备路径、跨 NAT、实际弱网恢复、长时间多观看者、App、编码池、转发、SFU 和 4K 性能。已知满员刷新宽限、ICE 与全站带宽门槛见 README。

浏览器测试使用专用临时 profile、假麦克风、动态 canvas 与 `--mute-audio`，没有系统输入注入、真实屏幕采集或用户浏览器操作。最后一次回归后，已确认该任务的 headless Edge、Node 测试实例和 Go 服务全部退出。后续自动媒体测试保持静音。

## 第一阶段改动范围（历史）

- 创建隔离 worktree 和 `codex/piik-integration` 开发分支；原 checkout 仍只有原有未跟踪 `native/` 实验。
- 下载固定 Piik 源码、其 npm/Go 依赖；Go 工具链放用户缓存，不写系统 PATH。
- 本 worktree 的 `node_modules` 借用原 checkout 现有依赖，没有更新原 checkout 的 package-lock 或安装新的根依赖。
- 没有更改生产环境、服务器配置、账号、证书信任、防火墙、系统音量或音频设备配置。
- 没有 commit、Push、部署、打标签或打正式发布包；缓存/构建结果留在本地以供复测。

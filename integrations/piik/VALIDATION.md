# 本轮验证记录

日期：2026-10-18。分支：`codex/piik-integration`。Piik：`9925486cec9910c0a76e47208b29b6f39942e096`。所有结果是本地开发验证，未发布。

## 已通过

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

## 验收边界

本轮确认了**原平台界面通过 Piik P2P 播放浏览器采集的视频**。原生 NVENC AV1 A、原生 AV1 WebRTC B、真实双设备目标帧率 C 都不是本轮测试对象，不能标记成功。

尚未验收：实际屏幕/系统音频、真实麦克风听感、Android、可信 HTTPS 的双设备路径、跨 NAT、实际弱网恢复、长时间多观看者、App、编码池、转发、SFU 和 4K 性能。已知满员刷新宽限、ICE 与全站带宽门槛见 README。

浏览器测试使用专用临时 profile、假麦克风、动态 canvas 与 `--mute-audio`，没有系统输入注入、真实屏幕采集或用户浏览器操作。最后一次回归后，已确认该任务的 headless Edge、Node 测试实例和 Go 服务全部退出。后续自动媒体测试保持静音。

## 本机改动范围

- 创建隔离 worktree 和 `codex/piik-integration` 开发分支；原 checkout 仍只有原有未跟踪 `native/` 实验。
- 下载固定 Piik 源码、其 npm/Go 依赖；Go 工具链放用户缓存，不写系统 PATH。
- 本 worktree 的 `node_modules` 借用原 checkout 现有依赖，没有更新原 checkout 的 package-lock 或安装新的根依赖。
- 没有更改生产环境、服务器配置、账号、证书信任、防火墙、系统音量或音频设备配置。
- 没有 commit、Push、部署、打标签或打正式发布包；缓存/构建结果留在本地以供复测。

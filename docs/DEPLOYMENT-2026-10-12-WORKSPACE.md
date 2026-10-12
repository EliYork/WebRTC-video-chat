# 2026-10-12 工作区整合部署

本次按用户授权，将工作区全部待提交的源码、测试、文档、发布脚本及必要前端资源提交、推送并部署。旧 ZIP、真实配置和运行数据未提交 Git。版本号保持 1.0.5。

## 最新更新：语音中切回 RNNoise 失败修复

- 根因一：浏览器 CSP 阻止 RNNoise 的 WebAssembly 编译；HTML 与 Worklet 响应现在放行 `wasm-unsafe-eval`，继续禁止 JavaScript `unsafe-eval`。之前的离线 WASM/模拟管线检查未覆盖这一层。
- 根因二：Edge 在普通布尔请求下可能复用旧采集源，导致浏览器模式实际 NS 仍关闭。对浏览器明确报告支持的 NS/AGC 使用严格请求，模式切换时获取符合要求的采集源；失败保留原管线。诊断增加失败目标和安全映射原因。
- 源码提交：`ced301f4b3c050956a75295fa16a80c80aa5c905`，已推送并部署。
- 运行包：`release/webrtc-video-chat-1.0.5-20261012-192243-375.zip`，120 个运行文件；SHA256：`2B2A1CFDA8C1EAC746F159CBEC532F8685DE521D1A2CAC1099D612FB5D99A7D5`。旧包保留。
- `npm test` 297 项通过；源码、专项浏览器脚本及涉及的音频/UI 测试 lint、Worklet 语法和差异检查通过。既有全仓 lint 问题未夹带修复。
- 本地与公网真实 Edge 155、假麦克风、真实 WASM/CSP 检查均通过：8 次运行时往返、6 次进入语音后的设置控件往返、连续快速选择、同一输出轨道与静音保持、实际 NS 与模式一致、门控确认。普通 nonce 脚本的异步 JS eval 被浏览器 CSP 拒绝。没有关闭 CSP、替换业务模块或使用物理麦克风；公网检查使用独立测试房间，结束后离开并关闭浏览器。
- 本地证据：`%TEMP%/webrtc-noise-switch-oYOY1o/result.json`；公网证据：`%TEMP%/webrtc-noise-switch-ui7P1h/result.json`。回归入口：`scripts/verify-noise-mode-switch-app.mjs`。
- 部署验证：旧源码/依赖逐项备份，staging HTTP/CSP 与真实 worker/router 检查通过；120 个部署文件与 ZIP 哈希一致。生产本机与公网 HTML/Worklet CSP 均正确，HTTP、实际加入语音的信令及 SFU UDP/TCP 44444 正常。真实配置、聊天记录和其他服务 PID 保持不变。
- 当前回执与回滚：`/www/backup/voice-deploy/mode-switch-20261012-192243`；回滚命令：`python3 /www/backup/voice-deploy/mode-switch-20261012-192243/rollback.py`。回滚脚本已检查语法，未为测试执行生产回滚。
- 加载新版需要刷新并重新加入一次；此后的正常模式切换无需退出语音或重开共享。仍需用户试听真实键盘、人声与外放回声，自动行为检查不代表降噪听感通过。

## 上次更新：键盘残留抑制

- 用户反馈仍有键盘声后，增加使用已有 RNNoise 人声概率的可关闭平滑门控；没有新增模型、前视缓冲或媒体传输策略。仅作用于 RNNoise，设置中默认开启，允许关闭对比。
- 源码提交：`c8ce91f019ac7f3418f01a27358298a2ad9615a1`，已推送并部署。
- 最新运行包：`release/webrtc-video-chat-1.0.5-20261012-181339-411.zip`，120 个运行文件。
- 最新 SHA256：`A563EBA15BC827B3620FE698537AE180CD3E71B27D2501E9ACD1A7EF4075D20F`。
- 295 项自动测试、源码及涉及测试文件 lint、模板与 Worklet 语法检查通过；包含真实 WASM 离线处理合成敲击，未代替用户真实键盘和说话试听。
- 部署再次完成旧版本备份和逐项校验、备用 HTTP / worker/router 检查；120 个线上运行文件与包一致，8 个变更 JS 的公网哈希一致。新版键盘抑制节点存在，公网 WebSocket 正常，SFU UDP/TCP 44444 正常。
- `voice-room` PID 517456 在线且无额外崩溃重启；`friend-footprints` PID 500768 未变。真实配置、最终聊天记录及旧备份保留。
- 最新回执与回滚路径：`/www/backup/voice-deploy/keyboard-20261012-181339`。需要撤回此次更新时运行 `python3 /www/backup/voice-deploy/keyboard-20261012-181339/rollback.py`，恢复上一个整合版本的程序与依赖，保留当前数据及配置。回滚脚本语法检查通过，未为测试执行生产回滚。
- 双方刷新并重新加入以加载新版后，选择 RNNoise，确认诊断显示“键盘抑制开”；对比不讲话打字、边讲话边打字及轻声。主要改善低人声概率的残留，不能保证讲话期间完全消除键盘声；轻声或首字变弱时可关闭对比。

以下为此次键盘抑制更新前的整合发布记录，旧包和回滚点继续保留。

## 版本与运行包

- 源码提交：`dee7f4525507b5d200ae58c8fc16a16ce4ddf229`，已推送 `origin/master`。
- 网站：<https://voice.eliyork.com/room/lobby>。
- 程序目录：`/www/wwwroot/voice.eliyork.com`；PM2：`voice-room`。
- 运行包：`release/webrtc-video-chat-1.0.5-20261012-175339-296.zip`。
- SHA256：`C802088E1845C1A8657644C9B71948FC41C0022943A964D94A84AE052CC50793`。
- 运行包包含 119 个白名单文件；服务器部署后逐项哈希全部一致。

## 本次内容

整合此前未提交的 SFU / P2P 恢复、H.264 / VP8 选择与诊断、界面与本地第三方资源、信令和依赖修复、音频设备恢复，以及本轮互斥降噪模式、稳定音频输出与 AEC 检测/读回。DeepFilterNet3 仅包含调查文档，没有安装模型。

先前的项目检查、音频和 UI 文档描述各轮结束时的历史状态；这些改动现已随本次整合包上线。本次部署记录作为当前上线状态依据。

## 发布检查

- 发布前 `npm test`：284 通过，0 失败、0 跳过。
- `npx eslint src`：通过。全仓 lint 仍有此前记录的脚本和测试问题：96 个错误、29 个警告，未声称全仓 lint 通过。
- 暂存内容检查未发现私钥或 GitHub token 签名；真实 `.env`、证书、聊天记录、日志、依赖目录和 ZIP 未提交。
- 打包脚本校验清单及每个文件的 SHA256；上传后的整体 ZIP 哈希再次校验。
- 备用目录安装生产依赖，复用同版本 mediasoup 3.29.0 的已验证 Linux worker；独立启动 worker/router 和备用 HTTP 服务通过后才停服切换。
- 切换前复制并逐项验证旧程序和依赖；停服后保存最终聊天记录副本；真实配置和原数据路径保留。
- 本机及公网房间 HTTP 通过，新降噪选择和诊断节点存在；公网 95 个 JS / CSS / WASM / 字体资源哈希与运行包一致。
- 公网 Socket.IO 实际 WebSocket 握手通过；SFU 日志报告 ready，UDP 和 TCP 44444 均由 mediasoup worker 监听。
- 复查 PM2 `voice-room` 在线，PID 516361，无额外崩溃重启；其他 `friend-footprints` 进程 PID 500768 未变。
- 未修改 Nginx、防火墙、服务器环境参数或数据存储路径，未删除旧包和备份。

这些检查不代表真实麦克风降噪听感、外放回声消除效果、双端媒体长期体验、游戏画质或微信真机验收。实机试听仍由用户完成，步骤见 `docs/AUDIO-PROCESSING-2026-10-12.md`。

## 生效方式

发送者和观看者首次升级需刷新页面、重新加入语音并重新开始共享，以加载新代码。加载新版后，正常切换设备与降噪模式无需重新加入或重开共享。

## 回滚与回执

完整备份及服务器回执：

`/www/backup/voice-deploy/workspace-20261012-175339`

回滚命令：

```sh
python3 /www/backup/voice-deploy/workspace-20261012-175339/rollback.py
```

脚本保留回滚前程序，恢复旧源码及依赖，重启同一 PM2 服务并检查 HTTP，不回退当前聊天记录或真实配置。脚本语法已检查，未为测试执行生产回滚。

上传包和部署脚本保存在服务器私有目录：

`/www/backup/voice-deploy/incoming-workspace-20261012-175339`

本报告提交只增加部署记录，不改变已部署的运行文件；服务器回执中的源码提交对应本次运行包。

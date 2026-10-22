# 本地资源与 CDN 权限收口（2026-10-22，本地候选）

## 当前事实与改动

检查时房间入口已经使用本地 PeerJS、Font Awesome 和其他媒体脚本，无需重复下载或升级这些资源。旧 README 仍称 PeerJS 依赖 CDN，服务端 CSP 也还允许 unpkg 与 Font Awesome CDN；本轮修正文档，并移除这些不再需要的许可。

| 资源 | 现有运行位置 | 许可文件 |
| --- | --- | --- |
| PeerJS | `src/views/vendor/peerjs/peerjs.min.js` | 同目录 `LICENSE` |
| Font Awesome CSS / 字体 | `src/views/vendor/fontawesome/css/`、`webfonts/` | `src/views/vendor/fontawesome/LICENSE.txt` |
| SFU 浏览器客户端 | `src/views/vendor/screen-sfu-client.js` | 同目录 `screen-sfu-client.NOTICES.txt` |

服务端删除 `script-src` 中的 `https://unpkg.com` 与 `https://kit.fontawesome.com`，以及 `font-src`、`connect-src` 中的 `https://ka-f.fontawesome.com`。保留现有同源资源、bootstrap nonce、RNNoise WASM、blob worker/media、样式以及 WebSocket/Piik 回环桥接许可。**仍保留既有 `ws:` / `wss:` 来源，这不是只允许同源网络连接的完整 CSP 收口。**

## 验证

- 新增回归先在旧代码上失败：真实 HTTP 响应仍包含旧 CDN 来源；隐藏页面的 4 次探测也到达了测试的外网阻断器，没有产生预期 CSP 拒绝。确认缺陷后修改策略，两个检查均通过。
- `desktop/windows/test-local-assets.cjs`：独立临时 profile、隐藏、静音、禁止媒体权限的完整页面。测试拦截并拒绝一切外部 HTTP/WebSocket 请求，本机 Node 服务使用隔离聊天路径，未读取用户 `.env`。
- 页面 boot 与聊天连接完成；实际加载本地 PeerJS、两种 Font Awesome woff2 字体；实际 Socket.IO transport 为 `websocket`，PeerJS 打开本机信令连接并成功加入语音、离开语音。整个测试没有创建媒体连接或采集麦克风、摄像头、桌面。
- 通过 DOM script、FontFace、fetch 分别探测旧 CDN 地址。浏览器记录 2 个 `script-src-elem`、1 个 `font-src` 和 1 个 `connect-src` 拒绝；请求在进入网络阻断器之前已被 CSP 拒绝。实际外部请求数为 **0**，不是拦截后把请求成功当成资源可用。
- 结果：`integrations/piik/artifacts/local-assets/result.json`，`publicMediaVerified: false`。
- `npm test`：**535/535 通过，0 失败、0 取消、0 跳过**；复用既有真实服务器回归并扩展其 CSP 断言，没有只以源码匹配判断浏览器行为。定向 ESLint 通过；同文件此前启动轮询的 lint 问题以限定原因的注释处理，未改变测试行为。
- 根项目同日独立全量 `npm audit --json` 已恢复成功，**0 告警**；前次 503 保留为历史过程，见 [依赖检查](DEPENDENCY-AUDIT-2026-10-22.md)。

## 发布与边界

修改的运行文件仅为 `src/server.js` 中的 CSP，已有资源与许可证文件保持不变，没有新增依赖或发布白名单项。本轮未打包、提交、推送、部署、安装更新、升级版本或修改生产/系统配置；原有脏工作区保留。

需要重启服务才能应用新响应头；本地结果不表示线上已更新。测试证明此配置下页面与本机信令不依赖外部 CDN，不代表真实公网 ICE/TURN、音视频质量、Piik 原生桥接或手机验收通过。

# 2026-10-19：网页版客户端下载入口上线

## 发布状态

已部署到 https://voice.eliyork.com 。网页右上角「下载客户端」指向 `/download/windows`，按现有 `downloads/windows/latest.yml` 跳转到已发布的 Windows x64 安装包。目前为 **0.1.4**。客户端通过已有 desktopChrome 标记隐藏入口；480px 以下仅显示下载图标。

网页构建：`5be534293c1bbd22a2f5bf9ee8d076fe3f8ae2f9`，为运行源码规范化内容摘要，不是 Git 提交。package 版本仍为 1.0.5。未 Commit、Push、Tag、合并、重发安装包或更新用户本机客户端；待发布的客户端首次黑屏修复仍在本地工作区。

仅更新四个运行文件：`src/server.js`、新增 `src/utils/DesktopDownload.js`、`src/views/room/index.ejs`、`src/views/styles/stage-layout.css`，以及构建清单。发布不包含其他客户端和媒体修改。

## 验证

- 发布前 `npm test` **472/472**。既有隔离静音浏览器布局检查及下载按钮 1080p/1440p/4K/390px/320px 检查通过，已查看渲染图。
- 白名单 ZIP 119 项及逐项 SHA256 通过：`release/webrtc-video-chat-1.0.5-20261019-193357-487.zip`，SHA256 `5a24f0d6fdb24821a51d0f1382fb37868c52b00010b54a86fc8e4302cdff2486`。
- 完整私有备份和隔离候选健康检查通过。切换前五个语音频道均无人。
- 生产 HTTPS、新构建、静态 CSS 摘要、按钮渲染、WSS、未经授权发布和观看拒绝、内部路径 404 均通过。
- 实际下载入口返回 **302**，忽略伪造 version/path 参数，同站指向 `EliYork-Voice-Setup-0.1.4-x64.exe`；安装包 Range 请求 **206**，前 64 bytes 为真实 PE 内容、含 MZ 文件头。没有全量重新下载安装或执行程序。
- 缓存响应包含 `no-store, no-cache`（既有代理追加 no-cache）；不缓存版本跳转。最初检查脚本误要求精确等于 no-store，按 HTTP 合法组合头修正后检查通过，未为测试改动生产配置。
- 远端四个运行文件、所有现有下载文件摘要核对通过；`.env` 保持原值。没有真实媒体性能验收。

## 生产影响与备份

仅重启 Node `voice-room` 一次及更新 build 环境、PM2 save；停止至本机健康 **1.58 秒**、公网健康 **2.21 秒**，为探针测量。

- Node PID **57665**，127.0.0.1:3000，RSS 122646528 B、CPU 0.8% 快照。
- Piik PID **43641** 未变，127.0.0.1:17887 TCP / 3478 UDP，RSS 10346496 B。
- 其他站点 PID 未变，临时候选 17888 已退出；最终 MemAvailable 434516 kB。

未改 Nginx、带宽预算、Piik、下载包/feed、聊天数据、密钥、TLS、SSH、cron、防火墙，也未清理旧包或备份。额外生产写入为本次私有候选/备份目录和验证报告。

私有服务器备份：`/www/backup/voice-deploy/client-ui-20261019T113354`，包含旧代码、完整 env/data/Nginx/TLS/PM2 安全快照、摘要、候选和结果。

回滚：

```sh
sh /www/backup/voice-deploy/client-ui-20261019T113354/rollback.sh
```

回滚仅恢复本轮代码/build 并重启本站 Node，不回写实时聊天或环境；新增下载 helper 会撤除。未对生产执行回滚。

本地验证记录：`integrations/piik/.build/download-deploy-20261019/`。敏感快照仅在服务器私有目录内保留。

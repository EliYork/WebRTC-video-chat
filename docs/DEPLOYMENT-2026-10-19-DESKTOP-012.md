# 2026-10-19：客户端 0.1.2 与标题栏 / Dock 发布

## 版本与范围

- 源码提交：`d35c4d894db402adf335030e97ef5fefef0dd8d2`，本地 `master`；未 Push。
- Windows 客户端 0.1.2；网页 package 仍 1.0.5，线上 build 为上述提交。两者版本独立。
- Piik 固定来源：`9925486cec9910c0a76e47208b29b6f39942e096`；未替换 Go 服务或原生采集二进制，保留许可声明。
- 标题栏统一为“语音据点”，刷新在最小化左侧；保留 Ctrl+R、活动媒体刷新确认。设置菜单新增“关于与更新”。真实媒体 Dock 留在左下区域，无全宽底栏。
- 网页实际变化仅 `src/views/room/index.ejs`、`src/views/styles/stage-layout.css`、`integrations/piik/.build/client.js`。下载发布工具另原字节重写四个既有前端资源，内容未变。没有新增媒体架构。

## 验证与限制

- `npm test` 445/445、ESLint、diff 检查通过。
- 隔离静音布局检查：12 个视口/DPR、24 个语音/共享布局、72 个成员布局；源码与最终 EXE 隐藏 smoke 通过。
- Piik 网页/native 合成媒体生命周期、三观看者单采集、语音聊天回归通过。更新器合成下载、摘要及错误路径通过。
- 生产 HTTPS feed 用真实 electron-updater 验证：0.1.1 发现 0.1.2，0.1.2 无新版；未下载或安装。latest.yml 为 no-store，安装包与 blockmap Range 206、服务器完整 SHA256 正确。
- 公网健康、静态资源 SHA256、单一真实 Dock、WSS 握手、未加入语音的伪造发布/观看拒绝、内部接口 404 均通过。
- 一次发布检查脚本因 stdout 管道关闭触发 EPIPE 原生错误弹窗。已仅关闭对应开发 Electron 测试进程，改用文件结果及重定向日志后重测通过；未修改或结束用户新版客户端。
- 自动测试不证明真实 NVIDIA 编码、Android、持续共享或 4K60；视觉、声音及设备体验仍由用户验收。

## 成品与本机更新

- 安装包：`desktop/windows/.build/EliYork-Voice-0.1.2-20261019T041734744Z-win-x64/EliYork-Voice-Setup-0.1.2-x64.exe`
- 大小 150963840 bytes；SHA256 `7fa667bd151910c246d31e1c44d909feb8af7d868cd534d8a5caf662caea467ad`。
- ZIP：`release/EliYork-Voice-0.1.2-20261019T041734744Z-win-x64.zip`；SHA256 `7b48b0de419600634f7531c03d0325064eecf8164f9e94b7d15d61ee437eaf7c`。
- 包内 build revision 为 d35c4d8，trackedChanges=false；ZIP 清单、逐项摘要通过。未提交 ZIP、SDK 或未跟踪 native 实验。
- 下载：[Windows 0.1.2](https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.2-x64.exe)。无代码签名，SmartScreen 仍可能提示。
- 用户确认未通话/共享后，向精确安装路径的旧客户端发送正常关闭，备份用户设置后静默覆盖安装，退出码 0。安装后的 345 个运行文件摘要与构建一致，package 确认 0.1.2，已重开窗口“语音据点”及原生 piik-app 子进程。
- 本机安装：`C:\Users\EliYork\AppData\Local\Programs\eliyork-voice-desktop\EliYork Voice.exe`。
- 本机设置备份：`C:\Users\EliYork\AppData\Local\EliYorkVoiceUpdateBackups\0.1.1-to-0.1.2-20261019T122421`。
- 本机降级入口：退出新版后运行保留的 `C:\Users\EliYork\.codex\worktrees\piik-integration\WebRTC-video-chat\desktop\windows\.build\EliYork-Voice-0.1.1-20261019T010623018Z-win-x64\EliYork-Voice-Setup-0.1.1-x64.exe`。未演练降级；已安装版本不会自动降级。

## 线上运行与影响

站点仍为 https://voice.eliyork.com ，目录 `/www/wwwroot/voice.eliyork.com`。

| 服务 | PID | 监听 | 最终 RSS / CPU 快照 |
| --- | --- | --- | --- |
| voice-room | 52002 | 127.0.0.1:3000 TCP | 108482560 B / 0.6% |
| voice-piik | 43641，未重启 | 127.0.0.1:17887 TCP；127.0.0.1:3478 UDP | 19521536 B / 0% |
| friend-footprints | 1389，未重启 | 原 127.0.0.1:3010 | 61947904 B / 0.3% |

仅 Node 重启一次，停止到本机健康 1.60 秒、到公网健康 2.51 秒（探针观察，非实机通话中断测量）。下载入口 Nginx -t 通过并平滑 reload，Node/Go 无第二次重启。临时候选 17888 无监听。

服务器 1 vCPU / 961 MiB RAM，最终可用内存 426 MiB，磁盘余 10583740416 bytes；快照不等于压力测试。保持 20 Mbps 媒体预算及已有下载限速 256 KiB/s/连接、最多 2 连接。

生产变更：两个私有备份/暂存目录、上述三文件与构建清单、客户端安装包/blockmap/feed、现有下载 Nginx location、本站 PM2 build 环境与一次 Node 重启及 pm2 save。未覆盖 .env、聊天数据、TLS、密钥、账号、SSH、cron、防火墙或其他站点；最终 .env 与发布前快照逐字节一致。增量上传仅用于私有暂存重建，完整安装包摘要校验后发布，不是新客户端更新协议。

## 备份、回滚与停止

- 网页备份：`/www/backup/voice-deploy/client-ui-20261019T121719`，含完整代码/env/data/Nginx/TLS/PM2 安全快照、旧新文件、摘要、部署脚本及 result。
- 下载备份：`/www/backup/voice-deploy/client-20261019T121719`，含旧 feed/Nginx/manifest/资源、安全快照、摘要、部署脚本及 result。
- 所有旧备份与旧包保留，回滚入口已检查；未在生产演练回滚。

如需撤回整次发布，先恢复下载，再恢复网页：

```sh
sh /www/backup/voice-deploy/client-20261019T121719/rollback.sh
sh /www/backup/voice-deploy/client-ui-20261019T121719/rollback.sh
```

回滚不覆盖实时环境或聊天。网页回滚会重启本站 Node，下载回滚只平滑 reload Nginx。仅停止更新分发可将 `downloads/windows/latest.yml` 移至私有备份；已安装客户端不会自动降级。

需要主动停止本站服务时（将中断功能）：

```sh
export PATH=/www/server/nodejs/v24.15.0/bin:$PATH
pm2 stop voice-room
pm2 stop voice-piik
```

恢复：`pm2 restart voice-room voice-piik`。本次未执行这些停止命令。

## 用户验收

双击原快捷方式即可进入线上同一频道。右上“设置 → 关于与更新”可看客户端/网页版本与手动检查更新；网页 1.0.5 不代表客户端未更新。检查不自动下载安装，安装前再次确认并释放语音与共享。

确认标题只出现一次、刷新位于最小化左侧、左下 Dock 紧凑、舞台/右侧聊天高度正常；在 1080p、2K、4K 及 Windows 缩放下复查。加入频道后分别验收网页共享、原生共享、停止/切换/画质、语音与 Android/多人接收。未接入新的多级转发或原生 AV1。

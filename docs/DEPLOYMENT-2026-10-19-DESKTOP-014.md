# 2026-10-19：客户端 0.1.4、托盘与频道提示音发布

## 实际状态

- 网站：https://voice.eliyork.com ，客户端生产更新源 **0.1.4** 已上线。
- 网页 package 版本仍为 1.0.5；实际构建 `904f5a67cec1caa42ebf8c05e0a0ffcb3599bd66` 是规范化运行文件内容摘要，**不是 Git 提交**。
- 来源为 master 工作区，HEAD `4e625e5501419dd045294527c2aad93f22ab5e20`，成品 `trackedChanges=true`。没有 Commit、Push、Tag、合并，也没有自动安装或重启用户本机客户端。
- Piik 上游仍为 `9925486cec9910c0a76e47208b29b6f39942e096`，MIT 和第三方声明保留；本次原生组件及采集编码二进制与 0.1.3 相同。

## 用户更新与验收

1. 网页刷新即可获得加入 do–re、离开 re–do 提示音；Dock 声音下拉可关闭或调音量，默认 35%。提示音使用独立 Web Audio 节点，未加入麦克风发送流；共享整个系统音频时仍可能采集到。
2. 旧客户端进入「设置 → 关于与更新 → 检查更新」，下载后确认安装；先结束通话与共享。也可下载 [0.1.4 安装包](https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.4-x64.exe)。未签名，SmartScreen 可能提示。
3. 新版设置提供检查动画和实际下载进度；确认窗口无系统提示音。点 × 可选最小化到托盘或退出，并记住选择；以后到「设置 → 关于与更新 → 窗口与托盘」修改。
4. 最小化到托盘应继续通话及共享；点击托盘恢复，托盘退出应释放原生组件。真实 Windows 托盘、DPI、听感、Android 与长时间 4K60 由用户验收，本轮自动测试不能证明这些指标。

## 成品

- 本地安装包：`desktop/windows/.build/EliYork-Voice-0.1.4-20261019T092902366Z-win-x64/EliYork-Voice-Setup-0.1.4-x64.exe`。
- 安装包 150981377 bytes，SHA256 `61b7fe1770d773179bbe7d3ecf4bd9e1d4d5c0d4cebf23af4ac268780e27b89f`。
- 便携 ZIP：`release/EliYork-Voice-0.1.4-20261019T092902366Z-win-x64.zip`；SHA256 `3dec138ac39715580d992ad08c2261685141f5c7d782178c21e0cd126557a3b3`。
- 网页候选 ZIP：`release/webrtc-video-chat-1.0.5-20261019-173131-932.zip`，118 项；SHA256 `08fd9f62c026d7887229d513e3f26b35ec33c39edeedb9de0ddd525fee290abf`。
- 原生采集 SHA256 `ebc06e3f906689a72587e5ad4289cb307d153d438f0b113a5c3823a13754278d`，未新增 AV1 能力。

## 验证与生产影响

- 最终 `npm test` **465/465**，ESLint、差异空白检查、ZIP 清单与逐项 SHA256 通过。
- 最终打包 EXE 的隐藏静音 smoke 通过：标题栏、刷新确认/Ctrl+R、保留原生 PID、剪贴板、更新窗口、合成媒体与退出清理。
- 设置/托盘生命周期、实际更新器本地合成更新与进度、离线波形检查通过；没有对扬声器播放测试声音。
- 生产实际 electron-updater 检查：0.1.3 发现 0.1.4；0.1.4 无新版。检查没有下载、执行安装或操作用户客户端。
- 生产 HTTPS、修改静态资源摘要、渲染页、WSS 握手通过；未加入语音的伪造 publish/watch 均拒绝；内部路径 `/api/rooms`、`/signal`、`/native`、`/api/native` 返回 404。
- 安装包/blockmap/feed Range 206、远端完整 SHA256 与 feed SHA512 通过，`.env` 摘要保持原值。
- 网页仅更新 4 文件：`voice-channel-sounds.js`、`room/index.ejs`、`script.js`、`styles/controls.css`。Node 仅重启一次；停止到本机健康 **1.87 秒**、到公网健康 **2.89 秒**，这是探针间隔，不是真实通话中断测量。切换前五个语音频道均空。
- 客户端阶段仅 Nginx 平滑 reload，配置检查通过，未重启 Node/Go。四个既有前端资源按当前摘要重新发布，内容未变。更新下载仍限每连接 256 KiB/s、最多两连接。
- 部署上传通过旧 blockmap 重建完整安装包，仅传 501458 changed bytes，重建后全量校验。这是运维上传优化，不是新增客户端更新协议。

| 服务 | 最终 PID | 监听 | RSS / CPU 快照 |
| --- | --- | --- | --- |
| voice-room | 55760 | 127.0.0.1:3000 TCP | 112136192 B / 0.2% |
| voice-piik | 43641，未变 | 127.0.0.1:17887 TCP、127.0.0.1:3478 UDP | 10215424 B / 0% |
| friend-footprints | 1389，未变 | 未修改 | 50806784 B / 0.3% |

服务器 MemTotal 984552 kB、MemAvailable 413388 kB，磁盘可用 9737957376 B；临时候选 17888 已退出。快照不代表媒体负载测试。现有 20 Mbps 媒体预算、P2P 策略未变。

## 备份、回滚与写入范围

- 网页私有备份：`/www/backup/voice-deploy/client-ui-20261019T093210`。含完整代码/env/data/Nginx/TLS/PM2 安全快照、旧文件、候选与发布结果。
- 客户端私有备份：`/www/backup/voice-deploy/client-20261019T093210`。含旧 feed/manifest/Nginx、环境与聊天安全副本、摘要和最终验证。
- 原 0.1.3 安装包与既有备份、构建全部保留；本轮没有清理删除。

完整回滚按顺序执行：

```sh
sh /www/backup/voice-deploy/client-20261019T093210/rollback.sh
sh /www/backup/voice-deploy/client-ui-20261019T093210/rollback.sh
```

更新通道回滚仅 reload Nginx；网页回滚重启本站 Node，不恢复旧聊天或覆盖实时环境。已安装新版不会自动降级。回滚入口已生成，未对生产执行回滚。

如需紧急停止本站服务（会中断语音及共享，其他站点保留）：

```sh
export PATH=/www/server/nodejs/v24.15.0/bin:$PATH
pm2 stop voice-room voice-piik
# 恢复：pm2 restart voice-piik voice-room
```

生产写入仅上述两个私有目录、4 个网页文件、4 个同内容既有静态资源、manifest、0.1.4 安装包/blockmap/feed、现有下载 Nginx location、Node build 环境及 PM2 save。未修改生产 `.env`、聊天数据、密钥、TLS、SSH、cron、防火墙、Piik 二进制或其他站点。最终验证记录在本地 `integrations/piik/.build/release-014/`，敏感安全快照仅保留在私有服务器目录。

# EliYork Voice / Piik 生产交付 · 2026-10-19

## 实际版本与产物

- 分支：`codex/piik-integration`。运行代码与客户端 manifest：`83f7e1379a30ef282f7e895b7b81536ed58c2762`。无 main 合并、无 Push。
- Piik：`9925486cec9910c0a76e47208b29b6f39942e096`，MIT；使用既有 viewer-left overlay，未修改上游 tracked 源码。
- Electron：44.9.0，Windows x64，便携客户端 0.1.0，未签名。
- 客户端：`release/EliYork-Voice-0.1.0-20261018T180552202Z-win-x64.zip`，193,783,612 bytes。
- ZIP SHA256：`240753a13e3e38468c85051fa78acd9e0340757c7b4badbd5c8e7cbcea6eb6d8`。84 文件逐项校验通过；最终 EXE 已隐藏静音启动验证。
- Linux 服务包：`integrations/piik/.build/eliyork-voice-piik-server-20261018T180549090Z.tar.gz`，124 项逐项 SHA256 校验通过，未入 Git。

## 生产变更

站点仍为 `https://voice.eliyork.com`，目录仍为 `/www/wwwroot/voice.eliyork.com`。2026-10-19 02:09 左右（北京时间）切换成功，PM2 stop 至公网健康恢复实测 **4.29 秒**；不是连续探测得到的精确外部停机时长。活跃语音/共享会话需重新连接。

| 服务 | PID（交付采样） | 监听 | RSS / CPU（交付采样） |
| --- | --- | --- | --- |
| voice-room / Node 24.15.0 | 43655 | 127.0.0.1:3000 | 114.2 MiB / 0.2% |
| voice-piik / Go | 43641 | 127.0.0.1:17887，UDP 127.0.0.1:3478 | 32.2 MiB / 0% |

服务器 1 vCPU / 961 MiB 内存；候选双份 Node 并行验证后仍有 263 MiB 可用，切换且公网合成测试后采样可用 316 MiB，swap 152 MiB，磁盘部署前约 10.9 GiB 可用。短时采样不代表长期容量验收。未启用服务器视频转发或转码，未改 20 Mbps 预算。

PM2 自动重启已启用并保存，现有 `pm2-root.service` enabled。新增 `voice-piik`；原 `voice-room` 更新为 Piik 模式并绑定 loopback，原 SFU worker 随旧 Node 停止，44444 不再监听。Nginx 配置、证书、生产 `.env`、聊天文件字节保持不变；未重载 Nginx、未改防火墙、其他站点/账号/SSH/定时任务。`friend-footprints` PID 1389、restart=0 保持不变。

原发布清单的运行文件全部匹配；`.env.example` 和 `docs/RELEASE.md` 与旧清单有差异，本轮保留生产现值并备份。候选锁文件因 Windows CRLF 与线上 LF 字节不同，改为 JSON 完整语义相等校验后确认依赖未变，复用已有 node_modules；没有在线安装或编译大依赖。

## 已完成检查

- `npm test` 429/429；Piik gateway、browser、native 自动化全部通过；桌面新增 JS 定向 ESLint、Python 编译、diff check 通过。
- 本地合成浏览器 VP8 链路保留双向 Opus、聊天、多共享者、频道授权、停止/重建/刷新/离开清理。
- 本地合成原生 H.264：真实 Piik App/nativehost/Pion → 三观看者；一个 capture worker，浏览器没有额外视频发送器。
- **线上 HTTPS/WSS 合成原生 H.264**：通过相同 App/site capability 与原频道权限，经线上 Node/Go 向三个隐藏、静音 Edge 观看者发送并解码；测试使用发呆/项目频道，未发送测试聊天消息。验证同频道限制、重复加入释放容量、网页与原生同时共享、停止/重启、App 退出清理、双向假麦克风 RTP。
- 线上一次合成接收采样 framesDecoded=393，bytesReceived=1,740,402；没有配对计时窗口，**不能据此推导 FPS 或 Mbps**。输入 1280×720/目标30FPS，仅为协议测试。
- 最终便携 EXE 分别对本地服务和真实公网站点运行隐藏静音检查：原 room ready、sandbox、无网页 Node 权限、假麦克风、仅捕获自己隐藏 frame、站点发现 App、关闭后 App 退出。
- 公网 `/healthz` 报告上述 revision、screenProvider=piik、mediaReady=true；Piik asset 200，公网 `/api/rooms` 和 `/signal` 均 404；所有部署运行文件存在且 SHA256 对应 manifest；Nginx 配置检查通过。
- 所有本轮自动媒体测试静音，未操作用户鼠标/当前浏览器，测试进程已退出。

**尚未通过实机验收**：真实 Windows Graphics Capture、NVIDIA MF H.264 硬编选择、设备/系统音频、1080p60/1440p60/4K60、Android 解码/播放、多台设备长时间稳定性、真正跨 NAT。线上信令测试两个端点在同一台电脑，不能称跨 NAT 成功。

## 备份与回滚

私有备份：`/www/backup/voice-deploy/piik-20261018-180715`（目录权限700；名称时间为 UTC）。包含旧运行文件/逐项 SHA256 读回校验、环境/数据快照、配置/TLS归档、PM2前态/dump、候选验证结果、实际切换记录及回滚脚本。没有将备份或密钥提交 Git。

SSH 内回滚：

```sh
sh /www/backup/voice-deploy/piik-20261018-180715/rollback.sh
```

恢复旧版 `56d344d06be97f7cbb1c7c87a975724844df1187` 的运行代码，停止/删除 `voice-piik`、以原媒体模式重启 `voice-room` 并保存 PM2；保持实时聊天数据和 `.env`。回滚文件/hash 已验证，生产未实际切回旧版演练。旧版原备份亦保留于 `/www/backup/voice-deploy/av1-fix-20261018-195616-281`。

```sh
export PATH=/www/server/nodejs/v24.15.0/bin:$PATH
pm2 stop voice-piik                 # 只停媒体子系统
pm2 restart voice-piik              # 恢复媒体子系统
pm2 stop voice-room voice-piik      # 完全停止本站
```

本轮临时 SSH 密码辅助文件及其 Python 字节码在完成后删除；未将新 SSH key、凭据文件、后台任务或额外管理面板安装到用户机器/服务器。

## 下一步

按 [实机操作指南](PIIK-PRODUCTION.md) 双击客户端，与 Android/朋友浏览器进入同一频道验收。H.264 是当前原生能力，自动选择可用硬件适配器，并非强制 NVIDIA；编码复用已经接入，但自适应输出组可能增加编码器。P2P 上行随观看人数增长。

TURN、Piik SFU、跨 NAT 保证、多级观看者转发、自动更新及原生 AV1 未接入。先收集真实设备与网络结果，再决定后续顺序；当前没有启动额外架构扩展。

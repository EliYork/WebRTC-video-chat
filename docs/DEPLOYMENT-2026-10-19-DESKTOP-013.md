# 2026-10-19：原生共享性能修复与客户端 0.1.3 发布

## 实际发布状态

- 网站：https://voice.eliyork.com 。客户端更新通道已发布 **0.1.3**。
- 网页 package 版本仍为 1.0.5。线上构建 `e1b709b26b5f15d16943ed8e431f5a511503f4ae` 是规范化运行文件清单的内容摘要，**不是 Git 提交**。
- 来自本地 master 工作区，HEAD `4e625e5501419dd045294527c2aad93f22ab5e20`，包含未提交修改；成品记录 `trackedChanges=true`。本轮未 Commit、Push、Tag 或合并。
- Piik 来源仍为 `9925486cec9910c0a76e47208b29b6f39942e096`，保留原作者 MIT 和第三方声明；未修改上游 checkout。

发布范围：客户端 WGC 帧率节奏修复、App 默认过滤逐包 debug、网页统计采样与播放耗时修正、桌面默认原生共享、默认勾选来源声音。技术证据与限制见 [性能报告](PIIK-PERFORMANCE-2026-10-19.md)。未降低原始共享尺寸。

## 成品与更新

- 安装包：`desktop/windows/.build/EliYork-Voice-0.1.3-20261019T082511980Z-win-x64/EliYork-Voice-Setup-0.1.3-x64.exe`。
- 150961458 bytes；SHA256 `c2553879a4da785775786f108dd04336ff765ae18abf8b6aa33a5e1b9558402a`。
- ZIP：`release/EliYork-Voice-0.1.3-20261019T082511980Z-win-x64.zip`，SHA256 `ac23972d3cbb96f02e66e655f7c6120cba29b8e75314a50a13e60f99b985ffb1`。
- 新包原生采集 EXE SHA256 `ebc06e3f906689a72587e5ad4289cb307d153d438f0b113a5c3823a13754278d`，已核对包内实际文件。
- 在线安装包：https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.3-x64.exe 。无代码签名，SmartScreen 可能提示。

旧客户端进入“设置 → 关于与更新 → 检查更新”，下载并确认安装。安装会关闭客户端，先结束通话和共享。本轮未关闭、升级或重开用户已安装的客户端。网页刷新即可取得网页修复；原生采集修复需要客户端更新。

## 验证

- `npm test` 448/448；`git diff --check` 通过。
- 完整原生构建、原生合成媒体生命周期、三观看者单 worker、切源/画质/停止重开及语音聊天回归，见性能报告。
- 本轮源码和最终打包 EXE 的隐藏静音 Electron smoke 均通过，包含标题栏、刷新确认、原生进程保留、真实剪贴板诊断、版本、更新器、合成媒体及退出清理。
- 打包运行文件、ZIP 清单及逐项 SHA256 校验通过。
- 远端私有暂存使用 blockmap 复用旧安装包字节，上传约 30.4 MB 新数据；重建后校验完整安装包 SHA256，再发布。这仅是部署上传优化，未新增客户端更新协议。
- 生产 HTTPS、实际更新器、安装包与 blockmap Range 206、feed SHA512、已修改静态文件摘要、WSS 握手、未加入语音的伪造发布/观看拒绝、内部控制路径 404 均通过。
- 真实 electron-updater：0.1.2 发现 0.1.3；0.1.3 无新版；测试未下载、安装或退出用户客户端。
- 最终生产运行文件及下载摘要通过。全清单另发现两个发布前就存在的非运行文件摘要不一致：`.env.example`、`docs/RELEASE.md`；修改时间早于本轮暂存，旧 manifest 同样记录原摘要。本轮未改写这两个文件或伪造其摘要。
- 最初全量公网静态检查遇到超时，随后对本轮修改资源逐项检查通过。

真实游戏、Windows/Android 播放、音频回声和长时间稳定 4K60 仍需用户实机验收。短时 WGC/编码与浏览器测试不能证明稳 60 FPS。

## 服务与生产影响

仅 Node `voice-room` 停止/启动一次：停止到本机健康 **1.53 秒**，到公网健康 **2.58 秒**。这是探针测量，非真实通话中断测量。下载发布仅平滑 reload Nginx，`nginx -t` 通过。Piik Go 与其他站点未重启，临时候选 17888 已退出。

| 服务 | 最终 PID | 监听 | RSS / CPU 快照 |
| --- | --- | --- | --- |
| voice-room | 54385 | 127.0.0.1:3000 TCP | 59420672 B / 0.3% |
| voice-piik | 43641，未变 | 127.0.0.1:17887 TCP；127.0.0.1:3478 UDP | 10215424 B / 0% |
| friend-footprints | 1389，未变 | 原监听不变 | 25116672 B / 0.3% |

服务器仍为 1 vCPU / 961 MiB；最终 MemAvailable 474016 kB，磁盘空闲 10144296960 B。保留 20 Mbps 媒体预算和下载 256 KiB/s/连接、最多两连接。快照不代表负载测试。

生产写入包括：两个私有发布/备份目录、只读清理盘点报告、6 个运行文件、4 个既有同内容前端资源、构建清单、0.1.3 安装包/blockmap/feed、既有下载 Nginx location，以及 Node build 环境、一次重启与 PM2 save。`.env` 与发布前摘要一致；未改写实时聊天、密钥、TLS、SSH、cron、防火墙或其他站点。

## 备份与回滚

备份目录使用 UTC 时间戳：

- 网页：`/www/backup/voice-deploy/client-ui-20261019T082531`，含旧文件、完整代码/env/data/Nginx/TLS/PM2 安全快照、候选检查和最终报告。
- 更新通道：`/www/backup/voice-deploy/client-20261019T082531`，含旧 feed/Nginx/manifest、文件摘要、环境与聊天安全副本。
- 两个新回滚入口，以及上次 `20261019T121719` 的回滚文件和压缩快照完整性已检查。未在生产执行回滚。

整次撤回时按顺序运行：

```sh
sh /www/backup/voice-deploy/client-20261019T082531/rollback.sh
sh /www/backup/voice-deploy/client-ui-20261019T082531/rollback.sh
```

回滚不回写实时聊天或环境。网页回滚会重启本站 Node；更新通道回滚只 reload Nginx。已安装的 0.1.3 不会自动降级；0.1.2 安装包仍保留。

## 清理盘点：尚未执行删除

自动安全审核拦截了本地批量递归删除命令，命令未启动。本轮没有换工具强行删除，服务器也只执行清理预检，**本地和服务器释放空间均为 0**。

- 本地清单：`integrations/piik/.build/release-013/cleanup-local-plan.json`，74 项，合计约 **4.885 GiB**。主要是旧工作区失败/重复 Electron 打包目录、重复解包副本、过时 ZIP、已替代实验 EXE/OBJ。
- 服务器清单：`/www/backup/voice-deploy/cleanup-20261019T082531.json`，18 项，合计 **914784175 B**，状态 `planned`。主要是过时差分备份、已结束候选、重复上传暂存。
- 拟保留当前与上一发布回滚材料、最初 Piik 接入前的运行/环境/数据/Nginx 备份、已发布安装包、性能原始记录、原版参考采集 EXE、源码、SDK、依赖、用户安装与设置。所有这些内容目前都还在。
- 服务器私有清理脚本有 `--apply` 删除模式，本轮未调用；继续清理前应再次核对清单与当前服务状态。

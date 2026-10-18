# Piik 融合版：客户端与生产运行

## 用户启动

解压便携 ZIP，双击 `EliYork Voice.exe`，保留同目录 DLL/resources。无需安装 Node/Go、输入启动命令或管理员权限。默认站点 `https://voice.eliyork.com/room/lobby`，可在原频道列表切换频道。首次允许麦克风，选择设备后加入语音。

共享屏幕按钮可选网页共享或 **Piik App 原生屏幕共享 · H.264**。原生组件随客户端隐藏启动，只接受配置站点及本实例 capability；频道成员权限仍由 Node 校验。普通浏览器直接打开同一站点和频道观看，Android 使用同一公网可信 HTTPS，无需安装证书或 Piik App。

关闭客户端会停止本次 App 与采集子进程，不关闭日常浏览器。刷新、断线或服务重启可能结束共享，需要重新加入/开始；不会后台重复恢复共享。便携目录可直接删除，用户配置/日志在 `%APPDATA%\EliYork Voice`。未签名，SmartScreen 可能提示未知发布者；没有自动更新。

## 实机验收

1. Windows 客户端与 Android Edge/Chrome 进入同一频道，确认双向语音、成员、聊天、独立音量、媒体 Dock 和舞台。
2. 客户端原生共享，关闭源声音后先测持续滚动网页/运动内容。分别选择 1920×1080/60、2560×1440/60、3840×2160/60；确认源本身支持相应分辨率。每档至少 60 秒，记录目标与实际值，不能用静止画面证明 FPS。
3. 原生日志 `native/logs/client.log` 中对应 capture-state 应显示 `hardware=true`、`codec=h264`，适配器/编码器应明确是 NVIDIA。MF 硬件编码自动选择可用适配器，当前无强制 NVIDIA 选择器；选择 Intel/AMD 时不能称 NVIDIA。任务管理器对应 GPU 的 Video Encode 负载作为辅助证据。
4. 页面“复制诊断”记录发送/接收实际分辨率、FPS、码率；浏览器 `edge://webrtc-internals` 或 `chrome://webrtc-internals` 对照 H264 codec、framesEncoded/framesDecoded/framesDropped、bytesSent/Received、candidate-pair。按两次采样差值计算 FPS/码率，区分源、编码、网络、解码及播放瓶颈。原生发送在 App/Pion，不在 Electron 的视频 outbound-rtp 中。
5. 加入第二、第三观看者，比较 capture worker/source 和 output group 数量、GPU 编码占用。兼容观看者应复用编码输出；不同分辨率/码率/恢复需求可能派生输出，不能承诺任何条件下都只有一个编码器。P2P 上传随观看人数增加，例如三路 15 Mbps 需要发送者约 45 Mbps 上行。
6. 测试切频道、停止/重启共享、观看者离开后立即重新加入、客户端退出、页面刷新。离开/切频道应立即释放观看容量，意外传输断线的短暂宽限用于重连。频道外观看请求应被拒绝。
7. 单独测试网页共享，确认网页仍能发起，浏览器和客户端观看同一舞台；系统声音是可听实机测试，由用户主动开启。

自动化使用隐藏隔离浏览器、假麦克风、合成图像并静音。测试通过不代表真实 WGC/NVIDIA、手机、跨 NAT 或 4K60 通过。当前原生 H.264，不是 AV1；独立 AV1 实验不变。

## 服务运行边界

- Node `voice-room`：`127.0.0.1:3000`，Nginx 现有 HTTPS/WSS 代理不变。
- Go `voice-piik`：HTTP `127.0.0.1:17887`，内部控制不加入 Nginx 公网路由；内置 STUN 仅监听 loopback UDP 3478。
- 公网连接只经过 Node 校验频道/owner/generation 的 Socket.IO 网关。App 通过站点领取授权，不信任客户端自报的 Piik 房间/token。
- Piik 固定来源与 MIT/依赖声明见 `integrations/piik/source.json`、LICENSE-Piik.txt、分发 notices。无来源 SDK/生成二进制不提交 Git。
- 当前 peerOnly P2P + 公共 STUN，无 TURN、Piik SFU 或多级转发。不占服务器屏幕视频出口；严格 NAT/禁 UDP 的网络可能失败，没有中继兜底。20 Mbps 服务器预算未修改。
- Piik 开启时旧屏幕 SFU 不启动；语音仍为原 PeerJS，聊天/成员仍由原 Node 管理。Go 崩溃不应关闭 Node，`/healthz` 保持 Node 存活并报告 `mediaReady=false`。
- PM2 监控两个进程并自动重启；Go `GOMEMLIMIT=64MiB` 是软目标，`max_memory_restart=120M` 是重启阈值，不是硬内存限制。

## 构建与部署

先 `npm test`、三个 `test:piik:*`、`npm run test:desktop`。桌面 `desktop/windows` 中 `npm ci`、`npm run package`；需固定 Electron 下载运行库、已构建 Piik App/helper/notices。上游原生使用静态 MSVC CRT，运行机无需编译工具，需支持 WGC 的 Windows 10/11 x64 和可用的 H.264 硬件驱动。

服务用 Linux amd64 Go 交叉编译产物（CGO_ENABLED=0），再 `npm run package:piik:server`；独立 TAR 位于忽略的 `integrations/piik/.build`。显式运行资源白名单包括 Piik JS/protocol、Go binary 和许可声明，原 `package:release` ZIP 契约保持不变。客户端 ZIP 位于 `release/`，均验证文件清单和每项 SHA256。Git revision/上游版本写入 manifest。

部署工具 `scripts/deploy-piik-server.py` 在授权服务器运行：`backup` → 上传并验证 TAR → `prepare <backup> <archive> <sha256>` → 检查候选结果 → `activate <backup>`。prepare 需要同一备份内放入 `gateway-test.mjs`（本仓库 test-piik-gateway），自动使用真实生产模式 Go 验证权限和清理。候选 Node 只绑定 loopback 17888、隔离聊天数据；候选进程验证后退出。锁文件变化时拒绝复用生产依赖。

备份目录权限 700，包含旧运行文件逐项读回 SHA、原 `.env`、数据快照、Nginx/TLS 配置、PM2 状态和回滚脚本。激活失败会自动回滚；不恢复聊天快照以免抹掉新消息，不覆盖 `.env`。Nginx 不修改、不重载；其他业务不重启。实际版本、备份位置和切换耗时见本次部署记录。

运维命令（SSH 内）：

```sh
export PATH=/www/server/nodejs/v24.15.0/bin:$PATH
pm2 status
pm2 logs voice-room --lines 80 --nostream
pm2 logs voice-piik --lines 80 --nostream
curl -fsS https://voice.eliyork.com/healthz
ss -lntup
# 只停止融合媒体（会中断共享，语音/聊天仍运行）：
pm2 stop voice-piik
# 恢复融合媒体：
pm2 restart voice-piik
# 完全停止本站（会中断本站服务）：
pm2 stop voice-room voice-piik
# 回滚到备份旧版：
sh /www/backup/voice-deploy/<本次备份>/rollback.sh
```

不要公开备份中的环境/PM2/TLS 密钥，也不要分享本机 App capability。原生 App 完整兼容性、真实硬件编码和公网多设备表现留给实机验收后再决定下一阶段。

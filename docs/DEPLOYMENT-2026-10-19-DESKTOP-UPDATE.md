# 2026-10-19：Windows 0.1.1 与前端修复发布记录

## 发布内容

- 桌面功能提交：`3f9a1ad`；最终可分发源码：`3aa674a8fceb4347e7e92cf1c790ae98981b7589`（修复最终 EXE 元数据修改后的摘要生成时机）。未 Push、未合并 main。
- Windows 版本 0.1.1，Electron 44.9.0，electron-updater 6.8.10 / electron-builder 26.17.0，每用户 NSIS。Piik 来源仍 `9925486cec9910c0a76e47208b29b6f39942e096`。
- 线上 backend 仍 `83f7e1379a30ef282f7e895b7b81536ed58c2762`；frontendRevision / desktopVersion 更新为 `3aa674a...` / `0.1.1`，记录在原 voice-build-manifest.json。
- 前端只替换：voice-media-quality-runtime.js、media.css、voice-call-diagnostics.js、copy-link-ui.js。没有改动媒体架构、编码器、共享路由或带宽参数。
- 新增公网 `downloads/windows/latest.yml`、安装包和 blockmap，及本站 Nginx extension/voice-client-downloads.conf（精确文件白名单、GET/HEAD、禁止目录浏览、no-store、256 KiB/s/连接、最多两连接，超限 429）。Nginx -t 成功后仅平滑 reload。
- `.env` 与备份逐字节相同。没有更改 PM2 配置、密钥、账号、系统服务、SSH 配置或其他站点。备份、暂存及部署工具均留在下述备份目录中。Node/Go 与 friend-footprints 未重启。

## 下载与本地成果

在线安装包：
https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.1-x64.exe

本地安装包：
`desktop/windows/.build/EliYork-Voice-0.1.1-20261019T010623018Z-win-x64/EliYork-Voice-Setup-0.1.1-x64.exe`

安装包大小 `150957156` 字节，SHA256：
`0640550eb0ce82993554f9ff191a1396776cc61a3079c1ba9b40008c29c0486e`

本地 ZIP（内含安装包，不是旧式便携解压目录）：
`release/EliYork-Voice-0.1.1-20261019T010623018Z-win-x64.zip`

ZIP SHA256：
`4a9fe893c27d84ca1541b07518a847fd4dab70db73811258ef1d9f17d05ade4b`

发布包引用最终源码 revision，trackedChanges=false。ZIP 内文件集合和逐项 SHA256 校验通过；安装程序内对应 win-unpacked 运行文件摘要检查通过。旧 ZIP、旧构建及用户解压运行的 0.1.0 目录均保留，没有安装/停止用户当前客户端。

## 已验证

- `npm test`：429/429；相关 ESLint、Python 语法和 git diff --check 通过。
- 源码及最终打包 EXE 隐藏、隔离、静音 smoke：原频道启动、沙箱/无 Node 暴露、假麦克风、自己的 frame 采集、App discovery、退出清理。
- 原页面复制诊断实际写入 Windows 系统剪贴板并读回 JSON；网页读取剪贴板被拒绝。测试后恢复先前内容；测试不会输出先前剪贴板内容。
- 220px 合成共享瓦片可完整显示“播放 4K · 60fps”，无数值截断；FPS 采样算法未更改。
- 真实 electron-updater + 隔离合成 HTTP feed：静默检查不下载/弹窗、手动下载、SHA512、稍后不安装、先清理后请求安装、无新版、损坏摘要拒绝、HTTP 故障。测试没有执行安装器。
- 从本机使用真实库请求生产 HTTPS feed：模拟当前 0.1.0 检测到 0.1.1，当前 0.1.1 返回无新版；均未下载安装。旧 0.1.0 本身没有此更新代码，所以仍需手动安装一次。
- 公网四个前端资源 SHA256 与计划一致；安装包 HTTP Range 206、no-store、非法下载路径 404、WSS Engine.IO 握手、healthz ok/mediaReady=true。
- `npm audit --omit=dev --prefix desktop/windows`：0；完整构建依赖审计有 8 moderate（见 DESKTOP-UPDATES.md），没有将其称为所有依赖无风险。

未验证：实际用户安装/覆盖更新及卸载、真实 Android/多人/NVIDIA/4K60、更新过程中真实通话体验。所有自动媒体检查静音，没有操控用户鼠标或当前浏览器。没有代码签名证书，SmartScreen 提示仍需用户自行判断。

## 运行快照

发布后观察（单次快照，不是压力测试）：

| PM2 | PID | 监听 | RSS | CPU |
| --- | --- | --- | --- | --- |
| voice-room | 43655 | 127.0.0.1:3000 TCP | 91,557,888 B，约 87 MiB | 1.5% |
| voice-piik | 43641 | 127.0.0.1:17887 TCP / 3478 UDP | 19,783,680 B，约 19 MiB | 0% |
| friend-footprints | 1389 | 未修改 | 61,030,400 B | 0.3% |

961 MiB RAM，available 427 MiB，磁盘此前检查剩余约 11 GB。未新增媒体服务/转码器；下载使用 Nginx。没有执行 Node/Go restart，没有观测到验证请求中断；不能据此声称实机通话零中断。

## 备份、回滚与停止分发

服务器备份：`/www/backup/voice-deploy/client-20261019T010800`（权限 700）。含 before、after、plan.json、snapshot.json、manifest、原 .env/聊天安全快照、nginx-before.txt、pm2-before.json、deploy.py、rollback.sh、result.json。上传、备份和线上文件均核对摘要；备份不公开。

恢复本次前端/下载 feed/Nginx location（不覆盖实时 .env 或聊天、不重启 Node/Go）：

```sh
sh /www/backup/voice-deploy/client-20261019T010800/rollback.sh
```

仅撤回更新分发，保持语音/共享可用：

```sh
mv /www/wwwroot/voice.eliyork.com/downloads/windows/latest.yml /www/backup/voice-deploy/client-20261019T010800/withdrawn-latest.yml
```

已安装版本不自动降级。客户端回退可先退出安装版，使用保留的 0.1.0 便携目录；后续坏版本修复须增加版本号。

本站服务停止命令与完整原融合部署回滚继续见 PIIK-PRODUCTION.md。原先完整备份 `/www/backup/voice-deploy/piik-20261018-180715` 及分辨率热修复备份均未删除。本次回滚入口仅处理 0.1.1 与四个前端修复。

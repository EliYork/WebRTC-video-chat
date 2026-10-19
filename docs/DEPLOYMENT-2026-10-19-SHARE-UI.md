# 2026-10-19 共享界面与控制上线

## 实际版本与范围

- 用户明确授权部署后实施；线上 `https://voice.eliyork.com` 的 backend / frontendRevision 均为 `6b2540b0110188d4eebc3aa8ee53e19f00398a25`。
- 分支 `codex/piik-integration`，未合并 main、未 Push。网页 package 仍 1.0.5；Windows 安装版仍 0.1.1，安装包及在线更新 feed 没有变化。
- Piik 来源仍 MIT 项目 `https://github.com/TNTcraftHIM/Piik`，固定 `9925486cec9910c0a76e47208b29b6f39942e096`。上游源码、服务端 Go 和 Windows 原生二进制没有替换。
- 更新 15 个运行文件及 `voice-build-manifest.json`：Node 版本注入、诊断白名单、共享交互/生命周期、EJS、Dock/dialog 样式、Piik 网页适配 bundle。保留原许可与网页第三方声明。
- 左下角真实紧凑 Dock、居中来源选择器、原生真实缩略图、停止/切换/画质入口及诊断修正上线。没有增加 SFU、转码或竞争的媒体路由。

## 已完成的验证

- 部署前重新运行 `npm test`：435/435；Piik 网页 bundle 类型检查与构建通过；上游 checkout 干净。
- 同一候选的隔离静音验证：浏览器 VP8/Pion、App/nativehost/Pion 合成 H.264、三观看者单采集、切换/改画质/停止/重开/迟到取消清理；语音和聊天回归。11 组尺寸/DPR、22 组语音/共享布局、66 组成员布局及隐藏 Electron smoke 通过。详见 SHARE-UI-ACCEPTANCE.md。
- 上传压缩包文件集合及逐项 SHA256 校验；生产起点与 manifest 匹配，依赖锁 JSON 相同，没有服务器安装依赖或编译。
- 生产候选 Node 在回环 17888 独立运行，使用独立聊天文件；健康、EJS 及构建标识通过，可用内存 389032 KiB。验证后进程已退出，17888 无监听。
- 发布后全部运行文件与 manifest 摘要一致；12 个公网 JS/CSS/bundle 返回 200 且 SHA256 与本地一致；原页面有一套真实 Dock、新弹窗和停止入口。
- HTTPS healthz：ok=true、mediaReady=true、screenProvider=piik、build=6b2540b…；真实 WSS Engine.IO/Socket.IO 握手通过。
- 未加入语音时，伪造频道/hostToken 发布及伪造 shareId 观看均拒绝（voice-owner-missing）；跨频道等完整权限回归由隔离自动测试覆盖，没有在生产创建测试频道或共享。
- `/api/rooms`、`/signal`、`/.env`、`/voice-build-manifest.json` 公网均 404。Nginx -t 通过。

真实 WGC/NVIDIA 硬件编码、Android、持续共享及 4K60 性能仍需用户实机验收；自动检查不证明这些能力达标。

## 服务与实际中断

仅停止并重启本站 Node 一次。停止到本机健康 1.58 秒，到公网健康 2.35 秒；这是探针观察，不是实机通话中断测量。原连接会重连，用户应刷新页面并按需要重新加入语音。

| 服务 | PID | 监听 | RSS / CPU 单次快照 |
| --- | --- | --- | --- |
| voice-room | 50638 | 127.0.0.1:3000 TCP | 125964288 B / 0.2% |
| voice-piik | 43641（未重启） | 127.0.0.1:17887 TCP；127.0.0.1:3478 UDP | 19521536 B / 0% |
| friend-footprints | 1389（未修改或重启） | 原 127.0.0.1:3010 | 64176128 B / 0.2% |

服务器 1 vCPU / 961 MiB RAM；发布前可用内存 408 MiB，发布后 398 MiB；磁盘剩余约 10.3 GiB。没有新增常驻进程；20 Mbps 带宽预算与媒体路径配置保持原值。

## 备份、回滚与变更清单

本次独立私有备份（目录权限 700）：
`/www/backup/voice-deploy/client-ui-20261019T024025`

包含旧/新文件、起点摘要、plan.json、压缩包、PM2 状态、安全快照（完整原运行源码、.env、聊天数据、本站 Nginx/TLS、PM2 dump）、隔离候选、校验结果、deploy.py 和 rollback.sh。安全压缩包 31713160 字节；旧文件备份与原文件逐项摘要相同。旧的发布备份均保留。

SSH 到服务器后可回滚本次更新：

```sh
sh /www/backup/voice-deploy/client-ui-20261019T024025/rollback.sh
```

回滚只恢复这次改变的代码和构建清单，重启 Node 并恢复旧 VOICE_BUILD_ID；不会覆盖实时聊天或 .env，不停止 Go 或其他站点。备份完整性和入口已检查，未在生产演练回滚。

生产变更仅有：创建上述备份/候选目录；替换 15 文件及构建清单；更新本站 PM2 VOICE_BUILD_ID、重启 voice-room、执行 pm2 save。备份及脚本留在私有备份目录。未更改 Nginx/TLS、下载文件、密钥、数据、系统服务、SSH、账号、防火墙、cron 或其他站点。发布后 .env 与聊天文件逐字节等同部署前快照；Nginx/TLS 与备份逐字节相同。

本地只操作融合工作树，保留主工作区与用户解压客户端；未保存 SSH 密码到文件，连接已关闭。自动验证未操作用户鼠标、桌面或当前浏览器，未产生可听媒体测试声音。

## 使用新界面

打开原网址或在 EliYork Voice 按 Ctrl+R；如仍显示旧样式，浏览器可强制刷新。重新加入原频道后检查左下 Dock，点共享选择网页/客户端原生，再选择来源、分辨率和 FPS。共享中用舞台的「更换画面」「画质」「停止共享」，或 Dock 共享按钮/箭头。

来源声音默认关闭。切换原生来源或画质可能短暂冻结；更改声音/共享方式可能受控重建。无需为这次网页更新重新安装客户端。完整实机步骤和能力限制见 SHARE-UI-ACCEPTANCE.md。

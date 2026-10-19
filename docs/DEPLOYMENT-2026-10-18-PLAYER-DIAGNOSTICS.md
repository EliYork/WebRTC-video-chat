# 播放器诊断交互部署记录

- 完成时间：2026-10-18 18:08:13（Asia/Shanghai）。
- 线上地址：https://voice.eliyork.com/room/lobby
- 状态：部署成功；真实设备视觉、媒体交互与网络表现由用户验收。
- 版本仍为 1.0.5；无 commit、Push 或新 Tag。

## 发布包

- 文件：`release/webrtc-video-chat-1.0.5-20261018-180726-836.zip`
- 文件数：114，打包白名单、文件清单及逐项 SHA256 校验通过。
- SHA256：`fb2c0a52cc322a6056a4a68593a528846c1b223985d528c319c7d701c9027e07`
- 来自当前授权工作区；部署前确认线上完整源清单与上一份部署包一致。
- 运行文件差异仅为本次播放器统计、事件视图、菜单和关联视图接口的 11 个前端/共享文件。

## 自动验证

- 部署前 `npm test`：384/384 通过，0 失败、0 跳过。
- 定向 ESLint 与 `git diff --check`：通过。
- 上传包服务端 SHA256、ZIP 清单及完整运行文件清单：匹配。
- Linux Node 对全部候选 JS 执行 `--check`：通过。
- 服务本机 HTTP 及公网 HTTPS：200。
- 公网 HTML 包含三个新模块，完整“复制诊断”入口仍只有一个。
- 所有 10 个变更 JS/CSS 公网内容 SHA256 与包一致；独立本机客户端再次无缓存查询参数复核通过。
- PM2 `voice-room` PID 32790 → 34124，online。
- SFU：UDP/TCP 44444 启动成功，视频上限 22 Mbps、总预算 23 Mbps。
- 未进行浏览器手动验收；上述不代表 SFU 低帧根因已经解决。

## 服务端操作与保留

- 上传发布包、清单和部署脚本到 `/www/backup/voice-deploy/`，保留全部既有包与回滚文件。
- 创建私有备份目录 `/www/backup/voice-deploy/player-diagnostics-20261018-180726-836`，保存旧源码、环境备份及停服时的聊天历史副本。
- 替换现有运行目录中的 `src/` 和内容相同的 `package.json`；只停止/重启 `voice-room`。
- `.env`、依赖、锁文件与聊天历史校验保持一致。`friend-footprints` PID 1389 和运行状态未变。
- 未修改反向代理、TLS、防火墙、账号、系统配置或媒体策略。

## 回滚

```sh
python3 /www/backup/voice-deploy/player-diagnostics-20261018-180726-836/rollback.py
```

回滚脚本会先检查线上仍为本次部署清单，保留回滚前源码，再恢复此前源码并只重启 `voice-room`。不回退聊天数据。

## 用户验收入口

两端强制刷新页面（桌面可 Ctrl+F5），重新加入语音并重开共享。
共享视频右键或标题栏“更多”可打开视频统计、播放事件与远端音量。
具体验收项目见 [播放器诊断实现报告](PLAYER-DIAGNOSTICS-2026-10-18.md)。
完整机器回执见同目录 `DEPLOYMENT-2026-10-18-PLAYER-DIAGNOSTICS.json`。

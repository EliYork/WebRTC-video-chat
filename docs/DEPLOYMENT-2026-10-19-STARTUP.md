# 2026-10-19：启动界面修复上线及本地客户端更新

## 完成情况

- 已将 `src/views/room/index.ejs` 的启动界面修复部署到 https://voice.eliyork.com 。移除正常启动时隐藏整个布局和显示“正在加载布局…”的行为，保留失败重试提示。
- 线上内容构建 `20299230e43a9b7c7a7c7996c22008e6784885ac`，这是工作区运行文件内容摘要，不是 Git 提交；网页 package 仍为 1.0.5。
- 本机安装版从 **0.1.2 升级至 0.1.4**，路径 `C:\Users\EliYork\AppData\Local\Programs\eliyork-voice-desktop\EliYork Voice.exe`。使用已发布、经过摘要校验的 0.1.4 NSIS 包 `/S` 安装，退出码 0，没有重建或增加客户端版本号。
- 安装前客户端及 Piik App 均未运行。保留设置，不自动打开正常窗口；用户下次双击即可加载新网页。没有操作鼠标、当前浏览器或播放测试音。
- 未 Commit、Push、Tag、合并或删除旧备份和构建。

## 验证

- `npm test` **465/465**；本轮 `npm run package:release` 118 项与逐项 SHA256 通过。
- ZIP：`release/webrtc-video-chat-1.0.5-20261019-174352-889.zip`，SHA256 `ebd54814309fd240f5ab7ed12391b4e47e392e21412ee8da03c720760c7fa97c`。
- 修改后的隔离浏览器布局检查通过：24 个视口/缩放组合、72 个成员布局、语音和合成共享回归，0 runtime errors、0 failed resources。
- 隐藏静音窗口模拟主脚本延迟：pending 时布局可见、无加载遮罩；失败时显示刷新重试；ready 时提示隐藏。
- **实际安装路径的 0.1.4 EXE** 隐藏静音 smoke 通过：标题栏、刷新/Ctrl+R 确认、原生 PID 保留、剪贴板、更新设置、合成媒体和退出清理；已安装文件摘要与包内 manifest 一致。
- 线上 HTTPS、网页新构建/提示移除、WSS、未经授权发布/观看拒绝、内部路径 404、源文件摘要和 0.1.4 更新源检查通过。
- 未做真实游戏、手机、多观看者、长时间帧率或听感验收。

## 生产影响

切换前五个语音频道均无人。完整私有备份和隔离候选检查通过后，仅替换 **1 个模板文件**及构建清单，重启本站 Node、更新 build 环境并 PM2 save。停止到本机健康 **1.47 秒**、到公网健康 **2.05 秒**；这是健康探针测量。

Node `voice-room` PID **56090**，127.0.0.1:3000；Piik PID **43641**，127.0.0.1:17887 TCP / 3478 UDP，未重启；其他站点 PID 保持不变。最终 MemAvailable 479404 kB。`.env` 摘要保持一致，实时聊天、密钥、Nginx、下载源、Piik 媒体及服务器策略未修改。

## 备份与回滚

服务器私有备份：`/www/backup/voice-deploy/client-ui-20261019T094426`，含完整代码/env/data/Nginx/TLS/PM2 安全快照、旧文件、候选、摘要及结果。

撤回此次网页修复：

```sh
sh /www/backup/voice-deploy/client-ui-20261019T094426/rollback.sh
```

该命令仅恢复本站旧代码/build 并重启 Node，不回写实时聊天或环境。回滚入口已生成，未在生产执行。

本机安装前配置完整备份：`C:\Users\EliYork\AppData\Local\EliYorkVoiceBackups\20261019T094426\profile`；旧构建信息在同目录 `build-before.json`。本机写入限安装目录、既有 NSIS 卸载信息/快捷方式及此配置备份；隔离测试使用新临时 profile。

如确需本机回退，结束通话并退出托盘客户端后，运行保留的安装包：

```powershell
Start-Process -FilePath 'C:\WebRTC-video-chat\desktop\windows\.build\EliYork-Voice-0.1.2-20261019T041734744Z-win-x64\EliYork-Voice-Setup-0.1.2-x64.exe' -ArgumentList '/S' -WindowStyle Hidden -Wait
```

如设置确有损坏，再在客户端退出后恢复上述 profile 备份；不要覆盖正在使用的 profile。本次未执行回退。

本轮详细自动验证记录位于 `integrations/piik/.build/startup-deploy-20261019/`；敏感服务端快照未下载到仓库。

# Windows 客户端 0.1.1：显示、复制与在线更新

## 用户操作

1. 退出旧 0.1.0 便携客户端，保留旧目录用于回退。
2. 下载 `https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.1-x64.exe`，双击为当前用户安装。不需要管理员权限。未签名，SmartScreen 可能提示未知发布者，不能声称已签名或自动绕过提示。
3. 双击桌面 EliYork Voice。原频道、用户配置、语音、聊天及 Piik 原生 H.264 共享不变。按 Ctrl+R 获取最新网页界面。
4. 菜单 EliYork Voice 显示客户端版本及“检查客户端更新”。启动 15 秒后及每 6 小时静默检查，只改变菜单提示。选择下载才占用网络；下载完选择“退出并更新”或“稍后”。普通关闭不会自动安装。下次打开后可从菜单重新检测缓存更新。
5. 旧便携版没有更新代码，无法靠刷新网页更新 Electron/Piik；本次需要手动安装一次。安装版可从 Windows“已安装的应用”卸载，默认保留 AppData。

## 本次改动

- FPS 回退短标签为“播放”，完整的“播放计数扣除丢帧、不等同于合成器提交”放在悬停说明。数字区域不再限宽或显示省略号；没有改变任何 FPS 计算。
- 写剪贴板使用受限 preload：主进程逐次验证窗口、主 frame、站点来源、文本类型及 8 MiB 上限。不暴露读剪贴板、安装、文件或进程接口给远程网页。浏览器继续使用 navigator.clipboard。
- electron-updater 6.8.10 + electron-builder 26.17.0，生成每用户 NSIS 安装包和标准 latest.yml/blockmap。更新源固定 HTTPS；下载由库校验 SHA512，禁降级、禁预发布、禁 web installer；安装前停止本次 Piik App/采集子进程。没有新增更新常驻服务。
- 当前没有发布者代码签名。更新信任 HTTPS 站点与 feed 中的摘要，摘要不能抵抗更新站点自身失陷，不能声称等同于签名验证。
- Piik 仍固定 `9925486cec9910c0a76e47208b29b6f39942e096`，原生采集/编码/路由核心不变。仍为 H.264，无新增 AV1、TURN、SFU、多级转发。

## 构建与验证

```powershell
npm test
npm run test:desktop
npm ci --prefix desktop/windows
npm run test:updates --prefix desktop/windows
npm run package --prefix desktop/windows
# 用 desktop/windows/.build/latest-build.json 的 unpacked 路径：
node scripts/test-voice-desktop.mjs '<unpacked>/EliYork Voice.exe'
```

需要已构建的 `integrations/piik/.build` 原生组件/许可证，以及 Electron 44.9.0 运行库。若 npm 禁用安装脚本，需先按官方发行包 SHA256 校验并准备 Electron dist。原根目录 `package:release` 白名单和版本不变。

安装包/feed 在唯一的 desktop/windows/.build 目录；release/ ZIP 包含安装包、blockmap、latest.yml、README 与文件 SHA256 清单。ZIP 校验文件集合和逐项摘要；win-unpacked 内 build.json 记录 Git/Piik 版本、工作区是否有跟踪改动及运行文件摘要。不会覆盖旧包或自动发布。

运行依赖许可证随安装包保留，合并在 LICENSES-desktop.txt；lazy-val 1.0.5 的 npm/source 无独立许可文件，保留原 package 元数据声明的 MIT、作者及来源版本，并附标准 MIT 条款。`npm audit --omit=dev --prefix desktop/windows` 为运行依赖审计；构建依赖仍有 8 项 moderate，来自 electron-builder 下载工具的 sprintf-js 链，不进入客户端运行包。没有使用 npm audit fix --force。

自动检查使用隐藏隔离 Electron、假媒体、静音；真实系统剪贴板写入/读回后恢复测试前内容（若期间用户另行复制则不覆盖）。检查原页面“复制诊断”、拒绝网页读取剪贴板、220px 瓦片 FPS 完整显示和原生 App 退出清理。更新测试运行真实库、loopback HTTP、合成下载：静默不下载、显式下载、摘要验证、稍后不安装、清理顺序、无新版、摘要错误及 HTTP 故障。不会安装测试版本，不动用户正在运行的客户端或浏览器。

这些结果不代表真实安装覆盖升级、Android、NVIDIA 编码或 4K60 验收通过。下一次真实版本发布后，需手动验收实际安装升级及配置保留。

## 线上发布与回滚

下载使用 Nginx 独立精确白名单位置，不经过 Node、不开放 Piik 内部接口。每连接 256 KiB/s，最多两个下载连接（约总计 4.2 Mbps）；忙时 429，可稍后重试。复用既有 perserver zone，仅给本站下载 location 设置限制。没有修改语音/SFU带宽参数，下载仍占服务器出口，不能承诺完全无竞争。

`scripts/deploy-desktop-update.py` 在授权服务器上运行：向 `/www/backup/voice-deploy/client-<timestamp>/after` 上传四个前端资源和三个下载文件、plan.json 与 deploy.py → `prepare` → `activate`。prepare 验证生产文件未漂移、上传摘要，备份原文件/manifest/Nginx 配置、环境和聊天快照及 PM2 状态。activate 先发布安装包，最后发布 feed，nginx -t 后平滑 reload；不重启 Node/Go。失败自动回滚，回滚不覆盖实时聊天或 .env。

```sh
python3 /www/backup/voice-deploy/client-<timestamp>/deploy.py rollback /www/backup/voice-deploy/client-<timestamp>
# 或
sh /www/backup/voice-deploy/client-<timestamp>/rollback.sh
```

仅停止更新分发：移走/撤回 latest.yml（不影响语音或 Piik）；恢复时确保安装包/blockmap 已就位再恢复 feed。回滚 feed 不会让已升级客户端自动降级；修复版本须更高版本号，或手动安装保留旧版。实际备份路径、发布 revision 和健康检查结果见部署记录。

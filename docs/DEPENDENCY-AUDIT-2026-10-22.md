# 开发依赖精简与审计（2026-10-22，本地候选）

## 改动

本轮开始时，根项目完整 `npm audit --json` 返回 3 个 high 条目，均来自开发工具链 `nodemon → chokidar → braces`；不是 3 个独立的生产漏洞。`braces <=3.0.3` 的深层模式递归问题仍无修补版本，见 [GitHub 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。

开发命令改为 `node --watch ./src/server.js`，移除 nodemon。Node 的 watch 在 22.0.0 / 20.13.0 起稳定，默认监听入口及导入模块，见 [Node 官方说明](https://nodejs.org/api/cli.html#--watch)。项目文档明确要求 Node 22 或更新版本，与现有 SFU 要求一致。前端静态文件与模板修改后刷新页面，不提供浏览器热更新。

锁文件删除 25 个依赖条目，其中包含仅其他平台使用的可选项；当前 Windows 安装树移除 24 个包。已逐项比较原锁文件：其余包的版本、完整性与元数据均未变化。未使用强制漏洞修复或跨主版本覆盖，没有增加替代开发依赖。

## 验证

- 本机 Node **24.15.0**：按 `package.json` 的实际开发命令启动临时项目，验证初始启动、导入模块改变后的新进程、语法错误报告，以及修复语法后的自动恢复；三个成功运行使用不同 PID。测试结束确认所有测试子进程退出，再删除本次临时目录。未启动用户开发服务或修改真实源码来触发重启。未在 Node 22 上另行运行。
- `npm test`：**535/535 通过，0 失败、0 取消、0 跳过**。
- `npm uninstall --save-dev nodemon --ignore-scripts --no-fund` 完成，安装树审计提示 **0 vulnerabilities**。忽略安装脚本，未重建媒体组件。
- 独立 `npm audit --omit=dev --json`：**0 告警**。根项目全量审计的再次独立查询先遇到 registry 网络超时，随后返回 **HTTP 503 Service Unavailable**，当时未将查询失败视作 0 告警。同日后续 registry 恢复，独立 `npm audit --json` 成功：**0 告警**，检查锁文件 300 个依赖条目，high/moderate/critical 等各级均为 0。

## 范围

这里只检查根目录 `package.json` / `package-lock.json`，不代表桌面客户端及 Piik 等其他依赖清单也无告警。审计数据库结果具有时效性，删除已知受影响依赖链也不等于证明整个项目安全。

所有改动保留在当前脏工作区。未提交、推送、打包、部署、升级版本或操作安装中的客户端；`npm start` 保持原生产入口。服务器、真实 `.env`、生产数据和系统配置未修改。旧审计网络查询由本任务启动，结束前已确认进程及命令再停止；未停止其他 Node 服务。

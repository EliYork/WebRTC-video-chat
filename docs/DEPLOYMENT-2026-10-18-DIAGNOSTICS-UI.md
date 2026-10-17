# 2026-10-18 统一诊断复制入口部署

用户授权部署后，于北京时间 2026-10-18 02:14:17 完成。版本保持 1.0.5，未提交、推送或打标签。

## 范围

仅替换以下 8 个文件，保留此前已上线的 SFU 接收健康诊断：

- `src/views/room/index.ejs`
- `src/views/script.js`
- `src/views/js/layout/page-layout-toolbar-ui.js`
- `src/views/js/voice/voice-call-diagnostics.js`
- `src/views/js/voice/voice-share-diagnostics.js`
- `src/views/styles/layout.css`
- `src/views/styles/responsive.css`
- `src/views/styles/workspace-refinement.css`

页面右上角统一为「复制诊断」，移除共享诊断中的两个复制按钮和麦克风设置中的一个复制按钮。复用现有 `copyCombined()` / `collectCombined()`；保留未响应状态、脱敏、字段白名单、日志限制及文本展示和 JSON 下载兜底。日志管理和频道链接复制保留。

## 包、备份与回滚

- 本地包：`release/webrtc-video-chat-1.0.5-20261018-021128-876.zip`。
- 128 个文件；打包脚本校验白名单、清单和逐项 SHA256。
- ZIP SHA256：`A3EFD495FAB9542C22B41D37B9BF91484FB697E2E69F629A67C448A10CA6E0AD`。
- 服务端包位于 `/www/backup/voice-deploy/`，仅从包中取上述 8 文件，不覆盖全部运行文件或安装依赖。
- 备份、部署回执与回滚脚本：`/www/backup/voice-deploy/diagnostics-ui-20261018-021128-876/`。

回滚命令：

```sh
python3 /www/backup/voice-deploy/diagnostics-ui-20261018-021128-876/rollback.py
```

回滚脚本先检查线上文件是否仍为本次版本，拒绝覆盖后续未知修改；保存当前文件后恢复 8 个旧文件并重启 `voice-room`。不回退配置或聊天记录。脚本语法已检查，未执行生产回滚测试。

## 验证

- 发布前 `npm test`：353/353 通过，0 失败、0 跳过；相关 ESLint、`git diff --check` 通过。
- 部署前检查的 10 个线上文件均与上一份已验证发布包一致；8 个目标文件逐项备份、核验，并按原权限和属主逐文件原子替换。保留部署锁和失败自动恢复路径。
- 仅重启 PM2 `voice-room`，PID 1391 → 8770，状态 online；`friend-footprints` PID 1389、状态及重启次数不变。
- 新启动日志确认 SFU ready，仍使用 UDP/TCP 44444、22 Mbps 视频上限及 23 Mbps 总预算。
- `.env`、聊天记录、服务入口、SFU 服务和预算、诊断 relay、共享白名单、SFU 客户端运行模块、包清单与 mediasoup 依赖清单部署前后 SHA256 一致。
- 本机和公网 `/room/lobby` HTTP 200；公网 HTML 只有一个诊断复制入口，位于 `#main` 外的全局顶栏；旧按钮文字消失，日志管理和频道链接复制仍在。
- 公网 7 个更新后的静态文件及 2 个保留的 SFU/白名单脚本均 HTTP 200，响应 SHA256 与预期一致；服务端 8 个目标文件 SHA256 一致。
- 未进行浏览器手动验收或双端实机测试。HTTP、哈希和自动化结果不代表真实布局、触摸、媒体或听感验收。

完整哈希与检查结果见 [部署回执](DEPLOYMENT-2026-10-18-DIAGNOSTICS-UI.json)。用户刷新页面后检查实际界面与诊断复制。

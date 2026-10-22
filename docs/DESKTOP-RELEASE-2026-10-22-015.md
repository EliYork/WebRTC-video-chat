# Windows 客户端 0.1.5 发布记录（2026-10-22）

## 发布范围

用户授权提交、推送，并将客户端升级为 0.1.5、发布到既有在线更新源。此次客户端包含首屏失败重试、原生共享组件恢复、窗口生命周期及日志容错等累计本地改进；保留现有 Piik 原生采集二进制，不新增自动采集或自动安装。

累计网页、聊天、诊断及服务端改进与其测试一并提交到 Git。此次生产发布仅更新 Windows 安装包、blockmap、`latest.yml` 及桌面发布 manifest；网站运行代码不随安装包上线，网页/服务端功能的既有“仅本地”记录仍适用。独立 `native/windows-share-prototype/` 原型保留在工作区，不加入本次提交。

## 发布前验证

- 默认 `npm test`：750/750 通过，0 失败、0 取消、0 跳过；首次 13.56 秒，提交 0.1.5 后、打包前复跑 12.67 秒。
- `git diff --check` 通过；待提交源码检查未发现常见访问令牌或生产私钥模式。TLS 测试目录内私钥是公开的 localhost 测试 fixture，不用于真实服务，亦不进入安装包或服务器 ZIP。
- 线上更新源核对为 0.1.4，保留该版安装包和更新前清单。0.1.5 不覆盖旧版本同名文件。

## 构建与上线结果

- 源码和版本提交 `ecf83cf`、空行修正 `7e6287c` 已通过普通非强制推送同步到 `origin/master`；此前 17 个本地未推送提交也已同步。远端地址为 `https://github.com/EliYork/WebRTC-video-chat.git`，已核对远端提交与本地一致。首次推送被自动审批拒绝后，用户明确授权累计源码/测试及旧提交推送，再执行成功。
- 桌面安装包版本 **0.1.5**，构建源码提交 `7e6287ce1fb1cd7604dd8840b1c517ec1b38c17e`，`trackedChanges=false`。主项目版本仍为 1.0.5。后续文档提交不改变此安装包的源码归属。
- 安装包 `EliYork-Voice-Setup-0.1.5-x64.exe`，**150987321 bytes**；SHA256：`c8797b42f91cf50339a62e1565c2b7cf4c73f312bd8561d04b0a780d6b5ceb59`。
- 发布 ZIP：`release/EliYork-Voice-0.1.5-20261022T123450638Z-win-x64.zip`；SHA256：`83f8c28d3865ae3d1e93dde61efad8859edcd64d81155cf855a845dcce34bf71`。只保留本地，不提交 Git。构建命令 `npm run package --prefix desktop/windows`；ZIP 清单及逐文件 SHA256 验证通过。
- 从实际 NSIS EXE 解出 359 个文件，对 358 个 runtime 文件逐项核对构建 manifest；唯一附加项为 `build.json`。包内本地模块与当前源码一致，原生 `piik-app.exe` / `piik-capture.exe` 与 0.1.4 字节相同。
- 从解出的实际文件加载启动、首屏恢复、面板和 updater 模块，在独立临时 profile 的隐藏静音 Electron 中验证通过；启动离线/超时恢复复用原窗口，真实 updater 本机合成文件验证 SHA512、错误拒绝、延后安装和退出清理，未执行安装。最初两项检查因临时脚本相对路径和依赖定位错误失败，修正验证脚本后通过，未因此修改产品代码。
- 上传使用旧安装包的已校验区块重建新文件，仅传输 **524156 bytes** 差异数据；服务器重建后的完整 SHA256 与本地一致。这是本次运维上传优化，不是修改客户端更新协议。
- 安装包与 blockmap 先发布，`latest.yml` 最后原子替换，线上更新源已为 **0.1.5**；公网三个文件的 Range 206 与前 64 bytes 核对通过。
- 使用真实 `NsisUpdater` / Electron HTTP 执行器读取线上 feed：模拟 0.1.1、0.1.4 均报告 0.1.5 可更新，模拟 0.1.5 报告已是最新版；禁用并阻止下载、退出与安装。该验证没有修改用户安装中的客户端。

公网完整安装包 **150987321 bytes** 已通过 Windows curl 下载，整包 SHA256 与上述值一致，SHA512 与线上 `latest.yml` 一致；完整 blockmap 也与本地相同。结构化结果保存在 `integrations/piik/.build/release-015/public-result.json`。

首次 Node 完整读取在 360 秒后超时，另一次 1 MiB Range 在 30 秒后超时。同机 curl 中段 1 MiB 请求 206、耗时 1.80 秒且字节相同；完整 GET 在 300 秒时收到 148307654 bytes，随后使用 `--continue-at -` 通过 HTTP 206 在 4.22 秒内补齐剩余 2679667 bytes，最后对完整文件进行两种摘要验证。没有把超时隐藏为一次无中断下载，也未将客户端差异归因为已证实的服务器配置故障；未改动网络设置。

## 生产写入、备份与回滚

- 只新增 `downloads/windows/EliYork-Voice-Setup-0.1.5-x64.exe` 和 `.blockmap`，替换 `downloads/windows/latest.yml`，更新 `voice-build-manifest.json` 中桌面版本、桌面 revision、下载文件摘要和桌面发布记录；保留原网页 build / frontend revision。
- 私有发布目录 `/www/backup/voice-deploy/client-20261022T123900`，包含发布计划、差异数据、重建安装包、旧 feed/manifest、安全摘要、发布结果及回滚脚本。备份和旧 0.1.4 安装包均保留，未做清理。
- 切换前后核对 `.env`、聊天数据、完整 `src/` 目录及下载 Nginx 配置摘要均未变化；全部 PM2 进程 PID 与 restart count 不变。未重启 Node、Go 或其他站点，未 reload Nginx，未修改下载限速/并发、SSH、cron、TLS、防火墙或系统配置。
- 公网 `/healthz` 为 200、`ok=true`、`mediaReady=true`，生产网页 build 继续为 `5be534293c1bbd22a2f5bf9ee8d076fe3f8ae2f9`，不是本次 Git 提交；不据此声称累计网页/服务端改进已经部署。

紧急撤回在线更新源时，在服务器执行：

```sh
sh /www/backup/voice-deploy/client-20261022T123900/rollback.sh
```

该操作恢复旧 feed 与 manifest，保留不可变安装包，不重启服务、不恢复旧聊天数据。已安装新版不会自动降级；回滚入口已生成，本轮未执行生产回滚。

## 用户更新

在客户端「设置 → 关于与更新 → 检查更新」中下载并确认安装，或直接下载 [0.1.5 安装包](https://voice.eliyork.com/downloads/windows/EliYork-Voice-Setup-0.1.5-x64.exe)。先结束通话与共享。0.1.0 便携版需要手动下载安装；不删除 AppData 配置。安装包仍未代码签名，Windows 可能显示未知发布者。

未自动安装或重启用户本机客户端，不操作活动窗口、系统剪贴板或真实媒体。真实设备、通话听感和长期共享质量仍待用户验收。

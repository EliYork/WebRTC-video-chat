# 2026-10-17 媒体恢复与共享选择偏好上线

用户结束共享后明确授权上线。北京时间03:17:15完成4个前端文件的替换，03:19进行公网及Edge 155页面加载验证。版本号保持1.0.5；本次工作区未提交、推送或打Git标签。

## 已上线的内容

- SFU带宽预算变化与观看者路由变化分开处理，预算变化直接应用发送参数，避免触发重复媒体更新。
- 相同轨道对象不重复调用replaceTrack；真实切换与SFU/P2P视频槽位恢复保持有效。
- 发现P2P的连接或ICE状态为failed/closed时，拒绝仅替换轨道，由既有媒体更新流程为该发送方向创建新offer；临时disconnected继续保留恢复宽限。
- 共享选择请求优先窗口页签与音频共享：`displaySurface=window`、`audioSelection=preferred`。是否采纳仍由浏览器决定，用户仍需选择来源并确认。

只替换以下文件：

| 文件 | 部署后SHA256 |
| --- | --- |
| src/views/js/voice/voice-media-lifecycle.js | `EB83F3C3EE89012E5BCB28CCAF75539A8F9F7AECCD244C9C9FB366A160E34CD4` |
| src/views/js/voice/voice-peer-registry.js | `2CA7BAEB46BD79CC70B79602B4B4F41D16F7186A9BAFB37FFD641E0265C446BE` |
| src/views/js/voice/voice-screen-sfu-runtime.js | `2B848EDA1DB41EBF267655F21E293273E3086800DC79B01C914895356341173F` |
| src/views/script.js | `462A2E31EC327DF60FC6EA4E9446887D104C0D1124668A49DA23F1265AA7935D` |

没有修改SFU服务端、码率预算、健康阈值、冷却、分辨率或帧率目标，没有更新依赖、Nginx或防火墙。配置、聊天数据和mediasoup依赖清单部署前后校验值一致。

## 发布与校验

- 发布前 `npm test`：331/331通过，0失败、0跳过。涉及源码及测试文件ESLint通过。
- 项目命令 `npm run package:release` 生成并逐项验证128个白名单文件及SHA256。
- 本地候选ZIP：[webrtc-video-chat-1.0.5-20261017-030639-686.zip](../release/webrtc-video-chat-1.0.5-20261017-030639-686.zip)，3841841字节。
- ZIP SHA256：`8960D40FCC0BBC113CB8D836EC1EB57B77A6AEF25DFA02F6BBDF5AF82DD37F43`。上传后再次验证整体SHA256、ZIP条目名单和版本；从该ZIP只应用上表4个JS，不把整个128文件包当作全量同步。
- 线上4个目标文件与本地修改前基线一致；主脚本差别仅为CRLF换行。部署前和替换前均再次检查目标文件旧SHA256，防止覆盖并行改动。
- 旧文件逐项复制并核验后，在目标目录写临时文件、校验、保留属主与权限，逐文件原子替换。异常路径准备自动恢复已替换文件；此次部署成功，没有执行回滚。
- 生产HTTP `/room/lobby` 返回200。4个公网JS均200，返回字节SHA256与ZIP中的新文件一致。
- 公网Edge 155全新浏览器上下文实际加载相同的4份新文件，页面 `roomBoot=ready`、无pageerror；实际运行约束构造函数返回窗口和音频优先偏好。未加入语音或调用真实屏幕/麦克风采集。
- `voice-room` PID仍523169、mediasoup worker仍523181、其他服务PID不变，未重启进程。部署前磁盘剩余约789 MiB，通过128 MiB加发布操作空间的保留门槛。

这次验证证明部署的文件与页面启动正确，不证明真实双端画面、原生选择器音频开关、60fps或公网丢包问题已解决。SFU下游丢包原因仍未定位。

## 生效与回滚

已打开的页面保留旧代码。下次使用前，双方用Ctrl+F5刷新、重新加入语音，共享者重新选择共享窗口。加载新版后，失败连接重建会复用仍存活的采集轨道，不要求为了该次重连重新选择窗口；网络不可用时仍可能失败。

服务器备份与完整回执：`/www/backup/voice-deploy/media-20261017-030639-686/`。

回滚命令：

```sh
python3 /www/backup/voice-deploy/media-20261017-030639-686/rollback.py
```

该回滚只恢复本次4个前端文件，不重启服务、不回退配置或聊天数据。脚本先拒绝覆盖后续其他修改，并保留回滚前的文件。语法已检查，未为测试实际回滚。

服务器同时保留本次上传ZIP、部署脚本和发布前摘要；旧发布包与备份没有删除。新本地修复文档、此次部署记录和所有诊断原始数据均保留。

机器可读验证摘要：[DEPLOYMENT-2026-10-17-MEDIA.json](DEPLOYMENT-2026-10-17-MEDIA.json)。

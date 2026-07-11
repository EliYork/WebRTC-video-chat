# Architecture Repair Backlog

| 项目                                             | 状态                         | 备注                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket.IO 浏览/聊天 room 生命周期                | 已完成                       | view/chat 底层 room 已与 voice 隔离，切换、清理与事件隔离测试通过。                                                                                        |
| 每对参与者的双向重复 PeerJS media call           | 已完成并浏览器验收通过       | 每方向最多一条职责明确的单向发送 call；双方后增媒体、双向共享、screen audio 与同方向去重均已通过真实 Edge 验收。                                           |
| 布局恢复克隆 DOM 导致缓存引用失效                | 已完成                       | 原业务节点 identity 恢复与六项行为测试均已通过。                                                                                                           |
| 实时协议信任客户端 roomId / peerId               | 已完成                       | 全事件扫描完成；view/chat 使用已记录 owner，voice/presence/screen-share 使用 socket voice owner 与 session generation，伪造 roomId/peerId 行为测试已通过。 |
| Socket.IO `MaxListenersExceededWarning`          | 代码修复完成，待线上日志复测 | 每个 socket 固定一个 disconnecting 与一个 disconnect listener；集中 cleanup、socket 级 guard、异常隔离及 20-socket/重复操作测试已通过。                    |
| Socket.IO WebSocket `Invalid frame header`       | 未处理                       | 业务代码已兼容 polling fallback，但线上 WebSocket frame/Nginx/宝塔代理问题仍保留独立诊断，本轮未修改反代。                                                 |
| 生产依赖的 high / moderate 漏洞                  | 未开始                       | 保留依赖升级与回归验证任务。                                                                                                                               |
| 核心实时协议行为测试不足                         | 部分完成                     | strict SDP、registry、session/retry/media/device/server rejoin 行为测试已覆盖；仍没有真实浏览器自动 E2E。                                                  |
| 远端 call / stream / tile 缺少统一生命周期 owner | 已完成                       | registry 分别持有 incoming/outgoing call generation、remote stream、tile、listener、方向替换与幂等 cleanup；行为测试已覆盖。                               |
| 屏幕共享状态已广播但远端没有实际 screen video    | 已完成并浏览器验收通过       | 双向 screen video、system audio、RTP、停止共享后的 placeholder/camera 恢复与最后一帧清理均保持已完成状态。                                                 |
| 页面刷新时本地 screen capture 未立即停止         | 已完成并浏览器验收通过       | 非 BFCache `pagehide` 会停止 screen/camera/mic track，并销毁 Peer、registry 和 Socket transport；真实刷新后共享标志立即消失。                              |
| 页面刷新后旧 voice participant 清理过慢          | 已完成并浏览器验收通过       | 页面 teardown 主动发送 leave 并调用 `socket.disconnect()`；真实刷新后旧参与者已能快速从远端移除。                                                          |
| 不可达的旧 ROOM / CHAT 布局组件体系              | 未开始                       | 待确认迁移兼容需求后收敛。                                                                                                                                 |
| 两套 popover controller 并存                     | 未开始                       | 待选择唯一 owner。                                                                                                                                         |
| 完整媒体权限与设备错误恢复                       | 代码完成，待浏览器复测       | mic/camera/screen 操作 token、错误分类、独立 UI、devicechange/default fallback、输出 sink 回退与 track ended 单次恢复已有行为测试。                        |
| 真实网络断开与 reconnect                         | 代码完成，待浏览器复测       | desired/actual 状态、client epoch、Socket owner restore、Peer reconnect/recreate、bounded backoff、presence/target reconcile 已完成；尚未做真实断网验收。  |
| CSS 重复规则、`!important` 和 z-index 层级未统一 | 未开始                       | 不进行全量视觉重写。                                                                                                                                       |
| 第三方 CDN、自托管资源和安全 header 基线         | 未开始                       | 公开部署前处理。                                                                                                                                           |
| 文档、格式化门禁和死页面漂移                     | 未开始                       | 作为独立 housekeeping 任务。                                                                                                                               |

- 屏幕共享右上角显示实际接收分辨率和帧率：代码完成，待浏览器复测。实现仅显示 screen-sharing 远端 live video 的观看者实际接收质量；自动化覆盖标准/非标准分辨率、fps 字段/差值/平滑、camera/audio-only/ended/cleanup/call replacement/多人独立 timer/异常降级。

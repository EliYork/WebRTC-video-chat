# Architecture Repair Backlog

| 项目                                             | 状态     | 备注                                                                                                                              |
| ------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Socket.IO 浏览/聊天 room 生命周期                | 已完成   | view/chat 底层 room 已与 voice 隔离，切换、清理与事件隔离测试通过。                                                               |
| 每对参与者的双向重复 PeerJS media call           | 已完成   | 新加入者为唯一发起方，最小 call gate 与协议行为测试已通过。                                                                       |
| 布局恢复克隆 DOM 导致缓存引用失效                | 已完成   | 原业务节点 identity 恢复与六项行为测试均已通过。                                                                                  |
| 实时协议信任客户端 roomId / peerId               | 部分完成 | view/chat、voice join/presence/refresh，以及 voice leave/voicePeerLeft/disconnect 已使用服务端 owner；screen-share 等事件仍待修。 |
| 生产依赖的 high / moderate 漏洞                  | 未开始   | 保留依赖升级与回归验证任务。                                                                                                      |
| 核心实时协议行为测试不足                         | 部分完成 | 已覆盖 view/chat room、唯一 voice call，以及 peer/call/stream/tile 生命周期；真实浏览器 WebRTC、reconnect 和权限错误仍缺失。      |
| 远端 call / stream / tile 缺少统一生命周期 owner | 已完成   | registry 统一持有 call identity、remote stream、tile、listener、replacement 与幂等 cleanup；行为测试已覆盖。                      |
| 不可达的旧 ROOM / CHAT 布局组件体系              | 未开始   | 待确认迁移兼容需求后收敛。                                                                                                        |
| 两套 popover controller 并存                     | 未开始   | 待选择唯一 owner。                                                                                                                |
| 屏幕共享或媒体权限拒绝缺少受控错误路径           | 未开始   | 需要统一错误提示和状态复位。                                                                                                      |
| CSS 重复规则、`!important` 和 z-index 层级未统一 | 未开始   | 不进行全量视觉重写。                                                                                                              |
| 第三方 CDN、自托管资源和安全 header 基线         | 未开始   | 公开部署前处理。                                                                                                                  |
| 文档、格式化门禁和死页面漂移                     | 未开始   | 作为独立 housekeeping 任务。                                                                                                      |

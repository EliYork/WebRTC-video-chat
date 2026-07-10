# Architecture Repair Backlog

| 项目                                             | 状态                       | 备注                                                                                                                                                       |
| ------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket.IO 浏览/聊天 room 生命周期                | 已完成                     | view/chat 底层 room 已与 voice 隔离，切换、清理与事件隔离测试通过。                                                                                        |
| 每对参与者的双向重复 PeerJS media call           | 模型已修正，待浏览器复测   | 原修复消除了意外重复 call，但固定 caller 无法协商 answerer 后增媒体。现改为每方向最多一条职责明确的单向发送 call；同方向重复仍禁止。                       |
| 布局恢复克隆 DOM 导致缓存引用失效                | 已完成                     | 原业务节点 identity 恢复与六项行为测试均已通过。                                                                                                           |
| 实时协议信任客户端 roomId / peerId               | 已完成                     | 全事件扫描完成；view/chat 使用已记录 owner，voice/presence/screen-share 使用 socket voice owner 与 session generation，伪造 roomId/peerId 行为测试已通过。 |
| 生产依赖的 high / moderate 漏洞                  | 未开始                     | 保留依赖升级与回归验证任务。                                                                                                                               |
| 核心实时协议行为测试不足                         | 部分完成                   | 新增严格 fake SDP/transceiver 层，已模拟 offer m-line 约束并覆盖 2/3 人媒体矩阵；此前 fake `answer(stream)` 可接受任意媒体的缺口已修复，真实浏览器仍缺失。 |
| 远端 call / stream / tile 缺少统一生命周期 owner | 已完成                     | registry 分别持有 incoming/outgoing call generation、remote stream、tile、listener、方向替换与幂等 cleanup；行为测试已覆盖。                               |
| 屏幕共享状态已广播但远端没有实际 screen video    | 协商已复测通过，展示修复中 | 双向 screen video、system audio 与 RTP 已由 Edge 验证；停止共享后的最后一帧来自无 live video 时未显式重置 decoder/placeholder，代码已修复并待 Edge 复测。  |
| 页面刷新时本地 screen capture 未立即停止         | 代码修复完成，待浏览器复测 | 非 BFCache `pagehide` 会停止 screen/camera/mic track，并销毁 Peer、registry 和 Socket transport；track 最多停止一次。                                      |
| 页面刷新后旧 voice participant 清理过慢          | 代码修复完成，待浏览器复测 | 页面 teardown 主动发送 leave 并调用 `socket.disconnect()`，服务端 disconnect cleanup 不再只依赖 ping timeout。                                             |
| 不可达的旧 ROOM / CHAT 布局组件体系              | 未开始                     | 待确认迁移兼容需求后收敛。                                                                                                                                 |
| 两套 popover controller 并存                     | 未开始                     | 待选择唯一 owner。                                                                                                                                         |
| 屏幕共享或媒体权限拒绝缺少受控错误路径           | 部分完成                   | 已捕获 screen picker 的 `NotAllowedError` / `AbortError` 并复位 pending；摄像头、设备切换和完整用户提示仍待处理。                                          |
| CSS 重复规则、`!important` 和 z-index 层级未统一 | 未开始                     | 不进行全量视觉重写。                                                                                                                                       |
| 第三方 CDN、自托管资源和安全 header 基线         | 未开始                     | 公开部署前处理。                                                                                                                                           |
| 文档、格式化门禁和死页面漂移                     | 未开始                     | 作为独立 housekeeping 任务。                                                                                                                               |

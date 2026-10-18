# EliYork Voice · Windows x64

解压 ZIP 到可写目录，双击 **EliYork Voice.exe**。客户端打开独立窗口，默认连接 **https://voice.eliyork.com/room/lobby**，与普通浏览器共享频道、成员、聊天与语音。

不需要 Node、Go、PowerShell 或管理员安装。请保留整个目录及 resources，不要只复制 EXE。客户端内置 Electron/Chromium 与 Piik App/WGC 原生组件；网页无 Node 权限。麦克风/摄像头首次使用需授权，设备仍通过原频道界面选择。

## 原生共享

加入原语音频道 → 共享屏幕 → “Piik App 原生屏幕共享 · H.264” → 显示器/窗口 → 明确分辨率/FPS → 开始。组件会自动启动，无需打开 Piik 独立房间。首次驱动探测可能需等待数秒，再点刷新来源。共享源声音默认关闭；勾选后可能把通话声音一起回送，建议耳机。

选择“网页屏幕共享”时由客户端弹出画面选择窗口；勾选系统声音会捕获整个系统声音，而非单一窗口音频。取消不采集。真实麦克风、设备切换、系统声音和 4K60 体验仍需实机验收，自动化通过不代表画质/FPS 保证。

原生固定 H.264 硬件路径，自动选择首个可用硬件适配器；不保证一定选择 NVIDIA。当前不是原生 AV1。兼容观看者复用输出，不同网络需求可派生多个输出；每路最多三个直连观看者。P2P/STUN 对对称 NAT 或禁 UDP 网络没有全覆盖保证，TURN/SFU/多级转发未接入。

## 退出、诊断与更新

关闭窗口或菜单退出：先结束媒体，再释放本次 App/采集进程。无需关闭日常浏览器。原生组件崩溃时语音聊天仍可用，重启客户端后重新开始原生共享；刷新/掉线后不自动恢复已结束采集。

F12 打开诊断工具。页面“复制诊断”提供摘要；原生日志位于 `%APPDATA%\EliYork Voice\native\logs\client.log`，客户端生命周期日志在同目录上级 `desktop.log`。日志可含故障/网络信息，分享前核对。不要分享 App 配置/本机 capability。

查看 NVIDIA 硬编：对应共享的 capture-state 应有 hardware=true、codec=h264、NVIDIA adapterName/encoderName，并与接收 video/H264、GPU Video Encode 负载对照；不能仅凭显卡存在或 H.264 文案确认。详细测试步骤见项目 `integrations/piik/ACCEPTANCE.md`。

便携版升级：退出旧客户端，解压新 ZIP 到新目录再双击；用户配置保存在 AppData。没有自动更新或后台服务。删除程序目录即可移除便携版，用户设置可自行保留；删除 AppData 会清除本客户端的浏览器权限/存储及日志。

本构建未使用代码签名证书，Windows SmartScreen 可能显示未知发布者/拦截。核对提供方和 ZIP SHA256 后自行决定是否运行；不会自动绕过 SmartScreen。

## 来源和许可证

Piik 上游固定版本见 `build.json`，原 MIT 声明在 `resources/native/LICENSE-Piik.txt`，Go/Pion/WebRTC 等声明在 `resources/native/THIRD-PARTY-NOTICES.txt`。Electron LICENSE、LICENSES.chromium.html 随运行库保留。EliYork 项目 LICENSE 同包保留，不把第三方许可笼统归为项目 ISC。

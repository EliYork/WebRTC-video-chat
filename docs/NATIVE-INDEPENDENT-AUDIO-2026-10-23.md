# Windows 独立共享音频与发送端编码状态

日期：2026-10-23。**源码实现与自动化验证记录，尚未实机验收、部署或发布安装包；源码提交与推送状态以 Git 记录为准。**

## 基线与范围

- 开始时为 `master` / `e37f87c`，未提交项为用户的 `AGENTS.md` 和未跟踪的 `native/`；两者保留，未纳入本次修改。
- Piik 固定上游 `9925486cec9910c0a76e47208b29b6f39942e096`。上游 tracked 文件保持干净；通过既有构建 overlay 扩展，不复制或重写 Pion、媒体选路和频道架构。
- 未升级项目或桌面版本，未改线上配置、服务器、更新源、账号、系统音频设置或用户数据。
- 既有窗口/系统声音、硬件 H.264、音频 Opus 源、共享生命周期和独立麦克风链路继续复用。

## 已实现

| 音频选项 | 行为 |
| --- | --- |
| 不共享声音（原生默认） | 不创建共享音频轨；语音麦克风保持独立 |
| 系统声音 | 采集系统音频，排除启动 Go App 的本 Electron 客户端进程树；无法确认排除身份时拒绝开启 |
| 指定应用声音 | 单独选择 PID 与创建时间，采集该进程及其子进程，与画面源完全独立 |
| 随画面声音（旧版兼容） | 仅旧客户端显示原有能力；窗口进程声音或整屏声音，明确提示可能包含通话 |

可以选择屏幕 A / 窗口 A 的画面与应用 B 的声音。音源改变需要重启共享，UI 会提前说明短暂中断；带独立声音时改变画面也采用重启。无声共享仍支持既有画面原地替换，画质参数保留原地更新。

应用列表包含当前 Windows 登录会话中可访问的无窗口进程，不依赖共享窗口列表，也不要求应用已经播放声音。最多 1024 项，优先显示拥有音频会话的进程；提供 exe 名称、PID、会话活跃/空闲标记，以及可取得的应用图标。全路径和命令行不发往页面。音频会话活跃不代表一定存在可听声音。

### 身份与失败处理

- 接受开始请求前重新枚举并匹配 `{pid, creationTime}`；原生采集再以同一进程 handle 检查创建时间与进程退出状态。
- 应用重启后必须刷新重选，不按名称自动跟随，不将旧 PID 切换到新进程。
- 无声应用持续输出静音，不设“没有声音就是失败”的超时。
- 捕获失败或目标退出后显示明确错误并停止共享，不自动改成全系统声音。运行中由状态轮询发现，正常轮询间隔为 1.5 秒；后台页面节流可能延后提示。
- 共享音频不启用上游 microphone mixing。现有麦克风语音仍由原平台语音链路管理。
- 停止、切频道、断线、取消、迟到的连接/开始/预览结果均由原有 owner 清理；准备阶段的旧来源结果不能覆盖新共享。

### 编码状态

共享高级设置增加发送端的编码格式、编码方式、实际 MFT 名称、GPU 适配器及初始化/运行状态。状态取自当前采集 generation 的原生 `starting` 与 `active` 反馈。

只有 `active + h264 + hardwareOnly` 的输出证据才显示“GPU 硬件编码”；枚举出 GPU、选中了硬件设置或仅启动进程均不算确认。无法确定时显示“未确认”。此处是**发送端编码**，不是观看端硬件解码信息。

保留 hardware-only H.264，不添加软件回退或第二套编码器。固定错误分支区分硬件不可用、编码失败、媒体采集失败、音源身份失效、音频捕获失败及未确认原因；不把驱动原始文本或本地路径透传到网页。

## 实际 API 与上游接口

### Windows

- `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK)`，通过 `AUDIOCLIENT_ACTIVATION_PARAMS` 的 `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` / `EXCLUDE_TARGET_PROCESS_TREE` 采集/排除进程树。复用 Piik `native/capture/windows/process_audio.cpp` 的 `CaptureProcessAudio(pid, expected_creation_time, exclude, ...)`。
- 进程枚举：`CreateToolhelp32Snapshot`、`Process32FirstW` / `Process32NextW`、`ProcessIdToSessionId`。
- 身份绑定：`OpenProcess`、`GetProcessTimes`、`QueryFullProcessImageNameW`、`WaitForSingleObject`。
- 元数据标记：`IMMDeviceEnumerator::EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)`、`IAudioSessionManager2::GetSessionEnumerator`、`IAudioSessionControl2::GetProcessId`、`IAudioSessionControl::GetState`。不激活音频流、不读取其他应用 PCM 来生成列表。
- 图标：`SHGetFileInfoW` 与本地 GDI 转换，受输出大小和图标预算限制。
- 视频仍复用 Piik 的 WGC / D3D11 / Media Foundation H.264 MFT；读取既有 adapterName、encoderName、hardwareOnly、codec 和 active 状态。

微软的 [Application Loopback 示例](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)说明该进程树能力需要 Windows build 20348 或更新版本，目标没有渲染流时返回静音。[GetProcessId 文档](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid)说明跨进程音频会话可能只返回最初创建会话的 PID，因此会话枚举不能证明浏览器单标签隔离。

### Piik 控制扩展

继续使用 `NativeClient` 的受 Origin、随机 instance capability 和 v10 hello 保护的 control 通路，以及 `nativehost.Start` / `nativecapture.StartAudio` / `NativeMediaBridge`。增加能力检测字段 `independentAudio` 和三个局部命令：

- `platform-audio-sources`：获取受限应用元数据和 systemSafe。
- `platform-start-share`：独立 audioMode / audioTarget；不允许 microphone mixing、VP8 或页面指定系统排除目标。
- `platform-share-status`：查询同一 shareId 的编码和音频状态。

扩展命令使用严格 schema。原生采集 helper 必须实际声明新能力，旧 helper 默认不支持；旧客户端继续使用原命令，不携带扩展字段。新增可选失败 reason 仅用于扩展共享。Go / 浏览器 / C++ helper 应使用同一次构建的版本，不能任意混搭新旧二进制。

## 限制与未实现能力

- 不实现音源热切换，使用重启共享策略。
- 不提供浏览器标签级、任意进程集合或跨程序完整隔离。浏览器选定进程的树可能涵盖多个标签，也可能不涵盖由其他进程渲染的声音。
- 应用名称目前是 exe 名，不是保证可得的产品显示名；部分图标、受保护/更高权限进程、其他登录会话和超出列表容量的进程可能不可见。
- 系统声音只排除本 Electron 客户端树；其他浏览器或其他语音软件仍可能进入共享音频。独立运行、无法确认 Electron 父进程的 Go App 禁用此模式。
- 网页模式继续使用浏览器选择器与其实际音频能力，不显示原生应用音频选择器。
- 未验证真实音质、实际回声、硬件编码性能、驱动兼容性、多人设备体验及用户主观 UI 手感。

## 修改文件分组

- 原生应用元数据与 Go 控制/生命周期：`scripts/piik-share/audio-applications.cpp`，`scripts/piik-share/nativecapture/platform_{audio,failure,host_windows,host_other}.go`，`scripts/piik-share/nativehost/platform_share.go`，`scripts/piik-share/nativecontrol/platform_share.go`。
- 构建：`scripts/piik-{client,share,go,native}-overlay.mjs`，`scripts/build-piik.mjs`。
- 客户端：`desktop/windows/main.cjs`，`integrations/piik/{client,native,source-picker,share-audio}.ts`。
- 原共享 UI 与生命周期接入：`src/views/room/share-dialog.ejs`，`src/views/styles/share-dialog.css`，`src/views/js/media/media-dock-runtime.js`，`src/views/js/voice/voice-media-lifecycle.js`，`src/views/script.js`。
- 新测试：`tests/piik_{independent_audio,audio_wire}_test.mjs`，`scripts/piik-share/{nativecapture/platform_failure_test,nativehost/platform_share_test,nativecontrol/platform_share_test}.go`，`scripts/test-piik-independent-audio.mjs`，`scripts/verify-piik-share-dialog.mjs`。
- 现有测试适配：`tests/media_dock_runtime_test.mjs`，`tests/screen_share_reload_regression_test.mjs`，`scripts/fixtures/piik-synthetic-capture.go`，`scripts/test-{stage,piik}-browser.mjs`，`scripts/piik-native-scenario.mjs`。适配默认已开启的模拟麦克风和设备列表加载后位置变化的触摸目标。
- 本文与 `integrations/piik/README.md` 文档入口。

## 自动化证据

本轮只使用合成媒体、模拟协议、受控 pipe fixture，以及专门启动的隐藏无声 Node 子进程。没有主动捕获用户真实桌面、麦克风或其他应用音频；没有保存 PCM 录音文件。

| 检查 | 结果与边界 |
| --- | --- |
| `npm test` | 最终 788/788 通过，无失败/跳过；其中新增控制 wire 和独立音频测试 10 项。一轮并行运行时 TURN 服务 3 秒启动超时，独立复跑全量通过，未放宽该测试 |
| TypeScript / 浏览器构建 | `build:piik:app` 及后续 `build:piik --web-only` 通过；上游 Vite 提示 chunk >500 kB，无构建错误 |
| C++ / Go App 构建 | `npm run build:piik:app` 通过；native `-Check` 六组现有检查通过 |
| Go 包回归 | nativecapture、nativehost、nativecontrol、loopback、mediaedge 全部通过；包含三模式、系统排除参数、静音、失败、PID 重用、清理和编码未知状态 |
| 实际 Windows 进程 loopback | 无窗口无声测试进程可列出；旧创建时间输出 0 字节；静音持续 2200 ms；显式停止/重开、目标退出通过。109 个 PCM frame，峰值 1 LSB，为 16-bit 转换噪声底；不构成真实音质或回声验收 |
| 共享弹窗 | headless Edge，1920×1080 / 2560×1440 / 3840×2160 / 900×650 / 480×640 通过；模拟画面 A + 应用 B，native/web 显隐、未知/实际状态、关闭与旧请求迟到不复活列表通过 |
| 旧 P2P 与 SFU | 两套 stage browser 回归通过；各 24 个视口场景、72 个成员布局场景，合成音视频、触屏设置、屏幕共享、切路由及语音回归；脚本错误和失败资源均为 0 |
| 原生 App / Pion 链路 | `test-piik-browser.mjs --native` 最终通过：三观看者 H.264 解码、单采集 worker、无浏览器重编码、双向语音、网页与原生同时发布、原地画面/画质更新、满房离开立即重入、停止/重开及 App 退出清理。输入为合成 H.264，不是硬件性能证据；一次“失效来源提示”等待超时后，加入失败现场输出并复跑通过，未放宽原断言 |
| ESLint / diff | 修改脚本的 ESLint 与 `git diff --check` 通过；上游 tracked 状态干净 |

本地证据在忽略目录 `integrations/piik/.build/share-*.log` 与 `integrations/piik/artifacts/independent-audio/`。截图与合成状态不是实机采集证据。部分浏览器退出时临时 profile 因文件占用未立即删除，仅留在测试创建的 Temp 目录。

## 用户实机验收

需运行本地新代码与成套原生构建。已安装客户端和线上页面不会自动获得本轮功能。Electron 开发预览支持 `--preview-origin=http://127.0.0.1:端口/`，使用独立预览 userData；直接打开旧线上页面无法验收新 UI。现有开发服务入口见 `integrations/piik/ACCEPTANCE.md`。本轮没有自动启动可见客户端。

1. 屏幕 A + 播放器 B：只收到 B 的声音；换成其他窗口 A 后按提示重启，声音仍来自所选 B。
2. B 静音/暂停后再播放：保持共享且音频恢复；B 关闭后出现提示；同名应用重启后必须刷新重选。
3. 浏览器不同标签、独立子进程及无窗口播放程序：核对标注的进程树范围，不能将其认定为单标签隔离。
4. 系统声音：其他成员说话时没有本客户端语音回传；其他语音软件、网页声音进入共享的范围符合提示。
5. 共享音频开关、停/重开、切频道、断线重连后确认无残留采集、重复共享声音或麦克风失效。
6. 真实共享时核对高级设置显示实际 H.264 MFT 与适配器；只有 active 时确认硬件编码。观看端硬解单独检查。
7. 1080p / 2K / 4K、不同窗口尺寸、多人 P2P/SFU，验收实际音质、回声、帧率、CPU/GPU 负载、延迟与操作手感。

**自动化通过不等于以上实机验收通过。**

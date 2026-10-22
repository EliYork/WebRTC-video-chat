# 降噪方案调研（2026-10-22）

后续进展：已按本调研接入可选的 DeepFilterNet3 实验档，默认模式不变，尚未发布。见 [实现与验证边界](DEEPFILTER-2026-10-22.md)。下文“未修改运行代码”等描述记录的是初始调研阶段。

## 结论

网页和 Electron 客户端可以共用浏览器 AudioWorklet 降噪实现。优先评估 DeepFilterNet3 作为可选增强档；现有 RNNoise 保留为均衡档。GTCRN 可做轻量实验档，但它内部只有 16 kHz，不适合宣传为全频保真升级。

本次完成上游资料核查、npm 包体核查和隔离的 GTCRN WASM 基础运行探测。没有修改产品依赖、加入新降噪选项、采集真实麦克风或发布更新。

## 当前项目

- 模式：关闭、浏览器、RNNoise；RNNoise 另有可选非语音门控。
- RNNoise 优先使用本地 `rnnoise-v2-2025.1.5.wasm`（3,600,944 字节），有加载/编译/耗时预检和旧引擎回退。
- 处理链：浏览器回声消除 → 一个自定义降噪器 → 可选门控 → 输入增益。自定义降噪时关闭浏览器降噪，避免叠加。
- 现有事务切换、取消、静音和轨道归属保护需要保留。新方案不能要求退出重进语音频道。

依据：`src/views/js/voice/voice-audio-processing.js`、`rnnoise-engine.js`、`src/views/js/voice/voice-audio-settings-controller.js`。

## 候选方案

| 方案 | 适合的定位 | 主要代价 / 限制 | 建议 |
| --- | --- | --- | --- |
| DeepFilterNet3 | 48 kHz 全频带增强降噪 | 上游浏览器实现约 11 MB 压缩下载；附加延迟约 51–71 ms，取决于门控前瞻配置；本机实时性和听感待测 | 优先做可选增强档 |
| GTCRN | 小体积实验档 | 支持 48 kHz 输入输出，但内部降至 16 kHz 再升采样，会丢失高频内容；需要 WASM SIMD | 第二优先，明确音质取舍 |
| SpeexDSP | 传统降噪备选 | 同一浏览器库已有节点；缺少本项目对比证据，不能预期比现有 RNNoise 更适合键盘声 | 暂不为增加数量而加入 |
| DTLN | 16 kHz 模型备选 | 上游实现约 6 MB 下载、约 48 ms 附加延迟；相对 DFNet3 的听感指标和合成键盘噪声表现较弱 | 优先级低 |
| Krisp RTC SDK | 商业降噪 / 背景人声抑制 | 商业许可和授权验证；浏览器、Electron 均有支持 | 有商业预算和背景人声需求时评估 |

### DeepFilterNet3

[官方核心项目](https://github.com/Rikorose/DeepFilterNet)提供 48 kHz 全频带语音增强。
[WorkAdventure 浏览器封装](https://github.com/workadventure/noise-suppression)已有 WASM + AudioWorklet、就绪握手、释放和过载通知接口，可作为浏览器接入起点。

[封装作者的实验](https://github.com/workadventure/noise-suppression/blob/main/docs/experiments/engine-benchmark/README.md)测得：默认门控配置增加 70.7 ms 延迟，缩至一帧前瞻约 50.7 ms。其键盘声指标来自合成噪声场景，不能推导为边说话边敲键盘时的同等效果；M4 上的处理速度也不能代表 Windows 或手机。本项目尚未做 DFNet3 本地推理和听音对比。

2026-10-22 `npm view @workadventure/noise-suppression version dist.unpackedSize --json` 返回 0.2.0、152,443,665 字节解包体积。没有下载该大包。上游仓库 main 和 npm 发布包不保证相同，实施时需固定版本、检查实际文件及许可；只提供需要的运行资源，按需加载，不直接携带整包。

上游提示 WASM 内存随 AudioContext 关闭释放，因此需要先设计切换与资源生命周期，避免在一个长期存活的 context 中反复建立模型而累积内存。

### GTCRN

[官方模型](https://github.com/Xiaobin-Rong/GTCRN)为轻量语音增强网络；其与 RNNoise 的论文对比针对旧版 RNNoise，不能证明优于本项目的 2025 引擎。

[WASM 封装](https://github.com/sapphi-red/gtcrn-wasm)支持 16 kHz / 256 样本帧和 48 kHz / 768 样本帧，两者都由内部 16 kHz 模型处理。[web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor)已有浏览器节点。不能把支持 48 kHz 接口写成保留 48 kHz 全频带。

本次用 `npm pack --ignore-scripts` 下载固定版本 `@sapphi-red/gtcrn-wasm@0.0.3` 到被忽略的研究目录，没有安装到产品：压缩包 129,304 字节、解包 261,838 字节，其中 WASM 196,884 字节。发布前仍需保留模型、FFT 和封装的许可声明。

本机短探测（Node v24.15.0，Intel i5-14600K，合成双音，不含真实语音）：

| 接口 | 每帧样本 | 预热 / 计时帧 | p50 | p95 | 最大值 |
| --- | --- | --- | --- | --- | --- |
| 16 kHz | 256 | 8 / 64 | 1.249 ms | 1.761 ms | 2.019 ms |
| 48 kHz | 768 | 8 / 64 | 1.081 ms | 1.530 ms | 1.755 ms |

两组输出长度正确、数值有限，处理器已释放。这是一次 Node 可运行性探测，不能证明 AudioWorklet 的实时期限、低配性能、噪声抑制或听感。不能把上述每帧计算时间当作端到端附加延迟。

本地复现脚本及结果：`integrations/piik/.build/noise-research/probe.mjs`、`gtcrn-probe.json`，均为忽略的临时研究产物。

### 商业和设备专属方案

[Krisp 官方集成说明](https://sdk-docs.krisp.ai/docs/sdk-or-api)区分设备侧 SDK 和云 API。RTC SDK 提供降噪/背景人声抑制，支持 WebRTC 与 Electron，需要商业许可；不能用云 API 替换后仍宣称声音只在本机处理。本次没有申请 SDK 或联系厂商。

NVIDIA Maxine 属于需另查硬件与原生集成条件的方向，不适合作为网页和客户端共同默认。参考 [NVIDIA 官方介绍](https://developer.nvidia.com/blog/achieving-noise-free-audio-for-virtual-collaboration-and-content-creation-apps/)。

## 建议实施顺序

1. 先用隔离原型对比 RNNoise 与 DeepFilterNet3；不改当前默认。若它在本机真实混合场景中有明显收益，再加入“增强降噪”。
2. GTCRN 作为小体积实验候选，验证它的收益能否弥补高频损失；不先称为省电模式，需测完整链路。
3. 保留“关闭”和“浏览器”以及现有 RNNoise；显示加载/失败/回退状态。下载、编译、运行过载均应可恢复，切换保留静音与频道成员关系。
4. 模型和 worklet 本地托管、固定版本与哈希，检查许可；按需加载，避免打开页面就下载全部模型。更新 copied assets，不能只改 package.json。

## 上线前仍需的证据

- 授权后收集或使用许可清晰的样本，包含中文低声说话、句首/句尾、同时敲键盘、风扇、鼠标、音乐与旁人说话；做音量匹配的盲听。
- 分开测静默降噪和说话中的噪声，检查吞字、机械音、音色与回声；普通降噪不能保证分离旁人语音。
- 浏览器和隐藏 Electron 验证真实 worklet、附加延迟、掉帧、CPU/内存、反复切换释放，以及手机/低配设备。自动化不能替代物理设备听音验收。
- 模型下载失败、无 SIMD、初始化失败、快速切换、换设备、静音、离开和迟到任务不应产生静音死路或旧任务覆盖新配置。

本轮仅调研及独立探测，没有修改运行代码，因此没有重跑整个产品测试套件，也没有新增安装包或部署。

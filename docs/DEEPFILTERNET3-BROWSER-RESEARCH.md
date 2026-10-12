# DeepFilterNet3 浏览器接入调查

调查日期：2026-10-12。本轮只调查，没有安装包、改变 package.json/package-lock.json、加入模型资源或提供实验开关。

## 结论

存在可参考的 WASM + AudioWorklet 社区封装，但需要改造初始化确认、销毁和实时性能监测后再考虑接入。下一轮应作为可选实验模式与 RNNoise 对比，不直接替换默认模式。

## 核对结果

| 项目            | 已核对的信息                                                                                                                                                  | 尚需验证                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 上游            | [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet)，48kHz 全频带语音增强                                                                     | 在用户中文通话/键盘噪声样本上的音质                                          |
| 浏览器封装      | [lofcz/DeepFilterNet 的 packages/web](https://github.com/lofcz/DeepFilterNet/tree/main/packages/web)，发布包 `@lofcz/deepfilternet-web` 0.1.0                 | 社区封装与未来版本稳定性，目标浏览器运行                                     |
| 模型/运行库大小 | 发布包总展开 34,169,748 字节；其中 `df_bg.wasm` 为 34,135,648 字节，包含推理运行库及内嵌 DF3 权重，约 32.55 MiB；npm tarball 为 12,699,310 字节，约 12.11 MiB | 原始模型权重大小与浏览器运行内存不能由 WASM 文件大小推导                     |
| 算法延迟        | [作者论文](https://arxiv.org/pdf/2305.08227)报告 20ms 分析窗、10ms 步长、2 帧前视，总算法延迟 40ms                                                            | 浏览器 Worklet 缓冲、采集、编码和网络额外延迟；不能把 40ms 当通话端到端延迟  |
| 原生 CPU        | 同一论文报告 i5-8250U 单线程 RTF 0.19                                                                                                                         | 这是原生推理时间与音频时长之比，不能当浏览器 CPU 百分比，也不是本项目实测    |
| 许可            | 上游代码及包声明 `MIT OR Apache-2.0`，发布包附带 LICENSE、LICENSE-MIT、LICENSE-APACHE                                                                         | 引入时固定版本/提交，保存模型来源和构建依赖许可清单，核查权重及第三方 NOTICE |

大小证据来自 [npm 0.1.0 元数据](https://registry.npmjs.org/@lofcz%2fdeepfilternet-web/0.1.0) 及该元数据所指发布 tarball 的文件头。调查流式读取归档元数据和小文本文件，没有解压到项目或安装依赖。此处大小是本次发布产物快照。

## 接入路径与发现的工程缺口

读取了社区封装的 [stream.ts](https://github.com/lofcz/DeepFilterNet/blob/main/packages/web/src/stream.ts)、[worklet.ts](https://github.com/lofcz/DeepFilterNet/blob/main/packages/web/src/worklet.ts)、[DeepFilter.ts](https://github.com/lofcz/DeepFilterNet/blob/main/packages/web/src/DeepFilter.ts)、[WASM 接口](https://github.com/lofcz/DeepFilterNet/blob/main/libDF/src/wasm.rs)。

- `denoiseStream()` 下载 WASM，编译为 WebAssembly.Module，向 Worklet 传入模块；单声道处理，可传入现有 AudioContext。构建启用 WASM SIMD，不能假设非 SIMD 设备可用。
- Worklet 将 128 样本浏览器 quantum 聚成模型帧，模型推理直接运行在音频线程上。48kHz 下一个 quantum 约 2.67ms；每次凑齐帧的推理突发需要按 p95/p99 测量，平均 RTF 好看仍可能造成音频卡顿。
- 初始化失败在当前 Worklet 中变成旁路，没有通知调用者。直接沿用会造成“界面显示 DF3，但实际上没降噪”；需要 ready/error 握手和超时。
- 当前 `denoiseStream().destroy()` 只断开节点；Worklet 没有调用现有 `df_free()` 销毁模型句柄的消息协议。频繁切换需要补上销毁、内存回收和旧任务取消，避免长期占用。
- 逐帧 WASM 接口创建输出数组，跨 JS/WASM 有拷贝和分配；需要观察 GC、内存增长及长通话稳定性。不能从原生 CPU 成绩推断该路径的浏览器性能。
- 包的 `setEnabled(false)` 是旁路控制；未来实验模式退出时应销毁模型分支。不能为了快速切回而长期保留多个运行中的降噪处理器。

## 与本轮组件的衔接

未来把 DF3 作为 `voice-audio-processing.js` 的另一种处理器分支。共享当前 48kHz Context 和稳定输出轨道，保留 AEC 请求/读回、互斥浏览器 NS、用户增益及初始化失败回退。不要直接用 `denoiseStream()` 的新输出替换整个通话链；不修改 SFU/P2P 或共享系统音频。

加载按需、缓存编译模块，首次初始化在旧音频仍运行时完成。必须检测 SIMD、实际 Context 采样率、处理器就绪和资源销毁。长时间处于关闭/浏览器/RNNoise 时不运行 DF3 推理。

## 后续比较计划

固定采集距离、播放音量和 100% 增益，用用户的键盘、风扇、敲击、正常/轻声中文、外放含人声视频作成对样本。记录降噪残留、吞字/音色、附加延迟、启动时长、帧耗时 p50/p95/p99、内存及切换次数后的增长，并在共享游戏画面负载下重测。DF3 单输入降噪不替代需要播放参考的 AEC；“压掉视频人声回传”仍先验证浏览器 AEC。

进入本地发布包前，再明确 WASM/Worklet/许可文件为必要运行资源，按 AGENTS.md 的发布白名单和 SHA256 校验交付。此调查没有更改发布白名单。

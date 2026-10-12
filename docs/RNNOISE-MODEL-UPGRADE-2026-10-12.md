# RNNoise 模型升级与键盘噪声对比

## 查证

旧代码虽然声明 `@shiguredo/rnnoise-wasm` 2025.1.5，实际 Worklet 使用 `@sapphi-red/web-noise-suppressor` 0.3.5 附带的旧加载器和二进制。部署的 `rnnoise.wasm` 与该封装的文件逐字节一致，均为 152,656 字节；Worklet 许可证头标识上游 2022.2.0。安装较新的包不会自动更新已复制的浏览器资源。

[2025.1.5 变更记录](https://github.com/shiguredo/rnnoise-wasm/blob/2025.1.5/CHANGES.md)明确从 2025.1.0 更新到 Xiph RNNoise v0.2 系；[构建脚本](https://github.com/shiguredo/rnnoise-wasm/blob/2025.1.5/build-rnnoise.sh)固定 RNNoise commit `70f1d256acd4b34a572f999a05c87bf00b67730d`。当前上游训练说明包含[键盘等前景瞬态噪声](https://github.com/xiph/rnnoise/blob/main/README)，但这不能证明用户的真实键盘必然被去除。

## 接入

- 继续使用 RNNoise 模式与已有 48kHz 单声道处理链、VAD 门控和稳定输出轨道。未叠加浏览器 NS，未增加键盘事件静音、强门控或第二次模型推理。
- 从项目已有依赖的嵌入资源原样提取新版 WASM，3,600,944 字节，SHA256 `b3b67c9eae8f0791aad468c708659e0850bb37b0fb9c8a8666f2d7b0b6869bc4`。依赖固定为 2025.1.5。`node scripts/build-rnnoise-v2.mjs` 可复现，校验版本、长度、WASM 和哈希。
- 新增轻量 WASM 接口适配，不改上游 DSP 或模型权重；使用原来的 128/480 样本帧调度。源码和模型许可见运行资源 `src/views/wasm/rnnoise-v2.NOTICES.txt`（包 Apache-2.0、RNNoise BSD、Emscripten MIT/NCSA）。新增 WASM、适配器与许可是此模型运行所需，均在已有 `src/` 打包白名单内。
- 按需加载并缓存编译模块；用 48 帧、分批让出主线程的短预检检查初始化及耗时。前8帧预热，余40帧 p95 ≤1.8ms 才采用新版，给 2.67ms 的 AudioWorklet quantum 留余量。该预检不能保证长通话或游戏负载下永远不超时。
- 新模型加载/编译/预检失败或耗时过高时仍使用旧模型，读回 ready 里的实际模型与回退原因。两套模型同时不会持续推理。若两套均失败，既有设置事务保留原音频管线。
- 预检临时推理状态会释放；处理器销毁释放推理状态和 PCM 缓冲；逐帧使用复用视图，无额外 PCM 数组分配。WASM 内存在节点可回收后由浏览器 GC 回收，不能承诺立即归还内存。

## 本机对比证据

运行 `scripts/compare-rnnoise-models.mjs`，使用作者 [RNNoise 演示](https://jmvalin.ca/demo/rnnoise/) 的公开 `samples/clean.opus` 前8秒人声，叠加确定性的合成键盘脉冲。样本只放临时目录，不进入发布包。Worklet 非语音门控关闭，以比较模型本身；本测试不含物理麦克风 AEC。

| 指标 | 旧模型 | 新模型 |
| --- | ---: | ---: |
| 单独合成键盘脉冲的整段能量衰减 | 4.76dB | 52.10dB |
| 干净人声 SI-SDR | 17.52dB | 17.20dB |
| 人声＋合成键盘 SI-SDR | 12.66dB | 15.06dB |
| 混合输出与干净参考的人声音量投影 | −0.15dB | −0.29dB |
| 测得帧调度＋模型延迟 | 20.67ms | 30.67ms |

Edge 155 本次新模型主线程500帧预检测得 p50 0.70ms、p95 0.90ms、p99 1.0ms，最大1.30ms。推理帧每10ms一次，所以平均耗时与单个 CPU 核占用相关，不能把这些数值当用户设备持续 CPU 实测或通话端到端延迟。

指标解释：单独噪声的衰减不代表讲话时键盘声也衰减52dB；混合 SI-SDR 同时反映语音失真与噪声残留，不能解释成“键盘单独降低2.4dB”。干净语音指标略低、新模型延迟增加约10ms，均需试听权衡。一个公开英语样本及合成脉冲不代表用户中文人声、机械键盘、麦克风距离和房间声学。

## 搜索到的其他方案

[WorkAdventure 的浏览器封装](https://github.com/workadventure/noise-suppression)提供 DeepFilterNet3 WASM/AudioWorklet、暂停门控和负载报告。作者的[实验说明](https://github.com/workadventure/noise-suppression/blob/main/docs/experiments/engine-benchmark/README.md)区分模型、缓冲和门控延迟，报告默认约71ms、缩短门控约51ms、下载约11MB。这些是作者特定机器与样本的结果；其键盘衰减主要是合成且非讲话样本，不能用作本项目通话效果保证。

本轮先更新现有 RNNoise，不安装 DeepFilterNet/DTLN、新增大型模型或自行实现瞬态滤波/AEC。若新 RNNoise 的实机残留仍明显，DeepFilterNet3 应作为后续明确授权的实验模式比较，并检查销毁协议和游戏负载；不以更强幅度门控冒充语音与键盘分离。

## 用户复测

双方刷新后选 RNNoise，诊断应出现 `rnnoise-v2-2025.1.5`，且模型回退为空。若是 `rnnoise-legacy-2022`，同时查看模型回退是加载失败还是预检耗时偏高。

先固定输入增益/朋友播放各100%作比较，再恢复个人偏好。各录10秒：安静打字、连续讲话打字、正常讲话、轻声及首字尾音；用朋友端实际听到的声音比较。另在游戏共享负载下保持讲话并切模式/设备，检查有无爆音断续、稳定轨道和静音保持。真实效果仍由用户试听验收。

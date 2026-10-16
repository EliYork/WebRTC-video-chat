# 共享选择框默认偏好（本地，2026-10-17）

用户希望共享时默认打开“窗口”页签，并默认选中共享音频。网页通过浏览器的 `getDisplayMedia()` 选择窗口、标签页或整个屏幕；仍需用户选择具体来源并点击共享确认。

本地修改 `src/views/js/voice/voice-media-lifecycle.js`：

- 所有分辨率预设的 `video.displaySurface` 均请求 `window`，提示浏览器优先显示窗口页签。
- 新增顶层 `audioSelection: 'preferred'`，提示支持的浏览器优先连同音频共享。保留已有音频请求与 `windowAudio: 'window'`，优先窗口声音。
- 继续按支持情况请求 `restrictOwnAudio`，保留排除本通话标签页的提示；未改变分辨率、帧率、编码、音频本地播放或传输策略。

`displaySurface` 和 `audioSelection` 是浏览器可忽略的偏好，不能保证所有版本/平台都默认勾选声音；网页不控制选择框中的原生开关，也不能替用户确定具体共享来源。音频最终是否提供，以浏览器返回的实际轨道为准；选择不共享声音或浏览器只提供视频时，仍允许共享画面。

官方依据（2026-10-17查阅）：

- [Chrome共享控制文档](https://developer.chrome.com/docs/web-platform/screen-sharing-controls#the_displaysurface_option)：`displaySurface: 'window'` 可请求预选窗口页签，不可预选具体窗口。
- [Edge 152平台发布说明](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/release-notes/152#audioselectionpreferred-option-for-getdisplaymedia)：支持 `audioSelection: 'preferred'`。
- [W3C Screen Capture](https://w3c.github.io/mediacapture-screen-share/#dom-displaymediastreamoptions-audioselection)：音频优先提示可被浏览器忽略；用户保留来源和音频的选择权。

验证：更新既有约束映射和采集调用测试，覆盖默认、固定分辨率、自动、原始分辨率以及支持自身音频排除的请求。全量 `npm test` 325/325通过，变更文件ESLint通过。未进行原生Edge选择框或真实声音采集验收，不能把参数测试当作“开关已自动开启”的证明。

仅本地工作区修改，未提交、推送、打包、部署或修改线上。此前本地媒体更新去重修复和诊断原始数据保留。

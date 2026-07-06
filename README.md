<p align="right">中文 | <a href="./README.en.md">English</a></p>

# 朋友频道语音房间

一个给朋友们使用的自托管固定频道语音房间网页。

它不是传统会议软件，而更像一个“朋友语音桌面”：左侧频道、右侧聊天、中间自由摆放语音小窗口。支持语音、屏幕共享、频道聊天、全页面共享鼠标，以及可自定义的页面级组件布局。

## 功能特性

- 固定频道：访问首页会默认进入大厅，左侧频道树可切换到 `/room/{channel}`。
- 语音通话：双击频道或点击语音入口后加入当前频道语音。
- 默认仅麦克风：加入语音时只请求麦克风权限，不默认请求摄像头。
- 手动开启摄像头：摄像头默认关闭，点击摄像头按钮后才请求摄像头权限。
- 屏幕共享：支持在频道内共享屏幕，远端可观看共享画面。
- 全屏观看：远端视频和屏幕共享画面支持全屏观看。
- 频道文字聊天：同频道实时聊天，消息只在当前频道内广播。
- 临时内存消息历史：服务端为每个频道保留最近 50 条聊天消息，服务重启后清空。
- 全页面共享鼠标：进入同一频道后，不加入语音也能看到其他人的鼠标位置。
- 频道隔离：不同频道的语音、聊天和共享鼠标互不串房。
- 声音优化：麦克风采集启用 `echoCancellation`、`noiseSuppression` 和 `autoGainControl`，本地不会播放自己的麦克风。
- 页面级自定义布局：频道栏、聊天栏、语音小窗口等组件可移动、缩放、隐藏和恢复。
- 网格吸附布局：组件拖动或缩放后会吸附到页面网格，并保存到当前浏览器的 `localStorage`。
- 自由移动：组件默认可在普通模式下移动和缩放，也可以关闭某个组件的自由移动。
- 语音小窗口自动摆放：本地和远端语音窗口出现时，会尽量避开频道栏、聊天栏和已有窗口。

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:3000
```

如果 Windows PowerShell 执行策略拦截 `npm` / `npx`，可以使用：

```bash
npm.cmd start
npm.cmd run eslint
npx.cmd prettier src/server.js src/views/script.js src/views/style.css README.md README.en.md --check
```

## 环境变量

本地 HTTP 开发常用配置：

```env
PORT=3000
USE_HTTPS=false
```

可以从 `.env.example` 创建 `.env`：

```bash
cp .env.example .env
```

## 部署说明

线上 HTTPS 建议由 Nginx 或宝塔负责，Node 仍使用 `USE_HTTPS=false` 监听 `PORT=3000`。

PeerJS 已挂载在同一个 Express 服务的 `/peerjs` 路径下，页面、Socket.IO 和 PeerJS 都走同一个域名。Nginx 只需要反代到 `127.0.0.1:3000`，并为 Socket.IO / PeerJS 保留 WebSocket Upgrade 头。

生产环境建议额外配置 TURN 服务器，以提升在复杂 NAT、公司网络或校园网环境下的语音连接成功率。

## 使用方式

1. 打开 `http://localhost:3000`，默认进入大厅。
2. 在左侧频道树切换频道。
3. 进入频道后，可以直接看到同频道其他人的鼠标。
4. 双击左侧频道或点击语音入口加入语音。
5. 按需使用麦克风静音、摄像头、屏幕共享、文字聊天和全屏观看。
6. 可以点击“复制频道链接”把当前频道 URL 发给朋友。
7. 点击“编辑布局”可以调整页面组件；拖动或缩放后布局会保存在当前浏览器中。

## 当前频道

- `lobby`：大厅
- `game`：游戏开黑
- `project`：项目讨论
- `screen`：一起看屏幕
- `idle`：发呆挂机

## 页面布局说明

页面采用本地保存的 page-level layout：

- `sidebarPanel`：左侧频道栏和用户状态区域。
- `chatPanel`：右侧聊天面板。
- `localPeer`：自己的语音/视频小窗口。
- `remotePeer`：远端成员语音/视频小窗口。
- `screenShare`：屏幕共享窗口。

布局保存在当前浏览器的 `localStorage` 中。清除浏览器数据或更换设备后，需要重新调整布局。

## 测试建议

- 用 Chrome + Edge 打开同一个频道测试双窗口互通。
- 一个窗口共享屏幕，另一个窗口观看并测试全屏。
- 在同一频道内测试聊天和共享鼠标。
- 打开不同频道，确认语音、聊天和鼠标互相隔离。
- 同一台电脑测试语音可能有回声，建议静音一个窗口或使用耳机。
- 测试页面布局时，可以拖动频道栏、聊天栏和语音窗口，刷新后确认位置和大小是否保留。

## 技术栈

- Node.js
- Express
- Socket.IO
- PeerJS
- WebRTC
- EJS
- 原生 JavaScript / CSS
- Web Audio API

## 项目现状与后续计划

目前项目更偏向“朋友之间自用”的轻量语音房间，还不是带账号、权限和持久化数据的完整会议系统。

计划中的后续方向：

- 账号系统和用户身份。
- 更细粒度的组件拆分，例如聊天输入框、用户状态卡、房间信息卡。
- 账号系统之后，再做布局预设、导入 / 导出和跨设备同步。
- 更完善的权限、房间管理和移动端体验。
- TURN 服务器和更多生产环境稳定性配置。

## 特别感谢 / Credits

本项目在开发过程中参考和学习了以下开源项目，感谢这些项目作者的分享：

| 项目 | 参考内容 | 协议 |
|---|---|---|
| [nlukic97/WebRTC-video-chat](https://github.com/nlukic97/WebRTC-video-chat) | 视频通话、WebRTC / PeerJS、屏幕共享相关实现思路 | ISC |
| [nlukic97/WebSocket-Cursor-Room](https://github.com/nlukic97/WebSocket-Cursor-Room) | 多用户鼠标位置同步 / 共享鼠标思路 | MIT |
| [sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) | Web Audio API 降噪节点与降噪方案参考 | MIT |

以上项目仍归原作者所有，并遵循各自仓库中的开源协议。本项目自己的协议见下方 License。

## License

ISC

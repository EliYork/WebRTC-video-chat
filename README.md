<p align="right">中文 | <a href="./README.en.md">English</a></p>

# 朋友频道语音房间

一个给朋友使用的固定频道语音房间网页，支持语音、屏幕共享、频道聊天和全页面共享鼠标。

## 功能特性

- 固定频道：首页展示预设频道，进入 `/room/{channel}` 后加入对应频道。
- 语音通话：点击 `Join Call` 后只请求麦克风权限，不默认请求摄像头。
- 手动开启摄像头：摄像头默认关闭，点击摄像头按钮后才请求摄像头权限。
- 屏幕共享：支持在频道内共享屏幕。
- 全屏观看：远端视频和屏幕共享画面支持全屏观看。
- 声音优化：麦克风采集启用 `echoCancellation`、`noiseSuppression` 和 `autoGainControl`，本地不会播放自己的麦克风。
- 频道文字聊天：同频道实时聊天，消息只在当前频道内广播。
- 临时内存消息历史：服务端为每个频道保留最近 50 条聊天消息，服务重启后清空。
- 全页面共享鼠标：进入同一频道后，不加入语音也能看到其他人的鼠标位置。
- 频道隔离：不同频道的语音、聊天和共享鼠标互不串房。

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

## 使用方式

1. 打开 `http://localhost:3000`。
2. 选择一个频道进入房间。
3. 进入频道后，可以直接看到同频道其他人的鼠标。
4. 点击 `Join Call` 加入语音。
5. 按需使用麦克风静音、摄像头、屏幕共享、文字聊天和全屏观看。
6. 可以点击“复制频道链接”把当前频道 URL 发给朋友。

## 当前频道

- `lobby`：大厅
- `game`：游戏开黑
- `project`：项目讨论
- `screen`：一起看屏幕
- `idle`：发呆挂机

## 测试建议

- 用 Chrome + Edge 打开同一个频道测试双窗口互通。
- 一个窗口共享屏幕，另一个窗口观看并测试全屏。
- 在同一频道内测试聊天和共享鼠标。
- 打开不同频道，确认语音、聊天和鼠标互相隔离。
- 同一台电脑测试语音可能有回声，建议静音一个窗口或使用耳机。

## 技术栈

- Node.js
- Express
- Socket.IO
- PeerJS
- WebRTC
- EJS
- 原生 JavaScript / CSS

## 开源来源 / Credits

- 基于 `nlukic97/WebRTC-video-chat` 修改。
- 全页面共享鼠标参考了 `nlukic97/WebSocket-Cursor-Room` 的实现思路。

## License

ISC

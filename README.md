<p align="right">中文 | <a href="./README.en.md">English</a></p>

# WebRTC 语音与屏幕共享

一个小型自托管 WebRTC 房间应用，使用 Node.js、Express、PeerJS、Socket.IO、EJS 和原生 JavaScript 构建。

当前基线是一个语音优先的固定频道房间：

- `Join Call` 只请求麦克风权限。
- 摄像头视频是可选的，只有点击摄像头按钮后才会启动。
- 即使没有摄像头视频轨道，也可以发送屏幕共享。
- 首页展示一组固定频道。
- 每个频道都有稳定 URL，例如 `/room/project`。

## 当前功能

- 固定的首页频道列表。
- 稳定的频道路由：`lobby`、`game`、`project`、`screen` 和 `idle`。
- 默认以纯音频方式加入房间。
- 加入房间时默认启用浏览器支持的回声消除、降噪和自动增益。
- 麦克风静音与取消静音。
- 可选摄像头开关。
- 向已连接的对端共享屏幕。
- 远端视频和屏幕共享支持按钮或双击全屏观看。
- 支持向没有视频 sender 的对端共享屏幕。
- 当其他用户已经在共享屏幕时，后加入者也能接收当前屏幕共享。
- 远端用户没有视频轨道时显示纯音频占位卡片。
- 房间页提供复制频道链接按钮。
- 基础服务端日志写入 `logs/node.log`。

当前基线不包含登录系统或外部 AI 集成。

## 媒体逻辑

前端媒体流程有意保持简单：

- `Join Call` 优先调用带 `echoCancellation`、`noiseSuppression`、`autoGainControl` 的音频采集；如果浏览器不支持，会降级为基础 `audio: true`。
- 本地流始终以纯音频开始。
- 只有当用户请求打开摄像头时，摄像头按钮才会调用 `getUserMedia({ video: true, audio: false })`。
- 如果摄像头启动失败，通话会保持连接，错误会通过 `console.warn` 记录。
- 屏幕共享调用 `getDisplayMedia()`，并把返回的屏幕视频轨道作为当前活动视频轨道。
- 对每个已连接的对端，屏幕共享会先查找已有的视频 sender：`sender.track?.kind === 'video'`。
- 如果存在视频 sender，应用会使用 `replaceTrack(screenTrack)`。
- 如果不存在视频 sender，应用会额外发起一个轻量的 PeerJS 媒体通话，用来承载屏幕视频轨道。
- 当新对端加入时，应用会使用当前活动流呼叫对方，因此已经进行中的屏幕共享可以被后加入者接收。
- 当屏幕共享停止时，如果摄像头已开启，应用会恢复摄像头轨道；否则会让对端回到纯音频状态。

## 本地运行

### 前置要求

- Node.js
- npm

### 安装

```bash
npm install
```

### 环境变量

从示例文件创建 `.env`：

```bash
cp .env.example .env
```

本地 HTTP 开发时，重要配置为：

```env
USE_HTTPS=false
PORT=3000
PEER_PORT=9000
```

仓库中的 `.env.example` 已经包含这些默认值。

### 启动

```bash
npm start
```

开发时如需自动重载：

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

应用会展示固定频道列表。

## 频道

当前频道定义在 `src/server.js`：

- `lobby`：大厅
- `game`：游戏开黑
- `project`：项目讨论
- `screen`：一起看屏幕
- `idle`：发呆挂机

频道 URL 使用以下格式：

```text
http://localhost:3000/room/project
```

无效的频道 slug 会带着友好提示重定向回首页。

## 双窗口测试

1. 使用 `npm start` 启动服务。
2. 在浏览器窗口 A 中打开 `http://localhost:3000`。
3. 点击 `项目讨论`。
4. 复制当前频道 URL，或点击 `复制频道链接`。
5. 在浏览器窗口 B 中打开相同的 `/room/project` URL。
6. 在两个窗口中都点击 `Join Call`。
7. 确认浏览器请求的是麦克风权限，而不是摄像头权限。
8. 在 A 中点击屏幕共享按钮。
9. 确认浏览器显示 `localhost:3000` 正在共享屏幕。
10. 确认 B 能看到 A 共享的屏幕。
11. 在 A 中停止共享。
12. 确认 B 回到纯音频占位状态，并且控制台没有抛出错误。

频道隔离检查：

1. 在 A 中打开 `/room/project`。
2. 在 B 中打开 `/room/game`。
3. 两边都加入通话。
4. 确认它们不会连接到同一个语音房间。

后加入检查：

1. 在 A 中加入房间。
2. 在 A 中开始屏幕共享。
3. 在 B 中打开相同房间 URL。
4. 在 B 中加入房间。
5. 确认 B 收到 A 当前的屏幕共享。

## 质量检查

提交更改前运行：

```bash
npm run eslint -- src/views/script.js
npx prettier src/views/script.js src/views/style.css README.md README.en.md --check
```

同时确认 `.env.example` 包含 `USE_HTTPS=false` 和 `PORT=3000`。

## 项目结构

```text
src/
  server.js
  utils/
    iceServers.js
    Log.js
    LogMemoryUsage.js
  views/
    room/
      index.ejs
    script.js
    style.css
logs/
package.json
README.md
README.en.md
```

## 备注

- WebRTC 使用 `src/utils/iceServers.js` 中配置的 ICE 服务器。
- 对于 NAT 或防火墙规则较严格的生产网络，可能需要 TURN 服务器。
- 可以通过 `USE_HTTPS=true` 启用 HTTPS，并在 `cert/selfsigned.crt` 和 `cert/selfsigned.key` 放置证书。

## 许可证

ISC

## 致谢

本项目基于：

- nlukic97/WebRTC-video-chat，使用 MIT License。
- nlukic97/WebSocket-Cursor-Room，使用 ISC License。

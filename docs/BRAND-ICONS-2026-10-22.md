# 网页与 Windows 客户端统一图标（2026-10-22，本地候选）

## 设计与接入

沿用暖粉主题，以奶白耳机和话筒弧线作为标识，粉色圆角底，外部透明。没有文字或外部字体依赖，小尺寸保持可辨认。源图为自行绘制的 SVG，PNG 与 ICO 均从同一个源图生成，不依赖在线图片或新增 npm 包。

| 位置 | 资源及用途 |
| --- | --- |
| 品牌源图 | `src/views/assets/brand/voice.svg`，512 viewBox，可直接编辑和缩放 |
| 网页标签 | `/favicon.ico` 与 `/assets/brand/voice.svg`，模板带版本查询，兼容 ICO 与 SVG |
| 页面左上角 | 同一 SVG，网页 30px、桌面页面 24px，替换原文字占位标识 |
| Apple 主屏图标 | `src/views/assets/brand/apple-touch-icon.png`，180px |
| 高分辨率导出 | `src/views/assets/brand/voice-512.png`，512px 品牌图 |
| Windows 程序与安装器 | `desktop/windows/assets/app.ico`，16/20/24/32/40/48/64/128/256px |
| 客户端窗口、对话框与来源选择器 | `desktop/windows/assets/app.png`，256px |
| Windows 托盘 | `desktop/windows/assets/tray.png`，64px |

`electron-builder.cjs` 配置程序、NSIS 安装与卸载图标，并将运行时窗口图标加入客户端文件清单。程序仍保持未签名设置；图标资源编辑与代码签名是独立步骤。网页资源位于既有 `src/` 打包白名单内，新增公开静态目录 `/assets`；目录索引关闭、隐藏文件拒绝，未公开工作区或运行数据目录。

## 再生成

修改 SVG 后，从项目根目录运行本地 Electron 的隐藏生成脚本：

```powershell
node --input-type=module -e "import {spawn} from 'node:child_process';const child=spawn('./desktop/windows/node_modules/electron/dist/electron.exe',['scripts/build-brand-icons.cjs'],{windowsHide:true,stdio:'inherit'});child.on('error',()=>process.exitCode=1);child.on('exit',code=>process.exitCode=code ?? 1);"
```

脚本将生成资源写回上述位置，预览输出到忽略目录 `integrations/piik/artifacts/brand/icon-preview.png`，不安装或启动用户的客户端。

## 验证与边界

- 默认 `npm test` **758/758 通过，0 失败、0 取消、0 跳过，14.75 秒**；没有为可逆的图标修改新增单元测试。ESLint 与 `git diff --check` 通过。
- 使用真实本机服务器核对 ICO、SVG、Apple PNG 与 512px PNG 的 HTTP 200、图片 MIME 和完整文件摘要。隐藏静音完整页面加载图标，网页/桌面顶部显示尺寸分别为 30/24px，无水平溢出；已检查对应截图及浅色/深色、小尺寸预览。首次目录保护检查错误预期为 404，实际 `dotfiles: deny` 正确返回 403，调整验证预期后通过。
- 只生成本地 unpacked 客户端检查资源，未生成或发布新版安装器；从实际 `EliYork Voice.exe` 提取的 32px 图标与源 ICO 对应尺寸逐像素一致。ICO 的九种尺寸可被 Pillow 与 Electron 原生图像解码器读取，网页与 Windows ICO 字节一致。
- 本机检查结果在 `integrations/piik/artifacts/brand/result.json`，页面截图在同目录；本地构建在 `desktop/windows/.build/brand-icon-check-1792679733251/`。未操作用户活动窗口、托盘或真实媒体。

本次未提交、推送、部署、升级版本号或安装客户端。线上网页需发布网站资源后生效；已安装客户端的 EXE、快捷方式和托盘需重新发布客户端后生效。安装器图标目前只完成配置，实际 NSIS 安装及 Windows 任务栏/快捷方式展示仍待新版安装包和实机验收。

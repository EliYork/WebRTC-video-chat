# 本地发布约定

- `release/` 只存本地 ZIP（`.gitkeep` 用于保留目录），ZIP 不提交 Git。
- 打包命令：项目根目录运行 `npm run package:release`。脚本为 `scripts/package-release.ps1`，依赖 Windows PowerShell，不需要额外压缩软件。
- 包含且仅包含 `src/`、`package.json`、`package-lock.json`、`.env.example`、`LICENSE`、`docs/RELEASE.md`。ZIP 根目录直接放运行文件，不额外嵌套项目目录。
- 不包含 `.env`、`cert/`、`data/`、`logs/`、`node_modules/`、Git、测试、代理工具配置和历史发布包。新增运行资源时，先明确必要性再更新白名单。
- 打包来自当前工作区，包括未提交改动；不得擅自提交、推送、打标签或部署。不能把工作区内容当成已发布版本。
- 打包前运行 `npm test`，如失败，准确报告失败项，不得把生成 ZIP 描述为测试通过或可直接上线。打包命令本身不运行测试，方便生成待验收候选包。
- 打包脚本必须校验 ZIP 文件清单、逐项 SHA256，失败时不得交付为有效包。保留旧 ZIP，不覆盖旧版本；失败产生的 ZIP 也不得上传。
- 命名包含 `package.json` 版本号与时间戳；不自动升级版本号。发布操作和回滚参考 `docs/RELEASE.md`。
- 修改已有文件前检查工作区差异，保留用户和其他任务的改动，不夹带无关修复。

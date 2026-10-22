# 2026-10-19：客户端安装包下载总上限调整

用户授权将下载合计上限提高到 2 MB/s。本轮已将生产下载 location 的 `limit_rate 256k` 改为 `limit_rate 1000000`，保留 `limit_conn perserver 2`，并核实共享区定义为 `limit_conn_zone $server_name zone=perserver:10m;`。

- 每条下载连接上限 **1,000,000 字节/秒**；整个站点下载区最多 **2 条活动连接**，配置合计上限 **2,000,000 字节/秒**（十进制 2 MB/s）。单连接仍最多 1 MB/s；不按每位用户各给 2 MB/s。Nginx 为按连接节流，网络分块会有短时波动，不是逐毫秒的链路整形。
- 第三条下载连接在前两条持续传输时返回 **429**，沿用现有并发限制，不排队。
- 真实 HTTPS 两条 Range 传输，各读取 12,000,000 bytes，约 11.884 秒；2–8 秒采样窗口每条约 983040 B/s，合计 **1966080 B/s**。未执行安装包。
- `nginx -t` 通过并仅平滑 reload；Node PID 57665、Piik 43641、其他站点 1389 保持不变。健康检查正常，网页构建仍为 `5be534293c1bbd22a2f5bf9ee8d076fe3f8ae2f9`。
- 同步修改本地 `scripts/deploy-desktop-update.py` 的下载限速与结果字段，防止下次发布恢复旧值；Python 语法检查与差异空白检查通过。没有 Commit、Push 或打包客户端。

生产仅写入现有下载 Nginx location 和私有备份目录 `/www/backup/voice-deploy/download-limit-20261019T114839`；保留旧配置、Nginx 快照、摘要、健康及吞吐结果。未改其他路由、媒体预算、应用环境、数据库、SSH、cron、防火墙或删除文件。

回滚命令（恢复旧限速并平滑 reload）：

```sh
python3 /www/backup/voice-deploy/download-limit-20261019T114839/rollback.py
```

本地证据：`integrations/piik/.build/download-limit-20261019/`。既有发布记录中 256 KiB/s 为当时状态，当前以本记录为准。

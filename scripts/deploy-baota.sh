#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="/www/wwwroot/voice.eliyork.com"
# Existing PM2 process and confirmed local HTTP listener.
PM2_APP="${PM2_APP:-voice-room}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:3000/room/lobby}"
PUBLIC_URL="https://voice.eliyork.com/room/lobby"
NODE_BIN="/www/server/nodejs/v24.15.0/bin"
export PATH="$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
PM2="$NODE_BIN/pm2"
NPM="$NODE_BIN/npm"
NODE="$NODE_BIN/node"

[[ -n "$PM2_APP" && -n "$LOCAL_URL" ]] || {
    echo '请填写 PM2_APP 和 LOCAL_URL（例如 http://127.0.0.1:实际端口/room/lobby）。'
    exit 1
}
[[ "$LOCAL_URL" =~ ^https?://(127\.0\.0\.1|localhost):[0-9]+/room/lobby$ ]] || {
    echo 'LOCAL_URL 必须是本机服务的 /room/lobby 地址。'; exit 1;
}
for tool in "$PM2" "$NPM" "$NODE" python3 curl flock; do command -v "$tool" >/dev/null; done
[[ -d "$APP_DIR" && ! -L "$APP_DIR" ]] || { echo '项目目录不存在或是符号链接，停止。'; exit 1; }
cd "$APP_DIR"
[[ "$(pwd -P)" == "$APP_DIR" ]] || { echo '项目实际路径不符，停止。'; exit 1; }
exec 9>"$APP_DIR/.voice-deploy.lock"
flock -n 9 || { echo '已有部署正在进行。'; exit 1; }

# Backups are private and outside the publicly served directory. Never auto-delete.
BACKUP_ROOT="/www/backup/voice-deploy"
mkdir -p "$BACKUP_ROOT"
RUN_DIR="$(mktemp -d "$BACKUP_ROOT/run-XXXXXXXX")"
STAGE="$RUN_DIR/new"
mkdir "$STAGE" "$RUN_DIR/old" "$RUN_DIR/failed"
"$PM2" jlist > "$RUN_DIR/pm2.json"
"$NODE" - "$RUN_DIR/pm2.json" "$PM2_APP" "$APP_DIR" <<'NODE'
const fs = require('fs');
const [file, name, cwd] = process.argv.slice(2);
const matches = JSON.parse(fs.readFileSync(file, 'utf8')).filter(p => p.name === name);
if (!matches.length || matches.some(p => p.pm2_env.pm_cwd !== cwd || p.pm2_env.status !== 'online')) {
    throw Error('PM2 名称、运行目录或在线状态不符，请使用管理现有进程的同一系统用户执行。');
}
NODE

echo "Node: $("$NODE" -v)  npm: $("$NPM" -v)"
echo "备份目录：$RUN_DIR"
ZIP="$(find "$APP_DIR" -maxdepth 1 -type f -name 'webrtc-video-chat-*.zip' -printf '%f\n' | sort -V | tail -n 1)"
[[ -n "$ZIP" ]] || { echo '没找到 webrtc-video-chat-*.zip'; exit 1; }
echo "部署包：$ZIP"
# Read all entries before extraction; reject traversal, links, duplicates and secrets.
python3 - "$APP_DIR/$ZIP" "$STAGE" <<'PY'
import json, pathlib, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    if len(names) != len(set(names)): raise ValueError('重复 ZIP 条目')
    required = {'src/server.js', 'package.json', 'package-lock.json'}
    if not required.issubset(names): raise ValueError('缺少运行文件')
    for info in z.infolist():
        name = info.filename
        p = pathlib.PurePosixPath(name)
        if '\\' in name or p.is_absolute() or '..' in p.parts or ':' in name:
            raise ValueError('不安全路径')
        if stat.S_ISLNK(info.external_attr >> 16): raise ValueError('不允许符号链接')
        if not (name.startswith('src/') or name in {'package.json', 'package-lock.json', '.env.example', 'LICENSE', 'docs/RELEASE.md'}):
            raise ValueError('非白名单文件: ' + name)
        if any(part in {'.env', '.git', 'node_modules', 'cert', 'logs', 'data'} for part in p.parts):
            raise ValueError('包内含配置或运行数据')
    if z.testzip(): raise ValueError('ZIP 损坏')
    pkg = json.loads(z.read('package.json'))
    lock = json.loads(z.read('package-lock.json'))
    if pkg.get('name') != 'WebRTC-video-chat' or pkg['version'] != lock['version'] or pkg['version'] != lock['packages']['']['version']:
        raise ValueError('包身份或版本不一致')
    print('版本：' + pkg['version'])
    z.extractall(sys.argv[2])
PY
(cd "$STAGE" && "$NPM" ci --omit=dev)
"$NODE" --check "$STAGE/src/server.js"
# Renames need the same filesystem; fail before stopping if that is not true.
[[ "$(stat -c %d "$APP_DIR")" == "$(stat -c %d "$RUN_DIR")" ]] || {
    echo '备份目录与项目不在同一文件系统，停止部署。'; exit 1;
}
TARGETS=(src package.json package-lock.json node_modules)
for item in "${TARGETS[@]}"; do
    [[ ! -L "$APP_DIR/$item" ]] || { echo "拒绝替换符号链接：$item"; exit 1; }
done
probe() {
    local code
    code="$(curl --silent --show-error --connect-timeout 3 --max-time 8 -o /dev/null -w '%{http_code}' "$1")" || return 1
    [[ "$code" == 200 ]]
}
probe_ready() {
    # One Node process owns the request, deadline and bounded JSON parsing.
    # Require exactly 200; redirects and invalid TLS must never pass this gate.
    "$NODE" -e '
let request;
let deadline;
let settled = false;
const finish = ready => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    request?.destroy();
    process.exitCode = ready ? 0 : 1;
};
try {
    const url = new URL(process.argv[1]);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw Error("unsupported protocol");
    const client = require(url.protocol === "https:" ? "node:https" : "node:http");
    deadline = setTimeout(() => finish(false), 8000);
    request = client.get(url, { agent: false, rejectUnauthorized: true, headers: { Accept: "application/json" } }, response => {
        if (response.statusCode !== 200) {
            response.destroy();
            finish(false);
            return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", chunk => {
            bytes += chunk.length;
            if (bytes > 65536) {
                finish(false);
                return;
            }
            chunks.push(chunk);
        });
        response.on("end", () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                finish(body?.ok === true && body?.mediaReady === true);
            } catch { finish(false); }
        });
        response.on("aborted", () => finish(false));
        response.on("error", () => finish(false));
    });
    request.on("error", () => finish(false));
} catch { finish(false); }
' "$1"
}
LOCAL_READY_URL="${LOCAL_URL%/room/lobby}/readyz"
PUBLIC_READY_URL="${PUBLIC_URL%/room/lobby}/readyz"
probe "$LOCAL_URL" || { echo '旧服务本机检查失败，请核对地址/协议，尚未停服。'; exit 1; }
MOVED=()
INSTALLED=()
STOPPED=0
rollback() {
    local code=$?
    trap - ERR
    set +e
    echo "部署失败，备份保留在 $RUN_DIR"
    if [[ "$STOPPED" == 1 ]]; then
        "$PM2" stop "$PM2_APP"
        for item in "${INSTALLED[@]}"; do mv -- "$APP_DIR/$item" "$RUN_DIR/failed/$item"; done
        for item in "${MOVED[@]}"; do mv -- "$RUN_DIR/old/$item" "$APP_DIR/$item"; done
        "$PM2" restart "$PM2_APP"
        echo '已尝试恢复旧程序；请核对日志和页面，未回退聊天记录。'
        "$PM2" logs "$PM2_APP" --lines 30 --nostream
    fi
    exit "$code"
}
trap rollback ERR
STOPPED=1
"$PM2" stop "$PM2_APP"
for item in "${TARGETS[@]}"; do
    if [[ -e "$APP_DIR/$item" ]]; then
        mv -- "$APP_DIR/$item" "$RUN_DIR/old/$item"
        MOVED+=("$item")
    fi
    mv -- "$STAGE/$item" "$APP_DIR/$item"
    INSTALLED+=("$item")
done
"$PM2" restart "$PM2_APP"
HEALTH_OK=0
for i in $(seq 1 15); do
    if probe "$LOCAL_URL" && probe_ready "$LOCAL_READY_URL"; then HEALTH_OK=1; break; fi
    echo "等待页面与媒体服务就绪 ($i/15)"; sleep 2
done
[[ "$HEALTH_OK" == 1 ]]
probe "$PUBLIC_URL"
probe_ready "$PUBLIC_READY_URL"
"$PM2" save
trap - ERR
echo "部署完成：$ZIP"
echo "旧程序备份：$RUN_DIR/old"
echo '页面与媒体就绪检查通过；请再验收聊天、双端语音和屏幕共享。'

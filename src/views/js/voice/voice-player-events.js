(function exposePlayerEvents(global) {
    'use strict';
    const routeEvents = {
        p2p: '当前使用 P2P 直连', connecting: '正在连接服务器转发', sfu: '服务器转发已连接',
        'sender-routes-changed': '共享发送路径已更新', 'subscription-ready': '服务器共享订阅已就绪',
        'subscribe-failed': '服务器共享订阅失败', 'subscription-closed': '服务器共享订阅已关闭',
        'receiver-release': '服务器接收连接已释放', fallback: '服务器共享异常，开始回退',
        'p2p-fallback-requested': 'P2P 优先策略开始尝试服务器兜底',
    };
    const reasons = {
        'receiver-video-stalled': '接收端持续低帧或停止解码', 'receiver-stats-timeout': '接收统计持续不可用',
        'receiver-ready-failed': '首帧准备失败', 'subscription-timeout': '订阅超时',
        'sfu-video-not-arriving': '未收到服务器视频', 'transport-failed': '传输连接失败',
        'server-bandwidth-limit': '服务器带宽限制', 'server-resource-limit': '服务器资源限制',
        'decoded-frames-resumed': '本机解码帧率已回升', 'decoded-frames-stopped': '本机解码帧率持续为零',
        'low-decoded-fps': '本机解码帧率持续偏低',
        'encoder-start-failed': '编码器启动后未产生视频帧', 'decoder-start-failed': '接收端未解码出首帧',
        'negotiation-failed': '编码协商失败', 'remote-codec-fallback': '双方实际使用了兼容编码',
        'producer-codec-failed': '服务器发布编码不可用', 'router-codec-fallback': '服务器能力匹配后使用兼容编码',
        'p2p-connection-failed': 'P2P 连接不可用，尝试服务器兜底', 'p2p-video-stalled': 'P2P 持续收包但未解码出画面',
        'turn-relay': 'P2P 实际经过 TURN 中继', 'sender-encoder-pressure': '多观看者下发送端持续编码受限',
        'sender-uplink-pressure': '多观看者下发送端持续接近上行预算', 'producer-created': '服务器视频发布已创建（待实际帧验证）',
    };
    const describe = (event) => {
        const type = event.类型;
        const content = event.内容 || {};
        let category = '通话';
        let text = '通话状态更新';
        if (/共享开始|共享停止/.test(type)) { category = '共享'; text = type === '共享开始' ? '共享画面开始观测' : '共享画面已停止'; }
        else if (type === '共享编码变化') { category = '配置'; text = `视频编码：${content.编码 || '不可用'}`; }
        else if (type === '共享编码回退') { category = '配置'; text = `共享编码决策：${content.primary || '兼容编码'}`; }
        else if (type === '共享分辨率变化') { category = '配置'; text = `视频分辨率：${content.宽} × ${content.高}`; }
        else if (type === '共享连接状态') { category = '路径'; text = `共享连接状态：${({ connected: '已连接', connecting: '连接中', disconnected: '已断开', failed: '失败', closed: '已关闭', '已采样': '已取得视频统计' }[content.状态] || '统计暂不可用')}`; }
        else if (type === '共享路径事件') { category = /failed|fallback/.test(content.event) ? '异常与恢复' : '路径'; text = routeEvents[content.event] || '共享传输状态变化'; }
        else if (type === '观看路径切换') { category = '路径'; text = `观看路径切换：${({ direct: 'P2P 直连', TURN: 'P2P · TURN 中继', unknown: '路径待确认', SFU: '服务器转发' }[content.路径] || content.路径 || '等待确认')}`; }
        else if (type === '共享卡顿记录') { category = '异常与恢复'; text = `浏览器报告新增画面停滞 ${content.区间卡顿次数} 次（观测时间，非停滞起点）`; }
        else if (/SFU接收|共享播放异常|共享播放恢复/.test(type)) {
            category = '异常与恢复';
            text = type === 'SFU接收回退诊断' ? '服务器接收异常，触发回退' : type === '共享播放恢复' || type === 'SFU接收恢复诊断' ? '解码帧率已回升（本机观测）' : '共享播放出现异常观测';
        }
        else if (type === '通话开始' || type === '通话结束') text = type;
        else if (/failed|failure|timeout|失败|异常/.test(type)) { category = '异常与恢复'; text = '通话操作失败或超时'; }
        else if (/connected|retry|recover/.test(type)) { category = '路径'; text = '通话连接状态更新'; }
        if (reasons[content.reason]) text += `：${reasons[content.reason]}`;
        return { category, text, scope: Number.isInteger(content.视频序号) && content.视频序号 > 0 ? `共享 ${content.视频序号}` : '通话级（未归属单个视频）' };
    };
    const selectEvents = (session, { category = '全部', scope = 'all', newest = false } = {}) =>
        (session?.事件 || []).map((event, index) => ({ event, index, ...describe(event) }))
            .filter((row) => (category === '全部' || row.category === category) &&
                (scope === 'all' || (scope === 'global' ? !row.event.内容?.视频序号 :
                    !row.event.内容?.视频序号 || String(row.event.内容.视频序号) === scope)))
            .sort((a, b) => ((Date.parse(a.event.时间) - Date.parse(b.event.时间)) || a.index - b.index) * (newest ? -1 : 1));
    let active;
    const show = ({ getLogs, subscribe, showRaw, shareOrdinal, host } = {}) => {
        active?.close();
        const node = (tag, text) => { const el = global.document.createElement(tag); if (text !== undefined) el.textContent = String(text); return el; };
        const dialog = node('dialog');
        active = dialog;
        dialog.className = 'voice-log-dialog voice-events-dialog no-drag';
        dialog.setAttribute('aria-label', '播放事件日志');
        const previousFocus = global.document.activeElement;
        const header = node('div'); header.className = 'voice-player-heading';
        const close = node('button', '关闭'); close.type = 'button';
        header.append(node('h2', '播放事件'), close);
        const toolbar = node('div'); toolbar.className = 'voice-events-filters';
        const select = (label) => { const wrapper = node('label', label); const el = node('select'); el.setAttribute('aria-label', label); wrapper.append(el); toolbar.append(wrapper); return el; };
        const sessionSelect = select('通话');
        const categorySelect = select('分类');
        for (const name of ['全部', '共享', '路径', '配置', '异常与恢复', '通话']) { const option = node('option', name); option.value = name; categorySelect.append(option); }
        categorySelect.value = '全部';
        const scopeSelect = select('范围');
        const order = select('时间排序');
        for (const [value, text] of [['oldest', '从早到晚'], ['newest', '最新在前']]) { const option = node('option', text); option.value = value; order.append(option); }
        order.value = 'oldest';
        const notice = node('p');
        const list = node('div'); list.className = 'voice-events-list';
        const raw = node('button', '查看 / 下载原始本机 JSON 日志'); raw.type = 'button';
        const refresh = node('button', '刷新记录'); refresh.type = 'button';
        dialog.append(header, toolbar, notice, refresh, list, raw);
        let selectedSession;
        let selectedScope = shareOrdinal ? String(shareOrdinal) : 'all';
        const expanded = new Set();
        const render = () => {
            if (dialog.open && !dialog.isConnected) { dialog.close(); return; }
            const logs = getLogs();
            const sessions = logs.sessions;
            const latest = sessions[logs.currentIndex] || sessions.at(-1);
            if (!selectedSession) selectedSession = latest?.开始时间;
            const options = sessions.map((session, index) => { const option = node('option', `${index === logs.currentIndex ? '当前通话' : '历史通话'} · ${session.开始时间}${session.结束时间 ? '（已结束）' : ''}`); option.value = session.开始时间; return option; });
            sessionSelect.replaceChildren(...options);
            let session = sessions.find((item) => item.开始时间 === selectedSession);
            if (!session) { session = latest; selectedSession = session?.开始时间; }
            sessionSelect.value = selectedSession || '';
            const ordinals = [...new Set((session?.事件 || []).map((event) => event.内容?.视频序号).filter((value) => Number.isInteger(value) && value > 0))];
            const scopes = [['all', '全部'], ['global', '仅通话级'], ...ordinals.map((ordinal) => [String(ordinal), `共享 ${ordinal} + 通话级`])];
            scopeSelect.replaceChildren(...scopes.map(([value, text]) => { const option = node('option', text); option.value = value; return option; }));
            if (!scopes.some(([value]) => value === selectedScope)) selectedScope = 'all';
            scopeSelect.value = selectedScope;
            notice.textContent = `${logs.storageState}。${session?.截断 ? '记录已截断，仅保留有界历史。' : ''}仅显示本机记录；通话级事件不能归因于当前视频。时间为本机时区，展开可查看 UTC 时间。静止画面低 FPS 不一定是故障。`;
            const rows = selectEvents(session, { category: categorySelect.value, scope: selectedScope, newest: order.value === 'newest' });
            list.replaceChildren(...rows.map((row) => {
                const item = node('details');
                const key = `${row.event.时间}:${row.event.相对开始_ms}:${row.event.类型}`;
                item.open = expanded.has(key);
                const date = new Date(row.event.时间);
                const time = Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
                }) : '时间不可用';
                const summary = node('summary', `${time} · ${row.scope} · ${row.text}`);
                const detail = node('pre');
                if (item.open) detail.textContent = JSON.stringify(row.event, null, 2);
                item.append(summary, detail);
                item.addEventListener('toggle', () => {
                    if (item.open) { expanded.add(key); detail.textContent = JSON.stringify(row.event, null, 2); }
                    else expanded.delete(key);
                });
                return item;
            }));
            if (!rows.length) list.append(node('p', '当前筛选下暂无事件。'));
        };
        sessionSelect.addEventListener('change', () => { selectedSession = sessionSelect.value; selectedScope = 'all'; expanded.clear(); render(); });
        categorySelect.addEventListener('change', render);
        scopeSelect.addEventListener('change', () => { selectedScope = scopeSelect.value; render(); });
        order.addEventListener('change', render);
        refresh.addEventListener('click', render);
        raw.addEventListener('click', showRaw);
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.stopPropagation(); });
        const unsubscribe = subscribe?.(render);
        dialog.addEventListener('close', () => { unsubscribe?.(); dialog.remove(); if (active === dialog) active = null; previousFocus?.isConnected && previousFocus.focus(); });
        (host || global.document.fullscreenElement || global.document.querySelector?.('.is-web-fullscreen') || global.document.body).append(dialog);
        render(); dialog.showModal();
        return dialog;
    };
    global.VoicePlayerEvents = { show, describe, selectEvents };
})(window);

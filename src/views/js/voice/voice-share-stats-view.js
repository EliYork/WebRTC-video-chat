(function exposeShareStatsView(global) {
    'use strict';
    const enabled = new WeakMap();
    const finite = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    const dimensions = (value) => value?.宽 > 0 && value?.高 > 0 ? `${value.宽} × ${value.高}` : '未采样';
    const model = (snapshot, now = Date.now(), hidden = false) => {
        if (!snapshot) return { status: '未采样，等待现有采样周期', groups: [] };
        const age = now - Date.parse(snapshot.采样时间);
        const stale = !Number.isFinite(age) || age < 0 || age > (hidden ? 10000 : 3500);
        const metric = (row, key, unit = '') => {
            if (stale || row?.统计状态 === '数据过期') return '数据过期';
            const value = finite(row?.[key]);
            return value !== null ? `${value}${unit}` : row?.指标状态?.[key] || '不可用';
        };
        const playback = snapshot.播放画面;
        const groups = [{ title: `${snapshot.角色} · 本机观测`, rows: [
            ['播放画面尺寸', stale ? '数据过期' : dimensions(playback)],
            ['播放提交 FPS', stale ? '数据过期' : playback?.预览隐藏 ? '本机预览已隐藏' : hidden || playback?.页面后台 ? '页面后台，暂停判读' :
                finite(playback?.提交合成器帧率) ?? snapshot.播放指标状态 ?? '未采样'],
        ], details: [['采样时间', snapshot.采样时间], ['播放暂停', playback?.暂停 ? '是' : '否']] }];
        for (const [label, key] of [['播放 FPS 窗口', '播放采样间隔_ms'], ['播放丢帧窗口', '播放丢帧采样间隔_ms'],
            ['最近帧解码准备', '最近帧解码准备_ms'], ['最近帧收齐至提交', '最近帧收齐到提交_ms'], ['最近帧回调滞后', '最近帧回调滞后_ms']]) {
            groups[0].details.push([label, metric(playback, key, ' ms')]);
        }
        if (snapshot.角色 === '共享者') groups[0].rows.unshift(['目标 FPS（设置）', finite(snapshot.共享目标?.frameRate) ?? '未设置'],
            ['采集轨道尺寸（设置）', stale ? '数据过期' : dimensions(snapshot.采集轨道设置)]);
        const decision = snapshot.编码器选择;
        if (decision) {
            groups[0].rows.push(['请求编码', ({ auto: '自动', av1: 'AV1 优先（实验）', h264: 'H.264 优先', vp8: 'VP8' }[decision.mode] || '未知')],
                ['本机预选（非实际编码）', decision.primary?.toUpperCase() || '未选定'], ['硬件加速', '状态未知']);
            groups[0].details.push(['AV1 编码能力声明', decision.support?.av1Send === true ? '支持（仍需实测）' : decision.support?.av1Send === false ? '未声明支持' : '未知']);
            if (decision.reason === 'manual-av1-below-target') groups[0].rows.push(['AV1 预检', '未达目标 FPS，继续实验；实际编码见连接统计']);
            for (const trial of decision.trials || []) {
                groups[0].details.push([`${trial.primary?.toUpperCase()} 预检测`, trial.reason || '未完成']);
                for (const row of trial.windows || []) groups[0].details.push(['预检测采集 / 编码 FPS', `${row.captureFps ?? '不可用'} / ${row.encodeFps ?? '不可用'} · ${row.actualCodec || '未确认'} · ${row.width || '?'}×${row.height || '?'}`]);
            }
        }
        for (const connection of snapshot.连接 || []) {
            const idleUplink = snapshot.角色 === '共享者' && connection.路径 === 'SFU' &&
                snapshot.共享路径变化?.hasUplink === true && snapshot.共享路径变化?.serverViewers === 0;
            const path = connection.路径 === 'SFU' ? (idleUplink ? 'SFU 备用上传（无观看者）' : '服务器转发') : connection.实际传输路径 === 'TURN' ? 'P2P · TURN 中继' : connection.实际传输路径 === 'direct' ? 'P2P 直连' : 'P2P · 路径未确认';
            const group = { title: `连接 ${connection.序号} · ${path}`, rows: [], details: [] };
            if (connection.编码协商) group.details.push(['协商编码（SDP）', stale ? '数据过期' : connection.编码协商.negotiated || '未确认'],
                ['编码启动验证', stale ? '数据过期' : connection.编码协商.status], ['兼容回退原因', connection.编码协商.reason || '无'], ['硬件加速', '状态未知']);
            if (connection.编码协商) group.details.push(['当前远端 SDP 含 AV1', stale ? '数据过期' : connection.编码协商.remoteSdpAV1 === true ? '是（解码仍需实测）' : connection.编码协商.remoteSdpAV1 === false ? '未包含（不代表不支持）' : '未知']);
            if (!connection.视频流?.length) group.rows.push(['状态', stale ? '数据过期' : connection.状态 || '等待视频统计']);
            for (const row of connection.视频流 || []) {
                group.rows.push(['编码', stale || row.统计状态 === '数据过期' ? '数据过期' : row.编码 || '不可用'],
                    ['RTP 画面尺寸', stale || row.统计状态 === '数据过期' ? '数据过期' : dimensions(row)]);
                const sending = row.方向 === '发送';
                if (sending && finite(row.原生输出帧率) !== null) group.rows.push(['原生输出 FPS', metric(row, '原生输出帧率')]);
                for (const [label, key] of sending ? [['采集 FPS', '区间采集帧率'], ['编码 FPS', '区间编码帧率'], ['发送 FPS', '区间发送帧率']]
                    : [['完整接收 FPS', '区间完整接收帧率'], ['解码 FPS', '区间解码帧率']]) {
                    const reportedKey = key === '区间采集帧率' ? '采集实际帧率' : ['区间编码帧率', '区间解码帧率'].includes(key) ? '浏览器报告帧率' : null;
                    if (finite(row[key]) === null && reportedKey && finite(row[reportedKey]) !== null) {
                        group.rows.push([`${label}（浏览器报告）`, metric(row, reportedKey)]);
                    } else group.rows.push([label, metric(row, key)]);
                }
                // Browser-reported instantaneous values stay separate from interval measurements.
                if (sending && finite(row.采集实际帧率) !== null) group.details.push(['采集 FPS（浏览器报告）', metric(row, '采集实际帧率')]);
                group.rows.push([sending ? row.码率口径 === '音视频合计' ? '发送码率（音视频）' : '发送码率' : '接收码率', metric(row, '码率_Mbps', ' Mbps')]);
                for (const [label, key, unit] of [['RTT', '往返延迟_ms', ' ms'], ['抖动', '抖动_ms', ' ms'], ['丢包率', '区间丢包率_%', ' %'], ['编解码耗时/帧', '每帧编解码_ms', ' ms'], ['缓冲等待/帧', '每帧抖动缓冲等待_ms', ' ms'], ['NACK', '区间NACK次数', ''], ['PLI', '区间PLI次数', ''], ['播放停滞次数', '区间卡顿次数', ''], ['统计区间', '采样间隔_ms', ' ms']]) {
                    group.details.push([label, metric(row, key, unit)]);
                }
                if (sending) group.details.push(['编码受限', stale ? '数据过期' : ({ none: '无', cpu: 'CPU', bandwidth: '带宽', other: '其他' }[row.编码受限原因] || '不可用')]);
            }
            groups.push(group);
        }
        if (groups.length === 1) groups[0].rows.push(['传输', '暂无传输连接']);
        return { status: stale ? '数据过期，等待新采样' : `${hidden ? '后台采样 · ' : ''}本机实时采样 · ${Math.max(0, Math.floor(age / 1000))} 秒前`, groups };
    };
    const create = (tile) => {
        const node = (tag, text) => {
            const el = global.document.createElement(tag);
            if (text !== undefined) el.textContent = String(text);
            return el;
        };
        const panel = node('section');
        panel.className = 'voice-share-stats no-drag';
        panel.setAttribute('aria-label', '共享视频实时统计');
        panel.hidden = !enabled.get(tile);
        const heading = node('div');
        heading.className = 'voice-player-heading';
        const status = node('span');
        const close = node('button', '隐藏');
        close.type = 'button';
        heading.append(node('strong', '视频统计'), close);
        const content = node('div');
        const details = node('details');
        details.append(node('summary', '详细指标'));
        const technical = node('div');
        details.append(technical);
        const note = node('p', 'FPS 均为本机观测；播放提交指送往合成器，不等于屏幕实际刷新。静止内容低帧率不一定异常。“未提供”指本次 RTC 统计无此字段，不能确定是否支持；未采样、不支持均不代表 0。');
        panel.append(heading, status, content, details, note);
        (tile.querySelector('.tile-body') || tile).append(panel);
        let cached;
        const update = (snapshot) => {
            cached = snapshot;
            if (panel.hidden) return;
            const value = model(cached, Date.now(), global.document.hidden);
            status.textContent = value.status;
            const render = (target, key) => {
                const children = [];
                for (const group of value.groups) {
                    const section = node('section');
                    section.append(node('strong', group.title));
                    const list = node('dl');
                    for (const [label, text] of group[key]) list.append(node('dt', label), node('dd', text));
                    section.append(list);
                    children.push(section);
                }
                target.replaceChildren(...children);
            };
            render(content, 'rows');
            if (details.open) render(technical, 'details');
        };
        details.addEventListener('toggle', () => update(cached));
        const toggle = () => { panel.hidden = !panel.hidden; enabled.set(tile, !panel.hidden); update(cached); };
        close.addEventListener('click', (event) => { event.stopPropagation(); toggle(); tile.querySelector('.voice-player-more')?.focus(); });
        panel.addEventListener('dblclick', (event) => event.stopPropagation());
        update();
        return { update, toggle, isVisible: () => !panel.hidden, remove: () => panel.remove() };
    };
    global.VoiceShareStatsView = { create, model };
})(window);

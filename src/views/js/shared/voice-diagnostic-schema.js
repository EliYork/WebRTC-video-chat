// Shared allowlist: reports exchanged between participants contain derived
// measurements only. Never forward raw stats, peer/device IDs or error messages.
const keys = new Set(`版本 诊断格式 角色 观看路径 采样时间 SFU服务器统计 本机音频 请求模式 实际模式 麦克风增益_百分比 浏览器降噪 AEC AEC采集方式 AEC回退 自动增益 非语音门控启用 处理器回退 最近切换失败 麦克风存活 放大播放 共享路径变化 采集轨道设置 宽 高 帧率 共享目标 编码器选择 播放画面 提交合成器帧率 区间播放丢帧 暂停 就绪状态 页面后台 连接 序号 路径 连接状态 ICE状态 发送参数核对 状态 视频流 方向 传输协议 编码 采集实际帧率 区间采集帧率 编码能效报告 实际帧率 帧率口径 采样间隔_ms 区间编码帧率 区间发送帧率 编码目标码率_Mbps 区间重传码率_Mbps 每包发送等待_ms 区间完整接收帧率 区间解码帧率 区间卡顿次数 区间卡顿时长_ms 每帧抖动缓冲等待_ms 每帧目标缓冲等待_ms 每帧组装耗时_ms 区间平均QP 区间NACK次数 区间PLI次数 码率_Mbps 区间丢包率_% 累计丢包 抖动_ms 往返延迟_ms 本端连接估计可用上行_Mbps 每帧编解码_ms 区间解码丢帧 累计卡顿次数 编码受限原因 采样时间_ms 入站 出站 码率_bps 累计字节 累计包数 请求 实际接受 不一致字段 启动码率提示_kbps 浏览器 平台 浏览器主版本 安全上下文 输出设备切换支持 WebAudio输出切换支持 音频 会话 共享 当前状态 事件 历史采样 开始时间 结束时间 结束原因 事件总数 采样总数 记录上限 截断 存储状态 静音 输出静音 输出增益_百分比 输入设备 输出设备 视频准备耗时_ms 音频流 音量 能量均方根 丢弃包数 隐藏采样数 样本总数 每包缓冲等待_ms 每包目标缓冲等待_ms 隐藏样本比例_% 采集格式 采样率 声道数 轨道静音 轨道存活 时间 相对开始_ms 类型 内容 处理链 设置切换中 切换结果 设备变更 部件 默认 自选 不支持 有效音量_百分比 语音音量_百分比 共享音量_百分比 共享静音 输出播放 回声消除值支持 请求AEC 请求浏览器降噪 请求自动增益 当前会话 未响应原因 日志覆盖说明`.split(' '));
for (const key of `mode code codecMode startBitrate frameRate resolutionPreset primary target width height probe passed reason windows captureFps encodeFps cacheHit ageMs preparationMs state serverViewers hasUplink routeHistory time event amplifiedPlayers contextState path status degradationPreference encodings maxBitrate maxFramerate scaleResolutionDownBy sessions events samples 参与者序号 连接用途 每样本缓冲平均等待_ms 每样本目标缓冲等待_ms`.split(' ')) keys.add(key);

for (const key of `共享音频采集 捕获来源 音频轨道数 排除通话声音支持 请求排除通话声音 实际排除通话声音 共享音频状态 语音播放 共享播放 播放器存在 原生静音 WebAudio放大 重复播放风险`.split(' ')) keys.add(key);

export function sanitizeVoiceDiagnostic(value) {
    let budget = 16000;
    const visit = (item, depth) => {
        if (--budget < 0 || depth > 16) return null;
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'number') return Number.isFinite(item) ? item : null;
        if (typeof item === 'string') return item.slice(0, 160);
        if (Array.isArray(item)) return item.slice(0, 250).map((row) => visit(row, depth + 1));
        if (!item || typeof item !== 'object') return null;
        return Object.fromEntries(Object.entries(item).filter(([key]) => keys.has(key))
            .map(([key, row]) => [key, visit(row, depth + 1)]));
    };
    const result = visit(value, 0);
    if (budget < 0 && result && !Array.isArray(result) && typeof result === 'object') result.截断 = true;
    return result;
}

// 共享 API 模块：被 status.js 和 home.js 复用
// API fallback 链：先 mcstatus.io（国内访问慢/被墙时）自动回退 mcsrvstat.us

const CHECK_TIMEOUT = 8000;

// 多 API 探测源：谁先返回有效数据用谁
export const API_SOURCES = [
    {
        name: 'mcstatus.io',
        url: (h, p) => `https://api.mcstatus.io/v2/status/java/${h}:${p}`
    },
    {
        name: 'mcsrvstat.us',
        url: (h, p) => `https://api.mcsrvstat.us/3/${h}:${p}`
    }
];

export function splitAddress(addr) {
    const [host, port] = addr.split(':');
    return { host, port: port || '25565' };
}

async function tryFetch(source, host, port) {
    const url = source.url(host, port);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    const start = Date.now();
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { data: await res.json(), latency: Date.now() - start };
    } finally {
        clearTimeout(timer);
    }
}

// 顺序尝试每个 API 源：mcstatus.io 失败/超时则回退 mcsrvstat.us
export async function fetchServerStatus(host, port) {
    const errors = [];
    for (const source of API_SOURCES) {
        try {
            const result = await tryFetch(source, host, port);
            console.log(`[api] ${source.name} responded in ${result.latency}ms`);
            return { ...result, source: source.name };
        } catch (err) {
            const msg = err.name === 'AbortError' ? '超时' : err.message;
            console.warn(`[api] ${source.name} 失败: ${msg}`);
            errors.push(`${source.name}: ${msg}`);
        }
    }
    throw new Error(`所有 API 都失败 — ${errors.join('; ')}`);
}

// 统一解析：自动识别 mcstatus.io / mcsrvstat.us 两种响应格式
export function normalize(raw, source, apiLatency = 0) {
    if (!raw || !raw.online) {
        return { online: false };
    }

    // mcstatus.io: raw.version 是 { name_clean, name_raw }
    // mcsrvstat.us: raw.version 是 string
    const versionObj = typeof raw.version === 'object' && raw.version !== null ? raw.version : null;
    const version = versionObj
        ? (versionObj.name_clean || versionObj.name_raw || '未知')
        : (raw.version || '未知');

    // mcstatus.io: motd.clean 是 string（按 \n 拆）
    // mcsrvstat.us: motd.clean 是 array
    let motd = [];
    if (typeof raw.motd?.clean === 'string') {
        motd = raw.motd.clean.split('\n').filter(Boolean);
    } else if (Array.isArray(raw.motd?.clean)) {
        motd = raw.motd.clean;
    } else if (Array.isArray(raw.motd?.raw)) {
        motd = raw.motd.raw;
    }

    // mcstatus.io 不返回 ping，用 API 响应延迟；mcsrvstat.us 返回 debug.ping
    let ping = apiLatency;
    if (source === 'mcsrvstat.us') {
        const rp = raw.debug?.ping;
        if (typeof rp === 'number') ping = rp;
        else if (rp === true) ping = -2;       // SRV 解析：在线但延迟未知
        else if (rp === false) ping = -1;      // 超时
    }

    return {
        online: true,
        players: raw.players?.online ?? 0,
        maxPlayers: raw.players?.max ?? 0,
        version,
        software: raw.software || null,
        ping,
        motd,
        playerList: raw.players?.list || []  // mcstatus.io: [{uuid, name_clean}]; mcsrvstat.us: ["name"]
    };
}

// 把 ping 数值映射到 0-5 信号等级（-1=离线，-2=SRV 解析）
export function getSignalLevel(ping) {
    if (ping === -1) return 0;
    if (ping === -2) return 5;
    if (ping < 50) return 5;       // 极佳
    if (ping < 150) return 4;      // 良好
    if (ping < 300) return 3;      // 一般
    if (ping < 600) return 2;      // 较差
    if (ping < 1000) return 1;     // 极差
    return 0;
}

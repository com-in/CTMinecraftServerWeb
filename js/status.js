// 服务器状态模块：拉取服务器数据并以 MC 服务器列表风格渲染
// API 通信委托给 ./api.js（status 和 home 共享）
import { showToast } from './ui.js';
import {
    splitAddress,
    fetchServerStatus,
    normalize,
    getSignalLevel
} from './api.js';

const REFRESH_INTERVAL = 300000;     // 5 分钟
const CHART_INTERVAL = 5000;         // 5 秒
const CHART_MAX_POINTS = 60;         // 保留 60 个数据点
const DEFAULT_MAX_PLAYERS = { main: 100 };
const FALLBACK_ICON = 'images/server-icon.png';
const DISPLAY_NAME = 'GCMC';

const SERVERS = [
    {
        id: 'main',
        // 实际查询地址：直接走 IP:port
        address: 'panel.ddymcmb.cn:30017',
        // 展示给玩家的地址：保持原友好域名
        displayAddress: 'mcs.acmcdev.top',
        name: '主服务器'
    }
];

let isChecking = false;
let chartInstance = null;
let chartDataPoints = [];  // { time: 'HH:MM:SS', players: number }

function isFileProtocol() {
    return window.location.protocol === 'file:';
}

function fakeStatus() {
    return {
        online: true,
        players: Math.floor(Math.random() * 20),
        maxPlayers: 100,
        version: 'Paper 1.20.1',
        software: null,
        ping: Math.floor(Math.random() * 100) + 20,
        motd: ['GCMC 原版生存服欢迎您！', '加入我们，开启纯粹的 Minecraft 生存之旅！'],
        icon: null,
        playerList: []
    };
}

async function checkServer(serverAddress) {
    if (isFileProtocol()) return fakeStatus();
    const { host, port } = splitAddress(serverAddress);
    try {
        const { data, latency, source } = await fetchServerStatus(host, port);
        return normalize(data, source, latency);
    } catch (err) {
        console.warn(`检查 ${serverAddress} 失败，使用模拟数据:`, err.message);
        showToast('服务器状态查询失败，已使用本地数据', { type: 'warning' });
        return fakeStatus();
    }
}

async function checkServerWithRetry(serverAddress) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
        try {
            return await checkServer(serverAddress);
        } catch (err) {
            lastErr = err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw lastErr;
}

// ---------- 工具 ----------

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------- 渲染 ----------

function setDot(serverId, state) {
    const dot = document.getElementById(`${serverId}-dot`);
    if (!dot) return;
    dot.className = `server-dot ${state}`;
    dot.title = ({ loading: '加载中', online: '在线', offline: '离线' })[state] || '';
}

// 服务器 icon 用本地缓存版本（images/server-icon.png），避免每次请求都拖 base64
function setIcon(serverId) {
    const img = document.getElementById(`${serverId}-icon`);
    if (!img) return;
    img.onerror = null;
    img.classList.remove('loading');
    img.src = FALLBACK_ICON;
}

function setName(serverId, hostname) {
    const el = document.getElementById(`${serverId}-name`);
    if (!el) return;
    el.textContent = hostname || DISPLAY_NAME;
}

function setAddress(serverId, displayAddress) {
    const el = document.getElementById(`${serverId}-address`);
    if (el) el.textContent = displayAddress || '';
}

function setBars(serverId, level) {
    const bars = document.getElementById(`${serverId}-bars`);
    if (bars) bars.className = `signal-bars level-${level}`;
}

function setPingText(serverId, ping) {
    const el = document.getElementById(`${serverId}-ping`);
    if (!el) return;
    if (ping === -2) el.textContent = '在线';
    else if (ping < 0) el.textContent = '超时';
    else el.textContent = `${ping}ms`;
}

function setPlayers(serverId, online, max) {
    const el = document.getElementById(`${serverId}-players`);
    if (el) el.textContent = `${online}/${max}`;
}

function setVersion(serverId, version, software) {
    const el = document.getElementById(`${serverId}-version`);
    if (el) el.textContent = software ? `${software} ${version}` : version;
}

function setMotd(serverId, motdLines, offline) {
    const el = document.getElementById(`${serverId}-motd`);
    if (!el) return;
    if (offline) {
        el.innerHTML = '<div class="motd-line motd-offline">服务器当前无法连接</div>';
        return;
    }
    const lines = (Array.isArray(motdLines) && motdLines.length) ? motdLines : ['欢迎加入 GCMC！'];
    el.innerHTML = lines.map(line =>
        `<div class="motd-line">${escapeHtml(line)}</div>`
    ).join('');
}

function setCardLoading(server) {
    const { id, displayAddress } = server;
    setDot(id, 'loading');
    setIcon(id);
    setName(id, DISPLAY_NAME);
    setAddress(id, displayAddress);
    setBars(id, 0);
    setPingText(id, -1);
    setPlayers(id, '--', '--');
    setVersion(id, '--');
    setMotd(id, ['正在获取服务器信息...'], false);
}

function setCardOnline(server, status) {
    const { id, displayAddress } = server;
    setDot(id, 'online');
    setIcon(id);
    setName(id, DISPLAY_NAME);
    setAddress(id, displayAddress);
    setBars(id, getSignalLevel(status.ping));
    setPingText(id, status.ping);
    setPlayers(id, status.players, status.maxPlayers);
    setVersion(id, status.version, status.software);
    setMotd(id, status.motd, false);
}

function setCardOffline(server) {
    const { id, displayAddress } = server;
    setDot(id, 'offline');
    setIcon(id);
    setAddress(id, displayAddress);
    setBars(id, 0);
    setPingText(id, -1);
    setPlayers(id, 0, 100);
    setVersion(id, '无法获取');
    setMotd(id, null, true);
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function formatTime(date) {
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ---------- 刷新按钮 ----------

function setRefreshButtonState(checking) {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.disabled = checking;
    btn.classList.toggle('spinning', checking);
    const text = btn.querySelector('.refresh-btn-text');
    if (text) text.textContent = checking ? '刷新中…' : '刷新';
}

function bindRefreshButton() {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', () => { if (!isChecking) checkAllServers(); });
}

// ---------- 折线图 ----------

function getChartColors() {
    const isDark = document.documentElement.classList.contains('dark-theme');
    return {
        line: isDark ? '#ffd700' : '#c9a227',
        fill: isDark ? 'rgba(255,215,0,0.12)' : 'rgba(201,162,39,0.1)',
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        text: isDark ? '#b0b0b0' : '#7f8c8d'
    };
}

function updateChartColors() {
    if (!chartInstance) return;
    const colors = getChartColors();
    chartInstance.data.datasets[0].borderColor = colors.line;
    chartInstance.data.datasets[0].backgroundColor = colors.fill;
    chartInstance.options.scales.x.ticks.color = colors.text;
    chartInstance.options.scales.x.grid.color = colors.grid;
    chartInstance.options.scales.y.ticks.color = colors.text;
    chartInstance.options.scales.y.grid.color = colors.grid;
    chartInstance.update('none');
}

function addDataPoint(players) {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    chartDataPoints.push({ time, players });
    if (chartDataPoints.length > CHART_MAX_POINTS) {
        chartDataPoints.shift();
    }
    if (!chartInstance) return;
    chartInstance.data.labels = chartDataPoints.map(d => d.time);
    chartInstance.data.datasets[0].data = chartDataPoints.map(d => d.players);
    chartInstance.update('none');
}

function initChart() {
    const canvas = document.getElementById('player-chart');
    if (!canvas) return;
    const colors = getChartColors();
    try {
        chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '在线人数',
                data: [],
                borderColor: colors.line,
                backgroundColor: colors.fill,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: colors.text, font: { size: 10 }, maxTicksLimit: 10 },
                    grid: { color: colors.grid }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: colors.text, stepSize: 1, precision: 0 },
                    grid: { color: colors.grid }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
    } catch (e) {
        console.warn('Chart.js 初始化失败:', e.message);
        chartInstance = null;
    }
}

async function ensureChart(callback) {
    if (typeof Chart !== 'undefined') { callback(); return; }
    // Chart.js CDN 未加载，尝试备选源
    const fallbacks = [
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', // 备用，优先 vendor/chartjs/chart.umd.min.js
        'https://unpkg.com/chart.js@4.4.7/dist/chart.umd.min.js'
    ];
    for (const url of fallbacks) {
        try {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
            if (typeof Chart !== 'undefined') { callback(); return; }
        } catch { /* 继续尝试下一个 */ }
    }
    console.warn('Chart.js 所有 CDN 加载失败，折线图不可用');
}

async function updateChartPlayers() {
    const { host, port } = splitAddress(SERVERS[0].address);
    try {
        const { data } = await fetchServerStatus(host, port);
        const result = normalize(data, '', -1);
        addDataPoint(result.players);
        renderPlayerList(result.playerList, result.players);
    } catch {
        // 静默失败，保持上次数据
    }
}

// ---------- 玩家列表 ----------

function getPlayerName(player) {
    if (typeof player === 'string') return player;
    return player.name_clean || player.name_raw || 'Unknown';
}

function getPlayerAvatarUrl(player) {
    const id = typeof player === 'string' ? player : (player.uuid || getPlayerName(player));
    return `https://mc-heads.net/avatar/${encodeURIComponent(id)}/28`;
}

function renderPlayerList(playerList, onlineCount) {
    const container = document.getElementById('player-list');
    if (!container) return;
    if (!playerList || playerList.length === 0) {
        container.innerHTML = `<p class="player-list-empty">${onlineCount > 0 ? `${onlineCount} 人在线（列表未获取）` : '暂无在线玩家'}</p>`;
        return;
    }
    container.innerHTML = playerList.map(p => {
        const name = getPlayerName(p);
        const safeName = escapeHtml(name);
        const avatarUrl = getPlayerAvatarUrl(p);
        return `<div class="player-item">
            <img class="player-avatar" src="${avatarUrl}" alt="${safeName}" loading="lazy" onerror="this.style.display='none'">
            <span class="player-name">${safeName}</span>
        </div>`;
    }).join('');
}

// ---------- 主流程 ----------

async function checkAllServers() {
    if (isChecking) return;
    isChecking = true;
    setRefreshButtonState(true);
    try {
        SERVERS.forEach(setCardLoading);
        const results = await Promise.allSettled(
            SERVERS.map(async s => ({ ...s, ...(await checkServerWithRetry(s.address)) }))
        );
        results.forEach((r, i) => {
            const server = SERVERS[i];
            if (r.status === 'fulfilled' && r.value.online) {
                setCardOnline(server, r.value);
                // 每次完整刷新也记录到图表
                addDataPoint(r.value.players);
                // 更新玩家列表
                renderPlayerList(r.value.playerList, r.value.players);
            } else {
                setCardOffline(server);
                addDataPoint(0);
            }
        });
        const players = results.reduce((sum, r) =>
            sum + (r.status === 'fulfilled' && r.value.online ? r.value.players : 0), 0);
        const onlineCount = results.filter(r => r.status === 'fulfilled' && r.value.online).length;
        const total = results.length;
        const uptime = total > 0 ? Math.round((onlineCount / total) * 100) : 0;
        setText('total-players', players);
        setText('avg-uptime-summary', `${uptime}%`);
        setText('last-updated', formatTime(new Date()));
    } catch (err) {
        console.error('检查服务器状态出错:', err);
        showToast('服务器状态检查失败', { type: 'error' });
    } finally {
        isChecking = false;
        setRefreshButtonState(false);
    }
}

export function initServerStatus() {
    if (!document.getElementById('status')) return;
    bindRefreshButton();
    ensureChart(() => {
        initChart();
        checkAllServers().then(() => {
            // 首次加载后启动 5 秒轮询
            setInterval(updateChartPlayers, CHART_INTERVAL);
        });
    });
    setInterval(() => { if (!isChecking) checkAllServers(); }, REFRESH_INTERVAL);
    // 监听主题切换，更新图表颜色
    const observer = new MutationObserver(() => updateChartColors());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

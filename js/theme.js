// 主题切换模块：light / dark / auto（跟随系统）

const THEME_KEY = 'theme';
const THEME_CYCLE = ['light', 'dark', 'auto'];
const ICON_MAP = {
    light: 'fas fa-sun',
    dark: 'fas fa-moon',
    auto: 'fas fa-circle-half-stroke'
};
const TITLE_MAP = {
    light: '亮色模式',
    dark: '暗黑模式',
    auto: '跟随系统'
};

let systemMedia = null;
let systemListener = null;

function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 忽略 */ }
}

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getCurrentStoredTheme() {
    return safeGet(THEME_KEY) || 'light';
}

function getActiveTheme() {
    const stored = getCurrentStoredTheme();
    return stored === 'auto' ? getSystemTheme() : stored;
}

function applyTheme(rawTheme) {
    const effective = rawTheme === 'auto' ? getSystemTheme() : rawTheme;
    document.documentElement.className = `${effective}-theme`;
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.className = ICON_MAP[rawTheme] || ICON_MAP.light;
        btn.title = TITLE_MAP[rawTheme] || '';
    }
}

function startSystemListener() {
    if (!systemMedia) {
        systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
        systemListener = () => {
            if (getCurrentStoredTheme() === 'auto') {
                applyTheme('auto');
            }
        };
        systemMedia.addEventListener('change', systemListener);
    }
}

export function initTheme() {
    const saved = safeGet(THEME_KEY) || 'light';
    const theme = THEME_CYCLE.includes(saved) ? saved : 'light';
    applyTheme(theme);
    startSystemListener();
}

export function bindThemeToggle() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const current = getCurrentStoredTheme();
        const idx = THEME_CYCLE.indexOf(current);
        const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        applyTheme(next);
        safeSet(THEME_KEY, next);
    });
}

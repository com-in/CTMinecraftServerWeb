// 入口模块：按页面调用对应功能
import { initTheme, bindThemeToggle } from './theme.js';
import {
    initSmoothScroll,
    initScrollReveal,
    initKeyboardNav,
    initErrorHandling
} from './ui.js';
import { initCopyButtons } from './copy.js';
import { initServerStatus } from './status.js';
import { isLoggedIn } from './auth.js';

function initHamburger() {
    const btn = document.getElementById('hamburger-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        document.body.classList.toggle('nav-open');
    });
    // 点击导航链接后自动关闭菜单
    document.querySelectorAll('.nav-menu .nav-link').forEach(link => {
        link.addEventListener('click', () => {
            document.body.classList.remove('nav-open');
        });
    });
}

// 根据登录状态更新导航栏
function initAuthNav() {
    const navLogin = document.getElementById('nav-login');
    const navRegister = document.getElementById('nav-register');
    const navProfile = document.getElementById('nav-profile');

    if (isLoggedIn()) {
        if (navLogin) navLogin.style.display = 'none';
        if (navRegister) navRegister.style.display = 'none';
        if (navProfile) navProfile.style.display = '';
    } else {
        if (navLogin) navLogin.style.display = '';
        if (navRegister) navRegister.style.display = '';
        if (navProfile) navProfile.style.display = 'none';
    }
}

function init() {
    initTheme();
    bindThemeToggle();
    initHamburger();
    initAuthNav();

    // 全局交互
    initSmoothScroll();
    initScrollReveal();
    initKeyboardNav();
    initErrorHandling();
    initCopyButtons();

    // 页面特定
    if (window.location.pathname.includes('status.html')) {
        initServerStatus();
    } else if (window.location.pathname.includes('downloads.html')) {
        initDownloadsPage();
    }
}

// 下载页：哈希校验面板切换
function initDownloadsPage() {
    document.querySelectorAll('[data-toggle="hash-panel"]').forEach(btn => {
        btn.addEventListener('click', () => {
            // 找同一卡片内的 .hash-panel
            const card = btn.closest('.download-card');
            const panel = card?.querySelector('.hash-panel');
            if (!panel) return;
            const isOpen = !panel.hidden;
            panel.hidden = isOpen;
            btn.setAttribute('aria-expanded', String(!isOpen));
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

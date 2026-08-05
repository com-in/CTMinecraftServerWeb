// 通用 UI 模块：toast、平滑滚动、加载动画、键盘导航

let toastStyleInjected = false;
function ensureToastStyle() {
    if (toastStyleInjected) return;
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ctmc-slide-in {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
        }
        .ctmc-toast {
            position: fixed;
            top: 100px;
            right: 20px;
            background: #2ecc71;
            color: #fff;
            padding: 1rem 2rem;
            border-radius: 0.5rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1001;
            animation: ctmc-slide-in 0.3s ease;
            white-space: pre-line;
        }
        .ctmc-toast.error { background: #e74c3c; }
    `;
    document.head.appendChild(style);
    toastStyleInjected = true;
}

export function showToast(message, { type = 'success', duration = 3000 } = {}) {
    ensureToastStyle();
    const toast = document.createElement('div');
    toast.className = `ctmc-toast${type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

export function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', e => {
            const href = anchor.getAttribute('href');
            if (href === '#' || href.length < 2) return;
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

export function initScrollReveal() {
    const elements = document.querySelectorAll('.hero-content, .feature-card, .status-card, .download-card');
    if (!elements.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    elements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

export function initKeyboardNav() {
    const links = Array.from(document.querySelectorAll('.nav-link'));
    if (!links.length) return;
    document.addEventListener('keydown', e => {
        // 仅在未聚焦于输入控件时触发
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;

        const active = document.querySelector('.nav-link.active') || links[0];
        const idx = links.indexOf(active);
        let next = -1;
        if (e.key === 'ArrowRight') next = (idx + 1) % links.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + links.length) % links.length;
        if (next >= 0 && links[next]) {
            e.preventDefault();
            window.location.href = links[next].getAttribute('href');
        }
    });
}

export function initErrorHandling() {
    window.addEventListener('error', e => console.error('JS错误:', e.error));
    window.addEventListener('unhandledrejection', e => console.error('Promise拒绝:', e.reason));
}

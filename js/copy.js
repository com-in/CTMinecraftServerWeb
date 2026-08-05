// 复制文本到剪贴板（含降级方案）
import { showToast } from './ui.js';

async function writeViaClipboardApi(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    return false;
}

function writeViaExecCommand(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
}

export async function copyText(text) {
    try {
        if (await writeViaClipboardApi(text)) return true;
    } catch (e) {
        console.warn('Clipboard API 失败，降级:', e);
    }
    return writeViaExecCommand(text);
}

// 复制按钮：带视觉反馈和 toast
function flashCopied(button) {
    if (!button) return;
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 2000);
}

export function initCopyButtons() {
    const buttons = document.querySelectorAll('[data-copy]');
    buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const text = btn.dataset.copy;
            const ok = await copyText(text);
            if (ok) {
                showToast('已复制到剪贴板！');
                flashCopied(btn);
            } else {
                showToast(`复制失败，请手动复制：\n${text}`, { type: 'error', duration: 5000 });
            }
        });
    });
}

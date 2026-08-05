// 浏览器端 SHA-256 哈希模块
// 使用 Web Crypto API (SubtleCrypto)，所有现代浏览器均原生支持

/**
 * 对字符串进行 SHA-256 哈希，返回小写十六进制字符串
 * @param {string} message - 原始文本
 * @returns {Promise<string>} 64字符的十六进制哈希值
 */
export async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 同步版本（通过已计算的哈希，用于已有值）
 * 注意：此函数仅为接口一致性，实际 SHA-256 需异步计算
 * @deprecated 请使用 await sha256()
 */
export function sha256Sync(message) {
    // Web Crypto 不支持同步 SHA-256
    throw new Error('请使用 await sha256(message) 代替同步调用');
}

/**
 * HTML 转义，防止 XSS
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的安全字符串
 */
export function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
    };
    return String(str).replace(/[&<>"'/]/g, ch => map[ch]);
}

/**
 * 安全地设置 DOM 元素的文本内容（防止 XSS）
 * @param {HTMLElement} el - 目标元素
 * @param {string} text - 文本内容
 */
export function safeText(el, text) {
    if (el) el.textContent = text;
}

/**
 * 安全的 innerHTML（仅限已知安全的内容）
 * 对用户输入内容必须先 escapeHtml 再拼接
 * @param {HTMLElement} el - 目标元素
 * @param {string} userInput - 用户输入
 * @returns {string} 转义后的字符串
 */
export function safeHtml(userInput) {
    return escapeHtml(userInput);
}

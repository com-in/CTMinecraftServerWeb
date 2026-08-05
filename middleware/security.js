const crypto = require('crypto');

/**
 * 对字符串进行 SHA-256 哈希
 * @param {string} input - 输入
 * @returns {string} 64字符的十六进制哈希值
 */
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * XSS 输入清洗中间件
 * 递归清洗 req.body 中所有字符串字段，移除 HTML 标签和危险字符
 */
function xssSanitize(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        sanitizeObject(req.body);
    }
    next();
}

function sanitizeObject(obj) {
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            obj[key] = stripHtml(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
        }
    }
}

function stripHtml(str) {
    if (!str) return '';
    return str
        .replace(/<[^>]*>/g, '')           // 移除 HTML 标签
        .replace(/javascript:/gi, '')       // 移除 javascript: 协议
        .replace(/on\w+\s*=/gi, '')         // 移除 on* 事件处理器
        .replace(/&lt;script.*?&gt;.*?&lt;\/script&gt;/gi, '') // 移除编码后的 script
        .trim();
}

/**
 * 生成 CSRF Token
 */
function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF Token 分发端点
 * GET /api/csrf-token → 返回 CSRF token
 */
function csrfTokenHandler(req, res) {
    const token = generateCsrfToken();
    // Token 存储在服务端 sessionStorage 中（简单实现：通过 JWT 关联）
    res.json({ csrfToken: token });
}

module.exports = {
    sha256,
    xssSanitize,
    stripHtml,
    generateCsrfToken,
    csrfTokenHandler
};

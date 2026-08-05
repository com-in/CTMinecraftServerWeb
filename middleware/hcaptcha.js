const { settingsStmts } = require('../models/db');

const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

/**
 * 验证 hCaptcha token
 * @param {string} token - 前端 h-captcha-response
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function verifyHCaptcha(token) {
    if (!token) {
        return { success: false, error: '请完成人机验证' };
    }

    const secret = settingsStmts.get('hcaptcha_secret') || process.env.HCAPTCHA_SECRET || '';
    if (!secret) {
        console.warn('[hCaptcha] 未配置密钥，跳过验证');
        return { success: true, degraded: true };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const formData = new URLSearchParams();
        formData.append('secret', secret);
        formData.append('response', token);

        const res = await fetch(HCAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const result = await res.json();

        if (result.success) {
            return { success: true };
        } else {
            const errorCodes = result['error-codes'] || [];
            console.warn('[hCaptcha] 验证失败:', errorCodes.join(', '));
            return { success: false, error: '人机验证失败，请重试' };
        }
    } catch (err) {
        console.error('[hCaptcha] 请求验证服务失败:', err.message);
        // 服务不可达 → 降级放行（依赖速率限制兜底）
        console.warn('[hCaptcha] 验证服务不可达，降级放行');
        return { success: true, degraded: true };
    }
}

/**
 * Express 中间件：要求 hCaptcha token
 */
function hcaptchaRequired(req, res, next) {
    const { hcaptchaToken } = req.body;

    if (!hcaptchaToken) {
        return res.status(400).json({ error: '请完成人机验证' });
    }

    // 降级方案：本地算术题生成的 token 直接放行
    if (hcaptchaToken === 'fallback_ok') {
        return next();
    }

    verifyHCaptcha(hcaptchaToken)
        .then(result => {
            if (result.success) {
                next();
            } else {
                res.status(400).json({ error: result.error || '人机验证失败' });
            }
        })
        .catch(() => {
            res.status(500).json({ error: '验证服务内部错误' });
        });
}

module.exports = { verifyHCaptcha, hcaptchaRequired };

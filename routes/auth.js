const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authenticator } = require('@otplib/preset-default');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const {
    stmts, logStmts, activityStmts, sessionStmts, verifyStmts
} = require('../models/db');
const {
    generateToken, generateTempToken, verifyTempToken, hashToken,
    authRequired, banCheck, getClientIp, MAX_FAILED_ATTEMPTS
} = require('../middleware/auth');
const { hcaptchaRequired } = require('../middleware/hcaptcha');

const router = express.Router();

// ===== 邮箱发送器 =====
const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
});

function getIp(req) { return getClientIp(req); }
function getUa(req) { return req.headers['user-agent'] || ''; }

// 记录活动
function logActivity(userId, action, detail, req) {
    activityStmts.addActivity(userId, action, detail, getIp(req));
}

// ===== 注册 =====
router.post('/register', hcaptchaRequired, (req, res) => {
    const { username, email, password, nickname } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度需在 2-20 个字符之间' });
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
        return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和中文' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度不能少于 6 个字符' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: '邮箱格式不正确' });
    }

    if (stmts.findByUsername(username)) {
        return res.status(409).json({ error: '用户名已被注册' });
    }
    if (stmts.findByEmail(email)) {
        return res.status(409).json({ error: '邮箱已被注册' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = stmts.insert(username, email, passwordHash, nickname || '', 'user');

    // 发送邮箱验证码
    const code = crypto.randomInt(100000, 999999).toString();
    verifyStmts.createVerification(userId, email, code);

    // 尝试发送邮件，失败则输出到控制台
    trySendVerification(email, code, username);

    res.status(201).json({
        message: '注册成功，请验证邮箱',
        userId,
        verificationHint: '验证码已发送到您的邮箱（实际环境中），当前验证码: ' + code
    });
});

function trySendVerification(email, code, username) {
    console.log(`[邮箱验证] 用户: ${username}, 邮箱: ${email}, 验证码: ${code}`);
    mailer.sendMail({
        from: '"GCMC" <noreply@GCMC.local>',
        to: email,
        subject: 'GCMC 邮箱验证码',
        text: `你的验证码是: ${code}，有效期 10 分钟。`,
        html: `<h2>GCMC 邮箱验证</h2><p>你的验证码是: <strong style="font-size:24px;color:#3498db;">${code}</strong></p><p>有效期 10 分钟。</p>`
    }).catch(() => {});
}

// ===== 发送邮箱验证码 =====
router.post('/send-verification', authRequired, (req, res) => {
    const user = stmts.findByIdFull(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.email_verified) return res.status(400).json({ error: '邮箱已验证' });

    const code = crypto.randomInt(100000, 999999).toString();
    verifyStmts.createVerification(user.id, user.email, code);
    trySendVerification(user.email, code, user.username);
    logActivity(user.id, 'send_verification', '发送邮箱验证码', req);

    res.json({ message: '验证码已发送', verificationHint: code });
});

// ===== 验证邮箱 =====
router.post('/verify-email', authRequired, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '请输入验证码' });

    const ok = verifyStmts.verifyCode(req.user.id, code);
    if (!ok) return res.status(400).json({ error: '验证码无效或已过期' });

    stmts.setEmailVerified(req.user.id);
    logActivity(req.user.id, 'verify_email', '邮箱验证成功', req);
    res.json({ message: '邮箱验证成功' });
});

// ===== 登录 =====
router.post('/login', hcaptchaRequired, (req, res) => {
    const { username, password, rememberMe } = req.body;
    const ip = getIp(req);
    const ua = getUa(req);

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = stmts.findByUsername(username);
    if (!user) {
        logStmts.addLoginLog(null, ip, ua, false, '用户不存在: ' + username);
        return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 锁定逻辑已移除（按用户要求）

    // 检查封禁
    if (user.status === 'banned') {
        logStmts.addLoginLog(user.id, ip, ua, false, '账号已封禁');
        return res.status(403).json({ error: '账号已被封禁', ban_reason: user.ban_reason || '未提供原因' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
        logStmts.addLoginLog(user.id, ip, ua, false, '密码错误');
        return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 2FA 检查
    if (user.totp_enabled) {
        const tempToken = generateTempToken(user.id);
        logStmts.addLoginLog(user.id, ip, ua, true, '密码验证通过，等待 2FA');
        return res.json({
            require2FA: true,
            tempToken,
            message: '请输入 2FA 验证码'
        });
    }

    // 正常登录成功
    stmts.unlockAccount(user.id);
    const token = generateToken(user, !!rememberMe);
    sessionStmts.createSession(user.id, hashToken(token),
        rememberMe ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        ua, ip);
    logStmts.addLoginLog(user.id, ip, ua, true, '登录成功');
    logActivity(user.id, 'login', '登录成功', req);

    res.json({
        message: '登录成功',
        token,
        user: {
            id: user.id, username: user.username, email: user.email,
            nickname: user.nickname || '', role: user.role, status: user.status,
            totpEnabled: !!user.totp_enabled, emailVerified: !!user.email_verified,
            createdAt: user.created_at
        }
    });
});

// ===== 2FA - 初始化设置 =====
router.get('/2fa/setup', authRequired, (req, res) => {
    const user = stmts.findByIdFull(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.totp_enabled) return res.status(400).json({ error: '2FA 已启用' });

    const secret = authenticator.generateSecret();
    stmts.updateTotp(secret, 0, req.user.id);

    const otpauth = authenticator.keyuri(user.username, 'GCMC', secret);
    QRCode.toDataURL(otpauth, (err, url) => {
        if (err) return res.status(500).json({ error: '生成二维码失败' });
        res.json({ secret, qrcode: url, manualKey: secret });
    });
});

// ===== 2FA - 启用 =====
router.post('/2fa/enable', authRequired, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '请输入验证码' });

    const user = stmts.findByIdFull(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!user.totp_secret) return res.status(400).json({ error: '请先初始化 2FA 设置' });
    if (user.totp_enabled) return res.status(400).json({ error: '2FA 已启用' });

    const valid = authenticator.verify({ token: code, secret: user.totp_secret });
    if (!valid) return res.status(400).json({ error: '验证码无效' });

    stmts.updateTotp(user.totp_secret, 1, req.user.id);
    logActivity(req.user.id, '2fa_enable', '启用两步验证', req);
    res.json({ message: '两步验证已启用' });
});

// ===== 2FA - 禁用 =====
router.post('/2fa/disable', authRequired, (req, res) => {
    const { password, code } = req.body;
    if (!password) return res.status(400).json({ error: '请输入密码' });

    const user = stmts.findByIdFull(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!user.totp_enabled) return res.status(400).json({ error: '2FA 未启用' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: '密码不正确' });
    }

    if (code) {
        const valid = authenticator.verify({ token: code, secret: user.totp_secret });
        if (!valid) return res.status(400).json({ error: '2FA 验证码无效' });
    }

    stmts.updateTotp('', 0, req.user.id);
    logActivity(req.user.id, '2fa_disable', '禁用两步验证', req);
    res.json({ message: '两步验证已禁用' });
});

// ===== 2FA - 二次验证 =====
router.post('/2fa/verify', (req, res) => {
    const { tempToken, code, rememberMe } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: '参数不完整' });

    const decoded = verifyTempToken(tempToken);
    if (!decoded) return res.status(401).json({ error: '临时令牌无效或已过期' });

    const user = stmts.findByIdFull(decoded.id);
    if (!user || !user.totp_enabled) return res.status(400).json({ error: '用户未启用 2FA' });

    const valid = authenticator.verify({ token: code, secret: user.totp_secret });
    if (!valid) {
        logStmts.addLoginLog(user.id, getIp(req), getUa(req), false, '2FA 验证失败');
        return res.status(401).json({ error: '验证码无效' });
    }

    stmts.unlockAccount(user.id);
    const token = generateToken(user, !!rememberMe);
    const ip = getIp(req), ua = getUa(req);
    sessionStmts.createSession(user.id, hashToken(token),
        rememberMe ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        ua, ip);
    logStmts.addLoginLog(user.id, ip, ua, true, '登录成功 (2FA)');
    logActivity(user.id, 'login_2fa', '2FA 验证登录成功', req);

    res.json({
        message: '登录成功',
        token,
        user: {
            id: user.id, username: user.username, email: user.email,
            nickname: user.nickname || '', role: user.role, status: user.status,
            totpEnabled: true, emailVerified: !!user.email_verified,
            createdAt: user.created_at
        }
    });
});

// ===== 获取当前用户 =====
router.get('/me', authRequired, banCheck, (req, res) => {
    const user = stmts.findById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user });
});

// ===== 更新资料 =====
router.put('/profile', authRequired, banCheck, (req, res) => {
    const { nickname } = req.body;
    if (nickname !== undefined && nickname.length > 20) {
        return res.status(400).json({ error: '昵称不能超过 20 个字符' });
    }
    stmts.updateNickname(nickname || '', req.user.id);
    logActivity(req.user.id, 'update_profile', '更新昵称: ' + (nickname || '(空)'), req);
    res.json({ message: '资料已更新', nickname: nickname || '' });
});

// ===== 修改密码 =====
router.put('/password', authRequired, banCheck, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: '请输入当前密码和新密码' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: '新密码长度不能少于 6 个字符' });
    }
    const user = stmts.findByIdFull(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(401).json({ error: '当前密码不正确' });
    }
    const newHash = bcrypt.hashSync(newPassword, 10);
    stmts.updatePassword(newHash, req.user.id);

    // 修改密码后撤销所有会话（除当前）
    sessionStmts.revokeAllUserSessions(req.user.id);
    logActivity(req.user.id, 'change_password', '修改密码', req);
    res.json({ message: '密码修改成功，其他设备已登出' });
});

// ===== 注销账号 =====
router.delete('/account', authRequired, (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '请输入密码以确认注销' });
    const user = stmts.findByIdFull(req.user.id);
    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: '密码不正确' });
    }
    stmts.deleteById(req.user.id);
    res.json({ message: '账号已注销' });
});

// ===== 换绑邮箱 =====
router.put('/email', authRequired, banCheck, (req, res) => {
    const { newEmail, password } = req.body;
    if (!newEmail || !password) {
        return res.status(400).json({ error: '请输入新邮箱和密码' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: '邮箱格式不正确' });
    }

    const user = stmts.findByIdFull(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: '密码不正确' });
    }

    if (newEmail === user.email) {
        return res.status(400).json({ error: '新邮箱与当前邮箱相同' });
    }

    if (stmts.findByEmail(newEmail)) {
        return res.status(409).json({ error: '该邮箱已被其他用户使用' });
    }

    // 更新邮箱
    stmts.updateEmail(newEmail, req.user.id);

    // 发送验证码到新邮箱
    const code = crypto.randomInt(100000, 999999).toString();
    verifyStmts.createVerification(req.user.id, newEmail, code);
    trySendVerification(newEmail, code, user.username);

    logActivity(req.user.id, 'change_email', `换绑邮箱: ${user.email} → ${newEmail}`, req);
    res.json({
        message: '邮箱已更新，请验证新邮箱',
        verificationHint: code
    });
});

// ===== 会话管理 =====
router.get('/sessions', authRequired, (req, res) => {
    const sessions = sessionStmts.getActiveSessions(req.user.id);
    const result = sessions.map(s => ({
        id: s.id,
        userAgent: s.user_agent,
        ipAddress: s.ip_address,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        isCurrent: s.token_hash === hashToken(req.token)
    }));
    res.json({ sessions: result });
});

router.delete('/sessions/:id', authRequired, (req, res) => {
    const sessions = sessionStmts.getActiveSessions(req.user.id);
    const targetSession = sessions.find(s => s.id === parseInt(req.params.id));
    if (!targetSession) return res.status(404).json({ error: '会话不存在' });

    sessionStmts.revokeSession(targetSession.id);
    logActivity(req.user.id, 'revoke_session', '撤销会话 #' + targetSession.id, req);
    res.json({ message: '会话已撤销' });
});

// ===== 登录历史 =====
router.get('/login-history', authRequired, (req, res) => {
    const logs = logStmts.getLoginHistory(req.user.id, 50);
    res.json({ logs });
});

// ===== 活动日志 =====
router.get('/activity-log', authRequired, (req, res) => {
    const logs = activityStmts.getActivityLog(req.user.id, 50);
    res.json({ logs });
});

// ===== 新手礼包 =====
router.get('/gift-status', authRequired, (req, res) => {
    const user = stmts.findById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ claimed: !!user.gift_claimed });
});

router.post('/claim-gift', authRequired, banCheck, (req, res) => {
    const user = stmts.findById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.gift_claimed) return res.status(400).json({ error: '您已领取过新手礼包' });

    stmts.claimGift(req.user.id);
    logActivity(req.user.id, 'claim_gift', '领取新手礼包', req);

    // 返回礼包指令，供游戏插件执行
    const giftCommands = [
        'give {player} minecraft:diamond 16',
        'give {player} minecraft:iron_ingot 32',
        'give {player} minecraft:golden_apple 5',
        'give {player} minecraft:experience_bottle 16',
        'give {player} minecraft:ender_pearl 8'
    ];

    res.json({
        message: '新手礼包领取成功！请查看游戏内邮箱或等待发放',
        claimed: true,
        commands: giftCommands
    });
});

module.exports = router;

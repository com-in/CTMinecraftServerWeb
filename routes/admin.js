const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts, activityStmts, settingsStmts, gameStmts } = require('../models/db');
const { authRequired, adminRequired, getClientIp } = require('../middleware/auth');
const { sha256 } = require('../middleware/security');

const router = express.Router();

router.use(authRequired, adminRequired);

function logActivity(userId, action, detail, req) {
    activityStmts.addActivity(userId, action, detail, getClientIp(req));
}

// GET /api/admin/users
router.get('/users', (req, res) => {
    const users = stmts.findAll();
    res.json({ users });
});

// GET /api/admin/users/:id
router.get('/users/:id', (req, res) => {
    const user = stmts.findById(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user });
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', (req, res) => {
    const { role } = req.body;
    const targetId = parseInt(req.params.id);
    if (!role || !['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: '角色值无效' });
    }
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能修改自己的角色' });

    stmts.updateRole(role, targetId);
    logActivity(req.user.id, 'admin_change_role', `修改用户 ${user.username} 角色为 ${role}`, req);
    res.json({ message: `已将用户 ${user.username} 的角色修改为 ${role === 'admin' ? '管理员' : '普通用户'}` });
});

// PUT /api/admin/users/:id/ban
router.put('/users/:id/ban', (req, res) => {
    const targetId = parseInt(req.params.id);
    const { reason } = req.body;
    if (targetId === req.user.id) return res.status(400).json({ error: '不能封禁自己的账号' });

    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.status === 'banned') return res.status(400).json({ error: '该用户已被封禁' });

    stmts.banUser(targetId, reason || '管理员封禁');
    logActivity(req.user.id, 'admin_ban', `封禁用户 ${user.username}，原因: ${reason || '管理员封禁'}`, req);
    res.json({ message: `已封禁用户 ${user.username}`, reason: reason || '管理员封禁' });
});

// PUT /api/admin/users/:id/unban
router.put('/users/:id/unban', (req, res) => {
    const targetId = parseInt(req.params.id);
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.status !== 'banned') return res.status(400).json({ error: '该用户未被封禁' });

    stmts.unbanUser(targetId);
    logActivity(req.user.id, 'admin_unban', `解封用户 ${user.username}`, req);
    res.json({ message: `已解封用户 ${user.username}` });
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', (req, res) => {
    const targetId = parseInt(req.params.id);
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const newPassword = generateRandomPassword(10);
    // 服务端 SHA256 → bcrypt，与客户端 SHA256 传输保持一致
    const sha256Password = sha256(newPassword);
    const newHash = bcrypt.hashSync(sha256Password, 10);
    stmts.updatePassword(newHash, targetId);
    logActivity(req.user.id, 'admin_reset_password', `重置用户 ${user.username} 密码`, req);

    res.json({ message: `已重置用户 ${user.username} 的密码`, newPassword });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' });

    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    stmts.deleteById(targetId);
    logActivity(req.user.id, 'admin_delete', `删除用户 ${user.username}`, req);
    res.json({ message: `已删除用户 ${user.username}` });
});

// POST /api/admin/users/:id/unlock
router.post('/users/:id/unlock', (req, res) => {
    const targetId = parseInt(req.params.id);
    const user = stmts.findByIdFull(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!user.locked_until) return res.status(400).json({ error: '该账号未被锁定' });

    stmts.unlockAccount(targetId);
    logActivity(req.user.id, 'admin_unlock', `解锁用户 ${user.username}`, req);
    res.json({ message: `已解锁用户 ${user.username}` });
});

// POST /api/admin/users  创建用户
router.post('/users', (req, res) => {
    const { username, email, password, nickname, role, emailVerified } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: '用户名、邮箱、密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度需在 2-20 个字符之间' });
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
        return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和中文' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: '密码长度需在 6-128 字符之间' });
    }
    if (stmts.findByUsername(username)) {
        return res.status(409).json({ error: '用户名已被注册' });
    }
    if (stmts.findByEmail(email)) {
        return res.status(409).json({ error: '邮箱已被注册' });
    }
    const finalRole = (role === 'admin') ? 'admin' : 'user';
    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = stmts.insert(username, email, passwordHash, nickname || '', finalRole);
    if (emailVerified) {
        stmts.setEmailVerified(userId);
    }
    logActivity(req.user.id, 'admin_create_user', `创建用户 ${username} (${finalRole})`, req);
    res.json({ message: `已创建用户 ${username}`, userId });
});

// PUT /api/admin/users/:id/email-verified  切换邮箱验证状态
router.put('/users/:id/email-verified', (req, res) => {
    const targetId = parseInt(req.params.id);
    const { verified } = req.body;
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (verified) {
        stmts.setEmailVerified(targetId);
        logActivity(req.user.id, 'admin_verify_email', `标记用户 ${user.username} 邮箱已验证`, req);
        res.json({ message: `已将 ${user.username} 邮箱标记为已验证` });
    } else {
        stmts.setEmailUnverified(targetId);
        logActivity(req.user.id, 'admin_unverify_email', `标记用户 ${user.username} 邮箱未验证`, req);
        res.json({ message: `已将 ${user.username} 邮箱标记为未验证` });
    }
});

// POST /api/admin/users/:id/disable-2fa  移除 2FA
router.post('/users/:id/disable-2fa', (req, res) => {
    const targetId = parseInt(req.params.id);
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (!user.totp_enabled) return res.status(400).json({ error: '该用户未启用 2FA' });

    stmts.updateTotp('', 0, targetId);
    logActivity(req.user.id, 'admin_disable_2fa', `移除用户 ${user.username} 的 2FA`, req);
    res.json({ message: `已移除 ${user.username} 的 2FA` });
});

// PUT /api/admin/users/:id/password  管理员修改密码（不使用 reset 随机密码）
router.put('/users/:id/password', (req, res) => {
    const targetId = parseInt(req.params.id);
    const { password } = req.body;
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: '密码长度需在 6-128 字符之间' });
    }
    const newHash = bcrypt.hashSync(password, 10);
    stmts.updatePassword(newHash, targetId);
    logActivity(req.user.id, 'admin_set_password', `修改用户 ${user.username} 密码`, req);
    res.json({ message: `已修改 ${user.username} 的密码` });
});

// GET /api/admin/users/:id/inventory-bindings  管理员查看用户绑定的所有游戏账号
router.get('/users/:id/inventory-bindings', (req, res) => {
    const targetId = parseInt(req.params.id);
    const user = stmts.findById(targetId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const bindings = gameStmts.getUserBound(targetId) || [];
    res.json({
        username: user.username,
        bindings: bindings.map(b => ({
            game_username: b.game_username,
            uuid: b.uuid || null,
            bound_at: b.bound_at || null,
        })),
    });
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
    const all = settingsStmts.getAll();
    const result = {};
    all.forEach(s => { result[s.key] = s; });
    res.json({ settings: result });
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: '缺少 key 参数' });

    const existing = settingsStmts.getAll().find(s => s.key === key);
    const description = existing ? existing.description : '';
    settingsStmts.set(key, value || '', description);
    logActivity(req.user.id, 'admin_setting', `修改设置 ${key} = ${value}`, req);
    res.json({ message: '设置已保存' });
});

function generateRandomPassword(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

module.exports = router;

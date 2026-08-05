const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { gameStmts, activityStmts, settingsStmts } = require('../models/db');
const { authRequired, getClientIp, adminRequired } = require('../middleware/auth');
const { sha256 } = require('../middleware/security');

const router = express.Router();

// CatSeedLogin accounts.db 路径（配置后启用密码验证模式）
const GAME_DB_PATH = process.env.GAME_DB_PATH || '';
const GAME_AUTH_URL = process.env.GAME_AUTH_URL || 'http://localhost:10737/v1/api/auth/login';

// ===== 验证码模式（跨机器，无需同步数据库） =====

// 验证码缓存：userId -> { code, gameUsername, expiresAt }
const verifyCodes = new Map();

// 清理过期验证码
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of verifyCodes) {
        if (val.expiresAt < now) verifyCodes.delete(key);
    }
}, 60000);

/**
 * POST /api/game/verify-code
 * 生成游戏内验证码
 * Body: { gameUsername }
 * 返回 6 位验证码，有效期 5 分钟
 */
router.post('/verify-code', authRequired, (req, res) => {
    const { gameUsername } = req.body;

    if (!gameUsername) {
        return res.status(400).json({ error: '请输入游戏用户名' });
    }

    // 检查是否已被绑定
    const existing = gameStmts.findByGameUsername(gameUsername);
    if (existing && existing.user_id !== req.user.id) {
        return res.status(409).json({ error: `游戏账号 ${gameUsername} 已被其他用户绑定` });
    }

    if (existing && existing.user_id === req.user.id) {
        return res.status(409).json({ error: '你已绑定过此游戏账号' });
    }

    // 生成 6 位数字验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    verifyCodes.set(req.user.id, {
        code,
        gameUsername,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 分钟
    });

    console.log(`[verify-code] 用户 ${req.user.id} 请求绑定 ${gameUsername}，验证码: ${code}`);

    res.json({
        message: '请在游戏内输入指令',
        code,
        commands: [`/gcbind ${code}`],
        expiresIn: 300,
        gameUsername,
    });
});

/**
 * GET /api/game/confirm-verify
 * 供 MC 插件调用，确认验证码
 * Query: code, playerName, uuid
 * 插件调用时需要带上 apiKey 认证
 */
router.get('/confirm-verify', (req, res) => {
    const { code, playerName, uuid } = req.query;
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedKey = settingsStmts.get('game_api_key') || process.env.GAME_API_KEY || 'ctmc-verify-secret';

    if (apiKey !== expectedKey) {
        return res.status(403).json({ error: '无效的 API Key' });
    }

    if (!code || !playerName) {
        return res.status(400).json({ error: '缺少参数 code 或 playerName' });
    }

    // 查找匹配的验证码
    let matchedUserId = null;
    let matchedUsername = null;

    for (const [userId, data] of verifyCodes) {
        if (data.code === code && data.gameUsername.toLowerCase() === playerName.toLowerCase()) {
            if (data.expiresAt < Date.now()) {
                verifyCodes.delete(userId);
                continue;
            }
            matchedUserId = userId;
            matchedUsername = data.gameUsername;
            break;
        }
    }

    if (!matchedUserId) {
        return res.status(404).json({ error: '验证码无效或已过期，请在网站重新获取' });
    }

    // 执行绑定（含 UUID）
    gameStmts.bind(matchedUserId, matchedUsername, uuid || '');
    verifyCodes.delete(matchedUserId);
    activityStmts.addActivity(matchedUserId, 'bind_game_verify', `通过验证码绑定游戏账号: ${matchedUsername} (UUID: ${uuid || '无'})`, '');

    console.log(`[confirm-verify] MC 玩家 ${playerName} (UUID: ${uuid || '无'}) 验证码 ${code} 确认，绑定用户 ID ${matchedUserId}`);

    res.json({
        success: true,
        message: `游戏账号 ${matchedUsername} 绑定成功！刷新网页即可看到。`,
    });
});

// ===== 密码验证模式（同机器，直接读 accounts.db 或调 API） =====

function isDirectMode() {
    return !!GAME_DB_PATH;
}

/**
 * POST /api/game/verify
 * 密码验证（直接读 accounts.db 或调 API）
 */
router.post('/verify', authRequired, async (req, res) => {
    const { gameUsername, gamePassword } = req.body;

    if (!gameUsername || !gamePassword) {
        return res.status(400).json({ error: '请输入游戏用户名和密码' });
    }

    const existing = gameStmts.findByGameUsername(gameUsername);
    if (existing && existing.user_id !== req.user.id) {
        return res.status(409).json({ error: `游戏账号 ${gameUsername} 已被其他用户绑定` });
    }

    // 直接读取模式
    if (isDirectMode()) {
        try {
            if (!fs.existsSync(GAME_DB_PATH)) {
                return res.status(502).json({ error: '找不到游戏账号数据库文件，请联系管理员' });
            }
            const fileBuffer = fs.readFileSync(GAME_DB_PATH);
            const SQL = await initSqlJs();
            const gameDb = new SQL.Database(fileBuffer);
            const result = gameDb.exec('SELECT password FROM accounts WHERE name = ?', [gameUsername]);
            gameDb.close();

            if (!result.length || !result[0].values.length) {
                return res.status(401).json({ error: '游戏账号不存在' });
            }
            const storedHash = result[0].values[0][0];
            if (storedHash !== gamePassword) {
                return res.status(401).json({ error: '游戏密码错误' });
            }
            return res.json({ success: true, message: '游戏账号验证通过', gameUsername });
        } catch (err) {
            console.error('[game] 直接验证失败:', err.message);
            return res.status(502).json({ error: '游戏账号验证失败: ' + err.message });
        }
    }

    // API 模式
    try {
        const response = await fetch(GAME_AUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: gameUsername, password: gamePassword }),
        });
        if (!response.ok) {
            return res.status(502).json({ error: '游戏验证服务暂时不可用，请稍后重试' });
        }
        const data = await response.json();
        if (!data.success) {
            return res.status(401).json({ error: '游戏账号密码错误' });
        }
        res.json({ success: true, message: '游戏账号验证通过', gameUsername: data.name });
    } catch (err) {
        console.error('[game] API验证失败:', err.message);
        return res.status(502).json({ error: '无法连接到游戏验证服务，请联系管理员' });
    }
});

/**
 * POST /api/game/bind
 * 直接绑定（需先通过 /verify 验证）
 */
router.post('/bind', authRequired, (req, res) => {
    const { gameUsername } = req.body;
    if (!gameUsername) return res.status(400).json({ error: '请输入游戏用户名' });

    const existing = gameStmts.findByGameUsername(gameUsername);
    if (existing && existing.user_id !== req.user.id) {
        return res.status(409).json({ error: `游戏账号 ${gameUsername} 已被其他用户绑定` });
    }
    if (existing && existing.user_id === req.user.id) {
        return res.status(409).json({ error: '你已绑定过此游戏账号' });
    }

    gameStmts.bind(req.user.id, gameUsername, '');
    activityStmts.addActivity(req.user.id, 'bind_game', `绑定游戏账号: ${gameUsername}`, getClientIp(req));
    res.json({ message: `成功绑定游戏账号: ${gameUsername}`, gameUsername });
});

/**
 * DELETE /api/game/unbind/:gameUsername
 */
router.delete('/unbind/:gameUsername', authRequired, (req, res) => {
    const { gameUsername } = req.params;
    const binding = gameStmts.findByUserAndGame(req.user.id, gameUsername);
    if (!binding) return res.status(404).json({ error: '未找到该绑定记录' });
    gameStmts.unbind(req.user.id, gameUsername);
    activityStmts.addActivity(req.user.id, 'unbind_game', `解绑游戏账号: ${gameUsername}`, getClientIp(req));
    res.json({ message: `已解绑游戏账号: ${gameUsername}` });
});

/**
 * GET /api/game/bindings
 */
router.get('/bindings', authRequired, (req, res) => {
    const bindings = gameStmts.getUserBound(req.user.id);
    res.json({ bindings });
});

module.exports = router;

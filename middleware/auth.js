const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { stmts, sessionStmts } = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'ctmc_jwt_secret_key_2026';
const JWT_EXPIRES_IN = '7d';
const JWT_REMEMBER_EXPIRES_IN = '30d';
const TEMP_TOKEN_EXPIRES_IN = '5m';
const MAX_FAILED_ATTEMPTS = 5;

// 生成 JWT Token
function generateToken(user, rememberMe = false) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role, status: user.status },
        JWT_SECRET,
        { expiresIn: rememberMe ? JWT_REMEMBER_EXPIRES_IN : JWT_EXPIRES_IN }
    );
}

// 生成 2FA 中间态 Token
function generateTempToken(userId) {
    return jwt.sign({ id: userId, temp: true }, JWT_SECRET, { expiresIn: TEMP_TOKEN_EXPIRES_IN });
}

// 验证 Temp Token
function verifyTempToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.temp) return null;
        return decoded;
    } catch { return null; }
}

// Token 哈希（用于会话管理）
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// JWT 验证中间件
function authRequired(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录，请先登录' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // 检查会话是否被撤销
        if (sessionStmts.isTokenRevoked(hashToken(token))) {
            return res.status(401).json({ error: '会话已失效，请重新登录' });
        }
        req.user = decoded;
        req.token = token;
        next();
    } catch (err) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
}

// 封禁检查
function banCheck(req, res, next) {
    const user = stmts.findByIdFull(req.user.id);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }
    if (user.status === 'banned') {
        return res.status(403).json({ error: '账号已被封禁', ban_reason: user.ban_reason || '未提供原因' });
    }
    next();
}

// 管理员权限（从数据库重新查询，避免 JWT 角色过期）
function adminRequired(req, res, next) {
    try {
        const user = stmts.findByIdFull(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: '权限不足，需要管理员权限' });
        }
        // 同步最新角色到 req.user
        req.user.role = user.role;
        req.user.status = user.status;
        next();
    } catch (err) {
        return res.status(500).json({ error: '权限验证失败' });
    }
}

// 获取客户端 IP
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket.remoteAddress
        || '';
}

module.exports = {
    JWT_SECRET, MAX_FAILED_ATTEMPTS,
    generateToken, generateTempToken, verifyTempToken, hashToken,
    authRequired, banCheck, adminRequired,
    getClientIp
};

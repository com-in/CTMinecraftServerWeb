const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { getDb } = require('./models/db');
const { xssSanitize, csrfTokenHandler } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const gameRoutes = require('./routes/game');
const uploadRoutes = require('./routes/upload');
const inventoryRoutes = require('./routes/inventory');
const dailyRewardRoutes = require('./routes/daily-reward');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 安全中间件 =====

// Helmet：安全 HTTP 头（CSP、X-Frame-Options、X-XSS-Protection 等）
app.use(helmet({
    hsts: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "https://js.hcaptcha.com", "https://newassets.hcaptcha.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "https://newassets.hcaptcha.com"],
            fontSrc: ["'self'", "cdnjs.cloudflare.com", "fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.mcstatus.io", "https://api.mcsrvstat.us", "https://api.hcaptcha.com"],
            frameSrc: ["'self'", "https://newassets.hcaptcha.com"],
            frameAncestors: ["'none'"],
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 全局速率限制（所有 API 路由）
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 分钟
    max: 300,                    // 300 次请求
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' }
});

// 登录接口速率限制（更严格）
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 分钟
    max: 10,                     // 10 次登录尝试
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '登录尝试过于频繁，请15分钟后再试' },
    skipSuccessfulRequests: true // 成功后不计入限制
});

// Body 解析
app.use(express.json({ limit: '10mb' }));      // 10MB 以支持背包 .dat 同步
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// XSS 清洗（跳过 inventory/sync，防止误伤 base64 数据）
app.use('/api', (req, res, next) => {
    if (req.path === '/inventory/sync') return next();
    xssSanitize(req, res, next);
});

// API 速率限制
app.use('/api', apiLimiter);

// 静态文件服务（禁用目录浏览，HTML 禁用缓存防止更新后看不到新版本）
app.use(express.static(path.join(__dirname), {
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 禁止直接访问敏感文件
app.use((req, res, next) => {
    const blocked = ['.env', 'package.json', 'package-lock.json', 'data/GCMC.db'];
    const reqPath = req.path.toLowerCase();
    if (blocked.some(b => reqPath.includes(b))) {
        return res.status(403).json({ error: '禁止访问' });
    }
    next();
});

// CSRF Token 端点
app.get('/api/csrf-token', csrfTokenHandler);

// API 路由 + 登录速率限制
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/daily-reward', dailyRewardRoutes);

// SPA fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '接口不存在' });
    }
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(filePath);
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 全局错误处理
app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动
async function start() {
    await getDb();
    app.listen(PORT, () => {
        console.log(`GCMC 服务器已启动: http://localhost:${PORT}`);
        console.log('管理员账号: Ctoy');
    });
}

start();

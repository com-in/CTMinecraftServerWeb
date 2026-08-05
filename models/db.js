const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { sha256 } = require('../middleware/security');

const DB_PATH = path.join(__dirname, '..', 'data', 'ctmc.db');

let db = null;

async function getDb() {
    if (db) return db;

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        migrateDb();
    } else {
        db = new SQL.Database();
        createTables();
    }

    const countResult = db.exec('SELECT COUNT(*) AS count FROM users');
    const userCount = countResult[0]?.values[0]?.[0] || 0;
    if (userCount === 0) {
        createAdmin();
    }

    saveDb();
    return db;
}

function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            nickname TEXT DEFAULT '',
            role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'banned')),
            ban_reason TEXT DEFAULT '',
            totp_secret TEXT DEFAULT '',
            totp_enabled INTEGER DEFAULT 0,
            failed_login_attempts INTEGER DEFAULT 0,
            locked_until DATETIME DEFAULT NULL,
            email_verified INTEGER DEFAULT 0,
            avatar_url TEXT DEFAULT '',
            gift_claimed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            success INTEGER DEFAULT 1,
            detail TEXT DEFAULT '',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            detail TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            user_agent TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            revoked INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_username TEXT NOT NULL,
            uuid TEXT DEFAULT '',
            bound_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, game_username)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT DEFAULT '',
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS player_inventories (
            uuid TEXT PRIMARY KEY,
            player_name TEXT NOT NULL,
            health REAL DEFAULT 20,
            food_level INTEGER DEFAULT 20,
            xp_level INTEGER DEFAULT 0,
            xp_progress REAL DEFAULT 0,
            xp_total INTEGER DEFAULT 0,
            items_json TEXT DEFAULT '[]',
            item_count INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS daily_rewards (
            uuid TEXT PRIMARY KEY,
            player_name TEXT NOT NULL,
            streak INTEGER DEFAULT 1,
            last_claimed_date TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 插入默认设置
    const insertSetting = (k, v, d) => {
        const rows = query('SELECT key FROM settings WHERE key = ?', [k]);
        if (!rows.length) run('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', [k, v, d]);
    };
    insertSetting('game_api_key', 'ctmc-verify-secret', '游戏服务器API密钥，需与插件config.yml中的api-key一致');
    insertSetting('game_auth_url', 'http://localhost:10737/v1/api/auth/login', '密码验证模式API地址（可选）');
    insertSetting('game_db_path', '', 'CatSeedLogin accounts.db路径（同机器直接验证模式，留空则使用验证码模式）');
    insertSetting('hcaptcha_sitekey', '6032461a-efd2-45d0-8696-a7f8e1c6f682', 'hCaptcha 网站密钥（Site Key），用于前端 widget');
    insertSetting('hcaptcha_secret', '', 'hCaptcha API 密钥（Secret Key），仅服务端使用');
    insertSetting('playerdata_path', '', 'Minecraft服务端world/playerdata路径（背包查看功能，留空则自动检测）');
}

function migrateDb() {
    try {
        const cols = db.exec('PRAGMA table_info(users)');
        const colNames = cols[0]?.values.map(v => v[1]) || [];

        const additions = [
            { name: 'nickname', sql: "ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''" },
            { name: 'status', sql: "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'banned'))" },
            { name: 'ban_reason', sql: "ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT ''" },
            { name: 'totp_secret', sql: "ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT ''" },
            { name: 'totp_enabled', sql: 'ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0' },
            { name: 'failed_login_attempts', sql: 'ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0' },
            { name: 'locked_until', sql: 'ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL' },
            { name: 'email_verified', sql: 'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0' },
            { name: 'avatar_url', sql: "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''" },
            { name: 'gift_claimed', sql: 'ALTER TABLE users ADD COLUMN gift_claimed INTEGER DEFAULT 0' },
        ];

        additions.forEach(a => {
            if (!colNames.includes(a.name)) db.run(a.sql);
        });

        // 创建新表（如果不存在）
        createTables();
    } catch (e) {
        console.log('[db] 迁移警告:', e.message);
    }
}

function createAdmin() {
    // 前端 sha256(明文) → 后端 bcrypt(sha256)（双重保护）
    const sha256Password = sha256('Yhc061900@');
    const adminHash = bcrypt.hashSync(sha256Password, 10);
    db.run(
        'INSERT INTO users (username, email, password_hash, nickname, role, status, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['Ctoy', 'ctoy@ctmc.local', adminHash, '系统管理员', 'admin', 'active', 1]
    );
    console.log('[db] 已创建默认管理员账号: Ctoy');
}

function saveDb() {
    if (!db) return;
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function query(sql, params = []) {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

function run(sql, params = []) {
    db.run(sql, params);
    saveDb();
}

function getLastInsertId() {
    const result = db.exec('SELECT last_insert_rowid() AS id');
    return result[0]?.values[0]?.[0] || 0;
}

// ===== 用户操作 =====
const stmts = {
    findByUsername: (username) => {
        const rows = query('SELECT * FROM users WHERE username = ?', [username]);
        return rows[0] || null;
    },
    findByEmail: (email) => {
        const rows = query('SELECT * FROM users WHERE email = ?', [email]);
        return rows[0] || null;
    },
    findById: (id) => {
        const rows = query(
            'SELECT id, username, email, nickname, role, status, ban_reason, totp_enabled, email_verified, avatar_url, gift_claimed, created_at, updated_at FROM users WHERE id = ?',
            [id]
        );
        return rows[0] || null;
    },
    findByIdFull: (id) => {
        const rows = query('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0] || null;
    },
    findAll: () => {
        return query(
            'SELECT id, username, email, nickname, role, status, ban_reason, totp_enabled, email_verified, avatar_url, gift_claimed, created_at, updated_at FROM users ORDER BY created_at DESC'
        );
    },
    insert: (username, email, passwordHash, nickname, role) => {
        run(
            'INSERT INTO users (username, email, password_hash, nickname, role, status, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [username, email, passwordHash, nickname || '', role || 'user', 'active']
        );
        return getLastInsertId();
    },
    updateNickname: (nickname, id) => {
        run("UPDATE users SET nickname = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [nickname, id]);
    },
    updatePassword: (passwordHash, id) => {
        run("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [passwordHash, id]);
    },
    updateRole: (role, id) => {
        run("UPDATE users SET role = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [role, id]);
    },
    banUser: (id, reason) => {
        run("UPDATE users SET status = 'banned', ban_reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [reason || '', id]);
    },
    unbanUser: (id) => {
        run("UPDATE users SET status = 'active', ban_reason = '', updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    updateTotp: (secret, enabled, id) => {
        run("UPDATE users SET totp_secret = ?, totp_enabled = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [secret, enabled, id]);
    },
    incrementFailedAttempts: (id) => {
        run("UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    lockAccount: (id) => {
        run("UPDATE users SET locked_until = datetime('now', 'localtime', '+15 minutes'), failed_login_attempts = 0, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    unlockAccount: (id) => {
        run("UPDATE users SET locked_until = NULL, failed_login_attempts = 0, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    setEmailVerified: (id) => {
        run("UPDATE users SET email_verified = 1, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    setEmailUnverified: (id) => {
        run("UPDATE users SET email_verified = 0, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    updateEmail: (email, id) => {
        run("UPDATE users SET email = ?, email_verified = 0, updated_at = datetime('now', 'localtime') WHERE id = ?", [email, id]);
    },
    deleteById: (id) => {
        run('DELETE FROM users WHERE id = ?', [id]);
    },
    updateAvatar: (avatarUrl, id) => {
        run("UPDATE users SET avatar_url = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", [avatarUrl, id]);
    },
    claimGift: (id) => {
        run("UPDATE users SET gift_claimed = 1, updated_at = datetime('now', 'localtime') WHERE id = ?", [id]);
    },
    countUsers: () => {
        const rows = query('SELECT COUNT(*) AS count FROM users');
        return rows[0] || { count: 0 };
    },
};

// ===== 登录日志 =====
const logStmts = {
    addLoginLog: (userId, ip, userAgent, success, detail) => {
        run('INSERT INTO login_logs (user_id, ip_address, user_agent, success, detail) VALUES (?, ?, ?, ?, ?)',
            [userId, ip, userAgent, success ? 1 : 0, detail || '']);
    },
    getLoginHistory: (userId, limit = 50) => {
        return query('SELECT * FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
    },
};

// ===== 活动日志 =====
const activityStmts = {
    addActivity: (userId, action, detail, ip) => {
        run('INSERT INTO activity_logs (user_id, action, detail, ip_address) VALUES (?, ?, ?, ?)',
            [userId, action, detail, ip || '']);
    },
    getActivityLog: (userId, limit = 50) => {
        return query('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
    },
};

// ===== 会话管理 =====
const sessionStmts = {
    createSession: (userId, tokenHash, expiresAt, userAgent, ip) => {
        run('INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?)',
            [userId, tokenHash, expiresAt, userAgent, ip]);
        return getLastInsertId();
    },
    revokeSession: (id) => {
        run('UPDATE sessions SET revoked = 1 WHERE id = ?', [id]);
    },
    revokeAllUserSessions: (userId) => {
        run('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0', [userId]);
    },
    getActiveSessions: (userId) => {
        return query(
            "SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now', 'localtime') ORDER BY created_at DESC",
            [userId]
        );
    },
    isTokenRevoked: (tokenHash) => {
        const rows = query(
            "SELECT id FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now', 'localtime')",
            [tokenHash]
        );
        return rows.length === 0;
    },
    getSessionCount: (userId) => {
        const rows = query(
            "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now', 'localtime')",
            [userId]
        );
        return rows[0]?.count || 0;
    },
};

// ===== 邮箱验证 =====
const verifyStmts = {
    createVerification: (userId, email, code) => {
        run("INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, datetime('now', 'localtime', '+10 minutes'))",
            [userId, email, code]);
        return getLastInsertId();
    },
    verifyCode: (userId, code) => {
        const rows = query(
            "SELECT * FROM email_verifications WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > datetime('now', 'localtime') ORDER BY created_at DESC LIMIT 1",
            [userId, code]
        );
        if (rows.length) {
            run('UPDATE email_verifications SET used = 1 WHERE id = ?', [rows[0].id]);
            return true;
        }
        return false;
    },
};

module.exports = { getDb, stmts, logStmts, activityStmts, sessionStmts, verifyStmts };

// ===== 游戏账号绑定 =====
const gameStmts = {
    findByUserAndGame: (userId, gameUsername) => {
        const rows = query('SELECT * FROM game_accounts WHERE user_id = ? AND game_username = ?', [userId, gameUsername]);
        return rows[0] || null;
    },
    findByGameUsername: (gameUsername) => {
        const rows = query('SELECT * FROM game_accounts WHERE game_username = ?', [gameUsername]);
        return rows[0] || null;
    },
    getUserBound: (userId) => {
        return query('SELECT * FROM game_accounts WHERE user_id = ? ORDER BY bound_at DESC', [userId]);
    },
    bind: (userId, gameUsername, uuid) => {
        run('INSERT INTO game_accounts (user_id, game_username, uuid) VALUES (?, ?, ?)', [userId, gameUsername, uuid || '']);
        return getLastInsertId();
    },
    unbind: (userId, gameUsername) => {
        run('DELETE FROM game_accounts WHERE user_id = ? AND game_username = ?', [userId, gameUsername]);
    },
    updateUuid: (userId, gameUsername, uuid) => {
        run('UPDATE game_accounts SET uuid = ? WHERE user_id = ? AND game_username = ?', [uuid, userId, gameUsername]);
    },
    findByUuid: (uuid) => {
        const rows = query('SELECT * FROM game_accounts WHERE uuid = ?', [uuid]);
        return rows[0] || null;
    },
};

module.exports.gameStmts = gameStmts;

// ===== 系统设置 =====
const settingsStmts = {
    getAll: () => query('SELECT * FROM settings ORDER BY key'),
    get: (key) => {
        const rows = query('SELECT * FROM settings WHERE key = ?', [key]);
        return rows.length ? rows[0].value : null;
    },
    set: (key, value, description) => {
        const rows = query('SELECT key FROM settings WHERE key = ?', [key]);
        if (rows.length) {
            run('UPDATE settings SET value = ?, description = ?, updated_at = datetime(\'now\', \'localtime\') WHERE key = ?', [value, description || '', key]);
        } else {
            run('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)', [key, value, description || '']);
        }
    },
    delete: (key) => run('DELETE FROM settings WHERE key = ?', [key]),
};

module.exports.settingsStmts = settingsStmts;

// ===== 玩家背包 =====
const inventoryStmts = {
    upsert: (uuid, playerName, data) => {
        const itemsJson = JSON.stringify(data.items ?? []);
        const itemCount = (data.items ?? []).reduce((s, i) => s + (i.count ?? 0), 0);
        run(`
            INSERT INTO player_inventories (uuid, player_name, health, food_level, xp_level, xp_progress, xp_total, items_json, item_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(uuid) DO UPDATE SET
                player_name = excluded.player_name,
                health = excluded.health,
                food_level = excluded.food_level,
                xp_level = excluded.xp_level,
                xp_progress = excluded.xp_progress,
                xp_total = excluded.xp_total,
                items_json = excluded.items_json,
                item_count = excluded.item_count,
                updated_at = excluded.updated_at
        `, [uuid, playerName, data.health ?? 20, data.foodLevel ?? 20, data.xpLevel ?? 0, data.xpProgress ?? 0, data.xpTotal ?? 0, itemsJson, itemCount]);
    },
    getByUuid: (uuid) => {
        const rows = query('SELECT * FROM player_inventories WHERE uuid = ?', [uuid]);
        if (!rows.length) return null;
        const r = rows[0];
        r.items = JSON.parse(r.items_json || '[]');
        return r;
    },
    getByPlayerName: (playerName) => {
        const rows = query("SELECT * FROM player_inventories WHERE LOWER(player_name) = LOWER(?)", [playerName]);
        if (!rows.length) return null;
        const r = rows[0];
        r.items = JSON.parse(r.items_json || '[]');
        return r;
    },
    deleteOlderThan: (seconds) => {
        run("DELETE FROM player_inventories WHERE updated_at < datetime('now', 'localtime', ?)", [`-${seconds} seconds`]);
    },
};

module.exports.inventoryStmts = inventoryStmts;

// ===== 每日福利 =====
/**
 * 获取北京时间 (UTC+8) 的日期字符串，格式 YYYY-MM-DD
 * @param {number} offsetDays - 偏移天数，0=今天, -1=昨天
 */
function getBeijingDate(offsetDays = 0) {
    const now = new Date();
    now.setTime(now.getTime() + 8 * 60 * 60 * 1000);   // 转北京时间
    if (offsetDays !== 0) {
        now.setUTCDate(now.getUTCDate() + offsetDays);
    }
    return now.toISOString().slice(0, 10);
}

const dailyRewardStmts = {
    getByUuid: (uuid) => {
        const rows = query('SELECT * FROM daily_rewards WHERE uuid = ?', [uuid]);
        return rows[0] || null;
    },
    // 领取/更新：如果今天已领取则忽略，否则更新 streak
    claim: (uuid, playerName) => {
        const today = getBeijingDate();
        const row = dailyRewardStmts.getByUuid(uuid);

        if (row) {
            // 已领取今天的奖励
            if (row.last_claimed_date === today) {
                return { claimed: false, reason: 'already_claimed', streak: row.streak };
            }

            // 计算是否连续（北京时间）
            const yesterday = getBeijingDate(-1);
            const isConsecutive = row.last_claimed_date === yesterday;

            const newStreak = isConsecutive ? row.streak + 1 : 1;
            run(
                'UPDATE daily_rewards SET streak = ?, last_claimed_date = ?, player_name = ?, created_at = datetime(\'now\', \'localtime\') WHERE uuid = ?',
                [newStreak, today, playerName, uuid]
            );
            return { claimed: true, streak: newStreak, previous: row.streak, isConsecutive };
        } else {
            // 首次领取
            run(
                'INSERT INTO daily_rewards (uuid, player_name, streak, last_claimed_date) VALUES (?, ?, 1, ?)',
                [uuid, playerName, today]
            );
            return { claimed: true, streak: 1, previous: 0, isConsecutive: false };
        }
    },
    // 供插件查询：玩家今天是否已领取
    hasClaimedToday: (uuid) => {
        const today = getBeijingDate();
        const rows = query('SELECT streak FROM daily_rewards WHERE uuid = ? AND last_claimed_date = ?', [uuid, today]);
        return rows.length > 0 ? rows[0].streak : false;
    },
    getStatus: (uuid) => {
        const row = dailyRewardStmts.getByUuid(uuid);
        const today = getBeijingDate();
        if (!row) return { streak: 0, claimedToday: false };
        return { streak: row.streak, claimedToday: row.last_claimed_date === today, lastClaimed: row.last_claimed_date };
    },
};

module.exports.dailyRewardStmts = dailyRewardStmts;

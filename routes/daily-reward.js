const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authRequired, adminRequired } = require('../middleware/auth');
const { dailyRewardStmts, gameStmts, settingsStmts } = require('../models/db');

// 奖励指令存储文件
const COMMAND_FILE = path.join(__dirname, '..', 'data', 'daily-reward-command.txt');
const DEFAULT_COMMAND = 'give {player} minecraft:diamond 1';

/**
 * 从 txt 文件读取奖励指令
 */
function getRewardCommand() {
    try {
        if (fs.existsSync(COMMAND_FILE)) {
            const content = fs.readFileSync(COMMAND_FILE, 'utf8').trim();
            if (content) return content;
        }
    } catch (e) {
        console.error('[每日福利] 读取指令文件失败:', e.message);
    }
    return DEFAULT_COMMAND;
}

/**
 * 将奖励指令写入 txt 文件
 */
function setRewardCommand(cmd) {
    const dir = path.dirname(COMMAND_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COMMAND_FILE, cmd.trim(), 'utf8');
}

/**
 * 从 JSON 文本数组提取纯文本（支持新旧格式）
 * 输入: [{"text":"G","color":"gold"}] 或 'GCMC Daily Reward'
 * 输出: "G"
 */
function extractTextFromJson(arr) {
    if (!arr) return '';
    const items = Array.isArray(arr) ? arr : [arr];
    return items.map(item => {
        if (typeof item === 'string') return item;
        if (item.text) return item.text;
        if (item.translate) return item.translate;
        if (item.extra) return extractTextFromJson(item.extra);
        return '';
    }).join('');
}

/**
 * 解析奖励指令，提取物品信息供 Web 展示
 * 支持新旧两种格式:
 *   旧: give {player} minecraft:diamond_sword{display:{Name:'...'},Enchantments:[...]} 1
 *   新: give {player} diamond_sword[custom_name=[{"text":"..."}],lore=[...],enchantments={...}] 1
 */
function parseRewardCommand(cmd) {
    // 手动解析，避免空格在引号内时 split 失效
    let trimmed = cmd.trim();
    // 跳过前导 /
    if (trimmed.startsWith('/')) trimmed = trimmed.substring(1).trim();
    // 跳过 give 和 {player} / @p
    let i = 0;
    // 跳过 "give "
    const giveSpace = trimmed.indexOf(' ');
    if (giveSpace < 0) return null;
    i = giveSpace + 1;
    // 跳过玩家占位符 (如 "{player}" 或 "@p")
    const targetEnd = trimmed.indexOf(' ', i);
    if (targetEnd < 0) return null;
    i = targetEnd + 1;

    // 提取物品部分: 遇到括号或花括号时进入嵌套计数，引号内跳过
    let itemPart = '';
    let depthSquare = 0, depthCurly = 0;
    let inString = false, stringChar = '';
    while (i < trimmed.length) {
        const ch = trimmed[i];
        if (inString) {
            itemPart += ch;
            if (ch === '\\') { i++; itemPart += trimmed[i]; i++; continue; }
            if (ch === stringChar) inString = false;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            itemPart += ch;
            i++;
            continue;
        }
        if (ch === '[') depthSquare++;
        else if (ch === ']') depthSquare--;
        else if (ch === '{') depthCurly++;
        else if (ch === '}') depthCurly--;
        else if (ch === ' ' && depthSquare === 0 && depthCurly === 0) {
            // 括号外空格 → 物品部分结束
            break;
        }
        itemPart += ch;
        i++;
    }
    // 跳过后面的空格，读取 count
    let count = 1;
    if (i < trimmed.length) {
        const rest = trimmed.substring(i).trim();
        const numMatch = rest.match(/^(\d+)/);
        if (numMatch) count = parseInt(numMatch[1]) || 1;
    }

    if (!itemPart) return null;

    let itemId = itemPart;
    let componentsStr = null;
    let isNewFormat = false;

    // 检测新格式: item[...]（方括号组件）
    const bracketIdx = itemPart.indexOf('[');
    const braceIdx = itemPart.indexOf('{');

    if (bracketIdx > 0 && (braceIdx < 0 || bracketIdx < braceIdx)) {
        // 新格式: orange_shulker_box[custom_name=...,lore=...,container=...]
        isNewFormat = true;
        itemId = itemPart.substring(0, bracketIdx);
        componentsStr = itemPart.substring(bracketIdx);
    } else if (braceIdx > 0) {
        // 旧格式: minecraft:shulker_box{NBT...}
        itemId = itemPart.substring(0, braceIdx);
        componentsStr = itemPart.substring(braceIdx);
    }

    // 解析物品 ID
    let itemName = itemId;
    if (itemId.includes(':')) {
        const [, id] = itemId.split(':');
        itemName = id.replace(/_/g, ' ');
    }
    itemName = itemName.charAt(0).toUpperCase() + itemName.slice(1);

    const isContainer = /(shulker|bundle)/i.test(itemId);
    let containerItems = null;
    let enchantments = [];
    let lore = [];
    let customName = null;

    if (componentsStr) {
        if (isNewFormat) {
            // ===== 新格式解析 (1.21.4+ 组件) =====
            const result = parseNewComponents(componentsStr, isContainer);
            customName = result.customName;
            if (result.customName && result.customName !== itemName) itemName = result.customName;
            lore = result.lore;
            enchantments = result.enchantments;
            containerItems = result.containerItems;
        } else {
            // ===== 旧格式解析 (NBT) =====
            // 提取自定义名
            customName = extractOldCustomName(componentsStr);
            if (customName) itemName = customName;
            // 提取附魔
            enchantments = extractOldEnchantments(componentsStr);
            // 提取 Lore
            lore = extractOldLore(componentsStr);
            // 提取容器内容
            if (isContainer) {
                containerItems = parseContainerNbt(componentsStr);
            }
        }
    }

    const localId = itemId.split(':').pop();
    const iconUrl = `/images/mc-items/${localId}.png`;

    return {
        raw: cmd,
        itemId,
        itemName: customName || itemName,
        count,
        iconUrl,
        isContainer,
        containerItems,
        enchantments,
        lore,
        customName,
    };
}

/**
 * SNBT 键转 JSON 键: 给未加引号的键名添加双引号
 * slot:9 → "slot":9
 */
function snbtToJson(str) {
    return str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_.]*)\s*:/g, '$1"$2":');
}

/**
 * 解析 1.21.4+ 组件格式
 * 输入: [custom_name=[...],lore=[...],container=[...],...]
 */
function parseNewComponents(compStr, isContainer) {
    let customName = null;
    let lore = [];
    let enchantments = [];
    let containerItems = null;

    // 去掉外层方括号
    const inner = compStr.replace(/^\[|\]$/g, '');

    // 提取 custom_name=[...]（方形括号数组）
    const cnMatch = extractBracketValue(inner, 'custom_name');
    if (cnMatch) {
        try {
            // 尝试解析 JSON 数组
            const arr = JSON.parse(cnMatch);
            customName = extractTextFromJson(arr);
        } catch {
            // 如果解析失败，用简单正则提取 text 字段
            const texts = [];
            const textRe = /"text"\s*:\s*"([^"]*)"/g;
            let m;
            while ((m = textRe.exec(cnMatch)) !== null) texts.push(m[1]);
            customName = texts.join('');
        }
    }

    // 提取 lore=[...]（方形括号数组，包含 JSON 对象数组）
    const loreMatch = extractBracketValue(inner, 'lore');
    if (loreMatch) {
        try {
            const arr = JSON.parse(loreMatch);
            if (Array.isArray(arr)) {
                lore = arr.map(item => {
                    if (typeof item === 'string') return item;
                    return extractTextFromJson(item);
                });
            }
        } catch { /* 解析失败跳过 */ }
    }

    // 提取 enchantments={...}（大括号，包含 levels 对象）
    const enchMatch = extractBraceValue(inner, 'enchantments');
    if (enchMatch) {
        try {
            const obj = JSON.parse(enchMatch);
            if (obj.levels) {
                Object.entries(obj.levels).forEach(([enchId, level]) => {
                    enchantments.push({ id: enchId, level: level });
                });
            }
        } catch { /* 解析失败跳过 */ }
    }

    // 提取 container=[...]（方形括号，每个元素 {slot:, item:{id:, count:}}）
    if (isContainer) {
        const contMatch = extractBracketValue(inner, 'container');
        if (contMatch) {
            try {
                const jsonStr = snbtToJson(contMatch);
                const arr = JSON.parse(jsonStr);
                if (Array.isArray(arr)) {
                    containerItems = arr.map(entry => {
                        const item = entry.item || {};
                        const id = item.id || '';
                        const count = item.count || 1;
                        return { id, count };
                    });
                }
            } catch { /* 解析失败跳过 */ }
        }
    }

    return { customName, lore, enchantments, containerItems };
}

/**
 * 提取方形括号值: key=[...]（支持嵌套括号）
 * 输入: "custom_name=[{...},{...}],lore=[...]"
 * key: "custom_name"
 * 输出: "[{...},{...}]"
 */
function extractBracketValue(str, key) {
    const idx = str.indexOf(key + '=');
    if (idx < 0) return null;
    const start = str.indexOf('[', idx);
    if (start < 0) return null;
    let depth = 0;
    let i = start;
    while (i < str.length) {
        if (str[i] === '[') depth++;
        else if (str[i] === ']') { depth--; if (depth === 0) break; }
        i++;
    }
    if (depth !== 0) return null;
    return str.substring(start, i + 1);
}

/**
 * 提取大括号值: key={...}（支持嵌套大括号）
 * 输入: "enchantments={levels:{...},show_in_tooltip:false},lore=[...]"
 * key: "enchantments"
 * 输出: "{levels:{...},show_in_tooltip:false}"
 */
function extractBraceValue(str, key) {
    const idx = str.indexOf(key + '=');
    if (idx < 0) return null;
    let start = str.indexOf('{', idx);
    if (start < 0) return null;
    // 跳过 {} 整体（enchantments={...}）
    let depth = 0;
    let i = start;
    while (i < str.length) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    if (depth !== 0) return null;
    return str.substring(start, i + 1);
}

/** 旧格式: 提取 display.Name */
function extractOldCustomName(nbt) {
    const nameMatch = nbt.match(/Name\s*:\s*('([^'\\]*(?:\\.[^'\\]*)*)'|"((?:[^"\\]|\\.)*)")/i);
    if (!nameMatch) return null;
    const raw = (nameMatch[2] !== undefined ? nameMatch[2] : nameMatch[3]);
    try {
        const parsed = JSON.parse(raw);
        return parsed.text || parsed.translate || parsed.extra?.[0]?.text || raw;
    } catch {
        return raw.replace(/\\'/g, "'").replace(/\\"/g, '"');
    }
}

/** 旧格式: 提取 Enchantments */
function extractOldEnchantments(nbt) {
    const enchants = [];
    const enchMatch = nbt.match(/Enchantments\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/i);
    if (enchMatch) {
        const arr = enchMatch[1];
        const enchRe = /\{[^{}]*id\s*:\s*"([^"]+)"[^{}]*lvl\s*:\s*(\d+)[^{}]*\}/gi;
        let m;
        while ((m = enchRe.exec(arr)) !== null) {
            enchants.push({ id: m[1], level: parseInt(m[2], 10) || 1 });
        }
    }
    return enchants;
}

/** 旧格式: 提取 display.Lore */
function extractOldLore(nbt) {
    const lines = [];
    const loreMatch = nbt.match(/Lore\s*:\s*\[([\s\S]*?)\]\s*(?=[,}])/i);
    if (loreMatch) {
        const arr = loreMatch[1];
        const loreRe = /"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = loreRe.exec(arr)) !== null) {
            let line = m[1].replace(/\\"/g, '"');
            try {
                const parsed = JSON.parse(line);
                if (typeof parsed === 'string') {
                    line = parsed;
                } else if (parsed.text) {
                    line = parsed.text;
                } else if (parsed.translate) {
                    line = parsed.translate;
                } else if (parsed.extra && Array.isArray(parsed.extra)) {
                    line = parsed.extra.map(p => p.text || '').join('');
                }
            } catch { /* 保留原样 */ }
            if (line === 'text' || line === 'extra' || line === 'color' || line === 'italic' || line === 'bold') continue;
            lines.push(line);
        }
    }
    return lines;
}

/**
 * 简易解析 SNBT 容器内容: {BlockEntityTag:{Items:[{id:"minecraft:diamond",Count:1b}, ...]}}
 * 输出 [{ id, count }, ...]
 */
function parseContainerNbt(nbt) {
    const items = [];
    // 找 Items 数组内容
    const itemsMatch = nbt.match(/Items\s*:\s*\[([\s\S]*?)\]/i);
    if (!itemsMatch) return items;
    const arr = itemsMatch[1];
    // 逐个匹配 {id:"...",Count:1b} 或 {id:"...",Count:1}
    const itemRe = /\{[^{}]*id\s*:\s*"([^"]+)"[^{}]*Count\s*:\s*(\d+)[^{}]*\}/g;
    let m;
    while ((m = itemRe.exec(arr)) !== null) {
        items.push({ id: m[1], count: parseInt(m[2], 10) || 1 });
    }
    return items;
}


// ===== 插件端：检查并执行每日福利 =====

/**
 * GET /api/daily-reward/claim/:uuid
 * 供 MC 插件调用：检查玩家是否可以领取，返回执行指令
 * 需要 x-api-key 认证
 */
router.get('/claim/:uuid', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedKey = settingsStmts.get('game_api_key') || process.env.GAME_API_KEY || 'ctmc-verify-secret';

    if (apiKey !== expectedKey) {
        return res.status(403).json({ error: '无效的 API Key' });
    }

    const { uuid } = req.params;
    if (!uuid || uuid.length < 32) {
        return res.status(400).json({ error: '无效的 UUID' });
    }

    // 检查是否已绑定网站账号
    const bound = gameStmts.findByUuid(uuid);
    if (!bound) {
        return res.status(403).json({
            error: '未绑定网站账号',
            message: '请先在网站个人中心绑定 Minecraft 账号',
            bindUrl: 'https://mc.ctfun.top/profile.html',
        });
    }

    // 检查今天是否已领取
    const alreadyClaimed = dailyRewardStmts.hasClaimedToday(uuid);
    if (alreadyClaimed) {
        const status = dailyRewardStmts.getStatus(uuid);
        return res.json({
            success: false,
            claimed: true,
            streak: status.streak,
            message: '今日已领取',
        });
    }

    // 领取
    const result = dailyRewardStmts.claim(uuid, bound.game_username);
    const command = getRewardCommand().replace(/\{player\}/g, bound.game_username);

    res.json({
        success: true,
        claimed: false,
        streak: result.streak,
        message: `签到成功！连续 ${result.streak} 天`,
        command,
    });
});

// ===== 插件端：仅查询（不领取） =====

/**
 * GET /api/daily-reward/check/:uuid
 * 供 MC 插件查询状态（不执行领取）
 * 需要 x-api-key 认证
 */
router.get('/check/:uuid', (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedKey = settingsStmts.get('game_api_key') || process.env.GAME_API_KEY || 'ctmc-verify-secret';

    if (apiKey !== expectedKey) {
        return res.status(403).json({ error: '无效的 API Key' });
    }

    const { uuid } = req.params;
    if (!uuid || uuid.length < 32) {
        return res.status(400).json({ error: '无效的 UUID' });
    }

    const bound = gameStmts.findByUuid(uuid);
    const status = dailyRewardStmts.getStatus(uuid);

    res.json({
        uuid,
        bound: !!bound,
        gameUsername: bound ? bound.game_username : null,
        claimedToday: status.claimedToday,
        streak: status.streak,
        lastClaimed: status.lastClaimed || null,
    });
});

// ===== Web 端：查看状态（只读） =====

/**
 * GET /api/daily-reward/status
 * 登录用户查看每日福利状态（只读，不可领取）
 */
router.get('/status', authRequired, (req, res) => {
    const gameUsername = req.query.gameUsername;
    const bindings = gameStmts.getUserBound(req.user.id);

    if (!bindings.length) {
        const command = getRewardCommand();
        const parsed = parseRewardCommand(command);
        return res.json({
            streak: 0,
            claimedToday: false,
            bound: false,
            rewardCommand: command,
            reward: parsed,
            message: '请先绑定 Minecraft 账号',
        });
    }

    // 查找指定账号或第一个
    let targetUuid = '';
    let targetName = '';
    if (gameUsername) {
        const found = bindings.find(b => b.game_username.toLowerCase() === gameUsername.toLowerCase());
        if (!found) return res.status(404).json({ error: '未找到该绑定账号' });
        targetUuid = found.uuid;
        targetName = found.game_username;
    } else {
        const withUuid = bindings.find(b => b.uuid);
        if (withUuid) {
            targetUuid = withUuid.uuid;
            targetName = withUuid.game_username;
        } else {
            targetName = bindings[0].game_username;
        }
    }

    const command = getRewardCommand();
    const parsed = parseRewardCommand(command);

    if (!targetUuid) {
        return res.json({
            streak: 0,
            claimedToday: false,
            bound: true,
            noUuid: true,
            gameUsername: targetName,
            rewardCommand: command,
            reward: parsed,
            message: '游戏数据尚未同步',
        });
    }

    const status = dailyRewardStmts.getStatus(targetUuid);

    res.json({
        ...status,
        bound: true,
        gameUsername: targetName,
        uuid: targetUuid,
        rewardCommand: command,
        reward: parsed,
    });
});

// ===== 管理员：配置奖励指令 =====

/**
 * GET /api/daily-reward/admin
 * 获取当前奖励指令配置
 */
router.get('/admin', authRequired, adminRequired, (req, res) => {
    const command = getRewardCommand();
    const parsed = parseRewardCommand(command);
    res.json({ command, parsed });
});

/**
 * PUT /api/daily-reward/admin
 * 管理员设置奖励指令
 */
router.put('/admin', authRequired, adminRequired, (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: '请提供奖励指令' });

    // 验证指令格式
    if (!command.includes('{player}')) {
        return res.status(400).json({ error: '指令必须包含 {player} 占位符' });
    }

    setRewardCommand(command.trim());
    const parsed = parseRewardCommand(command.trim());

    res.json({
        message: '奖励指令已保存',
        command: command.trim(),
        parsed,
    });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const util = require('util');
const parseNbt = util.promisify(nbt.parse);
const dbModule = require('../models/db');
const { authRequired } = require('../middleware/auth');
const { getDb, settingsStmts, gameStmts, inventoryStmts } = dbModule;

// playerdata 存储目录
const PLAYERDATA_DIR = path.join(__dirname, '..', 'data', 'playerdata');

// 物品图标缓存目录
const ITEM_ICON_DIR = path.join(__dirname, '..', 'images', 'mc-items');
// 本地已有完整贴图，CDN 仅作回退
const ITEM_ICON_CDN_SOURCES = [
    'https://mcitemgallery.com/images/1.21.10/',
    'https://minecraft.wiki/images/',
];

// 物品中文名映射（常用物品）
const itemNames = {
    'minecraft:diamond': '钻石', 'minecraft:diamond_block': '钻石块',
    'minecraft:diamond_sword': '钻石剑', 'minecraft:diamond_pickaxe': '钻石镐',
    'minecraft:diamond_axe': '钻石斧', 'minecraft:diamond_shovel': '钻石锹',
    'minecraft:diamond_hoe': '钻石锄', 'minecraft:diamond_helmet': '钻石头盔',
    'minecraft:diamond_chestplate': '钻石胸甲', 'minecraft:diamond_leggings': '钻石护腿',
    'minecraft:diamond_boots': '钻石靴子', 'minecraft:netherite_ingot': '下界合金锭',
    'minecraft:netherite_sword': '下界合金剑', 'minecraft:netherite_pickaxe': '下界合金镐',
    'minecraft:netherite_axe': '下界合金斧', 'minecraft:netherite_shovel': '下界合金锹',
    'minecraft:netherite_hoe': '下界合金锄', 'minecraft:netherite_helmet': '下界合金头盔',
    'minecraft:netherite_chestplate': '下界合金胸甲', 'minecraft:netherite_leggings': '下界合金护腿',
    'minecraft:netherite_boots': '下界合金靴子', 'minecraft:iron_ingot': '铁锭',
    'minecraft:iron_sword': '铁剑', 'minecraft:iron_pickaxe': '铁镐', 'minecraft:iron_axe': '铁斧',
    'minecraft:iron_shovel': '铁锹', 'minecraft:iron_hoe': '铁锄', 'minecraft:iron_helmet': '铁头盔',
    'minecraft:iron_chestplate': '铁胸甲', 'minecraft:iron_leggings': '铁护腿',
    'minecraft:iron_boots': '铁靴子', 'minecraft:gold_ingot': '金锭',
    'minecraft:golden_apple': '金苹果', 'minecraft:enchanted_golden_apple': '附魔金苹果',
    'minecraft:golden_carrot': '金胡萝卜', 'minecraft:emerald': '绿宝石',
    'minecraft:lapis_lazuli': '青金石', 'minecraft:coal': '煤炭', 'minecraft:redstone': '红石粉',
    'minecraft:stick': '木棍', 'minecraft:string': '线', 'minecraft:feather': '羽毛',
    'minecraft:gunpowder': '火药', 'minecraft:leather': '皮革', 'minecraft:bone': '骨头',
    'minecraft:ender_pearl': '末影珍珠', 'minecraft:blaze_rod': '烈焰棒',
    'minecraft:nether_star': '下界之星', 'minecraft:totem_of_undying': '不死图腾',
    'minecraft:elytra': '鞘翅', 'minecraft:trident': '三叉戟', 'minecraft:shield': '盾牌',
    'minecraft:bow': '弓', 'minecraft:crossbow': '弩', 'minecraft:arrow': '箭',
    'minecraft:fishing_rod': '钓鱼竿', 'minecraft:shears': '剪刀', 'minecraft:flint_and_steel': '打火石',
    'minecraft:compass': '指南针', 'minecraft:name_tag': '命名牌', 'minecraft:saddle': '鞍',
    'minecraft:oak_log': '橡木原木', 'minecraft:spruce_log': '云杉原木',
    'minecraft:birch_log': '白桦原木', 'minecraft:cobblestone': '圆石', 'minecraft:stone': '石头',
    'minecraft:deepslate': '深板岩', 'minecraft:dirt': '泥土', 'minecraft:sand': '沙子',
    'minecraft:gravel': '沙砾', 'minecraft:water_bucket': '水桶', 'minecraft:lava_bucket': '熔岩桶',
    'minecraft:bucket': '桶', 'minecraft:bread': '面包', 'minecraft:cooked_beef': '熟牛肉',
    'minecraft:cooked_porkchop': '熟猪排', 'minecraft:cooked_chicken': '熟鸡肉',
    'minecraft:apple': '苹果', 'minecraft:carrot': '胡萝卜', 'minecraft:potato': '马铃薯',
    'minecraft:baked_potato': '烤马铃薯', 'minecraft:egg': '鸡蛋', 'minecraft:wheat': '小麦',
    'minecraft:experience_bottle': '附魔之瓶', 'minecraft:enchanting_table': '附魔台',
    'minecraft:anvil': '铁砧', 'minecraft:crafting_table': '工作台', 'minecraft:furnace': '熔炉',
    'minecraft:chest': '箱子', 'minecraft:ender_chest': '末影箱', 'minecraft:barrel': '木桶',
    'minecraft:shulker_box': '潜影盒', 'minecraft:torch': '火把', 'minecraft:obsidian': '黑曜石',
    'minecraft:tnt': 'TNT', 'minecraft:slime_ball': '粘液球', 'minecraft:honey_bottle': '蜂蜜瓶',
    'minecraft:book': '书', 'minecraft:writable_book': '书与笔', 'minecraft:enchanted_book': '附魔书',
    'minecraft:paper': '纸', 'minecraft:firework_rocket': '烟花火箭',
    'minecraft:glowstone_dust': '萤石粉', 'minecraft:netherrack': '下界岩',
    'minecraft:nether_wart': '下界疣', 'minecraft:blaze_powder': '烈焰粉',
    'minecraft:ghast_tear': '恶魂之泪', 'minecraft:rotten_flesh': '腐肉',
    'minecraft:bone_meal': '骨粉', 'minecraft:ender_eye': '末影之眼', 'minecraft:beacon': '信标',
    'minecraft:dragon_egg': '龙蛋', 'minecraft:wither_skeleton_skull': '凋灵骷髅头颅',
    'minecraft:netherite_upgrade_smithing_template': '下界合金升级锻造模板',
    'minecraft:echo_shard': '回响碎片', 'minecraft:amethyst_shard': '紫水晶碎片',
    'minecraft:copper_ingot': '铜锭', 'minecraft:raw_iron': '粗铁', 'minecraft:raw_gold': '粗金',
    'minecraft:raw_copper': '粗铜', 'minecraft:breeze_rod': '旋风棒', 'minecraft:mace': '重锤',
    'minecraft:heavy_core': '沉重核心',
};

function getItemName(id) {
    return itemNames[id] || id.replace('minecraft:', '').replace(/_/g, ' ');
}

// 耐久度
const durability = {
    'minecraft:diamond_sword': 1561, 'minecraft:diamond_pickaxe': 1561,
    'minecraft:diamond_axe': 1561, 'minecraft:diamond_shovel': 1561, 'minecraft:diamond_hoe': 1561,
    'minecraft:diamond_helmet': 363, 'minecraft:diamond_chestplate': 528,
    'minecraft:diamond_leggings': 495, 'minecraft:diamond_boots': 429,
    'minecraft:netherite_sword': 2031, 'minecraft:netherite_pickaxe': 2031,
    'minecraft:netherite_axe': 2031, 'minecraft:netherite_shovel': 2031, 'minecraft:netherite_hoe': 2031,
    'minecraft:netherite_helmet': 407, 'minecraft:netherite_chestplate': 592,
    'minecraft:netherite_leggings': 555, 'minecraft:netherite_boots': 481,
    'minecraft:iron_sword': 250, 'minecraft:iron_pickaxe': 250, 'minecraft:iron_axe': 250,
    'minecraft:iron_shovel': 250, 'minecraft:iron_hoe': 250, 'minecraft:iron_helmet': 165,
    'minecraft:iron_chestplate': 240, 'minecraft:iron_leggings': 225, 'minecraft:iron_boots': 195,
    'minecraft:golden_sword': 32, 'minecraft:golden_pickaxe': 32, 'minecraft:golden_axe': 32,
    'minecraft:golden_shovel': 32, 'minecraft:golden_hoe': 32, 'minecraft:golden_helmet': 77,
    'minecraft:golden_chestplate': 112, 'minecraft:golden_leggings': 105, 'minecraft:golden_boots': 91,
    'minecraft:wooden_sword': 59, 'minecraft:wooden_pickaxe': 59, 'minecraft:wooden_axe': 59,
    'minecraft:wooden_shovel': 59, 'minecraft:wooden_hoe': 59,
    'minecraft:stone_sword': 131, 'minecraft:stone_pickaxe': 131, 'minecraft:stone_axe': 131,
    'minecraft:stone_shovel': 131, 'minecraft:stone_hoe': 131,
    'minecraft:leather_helmet': 55, 'minecraft:leather_chestplate': 80,
    'minecraft:leather_leggings': 75, 'minecraft:leather_boots': 65,
    'minecraft:turtle_helmet': 275, 'minecraft:elytra': 432,
    'minecraft:fishing_rod': 64, 'minecraft:flint_and_steel': 64, 'minecraft:shears': 238,
    'minecraft:bow': 384, 'minecraft:crossbow': 326, 'minecraft:trident': 250,
    'minecraft:shield': 336, 'minecraft:brush': 64, 'minecraft:mace': 250,
    'minecraft:wolf_armor': 64, 'minecraft:carrot_on_a_stick': 25,
};

function getMaxDamage(itemId) { return durability[itemId] || 0; }

// 按插槽区域分组
function groupInventory(items) {
    const hotbar = [], main = [], armor = [], offhand = [];
    for (const item of items) {
        const s = item.slot;
        if (s >= 0 && s <= 8) hotbar[s] = item;
        else if (s >= 9 && s <= 35) main[s - 9] = item;
        else if (s === 40 || s === -106) offhand[0] = item;
        else if (s >= 100 && s <= 103) armor[s === 100 ? 0 : s === 101 ? 1 : s === 102 ? 2 : 3] = item;
    }
    const armorIds = [armor[0]?.id, armor[1]?.id, armor[2]?.id, armor[3]?.id].filter(Boolean);
    const offhandIds = [offhand[0]?.id].filter(Boolean);
    console.log(`[inventory] 分类: hotbar=${hotbar.filter(Boolean).length}, main=${main.filter(Boolean).length}, armor=[${armorIds.join(',')}], offhand=[${offhandIds.join(',')}]`);
    return { hotbar, main, armor, offhand };
}

// API Key 验证
function verifyApiKey(req) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedKey = settingsStmts.get('game_api_key') || process.env.GAME_API_KEY || 'ctmc-verify-secret';
    return apiKey === expectedKey;
}

// ===== 解析玩家 .dat 文件 =====
async function parseDatFile(datPath) {
    const data = fs.readFileSync(datPath);
    const result = await parseNbt(data);
    // prismarine-nbt v2 返回 { parsed, type, metadata }，需要取 .parsed
    const rootTag = result.parsed || result;
    const root = rootTag.value;
    if (!root) return null;

    const invData = parseInventoryNbt(root.Inventory);

    // 使用 ?? 而非 ||，避免 0（死亡时 health=0）被错误回退到默认值
    const health = root.Health?.value ?? root.health?.value ?? 20;
    const foodLevel = root.foodLevel?.value ?? 20;
    const xpLevel = root.XpLevel?.value ?? root.XpP?.value ?? 0;
    const xpProgress = root.XpP?.value ?? 0;
    const xpTotal = root.XpTotal?.value ?? 0;

    console.log(`[parseDat] 解析完成: health=${health}, food=${foodLevel}, xp=${xpLevel}, items=${invData.length}`);

    return { health, foodLevel, xpLevel, xpProgress, xpTotal, items: invData };
}

function parseInventoryNbt(invList) {
    if (!invList || !Array.isArray(invList.value?.value)) return [];

    // 判断 NBT 模式：big 模式下 entry 没有 type 包装，直接是 compound 内容
    const firstEntry = invList.value.value[0];
    const isBigMode = firstEntry && !firstEntry.type;

    const items = [];
    for (const entry of invList.value.value) {
        if (!entry) continue;

        // big 模式：entry 直接就是 { Slot: {...}, id: {...}, ... }
        // little 模式：entry = { type: 'compound', value: { Slot: {...}, id: {...}, ... } }
        const compound = isBigMode ? entry : (entry.type === 'compound' ? entry.value : null);
        if (!compound) continue;

        const id = compound.id?.value;
        if (!id) continue;

        // Slot 兼容大写和小写格式
        const slot = (compound.Slot || compound.slot)?.value;
        // Minecraft 1.21+ 使用小写 count，旧版使用大写 Count
        const count = compound.count?.value || compound.Count?.value || 1;

        // Minecraft 1.21+ 使用 components，旧版使用 tag
        const tag = compound.tag?.value;
        const components = compound.components?.value;

        let damage = 0, displayName = null, lore = [], enchantments = [];

        if (components) {
            // 新版 1.21+ components 格式
            damage = components['minecraft:damage']?.value || 0;

            // 附魔：新版是 map { enchant_id: { type: 'int', value: level } }
            const enchComp = components['minecraft:enchantments']?.value;
            if (enchComp && typeof enchComp === 'object') {
                for (const [enchId, enchVal] of Object.entries(enchComp)) {
                    enchantments.push({ id: enchId, lvl: enchVal?.value || 1 });
                }
            }

            // 自定义名称
            const customName = components['minecraft:custom_name']?.value;
            if (customName) {
                displayName = extractTextComponent(customName);
            }

            // Lore
            const loreComp = components['minecraft:lore']?.value;
            if (loreComp?.value && Array.isArray(loreComp.value)) {
                lore = loreComp.value.map(l => extractTextComponent(l?.value || l) || l);
            }
        } else if (tag) {
            // 旧版 tag 格式
            if (tag.Damage) damage = tag.Damage.value;
            if (tag.display?.value) {
                const display = tag.display.value;
                const nameJson = display.Name?.value;
                if (nameJson) {
                    try { displayName = JSON.parse(nameJson).text || nameJson; } catch { displayName = nameJson; }
                }
                if (display.Lore?.value?.value) {
                    lore = display.Lore.value.value.map(l => {
                        try { return JSON.parse(l).text || l; } catch { return l; }
                    });
                }
            }
            if (tag.Enchantments?.value?.value) {
                enchantments = tag.Enchantments.value.value.map(e => ({
                    id: e.id?.value || '', lvl: e.lvl?.value || 1
                }));
            }
        }

        // 解析容器内物品（潜影盒 / 收纳袋 / 末影箱等）
        const containerItems = extractContainerItems(tag);

        items.push({
            slot, id, name: displayName || getItemName(id),
            count, damage, maxDamage: getMaxDamage(id), lore, enchantments,
            containerItems: containerItems.length ? containerItems : undefined
        });
    }
    return items;
}

// 提取 Minecraft JSON 文本组件中的纯文本
function extractTextComponent(comp) {
    if (!comp) return null;
    if (typeof comp === 'string') {
        try { const p = JSON.parse(comp); return extractTextComponent(p); } catch { return comp; }
    }
    // 处理 { text: '...', extra: [...] } 结构
    let result = comp.text?.value || '';
    if (comp.extra?.value?.value && Array.isArray(comp.extra.value.value)) {
        for (const part of comp.extra.value.value) {
            const partComp = part;
            result += partComp.text?.value || '';
        }
    }
    return result || null;
}

// 从物品 tag 中提取容器内物品（潜影盒/收纳袋/末影箱等）
// 不同版本格式不同：1.20+ 用 components，1.20- 用 BlockEntityTag.Items / Items
function extractContainerItems(tag) {
    if (!tag) return [];
    const items = [];
    // 候选路径：tag.BlockEntityTag.Items（旧版）/ tag.Items（部分旧版）
    let rawItems = null;
    if (tag.BlockEntityTag?.value?.Items?.value?.value) {
        rawItems = tag.BlockEntityTag.value.Items.value.value;
    } else if (tag.Items?.value?.value) {
        rawItems = tag.Items.value.value;
    }
    if (!Array.isArray(rawItems)) return items;

    for (const raw of rawItems) {
        const id = raw.id?.value || raw.id;
        if (!id) continue;
        let count = 1;
        if (raw.Count?.value !== undefined) {
            count = typeof raw.Count.value === 'object' ? Number(raw.Count.value.value || 1) : (raw.Count.value | 0);
        }
        const innerTag = raw.tag?.value || raw.tag;
        const inner = parseItemTag(innerTag);
        items.push({
            id,
            name: inner.name || getItemName(id),
            count,
            enchantments: inner.enchantments,
            lore: inner.lore,
        });
    }
    return items;
}

// 解析单个 item 的 tag 字段（容器内物品的辅助函数）
function parseItemTag(tag) {
    const result = { name: '', enchantments: [], lore: [] };
    if (!tag) return result;
    if (tag.display?.value) {
        const display = tag.display.value;
        if (display.Name?.value) result.name = extractTextComponent(display.Name.value) || '';
        if (display.Lore?.value?.value) {
            result.lore = display.Lore.value.value.map(l => {
                try { return JSON.parse(l).text || l; } catch { return l; }
            });
        }
    }
    if (tag.Enchantments?.value?.value) {
        result.enchantments = tag.Enchantments.value.value.map(e => ({
            id: e.id?.value || '', lvl: e.lvl?.value || 1
        }));
    }
    return result;
}

// ===== 路由 =====

/**
 * POST /api/inventory/sync
 * 供 MC 插件推送玩家 .dat 文件（base64 编码）
 * Headers: X-API-Key
 * Body: { players: [{ uuid, name, datFile: "<base64>" }] }
 * 也兼容旧格式：{ players: [{ uuid, name, health, foodLevel, ... }] }
 */
router.post('/sync', async (req, res) => {
    if (!verifyApiKey(req)) {
        return res.status(403).json({ error: '无效的 API Key' });
    }

    const { players } = req.body;
    if (!Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: '缺少 players 数据' });
    }

    try {
        // 确保目录存在
        if (!fs.existsSync(PLAYERDATA_DIR)) {
            fs.mkdirSync(PLAYERDATA_DIR, { recursive: true });
        }

        let count = 0;

        for (const player of players) {
            if (!player.uuid || !player.name) continue;

            let playerData;

            // 如果有 datFile，解析 base64 .dat 文件
            if (player.datFile) {
                const datPath = path.join(PLAYERDATA_DIR, `${player.uuid}.dat`);
                try {
                    const buf = Buffer.from(player.datFile, 'base64');
                    fs.writeFileSync(datPath, buf);
                    playerData = await parseDatFile(datPath);
                    if (!playerData) {
                        console.log(`[inventory] ${player.name}: .dat 解析失败，跳过`);
                        continue;
                    }
                    playerData.health = playerData.health ?? player.health ?? 20;
                    playerData.foodLevel = playerData.foodLevel ?? player.foodLevel ?? 20;
                } catch (e) {
                    console.log(`[inventory] ${player.name}: .dat 处理异常: ${e.message}`);
                    continue;
                }
            } else {
                // 兼容旧格式：直接使用 JSON 中的 items
                playerData = {
                    health: player.health ?? 20,
                    foodLevel: player.foodLevel ?? 20,
                    xpLevel: player.xpLevel ?? 0,
                    xpProgress: player.xpProgress ?? 0,
                    xpTotal: player.xpTotal ?? 0,
                    items: player.items ?? [],
                };
            }

            inventoryStmts.upsert(player.uuid, player.name, playerData);
            count++;
        }

        console.log(`[inventory] 已同步 ${count} 个玩家背包数据`);
        res.json({ success: true, synced: count });
    } catch (err) {
        console.error('[inventory] 同步失败:', err.message);
        res.status(500).json({ error: '同步失败: ' + err.message });
    }
});

/**
 * GET /api/inventory/list
 */
router.get('/list', authRequired, (req, res) => {
    const bindings = gameStmts.getUserBound(req.user.id);
    res.json({ bindings: bindings || [] });
});

/**
 * GET /api/inventory/:gameUsername
 * 获取指定游戏账号的背包数据（从 DB 缓存读取）
 * 如果 DB 无数据，尝试从保存的 .dat 文件中读取
 */
router.get('/:gameUsername', authRequired, async (req, res) => {
    try {
        const { gameUsername } = req.params;

        const bindings = gameStmts.getUserBound(req.user.id);
        const isOwn = bindings && bindings.some(b => b.game_username.toLowerCase() === gameUsername.toLowerCase());

        if (!isOwn && req.user.role !== 'admin') {
            return res.status(403).json({ error: '无权查看该玩家的背包（需先绑定该游戏账号）' });
        }

        // 确定 UUID
        let uuid = null;
        if (bindings) {
            const bound = bindings.find(b => b.game_username.toLowerCase() === gameUsername.toLowerCase());
            if (bound && bound.uuid) uuid = bound.uuid.includes('-') ? bound.uuid : bound.uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        }

        // 1. 优先从 DB 读取
        let row = inventoryStmts.getByPlayerName(gameUsername);
        if (!row && uuid) row = inventoryStmts.getByUuid(uuid);

        // 2. 如果 DB 没有，尝试从本地 .dat 文件读取
        if (!row && uuid) {
            const datPath = path.join(PLAYERDATA_DIR, `${uuid}.dat`);
            if (fs.existsSync(datPath)) {
                try {
                    const playerData = await parseDatFile(datPath);
                    if (playerData) {
                        // 存入 DB
                        inventoryStmts.upsert(uuid, gameUsername, playerData);
                        const items = playerData.items.map(item => ({
                            ...item,
                            name: item.name || getItemName(item.id),
                            maxDamage: getMaxDamage(item.id),
                        }));
                        const totals = items.reduce((acc, i) => { acc[i.id] = (acc[i.id] || 0) + i.count; return acc; }, {});
                        return res.json({
                            playerName: gameUsername, uuid, ...playerData,
                            xpProgress: Math.round((playerData.xpProgress || 0) * 100),
                            xpLevel: playerData.xpLevel || 0,
                            itemCount: items.reduce((s, i) => s + i.count, 0),
                            uniqueItems: Object.keys(totals).length,
                            updatedAt: new Date().toISOString(),
                            ...groupInventory(items), totals
                        });
                    }
                } catch (e) {
                    console.log(`[inventory] .dat 回退解析失败 (${gameUsername}): ${e.message}`);
                }
            }
        }

        if (!row) {
            return res.status(404).json({ error: '暂无背包数据，请等待玩家上线或退出后插件同步' });
        }

        const items = (row.items ?? []).map(item => ({
            ...item,
            name: item.displayName || item.name || getItemName(item.id),
            maxDamage: getMaxDamage(item.id),
        }));

        const totals = items.reduce((acc, item) => { acc[item.id] = (acc[item.id] || 0) + item.count; return acc; }, {});

        console.log(`[inventory] GET ${gameUsername}: health=${row.health}, food=${row.food_level}, items=${items.length}`);
        // 排查装备物品
        const equipItems = items.filter(i => i.slot >= 100 || i.slot === 40 || i.slot === -106);
        if (equipItems.length > 0) {
            console.log(`[inventory] 装备物品:`, equipItems.map(i => `slot=${i.slot} id=${i.id}`));
        } else {
            console.log(`[inventory] 未检测到装备物品（护甲/副手为空）`);
        }

        res.json({
            playerName: row.player_name, uuid: row.uuid,
            health: row.health, foodLevel: row.food_level,
            xpLevel: row.xp_level, xpProgress: Math.round((row.xp_progress || 0) * 100),
            xpTotal: row.xp_total, itemCount: row.item_count,
            uniqueItems: Object.keys(totals).length, updatedAt: row.updated_at,
            ...groupInventory(items), totals
        });
    } catch (err) {
        console.error('[inventory] 查询失败:', err.message);
        res.status(500).json({ error: '查询背包数据失败: ' + err.message });
    }
});

/**
 * GET /api/inventory/item-icon/:itemName
 * 物品图标缓存代理：首次从 CDN 下载并缓存到本地，后续直接返回缓存
 */
router.get('/item-icon/:itemName', async (req, res) => {
    try {
        const itemName = req.params.itemName.replace(/[^a-z0-9_\.\-]/gi, '');
        if (!itemName || !itemName.endsWith('.png')) {
            return res.status(400).json({ error: '无效的文件名' });
        }

        const cachePath = path.join(ITEM_ICON_DIR, itemName);

        // 已有缓存，直接返回
        if (fs.existsSync(cachePath)) {
            res.set('Cache-Control', 'public, max-age=86400');
            return res.sendFile(cachePath);
        }

        // 依次尝试多个 CDN 源
        let buffer = null;
        for (const cdnBase of ITEM_ICON_CDN_SOURCES) {
            try {
                const response = await fetch(cdnBase + itemName);
                if (response.ok) {
                    buffer = Buffer.from(await response.arrayBuffer());
                    break;
                }
            } catch { /* 当前源失败，尝试下一个 */ }
        }

        if (!buffer) {
            return res.status(404).json({ error: '图标不存在' });
        }

        // 确保缓存目录存在
        if (!fs.existsSync(ITEM_ICON_DIR)) {
            fs.mkdirSync(ITEM_ICON_DIR, { recursive: true });
        }

        fs.writeFileSync(cachePath, buffer);
        console.log(`[icon] 已缓存: ${itemName}`);

        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (e) {
        console.error(`[icon] 获取失败 (${req.params.itemName}):`, e.message);
        res.status(502).json({ error: 'CDN 获取失败' });
    }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { stmts } = require('../models/db');
const { authRequired, banCheck } = require('../middleware/auth');

const router = express.Router();

// 确保上传目录存在
const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer 配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const name = `avatar_${req.user.id}_${Date.now()}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const allowed = /\.(png|jpg|jpeg|gif|webp)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('仅支持 png、jpg、jpeg、gif、webp 格式'));
        }
    }
});

// 上传头像
router.post('/avatar', authRequired, banCheck, (req, res) => {
    upload.single('avatar')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: '文件大小不能超过 2MB' });
                }
                return res.status(400).json({ error: '上传失败: ' + err.message });
            }
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: '请选择图片文件' });
        }

        // 删除旧头像
        const user = stmts.findById(req.user.id);
        if (user && user.avatar_url) {
            const oldPath = path.join(__dirname, '..', user.avatar_url);
            if (fs.existsSync(oldPath) && user.avatar_url.startsWith('uploads/')) {
                fs.unlinkSync(oldPath);
            }
        }

        const avatarUrl = 'uploads/avatars/' + req.file.filename;
        stmts.updateAvatar(avatarUrl, req.user.id);

        res.json({ message: '头像上传成功', avatar_url: avatarUrl });
    });
});

// 删除头像（恢复默认）
router.delete('/avatar', authRequired, (req, res) => {
    const user = stmts.findById(req.user.id);
    if (user && user.avatar_url) {
        const oldPath = path.join(__dirname, '..', user.avatar_url);
        if (fs.existsSync(oldPath) && user.avatar_url.startsWith('uploads/')) {
            fs.unlinkSync(oldPath);
        }
    }
    stmts.updateAvatar('', req.user.id);
    res.json({ message: '头像已恢复默认' });
});

module.exports = router;

// 账号系统前端模块 - 完整版
import { showToast } from './ui.js';

const API_BASE = '/api/auth';
const ADMIN_BASE = '/api/admin';

// Token
export function getToken() { return localStorage.getItem('ctmc_token'); }
export function setToken(token) { localStorage.setItem('ctmc_token', token); }
export function clearToken() { localStorage.removeItem('ctmc_token'); }

export function getCurrentUser() {
    const u = localStorage.getItem('ctmc_user');
    return u ? JSON.parse(u) : null;
}
function setCurrentUser(user) { localStorage.setItem('ctmc_user', JSON.stringify(user)); }
function clearCurrentUser() { localStorage.removeItem('ctmc_user'); }

export function isLoggedIn() { return !!getToken(); }

export async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
        // 401/403 → 自动清除登录状态并跳转登录页（防重入：每个 session 只跳一次）
        if (res.status === 401 || res.status === 403) {
            clearToken();
            clearCurrentUser();
            const path = window.location.pathname;
            if (path !== '/login.html' && path !== '/register.html' && !window.__authRedirecting) {
                window.__authRedirecting = true;
                setTimeout(() => { window.location.href = '/login.html'; }, 50);
            }
        }
        const err = new Error(data.error || '请求失败');
        err.data = data;
        throw err;
    }
    return data;
}

// ===== 用户 API =====

export async function login(username, password, rememberMe = false, hcaptchaToken = '') {
    const data = await authFetch(`${API_BASE}/login`, {
        method: 'POST',
        body: JSON.stringify({ username, password, rememberMe, hcaptchaToken })
    });
    if (data.require2FA) return data; // 需要 2FA
    setToken(data.token);
    setCurrentUser(data.user);
    return data;
}

export async function verify2FA(tempToken, code, rememberMe) {
    const data = await authFetch(`${API_BASE}/2fa/verify`, {
        method: 'POST',
        body: JSON.stringify({ tempToken, code, rememberMe })
    });
    setToken(data.token);
    setCurrentUser(data.user);
    return data;
}

export async function register(username, email, password, nickname, hcaptchaToken = '') {
    return await authFetch(`${API_BASE}/register`, {
        method: 'POST',
        body: JSON.stringify({ username, email, password, nickname, hcaptchaToken })
    });
}

export function logout() {
    clearToken();
    clearCurrentUser();
    window.location.href = '/login.html';
}

export async function fetchProfile() {
    const data = await authFetch(`${API_BASE}/me`, { method: 'GET' });
    setCurrentUser(data.user);
    return data.user;
}

export async function updateProfile(nickname) {
    const data = await authFetch(`${API_BASE}/profile`, {
        method: 'PUT', body: JSON.stringify({ nickname })
    });
    const u = getCurrentUser(); if (u) { u.nickname = nickname; setCurrentUser(u); }
    return data;
}

export async function changePassword(currentPassword, newPassword) {
    const data = await authFetch(`${API_BASE}/password`, {
        method: 'PUT', body: JSON.stringify({ currentPassword, newPassword })
    });
    // 修改密码后需要重新登录
    clearToken(); clearCurrentUser();
    return data;
}

export async function deleteAccount(password) {
    const data = await authFetch(`${API_BASE}/account`, {
        method: 'DELETE', body: JSON.stringify({ password })
    });
    clearToken(); clearCurrentUser();
    return data;
}

// ===== 2FA =====

export async function setup2FA() {
    return await authFetch(`${API_BASE}/2fa/setup`, { method: 'GET' });
}

export async function enable2FA(code) {
    return await authFetch(`${API_BASE}/2fa/enable`, {
        method: 'POST', body: JSON.stringify({ code })
    });
}

export async function disable2FA(password, code) {
    return await authFetch(`${API_BASE}/2fa/disable`, {
        method: 'POST', body: JSON.stringify({ password, code })
    });
}

// ===== 邮箱验证 =====

export async function sendVerification() {
    return await authFetch(`${API_BASE}/send-verification`, { method: 'POST' });
}

export async function verifyEmail(code) {
    return await authFetch(`${API_BASE}/verify-email`, {
        method: 'POST', body: JSON.stringify({ code })
    });
}

// ===== 会话管理 =====

export async function getSessions() {
    return await authFetch(`${API_BASE}/sessions`, { method: 'GET' });
}

export async function revokeSession(sessionId) {
    return await authFetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
}

// ===== 登录历史 & 活动日志 =====

export async function getLoginHistory() {
    return await authFetch(`${API_BASE}/login-history`, { method: 'GET' });
}

export async function getActivityLog() {
    return await authFetch(`${API_BASE}/activity-log`, { method: 'GET' });
}

// ===== 管理员 API =====

export async function adminFetchUsers() {
    return await authFetch(`${ADMIN_BASE}/users`, { method: 'GET' });
}
export async function adminChangeRole(id, role) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/role`, {
        method: 'PUT', body: JSON.stringify({ role })
    });
}
export async function adminBanUser(id, reason) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/ban`, {
        method: 'PUT', body: JSON.stringify({ reason })
    });
}
export async function adminUnbanUser(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/unban`, { method: 'PUT' });
}
export async function adminResetPassword(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/reset-password`, { method: 'POST' });
}
export async function adminUnlockUser(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/unlock`, { method: 'POST' });
}
export async function adminDeleteUser(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}`, { method: 'DELETE' });
}
export async function adminCreateUser(data) {
    return await authFetch(`${ADMIN_BASE}/users`, { method: 'POST', body: JSON.stringify(data) });
}
export async function adminSetEmailVerified(id, verified) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/email-verified`, { method: 'PUT', body: JSON.stringify({ verified }) });
}
export async function adminDisable2FA(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/disable-2fa`, { method: 'POST' });
}
export async function adminSetPassword(id, password) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
}
export async function adminGetUserInventoryBindings(id) {
    return await authFetch(`${ADMIN_BASE}/users/${id}/inventory-bindings`, { method: 'GET' });
}

// ===== 游戏账号绑定 =====
const GAME_BASE = '/api/game';

export async function verifyGameAccount(gameUsername, sha256Password) {
    return await authFetch(`${GAME_BASE}/verify`, {
        method: 'POST',
        body: JSON.stringify({ gameUsername, gamePassword: sha256Password }),
    });
}
export async function bindGameAccount(gameUsername) {
    return await authFetch(`${GAME_BASE}/bind`, {
        method: 'POST',
        body: JSON.stringify({ gameUsername }),
    });
}
export async function unbindGameAccount(gameUsername) {
    return await authFetch(`${GAME_BASE}/unbind/${encodeURIComponent(gameUsername)}`, { method: 'DELETE' });
}
export async function getGameBindings() {
    return await authFetch(`${GAME_BASE}/bindings`);
}

export async function generateVerifyCode(gameUsername) {
    return await authFetch(`${GAME_BASE}/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ gameUsername }),
    });
}

// ===== 换绑邮箱 =====
export async function changeEmail(newEmail, password) {
    return await authFetch(`${API_BASE}/email`, {
        method: 'PUT',
        body: JSON.stringify({ newEmail, password }),
    });
}

// ===== 系统设置 =====
const ADMIN_BASE_RAW = '/api/admin';

export async function fetchSettings() {
    return await authFetch(`${ADMIN_BASE_RAW}/settings`);
}

export async function updateSetting(key, value) {
    return await authFetch(`${ADMIN_BASE_RAW}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ key, value }),
    });
}

// ===== 头像上传 =====
const UPLOAD_BASE = '/api/upload';

export async function uploadAvatar(file) {
    const token = getToken();
    const formData = new FormData();
    formData.append('avatar', file);
    const res = await fetch(`${UPLOAD_BASE}/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    return data;
}

export async function deleteAvatar() {
    return await authFetch(`${UPLOAD_BASE}/avatar`, { method: 'DELETE' });
}

// ===== 背包查看 =====
export async function getInventory(gameUsername) {
    return await authFetch(`${API_BASE.replace('/auth', '/inventory')}/${encodeURIComponent(gameUsername)}`);
}

// ===== 每日福利 =====
const DAILY_REWARD_BASE = '/api/daily-reward';

export async function getDailyRewardStatus(gameUsername) {
    const params = gameUsername ? `?gameUsername=${encodeURIComponent(gameUsername)}` : '';
    return await authFetch(`${DAILY_REWARD_BASE}/status${params}`);
}

export async function getDailyRewardAdmin() {
    return await authFetch(`${DAILY_REWARD_BASE}/admin`);
}

export async function updateDailyRewardCommand(command) {
    return await authFetch(`${DAILY_REWARD_BASE}/admin`, {
        method: 'PUT',
        body: JSON.stringify({ command }),
    });
}


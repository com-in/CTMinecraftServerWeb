package com.ctmc.verify;

import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

public class CTMCVerify extends JavaPlugin implements Listener {

    private String apiUrl;
    private String apiKey;
    private String syncUrl;
    private int syncInterval;
    private String dailyClaimUrl;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        apiUrl = getConfig().getString("api-url", "http://localhost:3000/api/game/confirm-verify");
        apiKey = getConfig().getString("api-key", "ctmc-verify-secret");
        syncUrl = getConfig().getString("sync-url", "http://localhost:3000/api/inventory/sync");
        syncInterval = Math.max(10, getConfig().getInt("sync-interval", 60));
        dailyClaimUrl = getConfig().getString("daily-claim-url", "http://localhost:3000/api/daily-reward/claim");

        getServer().getPluginManager().registerEvents(this, this);
        startInventorySync();

        getLogger().info("WebBind v1.3 已启用 - DAT 文件推送模式");
        getLogger().info("  背包同步: " + syncUrl + " (每 " + syncInterval + " 秒)");
        getLogger().info("  每日福利: " + dailyClaimUrl);
    }

    @Override
    public void onDisable() {
        // 关闭时不再推送（scheduler 已停，异步任务不会执行）
        getLogger().info("WebBind 已卸载");
    }

    // 玩家退出时推送 .dat（延迟 1 秒等 Minecraft 保存）
    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(this, () -> syncPlayerDat(player), 20L);
    }

    // 定时同步所有在线玩家
    private void startInventorySync() {
        long ticks = syncInterval * 20L;
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            if (syncUrl == null || syncUrl.isEmpty()) return;

            Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                Collection<? extends Player> players = Bukkit.getOnlinePlayers();
                if (players.isEmpty()) return;

                StringBuilder sb = new StringBuilder();
                sb.append("{\"players\":[");
                int count = 0;

                for (Player p : players) {
                    String b64 = readDatFile(p);
                    if (b64 == null) continue;
                    if (count > 0) sb.append(",");
                    sb.append("{\"uuid\":\"")
                      .append(escapeJson(p.getUniqueId().toString()))
                      .append("\",\"name\":\"")
                      .append(escapeJson(p.getName()))
                      .append("\",\"datFile\":\"")
                      .append(b64)
                      .append("\"}");
                    count++;
                }
                sb.append("]}");

                if (count == 0) return;

                try {
                    int status = postJson(syncUrl, sb.toString());
                    if (status >= 200 && status < 300) {
                        getLogger().info("[背包同步] 已上报 " + count + " 个玩家 .dat");
                    } else {
                        getLogger().warning("[背包同步] 上报失败，HTTP " + status);
                    }
                } catch (Exception e) {
                    getLogger().warning("[背包同步] 网络错误: " + e.getMessage());
                }
            });
        }, 100L, ticks);
    }

    private void syncPlayerDat(Player player) {
        if (syncUrl == null || syncUrl.isEmpty()) return;

        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            String b64 = readDatFile(player);
            if (b64 == null) return;

            String json = "{\"players\":[{\"uuid\":\""
                + escapeJson(player.getUniqueId().toString())
                + "\",\"name\":\""
                + escapeJson(player.getName())
                + "\",\"datFile\":\""
                + b64 + "\"}]}";

            try {
                postJson(syncUrl, json);
            } catch (Exception e) {
                getLogger().warning("[背包同步] 退出推送失败 (" + player.getName() + "): " + e.getMessage());
            }
        });
    }

    // 同步版（插件关闭时使用，确保数据被发送）
    private void syncPlayerDatSync(Player player) {
        if (syncUrl == null || syncUrl.isEmpty()) return;

        String b64 = readDatFile(player);
        if (b64 == null) return;

        String json = "{\"players\":[{\"uuid\":\""
            + escapeJson(player.getUniqueId().toString())
            + "\",\"name\":\""
            + escapeJson(player.getName())
            + "\",\"datFile\":\""
            + b64 + "\"}]}";

        try {
            int status = postJson(syncUrl, json);
            if (status >= 200 && status < 300) {
                getLogger().info("[背包同步] 关闭前已推送 " + player.getName() + " 的 .dat");
            } else {
                getLogger().warning("[背包同步] 关闭前推送失败 (" + player.getName() + "): HTTP " + status);
            }
        } catch (Exception e) {
            getLogger().warning("[背包同步] 关闭前推送失败 (" + player.getName() + "): " + e.getMessage());
        }
    }

    // 读取玩家 .dat 文件，base64 编码（始终读取主世界 playerdata）
    private String readDatFile(Player player) {
        try {
            // 无论玩家在哪个世界，.dat 都在主世界的 playerdata 目录下
            World mainWorld = Bukkit.getWorlds().get(0);
            Path datPath = mainWorld.getWorldFolder().toPath()
                .resolve("playerdata")
                .resolve(player.getUniqueId() + ".dat");

            File f = datPath.toFile();
            if (!f.exists()) return null;

            byte[] bytes = Files.readAllBytes(datPath);
            return Base64.getEncoder().encodeToString(bytes);
        } catch (Exception e) {
            getLogger().warning("读取 " + player.getName() + " 的 .dat 失败: " + e.getMessage());
            return null;
        }
    }

    private int postJson(String urlStr, String json) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        conn.setRequestProperty("X-API-Key", apiKey);
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(json.getBytes(StandardCharsets.UTF_8));
            os.flush();
        }
        return conn.getResponseCode();
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }

    // ===== 绑定命令 =====
    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if (args.length == 1 && "reload".equalsIgnoreCase(args[0])) {
            reloadConfig();
            apiUrl = getConfig().getString("api-url", "http://localhost:3000/api/game/confirm-verify");
            apiKey = getConfig().getString("api-key", "ctmc-verify-secret");
            syncUrl = getConfig().getString("sync-url", "http://localhost:3000/api/inventory/sync");
            syncInterval = Math.max(10, getConfig().getInt("sync-interval", 60));
            dailyClaimUrl = getConfig().getString("daily-claim-url", "http://localhost:3000/api/daily-reward/claim");
            sender.sendMessage("§a[WebBind] 配置已重载");
            sender.sendMessage("§7  API地址: " + apiUrl);
            sender.sendMessage("§7  同步间隔: " + syncInterval + "秒");
            getLogger().info("配置已重载 - API: " + apiUrl);
            return true;
        }

        // ===== /dailygift 每日福利领取 =====
        if (cmd.getName().equalsIgnoreCase("dailygift")) {
            if (!(sender instanceof Player)) {
                sender.sendMessage("§c该命令只能由玩家执行");
                return true;
            }
            Player player = (Player) sender;
            String uuid = player.getUniqueId().toString();

            player.sendMessage("§e正在领取每日福利...");

            Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                try {
                    String urlStr = dailyClaimUrl + "/" + uuid;
                    URL urlObj = new URL(urlStr);
                    HttpURLConnection conn = (HttpURLConnection) urlObj.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("X-API-Key", apiKey);
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);

                    int status = conn.getResponseCode();
                    BufferedReader reader;
                    if (status >= 200 && status < 300) {
                        reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                    } else {
                        reader = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
                    }

                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        response.append(line);
                    }
                    reader.close();
                    conn.disconnect();

                    final String respStr = response.toString();
                    final int finalStatus = status;
                    getLogger().info("[每日福利] HTTP " + status + " 响应: " + respStr);

                    // 回到主线程处理 UI 和指令
                    Bukkit.getScheduler().runTask(CTMCVerify.this, () -> {
                        if (respStr.contains("\"success\":true")) {
                            String command = extractJsonString(respStr, "command");
                            int streak = extractJsonInt(respStr, "streak");

                            if (command != null && !command.isEmpty()) {
                                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
                                player.sendMessage("§a✔ 每日福利领取成功！");
                                player.sendMessage("§7  已连续签到 §e" + streak + " §7天");
                            } else {
                                player.sendMessage("§a✔ 签到成功！(无奖励指令)");
                            }
                        } else if (respStr.contains("\"claimed\":true")) {
                            int streak = extractJsonInt(respStr, "streak");
                            player.sendMessage("§6✘ 今日已领取每日福利");
                            player.sendMessage("§7  已连续签到 §e" + streak + " §7天");
                        } else {
                            String errorMsg = extractJsonString(respStr, "message");
                            if (errorMsg == null || errorMsg.isEmpty()) {
                                errorMsg = extractJsonString(respStr, "error");
                            }
                            if (errorMsg != null && !errorMsg.isEmpty()) {
                                player.sendMessage("§c" + errorMsg);
                            } else {
                                player.sendMessage("§c领取失败，请稍后重试");
                            }
                        }
                    });
                } catch (Exception e) {
                    getLogger().warning("[每日福利] 请求失败: " + e.getMessage());
                    Bukkit.getScheduler().runTask(CTMCVerify.this, () -> {
                        player.sendMessage("§c无法连接到福利服务器，请联系管理员");
                    });
                }
            });
            return true;
        }

        if (!(sender instanceof Player)) {
            sender.sendMessage("§c该命令只能由玩家执行");
            return true;
        }

        Player player = (Player) sender;

        // /bind sync 或 /bind 同步 — 立即推送一次玩家 .dat 到 Web 端
        if (args.length == 1 && ("sync".equalsIgnoreCase(args[0]) || "同步".equals(args[0]))) {
            player.sendMessage("§e正在同步玩家数据到网站...");
            syncPlayerDat(player);
            // 延迟 200ms 后给个反馈（HTTP 是异步的，给玩家即时提示）
            Bukkit.getScheduler().runTaskLater(this, () -> {
                player.sendMessage("§a✔ 同步请求已发送，请稍后刷新个人中心");
            }, 10L);
            return true;
        }

        if (args.length != 1) {
            player.sendMessage("§c用法: /" + label + " <验证码> | sync | reload");
            return true;
        }

        String code = args[0];
        if (!code.matches("\\d{6}")) {
            player.sendMessage("§c验证码格式错误，应为6位数字");
            return true;
        }

        player.sendMessage("§e正在验证...");

        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                String urlStr = apiUrl
                    + "?code=" + URLEncoder.encode(code, "UTF-8")
                    + "&playerName=" + URLEncoder.encode(player.getName(), "UTF-8")
                    + "&uuid=" + URLEncoder.encode(player.getUniqueId().toString(), "UTF-8");

                URL urlObj = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) urlObj.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("X-API-Key", apiKey);
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int status = conn.getResponseCode();
                BufferedReader reader;
                if (status >= 200 && status < 300) {
                    reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                } else {
                    reader = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
                }

                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();
                conn.disconnect();

                final String respStr = response.toString();
                getLogger().info("[绑定] HTTP " + status + " 响应: " + respStr);

                // 回到主线程处理 UI
                Bukkit.getScheduler().runTask(CTMCVerify.this, () -> {
                    if (respStr.contains("\"success\":true")) {
                        player.sendMessage("§a绑定成功！" + extractMessage(respStr));
                        // 绑定成功后立即同步一次玩家 .dat，让 Web 端立刻可看
                        player.sendMessage("§7  正在同步玩家数据...");
                        syncPlayerDat(player);
                    } else if (respStr.contains("\"error\"")) {
                        player.sendMessage("§c" + extractMessage(respStr));
                    } else {
                        player.sendMessage("§c验证失败，请重试");
                    }
                });
            } catch (Exception e) {
                getLogger().warning("验证请求失败: " + e.getMessage());
                Bukkit.getScheduler().runTask(CTMCVerify.this, () -> {
                    player.sendMessage("§c无法连接到验证服务器，请联系管理员");
                });
            }
        });
        return true;
    }

    private String extractMessage(String json) {
        if (json.contains("\"message\":\"")) {
            int s = json.indexOf("\"message\":\"") + 11;
            int e = json.indexOf("\"", s);
            if (e > s) return json.substring(s, e);
        }
        if (json.contains("\"error\":\"")) {
            int s = json.indexOf("\"error\":\"") + 9;
            int e = json.indexOf("\"", s);
            if (e > s) return json.substring(s, e);
        }
        return "未知响应";
    }

    private String extractJsonString(String json, String key) {
        String search = "\"" + key + "\":\"";
        if (json.contains(search)) {
            int s = json.indexOf(search) + search.length();
            // 处理转义字符
            StringBuilder result = new StringBuilder();
            for (int i = s; i < json.length(); i++) {
                char c = json.charAt(i);
                if (c == '"') break;
                if (c == '\\' && i + 1 < json.length()) {
                    char next = json.charAt(i + 1);
                    if (next == '"') { result.append('"'); i++; continue; }
                    if (next == '\\') { result.append('\\'); i++; continue; }
                    if (next == 'n') { result.append('\n'); i++; continue; }
                    if (next == '/') { result.append('/'); i++; continue; }
                }
                result.append(c);
            }
            return result.toString();
        }
        return null;
    }

    private int extractJsonInt(String json, String key) {
        String search = "\"" + key + "\":";
        if (json.contains(search)) {
            int s = json.indexOf(search) + search.length();
            int e = json.indexOf(",", s);
            if (e < 0) e = json.indexOf("}", s);
            if (e > s) {
                try {
                    return Integer.parseInt(json.substring(s, e).trim());
                } catch (NumberFormatException ignored) {}
            }
        }
        return 0;
    }
}

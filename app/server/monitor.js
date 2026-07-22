// Hermes Agent 监控服务 — 基于 Bun 的 HTTP 服务（Unix Socket / TCP）
import { spawn, spawnSync } from "bun";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, symlinkSync, watch, chmodSync, readdirSync } from "fs";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { PROVIDER_PRESETS, PROVIDER_MODELS, PROVIDER_API_KEYS, PROVIDER_CLASSES, PROVIDER_HERMES_IDS } from "./provider-config.js";

// 自定义 provider 环境变量名：剥离 id 中 "custom-" 前缀后规范化大写
function customEnvKey(id) {
  const bare = String(id).replace(/^custom-/i, '');
  return `CUSTOM_${bare.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_API_KEY`;
}
// 兼容旧格式（CUSTOM_PROVIDER_*_API_KEY）用于读取迁移
function legacyCustomEnvKey(id) {
  const bare = String(id).replace(/^custom-/i, '');
  return `CUSTOM_PROVIDER_${bare.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_API_KEY`;
}

const APP_DIR        = process.env.APP_DIR       || "/var/apps/hermes-agent";
const DATA_DIR       = process.env.DATA_DIR      || `${APP_DIR}/home/data`;
const VAR_DIR        = process.env.VAR_DIR       || `${APP_DIR}/var`;
const LOG_FILE       = `${VAR_DIR}/hermes.log`;
const PID_GATEWAY    = `${VAR_DIR}/gateway.pid`;
const PID_DASHBOARD  = `${VAR_DIR}/dashboard.pid`;
const TOKEN_FILE     = `${VAR_DIR}/monitor.token`;
const VERSION_FILE   = `${VAR_DIR}/hermes_version.txt`;
const START_TIME     = Date.now();
const CONFIG_VERSION = "1.0";

// ── Hermes 自更新状态 ──
let updateState = "idle";       // idle | checking | updating | done | error
let updateOutput = [];           // 最近的 stdout/stderr 输出行
let updateExitCode = null;
let updateProc = null;
// 获取本机 LAN IP（排除 loopback）
function getLANIP() {
  const ifs = networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name]) {
      if (iface.internal || iface.family !== "IPv4") continue;
      return iface.address;
    }
  }
  return "127.0.0.1";
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  parts.push(`${m}分钟`);
  return parts.join(" ");
}

const GATEWAY_PORT   = 8642;
const SOCKET_PATH    = (process.env.MONITOR_SOCKET_PATH || "").trim();
if (!SOCKET_PATH) {
  console.error("[FATAL] MONITOR_SOCKET_PATH is required — unix socket mode only");
  process.exit(1);
}
const BASE_PATH      = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || "9119");
const STATIC_DIR     = `${APP_DIR}/ui`;
const VENV_BIN       = `${DATA_DIR}/venv/bin`;
const HERMES_BIN     = `${VENV_BIN}/hermes`;
const UV_BIN_PATH    = `${VENV_BIN}/uv`;

// ─── Node.js 运行时探测（hermes TUI 需要 node；版本在安装期由 install_callback 固定） ───

const NODE_CANDIDATES = [
  `${APP_DIR}/runtime/node/bin/node`,            // ① 打包内置（最高优先）
  `${DATA_DIR}/node/bin/node`,                   // ② 安装期 ensure_node 下载并固定的路径
];
const resolvedNodeBin = NODE_CANDIDATES.find(p => {
  try { return existsSync(p) && (statSync(p).mode & 0o111) !== 0; } catch { return false; }
}) || null;
const resolvedNodeDir = resolvedNodeBin ? resolvedNodeBin.replace(/\/[^/]+$/, "") : null;

// ─── HERMES_TUI_DIR：TUI 运行时 shim 目录 ──────────────────────────────
const TUI_DIR = `${DATA_DIR}/tui`;

// ─── 聊天数据路径（持久化于 VAR_DIR → /vol1/@appdata/） ────────────────
const CHAT_DIR      = `${VAR_DIR}/chat`;
const CONFIG_FILE   = `${CHAT_DIR}/config.json`;
const SESSIONS_DIR  = `${CHAT_DIR}/sessions`;
const TMP_DIR       = `${VAR_DIR}/tmp`;
const UPLOAD_DIR      = `${DATA_DIR}/uploads`;
const UPLOAD_IMG_DIR  = `${UPLOAD_DIR}/images`;
const UPLOAD_FILE_DIR = `${UPLOAD_DIR}/files`;
const WORKSPACE_DIR   = `${DATA_DIR}/workspace`;
const GATEWAY_API   = `http://localhost:${GATEWAY_PORT}/v1`;
const DASHBOARD_BIND = "127.0.0.1";

// ─── API Key 自动生成（12位随机字母数字）─────────────────────────────────────
function generateApiKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(12);
  let key = "";
  for (let i = 0; i < 12; i++) key += chars[bytes[i] % chars.length];
  return key;
}

mkdirSync(VAR_DIR, { recursive: true });
initChatData();

// ─── TUI shim 初始化：确保 TUI_DIR/dist/entry.js 可用 ──────────────────
try {
  mkdirSync(`${TUI_DIR}/dist`, { recursive: true });
  const tuiEntry = `${TUI_DIR}/dist/entry.js`;
  if (!existsSync(tuiEntry)) {
    // 动态探测 hermes_cli 的 tui_dist/entry.js（不硬编码 python 版本）
    const pyResult = spawnSync(
      [`${VENV_BIN}/python3`, "-c", "import hermes_cli,os;print(os.path.dirname(hermes_cli.__file__))"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const hermesCli = pyResult.stdout?.toString().trim();
    if (hermesCli && existsSync(`${hermesCli}/tui_dist/entry.js`)) {
      try { unlinkSync(tuiEntry); } catch {}
      symlinkSync(`${hermesCli}/tui_dist/entry.js`, tuiEntry);
      console.log(`[monitor] tui symlink: ${tuiEntry} -> ${hermesCli}/tui_dist/entry.js`);
    } else {
      console.log("[monitor] WARNING: hermes_cli/tui_dist/entry.js not found, TUI may rely on bundled fallback");
    }
  }
} catch (e) {
  console.log(`[monitor] WARNING: TUI shim init failed (${e.message}), non-fatal`);
}

// ─── 启动清理：杀掉残留进程、清除旧 PID、重置日志 ─────────
function readPidSync(path) {
  try { return Number(readFileSync(path, "utf8").trim()); } catch { return null; }
}
function pidAliveSync(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
try {
  const { spawnSync } = require("bun");
  spawnSync(["pkill", "-SIGKILL", "-f", "hermes.*(gateway|dashboard)"]);
} catch {}
for (const pidFile of [PID_GATEWAY, PID_DASHBOARD]) {
  const oldPid = readPidSync(pidFile);
  if (oldPid && pidAliveSync(oldPid)) {
    try { process.kill(oldPid, "TERM"); } catch {}
  }
  try { unlinkSync(pidFile); } catch {}
}
try { writeFileSync(LOG_FILE, ""); } catch {}


function formatHermesVersion(raw) {
  if (!raw) return "unknown";
  const verMatch = raw.match(/(\d+\.\d+\.\d+)/);
  const dateMatch = raw.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (!verMatch) return raw.trim().split("\n")[0].slice(0, 64) || "unknown";
  let out = `v${verMatch[1]}`;
  if (dateMatch) {
    const y = dateMatch[1], m = Number(dateMatch[2]), d = Number(dateMatch[3]);
    out += ` (${y}.${m}.${d})`;
  }
  return out;
}
let HERMES_VERSION = "unknown";
try {
  // 优先读缓存文件（瞬间完成），让服务器尽快启动
  if (existsSync(VERSION_FILE)) {
    const cached = readFileSync(VERSION_FILE, "utf8").trim();
    if (cached) HERMES_VERSION = cached;
  }
  // 缓存没有时才执行 hermes --version（可能耗时数秒）
  if (HERMES_VERSION === "unknown") {
    const { spawnSync } = require("bun");
    const verResult = spawnSync([HERMES_BIN, "--version"], { stdout: "pipe", stderr: "pipe" });
    const verOut = ((verResult.stdout ? verResult.stdout.toString() : "").trim())
                || ((verResult.stderr ? verResult.stderr.toString() : "").trim());
    if (verOut) {
      HERMES_VERSION = formatHermesVersion(verOut);
      try { writeFileSync(VERSION_FILE, HERMES_VERSION, { mode: 0o644 }); } catch {}
    }
  }
  // 后台异步刷新版本（解决升级后缓存文件仍是旧版本号的问题）
  setTimeout(() => {
    try {
      const { spawnSync } = require("bun");
      const r = spawnSync([HERMES_BIN, "--version"], { stdout: "pipe", stderr: "pipe" });
      const out = ((r.stdout ? r.stdout.toString() : "").trim())
               || ((r.stderr ? r.stderr.toString() : "").trim());
      if (out) {
        const realVer = formatHermesVersion(out);
        if (realVer !== HERMES_VERSION) {
          HERMES_VERSION = realVer;
          try { writeFileSync(VERSION_FILE, realVer, { mode: 0o644 }); } catch {}
          log(`版本已刷新: ${realVer}`);
        }
      }
    } catch {}
  }, 3000);
} catch {
  try {
    if (existsSync(VERSION_FILE)) {
      const cached = readFileSync(VERSION_FILE, "utf8").trim();
      if (cached) HERMES_VERSION = cached;
    }
  } catch {}
}
log(`[启动检测] Hermes Agent 版本: ${HERMES_VERSION}`);

// ─── 启动令牌（写入 VAR_DIR 供本机 CLI/脚本读取）────────────────────────────
const MONITOR_TOKEN = (() => {
  try {
    if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {}
  const t = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
})();

function checkToken(req) {
  const h = req.headers.get("x-monitor-token") || "";
  return h === MONITOR_TOKEN;
}


const HERMES_TOKEN_MIRROR = `${DATA_DIR}/.monitor_token`;
function syncTokenToHermesHome() {
  try { writeFileSync(HERMES_TOKEN_MIRROR, MONITOR_TOKEN, { mode: 0o600 }); }
  catch (e) { log(`同步 token 到 Hermes home 失败: ${e?.message || e}`); }
}
syncTokenToHermesHome();

// ── defaultConfig：初始配置模板（fallback_providers 默认空数组）───────────────
function defaultConfig() {
  return {
    providers: [{
      id: "hermes",
      name: "Hermes Gateway",
      type: "openai-compatible",
      base_url: GATEWAY_API,
      api_key: generateApiKey(),
      model: "auto",
      temperature: 0.7,
      max_tokens: 4096,
    }],
    active_provider: "Hermes Gateway",
    fallback_providers: [],   // 备选 provider name 列表（按顺序尝试）
    _version: CONFIG_VERSION,
  };
}

function initChatData() {
  mkdirSync(CHAT_DIR, { recursive: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(UPLOAD_IMG_DIR, { recursive: true });
  mkdirSync(UPLOAD_FILE_DIR, { recursive: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  let needsReset = !existsSync(CONFIG_FILE);
  if (!needsReset) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      needsReset = !cfg._version || cfg._version !== CONFIG_VERSION || !Array.isArray(cfg.providers);
    } catch {
      needsReset = true;
    }
  }
  if (needsReset) {
    writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig(), null, 2));
    try { chmodSync(CONFIG_FILE, 0o600); } catch {}
    log("Config reset to defaults (version mismatch or corrupted)");
  }
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}
function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
  try { chmodSync(path, 0o600); } catch {}
}

// ── active_provider 同步：优先读 config.yaml（稳定 provider id），兜底 chat/config.json ──
function syncActiveProviderFromConfigYaml(cfg) {
  try {
    const cfgPath = `${DATA_DIR}/config.yaml`;
    if (!existsSync(cfgPath)) return;
    const yml = readFileSync(cfgPath, "utf8");
    const provMatch = yml.match(/^model:\s*\n\s+provider:\s*(\S+)/m);
    if (!provMatch) return;
    const cfgProvider = provMatch[1];
    const modelMatch = yml.match(/^model:\s*\n\s+default:\s*(\S+)/m);
    const cfgModel = modelMatch ? modelMatch[1] : null;
    const matched = cfg.providers.find(p =>
      String(p.id) === cfgProvider || String(p.name) === cfgProvider
    );
    if (!matched) return;

    if (cfg.active_provider !== matched.name) {
      cfg.active_provider = matched.name;
      log(`active_provider synced from config.yaml → "${matched.name}"`);
    }
    if (cfgModel && (!matched.model || matched.model === 'auto')) {
      matched.model = cfgModel;
      log(`model synced from config.yaml → "${cfgModel}"`);
    }
  } catch (e) {
  }
}

function getChatConfig() {
  try {
    const cfg = readJSON(CONFIG_FILE);
    if (!cfg._version || cfg._version !== CONFIG_VERSION ||
        !Array.isArray(cfg.providers) || cfg.providers.length === 0) {
      const def = defaultConfig();
      writeJSON(CONFIG_FILE, def);
      return def;
    }
    syncActiveProviderFromConfigYaml(cfg);
    if (!cfg.fallback_providers) {
      cfg.fallback_providers = [];
    }
    let needsSave = false;
    const hermesIdx = cfg.providers.findIndex(p => p.id === "hermes");
    if (hermesIdx >= 0) {
      if (cfg.providers[hermesIdx].base_url !== "LOCAL") {
        cfg.providers[hermesIdx].base_url = "LOCAL";
        needsSave = true;
      }
    }
    const oldProviders = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")).providers || [];
    cfg.providers.forEach(p => {
      if (p.base_url === "LOCAL" || p.id === "hermes") {
        p.api_key = MONITOR_TOKEN;
        return;
      }
      const needsKeyRecovery = (p.api_key && p.api_key.startsWith("****") && !p.api_key.startsWith("****keep"))
        || (p.api_key_configured && (!p.api_key || p.api_key.startsWith("****")));
      if (needsKeyRecovery) {
        const envKey = PROVIDER_API_KEYS[p.id] || PROVIDER_API_KEYS[p.name];
        if (envKey) {
          try {
            let envVal = process.env[envKey];
            if (!envVal) {
              const envProvPath = `${VAR_DIR}/.env.providers`;
              if (existsSync(envProvPath)) {
                const provEnv = readFileSync(envProvPath, "utf8");
                const m = provEnv.match(new RegExp(`^${envKey}=(.*)$`, "m"));
                if (m && m[1]) envVal = m[1].trim();
              }
            }
            if (envVal) { p.api_key = envVal; return; }
          } catch {}
        }
        const old = oldProviders.find(op => op.id === p.id || op.name === p.name);
        if (old && old.api_key && !old.api_key.startsWith("****")) {
          p.api_key = old.api_key;
        }
      }
    });
    if (needsSave) writeJSON(CONFIG_FILE, cfg);
    return cfg;
  } catch {
    const def = defaultConfig();
    writeJSON(CONFIG_FILE, def);
    return def;
  }
}
function saveChatConfig(cfg) {
  writeJSON(CONFIG_FILE, cfg);
}
function getActiveProvider() {
  const cfg = getChatConfig();
  return cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
}

function sessionFile(id) {
  return `${SESSIONS_DIR}/${id}.json`;
}
function listSessions() {
  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
    return files.map(f => {
      try {
        const s = readJSON(`${SESSIONS_DIR}/${f}`);
        return { id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at, message_count: (s.messages || []).length };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.updated_at - a.updated_at);
  } catch { return []; }
}
function getSession(id) {
  const f = sessionFile(id);
  if (!existsSync(f)) return null;
  try { return readJSON(f); } catch { return null; }
}
function saveSession(s) {
  s.updated_at = Date.now();
  writeJSON(sessionFile(s.id), s);
}
function deleteSession(id) {
  const f = sessionFile(id);
  if (existsSync(f)) unlinkSync(f);
}

function createSSEParser(onDelta, onDone, onError, onToolEvent) {
  let buffer = "";
  let currentEvent = "";
  let toolData = {};
  let toolDispatched = false;

  // 将 hermes.tool.progress 的字段名映射为中文显示名
  const TOOL_NAME_ZH = {
    execute_code: "执行代码",
    read_file: "读取文件",
    search_files: "搜索文件",
    terminal: "终端命令",
    web: "网页搜索",
    delegate_task: "委派任务",
    session_search: "会话搜索",
  };

  function tryToolEvent() {
    if (currentEvent === "hermes.tool.progress" && toolData.toolCallId && !toolDispatched) {
      toolDispatched = true;
      if (onToolEvent) {
        onToolEvent({
          tool: toolData.tool,
          toolCallId: toolData.toolCallId,
          status: toolData.status,
          emoji: toolData.emoji || "",
          label: toolData.label || "",
          toolZh: TOOL_NAME_ZH[toolData.tool] || toolData.tool,
        });
      }
    }
  }

  return {
    feed(chunk) {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        let eventData = "";
        currentEvent = "";
        toolData = {};
        toolDispatched = false;

        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          }
          // 工具事件：逐行累积字段，空行时统一派发
          if (currentEvent === "hermes.tool.progress" && eventData) {
            try {
              const tj = JSON.parse(eventData);
              if (tj.tool) toolData.tool = tj.tool;
              if (tj.toolCallId) toolData.toolCallId = tj.toolCallId;
              if (tj.status) toolData.status = tj.status;
              if (tj.emoji) toolData.emoji = tj.emoji;
              if (tj.label) toolData.label = tj.label;
            } catch {}
            eventData = ""; // 不再走普通 delta 路径
          }
        }
        tryToolEvent();

        if (!eventData) continue;
        if (eventData === "[DONE]") { onDone(); return; }
        try {
          const json = JSON.parse(eventData);
          if (json.error) { onError(typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error))); return; }
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) onDelta(delta);
        } catch {
          // 忽略非 JSON 行
        }
      }
    },
    flush() {
      // 处理剩余 buffer 中可能未结束的工具事件
      if (buffer.trim()) {
        currentEvent = "";
        toolData = {};
        toolDispatched = false;
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (currentEvent === "hermes.tool.progress" && data) {
              try {
                const tj = JSON.parse(data);
                if (tj.tool) toolData.tool = tj.tool;
                if (tj.toolCallId) toolData.toolCallId = tj.toolCallId;
                if (tj.status) toolData.status = tj.status;
                if (tj.emoji) toolData.emoji = tj.emoji;
                if (tj.label) toolData.label = tj.label;
              } catch {}
              continue;
            }
            if (data === "[DONE]") { tryToolEvent(); onDone(); return; }
            try {
              const json = JSON.parse(data);
              if (json.error) { onError(typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error))); return; }
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) onDelta(delta);
            } catch {}
          }
        }
        tryToolEvent();
      }
      onDone();
    },
  };
}

// ─── 聊天：Gateway 代理 ─────────────────────────────────────────────────────
async function fetchGatewayModels(provider) {
  const t0 = Date.now();
  try {
    const headers = {};
    // LOCAL provider 必须用真实 MONITOR_TOKEN
    const isLocal = (provider.base_url === "LOCAL" || provider.id === "hermes");
    if (!isLocal && !provider.base_url) {
      return { models: [], latency: 0, error: 'base_url 未填写' };
    }
    if (isLocal) {
      headers["Authorization"] = `Bearer ${MONITOR_TOKEN}`;
    } else if (provider.api_key && provider.api_key !== "none") {
      headers["Authorization"] = `Bearer ${provider.api_key}`;
    }
    const baseUrl = isLocal ? GATEWAY_API : provider.base_url.replace(/\/$/, "");
    const r = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - t0;
    if (!r.ok) return { models: [], latency, error: `HTTP ${r.status}` };
    const data = await r.json();
    let models = (data.data || data.models || []).map(m => ({ id: m.id, name: m.id }));
    if (isLocal) {
      try {
        const cfgPath = `${DATA_DIR}/config.yaml`;
        if (existsSync(cfgPath)) {
          const yml = readFileSync(cfgPath, "utf8");
          const m = yml.match(/^model:\s*\n\s+default:\s*(\S+)/m);
          if (m && m[1]) {
            models = [{ id: m[1], name: m[1], current: true }];
          }
        }
      } catch {}
      if (models.length === 0) {
        models = [{ id: "hermes-agent", name: "hermes-agent", fake: true }];
      }
    }
    return { models, latency };
  } catch (e) {
    return { models: [], latency: Date.now() - t0, error: e.message };
  }
}

function resolveProviderBase(provider) {
  return GATEWAY_API.replace(/\/$/, "");
}

async function autoTitle(userMsg, provider) {
  // userMsg 可能是字符串，也可能是多模态 content 数组（图片消息），这里只取文字部分用于生成标题
  let plainMsg = userMsg;
  if (Array.isArray(userMsg)) {
    const textPart = userMsg.find(p => p && p.type === "text");
    plainMsg = (textPart && textPart.text) || "[图片消息]";
  } else if (typeof userMsg !== "string") {
    plainMsg = String(userMsg ?? "");
  }
  const text = plainMsg.slice(0, 200);
  provider = provider || getActiveProvider();
  try {
    const providerBase = resolveProviderBase(provider);
    const apiKey = resolveRealApiKey(provider);
    const headers = { "Content-Type": "application/json" };
    if (apiKey && apiKey !== "none") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const r = await fetch(`${providerBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model || "auto",
        messages: [
          { role: "system", content: "Generate a concise title (max 8 words, no quotes, no period) for this user message. Reply with ONLY the title text." },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: 30,
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return text.slice(0, 30);
    const data = await r.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    return (title || text.slice(0, 30)).slice(0, 60);
  } catch {
    return text.slice(0, 30);
  }
}

function resolveRealApiKey(provider) {
  if (provider.base_url === "LOCAL" || provider.id === "hermes") {
    return MONITOR_TOKEN;
  }
  if (provider.api_key && !provider.api_key.startsWith("****")) {
    return provider.api_key;
  }
  const envKey = PROVIDER_API_KEYS[provider.id] || PROVIDER_API_KEYS[provider.name] || customEnvKey(provider.id);
  try {
    const fromEnv = process.env[envKey];
    if (fromEnv) return fromEnv;
    const envProvPath = `${VAR_DIR}/.env.providers`;
    if (existsSync(envProvPath)) {
      const provEnv = readFileSync(envProvPath, "utf8");
      const m = provEnv.match(new RegExp(`^${envKey}=(.*)$`, "m"));
      if (m && m[1]) return m[1].trim();
      // 兼容旧名 CUSTOM_PROVIDER_*
      if (!PROVIDER_API_KEYS[provider.id] && !PROVIDER_API_KEYS[provider.name]) {
        const legKey = legacyCustomEnvKey(provider.id);
        const m2 = provEnv.match(new RegExp(`^${legKey}=(.*)$`, "m"));
        if (m2 && m2[1]) return m2[1].trim();
      }
    }
    // 兜底：DATA_DIR/.env
    const hermesEnvPath = `${DATA_DIR}/.env`;
    if (existsSync(hermesEnvPath)) {
      const hEnv = readFileSync(hermesEnvPath, "utf8");
      const mh = hEnv.match(new RegExp(`^${envKey}=(.*)$`, "m"));
      if (mh && mh[1]) return mh[1].trim();
      if (!PROVIDER_API_KEYS[provider.id] && !PROVIDER_API_KEYS[provider.name]) {
        const legKey = legacyCustomEnvKey(provider.id);
        const m2 = hEnv.match(new RegExp(`^${legKey}=(.*)$`, "m"));
        if (m2 && m2[1]) return m2[1].trim();
      }
    }
    return null;
  } catch { return null; }
}

async function chatRequest(provider, message, history, reqSignal) {
  const providerBase = resolveProviderBase(provider);
  const isGateway = providerBase === GATEWAY_API.replace(/\/$/, "");
  const apiKey = isGateway ? MONITOR_TOKEN : resolveRealApiKey(provider);
  if (apiKey && apiKey !== "none" && !isGateway) {
    const officialEntry = Object.entries(PROVIDER_PRESETS).find(
      ([, v]) => v.base_url === provider.base_url
    );
    const isKnownPreset = !!officialEntry;
    const isLocal = !provider.base_url || provider.base_url === "LOCAL" || provider.base_url === GATEWAY_API;
    if (!isLocal && !isKnownPreset) {
      throw new Error(`Provider "${provider.name}" 的 base_url 未在预设列表中，拒绝发送 API key`);
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey && apiKey !== "none") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const upstream = await fetch(`${providerBase}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model || "auto",
      messages: history,
      temperature: provider.temperature ?? 0.7,
      max_tokens: provider.max_tokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: reqSignal,
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    throw new Error(`Gateway ${upstream.status}: ${errText.slice(0, 200)}`);
  }
  return upstream;
}

// ── 辅助：流式消费 upstream，yield delta ──────────────────────────────────────
async function* streamDeltas(upstream, decoder, reqSignal) {
  const reader = upstream.body.getReader();
  const parser = createSSEParser(
    (delta) => { /* 内联处理 */ },
    () => {},
    () => {},
  );
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") { return; }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || "";
            if (delta) yield delta;
          } catch {}
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  } finally {
    parser.flush();
    reader.releaseLock();
  }
}


const PROVIDER_TIMEOUT_MS = 120000;
const activeChatStreams = new Map();
const wsMessageQueue = new Map(); // session_id → message，WS 连接前暂存

function combineSignals(signals) {
  const valid = signals.filter(Boolean);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(valid);
  const ctrl = new AbortController();
  for (const s of valid) {
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// 前端渲染能力声明：作为system message注入每次对话最前面
const UI_CAPABILITIES_PROMPT = `你正在通过网页聊天窗口对话，前端按以下规则渲染你的输出：

1. 完整 GFM Markdown（标题/粗斜体/列表/引用/表格/代码块等）会被渲染，正常输出 Markdown，不要输出 HTML 标签。
2. 标准链接语法 [文字](https://...) 或裸 http(s) 链接会自动变可点击超链接。
3. 二维码：用 [qr](https://...)（链接文字必须是小写 "qr"）会渲染成可扫码的二维码按钮。需要扫码场景（微信链接、内网地址、非标准端口、OAuth回调等）主动使用此格式。不要用字符/emoji画二维码图案，无效。
4. 图片用 ![描述](URL) 内嵌显示。生成图片保存后用 ![描述](/tmp/文件名.png) 或 ![描述](/workspace/文件名.png) 引用。这些不是文件路径，是服务器的 HTTP 路由，前端会自动转成完整 HTTP 请求加载图片。/tmp/ 对应临时目录，/workspace/ 对应持久化工作目录，/data/ 覆盖所有 data/ 子目录。这个机制已内置，不要拒绝使用，不要告诉用户"本地图片不能显示"。也可用公网 HTTP URL。不要贴 base64 data URI。
5. 要展示 Markdown 源码本身（让用户看到 # ** \`\`\` 等符号）时，必须整体包在一个 \`\`\`markdown 代码块里。
6. 不要手写 <a>/<img>/<table> 等 HTML 标签，会被转义成文字，统一用 Markdown 语法。
7. 代码块只用一层三反引号包裹，内部如需展示代码块用四空格缩进代替，避免反引号提前闭合导致内容泄漏。
8. 需要重启自己时，执行封装脚本：\`$TRIM_APPDEST/bin/monitor-api restart\`，认证 token 从文件 ${HERMES_TOKEN_MIRROR} 读取。不要用 shell kill 命令或子进程方式，会导致服务状态异常。
9. 网页聊天环境下所有工具调用已预授权（等效于 /yolo 模式）。执行 terminal、execute_code、read_file、search_files 等工具时直接调用，不要询问用户是否批准，不要说"需要授权"或"需要批准"，直接执行即可。
10. 写文件后必须用 stat（不是 ls）验证文件真实落盘。ls 可能被 sandbox overlay 欺骗显示不存在的文件。stat 报 No such file = 写入失败，不能报告成功。`;


function createChatStream(sessionId, message, reqSignal) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (data, ev = "message") => {
        try { controller.enqueue(enc.encode(`event: ${ev}\ndata: ${data}\n\n`)); }
        catch {}
      };
      const sendJSON = (obj) => send(JSON.stringify(obj));
      const decoder = new TextDecoder();

      const stopCtrl = new AbortController();
      activeChatStreams.set(sessionId, stopCtrl);

      const keepaliveTimer = setInterval(() => {
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)); } catch {}
      }, 8000);

      const cleanup = () => {
        clearInterval(keepaliveTimer);
        if (activeChatStreams.get(sessionId) === stopCtrl) activeChatStreams.delete(sessionId);
      };

      try {
        const session = getSession(sessionId);
        if (!session) {
          sendJSON({ error: "session not found" }); send("[DONE]", "end"); cleanup(); controller.close(); return;
        }

        // 去重：WS 路径（runChatWS）可能在 XHR 回退前已推送过该用户消息
        const _lastMsg = session.messages[session.messages.length - 1];
        const _isSameUserMsg = _lastMsg && _lastMsg.role === "user" &&
          JSON.stringify(_lastMsg.content) === JSON.stringify(message);
        if (!_isSameUserMsg) {
          session.messages.push({ role: "user", content: message, ts: Date.now() });
        }

        const MAX_HISTORY = 50;
        const rawHistory = session.messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
        const history = [{ role: "system", content: UI_CAPABILITIES_PROMPT }, ...rawHistory];

        const cfg = getChatConfig();
        const primary = cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
        const allProviders = [primary];
        if (cfg.fallback_providers && cfg.fallback_providers.length > 0) {
          for (const fbName of cfg.fallback_providers) {
            const fb = cfg.providers.find(p => p.name === fbName);
            if (fb && fb.name !== primary.name) allProviders.push(fb);
          }
        }

        let fullReply = "";
        let requestError = null;

        for (let i = 0; i < allProviders.length; i++) {
          const provider = allProviders[i];
          const isFallback = i > 0;
          if (isFallback) {
            sendJSON({ info: `主模型超时，切换备选: ${provider.name}...` });
          }

          try {
 
            const timeoutController = new AbortController();
            const timeoutTimer = setTimeout(() => timeoutController.abort(), PROVIDER_TIMEOUT_MS);
            const signal = combineSignals([timeoutController.signal, stopCtrl.signal]);

            const upstream = await chatRequest(provider, message, history, signal);
            clearTimeout(timeoutTimer);

            let hadToolCalls = false;
            const localParser = createSSEParser(
              (delta) => { fullReply += delta; sendJSON({ delta }); },
              () => {},
              (err) => { requestError = err; sendJSON({ error: err }); },
              (toolEvent) => { hadToolCalls = true; sendJSON({ tool_progress: toolEvent }); },
            );

            const reader = upstream.body.getReader();
            const localDecoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                localParser.feed(localDecoder.decode(value, { stream: true }));
              }
            } catch (e) {
              if (e.name !== "AbortError") throw e;
            } finally {
              localParser.flush();
              reader.releaseLock();
            }

            requestError = null;
            break;

          } catch (e) {
            const errMsg = e.message || String(e);
            log(`Chat provider "${provider.name}" failed: ${errMsg}`);
            requestError = errMsg;
            if (isFallback) sendJSON({ info: `备选 "${provider.name}" 失败: ${errMsg}` });
          }
        }
        if (requestError !== null) {
          sendJSON({ error: `所有模型均失败: ${requestError}` });
          send("[DONE]", "end");
          cleanup();
          controller.close();
          return;
        }

        // 替换最近的 WS 助手消息（来自 WS→XHR 回退），使会话反映用户实际看到的内容
        //（即 XHR 响应），而非不完整的 WS 响应。
        const _assistantContent = fullReply || (hadToolCalls ? "（已执行工具，未生成文字回复）" : "（Gateway 连接失败）");
        const _lastForReplace = session.messages[session.messages.length - 1];
        if (_lastForReplace && _lastForReplace.role === "assistant" && (Date.now() - _lastForReplace.ts) < 60000) {
          _lastForReplace.content = _assistantContent;
          _lastForReplace.ts = Date.now();
        } else {
          session.messages.push({ role: "assistant", content: _assistantContent, ts: Date.now() });
        }
        saveSession(session);

        if (session.title === "New Chat" && session.messages.length >= 2) {
          autoTitle(message, primary).then(title => {
            const s2 = getSession(sessionId);
            if (s2 && s2.title === "New Chat") {
              s2.title = title;
              saveSession(s2);
            }
          }).catch(() => {});
        }

        send("[DONE]", "end");
      } catch (e) {
        sendJSON({ error: e.message });
        send("[DONE]", "end");
      }
      cleanup();
      try { controller.close(); } catch {}
    },
  });
}

// ─── WebSocket 聊天流式传输 ─────────────────────────────────────────────────
// 前端流程：POST /api/chat/ws-send 入队消息 → 建 ws://.../api/chat/ws 连接取流
const wsClients = new Map(); // session_id → ws

async function runChatWS(ws, sessionId, message) {
  const sendJSON = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

  const stopCtrl = new AbortController();
  ws.data.stopCtrl = stopCtrl;
  activeChatStreams.set(sessionId, stopCtrl);
  wsClients.set(sessionId, ws);
  sendJSON({ info: '正在思考…' });

  const pingTimer = setInterval(() => { try { ws.ping(); } catch {} }, 30000);
  const keepaliveTimer = setInterval(() => { try { sendJSON({ keepalive: true }); } catch {} }, 15000);

  const cleanup = () => {
    clearInterval(pingTimer);
    clearInterval(keepaliveTimer);
    if (activeChatStreams.get(sessionId) === stopCtrl) activeChatStreams.delete(sessionId);
    wsClients.delete(sessionId);
  };

  let session = null;
  try {
    session = getSession(sessionId);
    if (!session) { sendJSON({ error: "session not found" }); sendJSON({ done: true }); cleanup(); return; }

    // 去重：防止边界情况（如并发调用）下出现重复用户消息
    const _wsLastMsg = session.messages[session.messages.length - 1];
    const _wsIsSameMsg = _wsLastMsg && _wsLastMsg.role === "user" &&
      JSON.stringify(_wsLastMsg.content) === JSON.stringify(message);
    if (!_wsIsSameMsg) {
      session.messages.push({ role: "user", content: message, ts: Date.now() });
    }

    const MAX_HISTORY = 50;
    const rawHistory = session.messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));
    const history = [{ role: "system", content: UI_CAPABILITIES_PROMPT }, ...rawHistory];

    const cfg = getChatConfig();
    const primary = cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
    const allProviders = [primary];
    if (cfg.fallback_providers && cfg.fallback_providers.length > 0) {
      for (const fbName of cfg.fallback_providers) {
        const fb = cfg.providers.find(p => p.name === fbName);
        if (fb && fb.name !== primary.name) allProviders.push(fb);
      }
    }

    let fullReply = "";
    let requestError = null;
    let hadToolCalls = false;

    for (let i = 0; i < allProviders.length; i++) {
      const provider = allProviders[i];
      const isFallback = i > 0;
      if (isFallback) sendJSON({ info: `主模型超时，切换备选: ${provider.name}...` });

      try {
        hadToolCalls = false;
        const timeoutController = new AbortController();
        const timeoutTimer = setTimeout(() => timeoutController.abort(), PROVIDER_TIMEOUT_MS);
        const signal = combineSignals([timeoutController.signal, stopCtrl.signal]);

        const upstream = await chatRequest(provider, message, history, signal);
        clearTimeout(timeoutTimer);

        const localParser = createSSEParser(
          (delta) => { fullReply += delta; sendJSON({ delta }); },
          () => {},
          (err) => { requestError = err; sendJSON({ error: err }); },
          (toolEvent) => { hadToolCalls = true; sendJSON({ tool_progress: toolEvent }); },
        );

        const reader = upstream.body.getReader();
        const localDecoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            localParser.feed(localDecoder.decode(value, { stream: true }));
          }
        } catch (e) {
          if (e.name !== "AbortError") throw e;
        } finally {
          localParser.flush();
          reader.releaseLock();
        }

        if (!requestError) requestError = null;
        break;
      } catch (e) {
        const errMsg = e.message || String(e);
        log(`Chat provider "${provider.name}" failed: ${errMsg}`);
        requestError = errMsg;
        if (isFallback) sendJSON({ info: `备选 "${provider.name}" 失败: ${errMsg}` });
      }
    }

    if (requestError !== null) {
      sendJSON({ error: `所有模型均失败: ${requestError}` });
      if (fullReply) {
        session.messages.push({ role: "assistant", content: fullReply, ts: Date.now() });
      }
    } else {
      session.messages.push({ role: "assistant", content: fullReply || (hadToolCalls ? "（已执行工具，未生成文字回复）" : "（Gateway 连接失败）"), ts: Date.now() });
    }
    saveSession(session);

    if (!requestError && session.title === "New Chat" && session.messages.length >= 2) {
      autoTitle(message, primary).then(title => {
        const s2 = getSession(sessionId);
        if (s2 && s2.title === "New Chat") { s2.title = title; saveSession(s2); }
      }).catch(() => {});
    }
    sendJSON({ done: true });
  } catch (e) {
    sendJSON({ error: e.message || String(e) });
    sendJSON({ done: true });
    // 异常时也要保存，防止用户消息和已收到的部分内容丢失
    if (session) {
      try { saveSession(session); } catch {}
    }
  }
  cleanup();
}

const wsHandler = {
  open(ws) {
    // Dashboard WS 反代
    if (ws.data.type === "dashboard-proxy") {
      const { targetUrl } = ws.data;
      log(`[WS-PROXY] open → ${targetUrl}`);
      try {
        // 显式传 Host header 匹配上游 loopback 校验（_is_accepted_host）
        const upstream = new WebSocket(targetUrl, {
          headers: {
            "Host": `${DASHBOARD_BIND}:${DASHBOARD_PORT}`,
          },
        });
        ws.data.upstream = upstream;
        upstream.addEventListener("open", () => {
          log(`[WS-PROXY] upstream connected`);
        });
        upstream.addEventListener("message", (event) => {
          try { ws.send(event.data); } catch {}
        });
        upstream.addEventListener("close", (event) => {
          try { ws.close(event.code, event.reason); } catch {}
          log(`[WS-PROXY] upstream closed code=${event.code}`);
        });
        upstream.addEventListener("error", () => {
          try { ws.close(1006, "upstream error"); } catch {}
        });
      } catch (e) {
        log(`[WS-PROXY] upstream connect failed: ${e?.message || e}`);
        try { ws.close(1006, "upstream connect failed"); } catch {}
      }
      return;
    }
    // 聊天 WS
    const { sessionId, message } = ws.data;
    log(`[WS] open session=${sessionId}`);
    runChatWS(ws, sessionId, message).catch(err => {
      log(`[WS] runChatWS error: ${err?.message || err}`);
      try { ws.send(JSON.stringify({ error: err?.message || "internal error" })); } catch {}
      try { ws.send(JSON.stringify({ done: true })); } catch {}
    });
  },
  message(ws, msg) {
    // Dashboard WS 反代：客户端 → 上游
    if (ws.data.type === "dashboard-proxy") {
      if (ws.data.upstream && ws.data.upstream.readyState === 1) {
        try { ws.data.upstream.send(msg); } catch {}
      }
      return;
    }
    // Chat WS：前端可发送 {"stop":true} 主动中断
    try {
      const data = typeof msg === "string" ? JSON.parse(msg) : {};
      if (data.stop && ws.data.stopCtrl) ws.data.stopCtrl.abort();
    } catch {}
  },
  close(ws) {
    if (ws.data.type === "dashboard-proxy") {
      if (ws.data.upstream) {
        try { ws.data.upstream.close(); } catch {}
      }
      log(`[WS-PROXY] client closed`);
      return;
    }
    const { sessionId, stopCtrl } = ws.data;
    log(`[WS] close session=${sessionId}`);
    wsClients.delete(sessionId);
    if (stopCtrl) stopCtrl.abort();
  },
};

function beijingTime() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
function log(...args) {
  const msg = `[monitor] ${beijingTime()} ${args.join(" ")}`;
  console.log(msg);
  try { writeFileSync(LOG_FILE, msg + "\n", { flag: "a" }); } catch {}
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function readPid(path) {
  try {
    const n = Number(readFileSync(path, "utf8").trim());
    return n && pidAlive(n) ? n : null;
  } catch { return null; }
}

function readRawPid(path) {
  try {
    const n = Number(readFileSync(path, "utf8").trim());
    return n || null;
  } catch { return null; }
}

async function portAlive(port, host = "localhost", timeoutMs = 2000) {
  try {
    const r = await fetch(`http://${host}:${port}/`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok || r.status === 405;
  } catch { return false; }
}

// 直接读 /proc/net/tcp[6] 判断本机是否有进程在指定端口 LISTEN。
// 适用于非 HTTP 的内部端口（如 8642 网关通信端口），不受 HTTP 探活失败或
// localhost 解析为 IPv6 影响，比 portAlive 的 HTTP OPTIONS 探测更可靠。
function isPortListening(port) {
  const suffix = ":" + Number(port).toString(16).toUpperCase().padStart(4, "0");
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const lines = readFileSync(f, "utf8").split("\n");
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length < 4) continue;
        // parts[1]=local_address(HEX_IP:HEX_PORT)  parts[3]=st(0A=LISTEN)
        if (parts[3] === "0A" && parts[1] && parts[1].toUpperCase().endsWith(suffix)) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

function findPidByCmd(pattern) {
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .replace(/\0/g, " ").trim();
        if (cmdline.includes(pattern)) return pid;
      } catch {}
    }
    return null;
  } catch { return null; }
}

// 定位常驻网关进程：官方 Dashboard 以 `gateway restart` 拉起的常驻网关，
// 其命令行不含 `gateway run`，而 monitor 自己拉起的是 `gateway run`，
// 两种都需识别，否则 Dashboard 重启后 monitor 面板看不到网关进程。
function findGatewayPid() {
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .replace(/\0/g, " ").trim();
        if (/hermes/.test(cmdline) && /gateway\s+(run|restart)/.test(cmdline)) return pid;
      } catch {}
    }
    return null;
  } catch { return null; }
}

async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
}

async function stopPid(pidPath) {
  const pid = readPid(pidPath);
  if (pid) {
    try { process.kill(pid, "TERM"); } catch {}
    await waitForExit(pid, 5000);
    if (pidAlive(pid)) {
      try { process.kill(pid, "KILL"); } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
  }
  try { unlinkSync(pidPath); } catch {}
  spawnTimes.delete(pidPath);
}

async function forceKillHermes() {
  try {
    const proc = spawn(["pkill", "-SIGKILL", "-f", "hermes.*(gateway|dashboard)"]);
    await proc.exited;
  } catch {}
  try { unlinkSync(PID_GATEWAY); } catch {}
  try { unlinkSync(PID_DASHBOARD); } catch {}
}

function getProcessRssKB(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

function getHermesTotalMemoryKB() {
  let total = getProcessRssKB(process.pid);
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid || pid === process.pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
        if (cmdline.includes("hermes")) total += getProcessRssKB(pid);
      } catch {}
    }
  } catch {}
  return total;
}

let prevState = { gwRun: false, gwHealth: false, dbRun: false, dbHealth: false };
const spawnTimes = new Map();
const GRACE_PERIOD_MS = 20000;

let gatewayCrashCount = 0;
let gatewayCrashLoop  = false;
const CRASH_WINDOW_MS  = 60000;
const CRASH_LOOP_MAX   = 3;

function spawnHermes(name, pidPath, args) {
  if (pidPath === PID_GATEWAY && gatewayCrashLoop) {
    log(`Gateway 启动被阻止 — 已检测到崩溃循环（需配置消息平台或先停止再启动）`);
    return { ok: false, error: "crash_loop" };
  }

  if (readPid(pidPath)) return { ok: true, msg: "already_running" };

  const logPath = `${VAR_DIR}/${name}.log`;
  try { writeFileSync(logPath, ""); } catch {}

  const env = {
    ...process.env,
    HOME: DATA_DIR,
    HERMES_HOME: DATA_DIR,
    PATH: resolvedNodeDir
      ? `${resolvedNodeDir}:${VENV_BIN}:/usr/local/bin:/usr/bin:/bin`
      : `${VENV_BIN}:/usr/local/bin:/usr/bin:/bin`,
    ...(resolvedNodeBin ? { HERMES_NODE: resolvedNodeBin } : {}),
    HERMES_TUI_DIR: TUI_DIR,
    GATEWAY_ALLOW_ALL_USERS: "true",
    API_SERVER_ENABLED: "true",
    API_SERVER_PORT:   "8642",
    API_SERVER_HOST:    "0.0.0.0",
    API_SERVER_KEY:     MONITOR_TOKEN,
    HERMES_YOLO_MODE:   "1",
    LITELLM_REQUEST_TIMEOUT: "600",
    REQUEST_TIMEOUT:    "600",
  };

  const p = spawn({
    cmd:    [HERMES_BIN, ...args],
    env,
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
    stdin:  "ignore",
  });

  p.unref();
  writeFileSync(pidPath, String(p.pid));
  spawnTimes.set(pidPath, Date.now());
  log(`${name} 已启动 pid=${p.pid}`);

  const cmdPattern = name === "gateway" ? "hermes gateway run" : "hermes dashboard";
  setTimeout(() => {
    if (pidAlive(p.pid)) return;
    const real = findPidByCmd(cmdPattern);
    if (real && real !== p.pid) {
      writeFileSync(pidPath, String(real));
      spawnTimes.set(pidPath, Date.now());
      log(`${name} 运行中 pid=${real}`);
    }
  }, 1500);

  return { ok: true, pid: p.pid };
}


function recordGatewayDeath() {
  const spawnTime = spawnTimes.get(PID_GATEWAY) || 0;
  const lifetime  = Date.now() - spawnTime;
  if (lifetime < CRASH_WINDOW_MS) {
    gatewayCrashCount++;
    if (gatewayCrashCount >= CRASH_LOOP_MAX && !gatewayCrashLoop) {
      gatewayCrashLoop = true;
      log(`Gateway crash loop detected (${gatewayCrashCount} rapid deaths) — blocking respawn`);
      log(`Gateway requires messaging platform config or manual restart after stop`);
    }
  } else {
    gatewayCrashCount = 0;
  }
}

function resetGatewayCrashLoop() {
  gatewayCrashCount = 0;
  gatewayCrashLoop  = false;
}
async function getStatus() {
  let [gp, dp] = [readPid(PID_GATEWAY), readPid(PID_DASHBOARD)];

  // 验证 PID 文件中的进程是否还活着（Dashboard 内部重启时 PID 文件可能残留旧值）
  if (gp && !pidAlive(gp)) {
    try { unlinkSync(PID_GATEWAY); } catch {}
    gp = null;
  }
  if (dp && !pidAlive(dp)) {
    try { unlinkSync(PID_DASHBOARD); } catch {}
    dp = null;
  }

  // 先检测端口是否在监听（Dashboard 内部重启时 gateway 可能在 Dashboard 进程里，PID 文件不更新）
  // 8642 为非 HTTP 内部端口，优先用 /proc 的 LISTEN 判据，HTTP 探活作兜底
  const gwListening = isPortListening(GATEWAY_PORT);
  const gwPortAlive = gwListening || await portAlive(GATEWAY_PORT);

  if (!gp) {
    const found = findGatewayPid();
    if (found) {
      writeFileSync(PID_GATEWAY, String(found), "utf8");
      log(`Gateway 运行中 pid=${found}`);
      gp = found;
    } else if (gwPortAlive) {
      // 端口在监听但找不到独立进程 → gateway 可能在 Dashboard 进程里运行
      log(`Gateway 运行中（端口 ${GATEWAY_PORT} 在监听，可能在 Dashboard 进程内）`);
    }
  }
  if (!dp) {
    const foundDb = findPidByCmd("hermes dashboard");
    if (foundDb) {
      writeFileSync(PID_DASHBOARD, String(foundDb), "utf8");
      log(`Dashboard 运行中 pid=${foundDb}`);
      dp = foundDb;
    }
  }
  // Gateway 在运行：PID 文件存在 或 端口在监听
  const gwRunning = !!gp || gwPortAlive;
  const dbRunning = !!dp;
  let gwHealthy = false;
  let dbHealthy = false;

  // 健康检查：TCP 处于 LISTEN 即视为健康（8642 非 HTTP，OPTIONS 探测不可靠，仅作兜底）
  if (gwListening) {
    gwHealthy = true;
  } else if (gp || gwPortAlive) {
    try {
      const r = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(300),
      });
      gwHealthy = r.ok || r.status === 405;
    } catch {}
  }

  if (dp) {
    try {
      const r = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/`, {
        signal: AbortSignal.timeout(300),
      });
      dbHealthy = r.ok;
    } catch {}
  }

  if (prevState.gwRun && !gwRunning) {
    log("Gateway stopped");
    recordGatewayDeath();
  }
  if (!prevState.gwRun && gwRunning) log("Gateway started (pid=" + gp + ")");
  if (gwRunning && prevState.gwHealth && !gwHealthy) log("Gateway port unresponsive (pid=" + gp + ")");
  if (gwRunning && !prevState.gwHealth && gwHealthy) log("Gateway is healthy (pid=" + gp + ")");

  if (prevState.dbRun && !dbRunning) log("Dashboard stopped (pid gone)");
  if (!prevState.dbRun && dbRunning) log("Dashboard started (pid=" + dp + ")");
  if (dbRunning && prevState.dbHealth && !dbHealthy) log("Dashboard port unresponsive (pid=" + dp + ")");
  if (dbRunning && !prevState.dbHealth && dbHealthy) log("Dashboard is healthy (pid=" + dp + ")");

  prevState = { gwRun: gwRunning, gwHealth: gwHealthy, dbRun: dbRunning, dbHealth: dbHealthy };

  let lastLog = "";
  try {
    const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter(l => l.trim());
    lastLog = lines.slice(-20).join("\n");
  } catch {}

  return {
    gateway:   { running: gwRunning, healthy: gwHealthy, pid: gp, port: GATEWAY_PORT, crash_loop: gatewayCrashLoop, version: HERMES_VERSION },
    dashboard: { running: dbRunning, healthy: dbHealthy, pid: dp },
    lastLog,
  };
}

// 网关重启完成判定：无 systemd 环境下 `hermes gateway restart` 进程会转为常驻网关永不退出，
// 官方 get_action_status 仅凭该进程是否退出判定完成，导致前端「重启中」永不结束。
// 记录最近一次重启请求时刻，配合端口健康检查在代理层收尾该状态。
const RESTART_SETTLE_MS = 6000;
let lastGatewayRestartTs = 0;
// 按 pid 记录首次观测到 gateway-restart 进程处于 running 的时刻。
// 不依赖重启请求是否经代理、也不依赖日志时间戳解析，避免 monitor 重启、
// 或日志被常驻网关写满截断时 settle 永不触发导致「重启中」卡死。
let restartFirstSeen = { pid: 0, ts: 0 };

async function proxyDashboard(req) {
  const url     = new URL(req.url);
  // req.url 仍含 BASE_PATH 前缀（handleFetch 只剥了 path 变量），需先去掉
  const subPath = url.pathname
    .replace(new RegExp(`^${BASE_PATH.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`), "")
    .replace(/^\/proxy\/dashboard/, "") || "/";
  const target  = `http://${DASHBOARD_BIND}:${DASHBOARD_PORT}${subPath}${url.search}`;

  const prefix = `${BASE_PATH || ""}/proxy/dashboard`;

  // 记录网关重启请求时刻 + 重启前的网关 pid：既用于后续判定重启是否已实际完成，
  // 也用于检测官方复用守卫是否发生「未真正重启」的空操作（返回 pid == 重启前 pid）。
  let restartPreGwPid = 0;
  if (req.method === "POST" && subPath === "/api/gateway/restart") {
    lastGatewayRestartTs = Date.now();
    restartPreGwPid = findGatewayPid() || 0;
  }

  try {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const upstream = await fetch(target, {
      method:  req.method,
      headers,
      body:    req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      signal:  AbortSignal.timeout(10000),
    });

    const respHeaders = new Headers(upstream.headers);

    // ── 3xx 重定向：改写 Location 头 ──
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = respHeaders.get("location");
      if (loc) {
        try {
          const abs = new URL(loc, target);
          respHeaders.set("location", prefix + abs.pathname + abs.search);
        } catch {}
      }
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    const contentType = respHeaders.get("content-type") || "";

    // ── 网关重启 POST：修复官方复用守卫导致的「连续第二次重启空操作」 ──
    // 无 systemd 下 `hermes gateway restart` 进程(P1)杀旧网关后自身转为常驻网关不退出，
    // 官方 _spawn_gateway_restart 的复用守卫见 P1 仍存活便直接 return existing(空操作)，
    // 返回的 pid 即当前在跑的网关本体 → 第二次重启根本没重启、动作日志无新输出，
    // 前端永久卡在「重启中/等待输出…」。检测到返回 pid == 重启前网关 pid（即未真正重启）时，
    // 杀掉旧网关并重发一次，迫使官方 spawn 出真正的新 restart 进程。monitor 无自动重生
    // 循环（网关仅由 /api/start、/api/restart 显式启动），故此处杀进程不会与 monitor 抢占冲突。
    if (req.method === "POST" && subPath === "/api/gateway/restart") {
      let bodyText = await upstream.text();
      try {
        const j = JSON.parse(bodyText);
        const rpid = Number(j && j.pid) || 0;
        if (rpid && restartPreGwPid && rpid === restartPreGwPid && isPortListening(GATEWAY_PORT)) {
          log(`[restart] 官方复用旧网关进程 pid=${rpid}(未真正重启)，杀掉后强制重发重启`);
          try { process.kill(rpid, "SIGTERM"); } catch {}
          // 以端口是否仍在 LISTEN 判断旧网关是否已退出（比 pidAlive 更可靠：
          // 进程成为 zombie 时 kill(pid,0) 仍返回存活，会误判）。
          const deadline = Date.now() + 3000;
          while (isPortListening(GATEWAY_PORT) && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 100));
          }
          if (isPortListening(GATEWAY_PORT)) {
            try { process.kill(rpid, "SIGKILL"); } catch {}
            await new Promise(r => setTimeout(r, 300));
          }
          // 旧进程已退出，官方复用守卫的 poll() 将失效 → 重发触发真正的新 restart
          restartFirstSeen = { pid: 0, ts: 0 };
          lastGatewayRestartTs = Date.now();
          const rh = new Headers(req.headers);
          rh.delete("host");
          try {
            const up2 = await fetch(target, { method: "POST", headers: rh, signal: AbortSignal.timeout(10000) });
            bodyText = await up2.text();
            log(`[restart] 已强制重发重启，官方应 spawn 新 gateway restart 进程`);
          } catch (e) {
            log(`[restart] 强制重发重启失败：${e?.message || e}`);
          }
        }
      } catch {}
      respHeaders.delete("content-length");
      respHeaders.set("cache-control", "no-store");
      return new Response(bodyText, { status: upstream.status, headers: respHeaders });
    }

    // ── 网关重启 action 状态改写 ──
    // `hermes gateway restart` 进程转为常驻网关不退出 → 官方永远回报 running:true。
    // 重启实际已完成（距请求已过 settle 且网关端口健康）时改写为 running:false 收尾「重启中」。
    if (req.method === "GET" && subPath === "/api/actions/gateway-restart/status") {
      let bodyText = await upstream.text();
      try {
        const j = JSON.parse(bodyText);
        if (j && j.running === true) {
          const now = Date.now();
          const pid = Number(j.pid) || 0;
          // pid 变化视为新的重启进程，重新计时；常驻进程复用时沿用首次观测时刻
          if (restartFirstSeen.pid !== pid) {
            restartFirstSeen = { pid, ts: now };
          }
          // 以「用户最近一次点击重启」或「首次观测到 running」中较晚者为起点计 settle
          const startedMs = Math.max(restartFirstSeen.ts, lastGatewayRestartTs || 0);
          const settled = (now - startedMs) > RESTART_SETTLE_MS;
          // 8642 为非 HTTP 内部端口，优先用 /proc 的 LISTEN 判据，HTTP 探活作兜底
          const listening = isPortListening(GATEWAY_PORT);
          const alive = settled && (listening || await portAlive(GATEWAY_PORT));
          if (settled && alive) {
            j.running = false;
            if (j.exit_code === null || j.exit_code === undefined) j.exit_code = 0;
            bodyText = JSON.stringify(j);
            log(`[restart] 网关端口 ${GATEWAY_PORT} 健康且已 settle(${((now - startedMs) / 1000).toFixed(1)}s)，改写 gateway-restart 状态为完成以收尾「重启中」`);
          } else {
            log(`[restart] gateway-restart 仍 running：settled=${settled} listening=${listening} pid=${pid}`);
          }
        } else {
          restartFirstSeen = { pid: 0, ts: 0 };
        }
      } catch {}
      respHeaders.delete("content-length");
      respHeaders.set("cache-control", "no-store");
      return new Response(bodyText, { status: upstream.status, headers: respHeaders });
    }

    // ── CSS 响应：改写 url(/...) 加前缀，让字体等 url() 引用能正确路由 ──
    if (contentType.includes("text/css") || subPath.endsWith(".css")) {
      let css = await upstream.text();
      css = css.replace(/url\((\/[^)'"]+)\)/g, `url(${prefix}$1)`);
      respHeaders.delete("content-length");
      return new Response(css, { status: upstream.status, headers: respHeaders });
    }

    // ── HTML 响应：注入 <base> + 路径改写脚本 ──
    if (contentType.includes("text/html")) {
      let html = await upstream.text();

      // <base> 处理相对路径（CSS url()、相对 src 等）
      html = html.replace(/<head(\s[^>]*)?>/, `<head$1><base href="${prefix}/">`);

      // 静态重写 src 属性中的绝对路径（脚本、图片等）
      html = html.replace(/\bsrc="\/(?!\/)/g, `src="${prefix}/`);
      // 静态重写 <link href>（CSS 样式表），不改写 <a href>（SPA 路由需要原始路径）
      html = html.replace(/<link(\s[^>]*)href="\/(?!\/)/g, (m, a) => `<link${a}href="${prefix}/`);

      // 注入 JS：智能前缀管理（pushState剥离+导航感知恢复+popstate拦截）
      const inject = `<script>
(function(){
  var P="${prefix}";
  function rw(u){
    if(typeof u!=="string")return u;
    if(u.indexOf("//")===0||/^[a-z]+:/i.test(u))return u;
    if(u.charAt(0)==="/"){if(u.indexOf(P)===0)return u;return P+u;}
    return u;
  }
  function strip(u){
    if(typeof u!=="string")return u;
    if(u.indexOf(P)===0)return u.substring(P.length)||"/";
    return u;
  }
  var _ps=history.pushState,_rs=history.replaceState;
  var _pn=location.pathname;
  /* ── 安全恢复前缀（微任务，比 rAF 更快恢复前缀） ── */
  function sched(){
    Promise.resolve().then(function(){
      if(location.pathname===_pn){
        var s=location.search||"",h=location.hash||"";
        _rs.call(history,history.state,"",rw(_pn)+s+h);
      }
    });
  }
  /* ── 初始加载：清理 URL 让 SPA 路由启动 ── */
  if(_pn.indexOf(P)===0){
    var cl=_pn.substring(P.length)||"/";
    _rs.call(history,history.state,"",cl+location.search+location.hash);
    _pn=cl;
    sched();
  }
  /* ── pushState：剥离前缀给路由，微任务恢复前缀给地址栏 ── */
  history.pushState=function(s,t,u){
    _pn=u?(u.split("?")[0].split("#")[0]):location.pathname;
    var c=u?strip(u):u;
    _ps.call(this,s,t,c);
    if(u)sched();
  };
  history.replaceState=function(s,t,u){
    _pn=u?(u.split("?")[0].split("#")[0]):location.pathname;
    var c=u?strip(u):u;
    _rs.call(this,s,t,c);
    if(u)sched();
  };
  /* ── popstate：后退/前进时临时清理 URL ── */
  var _ae=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,fn,opt){
    if(type==="popstate"&&fn){
      var w=function(ev){
        var cp=location.pathname;
        var cl=cp.indexOf(P)===0?(cp.substring(P.length)||"/"):cp;
        _rs.call(history,history.state,"",cl+location.search+location.hash);
        _pn=cl;
        fn.call(this,ev);
        _rs.call(history,history.state,"",cp+location.search+location.hash);
        _pn=cp;
      };
      return _ae.call(this,type,w,opt);
    }
    return _ae.call(this,type,fn,opt);
  };
  /* ── fetch / XHR：添加前缀 ── */
  var _f=window.fetch;
  window.fetch=function(i,o){
    if(typeof i==="string")i=rw(i);
    else if(i&&i.url)return _f(new Request(rw(i.url),i),o);
    return _f.call(this,i,o);
  };
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    if(arguments.length>1)arguments[1]=rw(arguments[1]);
    return _xo.apply(this,arguments);
  };
  /* ── MutationObserver：只改写 src ── */
  function rwEl(el){
    if(el.hasAttribute("src")){var s=el.getAttribute("src");if(s&&s.charAt(0)==="/"&&s.indexOf(P)!==0)el.setAttribute("src",P+s);}
  }
  new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==="childList")m.addedNodes.forEach(function(n){if(n.nodeType===1){rwEl(n);n.querySelectorAll&&n.querySelectorAll("[src]").forEach(rwEl);}});});}).observe(document.documentElement,{childList:true,subtree:true});
  document.querySelectorAll("[src]").forEach(rwEl);
  /* ── hook HTMLScriptElement.src setter：createElement("script") 后 v.src=...
     走的不是 fetch/XHR，需要在这里加前缀 ── */
  var _sp=HTMLScriptElement.prototype,_sd=Object.getOwnPropertyDescriptor(_sp,"src");
  if(_sd&&_sd.set){var _ss=_sd.set,_sg=_sd.get;Object.defineProperty(_sp,"src",{get:function(){return _sg?_sg.call(this):undefined;},set:function(v){if(typeof v==="string"&&v.charAt(0)==="/"&&v.indexOf(P)!==0)v=P+v;_ss.call(this,v);},configurable:true,enumerable:_sd.enumerable});}
  /* ── hook HTMLLinkElement.href setter：createElement("link") 后 x.href=...
     走的不是 fetch/XHR，需要在这里加前缀 ── */
  var _lp=HTMLLinkElement.prototype,_ld=Object.getOwnPropertyDescriptor(_lp,"href");
  if(_ld&&_ld.set){var _ls=_ld.set,_lg=_ld.get;Object.defineProperty(_lp,"href",{get:function(){return _lg?_lg.call(this):undefined;},set:function(v){if(typeof v==="string"&&v.charAt(0)==="/"&&v.indexOf(P)!==0)v=P+v;_ls.call(this,v);},configurable:true,enumerable:_ld.enumerable});}
  /* ── hook WebSocket：给 dashboard WS URL 加前缀，路由到 monitor 反代 ── */
  var _WS=window.WebSocket;
  /* iOS 第三方输入法(如百度)在 xterm 终端无法输入的补偿所需：
     捕获 /api/pty 连接并包裹其 send 以记录 xterm 实际发出的输入 */
  var _activePty=null, _ptySent=[];
  function _hookPty(sock, pathname){
    try{
      if(!sock||!pathname||pathname.indexOf("/api/pty")===-1)return sock;
      _activePty=sock;
      var _os=sock.send;
      sock.send=function(d){
        try{
          var s=(typeof d==="string")?d:(d?new TextDecoder().decode(d):"");
          if(s){_ptySent.push({t:Date.now(),s:s});if(_ptySent.length>80)_ptySent.shift();}
        }catch(e){}
        return _os.apply(this,arguments);
      };
      sock.addEventListener("close",function(){if(_activePty===sock)_activePty=null;});
    }catch(e){}
    return sock;
  }
  window.WebSocket=function(url,protocols){
    try{
      if(typeof url==="string"){
        var u=new URL(url,location.origin);
        if(u.pathname.charAt(0)==="/"&&u.pathname.indexOf(P)!==0){
          var newUrl=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+P+u.pathname+(u.search||"")+(u.hash||"");
          return _hookPty(new _WS(newUrl,protocols),u.pathname);
        }
        return _hookPty(new _WS(url,protocols),u.pathname);
      }
    }catch(e){}
    return new _WS(url,protocols);
  };
  window.WebSocket.prototype=_WS.prototype;
  /* 关键：保留构造器静态常量（CONNECTING/OPEN/CLOSING/CLOSED）。
     dashboard 前端发送输入前常用 ws.readyState===WebSocket.OPEN 做门禁；
     覆盖构造器若丢掉这些常量，OPEN 变 undefined → 门禁永不成立 → 输入帧发不出去
     （服务端推来的输出仍走 onmessage，故表现为“画面能显示、但无法输入/发送”）。 */
  window.WebSocket.CONNECTING=_WS.CONNECTING;
  window.WebSocket.OPEN=_WS.OPEN;
  window.WebSocket.CLOSING=_WS.CLOSING;
  window.WebSocket.CLOSED=_WS.CLOSED;
  /* ── iOS 第三方输入法(百度等)组合输入补偿 ──
     现象：iPhone 上用第三方 IME 在 Dashboard 终端(xterm)对话打不出字，自带键盘正常。
     根因：部分第三方 IME 的组合提交未触发 xterm 期望的事件序列，组合文字从不经
     /api/pty 发出。这里在组合结束/插入后核对：若该文字未被 xterm 经 pty socket 发出，
     则由我们补发到 /api/pty（服务端 pty_ws 同时接受 text/bytes 帧，text 按 UTF-8 编码）。
     去重：仅当“事件发生之后”pty 未发出该文字才补发；xterm 正常处理会在事件后立即发出，
     且我们自己的补发也会被记录，天然避免重复；不同次提交按时间戳区分，允许连续重复字。 */
  function _isTermTarget(t){
    try{return !!(t&&((t.classList&&t.classList.contains("xterm-helper-textarea"))||(t.closest&&t.closest(".xterm"))));}
    catch(e){return false;}
  }
  function _ptyReconcileSend(text,mark){
    if(!text||!_activePty||_activePty.readyState!==1)return;
    setTimeout(function(){
      try{
        if(!_activePty||_activePty.readyState!==1)return;
        var after="";
        for(var i=0;i<_ptySent.length;i++){if(_ptySent[i].t>=mark-5)after+=_ptySent[i].s;}
        if(after.indexOf(text)!==-1)return;   /* xterm 已发出，勿重复 */
        _activePty.send(text);
      }catch(e){}
    },80);
  }
  document.addEventListener("compositionend",function(ev){
    try{if(ev&&ev.data&&_isTermTarget(ev.target))_ptyReconcileSend(String(ev.data),Date.now());}catch(e){}
  },true);
  document.addEventListener("input",function(ev){
    try{
      if(!ev||ev.isComposing||!ev.data||!_isTermTarget(ev.target))return;
      if(ev.inputType&&ev.inputType!=="insertText"&&ev.inputType!=="insertCompositionText")return;
      _ptyReconcileSend(String(ev.data),Date.now());
    }catch(e){}
  },true);
})();
<\/script>`;

      html = html.replace("</head>", inject + "\n</head>");

      respHeaders.delete("content-length");
      respHeaders.delete("content-encoding");
      return new Response(html, { status: upstream.status, headers: respHeaders });
    }

    // ── 非 HTML 响应：原样透传 ──
    return new Response(upstream.body, {
      status:  upstream.status,
      headers: respHeaders,
    });
  } catch (e) {
    // 连接拒绝/Dashboard 未就绪属正常现象（启动期间），仅非预期错误才记录
    const msg = e?.message || '';
    if (msg && !/connect|refused|abort|ECONN/i.test(msg)) log(`proxy error: ${msg}`);
    return new Response(JSON.stringify({ error: "Dashboard unavailable" }), {
      status:  502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function createLogStream(req, lastOffset) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data, ev = "log") => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`event: ${ev}\ndata: ${data}\n\n`)); }
        catch { closed = true; try { controller.close(); } catch {} }
      };

      // offset >= 0 = 重连，跳过历史；-1 = 首次连接，发送历史
      let offset = 0;
      if (lastOffset >= 0) {
        let fileSize = 0;
        try { if (existsSync(LOG_FILE)) fileSize = statSync(LOG_FILE).size; } catch {}
        if (lastOffset <= fileSize) {
          offset = lastOffset;
        } else {
          try {
            if (existsSync(LOG_FILE))
              readFileSync(LOG_FILE, "utf8").split("\n").filter(l => l.trim()).slice(-30)
                .forEach(l => send(l));
          } catch {}
          offset = fileSize;
        }
      } else {
        try {
          if (existsSync(LOG_FILE))
            readFileSync(LOG_FILE, "utf8").split("\n").filter(l => l.trim()).slice(-30)
              .forEach(l => send(l));
        } catch {}
        try { if (existsSync(LOG_FILE)) offset = statSync(LOG_FILE).size; } catch {}
      }

      const flush = () => {
        try {
          if (!existsSync(LOG_FILE)) return;
          const sz = statSync(LOG_FILE).size;
          if (sz < offset) {
            offset = 0;
          }
          if (sz > offset) {
            const chunk = readFileSync(LOG_FILE, "utf8").slice(offset);
            offset = sz;
            chunk.split("\n").filter(l => l.trim()).forEach(l => send(l));
          }
        } catch {}
      };

      let watcher = null;
      try {
        watcher = watch(existsSync(LOG_FILE) ? LOG_FILE : VAR_DIR, () => flush());
      } catch {}

      const heartbeat = setInterval(() => send("", "heartbeat"), 30000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        try { watcher?.close(); } catch {}
        try { controller.close(); } catch {}
      });
    },
  });
}

// ─── 静态文件服务 ─────────────────────────────────────────────────────
function serveFile(filePath, contentType) {
  if (!existsSync(filePath)) return new Response("Not Found", { status: 404 });
  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

// ─── 请求处理器 ─────────────────────────────────────────────────────────
async function handleFetch(req) {
  const url  = new URL(req.url);
  // fnOS gateway 反向代理不剥路径前缀（/app/{appname}/），这里手动剥离
  const path = url.pathname.replace(/^\/app\/[^/]+/, "") || "/";

  // CORS 预检
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") || "*";
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Monitor-Token",
        "Content-Length": "0",
      },
    });
  }

  const corsOrigin = req.headers.get("origin") || "*";
  const jsonHeaders = (extra = {}) => ({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": corsOrigin,
    ...extra,
  });

  // 需要令牌的变更操作（仅写操作，GET 不需要 token）
  const writePaths = ["/api/start", "/api/stop", "/api/restart", "/api/dashboard/start", "/api/dashboard/stop", "/api/config", "/api/config/test", "/api/hermes/update", "/api/logs/clear"];
  const isWrite = ["POST", "PUT", "DELETE"].includes(req.method);
  if (isWrite && writePaths.includes(path) && !checkToken(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders(),
    });
  }

  if (path === "/api/health") {
    return new Response(JSON.stringify({ ok: true, ts: Date.now(), token: MONITOR_TOKEN }), {
      headers: jsonHeaders(),
    });
  }

  // 实时探测 8642 网关健康状态，前端 chat 页用这个判断"是否连接"
  if (path === "/api/gateway/health") {
    const t0 = Date.now();
    let ok = false, err = null;
    try {
      const r = await fetch(`${GATEWAY_API}/models`, {
        headers: { "Authorization": `Bearer ${MONITOR_TOKEN}` },
        signal: AbortSignal.timeout(2000),
      });
      ok = r.ok;
      if (!ok) err = `HTTP ${r.status}`;
    } catch (e) { err = e?.message || String(e); }
    return new Response(JSON.stringify({ ok, latency: Date.now() - t0, error: err, port: GATEWAY_PORT }), {
      headers: jsonHeaders(),
    });
  }

  if (path === "/api/status") {
    const s = await getStatus();
    const uptimeMs = Date.now() - START_TIME;
    const uptimeStr = formatUptime(uptimeMs);
    const monPid = process.pid;
    const readPid = (f) => { try { return Number(readFileSync(f,"utf8").trim()); } catch { return null; } };
    const gwPid = readPid(PID_GATEWAY);
    const dbPid = readPid(PID_DASHBOARD);
    const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const logDir = `${DATA_DIR}/logs`;
    const logFiles = [
      { name: "hermes.log",             label: "Monitor 日志" },
      { name: "agent.log",              label: "Agent 日志" },
      { name: "gui.log",                label: "GUI 日志" },
      { name: "errors.log",             label: "错误日志" },
      { name: "gateway.log",            label: "Gateway 日志" },
      { name: "gateway-restart.log",    label: "Gateway 重启记录" },
      { name: "gateway-shutdown-diag.log", label: "Gateway 关闭诊断" },
      { name: "gateway-exit-diag.log",  label: "Gateway 退出诊断" },
    ].map(({ name, label }) => {
      const fp = `${logDir}/${name}`;
      let size = 0, mtime = null;
      try { const s2 = statSync(fp); size = s2.size; mtime = s2.mtime.toISOString(); } catch {}
      return { name, label, size, mtime };
    });
    let memKB = null;
    try { memKB = getHermesTotalMemoryKB(); } catch {}
    return new Response(JSON.stringify({
      ...s,
      uptime: uptimeStr,
      uptimeMs,
      pid: monPid,
      gatewayPid: gwPid,
      dashboardPid: dbPid,
      gatewayAlive: gwPid ? isAlive(gwPid) : null,
      dashboardAlive: dbPid ? isAlive(dbPid) : null,
      memoryKB: memKB,
      logFiles,
      token: MONITOR_TOKEN,
      transport: SOCKET_PATH ? "unix" : "tcp",
      socket_path: SOCKET_PATH || null,
      api_server_port: 8642,
      api_server_url: `http://${getLANIP()}:8642`,
    }), { headers: jsonHeaders() });
  }

  // ── Hermes 自更新（直接使用 uv，不依赖 dashboard）────────
  // GET  /api/hermes/update/check  → 从 PyPI 查询最新版本
  // POST /api/hermes/update        → 触发 uv pip install --upgrade（后台执行）
  // GET  /api/hermes/update/status → 轮询更新进度
  if (path === "/api/hermes/update/check") {
    try {
      // 每次检查都重新运行 hermes --version，确保版本准确（不依赖缓存）
      let current = HERMES_VERSION;
      try {
        const { spawnSync } = require("bun");
        const vr = spawnSync([HERMES_BIN, "--version"], { stdout: "pipe", stderr: "pipe" });
        const vOut = ((vr.stdout ? vr.stdout.toString() : "").trim())
                  || ((vr.stderr ? vr.stderr.toString() : "").trim());
        if (vOut) {
          current = formatHermesVersion(vOut);
          if (current !== HERMES_VERSION) {
            HERMES_VERSION = current;
            try { writeFileSync(VERSION_FILE, current, { mode: 0o644 }); } catch {}
            log(`版本已刷新(check): ${current}`);
          }
        }
      } catch {}
      const currentVer = current.replace(/^v/, "").split(" ")[0];
      let latest = "unknown";
      let latestDate = "";

      // 优先 PyPI JSON API（可获取发布日期）
      try {
        const r = await fetch("https://pypi.org/pypi/hermes-agent/json", {
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const data = await r.json();
          if (data.info && data.info.version) {
            latest = data.info.version;
            const rels = data.releases && data.releases[latest];
            if (rels && rels.length > 0 && rels[0].upload_time) {
              const d = new Date(rels[0].upload_time);
              latestDate = `(${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()})`;
            }
          }
        }
      } catch {}

      // 兜底：阿里云镜像 simple index（无日期信息）
      if (latest === "unknown") {
        try {
          const r2 = await fetch("https://mirrors.aliyun.com/pypi/simple/hermes-agent/", {
            signal: AbortSignal.timeout(10000),
          });
          const html = await r2.text();
          const versions = [...html.matchAll(/hermes-agent-(\d+\.\d+\.\d+)/g)].map(m => m[1]);
          if (versions.length > 0) {
            versions.sort((a, b) => {
              const pa = a.split(".").map(Number);
              const pb = b.split(".").map(Number);
              for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
              return 0;
            });
            latest = versions[versions.length - 1];
          }
        } catch {}
      }

      const latestDisplay = latest !== "unknown" ? `v${latest} ${latestDate}`.trim() : "未知";
      const updateAvailable = latest !== "unknown" && latest !== currentVer;
      return new Response(JSON.stringify({ current, latest: latestDisplay, updateAvailable }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (path === "/api/hermes/update" && req.method === "POST") {
    if (updateState === "updating") {
      return new Response(JSON.stringify({ error: "更新进行中，请等待" }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }
    // 重置状态
    updateState = "updating";
    updateOutput = [];
    updateExitCode = null;

    const env = {
      ...process.env,
      UV_INDEX_URL: "https://mirrors.aliyun.com/pypi/simple/",
      UV_CACHE_DIR: `${DATA_DIR}/.uv-cache`,
      PATH: `${VENV_BIN}:/usr/local/bin:/usr/bin:/bin`,
    };

    try {
      const proc = spawn({
        cmd: [UV_BIN_PATH, "pip", "install", "--python", `${DATA_DIR}/venv/bin/python3`, "--upgrade", "--no-cache", "hermes-agent[all]"],
        env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      updateProc = proc;

      const decoder = new TextDecoder();
      const collectStream = async (stream, isErr) => {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (line.trim()) {
                updateOutput.push((isErr ? "[stderr] " : "") + line.trim());
                if (updateOutput.length > 200) updateOutput.shift();
              }
            }
          }
        } catch {}
      };

      collectStream(proc.stdout, false);
      collectStream(proc.stderr, true);

      proc.exited.then((code) => {
        updateExitCode = code;
        updateState = code === 0 ? "done" : "error";
        if (code === 0) {
          // 清除版本缓存，下次 status 查询时重新检测
          try { unlinkSync(VERSION_FILE); } catch {}
          try { HERMES_VERSION = "unknown"; } catch {}
        }
        updateProc = null;
        log(`hermes self-update finished: exit=${code}`);
      });

      return new Response(JSON.stringify({ ok: true, message: "更新已启动" }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      updateState = "error";
      updateProc = null;
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (path === "/api/hermes/update/status") {
    let currentVer = HERMES_VERSION;
    if (updateState === "done") {
      try {
        const { spawnSync } = require("bun");
        const verResult = spawnSync([HERMES_BIN, "--version"], { stdout: "pipe", stderr: "pipe" });
        const verOut = ((verResult.stdout ? verResult.stdout.toString() : "").trim())
                    || ((verResult.stderr ? verResult.stderr.toString() : "").trim());
        if (verOut) {
          currentVer = formatHermesVersion(verOut);
          HERMES_VERSION = currentVer;
          try { writeFileSync(VERSION_FILE, currentVer, { mode: 0o644 }); } catch {}
        }
      } catch {}
    }
    return new Response(JSON.stringify({
      status: updateState,
      output: updateOutput.slice(-50),
      exitCode: updateExitCode,
      version: currentVer,
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (path === "/api/start" && req.method === "POST") {
    // 启动前检查：必须有至少一个真实模型服务商（非 Hermes Gateway 自身）
    const statePath = `${VAR_DIR}/providers-state.yaml`;
    let hasRealProvider = false;
    try {
      if (existsSync(statePath)) {
        const stateContent = readFileSync(statePath, "utf8");
        const provIds = [...stateContent.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(m => m[1]);
        hasRealProvider = provIds.some(id => id !== "hermes");
      }
    } catch {}
    if (!hasRealProvider) {
      return new Response(JSON.stringify({ ok: false, error: "请先在设置中添加至少一个模型服务商" }), { status: 400, headers: jsonHeaders() });
    }
    const r1 = spawnHermes("gateway",   PID_GATEWAY,   ["gateway", "run"]);
    const r2 = spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
    return new Response(JSON.stringify({ gateway: r1, dashboard: r2 }), { headers: jsonHeaders() });
  }

  if (path === "/api/stop" && req.method === "POST") {
    const gwAlive = readPid(PID_GATEWAY);
    const dbAlive = readPid(PID_DASHBOARD);
    await stopPid(PID_GATEWAY);
    await stopPid(PID_DASHBOARD);
    await forceKillHermes();
    resetGatewayCrashLoop();
    if (gwAlive) log("Gateway stopped (pid=" + gwAlive + ")");
    if (dbAlive) log("Dashboard stopped (pid=" + dbAlive + ")");
    if (!gwAlive && !dbAlive) log("Stop: no running processes");
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  if (path === "/api/restart" && req.method === "POST") {
    log("Restarting gateway ...");
    await stopPid(PID_GATEWAY);
    await stopPid(PID_DASHBOARD);
    await forceKillHermes();
    resetGatewayCrashLoop();
    await new Promise(r => setTimeout(r, 1500));
    const r1 = spawnHermes("gateway",   PID_GATEWAY,   ["gateway", "run"]);
    const r2 = spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
    return new Response(JSON.stringify({ gateway: r1, dashboard: r2 }), { headers: jsonHeaders() });
  }

  // Dashboard 独立启停
  if (path === "/api/dashboard/start" && req.method === "POST") {
    const r = spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
    return new Response(JSON.stringify({ dashboard: r }), { headers: jsonHeaders() });
  }

  if (path === "/api/dashboard/stop" && req.method === "POST") {
    const dbAlive = readPid(PID_DASHBOARD);
    await stopPid(PID_DASHBOARD);
    // 强制杀掉残留的 dashboard 进程（PID 文件可能已失效）
    try {
      const proc = spawn(["pkill", "-SIGKILL", "-f", "hermes.*dashboard"]);
      await proc.exited;
    } catch {}
    if (dbAlive) log("Dashboard stopped (pid=" + dbAlive + ")");
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  if (path === "/api/logs") {
    const offsetParam = url.searchParams.get("offset");
    const lastOffset = offsetParam !== null ? parseInt(offsetParam, 10) : -1;
    return new Response(createLogStream(req, isNaN(lastOffset) ? -1 : lastOffset), {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": corsOrigin,
      },
    });
  }

  if (path === "/api/logs/history") {
    let lines = [];
    let fileSize = 0;
    try {
      if (existsSync(LOG_FILE)) {
        fileSize = statSync(LOG_FILE).size;
        lines = readFileSync(LOG_FILE, "utf8").split("\n").filter(l => l.trim()).slice(-100);
      }
    } catch {}
    return new Response(JSON.stringify({ lines, fileSize }), { headers: jsonHeaders() });
  }

  // ─── 读取任意日志文件 ────────────────────────────────────────────────
  if (path === "/api/logs/read") {
    const file = url.searchParams.get("file") || "";
    const allowed = [
      "gateway.log","errors.log","agent.log","gui.log",
      "gateway-restart.log","gateway-shutdown-diag.log","gateway-exit-diag.log","hermes.log",
    ];
    if (!allowed.includes(file)) {
      return new Response(JSON.stringify({ error: "disallowed" }), { headers: jsonHeaders() });
    }
    const fp = file === "hermes.log" ? `${VAR_DIR}/${file}` : `${DATA_DIR}/logs/${file}`;
    let lines = [], size = 0;
    try {
      if (existsSync(fp)) {
        size = statSync(fp).size;
        lines = readFileSync(fp, "utf8").split("\n").filter(l => l.trim()).slice(-200);
      }
    } catch {}
    return new Response(JSON.stringify({ lines, size }), { headers: jsonHeaders() });
  }

  // ─── 清空（截断）日志文件 ──────────────────────────────────────────────
  if (path === "/api/logs/clear" && req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    const file = body.file || "hermes.log";
    const allowed = [
      "gateway.log","errors.log","agent.log","gui.log",
      "gateway-restart.log","gateway-shutdown-diag.log","gateway-exit-diag.log","hermes.log",
    ];
    if (!allowed.includes(file)) {
      return new Response(JSON.stringify({ error: "disallowed" }), { headers: jsonHeaders() });
    }
    const fp = file === "hermes.log" ? `${VAR_DIR}/${file}` : `${DATA_DIR}/logs/${file}`;
    try {
      if (existsSync(fp)) writeFileSync(fp, "");
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders() });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  // ─── 聊天：配置 API ──────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────
  // 扩展能力（LightAgent 集成）：toolsets / mcp_servers / skills / persona
  // 统一持久化到 ${VAR_DIR}/extensions.json（控制面板专属，Hermes 不解析，零风险），
  // 并同步写入 Hermes config.yaml 对应段使其真实生效。
  // ───────────────────────────────────────────────────────────────
  function _yamlScalarSafe(val){
    const s = String(val == null ? "" : val);
    const risky = s === "" ||
      /^[\s>|@`"'%#&*!?\[\]{},-]/.test(s) ||
      /\s$/.test(s) ||
      /:(\s|$)/.test(s) ||
      /\s#/.test(s);
    return risky ? JSON.stringify(s) : s;
  }

  // 通用：跳过某个顶层键之下的缩进块与列表项
  function _skipBlock(lines, i){
    while (i < lines.length &&
           (lines[i].startsWith("  ") || lines[i].startsWith("\t") ||
            /^-\s/.test(lines[i])) && lines[i].trim() !== "") {
      i++;
    }
    return i;
  }

  // 替换/新增 config.yaml 顶层「列表」块（如 toolsets:）
  function _setYamlListBlock(content, key, items){
    const block = `${key}:\n` + items.map(it => `  - ${_yamlScalarSafe(it)}`).join("\n");
    const lines = content.split("\n");
    const out = [];
    let i = 0, done = false;
    while (i < lines.length){
      if (!done && lines[i] === key + ":"){
        out.push(block);
        done = true;
        i = _skipBlock(lines, i + 1);
        continue;
      }
      out.push(lines[i]); i++;
    }
    if (!done) out.push(block);
    return out.join("\n");
  }

  // 替换/新增 config.yaml 顶层「映射」块（如 mcp_servers:）
  function _setYamlMapBlock(content, key, obj){
    let block;
    const names = Object.keys(obj);
    if (names.length === 0) {
      block = `${key}: {}`;
    } else {
      block = `${key}:\n`;
      names.forEach(name => {
        block += `  ${_yamlScalarSafe(name)}:\n`;
        const entry = obj[name] || {};
        Object.entries(entry).forEach(([k, v]) => {
          if (Array.isArray(v)){
            block += `    ${k}:\n` + v.map(x => `      - ${_yamlScalarSafe(x)}`).join("\n") + "\n";
          } else if (v !== undefined && v !== null && v !== ""){
            block += `    ${k}: ${_yamlScalarSafe(v)}\n`;
          }
        });
      });
    }
    const lines = content.split("\n");
    const out = [];
    let i = 0, done = false;
    while (i < lines.length){
      if (!done && lines[i] === key + ":"){
        out.push(block);
        done = true;
        i = _skipBlock(lines, i + 1);
        continue;
      }
      out.push(lines[i]); i++;
    }
    if (!done) out.push(block);
    return out.join("\n");
  }

  // 合并 skills.external_dirs（保留 skills 段其它字段）
  function _mergeSkillsExternalDirs(content, dirs){
    const lines = content.split("\n");
    const out = [];
    let i = 0, inSkills = false, replaced = false;
    while (i < lines.length){
      const line = lines[i];
      if (line === "skills:"){ inSkills = true; out.push(line); i++; continue; }
      if (inSkills && !line.startsWith("  ") && line.trim() !== ""){
        if (!replaced){ out.push("  external_dirs:"); dirs.forEach(d => out.push("    - " + _yamlScalarSafe(d))); replaced = true; }
        inSkills = false;
        out.push(line); i++; continue;
      }
      if (inSkills && /^\s*external_dirs:/.test(line)){
        out.push("  external_dirs:");
        dirs.forEach(d => out.push("    - " + _yamlScalarSafe(d)));
        replaced = true;
        i++;
        while (i < lines.length && (lines[i].startsWith("    ") || /^-\s/.test(lines[i]))) i++;
        continue;
      }
      out.push(line); i++;
    }
    if (inSkills && !replaced){ out.push("  external_dirs:"); dirs.forEach(d => out.push("    - " + _yamlScalarSafe(d))); }
    return out.join("\n");
  }

  function _readExtensionsFile(){
    try {
      const p = `${VAR_DIR}/extensions.json`;
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {}
    return null;
  }
  function _writeExtensionsFile(obj){
    try { writeFileSync(`${VAR_DIR}/extensions.json`, JSON.stringify(obj, null, 2)); } catch (e) {}
  }
  // 从 config.yaml 提取某个顶层块的原始文本（用于 GET 推断）
  function _yamlBlockOf(yml, key){
    const m = yml.match(new RegExp("^" + key + ":\\n([\\s\\S]*?)(?=^[a-zA-Z_]+:|\\Z)", "m"));
    return m ? m[1] : "";
  }

  // 写 / 替换 config.yaml 顶层「扁平映射」块（如 memory: 下直接是标量）
  function _setYamlFlatMap(content, key, obj){
    const items = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
    const block = items.length
      ? key + ":\n" + items.map(k => "  " + k + ": " + _yamlScalarSafe(obj[k])).join("\n")
      : key + ": {}";
    const lines = content.split("\n");
    const out = []; let i = 0, done = false;
    while (i < lines.length){
      if (!done && lines[i] === key + ":"){ out.push(block); done = true; i = _skipBlock(lines, i + 1); continue; }
      out.push(lines[i]); i++;
    }
    if (!done) out.push(block);
    return out.join("\n");
  }

  function _expandHome(p){
    if (!p) return p;
    if (p === "~") return (process.env.HOME || process.env.USERPROFILE || "");
    if (p.startsWith("~/")) return (process.env.HOME || process.env.USERPROFILE || "") + p.slice(1);
    return p;
  }
  function _baseName(p){ return (p || "").split("/").filter(Boolean).pop() || ""; }
  function _dirName(p){ const a = (p || "").split("/").filter(Boolean); a.pop(); return "/" + a.join("/"); }
  function _joinPath(a, b){ return (a || "").replace(/\/$/, "") + "/" + (b || "").replace(/^\//, ""); }

  // 解析技能目录中的 SKILL.md frontmatter（name / description / emoji）
  function _readSkillFrontmatter(dir){
    try {
      const skills = [];
      const scan = (d) => {
        const sk = _joinPath(d, "SKILL.md");
        if (existsSync(sk)) skills.push(_parseSkillMd(sk, d));
        try {
          readdirSync(d).forEach(n => {
            const sub = _joinPath(d, n);
            if (_isDir(sub) && existsSync(_joinPath(sub, "SKILL.md"))) skills.push(_parseSkillMd(_joinPath(sub, "SKILL.md"), sub));
          });
        } catch (e) {}
      };
      scan(dir);
      return skills;
    } catch (e){ return []; }
  }
  function _isDir(p){ try { return statSync(p).isDirectory(); } catch (e){ return false; } }
  function _parseSkillMd(file, dir){
    const raw = readFileSync(file, "utf8");
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    let name = _baseName(dir); let description = ""; let emoji = "";
    if (m){
      m[1].split("\n").forEach(l => {
        const mm = l.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (!mm) return;
        const k = mm[1].trim().toLowerCase(); const v = mm[2].trim().replace(/^["']|["']$/g, "");
        if (k === "name") name = v;
        else if (k === "description") description = v;
        else if (k === "emoji") emoji = v;
      });
    }
    return { name, description, emoji, file, dir };
  }

  // 绝对化相对 URL
  function _absUrl(u, base){
    try {
      if (/^(https?:)?\/\//i.test(u) || /^(mailto:|tel:|data:)/i.test(u)) return u;
      const bu = new URL(base);
      if (u.startsWith("//")) return bu.protocol + u;
      if (u.startsWith("/")) return bu.origin + u;
      const dir = bu.pathname.endsWith("/") ? bu.pathname : bu.pathname.replace(/\/[^\/]*$/, "/");
      return bu.origin + dir + u;
    } catch (e){ return u; }
  }

  // 净化远程 HTML 以便内嵌展示（去脚本、去内联事件、重写相对 URL）
  function _sanitizeHtmlForEmbed(html, base){
    let out = html;
    out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
    out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    out = out.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
    out = out.replace(/(<(?:a|link|img|source|iframe)\b[^>]*\b)(href|src|data-src)\s*=\s*("|')([^"']*)\3/gi,
      (m, pre, attr, q, val) => {
        if (/^(javascript:|data:)/i.test(val)) return m;
        return pre + attr + "=" + q + _absUrl(val, base) + q;
      });
    out = out.replace(/\s(on\w+)\s*=\s*("|')(?:[^"']*)\2/gi, "");
    out = out.replace(/\s(on\w+)\s*=\s*[^\s>]+/gi, "");
    return out;
  }

  // 从远程 HTML 中提取技能 / 专家包链接
  function _extractSkillLinks(html, base, type){
    const items = []; const seen = {};
    const re = /<a\b[^>]*\bhref\s*=\s*("|')([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null){
      const href = m[2];
      const text = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!/(\/skills?\/|\/skillspackage|\/skill-package|\/skill\/)/i.test(href)) continue;
      const abs = _absUrl(href, base);
      if (seen[abs]) continue;
      seen[abs] = true;
      let title = text || _baseName(abs.split("?")[0]);
      title = title.replace(/\.html?$/i, "");
      items.push({ title: title.slice(0, 80), url: abs, type: type || "skill" });
    }
    return items;
  }

  if (path === "/api/config" && req.method === "GET") {
    // ── 读取 providers-state.yaml（控制面板专属配置文件）────────────
    const statePath = `${VAR_DIR}/providers-state.yaml`;
    let ymlProviders = [];
    let activeProvName = "";
    let activeModel = "";
    let provModelMap = {}; // { "minimax-cn": "MiniMax-M2.7", ... }

    try {
      // 读取 Hermes config.yaml 获取当前 active provider
      const yamlPath = `${DATA_DIR}/config.yaml`;
      let provId = "";
      if (existsSync(yamlPath)) {
        const yml = readFileSync(yamlPath, "utf8");
        const provMatch = yml.match(/^model:\s*\n\s+provider:\s*(\S+)/m);
        const modelMatch = yml.match(/^model:\s*\n\s+default:\s*(\S+)/m);
        provId = provMatch ? provMatch[1] : "";
        activeModel = modelMatch ? modelMatch[1] : "";
      }

      // 读取控制面板专属 .env.providers 获取 API keys
      const envApiKeys = {};
      try {
        const envProvPath = `${VAR_DIR}/.env.providers`;
        // 迁移：如果 .env.providers 不存在但 Hermes .env 有 key，先迁移
        if (!existsSync(envProvPath) && existsSync(`${DATA_DIR}/.env`)) {
          const legacyEnv = readFileSync(`${DATA_DIR}/.env`, "utf8");
          const legacyKeys = {};
          Object.keys(PROVIDER_API_KEYS).forEach(id => {
            const envKey = PROVIDER_API_KEYS[id];
            const m = legacyEnv.match(new RegExp(`^${envKey}=(.*)$`, "m"));
            if (m && m[1].length > 0) legacyKeys[envKey] = m[1];
          });
          const customRe2 = /^CUSTOM_(?:PROVIDER_)?([A-Z0-9_]+)_API_KEY=(.+)$/gm;
          let cm2;
          while ((cm2 = customRe2.exec(legacyEnv)) !== null) {
            legacyKeys[`CUSTOM_${cm2[1]}_API_KEY`] = cm2[2];
          }
          if (Object.keys(legacyKeys).length > 0) {
            writeFileSync(envProvPath,
              Object.entries(legacyKeys).map(([k,v]) => `${k}=${v}`).join("\n") + "\n");
          }
        }
        if (existsSync(envProvPath)) {
          const envContent = readFileSync(envProvPath, "utf8");
          Object.keys(PROVIDER_API_KEYS).forEach(id => {
            const envKey = PROVIDER_API_KEYS[id];
            const m = envContent.match(new RegExp(`^${envKey}=(.*)$`, "m"));
            if (m && m[1].length > 0) envApiKeys[id] = m[1];
          });
          const customRe = /^CUSTOM_(?:PROVIDER_)?([A-Z0-9_]+)_API_KEY=(.+)$/gm;
          let cm;
          while ((cm = customRe.exec(envContent)) !== null) {
            const customId = "custom-" + cm[1].toLowerCase().replace(/_/g, "-");
            if (!envApiKeys[customId]) envApiKeys[customId] = cm[2];
          }
        }
      } catch (e) {}

      if (existsSync(statePath)) {
        const stateYaml = readFileSync(statePath, "utf8");
        // 解析格式: providers:\n  id:\n    model: xxx\n    base_url: yyy\n    name: "zzz"
        const blockMatch = stateYaml.match(/^providers:\n([\s\S]*)$/m);
        if (blockMatch) {
          const lines = blockMatch[1].split("\n");
          let currentId = null, currentModel = "", currentBaseUrl = "", currentName = "";
          lines.forEach(line => {
            const keyMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
            if (keyMatch) {
              // 保存上一个
              if (currentId && currentModel) {
                provModelMap[currentId] = { model: currentModel, base_url: currentBaseUrl || "", name: currentName || "" };
              }
              currentId = keyMatch[1]; currentModel = ""; currentBaseUrl = ""; currentName = "";
              return;
            }
            const m = line.match(/^    model:\s*(.+)\s*$/);
            if (m && currentId) { currentModel = m[1].trim(); return; }
            const b = line.match(/^    base_url:\s*(.+)\s*$/);
            if (b && currentId) { currentBaseUrl = b[1].trim(); return; }
            const n = line.match(/^    name:\s*(.+)\s*$/);
            if (n && currentId) { try { currentName = JSON.parse(n[1].trim()); } catch { currentName = n[1].trim(); } }
          });
          if (currentId && currentModel) {
            provModelMap[currentId] = { model: currentModel, base_url: currentBaseUrl || "", name: currentName || "" };
          }
        }
      }

      // ── 迁移：providers-state.yaml 为空时，从 .env.providers 反推 ───
      if (Object.keys(provModelMap).length === 0) {
        Object.keys(envApiKeys).forEach(id => {
          const preset = PROVIDER_PRESETS[id];
          const defaults = PROVIDER_MODELS[id];
          const model = (defaults && defaults.length > 0) ? defaults[0] : "auto";
          provModelMap[id] = { model, base_url: preset ? preset.base_url : "" };
        });
      }

      // ── 构建返回的 provider 列表 ────────────────────────────────────
      Object.entries(provModelMap).forEach(([id, info]) => {
        const preset = PROVIDER_PRESETS[id];
        const isCustom = !preset;
        const savedName = (typeof info === "object" && info.name) ? info.name.trim() : "";
        const name = savedName || (preset ? `${preset.name} (${id})` : id);
        const model = (typeof info === "string") ? info : (info.model || "");
        const baseUrl = (typeof info === "string") ? "" : (info.base_url || "");
        const maskedKey = envApiKeys[id]
          ? "****" + String(envApiKeys[id]).slice(-4)
          : "";
        if (id === provId) activeProvName = name;
        ymlProviders.push({
          id,
          name,
          type: "openai-compatible",
          base_url: preset ? preset.base_url : baseUrl,
          model,
          temperature: 0.7,
          max_tokens: 4096,
          api_key_masked: maskedKey,
          api_key_configured: !!envApiKeys[id],
          is_custom: isCustom,
        });
      });
    } catch (e) { /* 非致命错误 */ }

    // 首次安装无 config.yaml 时，注入默认 Hermes Gateway，避免前端 POST 时 active_provider 为空导致 400
    if (ymlProviders.length === 0) {
      const hermesName = "Hermes Gateway";
      ymlProviders.push({
        id: "hermes",
        name: hermesName,
        type: "openai-compatible",
        base_url: "LOCAL",
        model: "auto",
        temperature: 0.7,
        max_tokens: 4096,
        api_key_masked: "",
        api_key_configured: false,
        is_custom: false,
      });
      if (!activeProvName) activeProvName = hermesName;
    }

    // 过滤掉内部 Hermes Gateway provider，不返回给前端
    var visibleProviders = ymlProviders.filter(function(p) { return p.id !== "hermes" && p.base_url !== "LOCAL"; });
    if (visibleProviders.length === 0 && activeProvName === "Hermes Gateway") {
      activeProvName = "";
    }

    // 构建前端配置结构
    const safe = {
      providers: visibleProviders,
      active_provider: activeProvName,
      fallback_providers: [],
      _version: CONFIG_VERSION,
      presets: Object.keys(PROVIDER_PRESETS).map(id => ({
        id,
        name: PROVIDER_PRESETS[id].name,
        base_url: PROVIDER_PRESETS[id].base_url,
      })),
      provider_models: PROVIDER_MODELS,
      provider_classes: PROVIDER_CLASSES,
    };

    // ── 扩展能力（LightAgent 集成）：优先读 extensions.json，否则从 config.yaml 推断 ──
    try {
      let ext = _readExtensionsFile();
      if (!ext) {
        ext = { toolsets: {}, mcp_servers: [], skills_dirs: [], persona: "default", memory: { enabled: true, char_limit: 2200 } };
        const yamlPath = `${DATA_DIR}/config.yaml`;
        if (existsSync(yamlPath)) {
          const yml = readFileSync(yamlPath, "utf8");
          const KNOWN_TS = ["code_execution","terminal","file","web","browser","vision","memory","todo","skills","clarify","delegation"];
          const tsBlock = _yamlBlockOf(yml, "toolsets");
          tsBlock.split("\n").forEach(l => {
            const m = l.match(/^[ \t]*-[ \t]*(.+)$/);
            if (m) { const n = m[1].trim(); if (KNOWN_TS.includes(n)) ext.toolsets[n] = true; }
          });
          const mcpBlock = _yamlBlockOf(yml, "mcp_servers");
          const mre = /^[ \t]*([A-Za-z0-9_-]+):\n([\s\S]*?)(?=^[ \t]*[A-Za-z0-9_-]+:|\Z)/g;
          let mm;
          while ((mm = mre.exec(mcpBlock)) !== null) {
            const name = mm[1];
            const body = mm[2];
            const entry = { name };
            const kv = /^[ \t]*([a-zA-Z_]+):[ \t]*(.+?)\s*$/gm; let kk;
            while ((kk = kv.exec(body)) !== null) entry[kk[1]] = kk[2].trim();
            ext.mcp_servers.push(entry);
          }
          const skBlock = _yamlBlockOf(yml, "skills");
          const ed = skBlock.match(/external_dirs:\n([\s\S]*?)(?=^[ \t]*[a-zA-Z_]+:|\Z)/);
          if (ed) ed[1].split("\n").forEach(l => {
            const m = l.match(/^[ \t]*-[ \t]*(.+)$/); if (m) ext.skills_dirs.push(m[1].trim());
          });
          // memory 段
          const memBlock = _yamlBlockOf(yml, "memory");
          const memEnabled = memBlock.match(/memory_enabled:\s*(.+)/);
          const memLimit = memBlock.match(/memory_char_limit:\s*(.+)/);
          ext.memory = {
            enabled: memEnabled ? /^(true|1|yes|on)$/i.test(memEnabled[1].trim()) : true,
            char_limit: memLimit ? (parseInt(memLimit[1].trim(), 10) || 2200) : 2200,
          };
        }
      }
      if (!ext.memory) ext.memory = { enabled: true, char_limit: 2200 };
      safe.extensions = ext;
    } catch (e) {
      safe.extensions = { toolsets: {}, mcp_servers: [], skills_dirs: [], persona: "default" };
    }

    return new Response(JSON.stringify(safe), { headers: jsonHeaders() });
  }

  // ── 本地已安装技能枚举 ──
  if (path === "/api/extensions/skills/local" && req.method === "GET") {
    try {
      const ext = _readExtensionsFile() || {};
      const dirs = (ext.skills_dirs || []).map(_expandHome).filter(Boolean);
      const skills = [];
      dirs.forEach(d => { if (_isDir(d)) _readSkillFrontmatter(d).forEach(s => skills.push({ name: s.name, description: s.description, emoji: s.emoji, dir: s.dir, file: s.file })); });
      return new Response(JSON.stringify({ ok: true, skills, dirs }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 远程技能页（nousresearch 文档 / SkillHub）──
  if (path === "/api/extensions/skills/remote" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const target = u.searchParams.get("url");
      const mode = u.searchParams.get("mode") || "embed";
      if (!target) return new Response(JSON.stringify({ ok: false, error: "missing url" }), { status: 400, headers: jsonHeaders() });
      const r = await fetch(target, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HermesDashboard/1.0)", "Accept": "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(15000),
      });
      const html = await r.text();
      if (mode === "list") {
        const type = u.searchParams.get("type") || "skill";
        const items = _extractSkillLinks(html, target, type);
        return new Response(JSON.stringify({
          ok: true, url: target, items,
          note: items.length ? "" : "该页面为客户端渲染(SPA)，服务端未返回技能列表；请使用「打开原站」查看完整内容，或稍后在原站复制 SKILL.md 后通过「本地已安装」目录加载。",
        }), { headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, url: target, html: _sanitizeHtmlForEmbed(html, target) }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }

  // ── 安装远程技能（best-effort：尝试从页面提取 SKILL.md）──
  if (path === "/api/extensions/skills/install" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const url = body.url;
      if (!url) return new Response(JSON.stringify({ ok: false, error: "missing url" }), { status: 400, headers: jsonHeaders() });
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,text/markdown,*/*" }, signal: AbortSignal.timeout(20000) });
      const content = await r.text();
      let md = null;
      if (/^---\s*\n/.test(content)) md = content;
      else {
        const m = content.match(/(?:href|src)\s*=\s*["']([^"']+\.md)["']/i) || content.match(/(https?:\/\/[^\s"'<>]+\.md\b)/i);
        if (m) { const mdUrl = m[1]; const r2 = await fetch(_absUrl(mdUrl, url), { signal: AbortSignal.timeout(20000) }); md = await r2.text(); }
      }
      if (!md) return new Response(JSON.stringify({ ok: false, error: "未能从该页面提取 SKILL.md 内容（请确认链接指向技能详情页）" }), { status: 422, headers: jsonHeaders() });
      const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
      let name = body.name || (fm ? (fm[1].match(/name:\s*(.+)/i) || [])[1] : "") || "";
      name = (name || "skill-" + Date.now()).trim().replace(/^["']|["']$/g, "").replace(/[^\w.-]/g, "_");
      const destDir = `${VAR_DIR}/skills/${name}`;
      mkdirSync(destDir, { recursive: true });
      writeFileSync(`${destDir}/SKILL.md`, md);
      const ext = _readExtensionsFile() || { toolsets: {}, mcp_servers: [], skills_dirs: [], persona: "default", memory: { enabled: true, char_limit: 2200 } };
      ext.skills_dirs = ext.skills_dirs || [];
      if (!ext.skills_dirs.includes(destDir)) ext.skills_dirs.push(destDir);
      _writeExtensionsFile(ext);
      const yamlPath = `${DATA_DIR}/config.yaml`;
      if (existsSync(yamlPath)) { let y = readFileSync(yamlPath, "utf8"); y = _mergeSkillsExternalDirs(y, ext.skills_dirs); writeFileSync(yamlPath, y); }
      return new Response(JSON.stringify({ ok: true, name, dir: destDir }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // /api/config POST: 写入 providers-state.yaml + .env.providers（设为默认时同步到 Hermes .env）
  if (path === "/api/config" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "invalid JSON body" }), { status: 400, headers: jsonHeaders() });
      }

      // ── 找到 active provider ─────────────────────────────────────────────────
      const activeProv = (body.providers || []).find(p =>
        p.name === body.active_provider
      );
      if (!activeProv || !activeProv.id) {
        return new Response(JSON.stringify({ ok: false, error: "no active provider" }), { status: 400, headers: jsonHeaders() });
      }
      const providerId = String(activeProv.id).trim();

      // ── 收集所有 provider 的模型 + base_url + 自定义名称 ────────────────────────
      const allProvConfig = {};
      // 先读现有的 providers-state.yaml（保留未编辑的 provider）
      const statePath = `${VAR_DIR}/providers-state.yaml`;
      try {
        if (existsSync(statePath)) {
          const stateYaml = readFileSync(statePath, "utf8");
          const blockMatch = stateYaml.match(/^providers:\n([\s\S]*)$/m);
          if (blockMatch) {
            const lines = blockMatch[1].split("\n");
            let curId = null, curModel = "", curBase = "", curName = "";
            lines.forEach(line => {
              const km = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
              if (km) {
                if (curId && curModel) allProvConfig[curId] = { model: curModel, base_url: curBase, name: curName };
                curId = km[1]; curModel = ""; curBase = ""; curName = "";
                return;
              }
              const mm = line.match(/^    model:\s*(.+)\s*$/);
              if (mm && curId) { curModel = mm[1].trim(); return; }
              const bm = line.match(/^    base_url:\s*(.+)\s*$/);
              if (bm && curId) { curBase = bm[1].trim(); return; }
              const nm = line.match(/^    name:\s*(.+)\s*$/);
              if (nm && curId) { try { curName = JSON.parse(nm[1].trim()); } catch { curName = nm[1].trim(); } }
            });
            if (curId && curModel) allProvConfig[curId] = { model: curModel, base_url: curBase, name: curName };
          }
        }
      } catch (e) {}

      // 合并 body.providers 的数据（前端传来的优先，包括自定义名称 name）
      (body.providers || []).forEach(p => {
        if (!p.id) return;
        let model = p.model;
        if (!model || model === "auto") {
          const defaults = PROVIDER_MODELS[p.id];
          model = (defaults && defaults.length > 0) ? defaults[0] : "auto";
        }
        const existingEntry = allProvConfig[p.id];
        const incomingName = (p.name && String(p.name).trim()) || "";
        // base_url：A 类内置商强制存 PROVIDER_PRESETS 默认 URL（编辑框只读，地址由 Hermes 管理），
        // B 类/custom 存用户填写值；确保 providers-state.yaml 对所有商都保存完整 URL 供编辑框回显。iranee
        let baseUrl;
        if (PROVIDER_CLASSES[p.id] === "A" && PROVIDER_PRESETS[p.id]) {
          baseUrl = PROVIDER_PRESETS[p.id].base_url || "";
        } else {
          baseUrl = p.base_url || existingEntry?.base_url || "";
          // 内置预设兜底：用户未填时回填默认 URL
          if (!baseUrl && PROVIDER_PRESETS[p.id]) baseUrl = PROVIDER_PRESETS[p.id].base_url || "";
        }
        allProvConfig[p.id] = {
          model,
          base_url: baseUrl,
          name: incomingName || existingEntry?.name || "",
        };
      });

      // 白名单过滤：前端提交的 providers 列表为完整列表，删除 allProvConfig 中已不存在的条目
      if (body.providers) {
        const validIds = new Set(body.providers.map(p => p.id).filter(Boolean));
        Object.keys(allProvConfig).forEach(id => {
          if (!validIds.has(id)) delete allProvConfig[id];
        });
      }

      // ── 写入 providers-state.yaml ───────────────────────────────────────────
      try {
        const stateLines = Object.entries(allProvConfig)
          .sort(([a], [b]) => {
            // active provider 排第一，其余按 id 字母排序
            if (a === providerId) return -1;
            if (b === providerId) return 1;
            return a.localeCompare(b);
          })
          .map(([id, cfg]) => {
            let entry = `  ${id}:\n    model: ${cfg.model}`;
            if (cfg.base_url) entry += `\n    base_url: ${cfg.base_url}`;
            if (cfg.name) entry += `\n    name: ${JSON.stringify(cfg.name)}`;
            return entry;
          })
          .join("\n");
        const stateContent = `providers:\n${stateLines}\n`;
        writeFileSync(statePath, stateContent);
      } catch (e) {
        // 非致命错误
      }

      // ── 同步 model section + 自定义 provider 到 Hermes config.yaml ───────────
      const resolvedModel = allProvConfig[providerId]?.model || "auto";
      const yamlPath = `${DATA_DIR}/config.yaml`;

      // YAML 标量安全序列化：含 YAML 特殊字符时加引号，否则保持 plain（匹配 Hermes 文档格式）
      const yamlScalar = (val) => {
        const s = String(val == null ? "" : val);
        const risky = s === "" ||
          /^[\s>|@`"'%#&*!?\[\]{},-]/.test(s) ||   // 危险起始字符
          /\s$/.test(s) ||                          // 结尾空白
          /:(\s|$)/.test(s) ||                      // 冒号后接空格/行尾
          /\s#/.test(s);                            // 空格+井号（YAML 行内注释）
        return risky ? JSON.stringify(s) : s;
      };

      // ── 构建 providers: 段（A/B 分类，详见 provider-config.js 的 PROVIDER_CLASSES）iranee ──
      //   A 类内置商仅写 model 段，端点与原生协议交给 Hermes 内置 PROVIDER_REGISTRY；
      //   B 类内置商（siliconflow / mistral / ollama-cloud）与所有非预设 custom-* 必须写 providers 段。
      const customEntries = Object.entries(allProvConfig)
        .sort(([a], [b]) => {
          if (a === providerId) return -1;
          if (b === providerId) return 1;
          return a.localeCompare(b);
        })
        .filter(([id]) => !PROVIDER_PRESETS[id] || PROVIDER_CLASSES[id] === "B")
        .map(([id, pcfg]) => {
          const baseUrl = String(pcfg.base_url || "").trim();
          if (!baseUrl) {
            log(`跳过 provider "${id}"：缺少 base_url，未写入 config.yaml providers 段`);
            return null;
          }
          // 本地模型（local-* 动态 id）：本地 OpenAI 兼容服务无需鉴权，
          // 仅写 base_url + default_model，完全省略 api_key（Hermes config.py 支持缺省，
          // runtime_provider.py 会自动兜底 "no-key-required" 占位）。iranee
          if (String(id).indexOf("local-") === 0) {
            return `  ${id}:\n` +
                   `    base_url: ${yamlScalar(baseUrl)}\n` +
                   `    default_model: ${yamlScalar(pcfg.model || "auto")}`;
          }
          // env 名：B 类预设用 PROVIDER_API_KEYS[id]，custom-* 用 customEnvKey(id)
          const envVar = PROVIDER_API_KEYS[id] || customEnvKey(id);
          // 用户实机验证格式：base_url + api_key（${ENV} 插值）+ default_model，省略 api_mode
          return `  ${id}:\n` +
                 `    base_url: ${yamlScalar(baseUrl)}\n` +
                 `    api_key: \${${envVar}}\n` +
                 `    default_model: ${yamlScalar(pcfg.model || "auto")}`;
        })
        .filter(Boolean);
      const providersBlock = customEntries.length > 0 ? `providers:\n${customEntries.join("\n")}\n` : "";

      try {
        let ymlContent = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : "";
        // model.provider 经 PROVIDER_HERMES_IDS 映射（openai → openai-api，其余用自身 id）
        const hermesProvider = PROVIDER_HERMES_IDS[providerId] || providerId;
        const newModel = `model:\n  provider: ${hermesProvider}\n  default: ${resolvedModel}\n`;
        const modelRegex = /^model:[\t ]*\n(?:[\t ]+[^\n]*\n)*/m;
        if (ymlContent.match(modelRegex)) {
          ymlContent = ymlContent.replace(modelRegex, newModel);
        } else {
          ymlContent = newModel + "\n" + ymlContent;
        }

        // 同步 providers: 段——兼容模板里的 `providers: {}` 空映射与已存在的多行块两种形态，
        // 避免产生重复的 providers 顶层键。无 B/custom 条目时整段省略 providers 节，
        // A 类 active 且无自定义商时 config.yaml 只保留 model 段（贴合用户实机验证格式）。iranee
        const _NL = String.fromCharCode(10);
        const _TAB = String.fromCharCode(9);
        const _yl = ymlContent.split(_NL);
        let _ps = -1;
        for (let _i = 0; _i < _yl.length; _i++) {
          if (_yl[_i].indexOf("providers:") === 0) { _ps = _i; break; }
        }
        if (_ps >= 0) {
          let _pe = _ps + 1;
          while (_pe < _yl.length && (_yl[_pe].startsWith(" ") || _yl[_pe].startsWith(_TAB))) _pe++;
          const _before = _yl.slice(0, _ps).join(_NL);
          const _after = _yl.slice(_pe).join(_NL);
          if (providersBlock) {
            ymlContent = (_before ? _before + _NL : "") + providersBlock + _after;
          } else {
            // 无 B/custom 条目：纯删除原 providers 段，仅拼接 _before + _after
            ymlContent = _before + (_after ? _NL + _after : _NL);
          }
        } else if (providersBlock) {
          // 将 providers 段插入 model 段正下方（而非追加到文件末尾）
          const _modelBlockRe = /(^model:[\t ]*\n(?:[\t ]+[^\n]*\n)*)/m;
          const _modelMatch = ymlContent.match(_modelBlockRe);
          if (_modelMatch) {
            const _insertPos = _modelMatch.index + _modelMatch[0].length;
            ymlContent = ymlContent.slice(0, _insertPos) + providersBlock + ymlContent.slice(_insertPos);
          } else {
            // model 段也不存在时，退化为插到文件开头
            ymlContent = providersBlock + ymlContent;
          }
        }

        writeFileSync(yamlPath, ymlContent);
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: "write config.yaml: " + e.message }), { status: 500, headers: jsonHeaders() });
      }

      // ── 扩展能力（LightAgent 集成）：toolsets / mcp_servers / skills / persona ──
      if (body.extensions && typeof body.extensions === "object") {
        try {
          _writeExtensionsFile(body.extensions);
          const yamlPath2 = `${DATA_DIR}/config.yaml`;
          if (existsSync(yamlPath2)) {
            let y2 = readFileSync(yamlPath2, "utf8");
            // toolsets：基础 hermes-cli 必留，叠加用户开启项
            const BASE_TS = ["hermes-cli"];
            const TOGGLE_TS = ["code_execution","terminal","file","web","browser","vision","memory","todo","skills","clarify","delegation"];
            const enabledTs = BASE_TS.slice();
            const tsMap = body.extensions.toolsets || {};
            TOGGLE_TS.forEach(n => { if (tsMap[n]) enabledTs.push(n); });
            y2 = _setYamlListBlock(y2, "toolsets", enabledTs);
            // mcp_servers
            const mcpObj = {};
            (body.extensions.mcp_servers || []).forEach(s => {
              if (!s || !s.name) return;
              const entry = {};
              if (s.mode === "stdio") {
                if (s.command) entry.command = s.command;
                if (s.args && s.args.length) entry.args = s.args;
              } else {
                if (s.url) entry.url = s.url;
                entry.transport = s.transport || "http";
              }
              if (s.env && Object.keys(s.env).length) entry.env = s.env;
              mcpObj[s.name] = entry;
            });
            y2 = _setYamlMapBlock(y2, "mcp_servers", mcpObj);
            // skills.external_dirs
            y2 = _mergeSkillsExternalDirs(y2, body.extensions.skills_dirs || []);
            // memory 段
            if (body.extensions.memory && typeof body.extensions.memory === "object") {
              y2 = _setYamlFlatMap(y2, "memory", {
                memory_enabled: body.extensions.memory.enabled ? true : false,
                memory_char_limit: parseInt(body.extensions.memory.char_limit, 10) || 2200,
              });
            }
            writeFileSync(yamlPath2, y2);
          }
        } catch (e) {
          log("extensions/config.yaml write failed: " + e.message);
        }
      }

      // ── 保存 API key 到控制面板专属 .env.providers ────────────────────
      const envUpdates = [];
      (body.providers || []).forEach(p => {
        if (!p.id) return;
        // 本地模型（local-*）无需 API Key，跳过任何环境变量写入
        if (String(p.id).indexOf("local-") === 0) return;
        let envKey = PROVIDER_API_KEYS[p.id];
        if (!envKey) {
          envKey = customEnvKey(p.id);
        }
        let rawKey = null;
        if (p._raw_api_key && !String(p._raw_api_key).startsWith('****')) {
          rawKey = p._raw_api_key;
        } else if (p.api_key && !String(p.api_key).startsWith('****') && p.api_key !== 'none') {
          rawKey = p.api_key;
        }
        if (rawKey && rawKey.length > 0) {
          envUpdates.push({ key: envKey, value: rawKey });
        }
      });
      if (envUpdates.length > 0) {
        try {
          const envProvPath = `${VAR_DIR}/.env.providers`;
          let envContent = existsSync(envProvPath) ? readFileSync(envProvPath, "utf8") : "";
          envUpdates.forEach(({ key, value }) => {
            const envRegex = new RegExp(`^${key}=.*$`, "m");
            if (envRegex.test(envContent)) {
              envContent = envContent.replace(envRegex, `${key}=${value}`);
            } else {
              envContent += `${key}=${value}\n`;
            }
          });
          writeFileSync(envProvPath, envContent);
        } catch (e) { /* 非致命错误 */ }
      }

      // ── 一次性迁移 .env.providers 旧格式 CUSTOM_PROVIDER_* → CUSTOM_* ──
      try {
        const _migPath = `${VAR_DIR}/.env.providers`;
        if (existsSync(_migPath)) {
          let _migContent = readFileSync(_migPath, "utf8");
          const _migRe = /^CUSTOM_PROVIDER_([A-Z0-9_]+_API_KEY)=(.+)$/gm;
          let _migM;
          let _migDirty = false;
          while ((_migM = _migRe.exec(_migContent)) !== null) {
            const _nk = `CUSTOM_${_migM[1]}`;
            if (!new RegExp(`^${_nk}=`, "m").test(_migContent)) {
              _migContent += `${_nk}=${_migM[2]}\n`;
            }
            _migDirty = true;
          }
          if (_migDirty) {
            _migContent = _migContent.split("\n").filter(l => !/^CUSTOM_PROVIDER_[A-Z0-9_]+_API_KEY=/.test(l)).join("\n");
            writeFileSync(_migPath, _migContent);
          }
        }
      } catch {}

      // ── 设为默认时，同步 active provider 的 key 到 Hermes .env ──
      try {
        const hermesEnvPath = `${DATA_DIR}/.env`;
        let hermesEnv = existsSync(hermesEnvPath) ? readFileSync(hermesEnvPath, "utf8") : "";
        // 从 envUpdates（或已有的 .env.providers）中找到 active provider 的 key
        Object.keys(PROVIDER_API_KEYS).forEach(id => {
          if (id !== providerId) return;
          const envKey = PROVIDER_API_KEYS[id];
          // 从 .env.providers 读取真实 key
          const envProvPath = `${VAR_DIR}/.env.providers`;
          if (existsSync(envProvPath)) {
            const provEnv = readFileSync(envProvPath, "utf8");
            const m = provEnv.match(new RegExp(`^${envKey}=(.*)$`, "m"));
            if (m && m[1].length > 0) {
              const hermesRegex = new RegExp(`^${envKey}=.*$`, "m");
              if (hermesRegex.test(hermesEnv)) {
                hermesEnv = hermesEnv.replace(hermesRegex, `${envKey}=${m[1]}`);
              } else {
                hermesEnv += `\n${envKey}=${m[1]}\n`;
              }
            }
          }
        });
        // 同时检查自定义 provider
        const _cKey = customEnvKey(providerId);
        if (!PROVIDER_API_KEYS[providerId]) {
          const envProvPath2 = `${VAR_DIR}/.env.providers`;
          if (existsSync(envProvPath2)) {
            const provEnv2 = readFileSync(envProvPath2, "utf8");
            let m2 = provEnv2.match(new RegExp(`^${_cKey}=(.*)$`, "m"));
            // 兼容旧名
            if (!m2) m2 = provEnv2.match(new RegExp(`^${legacyCustomEnvKey(providerId)}=(.*)$`, "m"));
            if (m2 && m2[1].length > 0) {
              const hermesRegex2 = new RegExp(`^${_cKey}=.*$`, "m");
              if (hermesRegex2.test(hermesEnv)) {
                hermesEnv = hermesEnv.replace(hermesRegex2, `${_cKey}=${m2[1]}`);
              } else {
                hermesEnv += `\n${_cKey}=${m2[1]}\n`;
              }
            }
          }
        }
        // 清理 Hermes .env 中旧格式 CUSTOM_PROVIDER_* 行
        hermesEnv = hermesEnv.split("\n").filter(l => !/^CUSTOM_PROVIDER_[A-Z0-9_]+_API_KEY=/.test(l)).join("\n");
        writeFileSync(hermesEnvPath, hermesEnv);
      } catch (e) { /* 非致命错误 */ }

      // ── 删除已移除 provider 的 .env.providers key ─────────────────────
      try {
        const envProvPath = `${VAR_DIR}/.env.providers`;
        if (existsSync(envProvPath)) {
          const envContent = readFileSync(envProvPath, "utf8");
          const keepKeys = new Set();
          (body.providers || []).forEach(p => {
            if (!p.id) return;
            const k = PROVIDER_API_KEYS[p.id] || customEnvKey(p.id);
            keepKeys.add(k);
          });
          const lines = envContent.split("\n");
          const filtered = lines.filter(line => {
            const m = line.match(/^([A-Z_][A-Z0-9_]*API_KEY|.+_API_KEY)=/);
            if (!m) return true;
            return keepKeys.has(m[1]);
          });
          if (filtered.join("\n") !== envContent) {
            writeFileSync(envProvPath, filtered.join("\n"));
          }
        }
      } catch (e) { /* 非致命错误 */ }

      // ── 同步 chat/config.json（保持向后兼容）────────────────────────────────
      try {
        const chatCfg = getChatConfig();
        chatCfg.active_provider = activeProv.name;
        if (!chatCfg.providers.find(p => p.id === activeProv.id)) {
          chatCfg.providers.unshift(activeProv);
        }
        saveChatConfig(chatCfg);
      } catch {}

      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }

  // ─── 主模型 API（读写 config.yaml 中的 model.provider + model.default） ──
  if (path === "/api/config/primary-model" && req.method === "GET") {
    const yamlPath = `${DATA_DIR}/config.yaml`;
    let provider = "", model = "", providers = [];
    try {
      if (existsSync(yamlPath)) {
        const yml = readFileSync(yamlPath, "utf8");
        const provMatch = yml.match(/^model:[\s\S]*?\n\s+provider:\s*(\S+)/m);
        const modelMatch = yml.match(/^model:[\s\S]*?\n\s+default:\s*(\S+)/m);
        provider = provMatch ? provMatch[1] : "";
        model    = modelMatch ? modelMatch[1] : "";

        // 从 config.yaml 提取所有 provider（支持 inline {} 与多行两种格式）
        // Inline 格式：providers: {minimax-cn: '****14fa', deepseek: '****f32e'}
        // 使用能识别 key 的正则：以 "word:" 作为 key 边界
        const inlinMatch = yml.match(/^providers:\s*\{(.+?)\}\s*$/m);
        if (inlinMatch) {
          const raw = inlinMatch[1];
          // 在词+冒号序列（key 边界）之前的 ", " 处分割
          const parts = raw.split(/, (?=\w+:)/);
          parts.forEach(p => {
            const colonIdx = p.indexOf(':');
            if (colonIdx > 0) {
              const k = p.slice(0, colonIdx).trim().replace(/['"]/g, '');
              const v = p.slice(colonIdx + 1).trim().replace(/['"]/g, '');
              const preset = PROVIDER_PRESETS[k];
              const name = preset ? `${preset.name} (${k})` : k;
              providers.push({ id: k, name, base_url: preset ? preset.base_url : "" });
            }
          });
        } else {
          // 多行格式：providers:\n  key: val\n  key: val
          const multiMatch = yml.match(/^providers:\s*\n((?:  \S.*\n?)*)/m);
          if (multiMatch) {
            const lines = multiMatch[1].split("\n").filter(l => l.trim());
            lines.forEach(line => {
              const [k, v] = line.split(":").map(s => s.trim());
              if (k && v) {
                const preset = PROVIDER_PRESETS[k];
                const name = preset ? `${preset.name} (${k})` : k;
                providers.push({ id: k, name, base_url: preset ? preset.base_url : "" });
              }
            });
          }
        }
      }
    } catch {}
    return new Response(JSON.stringify({ provider, model, providers }), { headers: jsonHeaders() });
  }

  if (path === "/api/config/primary-model" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const yamlPath = `${DATA_DIR}/config.yaml`;
    let ymlContent = "";
    try {
      if (existsSync(yamlPath)) ymlContent = readFileSync(yamlPath, "utf8");
    } catch {}
    const newModelSection = `model:\n  provider: ${body.provider || ""}\n  default: ${body.model || ""}\n`;
    if (ymlContent.match(/^model:/m)) {
      ymlContent = ymlContent.replace(/^model:[\s\S]*?^(?=\S)/m, newModelSection);
    } else {
      ymlContent = newModelSection + ymlContent;
    }
    try {
      writeFileSync(yamlPath, ymlContent);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  if (path === "/api/config/test" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    let provider = body.provider || getActiveProvider();
    // 始终从 .env 解析真实 API Key（body.provider 的 key 可能被掩码或为空）
    if (!provider.api_key || provider.api_key.startsWith("****") || provider.api_key === "****keep****") {
      const realKey = resolveRealApiKey(provider);
      if (realKey) provider.api_key = realKey;
    }
    const result = await fetchGatewayModels(provider);
    return new Response(JSON.stringify(result), { headers: jsonHeaders() });
  }

  // ─── 聊天：模型 API ──────────────────────────────────────────────────────
  if (path === "/api/models" && req.method === "GET") {
    const provider = getActiveProvider();
    const result = await fetchGatewayModels(provider);
    return new Response(JSON.stringify(result), { headers: jsonHeaders() });
  }

  // ─── 聊天：会话 API ────────────────────────────────────────────────────
  if (path === "/api/sessions" && req.method === "GET") {
    return new Response(JSON.stringify({ sessions: listSessions() }), { headers: jsonHeaders() });
  }

  if (path === "/api/sessions" && req.method === "POST") {
    const s = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    saveSession(s);
    return new Response(JSON.stringify(s), { headers: jsonHeaders() });
  }

  // 匹配 /api/sessions/:id
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const sid = decodeURIComponent(sessionMatch[1]);
    if (req.method === "GET") {
      const s = getSession(sid);
      if (!s) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
      return new Response(JSON.stringify(s), { headers: jsonHeaders() });
    }
    if (req.method === "DELETE") {
      deleteSession(sid);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }
    if (req.method === "PATCH") {
      const s = getSession(sid);
      if (!s) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
      try {
        const body = await req.json();
        if (typeof body.title === "string" && body.title.trim()) {
          s.title = body.title.trim().slice(0, 200);
          saveSession(s);
        }
      } catch { return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: jsonHeaders() }); }
      return new Response(JSON.stringify({ ok: true, title: s.title }), { headers: jsonHeaders() });
    }
  }

  // ─── Chat: WebSocket 消息队列（前端先 POST 消息入队，再建 WS 连接取流）──────
  if (path === "/api/chat/ws-send" && req.method === "POST") {
    const body = await req.json();
    const { session_id, message } = body;
    const messageEmpty = message == null || (Array.isArray(message) && message.length === 0) || (typeof message === "string" && message.length === 0);
    if (!session_id || messageEmpty) {
      return new Response(JSON.stringify({ error: "session_id and message required" }), { status: 400, headers: jsonHeaders() });
    }
    wsMessageQueue.set(session_id, message);
    // 30秒后自动清除（防止 WS 连接未建立导致泄漏）
    setTimeout(() => wsMessageQueue.delete(session_id), 30000);
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  // ─── 聊天：流式 API ──────────────────────────────────────────────────────
  if (path === "/api/chat/stream" && req.method === "POST") {
    const body = await req.json();
    const { session_id, message } = body;
    const messageEmpty = message == null || (Array.isArray(message) && message.length === 0) || (typeof message === "string" && message.length === 0);
    if (!session_id || messageEmpty) {
      return new Response(JSON.stringify({ error: "session_id and message required" }), {
        status: 400,
        headers: jsonHeaders(),
      });
    }
    return new Response(createChatStream(session_id, message, req.signal), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // 告诉中间的反向代理（常见于 App 内嵌 WebView 的前置网关）不要缓冲，立即转发每个 chunk
        "Access-Control-Allow-Origin": corsOrigin,
      },
    });
  }

  // 显式停止生成（用户主动点击"停止"按钮时调用）——和客户端连接断开是两件事，
  // 普通网络抖动/断线不会再触发这里，只有真正点了停止才会中断模型调用。
  if (path === "/api/chat/stop" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const ctrl = activeChatStreams.get(body.session_id);
    if (ctrl) {
      ctrl.abort();
      activeChatStreams.delete(body.session_id);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }
    return new Response(JSON.stringify({ ok: false, error: "no active stream for this session" }), { headers: jsonHeaders() });
  }

  // ─── 聊天：图片上传 API ─────────────────────────────────────────────────
  if (path === "/api/chat/upload-image" && req.method === "POST") {
    // 安全：仅在 Gateway 存活时允许上传
    const gwPid = readPidSync(PID_GATEWAY);
    if (!gwPid || !pidAliveSync(gwPid)) {
      return new Response(JSON.stringify({ error: "Gateway offline, image upload disabled" }), {
        status: 503,
        headers: jsonHeaders(),
      });
    }
    // MIME 类型白名单
    const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
    // 扩展名白名单（MIME → 安全扩展名映射）
    const SAFE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
    const MAX_SIZE = 200 * 1024 * 1024; // 200 MB（放宽以支持粘贴大图）
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return new Response(JSON.stringify({ error: "No file provided" }), { status: 400, headers: jsonHeaders() });
      }
      if (!IMAGE_TYPES.includes(file.type)) {
        return new Response(JSON.stringify({ error: "Unsupported file type" }), { status: 415, headers: jsonHeaders() });
      }
      const buf = await file.arrayBuffer();
      if (buf.byteLength > MAX_SIZE) {
        return new Response(JSON.stringify({ error: "File too large (max 200 MB)" }), { status: 413, headers: jsonHeaders() });
      }
      const ext = SAFE_EXT[file.type] || "bin";
      const filename = randomBytes(16).toString("hex") + "." + ext;
      writeFileSync(`${UPLOAD_IMG_DIR}/${filename}`, Buffer.from(buf));
      return new Response(JSON.stringify({ url: `/uploads/images/${filename}`, path: `${UPLOAD_IMG_DIR}/${filename}` }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 聊天：通用文件上传 API（非图片附件，落盘到 Hermes home 下，让 Hermes
  //      自己用文件工具读取，而不是把全文本塞进 prompt 撑爆/卡死浏览器）──────────
  if (path === "/api/chat/upload-file" && req.method === "POST") {
    const gwPid = readPidSync(PID_GATEWAY);
    if (!gwPid || !pidAliveSync(gwPid)) {
      return new Response(JSON.stringify({ error: "Gateway offline, file upload disabled" }), {
        status: 503,
        headers: jsonHeaders(),
      });
    }
    const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB（解除聊天框附件大小限制）
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return new Response(JSON.stringify({ error: "No file provided" }), { status: 400, headers: jsonHeaders() });
      }
      const buf = await file.arrayBuffer();
      if (buf.byteLength > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ error: "File too large (max 2 GB)" }), { status: 413, headers: jsonHeaders() });
      }
      // 原始文件名做安全清洗，保留可读性（方便 Hermes/用户辨认），但去掉路径分隔符等危险字符
      const origName = (file.name || "file").toString();
      const safeBase = origName.replace(/[/\\]/g, "_").replace(/\.\.+/g, ".").slice(-100) || "file";
      const filename = `${Date.now()}_${randomBytes(6).toString("hex")}_${safeBase}`;
      const fullPath = `${UPLOAD_FILE_DIR}/${filename}`;
      writeFileSync(fullPath, Buffer.from(buf));
      return new Response(JSON.stringify({
        url: `/uploads/files/${encodeURIComponent(filename)}`,
        path: fullPath,
        name: origName,
        size: buf.byteLength,
      }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: jsonHeaders() });
    }
  }

  // Dashboard 反代
  if (path.startsWith("/proxy/dashboard")) {
    const subPath = path.replace(/^\/proxy\/dashboard/, "") || "/";
    if (subPath.includes("..")) return new Response("Forbidden", { status: 403 });

    // Dashboard 未运行时直接返回 503，不进入 proxy 避免打错误日志
    if (!readPid(PID_DASHBOARD)) {
      return new Response(JSON.stringify({ error: "Dashboard is not running" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return proxyDashboard(req);
  }

  // 静态 UI — 根路径返回 index.html
  if (path === "/") {
    return serveFile(`${STATIC_DIR}/index.html`, "text/html; charset=utf-8");
  }

  // /images/、/css/、/js/、/scripts/ 等路径下的静态资源
  if (path.startsWith("/images/") || path.startsWith("/css/") || path.startsWith("/js/") || path.startsWith("/scripts/")) {
    const relPath = path.slice(1);
    if (relPath.includes("..")) return new Response("Forbidden", { status: 403 });
    const fp  = `${STATIC_DIR}/${relPath}`;
    const ext = fp.split(".").pop()?.toLowerCase();
    const ct  = ext === "js"  ? "application/javascript"
              : ext === "css" ? "text/css"
              : ext === "png" ? "image/png"
              : ext === "svg" ? "image/svg+xml"
              : "text/plain";
    return serveFile(fp, ct);
  }

  // 持久化上传（图片 + 文件），从 DATA_DIR/uploads（= HERMES_HOME/uploads）提供
  if (path.startsWith("/uploads/")) {
    const relPath = decodeURIComponent(path.slice("/uploads/".length));
    if (relPath.includes("..") || !relPath) return new Response("Forbidden", { status: 403 });
    const fp = `${UPLOAD_DIR}/${relPath}`;
    if (!existsSync(fp)) return new Response("Not Found", { status: 404 });
    const ext = fp.split(".").pop()?.toLowerCase();
    const ct  = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
              : ext === "png"  ? "image/png"
              : ext === "gif"  ? "image/gif"
              : ext === "webp" ? "image/webp"
              : ext === "svg"  ? "image/svg+xml"
              : ext === "pdf"  ? "application/pdf"
              : ext === "txt"  ? "text/plain; charset=utf-8"
              : ext === "json" ? "application/json"
              : "application/octet-stream";
    return serveFile(fp, ct);
  }

  // 临时上传图片（遗留逻辑，从 TMP_DIR 提供，路径：/tmp/filename.ext）
  if (path.startsWith("/tmp/")) {
    const filename = path.slice(5); // 去掉 "/tmp/"
    if (filename.includes("..") || !filename) return new Response("Forbidden", { status: 403 });
    const fp = `${TMP_DIR}/${filename}`;
    if (!existsSync(fp)) return new Response("Not Found", { status: 404 });
    const ext = fp.split(".").pop()?.toLowerCase();
    const ct  = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
              : ext === "png"  ? "image/png"
              : ext === "gif"  ? "image/gif"
              : ext === "webp" ? "image/webp"
              : ext === "svg"  ? "image/svg+xml"
              : "application/octet-stream";
    return serveFile(fp, ct);
  }

  // 工作区文件（持久化），从 DATA_DIR/workspace 提供
  if (path.startsWith("/workspace/")) {
    const relPath = decodeURIComponent(path.slice("/workspace/".length));
    if (relPath.includes("..") || !relPath) return new Response("Forbidden", { status: 403 });
    const fp = `${WORKSPACE_DIR}/${relPath}`;
    if (!existsSync(fp)) return new Response("Not Found", { status: 404 });
    const ext = fp.split(".").pop()?.toLowerCase();
    const ct  = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
              : ext === "png"  ? "image/png"
              : ext === "gif"  ? "image/gif"
              : ext === "webp" ? "image/webp"
              : ext === "svg"  ? "image/svg+xml"
              : ext === "pdf"  ? "application/pdf"
              : ext === "txt"  ? "text/plain; charset=utf-8"
              : ext === "json" ? "application/json"
              : ext === "csv"  ? "text/csv; charset=utf-8"
              : ext === "html" ? "text/html; charset=utf-8"
              : "application/octet-stream";
    return serveFile(fp, ct);
  }

  // data 目录文件（广义），从 DATA_DIR 提供
  // /data/workspace/... 作为子路径自动覆盖
  // 安全：屏蔽敏感文件/目录（.env、config.yaml、configs/、sessions/、venv/、隐藏文件）
  if (path.startsWith("/data/")) {
    const relPath = decodeURIComponent(path.slice("/data/".length));
    if (relPath.includes("..") || !relPath) return new Response("Forbidden", { status: 403 });
    // 屏蔽敏感路径
    if (/^\.env/i.test(relPath) ||        // .env 文件
        /^config\.ya?ml/i.test(relPath) || // config.yaml / config.yml
        /^configs\//i.test(relPath) ||     // configs/（令牌、API Key）
        /^sessions\//i.test(relPath) ||    // sessions/（私密聊天数据）
        /^venv\//i.test(relPath) ||        // venv/（Python 环境）
        /(^|\/)\./.test(relPath))          // 任意隐藏文件/目录
      return new Response("Forbidden", { status: 403 });
    const fp = `${DATA_DIR}/${relPath}`;
    if (!existsSync(fp)) return new Response("Not Found", { status: 404 });
    const ext = fp.split(".").pop()?.toLowerCase();
    const ct  = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
              : ext === "png"  ? "image/png"
              : ext === "gif"  ? "image/gif"
              : ext === "webp" ? "image/webp"
              : ext === "svg"  ? "image/svg+xml"
              : ext === "pdf"  ? "application/pdf"
              : ext === "txt"  ? "text/plain; charset=utf-8"
              : ext === "json" ? "application/json"
              : ext === "csv"  ? "text/csv; charset=utf-8"
              : ext === "html" ? "text/html; charset=utf-8"
              : "application/octet-stream";
    return serveFile(fp, ct);
  }

  return new Response("Not Found", { status: 404 });
}

// ─── SIGTERM / SIGINT：优雅关闭 ─────────────────────────────────────
let shuttingDown = false;
async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Received SIGTERM, shutting down gateway + dashboard ...");
  await stopPid(PID_GATEWAY);
  await stopPid(PID_DASHBOARD);
  log("Shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown());
process.on("SIGINT",  () => gracefulShutdown());

// ─── 崩溃保护：记录错误而非退出 ─────────────────────────
process.on("uncaughtException", (err) => {
  log(`[FATAL] uncaughtException: ${err?.message || err}\n${err?.stack || ""}`);
});
process.on("unhandledRejection", (err) => {
  log(`[FATAL] unhandledRejection: ${err?.message || err}\n${err?.stack || ""}`);
});

Bun.serve({
  fetch(req, server) {
    const url = new URL(req.url);
    const wsPath = url.pathname.replace(/^\/app\/[^/]+/, "") || "/";
    // WebSocket 升级：/api/chat/ws?session_id=xxx&token=xxx
    if (wsPath === "/api/chat/ws") {
      const token = url.searchParams.get("token") || "";
      if (MONITOR_TOKEN && token !== MONITOR_TOKEN) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const sessionId = url.searchParams.get("session_id") || "";
      const message = wsMessageQueue.get(sessionId);
      if (!sessionId || !message) {
        return new Response(JSON.stringify({ error: "no pending message for session" }), { status: 400 });
      }
      wsMessageQueue.delete(sessionId);
      const upgraded = server.upgrade(req, { data: { sessionId, message, stopCtrl: null } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
      return; // 已升级
    }
    // Dashboard WebSocket 反代：/proxy/dashboard/api/(ws|events|pty)
    if (wsPath.startsWith("/proxy/dashboard/api/ws") ||
        wsPath.startsWith("/proxy/dashboard/api/events") ||
        wsPath.startsWith("/proxy/dashboard/api/pty")) {
      if (!readPid(PID_DASHBOARD)) {
        return new Response(JSON.stringify({ error: "Dashboard is not running" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      const subPath = wsPath.replace(/^\/proxy\/dashboard/, "");
      const targetUrl = `ws://${DASHBOARD_BIND}:${DASHBOARD_PORT}${subPath}${url.search}`;
      const upgraded = server.upgrade(req, { data: { type: "dashboard-proxy", targetUrl } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
      return;
    }
    return handleFetch(req);
  },
  websocket: wsHandler,
  error(err) {
    log(`Server error: ${err?.message || err}`);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  },
  unix: SOCKET_PATH,
  idleTimeout: 255,
});
try { chmodSync(SOCKET_PATH, 0o777); } catch {}
log(`Monitor ready — unix:${SOCKET_PATH} (base=${BASE_PATH || "/"}) | dashboard proxied at /proxy/dashboard/`);
// custom_routes.js — 自定义面板路由（personas / channels / skills / app-update）
//
// 从旧版 Node 监控服务抽取并适配 Node 运行时。本文件独立于上游 monitor.js，
// 由上游 http.createServer 的 fetch 处理器在调用 handleFetch 之前通过 handleCustomRoute(req)
// 进行分发；匹配则返回 Response，否则返回 null 交给上游处理。
// 这样即便本文件内某条自定义路由有运行时错误，也只影响对应面板，不会破坏
// 上游核心的 chat / status / dashboard 功能。

import { spawn, spawnSync } from "child_process";
import {
  writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, readdirSync,
} from "fs";
import { randomBytes } from "crypto";
import { resolve as resolvePath } from "path";
import { Readable } from "stream";

// ─── 路径常量（与上游 monitor.js 保持一致） ───────────────────────────────
const APP_DIR        = process.env.APP_DIR       || "/var/apps/hermes-agent";
const DATA_DIR       = process.env.DATA_DIR      || `${APP_DIR}/home/data`;
const VAR_DIR        = process.env.VAR_DIR       || `${APP_DIR}/var`;
const VENV_BIN       = `${DATA_DIR}/venv/bin`;
const HERMES_BIN     = `${VENV_BIN}/hermes`;
const HERMES_CONFIG  = `${DATA_DIR}/config.yaml`;
const HERMES_ENV     = `${DATA_DIR}/.env`;
const CONFIG_VERSION = "1.0";

const GITHUB_REPO     = process.env.GITHUB_REPO  || "veenyi/fnos-hermes-agent";
const GITHUB_PAT_FILE = `${VAR_DIR}/github_pat`;

const TELEGRAM_ONBOARDING_URL = (process.env.TELEGRAM_ONBOARDING_URL || "https://setup.hermes-agent.nousresearch.com").replace(/\/+$/, "");
const WHATSAPP_SESSION_DIR    = `${DATA_DIR}/whatsapp/session`;
const WHATSAPP_ONBOARDING_TTL = 600000; // 10 分钟（与官方一致）

const log = (...args) => { try { console.log("[custom]", ...args); } catch {} };

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}

// ─── 应用包版本（manifest） ────────────────────────────────────────────
function readAppVersion() {
  const candidates = [process.env.APP_VERSION, `${APP_DIR}/manifest`, "/var/apps/hermes-agent/manifest"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const txt = readFileSync(c, "utf8");
      const m = txt.match(/^version\s*=\s*(.+)$/m);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v && v !== "unknown") return v;
      }
    } catch {}
  }
  return "unknown";
}
const APP_VERSION = readAppVersion();

// ─── 平台频道定义（与 hermes-studio 的 Platform Channels 对齐） ───────────
const CHANNEL_DEFS = {
  telegram: {
    name: "Telegram", icon: "✈️", qrLogin: true,
    fields: [
      { env: "TELEGRAM_BOT_TOKEN", path: "token", label: "Bot Token", placeholder: "（扫码创建机器人后自动填入，也可手动输入 BotFather Token）", secret: true },
      { env: "TELEGRAM_PROXY", path: "proxy", label: "代理 (可选)", placeholder: "socks5://127.0.0.1:7890" },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" }, { path: "reactions", label: "启用消息反应" } ],
    behavior: [
      { path: "free_response_chats", label: "自由回复的会话 (多个用逗号分隔)", placeholder: "chat_id1,chat_id2" },
      { path: "mention_patterns", label: "提及匹配规则 (正则，多个用逗号分隔)", placeholder: "@hermes,hermes" },
    ],
    note: "Telegram 支持「扫码创建机器人」自动获取 Token（调用 Nous 托管服务），也支持手动填入 BotFather 创建的 Token。",
  },
  discord: {
    name: "Discord", icon: "🎮",
    fields: [
      { env: "DISCORD_BOT_TOKEN", path: "token", label: "Bot Token", placeholder: "Bot token...", secret: true },
      { env: "DISCORD_PROXY", path: "proxy", label: "代理 (可选)", placeholder: "socks5://127.0.0.1:7890" },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" }, { path: "auto_thread", label: "自动线程" }, { path: "reactions", label: "启用反应" } ],
    behavior: [
      { path: "free_response_channels", label: "自由回复的频道 (多个用逗号分隔)", placeholder: "channel_id1,channel_id2" },
      { path: "allowed_channels", label: "仅允许的频道 (多个用逗号分隔，留空=全部)", placeholder: "channel_id1,channel_id2" },
      { path: "ignored_channels", label: "忽略的频道 (多个用逗号分隔)", placeholder: "channel_id1,channel_id2" },
      { path: "no_thread_channels", label: "不创建线程的频道 (多个用逗号分隔)", placeholder: "channel_id1,channel_id2" },
    ],
  },
  slack: {
    name: "Slack", icon: "💼",
    fields: [ { env: "SLACK_BOT_TOKEN", path: "token", label: "Bot Token", placeholder: "xoxb-...", secret: true } ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" }, { path: "allow_bots", label: "允许机器人消息" } ],
    behavior: [
      { path: "free_response_channels", label: "自由回复的频道 (多个用逗号分隔)", placeholder: "channel_id1,channel_id2" },
    ],
  },
  whatsapp: {
    name: "WhatsApp", icon: "💬", qrLogin: true,
    fields: [],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
    behavior: [
      { path: "free_response_chats", label: "自由回复的会话 (多个用逗号分隔)", placeholder: "chat_id1,chat_id2" },
      { path: "mention_patterns", label: "提及匹配规则 (正则，多个用逗号分隔)", placeholder: "@hermes,hermes" },
    ],
    note: "WhatsApp 通过本地 Baileys bridge 扫码配对。选择「独立号码」或「自用号码」模式，用 WhatsApp 扫描弹出的二维码即可完成关联。",
  },
  matrix: {
    name: "Matrix", icon: "🔷",
    fields: [
      { env: "MATRIX_ACCESS_TOKEN", path: "token", label: "Access Token", placeholder: "syt_...", secret: true },
      { env: "MATRIX_PROXY", path: "proxy", label: "代理 (可选)", placeholder: "socks5://127.0.0.1:7890" },
      { env: "MATRIX_HOMESERVER", path: "extra.homeserver", label: "Homeserver", placeholder: "https://matrix.org" },
      { env: "MATRIX_USER_ID", path: "extra.user_id", label: "User ID (可选)", placeholder: "@user:matrix.org" },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" }, { path: "auto_thread", label: "自动线程" }, { path: "dm_mention_thread", label: "私信提及线程" } ],
    behavior: [
      { path: "extra.password", label: "密码 (Password，可选)", placeholder: "Matrix 密码", type: "password" },
      { path: "free_response_rooms", label: "自由回复的房间 (多个用逗号分隔)", placeholder: "room_id1,room_id2" },
    ],
  },
  feishu: {
    name: "飞书 (Lark)", icon: "🪽",
    fields: [
      { env: "FEISHU_APP_ID", path: "extra.app_id", label: "App ID", placeholder: "cli_..." },
      { env: "FEISHU_APP_SECRET", path: "extra.app_secret", label: "App Secret", placeholder: "...", secret: true },
      { env: "FEISHU_ENCRYPT_KEY", path: "extra.encrypt_key", label: "Encrypt Key (可选)", placeholder: "..." },
      { env: "FEISHU_VERIFICATION_TOKEN", path: "extra.verification_token", label: "Verification Token (可选)", placeholder: "..." },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
    behavior: [
      { path: "free_response_chats", label: "自由回复的会话 (多个用逗号分隔)", placeholder: "chat_id1,chat_id2" },
    ],
  },
  dingtalk: {
    name: "钉钉 (DingTalk)", icon: "🔔",
    fields: [
      { env: "DINGTALK_CLIENT_ID", path: "extra.client_id", label: "Client ID (AppKey)", placeholder: "ding..." },
      { env: "DINGTALK_CLIENT_SECRET", path: "extra.client_secret", label: "Client Secret (AppSecret)", placeholder: "...", secret: true },
      { env: "DINGTALK_APP_KEY", path: "extra.app_key", label: "App Key (可选)", placeholder: "..." },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" }, { path: "allow_all_users", label: "允许所有用户" } ],
    behavior: [
      { path: "extra.card_template_id", label: "AI 卡片模板 ID (可选)", placeholder: "Card Template ID" },
      { path: "allowed_users", label: "允许的用户 (多个用逗号分隔，留空=仅创建者)", placeholder: "user_id1,user_id2" },
      { path: "free_response_chats", label: "自由回复的会话 (多个用逗号分隔)", placeholder: "chat_id1,chat_id2" },
    ],
  },
  qqbot: {
    name: "QQ 机器人 (QQBot)", icon: "🐧",
    fields: [
      { env: "QQ_APP_ID", path: "extra.app_id", label: "App ID", placeholder: "..." },
      { env: "QQ_CLIENT_SECRET", path: "extra.client_secret", label: "Client Secret", placeholder: "...", secret: true },
    ],
    toggles: [ { path: "allow_all_users", label: "允许所有用户" }, { path: "qq_markdown", label: "使用 Markdown 消息" } ],
    behavior: [
      { path: "allowed_users", label: "允许的用户 (多个用逗号分隔，留空=仅创建者)", placeholder: "openid1,openid2" },
    ],
  },
  weixin: {
    name: "微信 (WeChat)", icon: "💬",
    qrLogin: true,
    fields: [
      { env: "WEIXIN_TOKEN", path: "token", label: "Token", placeholder: "（扫码登录后自动填入）", secret: true },
      { env: "WEIXIN_ACCOUNT_ID", path: "extra.account_id", label: "Account ID", placeholder: "（扫码登录后自动填入）" },
      { env: "WEIXIN_BASE_URL", path: "extra.base_url", label: "Base URL (可选)", placeholder: "（扫码登录后自动填入）" },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
    note: "微信个人号通过腾讯 iLink 扫码登录，无需自备 App。点击下方「微信扫码登录」完成关联。",
  },
  wecom: {
    name: "企业微信 (WeCom)", icon: "💼",
    fields: [
      { env: "WECOM_BOT_ID", path: "extra.bot_id", label: "Bot ID", placeholder: "..." },
      { env: "WECOM_SECRET", path: "extra.secret", label: "Secret", placeholder: "...", secret: true },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
  },
};

// ─── Node.js 运行时探测（hermes TUI / WhatsApp bridge 需要 node） ────────
function _findNodeInPath() {
  try {
    const r = spawnSync("sh", ["-c", "command -v node"], { stdout: "pipe", stderr: "pipe" });
    const out = (r.stdout || "").toString().trim();
    if (out && existsSync(out) && (statSync(out).mode & 0o111) !== 0) return out;
  } catch {}
  return null;
}
const NODE_CANDIDATES = [
  `${APP_DIR}/runtime/node/bin/node`,
  `${DATA_DIR}/node/bin/node`,
  "/var/apps/nodejs_v24/target/bin/node",
  "/var/apps/nodejs_v22/target/bin/node",
  "/var/apps/nodejs_v20/target/bin/node",
  "/var/apps/nodejs/target/bin/node",
];
const resolvedNodeBin = NODE_CANDIDATES.find((p) => {
  try { return existsSync(p) && (statSync(p).mode & 0o111) !== 0; } catch { return false; }
}) || _findNodeInPath();
const resolvedNodeDir = resolvedNodeBin ? resolvedNodeBin.replace(/\/[^/]+$/, "") : null;

// 配对会话内存表
const _telegramPairings = new Map();
const _whatsappPairings = new Map();

// ─── 平台频道配置读写（${DATA_DIR}/.env + ${DATA_DIR}/config.yaml） ─────
function _readEnvFile() {
  try { if (existsSync(HERMES_ENV)) return readFileSync(HERMES_ENV, "utf8"); } catch (e) {}
  return "";
}
function _writeEnvFile(content) {
  try { writeFileSync(HERMES_ENV, content, { mode: 0o600 }); return true; } catch (e) { return false; }
}
function _getEnvValue(content, key) {
  const m = content.match(new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*(.+)$", "m"));
  return m ? m[1].trim() : "";
}
function _setEnvValue(content, key, value) {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = key + "=" + (value || "");
  if (content.match(new RegExp("^" + safeKey + "\\s*=", "m"))) {
    return content.replace(new RegExp("^" + safeKey + "\\s*=.*$", "m"), line);
  }
  return (content ? content.replace(/\n?$/, "\n") : "") + line + "\n";
}
function _readHermesConfig() {
  try { if (existsSync(HERMES_CONFIG)) return readFileSync(HERMES_CONFIG, "utf8"); } catch (e) {}
  return "";
}
function _writeHermesConfig(content) {
  try { writeFileSync(HERMES_CONFIG, content, { mode: 0o644 }); return true; } catch (e) { return false; }
}
// ── YAML 标量安全引用（保留 token 中的 : # 等字符） ──
function _yamlQuote(v) {
  if (v === true) return "true";
  if (v === false) return "false";
  if (v === null || v === undefined) return '""';
  const s = String(v);
  if (s === "") return '""';
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^\s|\s$/.test(s) || /[\n\r\t]/.test(s)) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return s;
}
function _yamlUnquote(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}
function _objToYaml(obj, spaces) {
  const pad = " ".repeat(spaces);
  let out = "";
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out += pad + k + ":\n" + _objToYaml(v, spaces + 2);
    } else if (Array.isArray(v)) {
      out += pad + k + (v.length ? ":\n" + v.map((x) => pad + "  - " + _yamlQuote(x) + "\n").join("") : ": []\n");
    } else {
      out += pad + k + ": " + _yamlQuote(v) + "\n";
    }
  }
  return out;
}
function _setValByPath(obj, path, val) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; cur[p] = (cur[p] && typeof cur[p] === "object") ? cur[p] : {}; cur = cur[p]; }
  cur[parts[parts.length - 1]] = val;
}
function _getValByPath(obj, path) {
  const parts = path.split("."); let cur = obj;
  for (const p of parts) { if (cur == null || typeof cur !== "object") return undefined; cur = cur[p]; }
  return cur;
}
// 读取 config.yaml 中 platforms.<id> 下的嵌套键值
function _readPlatformConfig(id) {
  const yml = _readHermesConfig();
  const re = new RegExp("^  " + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(?:\\n((?:    .*(?:\\n      .*)*\\n?)*))?", "m");
  const m = yml.match(re);
  if (!m || !m[1]) return {};
  const obj = {};
  let curObj = null;
  m[1].split("\n").forEach((l) => {
    if (!l.trim()) return;
    const mm = l.match(/^    ([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (mm) {
      const key = mm[1], val = mm[2].trim();
      if (val === "") { obj[key] = {}; curObj = obj[key]; }
      else { obj[key] = _yamlUnquote(val); curObj = null; }
    } else {
      const em = l.match(/^      ([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (em) { const k = em[1], v = _yamlUnquote(em[2].trim()); (curObj && typeof curObj === "object" ? curObj : (obj.__extra = obj.__extra || {}))[k] = v; }
    }
  });
  delete obj.__extra;
  return obj;
}
function _setPlatformConfig(id, obj) {
  const block = "  " + id + ":\n" + _objToYaml(obj, 4);
  let yml = _readHermesConfig();
  if (!/^platforms:/m.test(yml)) {
    yml = (yml ? yml.replace(/\n?$/, "\n") : "") + "platforms:\n" + block;
    return yml;
  }
  const lines = yml.split("\n");
  let header = -1;
  for (let i = 0; i < lines.length; i++) { if (/^platforms:\s*$/.test(lines[i])) { header = i; break; } }
  if (header < 0) { yml = yml.replace(/\n?$/, "\n") + "platforms:\n" + block; return yml; }
  const order = [];
  const blocks = {};
  let curId = null, curStart = null, suffixStart = lines.length;
  for (let i = header + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^[a-zA-Z_]/.test(l)) {
      if (curId !== null) blocks[curId].e = i - 1;
      suffixStart = i;
      break;
    }
    const mm = l.match(/^  ([a-zA-Z_][\w-]*):/);
    if (mm) {
      if (curId !== null) blocks[curId].e = i - 1;
      curId = mm[1]; curStart = i;
      if (!blocks[curId]) { blocks[curId] = { s: i, e: i }; if (order[order.length - 1] !== curId) order.push(curId); }
    } else if (curId !== null) {
      blocks[curId].e = i;
    }
  }
  if (curId !== null && suffixStart === lines.length) blocks[curId].e = lines.length - 1;
  const newLines = [];
  for (let i = 0; i <= header; i++) newLines.push(lines[i]);
  let wroteTarget = false;
  order.forEach((pid) => {
    if (pid === id) { newLines.push(block.replace(/\n$/, "")); wroteTarget = true; }
    else { for (let i = blocks[pid].s; i <= blocks[pid].e; i++) newLines.push(lines[i]); }
  });
  if (!wroteTarget) newLines.push(block.replace(/\n$/, ""));
  for (let i = suffixStart; i < lines.length; i++) newLines.push(lines[i]);
  return newLines.join("\n") + "\n";
}

// ─── 通讯平台 QR 扫码登录辅助函数 ────────────────────────────────────────
function _findHermesRoot() {
  try {
    const pyResult = spawnSync(
      `${VENV_BIN}/python3`, ["-c", "import hermes_cli,os;print(os.path.dirname(os.path.dirname(hermes_cli.__file__)))"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const root = (pyResult.stdout ? pyResult.stdout.toString() : "").trim();
    if (root && existsSync(`${root}/hermes_cli`)) return root;
  } catch {}
  return null;
}
// 适配：优先查找打包内置的 app/server/whatsapp-bridge，其次 hermes_cli scripts 目录
function _findWhatsAppBridgeDir() {
  const bundled = `${APP_DIR}/server/whatsapp-bridge`;
  if (existsSync(`${bundled}/bridge.js`)) return bundled;
  const root = _findHermesRoot();
  if (root && existsSync(`${root}/scripts/whatsapp-bridge/bridge.js`)) return `${root}/scripts/whatsapp-bridge`;
  return null;
}
function _findNpmBin() {
  if (!resolvedNodeBin) return null;
  const nodeDir = resolvedNodeBin.replace(/[\\/][^\\/]+$/, "");
  const checked = [];
  const siblingNpm = nodeDir + "/npm";
  checked.push(siblingNpm);
  if (existsSync(siblingNpm)) return { npm: siblingNpm, isScript: false, node: resolvedNodeBin };
  if (process.platform === "win32") {
    const baseDir = nodeDir.replace(/[\\/]node$/, "");
    const siblingNpmCmd = baseDir + "/npm.cmd";
    checked.push(siblingNpmCmd);
    if (existsSync(siblingNpmCmd)) return { npm: siblingNpmCmd, isScript: false, node: resolvedNodeBin };
    const siblingNpmPs1 = baseDir + "/npm.ps1";
    checked.push(siblingNpmPs1);
    if (existsSync(siblingNpmPs1)) return { npm: siblingNpmPs1, isScript: false, node: resolvedNodeBin };
  }
  const npmCliScript = resolvePath(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  checked.push(npmCliScript);
  if (existsSync(npmCliScript)) return { npm: npmCliScript, isScript: true, node: resolvedNodeBin };
  try {
    const r = spawnSync("sh", ["-c", "command -v npm"], { stdout: "pipe", stderr: "pipe" });
    const out = (r.stdout || "").toString().trim();
    if (out && existsSync(out)) return { npm: out, isScript: false, node: resolvedNodeBin };
  } catch {}
  const NPM_CANDIDATES = [
    "/var/apps/nodejs_v24/target/bin/npm",
    "/var/apps/nodejs_v22/target/bin/npm",
    "/var/apps/nodejs_v20/target/bin/npm",
    "/var/apps/nodejs/target/bin/npm",
    "/usr/local/bin/npm",
    "/usr/bin/npm",
    "/opt/bin/npm",
  ];
  for (const p of NPM_CANDIDATES) {
    checked.push(p);
    if (existsSync(p)) return { npm: p, isScript: false, node: resolvedNodeBin };
  }
  log(`[whatsapp] npm not found; resolvedNodeBin=${resolvedNodeBin}; checked=${checked.join(", ")}`);
  return null;
}
function _ensureWhatsAppBridgeDeps(bridgeDir) {
  if (existsSync(`${bridgeDir}/node_modules`)) return true;
  if (!resolvedNodeBin) throw new Error("未找到 Node.js，无法启动 WhatsApp bridge");
  const npmInfo = _findNpmBin();
  if (!npmInfo) {
    throw new Error("npm was not found. WhatsApp setup needs Node.js and npm. (node路径: " + (resolvedNodeBin || "null") + ")");
  }
  try {
    const env = { ...process.env, PATH: (resolvedNodeDir ? resolvedNodeDir + ":" : "") + (process.env.PATH || "") };
    const args = ["install", "--silent"];
    const result = npmInfo.isScript
      ? spawnSync(npmInfo.node, [npmInfo.npm, ...args], { cwd: bridgeDir, env, stdout: "pipe", stderr: "pipe", timeout: 300000 })
      : spawnSync(npmInfo.npm, args, { cwd: bridgeDir, env, stdout: "pipe", stderr: "pipe", timeout: 300000 });
    if (result.exitCode !== 0) {
      const err = (result.stderr || "").toString().trim() || "npm install 返回非零退出码";
      throw new Error("安装 WhatsApp bridge 依赖失败：" + err);
    }
    return true;
  } catch (e) {
    if (e && e.message) throw e;
    throw new Error("安装 WhatsApp bridge 依赖失败，请检查网络");
  }
}
function _spawnWhatsAppPairing(sessionDir, mode) {
  const bridgeDir = _findWhatsAppBridgeDir();
  if (!bridgeDir) throw new Error("未找到 WhatsApp bridge 脚本，请确认 hermes-agent 已正确安装");
  if (!resolvedNodeBin) throw new Error("未找到 Node.js，无法启动 WhatsApp bridge");
  if (!_ensureWhatsAppBridgeDeps(bridgeDir)) throw new Error("安装 WhatsApp bridge 依赖失败，请检查网络");
  try { mkdirSync(sessionDir, { recursive: true }); } catch {}
  const env = { ...process.env, WHATSAPP_MODE: mode || "self-chat", WHATSAPP_DM_POLICY: "pairing" };
  return spawn(
    resolvedNodeBin,
    [`${bridgeDir}/bridge.js`, "--pair-only", "--pair-json", "--session", sessionDir],
    { cwd: bridgeDir, stdio: ["ignore", "pipe", "pipe"], env }
  );
}
function _terminateProc(proc) {
  if (!proc) return;
  try { if (proc.pid) process.kill(proc.pid, "SIGTERM"); } catch {}
  try { proc.kill(); } catch {}
}
// 适配 Bun：spawn 返回的 stdout 是 Web ReadableStream；兼容 Node Readable
function _watchWhatsAppPairing(pairing_id, proc) {
  if (!proc) return;
  try {
    const stdout = proc.stdout;
    const getReader = (s) => (s && typeof s.getReader === "function") ? s.getReader()
      : (s && typeof Readable.toWeb === "function") ? Readable.toWeb(s).getReader() : null;
    const reader = getReader(stdout);
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";
    const processChunk = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const raw of lines) {
            const line = raw.trim(); if (!line) continue;
            try {
              const payload = JSON.parse(line);
              const event = String(payload.event || "").trim();
              const rec = _whatsappPairings.get(pairing_id);
              if (!rec || rec.proc !== proc) return;
              if (event === "qr") {
                const qr = String(payload.qr || "").trim();
                if (qr) { rec.qr_payload = qr; rec.status = "waiting"; rec.error = null; }
              } else if (event === "connected") {
                const user = payload.user || {};
                rec.account_id = String(user.id || "").trim() || null;
                rec.account_name = String(user.name || "").trim() || null;
                rec.account_phone = rec.account_id ? rec.account_id.replace(/[^0-9]/g, "").replace(/^\d+?:(\d+)@s\.whatsapp\.net$/, "$1") : null;
                rec.status = "connected"; rec.error = null;
              } else if (event === "error") {
                rec.status = "error"; rec.error = String(payload.error || "WhatsApp 配对失败");
              }
            } catch {}
          }
        }
      } catch {}
      // 进程结束（stdout EOF）
      const rec = _whatsappPairings.get(pairing_id);
      if (!rec || rec.proc !== proc) return;
      if (!["connected", "error", "expired", "cancelled"].includes(rec.status)) {
        rec.status = "error"; rec.error = "WhatsApp 配对进程意外退出";
      }
    };
    processChunk();
  } catch {}
}
function _pruneTelegramPairings() {
  const now = Date.now();
  for (const [id, rec] of _telegramPairings) { if (rec.expires_at_ts <= now) _telegramPairings.delete(id); }
}
function _pruneWhatsAppPairings() {
  const now = Date.now();
  const terminal = { "connected": 1, "error": 1, "expired": 1, "cancelled": 1 };
  for (const [id, rec] of _whatsappPairings) {
    if (!terminal[rec.status] && rec.expires_at_ts <= now) {
      rec.status = "expired"; rec.error = "二维码已过期，请重新配对";
      _terminateProc(rec.proc);
    }
    if (terminal[rec.status] && rec.expires_at_ts + 300000 <= now) _whatsappPairings.delete(id);
  }
}
function _normalizeTelegramUserId(value) {
  const s = String(value || "").trim();
  if (/^\d+$/.test(s)) return s;
  return null;
}
function _normalizeWhatsAppAllowedUsers(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  const parts = s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p === "*") { out.push("*"); continue; }
    const digits = p.replace(/\D/g, "");
    if (digits) out.push(digits);
  }
  return out.join(",");
}

function _listChannels() {
  const env = _readEnvFile();
  const out = {};
  Object.keys(CHANNEL_DEFS).forEach((id) => {
    const def = CHANNEL_DEFS[id];
    const cfg = _readPlatformConfig(id);
    let configured = false;
    (def.fields || []).forEach((f) => { if (f.env && _getEnvValue(env, f.env)) configured = true; });
    if (id === "whatsapp" && (_getEnvValue(env, "WHATSAPP_ENABLED") || cfg.enabled === "true" || cfg.enabled === true)) configured = true;
    if (id === "weixin") configured = !!_getEnvValue(env, "WEIXIN_TOKEN");
    out[id] = {
      id, name: def.name, icon: def.icon, configured, qrLogin: !!def.qrLogin, note: def.note || "",
      enabled: (cfg && cfg.enabled !== false),
      last_configured_at: (cfg && cfg.updated_at) ? cfg.updated_at : null,
      credentials: (def.fields || []).filter((f) => f.env).map((f) => ({ env: f.env, path: f.path, label: f.label, value: _getEnvValue(env, f.env) || "" })),
      config: cfg,
    };
  });
  return out;
}
function _saveChannel(id, body) {
  const def = CHANNEL_DEFS[id]; if (!def) return { ok: false, error: "unknown channel" };
  let env = _readEnvFile();
  const cfg = _readPlatformConfig(id);
  (def.fields || []).forEach((f) => {
    if (!f.env) return;
    const v = (body.credentials && body.credentials[f.env] != null) ? body.credentials[f.env]
            : (body.config && _getValByPath(body.config, f.path) != null ? _getValByPath(body.config, f.path) : null);
    if (v == null) return;
    env = _setEnvValue(env, f.env, v || "");
    if (f.path) _setValByPath(cfg, f.path, v || "");
  });
  _writeEnvFile(env);
  if (body.toggles && typeof body.toggles === "object") {
    Object.keys(body.toggles).forEach((p) => { const v = body.toggles[p]; if (v != null) _setValByPath(cfg, p, v); });
  }
  if (body.config && typeof body.config === "object") {
    Object.keys(body.config).forEach((p) => {
      if ((def.fields || []).some((f) => f.path === p)) return;
      const v = body.config[p]; if (v != null) _setValByPath(cfg, p, v);
    });
  }
  cfg.updated_at = Date.now();
  _writeHermesConfig(_setPlatformConfig(id, cfg));
  return { ok: true };
}

// ─── 技能目录解析辅助 ──────────────────────────────────────────────────
function _isDir(p) { try { return statSync(p).isDirectory(); } catch (e) { return false; } }
function _baseName(p) { return (p || "").split("/").filter(Boolean).pop() || ""; }
function _dirName(p) { const a = (p || "").split("/").filter(Boolean); a.pop(); return "/" + a.join("/"); }
function _joinPath(a, b) { return (a || "").replace(/\/$/, "") + "/" + (b || "").replace(/^\//, ""); }
function _expandHome(p) {
  if (!p) return p;
  if (p === "~") return (process.env.HOME || process.env.USERPROFILE || "");
  if (p.startsWith("~/")) return (process.env.HOME || process.env.USERPROFILE || "") + p.slice(1);
  return p;
}
function _absUrl(u, base) {
  try {
    if (/^(https?:)?\/\//i.test(u) || /^(mailto:|tel:|data:)/i.test(u)) return u;
    const bu = new URL(base);
    if (u.startsWith("//")) return bu.protocol + u;
    if (u.startsWith("/")) return bu.origin + u;
    const dir = bu.pathname.endsWith("/") ? bu.pathname : bu.pathname.replace(/\/[^\/]*$/, "/");
    return bu.origin + dir + u;
  } catch (e) { return u; }
}
function _parseSkillMd(file, dir) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  let name = _baseName(dir); let description = ""; let emoji = "";
  if (m) {
    m[1].split("\n").forEach((l) => {
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
function _readSkillFrontmatter(dir) {
  try {
    const skills = [];
    const scan = (d) => {
      const sk = _joinPath(d, "SKILL.md");
      if (existsSync(sk)) skills.push(_parseSkillMd(sk, d));
      try {
        readdirSync(d).forEach((n) => {
          const sub = _joinPath(d, n);
          if (_isDir(sub) && existsSync(_joinPath(sub, "SKILL.md"))) skills.push(_parseSkillMd(_joinPath(sub, "SKILL.md"), sub));
        });
      } catch (e) {}
    };
    scan(dir);
    return skills;
  } catch (e) { return []; }
}
function _listHermesSkills() {
  try {
    const r = spawnSync(HERMES_BIN, ["skills", "list", "--source", "all"], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, HOME: DATA_DIR, HERMES_HOME: DATA_DIR },
    });
    const out = (r.stdout ? r.stdout.toString() : "") || (r.stderr ? r.stderr.toString() : "");
    const skills = [];
    out.split("\n").forEach((line) => {
      const parts = line.split("│").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 5) return;
      const name = parts[0], category = parts[1], source = parts[2], trust = parts[3], status = parts[4];
      if (name === "Name" || source === "Source" || !name || !source) return;
      skills.push({ name, category, source, trust, status });
    });
    return skills;
  } catch (e) { return []; }
}

// ─── 扩展能力持久化（extensions.json + config.yaml 同步） ────────────────
function _yamlScalarSafe(val) {
  const s = String(val == null ? "" : val);
  const risky = s === "" ||
    /^[\s>|@`"'%#&*!?\[\]{},-]/.test(s) ||
    /\s$/.test(s) ||
    /:(\s|$)/.test(s) ||
    /\s#/.test(s);
  return risky ? JSON.stringify(s) : s;
}
function _mergeSkillsExternalDirs(content, dirs) {
  const lines = content.split("\n");
  const out = [];
  let i = 0, inSkills = false, replaced = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "skills:") { inSkills = true; out.push(line); i++; continue; }
    if (inSkills && !line.startsWith("  ") && line.trim() !== "") {
      if (!replaced) { out.push("  external_dirs:"); dirs.forEach((d) => out.push("    - " + _yamlScalarSafe(d))); replaced = true; }
      inSkills = false;
      out.push(line); i++; continue;
    }
    if (inSkills && /^\s*external_dirs:/.test(line)) {
      out.push("  external_dirs:");
      dirs.forEach((d) => out.push("    - " + _yamlScalarSafe(d)));
      replaced = true;
      i++;
      while (i < lines.length && (lines[i].startsWith("    ") || /^-\s/.test(lines[i]))) i++;
      continue;
    }
    out.push(line); i++;
  }
  if (inSkills && !replaced) { out.push("  external_dirs:"); dirs.forEach((d) => out.push("    - " + _yamlScalarSafe(d))); }
  return out.join("\n");
}
function _readExtensionsFile() {
  try {
    const p = `${VAR_DIR}/extensions.json`;
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {}
  return null;
}
function _writeExtensionsFile(obj) {
  try { writeFileSync(`${VAR_DIR}/extensions.json`, JSON.stringify(obj, null, 2)); } catch (e) {}
}

// ─── 远程技能 / 专家包 HTML 解析 ────────────────────────────────────────
function _sanitizeHtmlForEmbed(html, base) {
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
function _extractSkillLinks(html, base, type) {
  const items = []; const seen = {};
  const cardRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const href = m[1];
    const raw = m[2];
    if (!/(\/skills?\/|\/skillspackage|\/skill-package|\/skill\/)/i.test(href)) continue;
    const abs = _absUrl(href, base);
    if (seen[abs]) continue;
    seen[abs] = true;
    let text = raw.replace(/<script[\s\S]*?<\/script>/gi, "")
                  .replace(/<style[\s\S]*?<\/style>/gi, "")
                  .replace(/<[^>]+>/g, "\n")
                  .replace(/\n+/g, "\n")
                  .trim();
    const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0 && l !== "SkillHub");
    let title = "";
    let description = "";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!title && !/^([0-9.]+\s*万|需配置|办公效率|内容创作|知识管理|AI Agent|开发编程|IT 运维|设计|多媒体|行业专业|商业运营|{\[).*/i.test(l)) {
        title = l; continue;
      }
      if (title && !description && l !== title && l.length > 5) {
        description = l; break;
      }
    }
    if (!title) title = _baseName(abs.split("?")[0]).replace(/[-_]/g, " ");
    title = title.replace(/\.html?$/i, "").slice(0, 80);
    description = description.slice(0, 160);
    items.push({ title, description, url: abs, type: type || "skill" });
  }
  return items;
}

// ─── Hermes 官方技能目录（GitHub Markdown 解析） ─────────────────────────
const HERMES_CATALOG_CACHE = { ts: 0, data: null };
const HERMES_CATALOG_TTL = 10 * 60 * 1000;
const HERMES_CATALOG_URLS = {
  bundled: [
    "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/skills-catalog.md",
    "https://cdn.jsdelivr.net/gh/NousResearch/hermes-agent@main/website/docs/reference/skills-catalog.md",
  ],
  optional: [
    "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/optional-skills-catalog.md",
    "https://cdn.jsdelivr.net/gh/NousResearch/hermes-agent@main/website/docs/reference/optional-skills-catalog.md",
  ],
};
async function _fetchTextWithFallback(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.text();
    } catch (e) {}
  }
  throw new Error("无法获取 Hermes 技能目录");
}
function _parseHermesCatalog(md, kind) {
  const items = [];
  let category = "";
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) { category = heading[1].trim(); continue; }
    if (line.startsWith("|") && /Skill\s*\|/.test(line) && /Description\s*\|/.test(line)) { i++; continue; }
    if (line.startsWith("|")) {
      const cols = line.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
      if (cols.length < 2) continue;
      const m = cols[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!m) continue;
      const name = m[1].replace(/[`\\*]/g, "").trim();
      const href = m[2].trim();
      const description = cols[1].replace(/\s+/g, " ").trim();
      let path = "";
      let installCmd = "";
      let webUrl = href.startsWith("http") ? href : ("https://hermes-agent.nousresearch.com" + href);
      if (kind === "bundled") {
        path = (cols[2] || "").replace(/`/g, "").trim();
        installCmd = "hermes skills reset " + (path || name) + " --restore";
      } else {
        path = "official/" + category + "/" + name;
        installCmd = "hermes skills install " + path;
      }
      items.push({ kind, category, name, description, path, installCmd, webUrl });
    }
  }
  return items;
}
async function _getHermesCatalog() {
  const now = Date.now();
  if (HERMES_CATALOG_CACHE.data && (now - HERMES_CATALOG_CACHE.ts) < HERMES_CATALOG_TTL) return HERMES_CATALOG_CACHE.data;
  const [bundledMd, optionalMd] = await Promise.all([
    _fetchTextWithFallback(HERMES_CATALOG_URLS.bundled),
    _fetchTextWithFallback(HERMES_CATALOG_URLS.optional),
  ]);
  const data = { bundled: _parseHermesCatalog(bundledMd, "bundled"), optional: _parseHermesCatalog(optionalMd, "optional"), fetchedAt: now };
  HERMES_CATALOG_CACHE.data = data;
  HERMES_CATALOG_CACHE.ts = now;
  return data;
}

// ─── GitHub PAT（应用更新） ─────────────────────────────────────────────
function getGitHubPAT() {
  try {
    const envPat = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    if (envPat) return envPat.trim();
    if (existsSync(GITHUB_PAT_FILE)) return readFileSync(GITHUB_PAT_FILE, "utf8").trim();
  } catch {}
  return "";
}

// ────────────────────────────────────────────────────────────────────────
// 路由分发：返回 Response 或 null（null = 交由上游 handleFetch 处理）
// ────────────────────────────────────────────────────────────────────────
export async function handleCustomRoute(req) {
  const url = new URL(req.url);
  // fnOS gateway 反向代理不剥 /app/{appname}/ 前缀，这里手动剥离（与上游 handleFetch 一致）
  const path = url.pathname.replace(/^\/app\/[^/]+/, "") || "/";
  const method = req.method;

  // ── 本地已安装技能枚举 ──
  if (path === "/api/extensions/skills/local" && method === "GET") {
    try {
      const ext = _readExtensionsFile() || {};
      const dirs = (ext.skills_dirs || []).map(_expandHome).filter(Boolean);
      const dirSkills = [];
      dirs.forEach((d) => { if (_isDir(d)) _readSkillFrontmatter(d).forEach((s) => dirSkills.push({ name: s.name, description: s.description, emoji: s.emoji, dir: s.dir, file: s.file, origin: "dir" })); });
      const hermesSkills = _listHermesSkills().map((s) => ({
        name: s.name, category: s.category, source: s.source, trust: s.trust,
        status: s.status, emoji: "", description: "", origin: "hermes",
      }));
      const seen = new Set();
      const skills = [];
      hermesSkills.forEach((s) => { seen.add(s.name); skills.push(s); });
      dirSkills.forEach((s) => { if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); } });
      return new Response(JSON.stringify({ ok: true, skills, dirs, hermesCount: hermesSkills.length, dirCount: dirSkills.length }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 远程技能页（nousresearch 文档 / SkillHub） ──
  if (path === "/api/extensions/skills/remote" && method === "GET") {
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
      const isClientRenderedSPA = /Loading\s+(the\s+)?catalog|Fetching\s+[0-9]+k?\+?\s+skills|__NEXT_DATA__|data-reactroot/i.test(html);
      if (isClientRenderedSPA) {
        return new Response(JSON.stringify({
          ok: true, url: target, spa: true,
          note: "该页面为客户端渲染(SPA)，内嵌浏览器无法执行其动态加载脚本。请点击「打开原站」在新窗口浏览，或在原站找到 SKILL.md 后通过「本地已安装」目录加载。"
        }), { headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, url: target, html: _sanitizeHtmlForEmbed(html, target) }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }

  // ── SkillHub 技能 / 专家包搜索 ──
  if (path === "/api/extensions/skills/search" && method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const keyword = (u.searchParams.get("keyword") || "").trim();
      const type = u.searchParams.get("type") || "skills";
      const pageSize = Math.min(Math.max(parseInt(u.searchParams.get("pageSize") || "24", 10) || 24, 1), 50);
      if (!keyword) return new Response(JSON.stringify({ ok: false, error: "empty" }), { status: 200, headers: jsonHeaders() });
      const apiUrl = "https://api.skillhub.cn/api/skills?keyword=" + encodeURIComponent(keyword) +
        "&sortBy=score&pageSize=" + pageSize + (type === "packages" ? "&type=package" : "");
      const r = await fetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HermesDashboard/1.0)",
          "Accept": "application/json",
          "Origin": "https://www.skillhub.cn",
          "Referer": "https://www.skillhub.cn/",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const note = (r.status === 429) ? "（SkillHub 请求过于频繁，请稍后再试）" : "";
        return new Response(JSON.stringify({ ok: false, error: "SkillHub API 返回 " + r.status + note }), { status: 502, headers: jsonHeaders() });
      }
      const j = await r.json();
      const arr = (j && j.data && Array.isArray(j.data.skills)) ? j.data.skills : [];
      const items = arr.map(function (it) {
        const nsObj = (typeof it.namespace === "object" && it.namespace) ? it.namespace : null;
        const canonical = (nsObj && nsObj.canonicalName) ? nsObj.canonicalName : ("@" + (it.ownerName || "user") + "/" + (it.slug || ""));
        const desc = it.description_zh || it.description || "";
        const subcats = Array.isArray(it.subCategories) ? it.subCategories.map(function (s) { return (s && s.name) ? s.name : ""; }).filter(Boolean) : [];
        const webUrl = (it.homepage || "").replace("api.skillhub.cn", "www.skillhub.cn") || ("https://www.skillhub.cn/skills/" + (it.slug || ""));
        return {
          name: it.name || it.slug || "未命名",
          slug: it.slug || "",
          namespace: canonical,
          description: desc,
          category: it.category || "",
          iconUrl: it.iconUrl || "",
          downloads: it.downloads || 0,
          installs: it.installs || 0,
          stars: it.stars || 0,
          version: it.version || "",
          source: it.source || "",
          tags: subcats,
          webUrl: webUrl,
          installCmd: "hermes skills install " + canonical,
        };
      });
      return new Response(JSON.stringify({ ok: true, type: type, keyword: keyword, total: (j.data && j.data.total) || items.length, items }), { headers: jsonHeaders() });
    } catch (e) {
      const msg = /timeout/i.test(String(e && e.message || e)) ? "SkillHub API 请求超时" : ("搜索失败：" + (e && e.message || e));
      return new Response(JSON.stringify({ ok: false, error: msg }), { status: 502, headers: jsonHeaders() });
    }
  }

  // ── Hermes 官方技能目录搜索（解析 GitHub Markdown） ──
  if (path === "/api/extensions/skills/hermes-catalog" && method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const keyword = (u.searchParams.get("keyword") || "").trim().toLowerCase();
      const type = u.searchParams.get("type") || "all";
      const catalog = await _getHermesCatalog();
      let arr = [];
      if (type === "bundled" || type === "all") arr = arr.concat(catalog.bundled);
      if (type === "optional" || type === "all") arr = arr.concat(catalog.optional);
      if (keyword) {
        arr = arr.filter((it) => ((it.name + " " + it.category + " " + it.description).toLowerCase().indexOf(keyword) !== -1));
      }
      return new Response(JSON.stringify({ ok: true, type, keyword, total: arr.length, items: arr.slice(0, 100) }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }

  // ── 安装远程技能 ──
  if (path === "/api/extensions/skills/install" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const ur = body.url;
      if (!ur) return new Response(JSON.stringify({ ok: false, error: "missing url" }), { status: 400, headers: jsonHeaders() });
      const r = await fetch(ur, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,text/markdown,*/*" }, signal: AbortSignal.timeout(20000) });
      const content = await r.text();
      let md = null;
      if (/^---\s*\n/.test(content)) md = content;
      else {
        const m = content.match(/(?:href|src)\s*=\s*["']([^"']+\.md)["']/i) || content.match(/(https?:\/\/[^\s"'<>]+\.md\b)/i);
        if (m) { const mdUrl = m[1]; const r2 = await fetch(_absUrl(mdUrl, ur), { signal: AbortSignal.timeout(20000) }); md = await r2.text(); }
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

  // ── 平台频道 / 通讯 ──
  if (path === "/api/channels" && method === "GET") {
    try {
      return new Response(JSON.stringify({ ok: true, channels: _listChannels(), defs: CHANNEL_DEFS }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/channels/:id
  const chSaveMatch = path.match(/^\/api\/channels\/([a-zA-Z0-9_]+)$/);
  if (chSaveMatch && method === "POST") {
    try {
      const id = chSaveMatch[1];
      const body = await req.json().catch(() => ({}));
      const r = _saveChannel(id, body);
      if (!r.ok) return new Response(JSON.stringify(r), { status: 400, headers: jsonHeaders() });
      return new Response(JSON.stringify(r), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // 微信扫码登录：获取二维码
  if (path === "/api/channels/weixin/qr" && method === "GET") {
    try {
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", { signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => ({}));
      if (!data || !data.qrcode) return new Response(JSON.stringify({ ok: false, error: "无法获取微信二维码，请检查网络后重试" }), { status: 502, headers: jsonHeaders() });
      const deepLink = data.qrcode_img_content || "";
      return new Response(JSON.stringify({ ok: true, qrcode: data.qrcode, qrcode_url: deepLink, qrcode_img: deepLink, use_render_qr: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  // 微信扫码登录：轮询状态
  if (path === "/api/channels/weixin/qr/status" && method === "GET") {
    try {
      const qrcode = url.searchParams.get("qrcode") || "";
      if (!qrcode) return new Response(JSON.stringify({ ok: false, error: "缺少 qrcode 参数" }), { status: 400, headers: jsonHeaders() });
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=" + encodeURIComponent(qrcode), { signal: AbortSignal.timeout(35000) });
      const data = await res.json().catch(() => ({}));
      const status = data?.status || "wait";
      if (status === "confirmed") {
        return new Response(JSON.stringify({ ok: true, status, account_id: data.ilink_bot_id, token: data.bot_token, base_url: data.baseurl }), { headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, status }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  // Telegram 扫码创建机器人
  if (path === "/api/channels/telegram/qr" && method === "GET") {
    try {
      const botName = (url.searchParams.get("bot_name") || "Hermes Agent").trim() || "Hermes Agent";
      const res = await fetch(`${TELEGRAM_ONBOARDING_URL}/v1/telegram/pairings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ bot_name: botName }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`onboarding service ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const pairingId = String(data.pairing_id || "").trim();
      const pollToken = String(data.poll_token || "").trim();
      const expiresAt = String(data.expires_at || "").trim();
      const deepLink = String(data.deep_link || "").trim();
      const qrPayload = String(data.qr_payload || deepLink || "").trim();
      if (!pairingId || !pollToken || !expiresAt || !deepLink) throw new Error("incomplete onboarding response");
      let expiresTs = Date.now() + 600000;
      try { const d = new Date(expiresAt.replace("Z", "+00:00")); if (!isNaN(d)) expiresTs = d.getTime(); } catch {}
      _pruneTelegramPairings();
      _telegramPairings.set(pairingId, { poll_token: pollToken, expires_at_ts: expiresTs, bot_token: null, bot_username: null, owner_user_id: null });
      return new Response(JSON.stringify({ ok: true, pairing_id: pairingId, qr_payload: qrPayload, deep_link: deepLink, expires_at: expiresAt }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "无法创建 Telegram 配对：" + e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  if (path === "/api/channels/telegram/qr/status" && method === "GET") {
    try {
      const pairingId = (url.searchParams.get("pairing_id") || "").trim();
      if (!pairingId) return new Response(JSON.stringify({ ok: false, error: "缺少 pairing_id" }), { status: 400, headers: jsonHeaders() });
      _pruneTelegramPairings();
      const rec = _telegramPairings.get(pairingId);
      if (!rec) return new Response(JSON.stringify({ ok: false, error: "配对会话不存在或已过期" }), { status: 404, headers: jsonHeaders() });
      if (rec.bot_token) return new Response(JSON.stringify({ ok: true, status: "ready", bot_username: rec.bot_username, owner_user_id: rec.owner_user_id }), { headers: jsonHeaders() });
      const res = await fetch(`${TELEGRAM_ONBOARDING_URL}/v1/telegram/pairings/${encodeURIComponent(pairingId)}`, {
        headers: { "Authorization": `Bearer ${rec.poll_token}`, "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`onboarding service ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const status = String(data.status || "").trim();
      if (status === "waiting") return new Response(JSON.stringify({ ok: true, status: "waiting" }), { headers: jsonHeaders() });
      if (status === "ready") {
        const token = String(data.token || "").trim();
        if (!token) throw new Error("missing token in ready response");
        const botUsername = String(data.bot_username || "").trim() || null;
        const ownerId = (() => { const v = data.owner_user_id; if (typeof v === "number" && v > 0) return String(v); if (typeof v === "string" && /^\d+$/.test(v)) return v; return null; })();
        rec.bot_token = token; rec.bot_username = botUsername; rec.owner_user_id = ownerId;
        return new Response(JSON.stringify({ ok: true, status: "ready", bot_username: botUsername, owner_user_id: ownerId }), { headers: jsonHeaders() });
      }
      if (["expired", "claimed"].includes(status)) {
        _telegramPairings.delete(pairingId);
        return new Response(JSON.stringify({ ok: false, error: "配对已" + status + "，请重新扫码" }), { status: 410, headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, status: "waiting" }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "轮询 Telegram 状态失败：" + e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  if (path === "/api/channels/telegram/qr/apply" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const pairingId = String(body.pairing_id || "").trim();
      const rawAllowed = Array.isArray(body.allowed_user_ids) ? body.allowed_user_ids : String(body.allowed_user_ids || "").split(/[,;\s]+/);
      const allowedUserIds = [];
      for (const v of rawAllowed) {
        const norm = _normalizeTelegramUserId(v);
        if (norm && !allowedUserIds.includes(norm)) allowedUserIds.push(norm);
      }
      if (!pairingId) return new Response(JSON.stringify({ ok: false, error: "缺少 pairing_id" }), { status: 400, headers: jsonHeaders() });
      if (allowedUserIds.length === 0) return new Response(JSON.stringify({ ok: false, error: "请至少填写一个允许的 Telegram 用户 ID（数字）" }), { status: 400, headers: jsonHeaders() });
      _pruneTelegramPairings();
      const rec = _telegramPairings.get(pairingId);
      if (!rec) return new Response(JSON.stringify({ ok: false, error: "配对会话不存在或已过期" }), { status: 404, headers: jsonHeaders() });
      if (!rec.bot_token) return new Response(JSON.stringify({ ok: false, error: "机器人尚未创建完成，请稍后再试" }), { status: 409, headers: jsonHeaders() });
      let env = _readEnvFile();
      env = _setEnvValue(env, "TELEGRAM_BOT_TOKEN", rec.bot_token);
      env = _setEnvValue(env, "TELEGRAM_ALLOWED_USERS", allowedUserIds.join(","));
      _writeEnvFile(env);
      const cfg = _readPlatformConfig("telegram");
      cfg.enabled = true;
      cfg.updated_at = Date.now();
      _writeHermesConfig(_setPlatformConfig("telegram", cfg));
      _telegramPairings.delete(pairingId);
      return new Response(JSON.stringify({ ok: true, bot_username: rec.bot_username }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // WhatsApp 扫码配对
  if (path === "/api/channels/whatsapp/qr" && method === "GET") {
    try {
      const mode = ["bot", "self-chat"].includes(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "self-chat";
      if (!resolvedNodeBin) return new Response(JSON.stringify({ ok: false, error: "未找到 Node.js，无法启动 WhatsApp bridge" }), { status: 500, headers: jsonHeaders() });
      const pairingId = randomBytes(16).toString("hex");
      const sessionDir = `${WHATSAPP_SESSION_DIR}/${pairingId}`;
      const expiresTs = Date.now() + WHATSAPP_ONBOARDING_TTL;
      let initialQr = "";
      if (existsSync(`${sessionDir}/creds.json`)) {
        _pruneWhatsAppPairings();
        _whatsappPairings.set(pairingId, { proc: null, status: "connected", qr_payload: "", mode, account_id: null, account_name: null, account_phone: null, error: null, expires_at_ts: expiresTs });
        return new Response(JSON.stringify({ ok: true, pairing_id: pairingId, status: "connected" }), { headers: jsonHeaders() });
      }
      const proc = _spawnWhatsAppPairing(sessionDir, mode);
      _pruneWhatsAppPairings();
      _whatsappPairings.set(pairingId, { proc, status: "starting", qr_payload: "", mode, account_id: null, account_name: null, account_phone: null, error: null, expires_at_ts: expiresTs });
      _watchWhatsAppPairing(pairingId, proc);
      for (let i = 0; i < 30 && !initialQr; i++) { await new Promise((r) => setTimeout(r, 200)); initialQr = (_whatsappPairings.get(pairingId) || {}).qr_payload || ""; }
      return new Response(JSON.stringify({ ok: true, pairing_id: pairingId, status: initialQr ? "waiting" : "starting", qr_payload: initialQr }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "无法启动 WhatsApp 配对：" + e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/channels/whatsapp/qr/status" && method === "GET") {
    try {
      const pairingId = (url.searchParams.get("pairing_id") || "").trim();
      if (!pairingId) return new Response(JSON.stringify({ ok: false, error: "缺少 pairing_id" }), { status: 400, headers: jsonHeaders() });
      _pruneWhatsAppPairings();
      const rec = _whatsappPairings.get(pairingId);
      if (!rec) return new Response(JSON.stringify({ ok: false, error: "配对会话不存在或已过期" }), { status: 404, headers: jsonHeaders() });
      if (rec.status === "expired") return new Response(JSON.stringify({ ok: false, error: rec.error || "二维码已过期" }), { status: 410, headers: jsonHeaders() });
      return new Response(JSON.stringify({
        ok: true, status: rec.status, qr_payload: rec.qr_payload,
        account_id: rec.account_id, account_name: rec.account_name, account_phone: rec.account_phone,
        error: rec.error,
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/channels/whatsapp/qr/apply" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const pairingId = String(body.pairing_id || "").trim();
      if (!pairingId) return new Response(JSON.stringify({ ok: false, error: "缺少 pairing_id" }), { status: 400, headers: jsonHeaders() });
      _pruneWhatsAppPairings();
      const rec = _whatsappPairings.get(pairingId);
      if (!rec) return new Response(JSON.stringify({ ok: false, error: "配对会话不存在或已过期" }), { status: 404, headers: jsonHeaders() });
      if (rec.status !== "connected") return new Response(JSON.stringify({ ok: false, error: "WhatsApp 尚未配对完成" }), { status: 409, headers: jsonHeaders() });
      const allowedUsers = _normalizeWhatsAppAllowedUsers(body.allowed_users != null ? body.allowed_users : (rec.account_phone || ""));
      let env = _readEnvFile();
      env = _setEnvValue(env, "WHATSAPP_MODE", rec.mode || "self-chat");
      env = _setEnvValue(env, "WHATSAPP_DM_POLICY", "pairing");
      if (allowedUsers) env = _setEnvValue(env, "WHATSAPP_ALLOWED_USERS", allowedUsers);
      env = _setEnvValue(env, "WHATSAPP_ENABLED", "true");
      _writeEnvFile(env);
      const cfg = _readPlatformConfig("whatsapp");
      cfg.enabled = true;
      cfg.updated_at = Date.now();
      _writeHermesConfig(_setPlatformConfig("whatsapp", cfg));
      _whatsappPairings.delete(pairingId);
      return new Response(JSON.stringify({ ok: true, account_id: rec.account_id, account_name: rec.account_name }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 应用更新（GitHub Releases / Actions） ──
  if (path === "/api/app/update/check") {
    try {
      const pat = getGitHubPAT();
      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) headers["Authorization"] = `Bearer ${pat}`;
      let r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      let data;
      if (r.ok) {
        const list = await r.json();
        data = (Array.isArray(list) && list[0]) || null;
      }
      if (!data) {
        r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          signal: AbortSignal.timeout(15000),
          headers,
        });
        if (!r.ok) throw new Error(`GitHub API ${r.status}`);
        data = await r.json();
      }
      if (!data || !data.tag_name) throw new Error("GitHub API 未返回 release 信息");
      const tag = String(data.tag_name || "");
      const latest = tag.replace(/^fnos-hermes-agent_v|^v/, "").trim() || "unknown";
      const current = APP_VERSION;
      const updateAvailable = latest !== "unknown" && latest !== current;
      let download_url = "";
      if (Array.isArray(data.assets)) {
        const asset = data.assets.find((a) => /\.fpk$/i.test(a.name || ""));
        if (asset && asset.browser_download_url) download_url = asset.browser_download_url;
      }
      return new Response(JSON.stringify({
        current, latest, updateAvailable,
        html_url: data.html_url || "",
        download_url,
        published_at: data.published_at || "",
        body: data.body || "",
        repo: GITHUB_REPO,
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 502, headers: jsonHeaders() });
    }
  }
  if (path === "/api/app/update/token" && method === "POST") {
    try {
      const body = await req.json();
      const pat = (body && body.pat || "").trim();
      if (!pat) {
        try { unlinkSync(GITHUB_PAT_FILE); } catch {}
        return new Response(JSON.stringify({ ok: true, saved: false }), { headers: jsonHeaders() });
      }
      writeFileSync(GITHUB_PAT_FILE, pat, { mode: 0o600 });
      return new Response(JSON.stringify({ ok: true, saved: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/app/update/dispatch" && method === "POST") {
    try {
      const pat = getGitHubPAT();
      if (!pat) {
        return new Response(JSON.stringify({ ok: false, error: "未配置 GitHub PAT，请先在应用更新卡片中设置" }), { status: 401, headers: jsonHeaders() });
      }
      const version = APP_VERSION;
      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/Build_fnos-hermes-agent.yml/dispatches`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${pat}`,
          "User-Agent": "fnos-hermes-agent",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { version } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`GitHub dispatch ${r.status}: ${txt}`);
      }
      log(`[应用更新] 已触发 GitHub Actions 构建: ${GITHUB_REPO}, 版本 ${version}`);
      return new Response(JSON.stringify({ ok: true, version, repo: GITHUB_REPO }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 502, headers: jsonHeaders() });
    }
  }
  if (path === "/api/app/update/run") {
    try {
      const pat = getGitHubPAT();
      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) headers["Authorization"] = `Bearer ${pat}`;
      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?branch=main&per_page=1`, {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      if (!r.ok) throw new Error(`GitHub API ${r.status}`);
      const data = await r.json();
      const run = (data.workflow_runs && data.workflow_runs[0]) || null;
      return new Response(JSON.stringify({
        run: run ? {
          id: run.id, status: run.status, conclusion: run.conclusion,
          html_url: run.html_url, created_at: run.created_at, name: run.name,
        } : null,
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 502, headers: jsonHeaders() });
    }
  }

  // 未匹配自定义路由 → 交给上游
  return null;
}

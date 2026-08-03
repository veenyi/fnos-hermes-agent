// Hermes Agent 监控服务 — 基于 Node.js 的 HTTP 服务（Unix Socket），WebSocket 由 ws 库提供
import { spawn, spawnSync, execSync } from "child_process";
import { createRequire } from "module";
import { Readable } from "stream";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, symlinkSync, watch, chmodSync, readdirSync, createReadStream, openSync, rmSync, copyFileSync } from "fs";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { resolve as resolvePath, dirname, join } from "path";
import { fileURLToPath } from "url";
import { PROVIDER_PRESETS, PROVIDER_MODELS, PROVIDER_API_KEYS, PROVIDER_CLASSES, PROVIDER_HERMES_IDS } from "./provider-config.js";
import { handleCustomRoute } from "./custom_routes.js";
import { CONNECTOR_CATALOG, getConnector, callConnectorTool, probeConnector } from "./connectors.js";

// 加载 vendor 目录内置的 ws 库（Node.js 无内置 WebSocket 服务器）
const _require = createRequire(import.meta.url);
const wsLib = _require("./_vendor/ws/index.js");
const { WebSocketServer, WebSocket } = wsLib;

// 自定义 provider 环境变量名：剥离 id 中 "custom-" 或 "custom_" 前缀后规范化大写
function customEnvKey(id) {
  const bare = String(id).replace(/^custom[-_]/i, '');
  return `CUSTOM_${bare.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_API_KEY`;
}
// 兼容旧格式（CUSTOM_PROVIDER_*_API_KEY）用于读取迁移
function legacyCustomEnvKey(id) {
  const bare = String(id).replace(/^custom[-_]/i, '');
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
const MANIFEST_FILE  = `${APP_DIR}/manifest`;
const START_TIME     = Date.now();

// 应用包版本（来自 manifest，与应用中心安装包版本一致）。
// 注意：它和「hermes-agent PyPI 版本」(HERMES_VERSION) 是两个不同概念，UI 必须分开展示，避免混淆。
// 版本覆盖文件：热更/完整更新写入 manifest 失败时（如 manifest 不存在/不可写）的兜底持久化位置，优先级最高。
const VERSION_OVERRIDE_FILE = `${VAR_DIR}/app_version`;
function readAppVersion() {
  const candidates = [
    VERSION_OVERRIDE_FILE,
    MANIFEST_FILE,
    "/var/apps/hermes-agent/manifest",
    `${process.cwd()}/manifest`,
  ];
  // 尝试从 monitor.js 位置向上推导（兼容 ESM 与不同安装路径）
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "../../manifest"));
    candidates.push(join(here, "../manifest"));
  } catch {}
  for (const fp of candidates) {
    try {
      const txt = readFileSync(fp, "utf8");
      const m = txt.match(/^version\s*=\s*(\S+)/m);
      if (m) {
        const v = m[1].trim();
        if (v && v !== "unknown") return v;
      }
    } catch {}
  }
  return "unknown";
}
// 版本号比较：返回 -1/0/1
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
let APP_VERSION = readAppVersion();
log(`[启动检测] 应用包版本(manifest): ${APP_VERSION}`);
// 热更新/完整更新写入 manifest 后调用，令运行中的进程立即上报新版本号，
// 避免「更新完成但概览页仍显示旧版本」的问题。
function reloadAppVersion() {
  const v = readAppVersion();
  if (v && v !== "unknown") {
    if (v !== APP_VERSION) log(`[版本] 应用包版本已刷新: ${APP_VERSION} → ${v}`);
    APP_VERSION = v;
  }
  return APP_VERSION;
}

// 热更新/完整更新后持久化新版本号：优先更新已存在的 manifest（用启动时实际读到的路径），
// 全部失败则写版本覆盖文件；最后刷新当前进程的 APP_VERSION。
function writeAppVersion(version) {
  let wrote = false;
  const targets = [MANIFEST_FILE, "/var/apps/hermes-agent/manifest", `${process.cwd()}/manifest`];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    targets.push(join(here, "../../manifest"), join(here, "../manifest"));
  } catch {}
  for (const fp of targets) {
    try {
      if (!existsSync(fp)) continue;
      let mf = readFileSync(fp, "utf8");
      if (/^version\s*=/m.test(mf)) {
        mf = mf.replace(/^version\s*=\s*.+$/m, "version               = " + version);
        writeFileSync(fp, mf);
        wrote = true;
        log(`[版本] manifest 已更新: ${fp} → ${version}`);
        break;
      }
    } catch {}
  }
  if (!wrote) {
    // 兜底：manifest 不存在或不可写，写入版本覆盖文件（readAppVersion 优先读它）
    try {
      writeFileSync(VERSION_OVERRIDE_FILE, "version = " + version + "\n");
      log(`[版本] manifest 不可写，已写入覆盖文件: ${VERSION_OVERRIDE_FILE} → ${version}`);
    } catch (e) {
      log(`[版本] 版本号持久化失败: ${e.message}`);
    }
  }
  return reloadAppVersion();
}

// hermes-agent PyPI 版本对应的发布日期，仅用于 UI 展示区分（例如 v0.19.0 (2026.7.20)）。
// 默认值取 0.19.0 的发布日期；后台尝试从 PyPI 拉取当前版本的准确日期覆盖之（失败则保留默认值）。
let HERMES_VERSION_DATE = "2026.7.20";
(function fetchHermesReleaseDate() {
  try {
    const v = HERMES_VERSION.replace(/^v/, "").split(" ")[0];
    fetch(`https://pypi.org/pypi/hermes-agent/${encodeURIComponent(v)}/json`, {
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)).then((data) => {
      const urls = data && data.urls;
      if (urls && urls[0] && urls[0].upload_time) {
        const d = new Date(urls[0].upload_time);
        HERMES_VERSION_DATE = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
        log(`[启动检测] Hermes 版本发布日期已更新: ${HERMES_VERSION_DATE}`);
      }
    }).catch(() => {});
  } catch {}
})();
const CONFIG_VERSION = "1.0";

// 默认上下文窗口（tokens）。无法精确获知模型 tokenizer，这里取常见默认值用于进度条展示。
const DEFAULT_CONTEXT_WINDOW = 128000;

// 与 app/ui/index.html 保持一致的人格定义
const EXT_PERSONAS = {
  default:    { emoji: "🤖", label: "默认助手",   prompt: "" },
  coder:      { emoji: "💻", label: "程序员",     prompt: "你是一位资深全栈工程师。优先给出可直接运行的代码与命令，注重安全性、可维护性与生产实践；遇到模糊需求先给出最小可行方案再迭代。" },
  researcher: { emoji: "🔬", label: "研究员",     prompt: "你是一位严谨的研究员。回答须基于证据、引用来源，并明确区分事实、推测与不确定信息；避免臆断。" },
  writer:     { emoji: "✍️", label: "写作助手",   prompt: "你是一位专业的写作助手。擅长结构化、清晰、有感染力的中文表达，依据场景调整语气与篇幅。" },
  analyst:    { emoji: "📊", label: "数据分析师", prompt: "你是一位数据分析师。善于从数据 / 文件中提取洞察，优先给出量化结论与可执行建议。" },
};

// 轻量 token 估算：中文/全角字符 1:1，其他按 4 字符≈1 token。
// 仅用于 UI 上下文用量条，不用于计费或精确截断。
function estimateTokens(text) {
  if (text == null) return 0;
  const s = typeof text === "string" ? text : JSON.stringify(text);
  let tokens = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    // CJK 统一表意文字、韩文、日文、全角符号
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0x20000 && code <= 0x2EBEF)) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}

// 汇总一次请求的上下文用量各组成部分
function computeSessionUsage(session, options = {}) {
  const msgs = (session && session.messages) || [];
  const ext = options.extensions || {};
  const persona = options.persona || {};

  // 系统提示词 = UI 能力提示 + 人格提示
  const systemText = (options.systemPrompt || UI_CAPABILITIES_PROMPT || "") + (persona.prompt || "");
  const systemTokens = estimateTokens(systemText);

  // 对话历史（按 buildChatHistory 规则近似）
  const keptMessages = buildChatHistory({ messages: msgs }, "").slice(1); // 去掉系统占位
  let conversationTokens = 0;
  for (const m of keptMessages) conversationTokens += estimateTokens(m.content) + 4; // +4 角色/格式开销

  // 记忆（按字符估算）
  const memoryEnabled = ext.memory && ext.memory.enabled;
  const memoryTokens = memoryEnabled ? estimateTokens(options.memoryText || "") : 0;

  // 工具定义占位：每个启用的 toolset 约 800 tokens（实际由 Gateway 生成，这里仅做视觉估算）
  const toolsets = ext.toolsets || {};
  const enabledToolsets = Object.keys(toolsets).filter(k => toolsets[k]);
  const toolTokens = enabledToolsets.length * 800;

  // 已安装技能占位：每个技能约 1000 tokens
  const skillDirs = ext.skills_dirs || [];
  const skillCount = Math.max(0, (options.localSkillCount || 0));
  const skillTokens = skillCount * 1000;

  // 子代理 / 工作流占位
  const subagentTokens = toolsets.delegation ? 1200 : 0;

  const total = systemTokens + toolTokens + skillTokens + subagentTokens + memoryTokens + conversationTokens;
  return {
    system: systemTokens,
    tools: toolTokens,
    skills: skillTokens,
    subagents: subagentTokens,
    memory: memoryTokens,
    conversation: conversationTokens,
    total,
    window: options.contextWindow || DEFAULT_CONTEXT_WINDOW,
    pct: Math.min(100, Math.round((total / (options.contextWindow || DEFAULT_CONTEXT_WINDOW)) * 100)),
  };
}

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

const GATEWAY_PORT   = Number(process.env.GATEWAY_PORT || "8742");
const UI_PORT        = Number(process.env.UI_PORT || "8650");
const SOCKET_PATH    = (process.env.MONITOR_SOCKET_PATH || "").trim();
if (!SOCKET_PATH) {
  console.error("[FATAL] MONITOR_SOCKET_PATH is required — unix socket mode only");
  process.exit(1);
}
const BASE_PATH      = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || "9219");
const STATIC_DIR     = `${APP_DIR}/ui`;
const VENV_BIN       = `${DATA_DIR}/venv/bin`;
const HERMES_BIN     = `${VENV_BIN}/hermes`;
const UV_BIN_PATH    = `${VENV_BIN}/uv`;
const HERMES_CONFIG  = `${DATA_DIR}/config.yaml`;
const HERMES_ENV     = `${DATA_DIR}/.env`;

// 平台频道定义（与 hermes-studio 的 Platform Channels 对齐）
// 凭证写 ~/.hermes/.env（env），行为写 config.yaml platforms.<id>（path，支持 extra.x 嵌套）
// fields: 凭证输入项；toggles: 行为开关；qrLogin: 微信扫码登录
// 平台频道定义（与 hermes-studio 的 Platform Channels 对齐；2026-07-24 同步 hermes-studio 0.6.30 通讯字段）
// 凭证写 ~/.hermes/.env（env），行为写 config.yaml platforms.<id>.<path>（支持 extra.x 嵌套）
// fields: 凭证输入项（env→.env + platforms.<id>.<path>）
// toggles: 布尔行为开关（platforms.<id>.<path> = true/false）
// behavior: 非凭证字符串/列表行为项（platforms.<id>.<path>；list:true 表示逗号分隔多值）
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
    name: "企业微信 (WeCom)", icon: "💼", qrLogin: true,
    fields: [
      { env: "WECOM_CORP_ID", path: "extra.corp_id", label: "Corp ID", placeholder: "企业微信 Corp ID（扫码授权需要）" },
      { env: "WECOM_AGENT_ID", path: "extra.agent_id", label: "Agent ID", placeholder: "自建应用 Agent ID" },
      { env: "WECOM_BOT_ID", path: "extra.bot_id", label: "Bot ID", placeholder: "..." },
      { env: "WECOM_SECRET", path: "extra.secret", label: "Secret", placeholder: "...", secret: true },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
    note: "企业微信支持「扫码授权自建应用」：先填写 Corp ID / Agent ID / Secret，再点「企业微信扫码登录」用企业微信扫码授权。",
  },
};

// ─── Node.js 运行时探测（hermes TUI 需要 node；版本在安装期由 install_callback 固定） ───

// 解析 Node 二进制：① 打包内置路径 → ② 系统 nodejs 运行时（fnOS 应用中心） → ③ PATH 探测
function _findNodeInPath() {
  try {
    const r = spawnSync("sh", ["-c", "command -v node"], { stdout: "pipe", stderr: "pipe" });
    const out = (r.stdout || "").toString().trim();
    if (out && existsSync(out) && (statSync(out).mode & 0o111) !== 0) return out;
  } catch {}
  return null;
}
const NODE_CANDIDATES = [
  `${APP_DIR}/runtime/node/bin/node`,            // ① 打包内置（最高优先）
  `${DATA_DIR}/node/bin/node`,                   // ② 安装期 ensure_node 下载并固定的路径
  "/var/apps/nodejs_v24/target/bin/node",        // ③ fnOS 应用中心 Node.js v24
  "/var/apps/nodejs_v22/target/bin/node",        // ④ fnOS 应用中心 Node.js v22
  "/var/apps/nodejs_v20/target/bin/node",        // ⑤ fnOS 应用中心 Node.js v20
  "/var/apps/nodejs/target/bin/node",            // ⑥ 通用 nodejs 路径
];
const resolvedNodeBin = NODE_CANDIDATES.find(p => {
  try { return existsSync(p) && (statSync(p).mode & 0o111) !== 0; } catch { return false; }
}) || _findNodeInPath();
const resolvedNodeDir = resolvedNodeBin ? resolvedNodeBin.replace(/\/[^/]+$/, "") : null;

// ─── 通讯平台 QR 扫码登录相关常量 ────────────────────────────────────────
const TELEGRAM_ONBOARDING_URL = (process.env.TELEGRAM_ONBOARDING_URL || "https://setup.hermes-agent.nousresearch.com").replace(/\/+$/,"");
const WHATSAPP_SESSION_DIR    = `${DATA_DIR}/whatsapp/session`;
const WHATSAPP_ONBOARDING_TTL = 600000; // 10 分钟（与官方一致）
const _telegramPairings = new Map(); // pairing_id -> {poll_token, expires_at_ts, bot_token, bot_username, owner_user_id}
const _whatsappPairings = new Map(); // pairing_id -> {proc, status, qr_payload, mode, account_id, account_name, account_phone, error, expires_at_ts}

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

// ─── MCP stdio 桥接脚本：让 Hermes 网关通过 stdio 传输调用 gateway 模式连接器 ───
const MCP_BRIDGE_SCRIPT = `${VAR_DIR}/mcp-stdio-bridge.js`;
// 连接器凭证状态文件（模块级定义：模块级 MCP 自动注册必须能直接访问，不能放在 handleFetch 内部）
const CONNECTORS_STATE = `${DATA_DIR}/connectors-state.json`;
function _ensureMcpBridgeScript() {
  try {
    const script = [
      '// MCP stdio bridge: reads JSON-RPC from stdin, forwards to monitor HTTP, writes to stdout',
      'const http = require("http");',
      'const kind = process.argv[2];',
      'const port = parseInt(process.argv[3] || "8650", 10);',
      'const url = "http://127.0.0.1:" + port + "/mcp-proxy/" + kind;',
      'function forward(body) {',
      '  return new Promise(function(resolve, reject) {',
      '    var data = JSON.stringify(body);',
      '    var u = new URL(url);',
      '    var opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } };',
      '    var req = http.request(opts, function(res) {',
      '      var chunks = [];',
      '      res.on("data", function(c) { chunks.push(c); });',
      '      res.on("end", function() { resolve(Buffer.concat(chunks).toString("utf8")); });',
      '    });',
      '    req.on("error", function(e) { reject(e); });',
      '    req.write(data); req.end();',
      '  });',
      '}',
      'var buf = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", function(chunk) {',
      '  buf += chunk;',
      '  var lines = buf.split("\\n"); buf = lines.pop() || "";',
      '  lines.forEach(function(line) {',
      '    line = line.trim(); if (!line) return;',
      '    var msg; try { msg = JSON.parse(line); } catch(e) { return; }',
      '    forward(msg).then(function(resp) {',
      '      if (resp && resp.trim()) process.stdout.write(resp.trim() + "\\n");',
      '    }).catch(function(e) {',
      '      if (msg.id != null) process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:msg.id,error:{code:-32603,message:e.message}}) + "\\n");',
      '    });',
      '  });',
      '});',
      'process.stdin.on("end", function() { process.exit(0); });',
    ].join("\n");
    writeFileSync(MCP_BRIDGE_SCRIPT, script, { mode: 0o755 });
  } catch (e) { log("[MCP-BRIDGE] failed to write bridge script: " + e.message); }
}

// 模块级桥接变量：handleFetch 内部赋值，startServer 的 setTimeout 调用
let _autoRegisterGatewayMcpFn = null;

// 模块级：替换 config.yaml 顶层键（兼容 inline `key: {}` 与 block 形态），删除全部重复键
// hermes 官方模板用 inline 形态（如 `mcp_servers: {}`），旧版行级匹配无法命中，
// 导致每次写入都追加新块、config.yaml 被重复顶层键污染（网关解析异常 + 注册失效）。
function _replaceTopLevelKey(raw, key, block) {
  if (!raw) return block;
  const lines = raw.split("\n");
  const idx = [];
  lines.forEach(function (l, i) {
    if (/^\s/.test(l)) return;
    if (l === key + ":" || l.startsWith(key + ":")) idx.push(i);
  });
  if (idx.length === 0) return (raw.endsWith("\n") || raw === "") ? raw + block : raw + "\n" + block;
  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (idx.indexOf(i) !== -1) {
      if (i === idx[0] && !inserted) { out.push(block); inserted = true; }
      if (lines[i] === key + ":") { let j = i + 1; while (j < lines.length && (lines[j].startsWith(" ") || lines[j].startsWith("\t"))) j++; i = j - 1; }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

// 模块级自动注册：直接操作文件，不依赖 handleFetch 内部函数
function _moduleLevelAutoRegisterMcp() {
  try {
    let st = {};
    try { if (existsSync(CONNECTORS_STATE)) st = JSON.parse(readFileSync(CONNECTORS_STATE, "utf8") || "{}"); } catch (e) {}
    let yml = "";
    try { if (existsSync(HERMES_CONFIG)) yml = readFileSync(HERMES_CONFIG, "utf8"); } catch (e) {}
    const nodeBin = resolvedNodeBin || "node";
    const mcpObj = {};
    CONNECTOR_CATALOG.forEach(function (cat) {
      if (cat.mcp_mode !== "gateway") return;
      const creds = st[cat.kind] || {};
      if (!(cat.fields || []).every(function (f) { return !!creds[f.key]; })) return;
      mcpObj["conn-" + cat.kind] = { command: nodeBin, args: [MCP_BRIDGE_SCRIPT, cat.kind, String(UI_PORT)] };
    });
    const names = Object.keys(mcpObj);
    let block;
    if (names.length === 0) {
      block = "mcp_servers: {}";
    } else {
      block = "mcp_servers:\n" + names.map(function (n) {
        const e = mcpObj[n];
        return "  " + n + ":\n    command: " + JSON.stringify(e.command) + "\n    args:\n" +
          e.args.map(function (a) { return "      - " + JSON.stringify(a); }).join("\n");
      }).join("\n");
    }
    yml = _replaceTopLevelKey(yml, "mcp_servers", block);
    try { writeFileSync(HERMES_CONFIG, yml, { mode: 0o644 }); } catch (e) {}
    log(names.length > 0
      ? "[MCP-BRIDGE] module-level auto-register: wrote " + names.length + " gateway connector(s) to config.yaml"
      : "[MCP-BRIDGE] module-level auto-register: no configured gateway connectors");
  } catch (e) { log("[MCP-BRIDGE] module-level auto-register failed: " + e.message); }
}
_ensureMcpBridgeScript();
_moduleLevelAutoRegisterMcp();

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
migrateDisplayMarkdown();

// ─── TUI shim 初始化：确保 TUI_DIR/dist/entry.js 可用 ──────────────────
try {
  mkdirSync(`${TUI_DIR}/dist`, { recursive: true });
  const tuiEntry = `${TUI_DIR}/dist/entry.js`;
  if (!existsSync(tuiEntry)) {
    // 动态探测 hermes_cli 的 tui_dist/entry.js（不硬编码 python 版本）
      const pyResult = spawnSync(
      `${VENV_BIN}/python3`, ["-c", "import hermes_cli,os;print(os.path.dirname(hermes_cli.__file__))"],
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
  // spawnSync 已在顶部从 child_process 导入。
  // 注意必须用 (cmd, args) 两参形式：早前误写成 spawnSync(["pkill", ...]) 数组形式，
  // 会把整个数组转成命令名导致 ENOENT 静默失败，旧 gateway/dashboard 杀不掉 → 更新后网关无法干净重启。
  spawnSync("pkill", ["-SIGKILL", "-f", "hermes.*(gateway|dashboard)"]);
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
    // spawnSync 已在顶部从 child_process 导入
    const verResult = spawnSync(HERMES_BIN, ["--version"], { stdout: "pipe", stderr: "pipe" });
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
      // spawnSync 已在顶部从 child_process 导入
      const r = spawnSync(HERMES_BIN, ["--version"], { stdout: "pipe", stderr: "pipe" });
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

// ─── 仪表盘会话令牌（与仪表盘共享，代理转发时免 401 鉴权）──────────────────
// monitor 生成并固定写入文件；启动仪表盘时注入 HERMES_DASHBOARD_SESSION_TOKEN，
// 转发 /proxy/dashboard/* 时携带 X-Hermes-Session-Token，使原生 /api/* 调用免鉴权。
const DASHBOARD_TOKEN_FILE = `${VAR_DIR}/dashboard.token`;
const DASHBOARD_SESSION_TOKEN = (() => {
  try {
    if (existsSync(DASHBOARD_TOKEN_FILE)) return readFileSync(DASHBOARD_TOKEN_FILE, "utf8").trim();
  } catch {}
  const t = randomBytes(24).toString("hex");
  writeFileSync(DASHBOARD_TOKEN_FILE, t, { mode: 0o600 });
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
    try {
      // 若文件已存在但不可写（权限漂移），尝试放宽再写入
      if (existsSync(CONFIG_FILE)) {
        try { chmodSync(CONFIG_FILE, 0o600); } catch {}
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig(), null, 2));
      try { chmodSync(CONFIG_FILE, 0o600); } catch {}
      log("Config reset to defaults (version mismatch or corrupted)");
    } catch (e) {
      // 权限不足时不应导致 monitor 崩溃；后续 chat 功能可能受限，但 UI/status 仍可服务
      log(`initChatData warning: unable to write ${CONFIG_FILE}: ${e.message}`);
    }
  }
}

// ── 启动迁移：强制 display.final_response_markdown = gfm（Issue #12）────────
// 旧版本默认 strip，会导致网关剥离所有 Markdown 格式；升级后自动修正。
function migrateDisplayMarkdown() {
  try {
    const yamlPath = `${DATA_DIR}/config.yaml`;
    if (!existsSync(yamlPath)) return;
    let y = readFileSync(yamlPath, "utf8");
    const dm = y.match(/^display:[\s\S]*?^  final_response_markdown:\s*(\S+)/m);
    const current = dm ? dm[1] : "";
    if (current === "gfm") return;
    if (dm) {
      const before = y.slice(0, dm.index + dm[0].indexOf("final_response_markdown:"));
      const after = y.slice(dm.index + dm[0].length);
      y = before + "final_response_markdown: gfm" + after;
    } else if (y.match(/^display:/m)) {
      y = y.replace(/^display:/m, "display:\n  final_response_markdown: gfm");
    } else {
      y = y.trimEnd() + "\n\ndisplay:\n  final_response_markdown: gfm\n";
    }
    writeFileSync(yamlPath, y);
    log("启动迁移：已自动校正 display.final_response_markdown → gfm");
  } catch (e) { log("启动迁移 display.final_response_markdown 失败: " + e.message); }
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

// 根据前端会话级选择（modelOverride = { model, provider }）解析本次对话实际使用的 provider 列表。
// 若用户在会话窗口选了具体模型/供应商，则优先用它（并覆盖该 provider 的默认 model），不走全局回退链；
// 否则回退到全局 active_provider + fallback_providers。
function resolveChatProviders(cfg, modelOverride) {
  if (modelOverride && modelOverride.provider) {
    // 先在 config.json providers 中查找
    let sel = cfg.providers.find(p => p.name === modelOverride.provider || String(p.id) === String(modelOverride.provider));
    // 回退1：从 providers-state.yaml 查找
    if (!sel) {
      try {
        const statePath = `${VAR_DIR}/providers-state.yaml`;
        if (existsSync(statePath)) {
          const stateYml = readFileSync(statePath, "utf8");
          const blockMatch = stateYml.match(/^providers:\n([\s\S]*)$/m);
          if (blockMatch) {
            const lines = blockMatch[1].split("\n");
            let curId = null, curModel = "", curBase = "", curName = "";
            const provEntries = [];
            lines.forEach(line => {
              const km = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
              if (km) {
                if (curId) provEntries.push({ id: curId, model: curModel, base_url: curBase, name: curName });
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
            if (curId) provEntries.push({ id: curId, model: curModel, base_url: curBase, name: curName });
            const matchEntry = provEntries.find(e => e.id === modelOverride.provider || e.name === modelOverride.provider);
            if (matchEntry) {
              const preset = PROVIDER_PRESETS[matchEntry.id];
              sel = {
                id: matchEntry.id,
                name: matchEntry.name || matchEntry.id,
                base_url: matchEntry.base_url || (preset ? preset.base_url : ""),
                model: matchEntry.model || "auto",
                type: "openai-compatible",
                is_custom: !preset,
              };
            }
          }
        }
      } catch (e) { /* non-fatal */ }
    }
    // 回退2：从 config.yaml 的 providers: 段查找 base_url（Hermes 面板配置的 provider 只存在这里）
    if (!sel || !sel.base_url) {
      try {
        const yamlPath = `${DATA_DIR}/config.yaml`;
        if (existsSync(yamlPath)) {
          const yml = readFileSync(yamlPath, "utf8");
          const provBlock = _yamlBlockOf(yml, "providers");
          if (provBlock) {
            // 构建反向映射：hermesId → 原始 id
            const hermesToId = {};
            Object.entries(PROVIDER_HERMES_IDS).forEach(([id, hid]) => { hermesToId[hid] = id; });
            // 解析 providers 段
            const lines = provBlock.split("\n");
            let curId = null, curBase = "", curModel = "";
            const yamlProvs = [];
            lines.forEach(line => {
              const km = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
              if (km) {
                if (curId) yamlProvs.push({ hermesId: curId, base_url: curBase, model: curModel });
                curId = km[1]; curBase = ""; curModel = "";
                return;
              }
              const bm = line.match(/^    base_url:\s*(.+)\s*$/);
              if (bm && curId) { curBase = bm[1].replace(/^["']|["']$/g, "").trim(); return; }
              const dm = line.match(/^    default_model:\s*(.+)\s*$/);
              if (dm && curId) { curModel = dm[1].replace(/^["']|["']$/g, "").trim(); return; }
            });
            if (curId) yamlProvs.push({ hermesId: curId, base_url: curBase, model: curModel });
            // 匹配：前端发的 provider id 可能是原始 id 或 hermesId
            const targetId = modelOverride.provider;
            const targetHermesId = PROVIDER_HERMES_IDS[targetId] || targetId;
            const match = yamlProvs.find(e => e.hermesId === targetId || e.hermesId === targetHermesId || hermesToId[e.hermesId] === targetId);
            if (match && match.base_url) {
              const origId = hermesToId[match.hermesId] || match.hermesId;
              const preset = PROVIDER_PRESETS[origId];
              if (!sel) {
                sel = {
                  id: origId,
                  name: origId,
                  base_url: match.base_url,
                  model: match.model || "auto",
                  type: "openai-compatible",
                  is_custom: !preset,
                };
              } else if (!sel.base_url) {
                sel.base_url = match.base_url;
                if (!sel.model || sel.model === "auto") sel.model = match.model || "auto";
              }
            }
          }
        }
      } catch (e) { /* non-fatal */ }
    }
    // 回退3：检查 PROVIDER_PRESETS 补全 base_url
    if (sel && !sel.base_url) {
      const preset = PROVIDER_PRESETS[sel.id];
      if (preset) sel.base_url = preset.base_url;
    }
    if (sel && sel.base_url) {
      const effective = Object.assign({}, sel);
      if (modelOverride.model) effective.model = modelOverride.model;
      log(`[ModelRoute] session override → provider=${effective.id} model=${effective.model} base=${effective.base_url}`);
      return [effective];
    }
    log(`[ModelRoute] WARNING: could not resolve provider "${modelOverride.provider}" - falling back to default`);
  }
  const primary = cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
  const allProviders = [primary];
  if (cfg.fallback_providers && cfg.fallback_providers.length > 0) {
    for (const fbName of cfg.fallback_providers) {
      const fb = cfg.providers.find(p => p.name === fbName);
      if (fb && primary && fb.name !== primary.name) allProviders.push(fb);
    }
  }
  return allProviders;
}

function sessionFile(id) {
  return `${SESSIONS_DIR}/${id}.json`;
}
function listSessions() {
  try {
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

function createSSEParser(onDelta, onDone, onError, onToolEvent, onUsage) {
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
          command: toolData.command || "",
          summary: toolData.summary || "",
          args: toolData.args || "",
          result: toolData.result || "",
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
              if (tj.command) toolData.command = tj.command;
              if (tj.summary) toolData.summary = tj.summary;
              if (tj.args) toolData.args = tj.args;
              if (tj.result) toolData.result = tj.result;
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
          if (json.usage && onUsage) onUsage(json.usage);
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
              if (json.usage && onUsage) onUsage(json.usage);
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
      signal: AbortSignal.timeout(12000),
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
    // 成功时必须返回 ok:true：前端 testProviderModel/validateProvider 以 r.ok 判定可用性，
    // 此前只返回 {models, latency} 导致 r.ok 恒为 undefined，模型测试永远报「模型不可用（接口错误）」。
    // latency_ms 供前端展示延迟（前端读 r.latency_ms）。
    return { ok: true, models, latency, latency_ms: latency };
  } catch (e) {
    return { models: [], latency: Date.now() - t0, error: e.message };
  }
}

function resolveProviderBase(provider) {
  // 会话级模型切换：若用户选了非 Gateway 的 provider，直接请求该 provider 的 API（绕过 Gateway）
  // 这样不同窗口选不同模型才能真正生效；Gateway 仅用于默认 provider（保留工具调用能力）
  if (provider && provider.base_url && provider.base_url !== "LOCAL" && provider.id !== "hermes") {
    return provider.base_url.replace(/\/$/, "");
  }
  return GATEWAY_API.replace(/\/$/, "");
}

async function autoTitle(userMsg, provider) {
  // userMsg 可能是字符串、多模态 content 数组，或前端旧版对象 {text, images, files}
  // 这里只取文字部分用于生成标题
  let plainMsg = userMsg;
  if (Array.isArray(userMsg)) {
    const textPart = userMsg.find(p => p && p.type === "text");
    plainMsg = (textPart && textPart.text) || "[图片消息]";
  } else if (userMsg && typeof userMsg === "object") {
    // 兼容前端 buildMessageContent 发送的 {text, images, files} 对象
    plainMsg = userMsg.text || "[图片消息]";
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
    // 自定义 provider：用户显式配置且有 API key 的，允许直连
    const isCustomConfigured = provider.is_custom || (PROVIDER_API_KEYS[provider.id] || customEnvKey(provider.id));
    if (!isLocal && !isKnownPreset && !isCustomConfigured) {
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

// ─── 辅助：把前端送来的 {text, images, files} 消息对象规范化为
//      OpenAI 兼容的 content 格式（字符串 或 多模态数组）──────────────────
const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
};
function mimeFromPath(p) {
  const ext = (p.split(".").pop() || "").toLowerCase();
  return MIME_BY_EXT[ext] || "image/png";
}
function urlToUploadPath(url) {
  if (!url) return null;
  if (url.startsWith("/uploads/images/")) return `${UPLOAD_IMG_DIR}/${url.slice("/uploads/images/".length)}`;
  if (url.startsWith("/uploads/files/")) return `${UPLOAD_FILE_DIR}/${url.slice("/uploads/files/".length)}`;
  if (url.startsWith("/uploads/")) return `${UPLOAD_DIR}/${url.slice("/uploads/".length)}`;
  return url;
}
async function normalizeMessage(message) {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (typeof message !== "object") return String(message);
  const text = message.text || "";
  const images = Array.isArray(message.images) ? message.images : [];
  const files = Array.isArray(message.files) ? message.files : [];
  if (images.length === 0 && files.length === 0) return text;

  const parts = [];
  if (text) parts.push({ type: "text", text });

  for (const imgUrl of images) {
    const fp = urlToUploadPath(imgUrl);
    if (fp && existsSync(fp)) {
      try {
        const buf = readFileSync(fp);
        const mime = mimeFromPath(fp);
        const b64 = Buffer.from(buf).toString("base64");
        parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
        continue;
      } catch (e) { log(`[normalizeMessage] image read failed ${fp}: ${e.message}`); }
    }
    parts.push({ type: "text", text: `[图片: ${imgUrl}]` });
  }

  let fileText = "";
  for (const fileUrl of files) {
    const fp = urlToUploadPath(fileUrl);
    if (fp && existsSync(fp)) {
      try {
        const st = statSync(fp);
        const name = decodeURIComponent(fp.split("/").pop());
        const sizeStr = st.size < 1024 ? `${st.size}B`
                      : st.size < 1048576 ? `${Math.round(st.size / 1024)}KB`
                      : `${Math.round(st.size / 1048576 * 10) / 10}MB`;
        fileText += `\n\n### 文件: ${name} [${sizeStr}]\n已保存到本机路径: ${fp}\n你读取此文件并分析`;
        continue;
      } catch (e) { log(`[normalizeMessage] file stat failed ${fp}: ${e.message}`); }
    }
    fileText += `\n\n[文件: ${fileUrl}]`;
  }

  if (fileText) {
    if (parts.length > 0 && parts[0].type === "text") {
      parts[0].text += fileText;
    } else {
      parts.unshift({ type: "text", text: fileText.trim() });
    }
  }

  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
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


const PROVIDER_TIMEOUT_MS = 300000; // 长任务/多工具链需要更长时间，5 分钟
const activeChatStreams = new Map();
const wsMessageQueue = new Map(); // session_id → message，WS 连接前暂存
// 流结果缓存：WS 断开后 SSE fallback 可复用已完成的流结果，避免重新请求 LLM
// 格式: session_id → { status:'running'|'done'|'error', reply:'', tools:[], error:'', waiters:[] }
const _streamResultCache = new Map();
// 清理超时：5 分钟后清除缓存条目，防止内存泄漏
const _CACHE_TTL = 5 * 60 * 1000;
function _cacheCleanup(sid) { setTimeout(() => _streamResultCache.delete(sid), _CACHE_TTL); }

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
10. 写文件后必须用 stat（不是 ls）验证文件真实落盘。ls 可能被 sandbox overlay 欺骗显示不存在的文件。stat 报 No such file = 写入失败，不能报告成功。
11. 如果任务涉及多步骤或长时间运行，请在回复中定期（例如每完成一个重要步骤后）用一句话总结当前已完成的内容和下一步计划，这有助于在会话恢复时保持上下文连贯。`;

// ─── 聊天上下文构建：保留首条用户消息 + 最近 N 条，避免长任务丢失任务定义 ───
const MAX_HISTORY_MESSAGES = 200;
function buildChatHistory(session, systemPrompt) {
  const msgs = session.messages || [];
  // 保留系统能力提示
  const history = [{ role: "system", content: systemPrompt }];
  if (msgs.length === 0) return history;
  // 始终保留首条用户消息（通常是任务目标）
  const firstUserIdx = msgs.findIndex(m => m.role === "user");
  const keepFirst = firstUserIdx >= 0 && firstUserIdx < msgs.length - MAX_HISTORY_MESSAGES;
  const startIdx = keepFirst ? firstUserIdx + 1 : Math.max(0, msgs.length - MAX_HISTORY_MESSAGES);
  for (let i = startIdx; i < msgs.length; i++) {
    const m = msgs[i];
    history.push({ role: m.role, content: m.content });
  }
  return history;
}

// 流式回复增量 checkpoint：把当前部分回复暂存为最后一条 assistant 消息，便于异常恢复
function checkpointAssistantMessage(sessionId, content) {
  try {
    const session = getSession(sessionId);
    if (!session) return;
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === "assistant" && last._streaming) {
      last.content = content;
      last.ts = Date.now();
    } else {
      session.messages.push({ role: "assistant", content, ts: Date.now(), _streaming: true });
    }
    saveSession(session);
  } catch (e) {
    log(`[checkpoint] failed: ${e.message}`);
  }
}
function finalizeAssistantMessage(sessionId, content, options = {}) {
  try {
    const session = getSession(sessionId);
    if (!session) return;
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === "assistant" && last._streaming) {
      last.content = content;
      last.ts = Date.now();
      delete last._streaming;
      if (options.tools) last.tools = options.tools;
    } else {
      const msg = { role: "assistant", content, ts: Date.now() };
      if (options.tools) msg.tools = options.tools;
      session.messages.push(msg);
    }
    if (options.title && session.title === "New Chat") {
      session.title = options.title;
    }
    saveSession(session);
  } catch (e) {
    log(`[finalize] failed: ${e.message}`);
  }
}


function createChatStream(sessionId, message, reqSignal, systemOverride, modelOverride) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (data, ev = "message") => {
        try { controller.enqueue(enc.encode(`event: ${ev}\ndata: ${data}\n\n`)); }
        catch {}
      };
      const sendJSON = (obj) => send(JSON.stringify(obj));
      const decoder = new TextDecoder();

      // 检查流结果缓存：如果同一会话的 WS 流正在运行或已完成，复用结果
      const cached = _streamResultCache.get(sessionId);
      if (cached) {
        if (cached.status === 'done') {
          log(`[SSE] cache hit (done) session=${sessionId}, reply len=${cached.reply.length}`);
          if (cached.reply) {
            const chunkSize = 200;
            for (let i = 0; i < cached.reply.length; i += chunkSize) {
              sendJSON({ delta: cached.reply.slice(i, i + chunkSize) });
              await new Promise(r => setTimeout(r, 5));
            }
          }
          if (cached.tools && cached.tools.length) {
            cached.tools.forEach(t => sendJSON({ tool_progress: t }));
          }
          sendJSON({ done: true });
          try { controller.close(); } catch {}
          return;
        }
        if (cached.status === 'running') {
          log(`[SSE] cache hit (running) session=${sessionId}, waiting...`);
          const result = await new Promise(resolve => {
            cached.waiters.push(resolve);
            setTimeout(() => resolve(null), 30000);
          });
          if (result && result.status === 'done') {
            log(`[SSE] cache wait done session=${sessionId}, reply len=${result.reply.length}`);
            if (result.reply) {
              const chunkSize = 200;
              for (let i = 0; i < result.reply.length; i += chunkSize) {
                sendJSON({ delta: result.reply.slice(i, i + chunkSize) });
                await new Promise(r => setTimeout(r, 5));
              }
            }
            if (result.tools && result.tools.length) {
              result.tools.forEach(t => sendJSON({ tool_progress: t }));
            }
            sendJSON({ done: true });
            try { controller.close(); } catch {}
            return;
          }
          log(`[SSE] cache wait timeout session=${sessionId}, falling through`);
        }
        if (cached.status === 'error') {
          log(`[SSE] cache hit (error) session=${sessionId}`);
          sendJSON({ error: cached.error || 'Stream failed' });
          sendJSON({ done: true });
          try { controller.close(); } catch {}
          return;
        }
      }

      const stopCtrl = new AbortController();
      activeChatStreams.set(sessionId, stopCtrl);

      const keepaliveTimer = setInterval(() => {
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)); } catch {}
      }, 8000);

      const cleanup = () => {
        clearInterval(keepaliveTimer);
        if (activeChatStreams.get(sessionId) === stopCtrl) activeChatStreams.delete(sessionId);
      };

      let checkpointInterval = null;
      try {
        const normalizedMessage = await normalizeMessage(message);
        const session = getSession(sessionId);
        if (!session) {
          sendJSON({ error: "session not found" }); send("[DONE]", "end"); cleanup(); controller.close(); return;
        }

        // 去重：WS 路径（runChatWS）可能在 XHR 回退前已推送过该用户消息
        const _lastMsg = session.messages[session.messages.length - 1];
        const _isSameUserMsg = _lastMsg && _lastMsg.role === "user" &&
          JSON.stringify(_lastMsg.content) === JSON.stringify(normalizedMessage);
        if (!_isSameUserMsg) {
          session.messages.push({ role: "user", content: normalizedMessage, ts: Date.now() });
          saveSession(session);
        }

        // 智能上下文：保留首条用户消息 + 最近 MAX_HISTORY_MESSAGES 条
        // systemOverride（persona / 专家团提示）注入 system prompt，避免污染用户消息历史
        const history = buildChatHistory(session, (systemOverride ? systemOverride + "\n\n" : "") + UI_CAPABILITIES_PROMPT);

        const cfg = getChatConfig();
        const allProviders = resolveChatProviders(cfg, modelOverride);

        let fullReply = "";
        let requestError = null;
        let hadToolCalls = false;
        let responseTools = [];

        // 每 5 秒 / 每 1000 字符做一次增量 checkpoint，异常时也能保留进度
        let lastCheckpointLen = 0;
        let lastCheckpointTs = Date.now();
        checkpointInterval = setInterval(() => {
          if (fullReply.length > 0 && (fullReply.length - lastCheckpointLen >= 1000 || Date.now() - lastCheckpointTs >= 5000)) {
            checkpointAssistantMessage(sessionId, fullReply);
            lastCheckpointLen = fullReply.length;
            lastCheckpointTs = Date.now();
          }
        }, 1000);

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

            const upstream = await chatRequest(provider, normalizedMessage, history, signal);
            clearTimeout(timeoutTimer);

            hadToolCalls = false;
            let usageReported = false;
            const localParser = createSSEParser(
              (delta) => { fullReply += delta; sendJSON({ delta }); },
              () => {},
              (err) => { requestError = err; sendJSON({ error: err }); },
              (toolEvent) => {
                hadToolCalls = true;
                sendJSON({ tool_progress: toolEvent });
                responseTools.push({
                  tool: toolEvent.tool,
                  toolCallId: toolEvent.toolCallId,
                  status: toolEvent.status || "done",
                  emoji: toolEvent.emoji || "",
                  label: toolEvent.label || toolEvent.command || toolEvent.summary || "",
                  toolZh: toolEvent.toolZh || toolEvent.tool || "工具",
                  result: (toolEvent.result || "").slice(0, 4000),
                });
              },
              (usage) => {
                usageReported = true;
                try {
                  const s = getSession(sessionId);
                  if (s) {
                    s.lastUsage = {
                      prompt_tokens: usage.prompt_tokens,
                      completion_tokens: usage.completion_tokens,
                      total_tokens: usage.total_tokens,
                      reported_at: Date.now(),
                    };
                    saveSession(s);
                  }
                } catch {}
                sendJSON({ usage });
              },
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
        clearInterval(checkpointInterval);

        if (requestError !== null) {
          // 即使失败，也要把已生成的部分回复保存下来，避免用户消息白发
          const partialContent = fullReply || `(请求失败: ${requestError})`;
          finalizeAssistantMessage(sessionId, partialContent);
          sendJSON({ error: `所有模型均失败: ${requestError}` });
          // SSE 路径也写入缓存
          const sseCache = _streamResultCache.get(sessionId) || { status: 'error', reply: '', tools: [], error: '', waiters: [] };
          sseCache.status = 'error'; sseCache.error = requestError; sseCache.reply = fullReply;
          _streamResultCache.set(sessionId, sseCache);
          sseCache.waiters.forEach(w => w(sseCache)); sseCache.waiters = [];
          _cacheCleanup(sessionId);
          send("[DONE]", "end");
          cleanup();
          controller.close();
          return;
        }

        // 替换最近的 WS 助手消息（来自 WS→XHR 回退），使会话反映用户实际看到的内容
        //（即 XHR 响应），而非不完整的 WS 响应。
        const _assistantContent = fullReply || (hadToolCalls ? "（已执行工具，未生成文字回复）" : "（Gateway 连接失败）");
        finalizeAssistantMessage(sessionId, _assistantContent, { tools: responseTools });

        if (session.title === "New Chat" && session.messages.length >= 2) {
          autoTitle(message, allProviders[0]).then(title => {
            const s2 = getSession(sessionId);
            if (s2 && s2.title === "New Chat") {
              s2.title = title;
              saveSession(s2);
            }
          }).catch(() => {});
        }

        // SSE 路径写入缓存
        const sseCache2 = _streamResultCache.get(sessionId) || { status: 'done', reply: '', tools: [], error: '', waiters: [] };
        sseCache2.status = 'done'; sseCache2.reply = fullReply; sseCache2.tools = responseTools;
        _streamResultCache.set(sessionId, sseCache2);
        sseCache2.waiters.forEach(w => w(sseCache2)); sseCache2.waiters = [];
        _cacheCleanup(sessionId);

        send("[DONE]", "end");
      } catch (e) {
        clearInterval(checkpointInterval);
        if (fullReply) finalizeAssistantMessage(sessionId, fullReply + "\n\n(流式处理异常中断: " + e.message + ")");
        sendJSON({ error: e.message });
        const sseCache3 = _streamResultCache.get(sessionId) || { status: 'error', reply: '', tools: [], error: '', waiters: [] };
        sseCache3.status = 'error'; sseCache3.error = e.message; sseCache3.reply = fullReply || '';
        _streamResultCache.set(sessionId, sseCache3);
        sseCache3.waiters.forEach(w => w(sseCache3)); sseCache3.waiters = [];
        _cacheCleanup(sessionId);
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

async function runChatWS(ws, sessionId, message, systemOverride, modelOverride) {
  const sendJSON = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

  // 关键修复：检查是否已有同一会话的流在运行或已完成（WS 重连场景）
  // 如果有，等待已有流完成并返回缓存结果，避免重复请求 LLM
  const existingCache = _streamResultCache.get(sessionId);
  if (existingCache) {
    if (existingCache.status === 'done') {
      log(`[WS] cache hit (done) session=${sessionId}, sending cached result`);
      // 直接发送缓存的完整结果
      if (existingCache.reply) {
        const chunkSize = 200;
        for (let i = 0; i < existingCache.reply.length; i += chunkSize) {
          sendJSON({ delta: existingCache.reply.slice(i, i + chunkSize) });
          await new Promise(r => setTimeout(r, 5));
        }
      }
      if (existingCache.tools && existingCache.tools.length) {
        existingCache.tools.forEach(t => sendJSON({ tool_progress: t }));
      }
      sendJSON({ done: true });
      try { ws.close(1000); } catch {}
      return;
    }
    if (existingCache.status === 'running') {
      log(`[WS] cache hit (running) session=${sessionId}, waiting for existing stream...`);
      sendJSON({ info: '正在等待之前的回复完成…' });
      const result = await new Promise(resolve => {
        existingCache.waiters.push(resolve);
        setTimeout(() => resolve(null), 60000); // 60 秒超时
      });
      if (result && result.status === 'done') {
        log(`[WS] cache wait done session=${sessionId}, reply len=${result.reply.length}`);
        if (result.reply) {
          const chunkSize = 200;
          for (let i = 0; i < result.reply.length; i += chunkSize) {
            sendJSON({ delta: result.reply.slice(i, i + chunkSize) });
            await new Promise(r => setTimeout(r, 5));
          }
        }
        if (result.tools && result.tools.length) {
          result.tools.forEach(t => sendJSON({ tool_progress: t }));
        }
        sendJSON({ done: true });
        try { ws.close(1000); } catch {}
        return;
      }
      log(`[WS] cache wait timeout session=${sessionId}, starting new stream`);
    }
    if (existingCache.status === 'error') {
      log(`[WS] cache hit (error) session=${sessionId}`);
      sendJSON({ error: existingCache.error || 'Previous stream failed' });
      sendJSON({ done: true });
      try { ws.close(1000); } catch {}
      return;
    }
  }

  const stopCtrl = new AbortController();
  ws.data.stopCtrl = stopCtrl;
  activeChatStreams.set(sessionId, stopCtrl);
  wsClients.set(sessionId, ws);
  sendJSON({ info: '正在思考…' });

  // 注册流结果缓存：WS 断开后 SSE fallback / WS 重连可复用
  const cacheEntry = { status: 'running', reply: '', tools: [], error: '', waiters: [], ws: ws };
  _streamResultCache.set(sessionId, cacheEntry);

  const pingTimer = setInterval(() => { try { ws.ping(); } catch {} }, 30000);
  const keepaliveTimer = setInterval(() => { try { sendJSON({ keepalive: true }); } catch {} }, 15000);

  const cleanup = () => {
    clearInterval(pingTimer);
    clearInterval(keepaliveTimer);
    if (activeChatStreams.get(sessionId) === stopCtrl) activeChatStreams.delete(sessionId);
    wsClients.delete(sessionId);
  };

  let checkpointInterval = null;
  let session = null;
  try {
    const normalizedMessage = await normalizeMessage(message);
    session = getSession(sessionId);
    if (!session) { sendJSON({ error: "session not found" }); sendJSON({ done: true }); cleanup(); return; }

    // 去重：防止边界情况（如并发调用）下出现重复用户消息
    const _wsLastMsg = session.messages[session.messages.length - 1];
    const _wsIsSameMsg = _wsLastMsg && _wsLastMsg.role === "user" &&
      JSON.stringify(_wsLastMsg.content) === JSON.stringify(normalizedMessage);
    if (!_wsIsSameMsg) {
      session.messages.push({ role: "user", content: normalizedMessage, ts: Date.now() });
      saveSession(session);
    }

    // 智能上下文：保留首条用户消息 + 最近 MAX_HISTORY_MESSAGES 条
    // systemOverride（persona / 专家团提示）注入 system prompt，避免污染用户消息历史
    const history = buildChatHistory(session, (systemOverride ? systemOverride + "\n\n" : "") + UI_CAPABILITIES_PROMPT);

    const cfg = getChatConfig();
    const allProviders = resolveChatProviders(cfg, modelOverride);

    let fullReply = "";
    let requestError = null;
    let hadToolCalls = false;
    let responseTools = [];

    // 每 5 秒 / 每 1000 字符做一次增量 checkpoint
    let lastCheckpointLen = 0;
    let lastCheckpointTs = Date.now();
    checkpointInterval = setInterval(() => {
      if (fullReply.length > 0 && (fullReply.length - lastCheckpointLen >= 1000 || Date.now() - lastCheckpointTs >= 5000)) {
        checkpointAssistantMessage(sessionId, fullReply);
        lastCheckpointLen = fullReply.length;
        lastCheckpointTs = Date.now();
      }
    }, 1000);

    for (let i = 0; i < allProviders.length; i++) {
      const provider = allProviders[i];
      const isFallback = i > 0;
      if (isFallback) sendJSON({ info: `主模型超时，切换备选: ${provider.name}...` });

      try {
        hadToolCalls = false;
        let usageReported = false;
        const timeoutController = new AbortController();
        const timeoutTimer = setTimeout(() => timeoutController.abort(), PROVIDER_TIMEOUT_MS);
        const signal = combineSignals([timeoutController.signal, stopCtrl.signal]);

        const upstream = await chatRequest(provider, normalizedMessage, history, signal);
        clearTimeout(timeoutTimer);

        const localParser = createSSEParser(
          (delta) => { fullReply += delta; sendJSON({ delta }); cacheEntry.reply = fullReply; },
          () => {},
          (err) => { requestError = err; sendJSON({ error: err }); cacheEntry.error = err; },
          (toolEvent) => {
            hadToolCalls = true;
            sendJSON({ tool_progress: toolEvent });
            const toolRecord = {
              tool: toolEvent.tool,
              toolCallId: toolEvent.toolCallId,
              status: toolEvent.status || "done",
              emoji: toolEvent.emoji || "",
              label: toolEvent.label || toolEvent.command || toolEvent.summary || "",
              toolZh: toolEvent.toolZh || toolEvent.tool || "工具",
              result: (toolEvent.result || "").slice(0, 4000),
            };
            responseTools.push(toolRecord);
            cacheEntry.tools = responseTools.slice();
          },
          (usage) => {
            usageReported = true;
            try {
              const s = getSession(sessionId);
              if (s) {
                s.lastUsage = {
                  prompt_tokens: usage.prompt_tokens,
                  completion_tokens: usage.completion_tokens,
                  total_tokens: usage.total_tokens,
                  reported_at: Date.now(),
                };
                saveSession(s);
              }
            } catch {}
            sendJSON({ usage });
          },
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

    clearInterval(checkpointInterval);
    if (requestError !== null) {
      const partialContent = fullReply || `(请求失败: ${requestError})`;
      finalizeAssistantMessage(sessionId, partialContent);
      sendJSON({ error: `所有模型均失败: ${requestError}` });
      cacheEntry.status = 'error'; cacheEntry.error = requestError; cacheEntry.reply = fullReply;
    } else {
      finalizeAssistantMessage(sessionId, fullReply || (hadToolCalls ? "（已执行工具，未生成文字回复）" : "（Gateway 连接失败）"), { tools: responseTools });
      cacheEntry.status = 'done'; cacheEntry.reply = fullReply; cacheEntry.tools = responseTools;
    }

    if (!requestError && session.title === "New Chat" && session.messages.length >= 2) {
      autoTitle(message, allProviders[0]).then(title => {
        const s2 = getSession(sessionId);
        if (s2 && s2.title === "New Chat") { s2.title = title; saveSession(s2); }
      }).catch(() => {});
    }
    sendJSON({ done: true });
    // 通知 SSE fallback 等待者
    cacheEntry.waiters.forEach(w => w(cacheEntry));
    cacheEntry.waiters = [];
    _cacheCleanup(sessionId);
  } catch (e) {
    clearInterval(checkpointInterval);
    if (fullReply) finalizeAssistantMessage(sessionId, fullReply + "\n\n(流式处理异常中断: " + e.message + ")");
    sendJSON({ error: e.message || String(e) });
    sendJSON({ done: true });
    cacheEntry.status = 'error'; cacheEntry.error = e.message || String(e); cacheEntry.reply = fullReply || '';
    cacheEntry.waiters.forEach(w => w(cacheEntry));
    cacheEntry.waiters = [];
    _cacheCleanup(sessionId);
    // 异常时也要保存，防止用户消息和已收到的部分内容丢失
    if (session) {
      try { saveSession(session); } catch {}
    }
  }
  cleanup();
}

// Dashboard WS 反代：带自动重连的 upstream 连接管理
function setupDashboardProxy(ws) {
  const { targetUrl } = ws.data;
  ws.data.sendQueue = [];
  ws.data.reconnectAttempts = 0;
  ws.data.reconnectTimer = null;
  ws.data.closing = false;

  function cleanup() {
    ws.data.closing = true;
    if (ws.data.reconnectTimer) { clearTimeout(ws.data.reconnectTimer); ws.data.reconnectTimer = null; }
    if (ws.data.kaTimer) { clearInterval(ws.data.kaTimer); ws.data.kaTimer = null; }
    if (ws.data.upstream) { try { ws.data.upstream.terminate(); } catch {} ws.data.upstream = null; }
  }

  function flushQueue() {
    const q = ws.data.sendQueue || [];
    ws.data.sendQueue = [];
    const up = ws.data.upstream;
    if (up && up.readyState === WebSocket.OPEN) {
      for (const data of q) {
        try { up.send(data); } catch {}
      }
    }
  }

  function scheduleReconnect() {
    if (ws.data.closing || ws.readyState !== WebSocket.OPEN) return;
    const attempt = ws.data.reconnectAttempts;
    if (attempt >= 10) {
      log(`[WS-PROXY] upstream reconnect exhausted, closing client`);
      cleanup();
      try { ws.close(1011, "upstream reconnect exhausted"); } catch {}
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    ws.data.reconnectAttempts = attempt + 1;
    log(`[WS-PROXY] upstream abnormal close, reconnect in ${delay}ms (attempt ${ws.data.reconnectAttempts})`);
    ws.data.reconnectTimer = setTimeout(() => connectUpstream(), delay);
  }

  function connectUpstream() {
    if (ws.data.closing || ws.readyState !== WebSocket.OPEN) return;
    try {
      const upstream = new WebSocket(targetUrl, {
        headers: {
          "Host": `${DASHBOARD_BIND}:${DASHBOARD_PORT}`,
          "X-Hermes-Session-Token": DASHBOARD_SESSION_TOKEN,
        },
      });
      ws.data.upstream = upstream;
      upstream.on("open", () => {
        ws.data.reconnectAttempts = 0;
        log(`[WS-PROXY] upstream connected`);
        flushQueue();
      });
      upstream.on("message", (data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const path = ws.data.targetUrl?.replace(/\?.*$/, "") || "unknown";
        const isJsonPath = path.endsWith("/api/ws") || path.endsWith("/api/events");
        try {
          if (isJsonPath) {
            // 同样转成文本帧，保证浏览器 FJ/VJ 客户端收到的是可 JSON.parse 的文本。
            const payload = Buffer.isBuffer(data) ? data.toString("utf8") : (typeof data === "string" ? data : String(data));
            ws.send(payload, { binary: false });
          } else {
            ws.send(data);
          }
        } catch {}
      });
      upstream.on("close", (code, reason) => {
        log(`[WS-PROXY] upstream closed code=${code}`);
        if (ws.data.closing || ws.readyState !== WebSocket.OPEN) return;
        if (code === 4409) {
          // 4409 = WS_CLOSE_SUPERSEDED：另一个 WebSocket Attach 到同一 PTY session。
          // 直接重新 Attach，不要让浏览器感知断开，彻底避免重连风暴。
          log(`[WS-PROXY] upstream superseded, re-attach to ${targetUrl}`);
          connectUpstream();
          return;
        }
        // 1006（异常关闭）及 dashboard 偶发断连均尝试重连，而非直接断开浏览器客户端
        if (code === 1006 || code === 1001 || code === 1011 || code >= 4000) {
          scheduleReconnect();
          return;
        }
        // 其他正常关闭码（1000）透传给浏览器
        cleanup();
        try { ws.close(code, reason?.toString ? reason.toString() : reason); } catch {}
      });
      upstream.on("error", (err) => {
        log(`[WS-PROXY] upstream error: ${err?.message || err}`);
        // 连接错误也触发重连，避免上游临时不可用导致永久断开
        if (!ws.data.closing && ws.readyState === WebSocket.OPEN && !ws.data.reconnectTimer) {
          scheduleReconnect();
        }
      });
    } catch (e) {
      log(`[WS-PROXY] upstream connect failed: ${e?.message || e}`);
      scheduleReconnect();
    }
  }

  const kaTimer = setInterval(() => {
    try { if (ws.readyState === WebSocket.OPEN) ws.ping(); } catch {}
    const up = ws.data.upstream;
    if (up && up.readyState === WebSocket.OPEN) { try { up.ping(); } catch {} }
  }, 30000);
  ws.data.kaTimer = kaTimer;

  log(`[WS-PROXY] open → ${targetUrl}`);
  connectUpstream();
}

// WebSocket 连接建立后的事件处理（替换 Bun 的 wsHandler.open/message/close）
function attachWsHandlers(ws) {
  // Dashboard WS 反代
  if (ws.data.type === "dashboard-proxy") {
    setupDashboardProxy(ws);
  } else {
    // 聊天 WS
    const { sessionId, message, system, model, provider } = ws.data;
    log(`[WS] open session=${sessionId}`);
    runChatWS(ws, sessionId, message, system, { model: model || "", provider: provider || "" }).catch(err => {
      log(`[WS] runChatWS error: ${err?.message || err}`);
      try { ws.send(JSON.stringify({ error: err?.message || "internal error" })); } catch {}
      try { ws.send(JSON.stringify({ done: true })); } catch {}
    });
  }

  ws.on("message", (data, isBinary) => {
    if (ws.data.type === "dashboard-proxy") {
      const up = ws.data.upstream;
      const path = ws.data.targetUrl?.replace(/\?.*$/, "") || "unknown";
      // gateway 的 /api/ws（JSON-RPC 边车）与 /api/events（事件订阅）都用 receive_text() 收 JSON。
      // ws 库默认把收到的消息以 Buffer 形式回调，若原样 up.send(Buffer) 会被当成 binary 帧转发，
      // 触发 gateway KeyError:'text' 并导致前端 FJ 客户端显示 "WebSocket closed"。
      // 因此这两条路径一律把 Buffer 转成 UTF-8 文本、并以 text 帧上行；其它路径（如 /api/pty）保持原样。
      const isJsonPath = path.endsWith("/api/ws") || path.endsWith("/api/events");
      if (isJsonPath) {
        const payload = Buffer.isBuffer(data) ? data.toString("utf8") : (typeof data === "string" ? data : String(data));
        if (up && up.readyState === WebSocket.OPEN) {
          try { up.send(payload, { binary: false }); } catch {}
        } else if (!ws.data.closing) {
          ws.data.sendQueue = ws.data.sendQueue || [];
          ws.data.sendQueue.push(payload);
        }
        return;
      }
      if (up && up.readyState === WebSocket.OPEN) {
        try { up.send(data); } catch {}
      } else if (!ws.data.closing) {
        ws.data.sendQueue = ws.data.sendQueue || [];
        ws.data.sendQueue.push(data);
      }
      return;
    }
    // Chat WS：前端可发送 {"stop":true} 主动中断
    try {
      const msg = data.toString();
      const d = JSON.parse(msg);
      if (d.stop && ws.data.stopCtrl) ws.data.stopCtrl.abort();
    } catch {}
  });

  ws.on("close", () => {
    if (ws.data.type === "dashboard-proxy") {
      ws.data.closing = true;
      if (ws.data.reconnectTimer) { clearTimeout(ws.data.reconnectTimer); ws.data.reconnectTimer = null; }
      if (ws.data.kaTimer) { clearInterval(ws.data.kaTimer); ws.data.kaTimer = null; }
      if (ws.data.upstream) { try { ws.data.upstream.terminate(); } catch {} }
      log(`[WS-PROXY] client closed`);
      return;
    }
    const { sessionId, stopCtrl } = ws.data;
    log(`[WS] close session=${sessionId} (stream continues, SSE fallback can reuse result)`);
    wsClients.delete(sessionId);
    // 关键修复：不再 abort 流！让 LLM 请求自然完成，结果缓存到 _streamResultCache
    // SSE fallback 请求 /api/chat/stream 时可复用已完成的流结果，保证回答完整性
    // stopCtrl 仅在用户主动停止时通过 ws.on("message") 中的 {stop:true} 触发
  });
}

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
// 适用于非 HTTP 的内部端口（如 8742 网关通信端口），不受 HTTP 探活失败或
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

function findPidByCmd(pattern, binPath) {
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .replace(/\0/g, " ").trim();
        // binPath 非空时仅匹配本包 venv 的 hermes（如 HERMES_BIN），避免误判系统其它 hermes
        if (binPath && !cmdline.includes(binPath)) continue;
        if (cmdline.includes(pattern)) return pid;
      } catch {}
    }
    return null;
  } catch { return null; }
}

// 定位常驻网关进程：官方 Dashboard 以 `gateway restart` 拉起的常驻网关，
// 其命令行不含 `gateway run`，而 monitor 自己拉起的是 `gateway run`，
// 两种都需识别，否则 Dashboard 重启后 monitor 面板看不到网关进程。
// 关键：必须限定为本包 venv 的 HERMES_BIN，否则会误把系统其它 hermes
// （如 /opt/hermes 的 s6 服务）当作自身网关，导致永不拉起自己的 gateway。
function findGatewayPid() {
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .replace(/\0/g, " ").trim();
        if (cmdline.includes(HERMES_BIN) && /gateway\s+(run|restart)/.test(cmdline)) return pid;
      } catch {}
    }
    return null;
  } catch { return null; }
}

// 端口冲突防护（P0 修复 v0.20.65）：本包网关端口已从默认 8642 迁移到 8742、仪表盘从 9119 迁移到 9219，
// 以彻底规避同机 hermes-studio 等同类应用对其 8642 网关的 `--replace` 抢占（跨用户进程无法被本包 kill 清除）。
// 下面这段进程清理作为冗余兜底：尽力清掉同端口的其他 hermes 进程，但主要依赖端口迁移来避免冲突。
// 典型旧场景：同机并装 hermes-studio，其网关带 `--replace` 抢占 8642，导致本包聊天被
// 路由到「无 provider 配置 + 不同默认角色」的 studio 网关，表现为间歇
// "No inference provider configured" / 回复自称「人类学家」等。
// 仅针对二进制路径 != HERMES_BIN 的进程，绝不误杀本包自身进程。
function killForeignHermesProcesses() {
  try {
    const dirs = readdirSync("/proc").filter(d => /^\d+$/.test(d));
    for (const dir of dirs) {
      const pid = Number(dir);
      if (!pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
        if (cmdline.includes("hermes") &&
            /(gateway\s+run|hermes\s+dashboard|dashboard\s+--host)/.test(cmdline) &&
            !cmdline.includes(HERMES_BIN)) {
          log(`[port-guard] 发现外来 hermes 进程 pid=${pid}（${cmdline.slice(0, 90)}），杀除以独占本包端口`);
          try { process.kill(pid, "KILL"); } catch {}
        }
      } catch {}
    }
  } catch {}
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
    spawnSync("pkill", ["-SIGKILL", "-f", "hermes.*(gateway|dashboard)"]);
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
        if (cmdline.includes(HERMES_BIN)) total += getProcessRssKB(pid);
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

// 将 .env 风格文件中的 KEY=value 行并入 env 对象（忽略注释/空行，支持引号包裹）。
function mergeEnvFile(env, path) {
  try {
    if (!existsSync(path)) return;
    const content = readFileSync(path, "utf8");
    content.split("\n").forEach((line) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const idx = s.indexOf("=");
      if (idx < 0) return;
      const key = s.slice(0, idx).trim();
      if (!key) return;
      let val = s.slice(idx + 1).trim();
      if ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'")) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    });
  } catch (e) { /* 非致命 */ }
}

function spawnHermes(name, pidPath, args) {
  // P0 修复（v0.20.65）：拉起本包网关/仪表盘前，先清掉抢占本包端口的外来 hermes 进程，
  // 并让网关以 --replace 接管本包端口（8742），作为冗余兜底；主要冲突规避已靠端口迁移实现。
  if (name === "gateway" || name === "dashboard") {
    killForeignHermesProcesses();
    if (name === "gateway" && !args.includes("--replace")) args = [...args, "--replace"];
  }
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
    API_SERVER_PORT:   String(GATEWAY_PORT),
    API_SERVER_HOST:    "0.0.0.0",
    API_SERVER_KEY:     MONITOR_TOKEN,
    HERMES_YOLO_MODE:   "1",
    LITELLM_REQUEST_TIMEOUT: "600",
    REQUEST_TIMEOUT:    "600",
  };
  if (name === "dashboard") {
    // 固定仪表盘会话令牌，使 monitor 代理转发时能通过鉴权（见 proxyDashboard）
    env.HERMES_DASHBOARD_SESSION_TOKEN = DASHBOARD_SESSION_TOKEN;
  }

  // 关键修复（Issue #3）：网关进程继承 process.env，但控制面板把 API key 写在
  // ${VAR_DIR}/.env.providers，Hermes config.yaml 用 ${ENV_VAR} 引用。若只传 process.env，
  // 网关拿不到真实 key，会报 "No inference provider configured"。这里把 .env.providers
  // 与 Hermes 的 ${DATA_DIR}/.env 一并并入 spawn 环境，确保 SENSENOVA_API_KEY /
  // OPENAI_API_KEY / CUSTOM_*_API_KEY 等对网关可见。
  mergeEnvFile(env, `${VAR_DIR}/.env.providers`);
  mergeEnvFile(env, `${DATA_DIR}/.env`);

  const logFd = openSync(logPath, "a");
  const p = spawn(HERMES_BIN, args, {
    env,
    stdio: ["ignore", logFd, logFd],
  });

  p.unref();
  writeFileSync(pidPath, String(p.pid));
  spawnTimes.set(pidPath, Date.now());
  log(`${name} 已启动 pid=${p.pid}`);

  const cmdPattern = name === "gateway" ? "hermes gateway run" : "hermes dashboard";
  setTimeout(() => {
    if (pidAlive(p.pid)) return;
    const real = findPidByCmd(cmdPattern, HERMES_BIN);
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
  // 8742 为非 HTTP 内部端口，优先用 /proc 的 LISTEN 判据，HTTP 探活作兜底
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
    const foundDb = findPidByCmd("hermes dashboard", HERMES_BIN);
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

  // 健康检查：TCP 处于 LISTEN 即视为健康（8742 非 HTTP，OPTIONS 探测不可靠，仅作兜底）
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
    dashboard: { running: dbRunning, healthy: dbHealthy, pid: dp, port: DASHBOARD_PORT },
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
// Dashboard 自愈冷却：避免并发请求在 Dashboard 挂死时反复杀进程+重启（10 秒内最多自愈一次）
let lastDashboardHealTs = 0;

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
    // 注入仪表盘会话令牌（与 HERMES_DASHBOARD_SESSION_TOKEN 同源），
    // 转发到仪表盘的所有 /api/* 请求均带此令牌，免去 401 鉴权。
    headers.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
    // Node 的全局 fetch 在转发流 body（ReadableStream）时必须显式传 duplex:'half'，
    // 否则报 "RequestInit: duplex option is required when sending a body"。
    const init = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(10000),
    };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      init.body = req.body;
      init.duplex = "half";
    }
    const upstream = await fetch(target, init);

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
          // 8742 为非 HTTP 内部端口，优先用 /proc 的 LISTEN 判据，HTTP 探活作兜底
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

      // ── 中文语言运行时汉化（仅 zh/zh-hant 生效，不影响其他语言切换）──
      const injectZh = `<script>
(function(){
  try{
    var DICT={
      'Files':'文件','Channels':'通讯','Webhooks':'回调参数','Pairing':'配对','System':'系统',
      'KANBAN':'看板','Kanban':'看板','achievements':'成就','Achievements':'成就',
      'Model Context Length':'模型上下文长度','Fallback Providers':'备用提供商',
      'Max Concurrent Sessions':'最大并发会话','Max Live Sessions':'最大活跃会话',
      'Context File Max Chars':'上下文文件最大字符数','File Read Max Chars':'文件读取最大字符数',
      'Save':'保存','Cancel':'取消','Add':'添加','Delete':'删除','Edit':'编辑','Apply':'应用',
      'Reset':'重置','Test':'测试','Enabled':'已启用','Disabled':'已禁用','Running':'运行中',
      'Stopped':'已停止','Active':'启用','Inactive':'停用','Connected':'已连接','Disconnected':'未连接',
      'Loading':'加载中','Search':'搜索','Settings':'设置','Language':'语言','Update':'更新',
      'Restart':'重启','Install':'安装','Uninstall':'卸载','Stop':'停止','Start':'启动',
      'General':'常规','Advanced':'高级','About':'关于'
    };
    var SKIP={INPUT:1,TEXTAREA:1,SCRIPT:1,STYLE:1,CODE:1,PRE:1};
    function getLoc(){try{return localStorage.getItem('hermes-locale')||'en';}catch(e){return 'en';}}
    function translate(root){
      if(!root)return;
      var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false),n;
      while((n=w.nextNode())){
        var t=n.nodeValue; if(!t)continue;
        var k=t.trim(); if(!k||!DICT[k]||k===DICT[k])continue;
        var p=n.parentNode; if(!p||p.nodeType!==1)continue;
        if(SKIP[p.tagName]||p.isContentEditable)continue;
        n.nodeValue=t.replace(k,DICT[k]);
      }
    }
    function run(){ if(getLoc()!=='zh'&&getLoc()!=='zh-hant')return; try{translate(document.body);}catch(e){} }
    var obs;
    function start(){
      if(obs)return;
      obs=new MutationObserver(function(){
        if(obs)obs.disconnect();
        try{run();}catch(e){}
        if(obs)obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
      });
      obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
    }
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){run();start();});}
    else{run();start();}
    window.addEventListener('storage',function(e){if(e.key==='hermes-locale')run();});
  }catch(e){}
})();
<\/script>`;

      html = html.replace("</head>", inject + "\n" + injectZh + "\n</head>");

      respHeaders.delete("content-length");
      respHeaders.delete("content-encoding");
      return new Response(html, { status: upstream.status, headers: respHeaders });
    }

    // ── JSON /api/status 响应：注入正确的 app_version（manifest 版本） ──
    // Dashboard 后端的 /api/status 返回 Python 包版本，但前端应显示应用包(manifest)版本。
    // 此处在 proxy 层覆写 app_version，确保 UI 显示与 manifest 一致。
    if (contentType.includes("application/json") && subPath === "/api/status") {
      try {
        const body = await upstream.text();
        const j = JSON.parse(body);
        if (j && j.app_version !== APP_VERSION) {
          j.app_version = APP_VERSION;
          respHeaders.delete("content-length");
          respHeaders.set("cache-control", "no-store");
          return new Response(JSON.stringify(j), { status: upstream.status, headers: respHeaders });
        }
        respHeaders.delete("content-length");
        return new Response(body, { status: upstream.status, headers: respHeaders });
      } catch {}
    }

    // ── 非 HTML 响应：原样透传 ──
    return new Response(upstream.body, {
      status:  upstream.status,
      headers: respHeaders,
    });
  } catch (e) {
    const msg = e?.message || '';
    const isConnErr = /connect|refused|abort|ECONN|fetch failed|undici/i.test(msg);

    // 自愈 502：Dashboard 无响应时尝试拉起/重启并重试一次。
    // 健康判据用「端口是否在 LISTEN」而非 pidAlive：进程挂死/变 zombie 时 kill(pid,0) 仍返回存活，
    // 旧逻辑据此跳过重启；且 spawnHermes 的 readPid 守卫也会因 pid 文件中的进程“存活”而返回
    // already_running 拒绝重启 → 端口永远无人监听，所有请求永久 502（即“Hermes 网关总是 502”）。
    if (isConnErr || /fetch failed|undici/i.test(msg)) {
      const portUp = isPortListening(DASHBOARD_PORT);
      const healAllowed = Date.now() - lastDashboardHealTs > 10000;
      if (!portUp && healAllowed) {
        lastDashboardHealTs = Date.now();
        const dp = readRawPid(PID_DASHBOARD);
        // 进程仍在（挂死/zombie）但端口未监听：先杀掉并清理 pid 文件，否则 spawnHermes 会判定 already_running
        if (dp && pidAlive(dp)) {
          log(`[proxyDashboard] Dashboard 进程 pid=${dp} 存活但端口 ${DASHBOARD_PORT} 未监听（挂死），杀掉后重启…`);
          try { process.kill(dp, "SIGTERM"); } catch {}
          const killDeadline = Date.now() + 2500;
          while (pidAlive(dp) && Date.now() < killDeadline) await new Promise(r => setTimeout(r, 100));
          if (pidAlive(dp)) { try { process.kill(dp, "SIGKILL"); } catch {} await new Promise(r => setTimeout(r, 200)); }
          try { unlinkSync(PID_DASHBOARD); } catch {}
        } else {
          log(`[proxyDashboard] Dashboard 无响应且未运行，尝试自动拉起…`);
          try { unlinkSync(PID_DASHBOARD); } catch {}
        }
        try {
          spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
          // 等待 dashboard ready（最多 5 秒）
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 250));
            try {
              const probe = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/`, { signal: AbortSignal.timeout(300) });
              if (probe.ok || probe.status < 500) break;
            } catch {}
          }
          // 重试原请求
          const headers2 = new Headers(req.headers);
          headers2.delete("host");
          headers2.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
          const init2 = { method: req.method, headers: headers2, signal: AbortSignal.timeout(10000) };
          if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
            init2.body = req.body;
            init2.duplex = "half";
          }
          const upstream2 = await fetch(target, init2);
          return new Response(upstream2.body, { status: upstream2.status, headers: upstream2.headers });
        } catch (e2) {
          log(`[proxyDashboard] 自动拉起 Dashboard 后重试失败：${e2?.message || e2}`);
        }
      }
    }

    // 连接拒绝/Dashboard 未就绪属正常现象（启动期间），仅非预期错误才记录
    if (msg && !isConnErr) log(`proxy error: ${msg}`);
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
function serveFile(filePath, contentType, opts) {
  if (!existsSync(filePath)) return new Response("Not Found", { status: 404 });
  opts = opts || {};
  // 基于 mtime+size 生成弱 ETag 与 Last-Modified，供浏览器条件请求复用缓存（避免 3.4MB 专家库等大文件重复传输）
  const headers = { "Content-Type": contentType };
  let etag = null;
  try {
    const stat = statSync(filePath);
    etag = 'W/"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
    headers["ETag"] = etag;
    headers["Last-Modified"] = stat.mtime.toUTCString();
    headers["Cache-Control"] = opts.cacheable ? "public, max-age=3600" : "no-cache";
  } catch {}
  // 条件请求命中返回 304（仅当调用方传入 req 时启用）
  if (etag && opts.req) {
    const inm = opts.req.headers.get("if-none-match");
    if (inm && (inm === etag || inm.trim() === "*")) {
      return new Response(null, { status: 304, headers });
    }
  }
  const stream = Readable.toWeb(createReadStream(filePath));
  return new Response(stream, { headers });
}

// ─── 请求处理器 ─────────────────────────────────────────────────────────
async function handleFetch(req) {
  const url  = new URL(req.url);
  // fnOS gateway 反向代理不剥路径前缀（BASE_PATH），这里按实际 BASE_PATH 剥离
  let path = url.pathname;
  if (BASE_PATH && BASE_PATH !== "/") {
    if (path.startsWith(BASE_PATH + "/")) path = path.slice(BASE_PATH.length);
    else if (path === BASE_PATH) path = "/";
  }

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

  // 实时探测 8742 网关健康状态，前端 chat 页用这个判断"是否连接"
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
      api_server_port: GATEWAY_PORT,
      api_server_url: `http://${getLANIP()}:${GATEWAY_PORT}`,
      app_version: APP_VERSION,
      hermes_version_date: HERMES_VERSION_DATE,
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
        // spawnSync 已在顶部从 child_process 导入
        const vr = spawnSync(HERMES_BIN, ["--version"], { stdout: "pipe", stderr: "pipe" });
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
      const updateAvailable = latest !== "unknown" && compareVersions(latest, currentVer) > 0;
      return new Response(JSON.stringify({ current, latest: latestDisplay, updateAvailable, date: HERMES_VERSION_DATE }), {
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
      const proc = spawn(
        UV_BIN_PATH,
        ["pip", "install", "--python", `${DATA_DIR}/venv/bin/python3`, "--upgrade", "--no-cache", "hermes-agent[all]"],
        { env, stdio: ["ignore", "pipe", "pipe"] }
      );
      updateProc = proc;

      const decoder = new TextDecoder();
      const collectStream = async (stream, isErr) => {
        const reader = Readable.toWeb(stream).getReader();
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

      proc.on("exit", (code) => {
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
        // spawnSync 已在顶部从 child_process 导入
        const verResult = spawnSync(HERMES_BIN, ["--version"], { stdout: "pipe", stderr: "pipe" });
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

  // ── 应用包更新（GitHub Releases / Actions）────────────────────────────────
  const GITHUB_REPO = process.env.GITHUB_REPO || "veenyi/fnos-hermes-agent";
  const GITHUB_PAT_FILE = `${VAR_DIR}/github_pat`;

  function getGitHubPAT() {
    try {
      const envPat = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
      if (envPat) return envPat.trim();
      if (existsSync(GITHUB_PAT_FILE)) return readFileSync(GITHUB_PAT_FILE, "utf8").trim();
    } catch {}
    return "";
  }

  if (path === "/api/app/update/check") {
    try {
      const pat = getGitHubPAT();
      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) headers["Authorization"] = `Bearer ${pat}`;

      // 优先用 /releases?per_page=1：有 PAT 时能看到 draft，无 PAT 也能取到最新已发布版本
      let r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      let data;
      let rateLimited = false;
      if (r.ok) {
        const list = await r.json();
        data = (Array.isArray(list) && list[0]) || null;
      } else if (r.status === 401 || r.status === 403) {
        // 401/403 = PAT 无效或 GitHub API 限流（无 PAT 时 60次/小时）
        rateLimited = true;
      }
      // 兜底：未认证或没有 release 时尝试 /releases/latest
      if (!data && !rateLimited) {
        r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          signal: AbortSignal.timeout(15000),
          headers,
        });
        if (r.ok) {
          data = await r.json();
        } else if (r.status === 401 || r.status === 403) {
          rateLimited = true;
        } else {
          throw new Error(`GitHub API ${r.status}`);
        }
      }
      if (rateLimited && !data) {
        // PAT 未配置或 GitHub 限流：返回友好提示而非502错误
        const hint = !pat
          ? "未配置 GitHub PAT，公开仓库限速 60次/小时，当前已耗尽。可在设置页面配置 PAT 解除限速。"
          : "GitHub API 请求被限流（403），请稍后重试或检查 PAT 权限。";
        return new Response(JSON.stringify({
          current: APP_VERSION,
          latest: APP_VERSION,
          updateAvailable: false,
          rateLimited: true,
          hint,
        }), { headers: jsonHeaders() });
      }
      if (!data || !data.tag_name) throw new Error("GitHub API 未返回 release 信息");

      const tag = String(data.tag_name || "");
      const latest = tag.replace(/^fnos-hermes-agent_v|^v/, "").trim() || "unknown";
      const current = APP_VERSION;
      // 语义化版本比较：仅当 GitHub 版本严格大于本地版本时才提示更新
      const updateAvailable = latest !== "unknown" && compareVersions(latest, current) > 0;

      // 提取 .fpk 安装包直链，供用户直接下载
      let download_url = "";
      if (Array.isArray(data.assets)) {
        const asset = data.assets.find(a => /\.fpk$/i.test(a.name || ""));
        if (asset && asset.browser_download_url) download_url = asset.browser_download_url;
      }

      return new Response(JSON.stringify({
        current,
        latest,
        updateAvailable,
        html_url: data.html_url || "",
        download_url,
        published_at: data.published_at || "",
        body: data.body || "",
        repo: GITHUB_REPO,
        // 热更新信息：检查 release assets 中是否有 hot-patch.json
        hot_patch_available: Array.isArray(data.assets) && data.assets.some(a => (a.name || "") === "hot-patch.json"),
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 502, headers: jsonHeaders(),
      });
    }
  }

  // ─── 热更新：下载并替换文件，无需全量 fpk 重装 ───────────────────────────
  // ─── 自重启助手：更新后拉起新进程（不依赖外部 supervisor） ────────────────
  // 先 spawn 一个 detached 新进程再退出；新进程启动时会 unlink 旧 socket 文件
  // 后重新监听，因此新旧进程交接不会发生 EADDRINUSE。若 spawn 失败则退化为
  // 单纯退出，由 fnOS 应用管理兜底拉起。
  function scheduleMonitorRestart(reason, delayMs) {
    try { writeFileSync(`${VAR_DIR}/.hot-restart`, String(Date.now())); } catch {}
    setTimeout(() => {
      log(`[自重启] ${reason} — 拉起新 monitor 进程...`);
      try {
        const script = fileURLToPath(import.meta.url);
        // 用 shell 延迟 1.5 秒再拉新进程：确保旧进程先退出并释放 socket / TCP 8650 端口，
        // 避免新进程绑端口失败导致 standalone UI 不可用。
        const child = spawn("/bin/sh", ["-c", `sleep 1.5; exec "${process.execPath}" "${script}"`], {
          detached: true, stdio: "inherit", env: process.env, cwd: process.cwd(),
        });
        child.unref();
      } catch (e) {
        log(`[自重启] spawn 新进程失败（退化为直接退出，等待外部拉起）: ${e.message}`);
      }
      setTimeout(() => process.exit(0), 300);
    }, delayMs || 2000);
  }

  if (path === "/api/app/hot-patch" && req.method === "POST") {
    try {
      const pat = getGitHubPAT();
      const ghHeaders = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) ghHeaders["Authorization"] = `Bearer ${pat}`;

      // 1. 获取最新 release
      let r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
        signal: AbortSignal.timeout(15000), headers: ghHeaders,
      });
      let relData;
      if (r.ok) { const list = await r.json(); relData = (Array.isArray(list) && list[0]) || null; }
      if (!relData) return new Response(JSON.stringify({ ok: false, error: "无法获取 Release 信息" }), { status: 502, headers: jsonHeaders() });

      // 2. 找 hot-patch.json asset
      const patchAsset = (relData.assets || []).find(a => (a.name || "") === "hot-patch.json");
      if (!patchAsset) return new Response(JSON.stringify({ ok: false, error: "该版本无热更新包，请使用完整安装" }), { status: 404, headers: jsonHeaders() });

      // 3. 下载 hot-patch.json（私有仓库需认证）
      const dlHeaders = { "Accept": "application/octet-stream", "User-Agent": "fnos-hermes-agent" };
      if (pat) dlHeaders["Authorization"] = `Bearer ${pat}`;
      const patchRes = await fetch(patchAsset.url || patchAsset.browser_download_url, { signal: AbortSignal.timeout(15000), headers: dlHeaders });
      if (!patchRes.ok) throw new Error("下载 hot-patch.json 失败: " + patchRes.status);
      const patchManifest = await patchRes.json();

      // 4. 校验 base_version
      if (patchManifest.base_version && compareVersions(APP_VERSION, patchManifest.base_version) < 0) {
        return new Response(JSON.stringify({ ok: false, error: `当前版本 ${APP_VERSION} 低于热更基线 ${patchManifest.base_version}，请完整安装` }), { status: 400, headers: jsonHeaders() });
      }

      // 5. 逐个下载并替换文件
      const results = [];
      let needRestart = false;
      // 构建 asset name → API URL 映射（用于私有仓库认证下载）
      // 兼容两种命名：hotpatch_server_monitor.js / 裸文件名 monitor.js
      const assetUrlMap = {};
      (relData.assets || []).forEach(a => { if (a.name) assetUrlMap[a.name] = a.url; });
      for (const file of (patchManifest.files || [])) {
        const targetPath = `${APP_DIR}/${file.path}`;
        const bakPath = targetPath + ".hot-bak";
        try {
          // 优先用 API URL（私有仓库认证下载更可靠）；依次尝试 hotpatch_ 前缀名、裸文件名、manifest 内 url
          const assetName = 'hotpatch_' + file.path.replace(/\//g, '_');
          const baseName = file.path.substring(file.path.lastIndexOf("/") + 1);
          const dlUrl = assetUrlMap[assetName] || assetUrlMap[baseName] || file.url;
          if (!dlUrl) { results.push({ path: file.path, ok: false, error: "Release 中未找到对应资产: " + assetName + " / " + baseName }); continue; }
          // 下载文件内容（私有仓库需认证）
          const fileRes = await fetch(dlUrl, { signal: AbortSignal.timeout(60000), headers: dlHeaders });
          if (!fileRes.ok) { results.push({ path: file.path, ok: false, error: "HTTP " + fileRes.status }); continue; }
          const buf = Buffer.from(await fileRes.arrayBuffer());
          // 备份原文件
          if (existsSync(targetPath)) { try { copyFileSync(targetPath, bakPath); } catch {} }
          // 写入新文件
          const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(targetPath, buf, { mode: 0o644 });
          results.push({ path: file.path, ok: true, size: buf.length });
          if (file.path.indexOf("server/") >= 0 || file.path === "manifest") needRestart = true;
        } catch (fe) {
          results.push({ path: file.path, ok: false, error: fe.message });
        }
      }

      // 6. 持久化版本号（manifest 或兜底覆盖文件），并令当前进程立即上报新版本
      if (patchManifest.version) writeAppVersion(patchManifest.version);

      const allOk = results.every(r => r.ok);
      // 7. 若含后端文件变更：先停掉 gateway/dashboard，再自重启加载新代码。
      //    新 monitor 启动时 maybeAutoStartServices 会全新拉起两者，确保「更新后网关一定重启」，
      //    不依赖旧 pid 存活探测（此前旧网关存活会导致自动启动被跳过）。
      if (allOk && needRestart) {
        try {
          await stopPid(PID_GATEWAY);
          await stopPid(PID_DASHBOARD);
          await forceKillHermes();
          resetGatewayCrashLoop();
          log("[HotPatch] gateway/dashboard 已停止，monitor 自重启后将自动重新拉起");
        } catch (e) { log(`[HotPatch] 停止服务失败（非致命）: ${e && e.message}`); }
        scheduleMonitorRestart("HotPatch", 2000);
      }

      return new Response(JSON.stringify({
        ok: allOk,
        version: patchManifest.version || "",
        need_restart: needRestart,
        results,
        hint: allOk ? (needRestart ? "后端文件已更新，服务将在 2 秒后自动重启" : "UI 文件已更新，刷新浏览器即可生效") : "部分文件更新失败，请检查日志",
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 500, headers: jsonHeaders() });
    }
  }

  if (path === "/api/app/update/token" && req.method === "POST") {
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
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 500, headers: jsonHeaders(),
      });
    }
  }

  if (path === "/api/app/update/dispatch" && req.method === "POST") {
    try {
      const pat = getGitHubPAT();
      if (!pat) {
        return new Response(JSON.stringify({ ok: false, error: "未配置 GitHub PAT，请先在应用更新卡片中设置" }), {
          status: 401, headers: jsonHeaders(),
        });
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
      return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), {
        status: 502, headers: jsonHeaders(),
      });
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
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          html_url: run.html_url,
          created_at: run.created_at,
          name: run.name,
        } : null,
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 502, headers: jsonHeaders(),
      });
    }
  }

  // ─── 完整安装：中转下载最新 Release 的 .fpk 安装包（私有仓库需认证，浏览器无法直接下载） ───
  // 前端「完整安装」按钮打开此 URL → 浏览器下载 fpk → 用户在 fnOS 应用中心手动安装/覆盖。
  // 注意：完整安装不再在服务端自动替换文件（旧 /api/app/update/full 已移除），文件级替换请走「热更新」按钮。
  if (path === "/api/app/update/fpk") {
    try {
      const pat = getGitHubPAT();
      const ghHeaders = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) ghHeaders["Authorization"] = `Bearer ${pat}`;
      const relRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        signal: AbortSignal.timeout(15000), headers: ghHeaders,
      });
      if (!relRes.ok) throw new Error(`GitHub API ${relRes.status}`);
      const relData = await relRes.json();
      const fpkAsset = (relData.assets || []).find(a => /\.fpk$/i.test(a.name || ""));
      if (!fpkAsset) {
        return new Response(JSON.stringify({ ok: false, error: "该版本 Release 没有 .fpk 安装包，请到 GitHub 发布页下载" }), { status: 404, headers: jsonHeaders() });
      }
      const dlHeaders = { "Accept": "application/octet-stream", "User-Agent": "fnos-hermes-agent" };
      if (pat) dlHeaders["Authorization"] = `Bearer ${pat}`;
      const fileRes = await fetch(fpkAsset.url, { signal: AbortSignal.timeout(300000), headers: dlHeaders });
      if (!fileRes.ok) throw new Error(`安装包下载失败: HTTP ${fileRes.status}`);
      const buf = Buffer.from(await fileRes.arrayBuffer());
      log(`[完整安装] 中转下载 fpk 安装包: ${fpkAsset.name} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
      return new Response(buf, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fpkAsset.name}"`,
          "Content-Length": String(buf.length),
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 502, headers: jsonHeaders() });
    }
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

  // 重启网关 + 仪表盘（P0 修复 v0.20.65：配置落盘后必须重启网关以使 provider/API key 生效，
  // 并在拉起前清掉抢占端口的外来 hermes 进程（legacy 兜底；当前主要靠端口迁移到 8742 规避 studio 网关冲突）。
  async function restartHermesServices() {
    try {
      await stopPid(PID_GATEWAY);
      await stopPid(PID_DASHBOARD);
      await forceKillHermes();
      resetGatewayCrashLoop();
      await new Promise(r => setTimeout(r, 1500));
      const r1 = spawnHermes("gateway",   PID_GATEWAY,   ["gateway", "run"]);
      const r2 = spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
      return { gateway: r1, dashboard: r2 };
    } catch (e) {
      log("重启网关/仪表盘失败: " + (e && e.message));
      return { error: String(e && e.message) };
    }
  }

  if (path === "/api/restart" && req.method === "POST") {
    log("Restarting gateway ...");
    const res = await restartHermesServices();
    return new Response(JSON.stringify(res), { headers: jsonHeaders() });
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
      spawnSync("pkill", ["-SIGKILL", "-f", "hermes.*dashboard"]);
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
    const rawLines = url.searchParams.get("lines") || "200";
    const limit = Math.min(Math.max(parseInt(rawLines, 10) || 200, 10), 2000);
    let lines = [], size = 0;
    try {
      if (existsSync(fp)) {
        size = statSync(fp).size;
        lines = readFileSync(fp, "utf8").split("\n").filter(l => l.trim()).slice(-limit);
      }
    } catch {}
    return new Response(JSON.stringify({ lines, size, limit }), { headers: jsonHeaders() });
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

  // ─── Profiles（多 Agent）API ─────────────────────────────────────────────
  // 与 Hermes 官方 profiles 系统完全对齐（参考 hermesagent.org.cn/docs/user-guide/profiles）
  // 每个 profile 是完全隔离的 Hermes 环境：独立 config.yaml、.env、SOUL.md、记忆、会话、技能、网关
  // 通过 `hermes profile create/use/delete` CLI 管理，profile 目录 = DATA_DIR/profiles/<name>/
  const PROFILES_DIR = `${DATA_DIR}/profiles`;

  // ── 辅助：读取某个 profile 目录的详细信息 ──
  function _readProfileInfo(dir, id) {
    let soul = ""; try { soul = readFileSync(`${dir}/SOUL.md`, "utf8"); } catch {}
    let model = "";
    let provider = "";
    try {
      const cfg = readFileSync(`${dir}/config.yaml`, "utf8");
      model = (cfg.match(/^\s*default:\s*(.+)$/m) || [])[1] || "";
      // 尝试提取 model.model 格式
      if (!model) model = (cfg.match(/^\s*model:\s*(.+)$/m) || [])[1] || "";
      provider = (cfg.match(/^\s*provider:\s*(.+)$/m) || [])[1] || "";
    } catch {}
    // 读取 .env 中的 API 密钥（仅检测是否配置，不暴露完整密钥）
    let hasApiKey = false;
    let envKeys = [];
    try {
      const envContent = readFileSync(`${dir}/.env`, "utf8");
      envContent.split("\n").forEach(line => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        const idx = s.indexOf("=");
        if (idx < 0) return;
        const key = s.slice(0, idx).trim();
        if (key) envKeys.push(key);
        if (/API_KEY|TOKEN|SECRET/i.test(key) && s.slice(idx + 1).trim()) hasApiKey = true;
      });
    } catch {}
    // 检测技能目录
    let skills = [];
    try {
      const skillsDir = `${dir}/skills`;
      if (existsSync(skillsDir)) {
        skills = readdirSync(skillsDir).filter(s => {
          try { return statSync(`${skillsDir}/${s}`).isDirectory(); } catch { return false; }
        });
      }
    } catch {}
    // UI 元数据（emoji、显示名等，由 WEBUI 写入）
    let meta = {}; try { meta = JSON.parse(readFileSync(`${dir}/metadata.json`, "utf8")); } catch {}
    return {
      id,
      name: meta.name || id,
      emoji: meta.emoji || "🤖",
      prompt: soul.slice(0, 800),
      model: (model || meta.model || "").trim(),
      provider: (provider || "").trim(),
      has_api_key: hasApiKey,
      env_keys: envKeys,
      skills,
      is_default: false,
    };
  }

  function _listProfiles() {
    const profiles = [];
    // 默认 profile（主目录 DATA_DIR 本身 = ~/.hermes）
    let defaultSoul = ""; try { defaultSoul = readFileSync(`${DATA_DIR}/SOUL.md`, "utf8"); } catch {}
    const mainCfg = _readHermesConfig();
    const mainModel = (mainCfg.match(/^\s*default:\s*(.+)$/m) || [])[1] || "";
    let defaultSkills = [];
    try {
      const sd = `${DATA_DIR}/skills`;
      if (existsSync(sd)) defaultSkills = readdirSync(sd).filter(s => { try { return statSync(`${sd}/${s}`).isDirectory(); } catch { return false; } });
    } catch {}
    profiles.push({
      id: "default",
      name: "默认助手",
      emoji: "🤖",
      prompt: defaultSoul.slice(0, 800),
      model: mainModel.trim(),
      provider: "",
      has_api_key: true,
      env_keys: [],
      skills: defaultSkills,
      is_default: true,
      is_active: _getActiveProfile() === "default",
    });
    // 扫描 profiles 子目录（每个都是 hermes profile create 创建的完整环境）
    try {
      if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
      const dirs = readdirSync(PROFILES_DIR).filter(d => {
        try { return statSync(`${PROFILES_DIR}/${d}`).isDirectory(); } catch { return false; }
      });
      const activeProfile = _getActiveProfile();
      dirs.forEach(d => {
        const info = _readProfileInfo(`${PROFILES_DIR}/${d}`, d);
        info.is_active = activeProfile === d;
        profiles.push(info);
      });
    } catch {}
    return profiles;
  }

  // ── 活跃 profile 检测：优先使用 hermes profile list 解析，兜底 .active_profile 文件 ──
  function _getActiveProfile() {
    // 方式1：解析 hermes profile list 输出（活跃 profile 带 ◆ 前缀）
    // 实际格式: " ◆default         sensenova-6.7-flash-lite     running      —            —"
    try {
      const r = spawnSync(HERMES_BIN, ["profile", "list"], { stdout: "pipe", stderr: "pipe", timeout: 8000 });
      const out = (r.stdout || "").toString();
      if (r.status === 0 && out.trim()) {
        const lines = out.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // 跳过表头和分隔线
          if (!trimmed || trimmed.startsWith("Profile") || trimmed.startsWith("─") || trimmed.startsWith("-")) continue;
          // ◆ 标记 = 当前活跃 profile（可能无空格直接连接名称）
          if (trimmed.includes("◆")) {
            const name = trimmed.replace(/^[\s◆]+/, "").trim().split(/\s+/)[0];
            if (name) return name;
          }
          // 兼容其他可能的标记格式: "* coder" 或 "→ coder" 或 "(active)"
          if (/^[\*→>]\s+/.test(trimmed) || /\(active\)|\(current\)/.test(trimmed)) {
            const name = trimmed.replace(/^[\*→>]\s+/, "").replace(/\s*\(active\)|\s*\(current\)/, "").trim().split(/\s+/)[0];
            if (name && name !== "Profile") return name;
          }
        }
        // 有输出但没找到标记，默认 default
        return "default";
      }
    } catch {}
    // 方式2：兜底读取本地记录文件
    try { return readFileSync(`${DATA_DIR}/.active_profile`, "utf8").trim(); } catch { return "default"; }
  }

  function _setActiveProfile(id) {
    // 使用官方 CLI 切换（设置 sticky default，后续 hermes 命令都指向该 profile）
    try {
      const r = spawnSync(HERMES_BIN, ["profile", "use", id], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
      if (r.status === 0) {
        log(`[profiles] hermes profile use ${id} 成功`);
      } else {
        const err = (r.stderr || "").toString().trim();
        log(`[profiles] hermes profile use ${id} 失败: ${err}`);
      }
    } catch (e) {
      log(`[profiles] hermes profile use 异常: ${e.message}`);
    }
    // 同时写入本地记录文件（供 CLI 不可用时兜底）
    try { writeFileSync(`${DATA_DIR}/.active_profile`, id || "default"); } catch {}
  }

  function _createProfile(id, body) {
    const dir = `${PROFILES_DIR}/${id}`;
    if (existsSync(dir)) return { ok: false, error: "profile '" + id + "' 已存在" };
    // 使用官方 CLI 创建（会生成完整环境：config.yaml、.env、SOUL.md、skills/、命令别名等）
    const args = ["profile", "create", id];
    if (body.clone) args.push("--clone");
    if (body.clone_all) args.push("--clone-all");
    if (body.clone_from) args.push("--clone-from", body.clone_from);
    try {
      const r = spawnSync(HERMES_BIN, args, { stdout: "pipe", stderr: "pipe", timeout: 30000 });
      const out = (r.stdout || "").toString().trim();
      const err = (r.stderr || "").toString().trim();
      if (r.status !== 0) {
        log(`[profiles] hermes profile create ${id} 失败: ${err || out}`);
        // CLI 失败时兜底：手动创建基础目录结构
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/SOUL.md`, body.prompt || `# ${body.name || id}\n你是一个名为 ${body.name || id} 的 AI 助手。\n`);
        writeFileSync(`${dir}/config.yaml`, body.model ? `model:\n  default: ${body.model}\n` : "");
        writeFileSync(`${dir}/.env`, "");
      } else {
        log(`[profiles] hermes profile create ${id} 成功`);
        // CLI 创建成功后，覆盖/追加用户自定义内容
        if (body.prompt) writeFileSync(`${dir}/SOUL.md`, body.prompt);
        if (body.model) {
          // 追加模型配置到 config.yaml
          let cfg = ""; try { cfg = readFileSync(`${dir}/config.yaml`, "utf8"); } catch {}
          if (!cfg.includes("default:")) {
            cfg += `\nmodel:\n  default: ${body.model}\n`;
            writeFileSync(`${dir}/config.yaml`, cfg);
          }
        }
      }
    } catch (e) {
      log(`[profiles] hermes profile create 异常: ${e.message}，使用兜底创建`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/SOUL.md`, body.prompt || `# ${body.name || id}\n`);
      writeFileSync(`${dir}/config.yaml`, body.model ? `model:\n  default: ${body.model}\n` : "");
      writeFileSync(`${dir}/.env`, "");
    }
    // 写入 UI 元数据（emoji、显示名等，Hermes CLI 不管理这些）
    const meta = { name: body.name || id, emoji: body.emoji || "🤖", created_at: Date.now() };
    writeFileSync(`${dir}/metadata.json`, JSON.stringify(meta, null, 2));
    return { ok: true, id };
  }

  function _updateProfile(id, body) {
    if (id === "default") {
      // 默认 profile：更新主目录下的 SOUL.md / config.yaml
      if (body.prompt != null) writeFileSync(`${DATA_DIR}/SOUL.md`, body.prompt);
      if (body.model) {
        // 通过 hermes config set 更新模型（官方方式）
        try { spawnSync(HERMES_BIN, ["config", "set", "model.model", body.model], { stdout: "pipe", stderr: "pipe", timeout: 8000 }); } catch {}
      }
      return { ok: true };
    }
    const dir = `${PROFILES_DIR}/${id}`;
    if (!existsSync(dir)) return { ok: false, error: "profile not found" };
    // 更新 SOUL.md（个性/指令）
    if (body.prompt != null) writeFileSync(`${dir}/SOUL.md`, body.prompt);
    // 更新模型配置
    if (body.model) {
      try {
        // 优先使用 hermes -p <name> config set（官方方式）
        const r = spawnSync(HERMES_BIN, ["-p", id, "config", "set", "model.model", body.model], { stdout: "pipe", stderr: "pipe", timeout: 8000 });
        if (r.status !== 0) throw new Error("cli failed");
      } catch {
        // 兜底：直接写 config.yaml
        let cfg = ""; try { cfg = readFileSync(`${dir}/config.yaml`, "utf8"); } catch {}
        if (cfg.match(/^\s*default:\s*.+$/m)) {
          cfg = cfg.replace(/^(\s*default:\s*).+$/m, `$1${body.model}`);
        } else {
          cfg += `\nmodel:\n  default: ${body.model}\n`;
        }
        writeFileSync(`${dir}/config.yaml`, cfg);
      }
    }
    // 更新 .env（API 密钥等）
    if (body.env && typeof body.env === "object") {
      let envContent = ""; try { envContent = readFileSync(`${dir}/.env`, "utf8"); } catch {}
      const envLines = envContent.split("\n");
      const envMap = {};
      envLines.forEach(line => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        const idx = s.indexOf("=");
        if (idx > 0) envMap[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
      });
      Object.keys(body.env).forEach(k => { if (body.env[k] != null) envMap[k] = body.env[k]; });
      const newEnv = Object.keys(envMap).map(k => `${k}=${envMap[k]}`).join("\n") + "\n";
      writeFileSync(`${dir}/.env`, newEnv);
    }
    // 更新 UI 元数据
    let meta = {}; try { meta = JSON.parse(readFileSync(`${dir}/metadata.json`, "utf8")); } catch {}
    if (body.name != null) meta.name = body.name;
    if (body.emoji != null) meta.emoji = body.emoji;
    meta.updated_at = Date.now();
    writeFileSync(`${dir}/metadata.json`, JSON.stringify(meta, null, 2));
    return { ok: true };
  }

  function _deleteProfile(id) {
    if (id === "default") return { ok: false, error: "无法删除默认 profile（~/.hermes）" };
    const dir = `${PROFILES_DIR}/${id}`;
    if (!existsSync(dir)) return { ok: false, error: "profile not found" };
    // 使用官方 CLI 删除（会停止网关、移除 systemd 服务、删除命令别名）
    try {
      const r = spawnSync(HERMES_BIN, ["profile", "delete", id, "--yes"], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
      if (r.status === 0) {
        log(`[profiles] hermes profile delete ${id} 成功`);
      } else {
        const err = (r.stderr || "").toString().trim();
        log(`[profiles] hermes profile delete ${id} CLI 失败(${err})，手动删除目录`);
        rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      log(`[profiles] hermes profile delete 异常: ${e.message}，手动删除`);
      try { rmSync(dir, { recursive: true, force: true }); } catch (e2) { return { ok: false, error: e2.message }; }
    }
    if (_getActiveProfile() === id) _setActiveProfile("default");
    return { ok: true };
  }

  // GET /api/profiles → 列出所有 profiles（与 hermes profile list 对齐）
  if (path === "/api/profiles" && req.method === "GET") {
    try {
      return new Response(JSON.stringify({ ok: true, profiles: _listProfiles(), active: _getActiveProfile() }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/profiles → 创建 profile（调用 hermes profile create）
  if (path === "/api/profiles" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const id = (body.id || body.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || ("agent_" + Date.now());
      const r = _createProfile(id, body);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // PUT /api/profiles/:id → 更新 profile（SOUL.md / config / .env）
  const profileUpdateMatch = path.match(/^\/api\/profiles\/([a-zA-Z0-9_-]+)$/);
  if (profileUpdateMatch && req.method === "PUT") {
    try {
      const body = await req.json().catch(() => ({}));
      const r = _updateProfile(profileUpdateMatch[1], body);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 404, headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // DELETE /api/profiles/:id → 删除 profile（调用 hermes profile delete）
  if (profileUpdateMatch && req.method === "DELETE") {
    try {
      const r = _deleteProfile(profileUpdateMatch[1]);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/profiles/:id/activate → 切换活跃 profile（调用 hermes profile use）
  const profileActivateMatch = path.match(/^\/api\/profiles\/([a-zA-Z0-9_-]+)\/activate$/);
  if (profileActivateMatch && req.method === "POST") {
    try {
      const id = profileActivateMatch[1];
      if (id !== "default" && !existsSync(`${PROFILES_DIR}/${id}`)) {
        return new Response(JSON.stringify({ ok: false, error: "profile not found" }), { status: 404, headers: jsonHeaders() });
      }
      _setActiveProfile(id);
      // 切换 profile 后触发网关重启以加载新 profile 的配置
      _triggerGatewayRestart("profile-switch-" + id);
      return new Response(JSON.stringify({ ok: true, active: id }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // GET /api/profiles/:id/env → 读取 profile 的 .env 键值（脱敏）
  const profileEnvMatch = path.match(/^\/api\/profiles\/([a-zA-Z0-9_-]+)\/env$/);
  if (profileEnvMatch && req.method === "GET") {
    try {
      const id = profileEnvMatch[1];
      const envPath = id === "default" ? `${DATA_DIR}/.env` : `${PROFILES_DIR}/${id}/.env`;
      const envObj = {};
      try {
        const content = readFileSync(envPath, "utf8");
        content.split("\n").forEach(line => {
          const s = line.trim();
          if (!s || s.startsWith("#")) return;
          const idx = s.indexOf("=");
          if (idx < 0) return;
          const key = s.slice(0, idx).trim();
          const val = s.slice(idx + 1).trim();
          // 脱敏：只显示前4位 + ***
          envObj[key] = val.length > 8 ? val.slice(0, 4) + "****" : (val ? "****" : "");
        });
      } catch {}
      return new Response(JSON.stringify({ ok: true, env: envObj }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
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
  // 通过 _setTopLevelBlock 写入：兼容 inline 与 block 形态，并清除重复顶层键
  function _setYamlListBlock(content, key, items){
    const block = `${key}:\n` + items.map(it => `  - ${_yamlScalarSafe(it)}`).join("\n");
    return _setTopLevelBlock(content, key, block);
  }

  // 替换/新增 config.yaml 顶层「映射」块（如 mcp_servers:）
  // 通过 _setTopLevelBlock 写入：兼容 inline（key: {}）与 block 形态，并清除重复顶层键
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
    return _setTopLevelBlock(content, key, block);
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
  // 兼容 block 形态（key:\n 缩进内容）与 inline 形态（key: {} / key: value）
  function _yamlBlockOf(yml, key){
    const m = yml.match(new RegExp("^" + key + ":\\n([\\s\\S]*?)(?=^[a-zA-Z_]+:|\\Z)", "m"));
    if (m) return m[1];
    const im = yml.match(new RegExp("^" + key + ":\\s*\\{[^\\n]*\\}\\s*$", "m"));
    if (im) return "";
    const iv = yml.match(new RegExp("^" + key + ":\\s*([^\\n]*)\\s*$", "m"));
    if (iv) return iv[1] + "\n";
    return "";
  }

  // 从 config.yaml 顶层「列表」块提取条目数组（如 toolsets:）
  function _extractYamlList(content, key){
    const block = _yamlBlockOf(content, key);
    if (!block) return [];
    const out = [];
    block.split("\n").forEach(function(line){
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m){
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out.push(v);
      }
    });
    return out;
  }

  // 写 / 替换 config.yaml 顶层「扁平映射」块（如 memory: 下直接是标量）
  // 通过 _setTopLevelBlock 写入：兼容 inline 与 block 形态，并清除重复顶层键
  function _setYamlFlatMap(content, key, obj){
    const items = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
    const block = items.length
      ? key + ":\n" + items.map(k => "  " + k + ": " + _yamlScalarSafe(obj[k])).join("\n")
      : key + ": {}";
    return _setTopLevelBlock(content, key, block);
  }

  // ── 健壮替换/删除 config.yaml 顶层块（消除重复顶层键，根因修复）──
  // newBlock 为空（falsy 或纯空白）表示「删除该顶层块」；否则整体替换为 newBlock（不含尾随换行）。
  // 同时兼容 block 形态（key: 换行缩进）与 inline 形态（key: {…} / key: value），
  // 并跳过所有重复的顶层键——重复的 model:/providers: 正是网关报
  // "No inference provider configured" 进而 Dashboard 502 的根因。
  function _isTopLevelKey(line, key) {
    if (/^\s/.test(line)) return false;          // 缩进的行不是顶层键
    if (line === key + ":") return true;
    if (line.startsWith(key + ":")) return true; // 含 inline 形态 key: value / key: {…}
    return false;
  }
  function _setTopLevelBlock(content, key, newBlock) {
    const lines = content.split("\n");
    const out = [];
    let inserted = false;
    const removeOnly = !newBlock || !String(newBlock).trim();
    let firstIdx = -1;
    for (let k = 0; k < lines.length; k++) {
      if (_isTopLevelKey(lines[k], key)) { firstIdx = k; break; }
    }
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      if (_isTopLevelKey(line, key)) {
        const isFirst = (k === firstIdx);
        if (isFirst && !inserted && !removeOnly) { out.push(newBlock); inserted = true; }
        // 跳过该顶层块的整段（block: 后续缩进行；inline: 仅本行）
        if (line === key + ":") {
          let j = k + 1;
          while (j < lines.length && (lines[j].startsWith(" ") || lines[j].startsWith("\t"))) j++;
          k = j - 1; // for 循环会执行 k++
        }
        continue;
      }
      out.push(line);
    }
    if (!inserted && !removeOnly) out.push(newBlock); // 无任何现存块：追加到末尾
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

  // 调用 hermes skills list --source all 解析已安装技能（Name | Category | Source | Trust | Status）
  function _listHermesSkills(){
    try {
      const r = spawnSync(HERMES_BIN, ["skills", "list", "--source", "all"], {
        stdout: "pipe", stderr: "pipe",
        env: { ...process.env, HOME: DATA_DIR, HERMES_HOME: DATA_DIR }
      });
      const out = (r.stdout ? r.stdout.toString() : "") || (r.stderr ? r.stderr.toString() : "");
      const skills = [];
      out.split("\n").forEach(line => {
        const parts = line.split("│").map(s => s.trim()).filter(Boolean);
        if (parts.length < 5) return;
        const name = parts[0], category = parts[1], source = parts[2], trust = parts[3], status = parts[4];
        if (name === "Name" || source === "Source" || !name || !source) return;
        skills.push({ name, category, source, trust, status });
      });
      return skills;
    } catch (e) { return []; }
  }

  // ── 平台频道配置读写（~/.hermes/.env + ~/.hermes/config.yaml）──
  function _readEnvFile(){
    try { if (existsSync(HERMES_ENV)) return readFileSync(HERMES_ENV, "utf8"); } catch (e) {}
    return "";
  }
  function _writeEnvFile(content){
    try { writeFileSync(HERMES_ENV, content, { mode: 0o600 }); return true; } catch (e) { return false; }
  }
  function _getEnvValue(content, key){
    const m = content.match(new RegExp("^" + key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\s*=\\s*(.+)$", "m"));
    return m ? m[1].trim() : "";
  }
  function _setEnvValue(content, key, value){
    const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = key + "=" + (value || "");
    if (content.match(new RegExp("^" + safeKey + "\\s*=", "m"))) {
      return content.replace(new RegExp("^" + safeKey + "\\s*=.*$", "m"), line);
    }
    return (content ? content.replace(/\n?$/, "\n") : "") + line + "\n";
  }
  // ── 连接器凭证存储（DATA_DIR/connectors-state.json，权限 0o600）──
  // CONNECTORS_STATE 常量已在模块级定义（模块级 MCP 自动注册需要直接访问）
  function _readConnectorsState(){
    try { if (existsSync(CONNECTORS_STATE)) return JSON.parse(readFileSync(CONNECTORS_STATE, "utf8") || "{}"); } catch (e) {}
    return {};
  }
  function _writeConnectorsState(obj){
    try { writeFileSync(CONNECTORS_STATE, JSON.stringify(obj, null, 2), { mode: 0o600 }); return true; } catch (e) { return false; }
  }
  // 解析现有 mcp_servers 顶层映射块为 { name: {url, headers:{...}} }
  function _parseMcpServers(yml){
    const block = _yamlBlockOf(yml, "mcp_servers");
    const obj = {};
    if (!block.trim()) return obj;
    const lines = block.split("\n");
    let curName = null, curEntry = null, inHeaders = false, inList = null;
    for (const line of lines){
      const nm = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (nm && !inHeaders){
        if (curName) obj[curName] = curEntry;
        curName = nm[1]; curEntry = {}; inHeaders = false; inList = null; continue;
      }
      // list item (6-space indent + dash): collect into current list key
      const li = line.match(/^      -\s*(.*)$/);
      if (li && curEntry && inList){
        let val = li[1].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        curEntry[inList].push(val);
        continue;
      }
      const sk = line.match(/^    ([A-Za-z0-9_-]+):\s*(.*)$/);
      if (sk && curName && curEntry){
        const k = sk[1], v = sk[2].trim();
        if (k === "headers"){ curEntry.headers = {}; inHeaders = true; inList = null; continue; }
        inHeaders = false;
        if (v === ""){ curEntry[k] = []; inList = k; } else { curEntry[k] = v; inList = null; }
        continue;
      }
      const hk = line.match(/^      ([A-Za-z0-9_-]+):\s*(.*)$/);
      if (hk && curEntry && curEntry.headers && typeof curEntry.headers === "object"){
        curEntry.headers[hk[1]] = hk[2].trim(); inList = null;
      }
    }
    if (curName) obj[curName] = curEntry;
    return obj;
  }
  // 合并写入 mcp_servers（保留用户其它条目，仅增/改/删本连接器对应项）
  function _upsertMcpServer(name, entry){
    let yml = _readHermesConfig();
    const obj = _parseMcpServers(yml);
    if (entry == null) delete obj[name];
    else obj[name] = entry;
    yml = _setYamlMapBlock(yml, "mcp_servers", obj);
    _writeHermesConfig(yml);
  }
  function _readHermesConfig(){
    try { if (existsSync(HERMES_CONFIG)) return readFileSync(HERMES_CONFIG, "utf8"); } catch (e) {}
    return "";
  }
  function _writeHermesConfig(content){
    try { writeFileSync(HERMES_CONFIG, content, { mode: 0o644 }); return true; } catch (e) { return false; }
  }
  // ── YAML 标量安全引用（保留 token 中的 : # 等字符）──
  function _yamlQuote(v){
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
  function _yamlUnquote(s){
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~" || s === "") return null;
    if ((s[0] === '"' && s[s.length-1] === '"') || (s[0] === "'" && s[s.length-1] === "'")) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return s;
  }
  function _objToYaml(obj, spaces){
    const pad = " ".repeat(spaces);
    let out = "";
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v === undefined || v === null) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        out += pad + k + ":\n" + _objToYaml(v, spaces + 2);
      } else if (Array.isArray(v)) {
        out += pad + k + (v.length ? ":\n" + v.map(x => pad + "  - " + _yamlQuote(x) + "\n").join("") : ": []\n");
      } else {
        out += pad + k + ": " + _yamlQuote(v) + "\n";
      }
    }
    return out;
  }
  function _setValByPath(obj, path, val){
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; cur[p] = (cur[p] && typeof cur[p] === "object") ? cur[p] : {}; cur = cur[p]; }
    cur[parts[parts.length - 1]] = val;
  }
  function _getValByPath(obj, path){
    const parts = path.split("."); let cur = obj;
    for (const p of parts) { if (cur == null || typeof cur !== "object") return undefined; cur = cur[p]; }
    return cur;
  }
  // 读取 config.yaml 中 platforms.<id> 下的嵌套键值
  function _readPlatformConfig(id){
    const yml = _readHermesConfig();
    const re = new RegExp("^  " + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(?:\\n((?:    .*(?:\\n      .*)*\\n?)*))?", "m");
    const m = yml.match(re);
    if (!m || !m[1]) return {};
    const obj = {};
    let curObj = null;
    m[1].split("\n").forEach(l => {
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
  function _setPlatformConfig(id, obj){
    const block = "  " + id + ":\n" + _objToYaml(obj, 4);
    let yml = _readHermesConfig();
    if (!/^platforms:/m.test(yml)) {
      yml = (yml ? yml.replace(/\n?$/, "\n") : "") + "platforms:\n" + block;
      return yml;
    }
    // 定位 platforms: 段，按行解析各平台块，仅重建该段（保留其它顶层配置）
    const lines = yml.split("\n");
    let header = -1;
    for (let i = 0; i < lines.length; i++) { if (/^platforms:\s*$/.test(lines[i])) { header = i; break; } }
    if (header < 0) { yml = yml.replace(/\n?$/, "\n") + "platforms:\n" + block; return yml; }
    // 记录每个 2 空格平台块的 [起始行, 结束行]，并保留出现顺序
    const order = [];
    const blocks = {};
    let curId = null, curStart = null, suffixStart = lines.length;
    for (let i = header + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^[a-zA-Z_]/.test(l)) { // 顶层键 → platforms 段结束，记录后缀起点
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
    if (curId !== null && suffixStart === lines.length) blocks[curId].e = lines.length - 1; // 段延伸到文件末尾
    const newLines = [];
    for (let i = 0; i <= header; i++) newLines.push(lines[i]);
    let wroteTarget = false;
    order.forEach(pid => {
      if (pid === id) { newLines.push(block.replace(/\n$/, "")); wroteTarget = true; }
      else { for (let i = blocks[pid].s; i <= blocks[pid].e; i++) newLines.push(lines[i]); }
    });
    if (!wroteTarget) newLines.push(block.replace(/\n$/, ""));
    for (let i = suffixStart; i < lines.length; i++) newLines.push(lines[i]); // 保留 platforms 段之后的其它顶层配置
    return newLines.join("\n") + "\n";
  }

  // ─── 通讯平台 QR 扫码登录辅助函数 ────────────────────────────────────────
  function _findHermesRoot(){
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
  function _findWhatsAppBridgeDir(){
    const root = _findHermesRoot();
    if (root && existsSync(`${root}/scripts/whatsapp-bridge/bridge.js`)) return `${root}/scripts/whatsapp-bridge`;
    return null;
  }
  function _findNpmBin(){
    if (!resolvedNodeBin) return null;
    const nodeDir = resolvedNodeBin.replace(/[\\/][^\\/]+$/, "");
    const checked = [];
    // 1) 与 node 同目录的可执行 npm（Linux/macOS 官方发行版）
    const siblingNpm = nodeDir + "/npm";
    checked.push(siblingNpm);
    if (existsSync(siblingNpm)) return { npm: siblingNpm, isScript: false, node: resolvedNodeBin };
    // Windows 开发环境：npm.cmd / npm.ps1
    if (process.platform === "win32") {
      const baseDir = nodeDir.replace(/[\\/]node$/, "");
      const siblingNpmCmd = baseDir + "/npm.cmd";
      checked.push(siblingNpmCmd);
      if (existsSync(siblingNpmCmd)) return { npm: siblingNpmCmd, isScript: false, node: resolvedNodeBin };
      const siblingNpmPs1 = baseDir + "/npm.ps1";
      checked.push(siblingNpmPs1);
      if (existsSync(siblingNpmPs1)) return { npm: siblingNpmPs1, isScript: false, node: resolvedNodeBin };
    }
    // 2) Node.js 发行版自带的 npm-cli.js（最可靠 fallback，很多打包环境只放 node，不放 npm 可执行文件）
    const npmCliScript = resolvePath(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    checked.push(npmCliScript);
    if (existsSync(npmCliScript)) return { npm: npmCliScript, isScript: true, node: resolvedNodeBin };
    // 3) PATH 中的 npm
    try {
      const r = spawnSync("sh", ["-c", "command -v npm"], { stdout: "pipe", stderr: "pipe" });
      const out = (r.stdout || "").toString().trim();
      if (out && existsSync(out)) return { npm: out, isScript: false, node: resolvedNodeBin };
    } catch {}
    // 4) 常见绝对路径
    const NPM_CANDIDATES = [
      "/var/apps/nodejs_v24/target/bin/npm",
      "/var/apps/nodejs_v22/target/bin/npm",
      "/var/apps/nodejs_v20/target/bin/npm",
      "/var/apps/nodejs/target/bin/npm",
      "/usr/local/bin/npm",
      "/usr/bin/npm",
      "/opt/bin/npm"
    ];
    for (const p of NPM_CANDIDATES) {
      checked.push(p);
      if (existsSync(p)) return { npm: p, isScript: false, node: resolvedNodeBin };
    }
    log(`[whatsapp] npm not found; resolvedNodeBin=${resolvedNodeBin}; checked=${checked.join(", ")}`);
    return null;
  }
  function _ensureWhatsAppBridgeDeps(bridgeDir){
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
      if (result.exitCode !== 0){
        const err = (result.stderr || "").toString().trim() || "npm install 返回非零退出码";
        throw new Error("安装 WhatsApp bridge 依赖失败：" + err);
      }
      return true;
    } catch (e) {
      if (e && e.message) throw e;
      throw new Error("安装 WhatsApp bridge 依赖失败，请检查网络");
    }
  }
  function _spawnWhatsAppPairing(sessionDir, mode){
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
  function _terminateProc(proc){
    if (!proc) return;
    try { if (proc.pid) process.kill(proc.pid, "SIGTERM"); } catch {}
    try { proc.kill(); } catch {}
  }
  function _watchWhatsAppPairing(pairing_id, proc){
    if (!proc || !proc.stdout) return;
    try {
      const reader = proc.stdout ? Readable.toWeb(proc.stdout).getReader() : null;
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
        // 进程结束处理
        try { await new Promise((resolve) => proc.on("exit", resolve)); } catch {}
        const rec = _whatsappPairings.get(pairing_id);
        if (!rec || rec.proc !== proc) return;
        if (!["connected", "error", "expired", "cancelled"].includes(rec.status)) {
          rec.status = "error"; rec.error = "WhatsApp 配对进程意外退出";
        }
      };
      processChunk();
    } catch {}
  }
  function _pruneTelegramPairings(){
    const now = Date.now();
    for (const [id, rec] of _telegramPairings) { if (rec.expires_at_ts <= now) _telegramPairings.delete(id); }
  }
  function _pruneWhatsAppPairings(){
    const now = Date.now();
    const terminal = {"connected":1,"error":1,"expired":1,"cancelled":1};
    for (const [id, rec] of _whatsappPairings) {
      if (!terminal[rec.status] && rec.expires_at_ts <= now) {
        rec.status = "expired"; rec.error = "二维码已过期，请重新配对";
        _terminateProc(rec.proc);
      }
      if (terminal[rec.status] && rec.expires_at_ts + 300000 <= now) _whatsappPairings.delete(id);
    }
  }
  function _normalizeTelegramUserId(value){
    const s = String(value || "").trim();
    if (/^\d+$/.test(s)) return s;
    return null;
  }
  function _normalizeWhatsAppAllowedUsers(value){
    const s = String(value || "").trim();
    if (!s) return "";
    const parts = s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (p === "*") { out.push("*"); continue; }
      const digits = p.replace(/\D/g, "");
      if (digits) out.push(digits);
    }
    return out.join(",");
  }

  function _listChannels(){
    const env = _readEnvFile();
    const out = {};
    Object.keys(CHANNEL_DEFS).forEach(id => {
      const def = CHANNEL_DEFS[id];
      const cfg = _readPlatformConfig(id);
      let configured = false;
      (def.fields || []).forEach(f => { if (f.env && _getEnvValue(env, f.env)) configured = true; });
      if (id === "whatsapp" && (_getEnvValue(env, "WHATSAPP_ENABLED") || cfg.enabled === "true" || cfg.enabled === true)) configured = true;
      if (id === "weixin") configured = !!_getEnvValue(env, "WEIXIN_TOKEN");
      out[id] = {
        id, name: def.name, icon: def.icon, configured, qrLogin: !!def.qrLogin, note: def.note || "",
        last_configured_at: (cfg && cfg.updated_at) ? cfg.updated_at : null,
        credentials: (def.fields || []).filter(f => f.env).map(f => ({ env: f.env, path: f.path, label: f.label, value: _getEnvValue(env, f.env) || "" })),
        config: cfg
      };
    });
    return out;
  }
  function _saveChannel(id, body){
    const def = CHANNEL_DEFS[id]; if (!def) return { ok: false, error: "unknown channel" };
    let env = _readEnvFile();
    const cfg = _readPlatformConfig(id);
    // 凭证字段：写 .env + 写 platforms.<id>.<path>
    (def.fields || []).forEach(f => {
      if (!f.env) return;
      const v = (body.credentials && body.credentials[f.env] != null) ? body.credentials[f.env]
              : (body.config && _getValByPath(body.config, f.path) != null ? _getValByPath(body.config, f.path) : null);
      if (v == null) return;
      env = _setEnvValue(env, f.env, v || "");
      if (f.path) _setValByPath(cfg, f.path, v || "");
    });
    _writeEnvFile(env);
    // 行为开关
    if (body.toggles && typeof body.toggles === "object") {
      Object.keys(body.toggles).forEach(p => { const v = body.toggles[p]; if (v != null) _setValByPath(cfg, p, v); });
    }
    // 其余 config（非凭证字段）兜底写入
    if (body.config && typeof body.config === "object") {
      Object.keys(body.config).forEach(p => {
        if ((def.fields || []).some(f => f.path === p)) return;
        const v = body.config[p]; if (v != null) _setValByPath(cfg, p, v);
      });
    }
    cfg.updated_at = Date.now();
    _writeHermesConfig(_setPlatformConfig(id, cfg));
    return { ok: true };
  }

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

  // 从远程 HTML 中提取技能 / 专家包链接（SkillHub / agentskills.io 风格卡片）
  function _extractSkillLinks(html, base, type){
    const items = []; const seen = {};
    // 先尝试解析 SkillHub 卡片结构：<a href="...">...<div class="...">标题</div>...描述...</a>
    const cardRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = cardRe.exec(html)) !== null){
      const href = m[1];
      const raw = m[2];
      if (!/(\/skills?\/|\/skillspackage|\/skill-package|\/skill\/)/i.test(href)) continue;
      const abs = _absUrl(href, base);
      if (seen[abs]) continue;
      seen[abs] = true;

      // 清理标签但保留换行
      let text = raw.replace(/<script[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, "\n")
                    .replace(/\n+/g, "\n")
                    .trim();
      const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(l => l.length > 0 && l !== "SkillHub");

      // 标题：第一行非 SkillHub / 认证标记 / 分类标记的文本
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

  // ── Hermes 官方技能目录（从 GitHub 仓库 Markdown 解析）──
  const HERMES_CATALOG_CACHE = { ts: 0, data: null };
  const HERMES_CATALOG_TTL = 10 * 60 * 1000;
  const HERMES_CATALOG_URLS = {
    bundled: [
      "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/skills-catalog.md",
      "https://cdn.jsdelivr.net/gh/NousResearch/hermes-agent@main/website/docs/reference/skills-catalog.md"
    ],
    optional: [
      "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/optional-skills-catalog.md",
      "https://cdn.jsdelivr.net/gh/NousResearch/hermes-agent@main/website/docs/reference/optional-skills-catalog.md"
    ]
  };
  async function _fetchTextWithFallback(urls){
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
        if (r.ok) return await r.text();
      } catch (e) {}
    }
    throw new Error("无法获取 Hermes 技能目录");
  }
  function _parseHermesCatalog(md, kind){
    const items = [];
    let category = "";
    const lines = md.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const heading = line.match(/^#{2,3}\s+(.+)$/);
      if (heading) { category = heading[1].trim(); continue; }
      if (line.startsWith("|") && /Skill\s*\|/.test(line) && /Description\s*\|/.test(line)) { i++; continue; }
      if (line.startsWith("|")) {
        const cols = line.split("|").map(s => s.trim()).filter(s => s.length > 0);
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
  async function _getHermesCatalog(){
    const now = Date.now();
    if (HERMES_CATALOG_CACHE.data && (now - HERMES_CATALOG_CACHE.ts) < HERMES_CATALOG_TTL) return HERMES_CATALOG_CACHE.data;
    const [bundledMd, optionalMd] = await Promise.all([
      _fetchTextWithFallback(HERMES_CATALOG_URLS.bundled),
      _fetchTextWithFallback(HERMES_CATALOG_URLS.optional)
    ]);
    const data = { bundled: _parseHermesCatalog(bundledMd, "bundled"), optional: _parseHermesCatalog(optionalMd, "optional"), fetchedAt: now };
    HERMES_CATALOG_CACHE.data = data;
    HERMES_CATALOG_CACHE.ts = now;
    return data;
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
          let envContent = readFileSync(envProvPath, "utf8");
          Object.keys(PROVIDER_API_KEYS).forEach(id => {
            const envKey = PROVIDER_API_KEYS[id];
            const m = envContent.match(new RegExp(`^${envKey}=(.*)$`, "m"));
            if (m && m[1].length > 0) envApiKeys[id] = m[1];
          });
          const customRe = /^CUSTOM_(?:PROVIDER_)?([A-Z0-9_]+)_API_KEY=(.+)$/gm;
          let cm;
          while ((cm = customRe.exec(envContent)) !== null) {
            // 保留下划线（与 provider ID 格式一致：custom_xxx）
            const customId = "custom_" + cm[1].toLowerCase();
            if (!envApiKeys[customId]) envApiKeys[customId] = cm[2];
          }
          // 迁移：修复双前缀 CUSTOM_CUSTOM_* → CUSTOM_*（历史 bug 导致）
          if (/^CUSTOM_CUSTOM_/m.test(envContent)) {
            envContent = envContent.replace(/^CUSTOM_CUSTOM_/gm, 'CUSTOM_');
            try { writeFileSync(envProvPath, envContent); log('[env.providers] 已迁移双前缀 CUSTOM_CUSTOM_ → CUSTOM_'); } catch {}
          }
        }
      } catch (e) {}

      if (existsSync(statePath)) {
        const stateYaml = readFileSync(statePath, "utf8");
        // 解析格式: providers:\n  id:\n    model: xxx\n    base_url: yyy\n    name: "zzz"
        const blockMatch = stateYaml.match(/^providers:\n([\s\S]*)$/m);
        if (blockMatch) {
          const lines = blockMatch[1].split("\n");
          let currentId = null, currentModel = "", currentBaseUrl = "", currentName = "", currentTemp = null, currentMax = null;
          lines.forEach(line => {
            const keyMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
            if (keyMatch) {
              // 保存上一个
              if (currentId && currentModel) {
                provModelMap[currentId] = { model: currentModel, base_url: currentBaseUrl || "", name: currentName || "", temperature: currentTemp, max_tokens: currentMax };
              }
              currentId = keyMatch[1]; currentModel = ""; currentBaseUrl = ""; currentName = ""; currentTemp = null; currentMax = null;
              return;
            }
            const m = line.match(/^    model:\s*(.+)\s*$/);
            if (m && currentId) { currentModel = m[1].trim(); return; }
            const b = line.match(/^    base_url:\s*(.+)\s*$/);
            if (b && currentId) { currentBaseUrl = b[1].trim(); return; }
            const n = line.match(/^    name:\s*(.+)\s*$/);
            if (n && currentId) { try { currentName = JSON.parse(n[1].trim()); } catch { currentName = n[1].trim(); } }
            const t = line.match(/^    temperature:\s*(.+)\s*$/);
            if (t && currentId) { const tv = parseFloat(t[1].trim()); if (!isNaN(tv)) currentTemp = tv; }
            const x = line.match(/^    max_tokens:\s*(.+)\s*$/);
            if (x && currentId) { const xv = parseInt(x[1].trim(), 10); if (!isNaN(xv)) currentMax = xv; }
          });
          if (currentId && currentModel) {
            provModelMap[currentId] = { model: currentModel, base_url: currentBaseUrl || "", name: currentName || "", temperature: currentTemp, max_tokens: currentMax };
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

      // ── 读取完整模型列表（provider-models.json）────────────────────────
      let provModelsMap = {};
      try {
        const modelsPath = `${VAR_DIR}/provider-models.json`;
        if (existsSync(modelsPath)) {
          provModelsMap = JSON.parse(readFileSync(modelsPath, "utf8"));
        }
      } catch (e) { provModelsMap = {}; }

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
          models: Array.isArray(provModelsMap[id]) ? provModelsMap[id] : [],
          temperature: info.temperature ?? 0.7,
          max_tokens: info.max_tokens ?? 4096,
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
      const dirSkills = [];
      dirs.forEach(d => { if (_isDir(d)) _readSkillFrontmatter(d).forEach(s => dirSkills.push({ name: s.name, description: s.description, emoji: s.emoji, dir: s.dir, file: s.file, origin: "dir" })); });
      const hermesSkills = _listHermesSkills().map(s => ({
        name: s.name, category: s.category, source: s.source, trust: s.trust,
        status: s.status, emoji: "", description: "", origin: "hermes"
      }));
      // 去重：Hermes  skills 为主，目录扫描补充
      const seen = new Set();
      const skills = [];
      hermesSkills.forEach(s => { seen.add(s.name); skills.push(s); });
      dirSkills.forEach(s => { if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); } });
      return new Response(JSON.stringify({ ok: true, skills, dirs, hermesCount: hermesSkills.length, dirCount: dirSkills.length }), { headers: jsonHeaders() });
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
      // embed 模式：如果页面是客户端渲染 SPA（仅有 loading 骨架），内嵌无法执行其 JS，改为返回提示
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

  // ── SkillHub 技能 / 专家包搜索（官方 API：GET /api/skills?keyword=&type=package）──
  if (path === "/api/extensions/skills/search" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const keyword = (u.searchParams.get("keyword") || "").trim();
      const type = u.searchParams.get("type") || "skills"; // skills | packages
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
      const items = arr.map(function(it){
        const nsObj = (typeof it.namespace === "object" && it.namespace) ? it.namespace : null;
        const canonical = (nsObj && nsObj.canonicalName) ? nsObj.canonicalName : ("@" + (it.ownerName || "user") + "/" + (it.slug || ""));
        const desc = it.description_zh || it.description || "";
        const subcats = Array.isArray(it.subCategories) ? it.subCategories.map(function(s){ return (s && s.name) ? s.name : ""; }).filter(Boolean) : [];
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

  // ── Hermes 官方技能目录搜索（解析 GitHub Markdown）──
  if (path === "/api/extensions/skills/hermes-catalog" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const keyword = (u.searchParams.get("keyword") || "").trim().toLowerCase();
      const type = u.searchParams.get("type") || "all"; // bundled | optional | all
      const catalog = await _getHermesCatalog();
      let arr = [];
      if (type === "bundled" || type === "all") arr = arr.concat(catalog.bundled);
      if (type === "optional" || type === "all") arr = arr.concat(catalog.optional);
      if (keyword) {
        arr = arr.filter(it => ((it.name + " " + it.category + " " + it.description).toLowerCase().indexOf(keyword) !== -1));
      }
      return new Response(JSON.stringify({ ok: true, type, keyword, total: arr.length, items: arr.slice(0, 100) }), { headers: jsonHeaders() });
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

  // ── 连接器/技能市场：精选目录（连接器能力改由 SkillHub 技能交付，技能由网关原生加载，根治「调用失败」）──
  // 每条目：id（安装目录名）/name/icon/desc/slug/namespace/guide_url（获取指引外链）/cred_hint（凭证提示）/official（官方认证）/mcp（MCP 型技能的服务器与凭证字段）
  const SKILL_MARKET_CATALOG = [
    { id: "ima", name: "腾讯 IMA", icon: "📚", desc: "腾讯 IMA 笔记 / 知识库读写与智能检索", slug: "ima-skills", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/ima-skills", cred_hint: "IMA API Key", official: true },
    { id: "tencent-news", name: "腾讯新闻", icon: "📰", desc: "7×24 实时新闻搜索与热点追踪", slug: "tencent-news", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/tencent-news", cred_hint: "腾讯新闻 API Key", official: true },
    { id: "tencent-docs", name: "腾讯文档", icon: "📝", desc: "docs.qq.com 文档读写 / 协作全功能", slug: "tencent-docs", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/tencent-docs", cred_hint: "腾讯文档 API Key", official: true },
    { id: "wecom", name: "企业微信", icon: "💼", desc: "通讯录 / 消息 / 文档 / 日程 / 会议 / 待办", slug: "wecom-unified", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/wecom-unified", cred_hint: "企业微信 Bot ID / Secret", official: true },
    { id: "tencent-meeting", name: "腾讯会议", icon: "🎥", desc: "会议预约 / 纪要 / 转写 / 录制", slug: "tencent-meeting-skill", namespace: "@wemeeting", guide_url: "https://www.skillhub.cn/skills/wemeeting/tencent-meeting-skill", cred_hint: "腾讯会议身份认证 Token", official: true },
    { id: "mail", name: "个人邮箱", icon: "📧", desc: "QQ / 网易 / Gmail / 新浪 / 搜狐 邮箱（Agently Mail）", slug: "agently-mail", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/agently-mail", cred_hint: "邮箱授权码 / 应用专用密码", official: true },
    { id: "tencent-esign", name: "腾讯电子签", icon: "✍️", desc: "合同起草 / 审查 / 对比 / 法条法规检索", slug: "tencent-esign-contract", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/tencent-esign-contract", cred_hint: "SIGN-TOKEN（qian.tencent.com/aiSkill 获取）", official: true },
    { id: "tencentmap", name: "腾讯地图", icon: "🗺️", desc: "地点搜索 / 路线规划 / 天气 / 旅游攻略", slug: "tencentmap-map-assistant", namespace: "@tencent-adm", guide_url: "https://www.skillhub.cn/skills/tencent-adm/tencentmap-map-assistant", cred_hint: "腾讯位置服务 Key（lbs.qq.com 获取）", official: true },
    { id: "baidu-netdisk", name: "百度网盘", icon: "💾", desc: "网盘文件上传 / 下载 / 转存 / 分享 / 搜索", slug: "baidu-netdisk-skills", namespace: "@wscats", guide_url: "https://www.skillhub.cn/skills/wscats/baidu-netdisk-skills", cred_hint: "百度网盘授权码（技能内 login.sh 引导）" },
    { id: "mcdonalds", name: "麦当劳点餐", icon: "🍔", desc: "门店 / 餐品 / 优惠券查询与点餐（MCP）", slug: "mcdonalds-mcp-china", namespace: "@meteorsliu", guide_url: "https://www.skillhub.cn/skills/meteorsliu/mcdonalds-mcp-china", cred_hint: "麦当劳 MCP Token（open.mcd.cn/mcp 获取）", mcp: { name: "mcd-mcp", url: "https://mcp.mcd.cn", fields: [{ key: "token", label: "MCP Token", header: "Authorization", prefix: "Bearer " }] } },
    { id: "lexiang", name: "腾讯乐享", icon: "🤝", desc: "腾讯乐享知识库检索（MCP）", slug: "lexiang-mcp-skill", namespace: "@lexiang", guide_url: "https://www.skillhub.cn/skills/lexiang/lexiang-mcp-skill", cred_hint: "乐享 Token + Company From", official: true, mcp: { name: "lexiang-mcp", url: "https://mcp.lexiang-app.com/mcp", fields: [{ key: "token", label: "乐享 Token", header: "Authorization", prefix: "Bearer " }, { key: "company_from", label: "Company From", header: "X-Company-From" }] } },
    { id: "weread", name: "微信读书", icon: "📖", desc: "搜书 / 书架 / 笔记 / 书评 / 阅读统计", slug: "weread-skills-official", namespace: "@user_0b9d349a", guide_url: "https://www.skillhub.cn/skills/user_0b9d349a/weread-skills-official", cred_hint: "微信读书 API Key" },
    { id: "ctrip-wendao", name: "携程问道", icon: "✈️", desc: "携程官方 AI 旅伴（行程 / 机酒规划）", slug: "wendao-skill", namespace: "@trips-ai", guide_url: "https://www.skillhub.cn/skills/trips-ai/wendao-skill", cred_hint: "携程问道 API Token" },
    { id: "meituan-travel", name: "美团旅行", icon: "🏨", desc: "酒店 / 机票 / 火车票 / 门票查询预订", slug: "meituan-travel", namespace: "@user_fe933096", guide_url: "https://www.skillhub.cn/skills/user_fe933096/meituan-travel", cred_hint: "美团旅行助手 Token" },
    { id: "youdaonote", name: "有道云笔记", icon: "🗒️", desc: "笔记剪藏 / 资讯推送 / 知识管理", slug: "youdaonote-clip", namespace: "@lephix", guide_url: "https://www.skillhub.cn/skills/lephix/youdaonote-clip", cred_hint: "有道云笔记 API Key" },
    { id: "fliggy", name: "飞猪旅行", icon: "🧳", desc: "飞猪旅行搜索（机票 / 酒店 / 度假）", slug: "fliggy-travel-new", namespace: "@user_b95ee7e5", guide_url: "https://www.skillhub.cn/skills/user_b95ee7e5/fliggy-travel-new", cred_hint: "飞猪 API Key" },
    { id: "baidu-map", name: "百度地图", icon: "🧭", desc: "附近地点 / 地图热点检索", slug: "baidu-nearby", namespace: "@longjf25", guide_url: "https://www.skillhub.cn/skills/longjf25/baidu-nearby", cred_hint: "百度地图 API Key" },
    { id: "qq-music", name: "QQ音乐", icon: "🎵", desc: "音乐搜索 / 歌单 / 播放控制", slug: "qq-music", namespace: "@mike47512", guide_url: "https://www.skillhub.cn/skills/mike47512/qq-music", cred_hint: "QQ音乐 API Key" },
    { id: "legal", name: "元典法律", icon: "⚖️", desc: "法律数据库检索（案例 / 法规 / 企业）", slug: "legal-search", namespace: "@user_72ffbadb", guide_url: "https://www.skillhub.cn/skills/user_72ffbadb/legal-search", cred_hint: "元典法律智能 API Key" },
  ];

  // GET /api/extensions/skills/market-catalog → 精选连接器技能目录（含已安装状态 + 全部已安装目录名，供搜索结果对照）
  if (path === "/api/extensions/skills/market-catalog" && req.method === "GET") {
    try {
      const installedNames = [];
      const skillsRoot = join(VAR_DIR, "skills");
      try {
        if (_isDir(skillsRoot)) readdirSync(skillsRoot).forEach(n => { const d = join(skillsRoot, n); if (_isDir(d) && existsSync(join(d, "SKILL.md"))) installedNames.push(n); });
      } catch (e) {}
      const installed = new Set(installedNames);
      const items = SKILL_MARKET_CATALOG.map(c => Object.assign({}, c, { installed: installed.has(c.id) }));
      return new Response(JSON.stringify({ ok: true, items, installed_names: installedNames }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/extensions/skills/install-package → 下载 SkillHub 完整技能包（含 scripts/references 子目录），注册 skills_dirs；MCP 型同时注册 MCP 服务器
  // body: { slug, namespace, name?, mcp?: { name, url, headers } }
  if (path === "/api/extensions/skills/install-package" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const slug = (body.slug || "").trim();
      const namespace = (body.namespace || "").trim();
      if (!slug) return new Response(JSON.stringify({ ok: false, error: "missing slug" }), { status: 400, headers: jsonHeaders() });

      const apiBase = "https://api.skillhub.cn/api/v1/skills/" + encodeURIComponent(slug);
      const nsQ = namespace ? ("namespace=" + encodeURIComponent(namespace)) : "";
      const hdrs = { "User-Agent": "Mozilla/5.0 (compatible; HermesDashboard/1.0)", "Accept": "application/json, text/markdown, */*", "Origin": "https://www.skillhub.cn", "Referer": "https://www.skillhub.cn/" };

      // 1. 文件列表（version 缺省取最新）
      const listR = await fetch(apiBase + "/files" + (nsQ ? ("?" + nsQ) : ""), { headers: hdrs, signal: AbortSignal.timeout(20000) });
      if (!listR.ok) return new Response(JSON.stringify({ ok: false, error: "SkillHub 文件列表返回 " + listR.status }), { status: 502, headers: jsonHeaders() });
      const listJ = await listR.json().catch(() => ({}));
      const files = Array.isArray(listJ.files) ? listJ.files : [];
      if (!files.length) return new Response(JSON.stringify({ ok: false, error: "该技能没有可下载的文件" }), { status: 422, headers: jsonHeaders() });

      // 2. 目标目录（前端传 name 指定，默认用 slug）
      const name = ((body.name || slug).trim().replace(/[^\w.-]/g, "_")) || ("skill-" + Date.now());
      const destDir = join(VAR_DIR, "skills", name);
      mkdirSync(destDir, { recursive: true });

      // 3. 逐文件下载：/file 端点 302→COS，默认跟随重定向（版本/存储桶无关）
      const downloaded = []; const failed = [];
      for (const f of files) {
        const relPath = String(f.path || "");
        if (!relPath || relPath.includes("..") || /^[\\/]/.test(relPath)) { failed.push({ path: relPath, error: "非法路径" }); continue; }
        const fileUrl = apiBase + "/file?path=" + encodeURIComponent(relPath) + (nsQ ? ("&" + nsQ) : "");
        try {
          const fr = await fetch(fileUrl, { headers: hdrs, signal: AbortSignal.timeout(30000) });
          if (!fr.ok) { failed.push({ path: relPath, error: "HTTP " + fr.status }); continue; }
          const buf = Buffer.from(await fr.arrayBuffer());
          const destPath = join(destDir, relPath);
          mkdirSync(dirname(destPath), { recursive: true });
          writeFileSync(destPath, buf);
          downloaded.push(relPath);
        } catch (e) { failed.push({ path: relPath, error: e.message }); }
      }
      if (!downloaded.length) return new Response(JSON.stringify({ ok: false, error: "未能下载任何文件", failed }), { status: 502, headers: jsonHeaders() });

      // 4. 注册 skills_dirs（extensions.json + config.yaml）
      const ext = _readExtensionsFile() || { toolsets: {}, mcp_servers: [], skills_dirs: [], persona: "default", memory: { enabled: true, char_limit: 2200 } };
      ext.skills_dirs = ext.skills_dirs || [];
      if (!ext.skills_dirs.includes(destDir)) ext.skills_dirs.push(destDir);
      _writeExtensionsFile(ext);
      const yamlPath = `${DATA_DIR}/config.yaml`;
      if (existsSync(yamlPath)) { let y = readFileSync(yamlPath, "utf8"); y = _mergeSkillsExternalDirs(y, ext.skills_dirs); writeFileSync(yamlPath, y); }

      // 5. MCP 型技能：注册 MCP 服务器
      let mcpRegistered = null;
      if (body.mcp && body.mcp.url) {
        const mName = body.mcp.name || (name + "-mcp");
        _upsertMcpServer(mName, { url: body.mcp.url, headers: body.mcp.headers || {} });
        mcpRegistered = body.mcp.url;
      }

      // 6. 触发网关重启以加载新技能 / MCP（skills_dirs 或 mcp_servers 变更均需重启后对 AI 生效）
      _triggerGatewayRestart("skill-install-" + name);

      return new Response(JSON.stringify({ ok: true, name, dir: destDir, files: downloaded, failed, mcp: mcpRegistered, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/extensions/skills/uninstall -> uninstall an installed skill: remove dir, drop from skills_dirs & config.yaml, restart gateway
  // body: { name } (skill install dir name)
  if (path === "/api/extensions/skills/uninstall" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      if (!name || name.indexOf("/") >= 0 || name.indexOf("..") >= 0) return new Response(JSON.stringify({ ok: false, error: "invalid name" }), { status: 400, headers: jsonHeaders() });
      const destDir = join(VAR_DIR, "skills", name);
      const ext = _readExtensionsFile() || { toolsets: {}, mcp_servers: [], skills_dirs: [], persona: "default", memory: { enabled: true, char_limit: 2200 } };
      ext.skills_dirs = (ext.skills_dirs || []).filter(function (d) { return d !== destDir && _expandHome(d) !== destDir; });
      _writeExtensionsFile(ext);
      const yamlPath = `${DATA_DIR}/config.yaml`;
      if (existsSync(yamlPath)) { let y = readFileSync(yamlPath, "utf8"); y = _mergeSkillsExternalDirs(y, ext.skills_dirs); writeFileSync(yamlPath, y); }
      let removed = false;
      try { if (_isDir(destDir)) { rmSync(destDir, { recursive: true, force: true }); removed = true; } } catch (e) {}
      // MCP 型技能：同步移除已注册的 MCP 服务器（避免遗留指向已删除技能的失效 MCP）
      const mcpName = String(body.mcp_name || "").trim();
      if (mcpName) { try { _upsertMcpServer(mcpName, null); } catch (e) {} }
      _triggerGatewayRestart("skill-uninstall-" + name);
      return new Response(JSON.stringify({ ok: true, name, removed, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/extensions/skills/config-mcp -> save MCP skill credentials (write into the MCP server headers, restart gateway)
  // body: { name (mcp server name), url, headers: { headerName: value } } —— blank values keep previously saved ones
  if (path === "/api/extensions/skills/config-mcp" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      const url = String(body.url || "").trim();
      if (!name || !url) return new Response(JSON.stringify({ ok: false, error: "missing name/url" }), { status: 400, headers: jsonHeaders() });
      const incoming = (body.headers && typeof body.headers === "object") ? body.headers : {};
      // merge with existing headers: blank input keeps the saved value, so re-saving never wipes configured creds
      const current = _parseMcpServers(_readHermesConfig())[name] || {};
      const headers = Object.assign({}, (current.headers && typeof current.headers === "object") ? current.headers : {});
      Object.keys(incoming).forEach(function (k) { const v = String(incoming[k] == null ? "" : incoming[k]).trim(); if (v !== "") headers[k] = v; });
      _upsertMcpServer(name, { url: url, headers: headers });
      _triggerGatewayRestart("skill-config-mcp-" + name);
      return new Response(JSON.stringify({ ok: true, name, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── MCP 服务器管理 API（对应 dashboard/mcp，读写 config.yaml mcp_servers 段）───
  if (path === "/api/mcp-servers" && req.method === "GET") {
    try {
      const yml = _readHermesConfig();
      const servers = _parseMcpServers(yml);
      const list = Object.keys(servers).map(name => {
        const s = servers[name];
        const type = s.url ? "http" : "stdio";
        return {
          name, type,
          command: s.command || "",
          args: Array.isArray(s.args) ? s.args : [],
          env: (s.env && typeof s.env === "object") ? s.env : {},
          url: s.url || "",
          headers: (s.headers && typeof s.headers === "object") ? s.headers : {},
          enabled: s.enabled !== "false" && s.enabled !== false,
          timeout: s.timeout || "",
          connect_timeout: s.connect_timeout || "",
          tools_include: Array.isArray(s.tools_include) ? s.tools_include : (s.tools && Array.isArray(s.tools.include) ? s.tools.include : []),
          tools_exclude: Array.isArray(s.tools_exclude) ? s.tools_exclude : (s.tools && Array.isArray(s.tools.exclude) ? s.tools.exclude : []),
        };
      });
      return new Response(JSON.stringify({ ok: true, servers: list }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, servers: [] }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/mcp-servers → 添加 MCP 服务器
  if (path === "/api/mcp-servers" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "").trim().replace(/[^A-Za-z0-9_-]/g, "_");
      if (!name) return new Response(JSON.stringify({ ok: false, error: "服务器名称不能为空" }), { status: 400, headers: jsonHeaders() });
      const existing = _parseMcpServers(_readHermesConfig());
      if (existing[name]) return new Response(JSON.stringify({ ok: false, error: "服务器 '" + name + "' 已存在" }), { status: 409, headers: jsonHeaders() });
      const entry = {};
      if (body.type === "http" || body.url) {
        entry.url = String(body.url || "").trim();
        if (body.headers && typeof body.headers === "object" && Object.keys(body.headers).length) entry.headers = body.headers;
      } else {
        entry.command = String(body.command || "").trim();
        if (Array.isArray(body.args) && body.args.length) entry.args = body.args;
        if (body.env && typeof body.env === "object" && Object.keys(body.env).length) entry.env = body.env;
      }
      if (body.enabled === false) entry.enabled = "false";
      if (body.timeout) entry.timeout = String(body.timeout);
      if (body.connect_timeout) entry.connect_timeout = String(body.connect_timeout);
      const tools = {};
      if (Array.isArray(body.tools_include) && body.tools_include.length) tools.include = body.tools_include;
      if (Array.isArray(body.tools_exclude) && body.tools_exclude.length) tools.exclude = body.tools_exclude;
      if (Object.keys(tools).length) entry.tools = tools;
      _upsertMcpServer(name, entry);
      _triggerGatewayRestart("mcp-add-" + name);
      return new Response(JSON.stringify({ ok: true, name, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // PUT /api/mcp-servers/:name → 更新 MCP 服务器
  const mcpPutMatch = path.match(/^\/api\/mcp-servers\/([A-Za-z0-9_-]+)$/);
  if (mcpPutMatch && req.method === "PUT") {
    try {
      const name = mcpPutMatch[1];
      const body = await req.json().catch(() => ({}));
      const entry = {};
      if (body.type === "http" || body.url) {
        entry.url = String(body.url || "").trim();
        if (body.headers && typeof body.headers === "object" && Object.keys(body.headers).length) entry.headers = body.headers;
      } else {
        entry.command = String(body.command || "").trim();
        if (Array.isArray(body.args) && body.args.length) entry.args = body.args;
        if (body.env && typeof body.env === "object" && Object.keys(body.env).length) entry.env = body.env;
      }
      if (body.enabled === false) entry.enabled = "false";
      if (body.timeout) entry.timeout = String(body.timeout);
      if (body.connect_timeout) entry.connect_timeout = String(body.connect_timeout);
      const tools = {};
      if (Array.isArray(body.tools_include) && body.tools_include.length) tools.include = body.tools_include;
      if (Array.isArray(body.tools_exclude) && body.tools_exclude.length) tools.exclude = body.tools_exclude;
      if (Object.keys(tools).length) entry.tools = tools;
      _upsertMcpServer(name, entry);
      _triggerGatewayRestart("mcp-update-" + name);
      return new Response(JSON.stringify({ ok: true, name, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // DELETE /api/mcp-servers/:name → 删除 MCP 服务器
  const mcpDelMatch = path.match(/^\/api\/mcp-servers\/([A-Za-z0-9_-]+)$/);
  if (mcpDelMatch && req.method === "DELETE") {
    try {
      const name = mcpDelMatch[1];
      _upsertMcpServer(name, null);
      _triggerGatewayRestart("mcp-del-" + name);
      return new Response(JSON.stringify({ ok: true, name, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/mcp-servers/:name/toggle → 启用/禁用
  const mcpToggleMatch = path.match(/^\/api\/mcp-servers\/([A-Za-z0-9_-]+)\/toggle$/);
  if (mcpToggleMatch && req.method === "POST") {
    try {
      const name = mcpToggleMatch[1];
      const yml = _readHermesConfig();
      const servers = _parseMcpServers(yml);
      if (!servers[name]) return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404, headers: jsonHeaders() });
      const cur = servers[name];
      const isDisabled = cur.enabled === "false" || cur.enabled === false;
      if (isDisabled) { delete cur.enabled; } else { cur.enabled = "false"; }
      _upsertMcpServer(name, cur);
      _triggerGatewayRestart("mcp-toggle-" + name);
      return new Response(JSON.stringify({ ok: true, name, enabled: isDisabled, restart: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 定时任务（Cron）管理 API（读取 DATA_DIR/cron/jobs.json + hermes cron CLI）───
  const CRON_DIR = `${DATA_DIR}/cron`;
  const CRON_JOBS_FILE = `${CRON_DIR}/jobs.json`;

  function _readCronJobs() {
    try {
      if (!existsSync(CRON_JOBS_FILE)) return [];
      const raw = readFileSync(CRON_JOBS_FILE, "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : (data.jobs || Object.values(data));
    } catch { return []; }
  }

  if (path === "/api/cron-jobs" && req.method === "GET") {
    try {
      const jobs = _readCronJobs();
      return new Response(JSON.stringify({ ok: true, jobs }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, jobs: [] }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/cron-jobs → 创建定时任务（使用 hermes cron create CLI）
  if (path === "/api/cron-jobs" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return new Response(JSON.stringify({ ok: false, error: "提示词不能为空" }), { status: 400, headers: jsonHeaders() });
      const schedule = String(body.schedule || "").trim() || "every 1h";
      const args = ["cron", "create", schedule, prompt];
      if (body.name) args.push("--name", String(body.name));
      if (body.deliver_to) args.push("--deliver-to", String(body.deliver_to));
      if (body.repeat) args.push("--repeat", String(body.repeat));
      if (Array.isArray(body.skills)) body.skills.forEach(sk => { if (sk) args.push("--skill", sk); });
      const r = spawnSync(HERMES_BIN, args, { stdout: "pipe", stderr: "pipe", timeout: 15000, env: { ...process.env, HERMES_HOME: DATA_DIR } });
      const stdout = (r.stdout || "").toString().trim();
      const stderr = (r.stderr || "").toString().trim();
      if (r.status !== 0) {
        return new Response(JSON.stringify({ ok: false, error: stderr || stdout || "创建失败" }), { status: 500, headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, output: stdout }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/cron-jobs/:id/action → 生命周期操作（pause/resume/run/remove）
  const cronActionMatch = path.match(/^\/api\/cron-jobs\/([^/]+)\/action$/);
  if (cronActionMatch && req.method === "POST") {
    try {
      const jobId = decodeURIComponent(cronActionMatch[1]);
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "").trim();
      const validActions = ["pause", "resume", "run", "remove"];
      if (!validActions.includes(action)) return new Response(JSON.stringify({ ok: false, error: "无效操作: " + action }), { status: 400, headers: jsonHeaders() });
      const r = spawnSync(HERMES_BIN, ["cron", action, jobId], { stdout: "pipe", stderr: "pipe", timeout: 15000, env: { ...process.env, HERMES_HOME: DATA_DIR } });
      const stdout = (r.stdout || "").toString().trim();
      const stderr = (r.stderr || "").toString().trim();
      if (r.status !== 0) {
        return new Response(JSON.stringify({ ok: false, error: stderr || stdout || "操作失败" }), { status: 500, headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, action, output: stdout }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 记忆 / 灵魂管理 API（读写 DATA_DIR 下的 SOUL.md、MEMORY.md、notes.md）───
  if (path === "/api/memory" && req.method === "GET") {
    try {
      let soul = "", memory = "", notes = "";
      try { soul = readFileSync(`${DATA_DIR}/SOUL.md`, "utf8"); } catch {}
      try { memory = readFileSync(`${DATA_DIR}/MEMORY.md`, "utf8"); } catch {}
      try { notes = readFileSync(`${DATA_DIR}/notes.md`, "utf8"); } catch {}
      // 读取记忆配置（config.yaml 中的 memory 段）
      const cfg = _readHermesConfig();
      const memEnabled = !/memory:\s*\n\s*enabled:\s*false/.test(cfg);
      return new Response(JSON.stringify({ ok: true, soul, memory, notes, memory_enabled: memEnabled }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/memory → 保存灵魂/记忆/笔记
  if (path === "/api/memory" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body.soul !== undefined) {
        writeFileSync(`${DATA_DIR}/SOUL.md`, String(body.soul), { mode: 0o644 });
      }
      if (body.memory !== undefined) {
        writeFileSync(`${DATA_DIR}/MEMORY.md`, String(body.memory), { mode: 0o644 });
      }
      if (body.notes !== undefined) {
        writeFileSync(`${DATA_DIR}/notes.md`, String(body.notes), { mode: 0o644 });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── Token 用量统计 API（从 Dashboard 拉取）───
  if (path === "/api/usage" && req.method === "GET") {
    try {
      if (!isPortListening(DASHBOARD_PORT)) {
        return new Response(JSON.stringify({ ok: true, usage: null, note: "Dashboard 未运行" }), { headers: jsonHeaders() });
      }
      const h = new Headers();
      h.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
      // 尝试从 dashboard 获取用量数据
      let usage = null;
      try {
        const r = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/usage`, {
          headers: h, signal: AbortSignal.timeout(8000),
        });
        if (r.ok) usage = await r.json();
      } catch {}
      // 备用：从 sessions 统计 token
      if (!usage) {
        try {
          const r2 = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/sessions`, {
            headers: h, signal: AbortSignal.timeout(8000),
          });
          if (r2.ok) {
            const data = await r2.json();
            const sessions = Array.isArray(data) ? data : (data.sessions || data.items || []);
            let totalPrompt = 0, totalCompletion = 0, totalMsgs = 0;
            const byModel = {};
            sessions.forEach(s => {
              const msgs = s.message_count || (s.messages ? s.messages.length : 0);
              totalMsgs += msgs;
              const model = s.model || "unknown";
              if (!byModel[model]) byModel[model] = { sessions: 0, messages: 0 };
              byModel[model].sessions++;
              byModel[model].messages += msgs;
            });
            usage = { total_sessions: sessions.length, total_messages: totalMsgs, by_model: byModel };
          }
        } catch {}
      }
      return new Response(JSON.stringify({ ok: true, usage }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, usage: null }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 学习轨迹 API（技能图谱 + 使用统计，读取 skills 目录 + Dashboard state.db）───
  if (path === "/api/learning-trajectory" && req.method === "GET") {
    try {
      const skills = [];
      const relations = [];
      // 1. 读取本地 skills 目录
      const skillsDir = `${DATA_DIR}/skills`;
      if (existsSync(skillsDir)) {
        const dirs = readdirSync(skillsDir).filter(d => {
          try { return statSync(`${skillsDir}/${d}`).isDirectory(); } catch { return false; }
        });
        dirs.forEach(dir => {
          let meta = {};
          try { meta = JSON.parse(readFileSync(`${skillsDir}/${dir}/metadata.json`, "utf8")); } catch {}
          let category = meta.category || "other";
          // 尝试从 SKILL.md 或 skill.yaml 提取分类
          if (category === "other") {
            try {
              const skillMd = readFileSync(`${skillsDir}/${dir}/SKILL.md`, "utf8");
              const catMatch = skillMd.match(/category:\s*(.+)/i);
              if (catMatch) category = catMatch[1].trim();
            } catch {}
          }
          skills.push({
            id: dir,
            name: meta.name || dir,
            category,
            description: meta.description || "",
            usage_count: meta.usage_count || 0,
            created_at: meta.created_at || null,
            source: meta.source || "local"
          });
        });
      }
      // 2. 尝试从 Dashboard 获取技能使用统计
      if (isPortListening(DASHBOARD_PORT)) {
        try {
          const h = new Headers();
          h.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
          const r = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/skills`, {
            headers: h, signal: AbortSignal.timeout(6000),
          });
          if (r.ok) {
            const data = await r.json();
            const dashSkills = Array.isArray(data) ? data : (data.skills || []);
            dashSkills.forEach(ds => {
              const existing = skills.find(s => s.id === (ds.id || ds.name));
              if (existing) {
                existing.usage_count = ds.usage_count || ds.usageCount || existing.usage_count;
                if (ds.category) existing.category = ds.category;
              } else {
                skills.push({
                  id: ds.id || ds.name,
                  name: ds.name || ds.id,
                  category: ds.category || "other",
                  description: ds.description || "",
                  usage_count: ds.usage_count || ds.usageCount || 0,
                  created_at: ds.created_at || null,
                  source: "dashboard"
                });
              }
            });
          }
        } catch {}
      }
      // 3. 构建关系（同分类技能之间建立关联）
      const byCat = {};
      skills.forEach(s => {
        if (!byCat[s.category]) byCat[s.category] = [];
        byCat[s.category].push(s.id);
      });
      Object.keys(byCat).forEach(cat => {
        const ids = byCat[cat];
        for (let i = 0; i < ids.length && i < 8; i++) {
          for (let j = i + 1; j < ids.length && j < 8; j++) {
            relations.push({ from: ids[i], to: ids[j], type: "same_category" });
          }
        }
      });
      return new Response(JSON.stringify({ ok: true, skills, relations }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, skills: [], relations: [] }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 文件管理 API（工作区文件浏览/读写/创建/删除）───
  const WORKSPACE_ROOT = DATA_DIR; // 默认工作区根目录

  // GET /api/files?path=xxx → 列出目录内容
  if (path === "/api/files" && req.method === "GET") {
    try {
      const reqPath = url.searchParams.get("path") || "";
      const dirPath = reqPath.startsWith("/") ? reqPath : `${WORKSPACE_ROOT}/${reqPath}`;
      if (!existsSync(dirPath)) return new Response(JSON.stringify({ ok: false, error: "目录不存在", items: [] }), { headers: jsonHeaders() });
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const items = entries.filter(e => !e.name.startsWith(".")).map(e => {
        const fullPath = `${dirPath}/${e.name}`;
        let size = 0, mtime = 0;
        try { const st = statSync(fullPath); size = st.size; mtime = st.mtimeMs; } catch {}
        return { name: e.name, path: fullPath, type: e.isDirectory() ? "dir" : "file", size, mtime };
      }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return new Response(JSON.stringify({ ok: true, path: dirPath, items }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, items: [] }), { status: 500, headers: jsonHeaders() });
    }
  }

  // GET /api/files/read?path=xxx → 读取文件内容
  if (path === "/api/files/read" && req.method === "GET") {
    try {
      const filePath = url.searchParams.get("path") || "";
      if (!filePath || !existsSync(filePath)) return new Response(JSON.stringify({ ok: false, error: "文件不存在" }), { headers: jsonHeaders() });
      const st = statSync(filePath);
      if (st.size > 512 * 1024) return new Response(JSON.stringify({ ok: false, error: "文件过大（>512KB）" }), { headers: jsonHeaders() });
      const content = readFileSync(filePath, "utf8");
      return new Response(JSON.stringify({ ok: true, path: filePath, content, size: st.size }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/files/write → 写入文件 { path, content }
  if (path === "/api/files/write" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!body.path) return new Response(JSON.stringify({ ok: false, error: "缺少 path" }), { headers: jsonHeaders() });
      const dir = body.path.substring(0, body.path.lastIndexOf("/"));
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(body.path, body.content || "", { mode: 0o644 });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/files/mkdir → 创建目录 { path }
  if (path === "/api/files/mkdir" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!body.path) return new Response(JSON.stringify({ ok: false, error: "缺少 path" }), { headers: jsonHeaders() });
      mkdirSync(body.path, { recursive: true });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // DELETE /api/files?path=xxx → 删除文件/目录
  if (path === "/api/files" && req.method === "DELETE") {
    try {
      const filePath = url.searchParams.get("path") || "";
      if (!filePath || !existsSync(filePath)) return new Response(JSON.stringify({ ok: false, error: "不存在" }), { headers: jsonHeaders() });
      rmSync(filePath, { recursive: true, force: true });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 平台频道 / 通讯 ────────────────────────────────────────────────
  if (path === "/api/channels" && req.method === "GET") {
    try {
      return new Response(JSON.stringify({ ok: true, channels: _listChannels(), defs: CHANNEL_DEFS }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 通道会话同步：从 Dashboard 拉取各平台会话，按 channel 分组返回给前端 ──
  if (path === "/api/channel-sessions" && req.method === "GET") {
    try {
      if (!isPortListening(DASHBOARD_PORT)) {
        return new Response(JSON.stringify({ ok: true, groups: {} }), { headers: jsonHeaders() });
      }
      const h = new Headers();
      h.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
      const r = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/sessions`, {
        headers: h, signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return new Response(JSON.stringify({ ok: true, groups: {} }), { headers: jsonHeaders() });
      const data = await r.json();
      const sessions = Array.isArray(data) ? data : (data.sessions || data.items || []);
      // 按 platform 分组
      const groups = {};
      sessions.forEach(s => {
        const platform = s.platform || s.source || s.channel || "api_server";
        if (!groups[platform]) groups[platform] = [];
        groups[platform].push({
          id: s.id || s.session_id || "",
          title: s.title || s.name || "未命名会话",
          platform,
          updated_at: s.updated_at || s.last_active || s.created_at || 0,
          message_count: s.message_count || (s.messages ? s.messages.length : 0),
          model: s.model || "",
        });
      });
      // 每组按时间倒序
      Object.keys(groups).forEach(k => groups[k].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)));
      return new Response(JSON.stringify({ ok: true, groups }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: true, groups: {}, error: e.message }), { headers: jsonHeaders() });
    }
  }
  // ── 通道会话消息：获取指定 session 的聊天消息（从 Dashboard API 拉取）──
  const chSessMsgMatch = path.match(/^\/api\/channel-sessions\/([^/]+)\/messages$/);
  if (chSessMsgMatch && req.method === "GET") {
    try {
      const sessionId = decodeURIComponent(chSessMsgMatch[1]);
      if (!isPortListening(DASHBOARD_PORT)) {
        return new Response(JSON.stringify({ ok: false, error: "Dashboard 未运行", messages: [] }), { headers: jsonHeaders() });
      }
      const h = new Headers();
      h.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
      // 尝试多种 Dashboard API 格式获取会话消息
      let messages = [];
      let sessionTitle = "";
      // 方式1: /api/sessions/:id/messages
      try {
        const r1 = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
          headers: h, signal: AbortSignal.timeout(8000),
        });
        if (r1.ok) {
          const d1 = await r1.json();
          messages = Array.isArray(d1) ? d1 : (d1.messages || d1.items || []);
        }
      } catch {}
      // 方式2: 如果方式1失败，尝试 /api/sessions/:id（可能包含 messages 字段）
      if (!messages.length) {
        try {
          const r2 = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/sessions/${encodeURIComponent(sessionId)}`, {
            headers: h, signal: AbortSignal.timeout(8000),
          });
          if (r2.ok) {
            const d2 = await r2.json();
            sessionTitle = d2.title || d2.name || "";
            messages = d2.messages || d2.history || [];
          }
        } catch {}
      }
      // 方式3: 从全部 sessions 列表中查找（兜底）
      if (!messages.length) {
        try {
          const r3 = await fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/sessions`, {
            headers: h, signal: AbortSignal.timeout(8000),
          });
          if (r3.ok) {
            const d3 = await r3.json();
            const allSessions = Array.isArray(d3) ? d3 : (d3.sessions || d3.items || []);
            const found = allSessions.find(s => (s.id || s.session_id) === sessionId);
            if (found) {
              sessionTitle = found.title || found.name || "";
              messages = found.messages || found.history || [];
            }
          }
        } catch {}
      }
      // 标准化消息格式
      const normalized = messages.map(m => ({
        role: m.role || (m.is_user ? "user" : "assistant"),
        content: m.content || m.text || m.message || "",
        timestamp: m.timestamp || m.created_at || m.ts || 0,
        model: m.model || "",
        tool_calls: m.tool_calls || null,
      }));
      return new Response(JSON.stringify({ ok: true, messages: normalized, title: sessionTitle, session_id: sessionId }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, messages: [] }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/channels/:id  → 保存凭证 + 行为配置
  const chSaveMatch = path.match(/^\/api\/channels\/([a-zA-Z0-9_]+)$/);
  if (chSaveMatch && req.method === "POST") {
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
  // 微信扫码登录：获取二维码（腾讯 iLink 公共接口，无需自备 App）
  if (path === "/api/channels/weixin/qr" && req.method === "GET") {
    try {
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", { signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => ({}));
      if (!data || !data.qrcode) return new Response(JSON.stringify({ ok: false, error: "无法获取微信二维码，请检查网络后重试" }), { status: 502, headers: jsonHeaders() });
      // iLink 返回的 qrcode_img_content 是一个 deep-link URL（https://liteapp.weixin.qq.com/q/...），不是图片 base64
      const deepLink = data.qrcode_img_content || "";
      return new Response(JSON.stringify({ ok: true, qrcode: data.qrcode, qrcode_url: deepLink, qrcode_img: deepLink, use_render_qr: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  // 微信扫码登录：轮询扫码状态
  if (path === "/api/channels/weixin/qr/status" && req.method === "GET") {
    try {
      const url = new URL(req.url);
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
  // 企业微信扫码授权：按已配置的 Corp ID / Agent ID / Secret 生成网页授权二维码（与 Octop 一致）
  if (path === "/api/channels/wecom/qr" && req.method === "GET") {
    try {
      const pc = (_readPlatformConfig ? _readPlatformConfig("wecom") : {}) || {};
      const extra = pc.extra || {};
      const corpId = extra.corp_id || process.env.WECOM_CORP_ID || "";
      const agentId = extra.agent_id || process.env.WECOM_AGENT_ID || "";
      const secret = extra.secret || process.env.WECOM_SECRET || "";
      if (!corpId || !agentId || !secret) {
        return new Response(JSON.stringify({ ok: false, error: "请先在「手动输入」中填写企业微信 Corp ID / Agent ID / Secret 后再扫码授权。" }), { status: 400, headers: jsonHeaders() });
      }
      const origin = (req.headers.get("origin") || "").replace(/\/+$/, "") || (req.headers.get("referer") || "").replace(/\/+$/, "");
      const redirect = (origin ? origin : "http://localhost") + (BASE_PATH || "") + "/api/channels/wecom/qr/callback";
      const state = "hermes_wecom_" + Date.now();
      const authUrl = "https://open.weixin.qq.com/connect/oauth2/authorize?appid=" + encodeURIComponent(corpId) +
        "&redirect_uri=" + encodeURIComponent(redirect) +
        "&response_type=code&scope=snsapi_base&agentid=" + encodeURIComponent(agentId) +
        "&state=" + encodeURIComponent(state) + "#wechat_redirect";
      return new Response(JSON.stringify({ ok: true, qr_payload: authUrl, qr_url: authUrl, deep_link: authUrl }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 触发网关重启（异步、尽力而为）─────────────────────────────────────
  // 用于频道绑定 / 配置变更后让网关重新加载 .env 与 config.yaml。
  // 直接 POST 到 Dashboard 的 /api/gateway/restart（monitor 代理会处理
  // 官方「复用旧进程」守卫导致的空操作并重发）。网关未运行时跳过。
  function _triggerGatewayRestart(reason) {
    const tag = reason || "config";
    try {
      if (!isPortListening(GATEWAY_PORT)) {
        log(`[gw-restart] ${tag}: 网关未运行，跳过重启`);
        return;
      }
      const h = new Headers();
      h.set("X-Hermes-Session-Token", DASHBOARD_SESSION_TOKEN);
      h.set("Content-Type", "application/json");
      fetch(`http://${DASHBOARD_BIND}:${DASHBOARD_PORT}/api/gateway/restart`, {
        method: "POST", headers: h, signal: AbortSignal.timeout(10000),
      }).then(async (r) => {
        log(`[gw-restart] ${tag}: 已发送重启请求，status=${r && r.status}`);
      }).catch((e) => {
        log(`[gw-restart] ${tag}: 重启请求失败 ${e?.message || e}`);
      });
    } catch (e) {
      log(`[gw-restart] ${tag}: 异常 ${e?.message || e}`);
    }
  }

  // 启动时自动注册已由模块级 _moduleLevelAutoRegisterMcp() 完成，此处无需重复

  // ── Telegram 扫码创建机器人 ───────────────────────────────────────────
  // GET /api/channels/telegram/qr  → 创建配对，返回 deep_link/qr_payload
  if (path === "/api/channels/telegram/qr" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const botName = (u.searchParams.get("bot_name") || "Hermes Agent").trim() || "Hermes Agent";
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
      const deepLink  = String(data.deep_link || "").trim();
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
  // GET /api/channels/telegram/qr/status?pairing_id=...
  if (path === "/api/channels/telegram/qr/status" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const pairingId = (u.searchParams.get("pairing_id") || "").trim();
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
  // POST /api/channels/telegram/qr/apply  → 保存 token + allowed_user_ids + 启用平台
  if (path === "/api/channels/telegram/qr/apply" && req.method === "POST") {
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
      // 同步 allow_from 到 config.yaml：与上游 bootstrap 约定一致，
      // 即使 .env 被重建，白名单也能从配置恢复（双保险）。
      cfg.allow_from = allowedUserIds.join(",");
      cfg.updated_at = Date.now();
      _writeHermesConfig(_setPlatformConfig("telegram", cfg));
      _telegramPairings.delete(pairingId);
      // ── 关键安全修复 ──
      // 写入 TELEGRAM_ALLOWED_USERS 后必须重启网关，否则正在运行的网关
      // 不会加载新的白名单，导致任意 Telegram 帐号都能私聊操控机器人
      // （含授权 root 等高危操作）。见上游 adapter._is_user_authorized_from_message。
      _triggerGatewayRestart("telegram-bind");
      return new Response(JSON.stringify({ ok: true, bot_username: rec.bot_username, gateway_restarting: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── WhatsApp 扫码配对 ─────────────────────────────────────────────────
  // GET /api/channels/whatsapp/qr?mode=bot|self-chat
  if (path === "/api/channels/whatsapp/qr" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const mode = ["bot", "self-chat"].includes(u.searchParams.get("mode")) ? u.searchParams.get("mode") : "self-chat";
      if (!resolvedNodeBin) return new Response(JSON.stringify({ ok: false, error: "未找到 Node.js，无法启动 WhatsApp bridge" }), { status: 500, headers: jsonHeaders() });
      const pairingId = randomBytes(16).toString("hex");
      const sessionDir = `${WHATSAPP_SESSION_DIR}/${pairingId}`;
      const expiresTs = Date.now() + WHATSAPP_ONBOARDING_TTL;
      let initialQr = "";
      // 如果已有 creds.json，视为已配对，直接返回 connected（与官方行为一致）
      if (existsSync(`${sessionDir}/creds.json`)) {
        _pruneWhatsAppPairings();
        _whatsappPairings.set(pairingId, { proc: null, status: "connected", qr_payload: "", mode, account_id: null, account_name: null, account_phone: null, error: null, expires_at_ts: expiresTs });
        return new Response(JSON.stringify({ ok: true, pairing_id: pairingId, status: "connected" }), { headers: jsonHeaders() });
      }
      const proc = _spawnWhatsAppPairing(sessionDir, mode);
      _pruneWhatsAppPairings();
      _whatsappPairings.set(pairingId, { proc, status: "starting", qr_payload: "", mode, account_id: null, account_name: null, account_phone: null, error: null, expires_at_ts: expiresTs });
      _watchWhatsAppPairing(pairingId, proc);
      // 等待一小段时间让 QR 出来（bridge 启动通常 1-3 秒）
      for (let i = 0; i < 30 && !initialQr; i++) { await new Promise(r => setTimeout(r, 200)); initialQr = (_whatsappPairings.get(pairingId) || {}).qr_payload || ""; }
      return new Response(JSON.stringify({ ok: true, pairing_id: pairingId, status: initialQr ? "waiting" : "starting", qr_payload: initialQr }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "无法启动 WhatsApp 配对：" + e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // GET /api/channels/whatsapp/qr/status?pairing_id=...
  if (path === "/api/channels/whatsapp/qr/status" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const pairingId = (u.searchParams.get("pairing_id") || "").trim();
      if (!pairingId) return new Response(JSON.stringify({ ok: false, error: "缺少 pairing_id" }), { status: 400, headers: jsonHeaders() });
      _pruneWhatsAppPairings();
      const rec = _whatsappPairings.get(pairingId);
      if (!rec) return new Response(JSON.stringify({ ok: false, error: "配对会话不存在或已过期" }), { status: 404, headers: jsonHeaders() });
      if (rec.status === "expired") return new Response(JSON.stringify({ ok: false, error: rec.error || "二维码已过期" }), { status: 410, headers: jsonHeaders() });
      return new Response(JSON.stringify({
        ok: true, status: rec.status, qr_payload: rec.qr_payload,
        account_id: rec.account_id, account_name: rec.account_name, account_phone: rec.account_phone,
        error: rec.error
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/channels/whatsapp/qr/apply  → 保存 mode/allowed_users + 启用平台
  if (path === "/api/channels/whatsapp/qr/apply" && req.method === "POST") {
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
      cfg.allow_from = allowedUsers || "";
      cfg.updated_at = Date.now();
      _writeHermesConfig(_setPlatformConfig("whatsapp", cfg));
      _whatsappPairings.delete(pairingId);
      // 同 Telegram：写入 WHATSAPP_ALLOWED_USERS 后重启网关，确保白名单生效
      _triggerGatewayRestart("whatsapp-bind");
      return new Response(JSON.stringify({ ok: true, account_id: rec.account_id, account_name: rec.account_name, gateway_restarting: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 诊断端点：查看 MCP 配置状态 ──
  if (path === "/api/debug/mcp-status" && req.method === "GET") {
    try {
      const yml = _readHermesConfig();
      const mcpBlock = _yamlBlockOf(yml, "mcp_servers");
      const parsed = _parseMcpServers(yml);
      const st = _readConnectorsState();
      const gwConns = CONNECTOR_CATALOG.filter(function (c) { return c.mcp_mode === "gateway"; }).map(function (c) {
        const creds = st[c.kind] || {};
        return { kind: c.kind, name: c.name, has_creds: (c.fields || []).every(function (f) { return !!creds[f.key]; }), mcp_name: "conn-" + c.kind, in_config: !!parsed["conn-" + c.kind] };
      });
      return new Response(JSON.stringify({
        ok: true,
        hermes_config_path: HERMES_CONFIG,
        bridge_script_path: MCP_BRIDGE_SCRIPT,
        bridge_script_exists: existsSync(MCP_BRIDGE_SCRIPT),
        resolved_node_bin: resolvedNodeBin || null,
        ui_port: UI_PORT,
        mcp_servers_in_config: parsed,
        mcp_block_raw: mcpBlock.slice(0, 2000),
        gateway_connectors: gwConns
      }, null, 2), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── MCP 代理：把 gateway 模式连接器的工具暴露为 MCP 协议，让 Hermes 网关（AI）可调用 ──
  const _mcpProxyMatch = path.match(/^\/mcp-proxy\/([A-Za-z0-9_-]+)$/);
  if (_mcpProxyMatch && req.method === "POST") {
    const kind = _mcpProxyMatch[1];
    const cat = getConnector(kind);
    try {
      const rpcBody = await req.json().catch(() => ({}));
      const method = rpcBody.method || "";
      const id = rpcBody.id;
      const mcpJsonHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
      // JSON-RPC 通知（无 id）：返回 202 Accepted，无 body
      if (id === undefined || id === null) {
        return new Response(null, { status: 202, headers: mcpJsonHeaders });
      }
      if (method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hermes-conn-" + kind, version: "1.0.0" }
        }}), { headers: mcpJsonHeaders });
      }
      if (method === "tools/list") {
        if (!cat) return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown connector" } }), { headers: mcpJsonHeaders });
        const tools = (cat.tools || []).map(function (t) {
          return { name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} } };
        });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }), { headers: mcpJsonHeaders });
      }
      if (method === "tools/call") {
        if (!cat) return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown connector" } }), { headers: mcpJsonHeaders });
        const toolName = (rpcBody.params && rpcBody.params.name) || "";
        const toolArgs = (rpcBody.params && rpcBody.params.arguments) || {};
        const st = _readConnectorsState()[kind] || {};
        if (!(cat.fields || []).every(function (f) { return !!st[f.key]; })) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "连接器未配置凭证，请先在连接器页面配置并保存。" }], isError: true } }), { headers: mcpJsonHeaders });
        }
        try {
          const result = await callConnectorTool(kind, st, toolName, toolArgs);
          const text = (typeof result === "string") ? result : JSON.stringify(result, null, 2);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } }), { headers: mcpJsonHeaders });
        } catch (ce) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "调用失败: " + (ce.message || String(ce)) }], isError: true } }), { headers: mcpJsonHeaders });
        }
      }
      // ping 或未识别方法
      if (method === "ping") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: {} }), { headers: mcpJsonHeaders });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } }), { headers: mcpJsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: e.message } }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
  }

  // ── 连接器（OCTOP 风格：catalog + 真实 callTool）──
  if (path === "/api/connectors" && req.method === "GET") {
    try {
      const state = _readConnectorsState();
      const list = CONNECTOR_CATALOG.map(function (c) {
        const st = state[c.kind] || {};
        return {
          kind: c.kind, name: c.name, icon: c.icon, color: c.color,
          description: c.description, auth_kind: c.auth_kind, mcp_mode: c.mcp_mode,
          phase: c.phase, doc_url: c.doc_url, auth_hint: c.auth_hint,
          fields: c.fields, tools: c.tools,
          configured: !!(c.fields && c.fields.length) && c.fields.every(function (f) { return !!st[f.key]; }),
          creds_set: (c.fields || []).filter(function (f) { return !!st[f.key]; }).map(function (f) { return f.key; }),
        };
      });
      return new Response(JSON.stringify({ ok: true, connectors: list }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  const _connMatch = path.match(/^\/api\/connectors\/([A-Za-z0-9_-]+)(\/call)?$/);
  if (_connMatch) {
    const kind = _connMatch[1];
    const isCall = !!_connMatch[2];
    const cat = getConnector(kind);
    if (!cat) return new Response(JSON.stringify({ ok: false, error: "未知连接器: " + kind }), { status: 404, headers: jsonHeaders() });
    try {
      if (req.method === "GET" && !isCall) {
        const st = _readConnectorsState()[kind] || {};
        const masked = {};
        (cat.fields || []).forEach(function (f) { masked[f.key] = !!st[f.key]; });
        return new Response(JSON.stringify({
          ok: true, kind: kind, name: cat.name, fields: cat.fields, tools: cat.tools,
          mcp_mode: cat.mcp_mode, configured: (cat.fields || []).every(function (f) { return !!st[f.key]; }), creds_set: masked,
        }), { headers: jsonHeaders() });
      }
      if (req.method === "DELETE" && !isCall) {
        const state = _readConnectorsState(); delete state[kind]; _writeConnectorsState(state);
        if (cat.mcp_mode === "remote") _upsertMcpServer(kind, null);
        if (cat.mcp_mode === "gateway") _upsertMcpServer("conn-" + kind, null);
        _triggerGatewayRestart("connector-delete-" + kind);
        return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
      }
      if (req.method === "POST" && !isCall) {
        const body = await req.json().catch(function () { return {}; });
        const prev = _readConnectorsState()[kind] || {};
        const creds = {};
        // 留空表示保留已保存的原值：前端不再回填布尔标志（也不回显密钥），
        // 避免「测试连接/保存」把已配置的凭证覆盖成空或 "true"。
        (cat.fields || []).forEach(function (f) {
          const v = body[f.key];
          const s = (v == null ? "" : String(v).trim());
          creds[f.key] = s !== "" ? s : (prev[f.key] || "");
        });
        if ((cat.fields || []).some(function (f) { return !creds[f.key]; })) {
          return new Response(JSON.stringify({ ok: false, error: "请填写所有必填凭证" }), { status: 400, headers: jsonHeaders() });
        }
        if (cat.impl && cat.impl.probeCredentials) {
          try { await probeConnector(kind, creds); }
          catch (pe) { return new Response(JSON.stringify({ ok: false, error: "凭证校验失败: " + pe.message }), { status: 400, headers: jsonHeaders() }); }
        }
        const state = _readConnectorsState(); state[kind] = creds; _writeConnectorsState(state);
        if (cat.mcp_mode === "remote") {
          const tokenField = (cat.fields || []).find(function (f) { return f.key === "token" || f.key === "api_key"; });
          const headers = {};
          if (tokenField) headers["Authorization"] = "Bearer " + creds[tokenField.key];
          if (cat.kind === "tencent-lexiang" && creds.company_from) headers["X-Company-From"] = creds.company_from;
          _upsertMcpServer(kind, { url: cat.mcp_url, headers: headers });
          _triggerGatewayRestart("connector-remote-" + kind);
        }
        if (cat.mcp_mode === "gateway") {
          // 注册 stdio MCP 桥接，让 Hermes 网关（AI）能在对话中调用此连接器的工具
          _ensureMcpBridgeScript();
          const nodeBin = resolvedNodeBin || "node";
          _upsertMcpServer("conn-" + kind, { command: nodeBin, args: [MCP_BRIDGE_SCRIPT, kind, String(UI_PORT)] });
          _triggerGatewayRestart("connector-gateway-mcp-" + kind);
        }
        return new Response(JSON.stringify({ ok: true, configured: true }), { headers: jsonHeaders() });
      }
      if (req.method === "POST" && isCall) {
        if (cat.mcp_mode === "remote") {
          return new Response(JSON.stringify({ ok: false, error: "该连接器为远程 MCP 模式，请在对话中由智能体调用" }), { status: 400, headers: jsonHeaders() });
        }
        const body = await req.json().catch(function () { return {}; });
        const tool = String(body.tool || "");
        const args = (body.args && typeof body.args === "object") ? body.args : {};
        const st = _readConnectorsState()[kind] || {};
        if (!(cat.fields || []).every(function (f) { return !!st[f.key]; })) {
          return new Response(JSON.stringify({ ok: false, error: "请先配置并保存凭证" }), { status: 400, headers: jsonHeaders() });
        }
        try {
          const result = await callConnectorTool(kind, st, tool, args);
          return new Response(JSON.stringify({ ok: true, result: result }), { headers: jsonHeaders() });
        } catch (ce) {
          return new Response(JSON.stringify({ ok: false, error: ce.message || String(ce) }), { status: 502, headers: jsonHeaders() });
        }
      }
      return new Response(JSON.stringify({ ok: false, error: "方法不允许" }), { status: 405, headers: jsonHeaders() });
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

      // ── 找到 active provider（按 name 或 id 匹配；有 provider 时兜底取第一个，
      // 避免「no active provider」导致配置完全不落盘、网关一直 502）──
      let activeProv = (body.providers || []).find(p =>
        p.name === body.active_provider || String(p.id) === String(body.active_provider)
      );
      if (!activeProv && (body.providers || []).length) activeProv = (body.providers || [])[0];
      if (!activeProv || !activeProv.id) {
        return new Response(JSON.stringify({ ok: false, error: "no active provider" }), { status: 400, headers: jsonHeaders() });
      }
      // 同步修正 body.active_provider，保证 providers-state.yaml / chat/config.json 一致
      if (body.active_provider !== activeProv.name) body.active_provider = activeProv.name;
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
            let curId = null, curModel = "", curBase = "", curName = "", curTemp = null, curMax = null;
            lines.forEach(line => {
              const km = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
              if (km) {
                if (curId && curModel) allProvConfig[curId] = { model: curModel, base_url: curBase, name: curName, temperature: curTemp, max_tokens: curMax };
                curId = km[1]; curModel = ""; curBase = ""; curName = ""; curTemp = null; curMax = null;
                return;
              }
              const mm = line.match(/^    model:\s*(.+)\s*$/);
              if (mm && curId) { curModel = mm[1].trim(); return; }
              const bm = line.match(/^    base_url:\s*(.+)\s*$/);
              if (bm && curId) { curBase = bm[1].trim(); return; }
              const nm = line.match(/^    name:\s*(.+)\s*$/);
              if (nm && curId) { try { curName = JSON.parse(nm[1].trim()); } catch { curName = nm[1].trim(); } }
              const tm = line.match(/^    temperature:\s*(.+)\s*$/);
              if (tm && curId) { const t = parseFloat(tm[1].trim()); if (!isNaN(t)) curTemp = t; }
              const xm = line.match(/^    max_tokens:\s*(.+)\s*$/);
              if (xm && curId) { const x = parseInt(xm[1].trim(), 10); if (!isNaN(x)) curMax = x; }
            });
            if (curId && curModel) allProvConfig[curId] = { model: curModel, base_url: curBase, name: curName, temperature: curTemp, max_tokens: curMax };
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
        const incomingTemp = p.temperature != null ? parseFloat(p.temperature) : null;
        const incomingMax = p.max_tokens != null ? parseInt(p.max_tokens, 10) : null;
        allProvConfig[p.id] = {
          model,
          base_url: baseUrl,
          name: incomingName || existingEntry?.name || "",
          temperature: (incomingTemp != null && !isNaN(incomingTemp)) ? incomingTemp : (existingEntry?.temperature ?? null),
          max_tokens: (incomingMax != null && !isNaN(incomingMax)) ? incomingMax : (existingEntry?.max_tokens ?? null),
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
            if (cfg.temperature != null) entry += `\n    temperature: ${cfg.temperature}`;
            if (cfg.max_tokens != null) entry += `\n    max_tokens: ${cfg.max_tokens}`;
            return entry;
          })
          .join("\n");
        const stateContent = `providers:\n${stateLines}\n`;
        writeFileSync(statePath, stateContent);
      } catch (e) {
        // 非致命错误
      }

      // ── 持久化完整模型列表（models 数组）到 provider-models.json ─────────────
      // providers-state.yaml 只存当前默认模型，模型多选列表单独存 VAR_DIR，升级不丢失
      try {
        const modelsPath = `${VAR_DIR}/provider-models.json`;
        const incomingModels = {};
        (body.providers || []).forEach(p => {
          if (!p.id || !Array.isArray(p.models)) return;
          incomingModels[p.id] = p.models;
        });
        writeFileSync(modelsPath, JSON.stringify(incomingModels, null, 2));
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

      // ── 构建 providers: 段（v0.20.33 修复）──
      // Hermes 0.18.x/0.19.0 选 provider 依赖 providers: 列表，仅写 model.provider 会报
      // "No inference provider configured"。因此除本地 hermes 代理外，A/B/custom 全部写 providers: 段。
      const customEntries = Object.entries(allProvConfig)
        .sort(([a], [b]) => {
          if (a === providerId) return -1;
          if (b === providerId) return 1;
          return a.localeCompare(b);
        })
        .filter(([id]) => id !== "hermes")
        .map(([id, pcfg]) => {
          const preset = PROVIDER_PRESETS[id];
          let baseUrl = String(pcfg.base_url || "").trim();
          if (!baseUrl && preset && preset.base_url) baseUrl = preset.base_url;
          if (!baseUrl) {
            log(`跳过 provider "${id}"：缺少 base_url，未写入 config.yaml providers 段`);
            return null;
          }
          // 段名用 PROVIDER_HERMES_IDS 映射（openai→openai-api），与 model.provider 对齐
          const hermesId = PROVIDER_HERMES_IDS[id] || id;
          // 本地模型（local-* 动态 id）：本地 OpenAI 兼容服务无需鉴权
          if (String(id).indexOf("local-") === 0) {
            return `  ${hermesId}:\n` +
                   `    base_url: ${yamlScalar(baseUrl)}\n` +
                   `    default_model: ${yamlScalar(pcfg.model || "auto")}`;
          }
          const envVar = PROVIDER_API_KEYS[id] || customEnvKey(id);
          return `  ${hermesId}:\n` +
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
        const newModel = `model:\n  provider: ${hermesProvider}\n  default: ${resolvedModel}`;
        // 用单一可靠函数替换 model / providers 顶层块：兼容 inline 与 block 两种形态，
        // 且无论文件里残留多少重复顶层键（重复 model:/providers: 是「No inference provider configured」的根因），
        // 都只保留我们写入的这一份，彻底消除配置漂移导致的网关 502。
        ymlContent = _setTopLevelBlock(ymlContent, "model", newModel);
        ymlContent = _setTopLevelBlock(ymlContent, "providers", providersBlock ? providersBlock.trimEnd() : "");
        writeFileSync(yamlPath, ymlContent);
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: "write config.yaml: " + e.message }), { status: 500, headers: jsonHeaders() });
      }

      // ── 扩展能力（LightAgent 集成）：toolsets / mcp_servers / skills / persona ──
      // 网关只在启动时一次性加载 config.yaml 的 toolsets：新工具集（如 delegation）写入后
      // 必须重启网关才能真正加载对应工具（delegate_task 等）。此处追踪 toolsets 是否有新增，
      // 写盘后据此触发网关重启，否则「启用专家团」后 delegate_task 永远不可用、委派形同虚设。
      let _toolsetsChanged = false;
      if (body.extensions && typeof body.extensions === "object") {
        try {
          _writeExtensionsFile(body.extensions);
          const yamlPath2 = `${DATA_DIR}/config.yaml`;
          if (existsSync(yamlPath2)) {
            let y2 = readFileSync(yamlPath2, "utf8");
            // toolsets：基础 hermes-cli 必留；保留 config.yaml 中已有的全部工具集
            // （含用户在 /proxy/dashboard 开启的 25 个），仅依据 fnos 镜像「补充」显式开启项，
            // 绝不因镜像未列出而禁用原生已开启的工具集。
            const BASE_TS = ["hermes-cli"];
            const TOGGLE_TS = ["code_execution","terminal","file","web","browser","vision","memory","todo","skills","clarify","delegation"];
            let mergedTs = _extractYamlList(y2, "toolsets");
            const _beforeTs = new Set(mergedTs);
            const seen = new Set(mergedTs);
            BASE_TS.forEach(b => { if (!seen.has(b)) { mergedTs.unshift(b); seen.add(b); } });
            const tsMap = body.extensions.toolsets || {};
            TOGGLE_TS.forEach(n => { if (tsMap[n] && !seen.has(n)) { mergedTs.push(n); seen.add(n); } });
            y2 = _setYamlListBlock(y2, "toolsets", mergedTs);
            // 检测是否有新增工具集（如启用专家团时开启 delegation）：网关需重启才能加载新工具
            _toolsetsChanged = mergedTs.some(t => !_beforeTs.has(t));
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

      // ── toolsets 变化时重启网关（异步、尽力而为，与频道绑定行为一致）──
      // 启用专家团会把 delegation 写入 config.yaml，但运行中的网关不会热加载，
      // delegate_task 工具直到网关重启才可用。此处触发重启使任务委派真正生效。
      if (_toolsetsChanged) {
        _triggerGatewayRestart("toolsets-change");
      }

      // ── 强制 Markdown 格式输出（Issue #12）：网关默认 strip 会剥离所有格式 ──
      try {
        const yamlPath = `${DATA_DIR}/config.yaml`;
        if (existsSync(yamlPath)) {
          let y = readFileSync(yamlPath, "utf8");
          const dm = y.match(/^display:[\s\S]*?^  final_response_markdown:\s*(\S+)/m);
          const current = dm ? dm[1] : "";
          if (current !== "gfm") {
            if (dm) {
              const before = y.slice(0, dm.index + dm[0].indexOf("final_response_markdown:"));
              const after = y.slice(dm.index + dm[0].length);
              y = before + "final_response_markdown: gfm" + after;
            } else if (y.match(/^display:/m)) {
              y = y.replace(/^display:/m, "display:\n  final_response_markdown: gfm");
            } else {
              y = y.trimEnd() + "\n\ndisplay:\n  final_response_markdown: gfm\n";
            }
            writeFileSync(yamlPath, y);
            log("已自动校正 display.final_response_markdown → gfm");
          }
        }
      } catch (e) { log("校正 display.final_response_markdown 失败: " + e.message); }

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
        // 同步所有 provider 到 config.json，确保 resolveChatProviders 能找到任意 provider
        (body.providers || []).forEach(p => {
          if (!p.id) return;
          const idx = chatCfg.providers.findIndex(cp => cp.id === p.id || cp.name === p.name);
          if (idx >= 0) {
            chatCfg.providers[idx] = Object.assign({}, chatCfg.providers[idx], p);
          } else {
            chatCfg.providers.push(p);
          }
        });
        saveChatConfig(chatCfg);
      } catch {}

      return new Response(JSON.stringify({ ok: true, gateway_restarting: _toolsetsChanged }), { headers: jsonHeaders() });
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

  // 获取指定 provider 的明文 API Key（仅本机 UI 使用，已经过 monitor token 鉴权）
  if (path === "/api/provider-key" && req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!id) return new Response(JSON.stringify({ error: "missing id" }), { status: 400, headers: jsonHeaders() });
    // 从已保存的 providers 中找到对应 provider
    const cfg = getChatConfig();
    const provider = (cfg.providers || []).find(p => p.id === id || p.name === id);
    if (!provider) return new Response(JSON.stringify({ error: "provider not found" }), { status: 404, headers: jsonHeaders() });
    const realKey = resolveRealApiKey(provider);
    return new Response(JSON.stringify({ ok: true, api_key: realKey || "" }), { headers: jsonHeaders() });
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
    // mode=connectivity：纯连接测试（模型编辑弹窗「验证连接」按钮）。
    // 只返回连通性 + 模型数量，不返回模型列表，避免前端误刷新/覆盖全部模型配置。
    if (body.mode === "connectivity") {
      if (result.error) {
        return new Response(JSON.stringify({ ok: false, error: result.error, latency: result.latency || 0, latency_ms: result.latency || 0 }), { headers: jsonHeaders() });
      }
      return new Response(JSON.stringify({ ok: true, model_count: (result.models || []).length, latency: result.latency, latency_ms: result.latency }), { headers: jsonHeaders() });
    }
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

  // 匹配 /api/sessions/:id/usage
  const usageMatch = path.match(/^\/api\/sessions\/([^/]+)\/usage$/);
  if (usageMatch && req.method === "GET") {
    const sid = decodeURIComponent(usageMatch[1]);
    const s = getSession(sid);
    if (!s) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
    const ext = _readExtensionsFile() || { toolsets: {}, skills_dirs: [], persona: "default", memory: { enabled: true, char_limit: 2200 } };
    // 统计本地已安装技能数量
    let localSkillCount = 0;
    try {
      const dirs = ext.skills_dirs || [];
      for (const d of dirs) {
        if (existsSync(d)) {
          const files = readdirSync(d);
          localSkillCount += files.filter(f => f.toLowerCase() === "skill.md").length;
        }
      }
    } catch {}
    // 读取长期记忆文本（如果 memory 启用）
    let memoryText = "";
    if (ext.memory && ext.memory.enabled) {
      try {
        const memPath = `${DATA_DIR}/memories/MEMORY.md`;
        const userPath = `${DATA_DIR}/memories/USER.md`;
        if (existsSync(memPath)) memoryText += readFileSync(memPath, "utf8");
        if (existsSync(userPath)) memoryText += readFileSync(userPath, "utf8");
      } catch {}
    }
    const persona = EXT_PERSONAS[ext.persona] || {};
    const usage = computeSessionUsage(s, {
      extensions: ext,
      persona,
      systemPrompt: UI_CAPABILITIES_PROMPT,
      memoryText,
      localSkillCount,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
    return new Response(JSON.stringify({ ok: true, usage }), { headers: jsonHeaders() });
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
    if (req.method === "POST") {
      // resume：把未完成的 streaming checkpoint 消息标记为完成，便于用户继续对话
      const s = getSession(sid);
      if (!s) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
      const last = s.messages[s.messages.length - 1];
      let resumed = false;
      if (last && last.role === "assistant" && last._streaming) {
        delete last._streaming;
        last.ts = Date.now();
        saveSession(s);
        resumed = true;
      }
      return new Response(JSON.stringify({ ok: true, resumed, session: s }), { headers: jsonHeaders() });
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
    const { session_id, message, system, model, provider } = body;
    const messageEmpty = message == null || (Array.isArray(message) && message.length === 0) || (typeof message === "string" && message.length === 0);
    if (!session_id || messageEmpty) {
      return new Response(JSON.stringify({ error: "session_id and message required" }), { status: 400, headers: jsonHeaders() });
    }
    // system 字段携带 persona / 专家团提示，由 createChatStream 注入 system prompt，
    // 避免把人格提示拼进用户消息污染对话历史
    // model/provider 为会话级模型选择，由 resolveChatProviders 优先采用
    wsMessageQueue.set(session_id, { message, system: system || "", model: model || "", provider: provider || "" });
    // 30秒后自动清除（防止 WS 连接未建立导致泄漏）
    setTimeout(() => wsMessageQueue.delete(session_id), 30000);
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  // ─── 聊天：流式 API ──────────────────────────────────────────────────────
  if (path === "/api/chat/stream" && req.method === "POST") {
    const body = await req.json();
    const { session_id, message, system, model, provider } = body;
    const messageEmpty = message == null || (Array.isArray(message) && message.length === 0) || (typeof message === "string" && message.length === 0);
    if (!session_id || messageEmpty) {
      return new Response(JSON.stringify({ error: "session_id and message required" }), {
        status: 400,
        headers: jsonHeaders(),
      });
    }
    return new Response(createChatStream(session_id, message, req.signal, system, { model: model || "", provider: provider || "" }), {
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
    return serveFile(`${STATIC_DIR}/index.html`, "text/html; charset=utf-8", { req, cacheable: false });
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
    return serveFile(fp, ct, { req, cacheable: true });
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

// ─── HTTP/WS 服务（unix socket），支持 socket 文件丢失后自愈重建 ───
import http from "http";

let server = null;
let wss = null;

// 将 Node IncomingMessage 适配为 Web Request，复用 handleFetch 逻辑
function toWebRequest(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (v != null) headers.append(k, v);
      }
      const request = new Request("http://localhost" + req.url, {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        signal: req.destroyed ? AbortSignal.abort() : (req.signal || undefined),
      });
      resolve(request);
    });
    req.on("error", () => {
      const request = new Request("http://localhost" + req.url, {
        method: req.method, headers: new Headers(), signal: AbortSignal.abort(),
      });
      resolve(request);
    });
  });
}

// 将 Web Response 写回 Node ServerResponse
async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { res.setHeader(key, value); });
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}

function startServer() {
  // ─── 热更新回滚检测：若 .hot-restart 标记超过 60 秒仍存在，说明上次热更后启动失败（crash loop），回滚 ───
  try {
    const hotFlag = `${VAR_DIR}/.hot-restart`;
    if (existsSync(hotFlag)) {
      const ts = parseInt(readFileSync(hotFlag, "utf8"), 10) || 0;
      if (Date.now() - ts > 60000) {
        // crash loop 检测：回滚所有 .hot-bak 文件
        log("[HotPatch] crash loop detected, rolling back...");
        try { execSync(`find ${APP_DIR} -name "*.hot-bak" -exec sh -c 'mv "$1" "\${1%.hot-bak}"' _ {} \;`, { timeout: 10000 }); } catch {}
        // 回滚 manifest
        const bakManifest = MANIFEST_FILE + ".hot-bak";
        if (existsSync(bakManifest)) { try { copyFileSync(bakManifest, MANIFEST_FILE); } catch {} }
      }
      // 无论是否回滚，清理标记和备份文件
      try { unlinkSync(hotFlag); } catch {}
      // 启动成功，清理 .hot-bak 文件
      try { execSync(`find ${APP_DIR} -name "*.hot-bak" -delete`, { timeout: 5000 }); } catch {}
    }
  } catch (e) { log("[HotPatch] startup check error: " + e.message); }

  // 启动前清理可能残留的旧 socket，避免 EADDRINUSE
  try { unlinkSync(SOCKET_PATH); } catch {}

  server = http.createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const customResponse = await handleCustomRoute(request);
      if (customResponse instanceof Response) {
        await writeWebResponse(res, customResponse);
        return;
      }
      const response = await handleFetch(request);
      await writeWebResponse(res, response);
    } catch (err) {
      log(`Server error: ${err?.message || err}\n${err?.stack || ""}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      } else { try { res.end(); } catch {} }
    }
  });

  wss = new WebSocketServer({ noServer: true });

  const _handleUpgrade = (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    let wsPath = url.pathname;
    if (BASE_PATH && BASE_PATH !== "/") {
      if (wsPath.startsWith(BASE_PATH + "/")) wsPath = wsPath.slice(BASE_PATH.length);
      else if (wsPath === BASE_PATH) wsPath = "/";
    }
    // 聊天 WS：/api/chat/ws?session_id=xxx&token=xxx
    if (wsPath === "/api/chat/ws") {
      const token = url.searchParams.get("token") || "";
      if (MONITOR_TOKEN && token !== MONITOR_TOKEN) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
      }
      const sessionId = url.searchParams.get("session_id") || "";
      const _q = wsMessageQueue.get(sessionId);
      if (!sessionId || !_q) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return;
      }
      wsMessageQueue.delete(sessionId);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.data = { sessionId, message: _q.message, system: _q.system || "", model: _q.model || "", provider: _q.provider || "", stopCtrl: null };
        attachWsHandlers(ws);
      });
      return;
    }
    // Dashboard WebSocket 反代：/proxy/dashboard/* 以及 /proxy/hermes-agent/*
    // 0.19.0 使用 /api/ws|events|pty，但若 hermes 回退到新版可能出现 /stream 等路径；
    // 同时 fnOS 反向代理可能保留 /proxy/hermes-agent 前缀。这里泛化匹配，避免
    // 因硬编码路径导致 WebSocket 升级被直接 destroy。
    const dashboardProxyPrefixes = ["/proxy/dashboard", "/proxy/hermes-agent"];
    for (const prefix of dashboardProxyPrefixes) {
      if (wsPath.startsWith(prefix + "/")) {
        if (!readPid(PID_DASHBOARD)) {
          socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"); socket.destroy(); return;
        }
        const subPath = wsPath.slice(prefix.length);
        // Dashboard WS 认证要求 ?token=<session_token> 查询参数（浏览器 WS 无法设 header）
        const _sep = url.search ? "&" : "?";
        const targetUrl = `ws://${DASHBOARD_BIND}:${DASHBOARD_PORT}${subPath}${url.search}${_sep}token=${DASHBOARD_SESSION_TOKEN}`;
        log(`[WS-UPGRADE] ${wsPath} -> ${targetUrl}`);
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.data = { type: "dashboard-proxy", targetUrl };
          attachWsHandlers(ws);
        });
        return;
      }
    }
    // 终端 WebSocket：/api/terminal/ws?token=xxx&cwd=xxx
    if (wsPath === "/api/terminal/ws") {
      const token = url.searchParams.get("token") || "";
      if (MONITOR_TOKEN && token !== MONITOR_TOKEN) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
      }
      const cwd = url.searchParams.get("cwd") || DATA_DIR;
      wss.handleUpgrade(req, socket, head, (ws) => {
        log(`[TERMINAL] new session cwd=${cwd}`);
        const shell = spawn("/bin/bash", ["-i"], {
          cwd: existsSync(cwd) ? cwd : DATA_DIR,
          env: { ...process.env, TERM: "xterm-256color", PS1: "\\u@\\h:\\w\\$ " },
          stdio: ["pipe", "pipe", "pipe"],
        });
        shell.stdout.on("data", (d) => { try { ws.send(JSON.stringify({ type: "output", data: d.toString() })); } catch {} });
        shell.stderr.on("data", (d) => { try { ws.send(JSON.stringify({ type: "output", data: d.toString() })); } catch {} });
        shell.on("close", (code) => { try { ws.send(JSON.stringify({ type: "exit", code })); ws.close(); } catch {} });
        shell.on("error", (err) => { try { ws.send(JSON.stringify({ type: "output", data: `\r\n[ERROR] ${err.message}\r\n` })); } catch {} });
        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            if (data.type === "input" && shell.stdin.writable) shell.stdin.write(data.data);
            if (data.type === "resize") { /* bash -i 不支持 resize，忽略 */ }
          } catch {
            // 纯文本输入
            if (shell.stdin.writable) shell.stdin.write(msg.toString());
          }
        });
        ws.on("close", () => { try { shell.kill("SIGHUP"); } catch {} });
      });
      return;
    }
    // 其他升级请求直接拒绝
    socket.destroy();
  };
  server.on("upgrade", _handleUpgrade);

  server.on("error", (err) => {
    log(`Server error: ${err?.message || err}`);
    if (err?.code === "EADDRINUSE") {
      log(`[FATAL] Unix socket ${SOCKET_PATH} 已被占用，可能存在另一个 monitor 实例；退出以避免多实例冲突`);
      process.exit(1);
    }
  });

  server.listen({ path: SOCKET_PATH }, () => {
    try { chmodSync(SOCKET_PATH, 0o777); } catch {}
    log(`Monitor ready — unix:${SOCKET_PATH} (base=${BASE_PATH || "/"}) | dashboard proxied at /proxy/dashboard/`);
    // 若已存在模型配置，自动启动 Gateway/Dashboard（覆盖安装/升级后无需手动点启动）
    setTimeout(() => maybeAutoStartServices(), 2500);
  });

  // ─── 独立 TCP 端口：浏览器直接访问（脱离飞牛框架，自定义 favicon/标签） ───
  const tcpServer = http.createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const response = await handleFetch(request);
      await writeWebResponse(res, response);
    } catch (err) {
      log(`TCP server error: ${err?.message || err}`);
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Internal error" })); }
      else { try { res.end(); } catch {} }
    }
  });
  tcpServer.on("upgrade", _handleUpgrade);
  tcpServer.on("error", (err) => {
    if (err?.code === "EADDRINUSE") log(`[WARN] UI TCP port ${UI_PORT} already in use, standalone access disabled`);
    else log(`TCP server error: ${err?.message || err}`);
  });
  tcpServer.listen(UI_PORT, "0.0.0.0", () => {
    log(`Standalone UI available at http://0.0.0.0:${UI_PORT}/`);
  });

  return server;
}

// 当 providers-state.yaml 中已有真实服务商时，monitor 启动后自动拉起服务
function maybeAutoStartServices() {
  try {
    const statePath = `${VAR_DIR}/providers-state.yaml`;
    if (!existsSync(statePath)) return;
    const content = readFileSync(statePath, "utf8");
    const ids = [...content.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(m => m[1]);
    const hasRealProvider = ids.some(id => id !== "hermes");
    if (!hasRealProvider) {
      log("Auto-start skipped: no real provider in providers-state.yaml");
      return;
    }
    if (readPid(PID_GATEWAY) || readPid(PID_DASHBOARD)) {
      log("Auto-start skipped: gateway/dashboard already running");
      return;
    }
    log("Auto-starting gateway & dashboard (provider config detected) ...");
    spawnHermes("gateway",   PID_GATEWAY,   ["gateway", "run"]);
    spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
  } catch (err) {
    log(`Auto-start error: ${err?.message || err}`);
  }
}

// ─── 单实例守卫（接管式）：最新启动的实例接管，旧实例退出 ───
// 历史教训：早期版本是「较晚的主动退出」，但 fnOS 框架 stop 只杀 app.pid 记录的进程，
// 手动部署/残留的 monitor 杀不掉时，框架 start 的新实例会被守卫逼退 → 应用永远显示「已停止」、点启用无效。
// 现改为接管：检测到更早的 monitor 时，请求其退出（SIGTERM→SIGKILL），本进程继续启动。
// 只有较大 pid 对较小 pid 单向行动，不会出现互杀；热更自重启/覆盖安装/框架重启均能正确接管。
try {
  const earlier = [];
  for (const d of readdirSync("/proc").filter(x => /^\d+$/.test(x))) {
    const pid = Number(d);
    if (!pid || pid === process.pid) continue;
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ");
      if (/node/.test(cmd) && /monitor\.js/.test(cmd) && pid < process.pid) earlier.push(pid);
    } catch {}
  }
  if (earlier.length) {
    log(`[单实例] 检测到更早的 monitor 进程 (pid=${earlier.join(",")})，本实例接管：请求旧实例退出...`);
    for (const p of earlier) { try { process.kill(p, "SIGTERM"); } catch {}
    }
    // 等待优雅退出（最多 6 秒）
    const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && earlier.some(alive)) spawnSync("sleep", ["0.3"]);
    for (const p of earlier) { if (alive(p)) { try { process.kill(p, "SIGKILL"); } catch {} } }
    spawnSync("sleep", ["0.5"]);
    log(`[单实例] 接管完成，继续启动`);
  }
} catch {}

// 启动前清理可能残留的旧 socket，避免 EADDRINUSE 导致启动失败
try { unlinkSync(SOCKET_PATH); } catch {}
startServer();

// ─── 自愈：socket 文件被外部清理（如 fnOS 重置 @appcenter 安装目录）后自动重建 ───
// 现象：monitor.js 进程存活，但 socket 文件被删除，fnOS 代理连不上、UI 转圈。
// 监测到文件丢失即重建监听，无需依赖 fnOS 重启进程。
const _sockDir = SOCKET_PATH.replace(/\/[^/]+$/, '');
setInterval(() => {
  try {
    if (!existsSync(SOCKET_PATH)) {
      log(`[self-heal] 检测到 socket 文件丢失 (${SOCKET_PATH})，正在重建监听…`);
      try { if (server) server.close(); } catch (e) {}
      try { if (wss) wss.close(); } catch (e) {}
      try { unlinkSync(SOCKET_PATH); } catch (e) {}
      try { mkdirSync(_sockDir, { recursive: true }); } catch (e) {}
      startServer();
    }
  } catch (e) {
    log(`[self-heal] 重建失败: ${e?.message || e}`);
  }
}, 10000);

// 端口守卫（P0 修复 v0.20.65，legacy 冗余）：周期性清理「非本包」的外来 hermes 网关/仪表盘进程。
// 历史上 hermes-studio 以其 `--replace` 网关抢占 8642，导致本包聊天被路由到无 provider 的网关；
// 当前本包已迁移到 8742/9219 从根本上规避该冲突，此守卫作为同端口场景下的兜底。
// 仅当本包已配置真实 provider 时才防守，
// 未配置时不干扰其它 hermes 应用。
setInterval(() => {
  try {
    const statePath = `${VAR_DIR}/providers-state.yaml`;
    if (!existsSync(statePath)) return;
    const content = readFileSync(statePath, "utf8");
    const ids = [...content.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(m => m[1]);
    const hasReal = ids.some(id => id !== "hermes");
    if (!hasReal) return;
    killForeignHermesProcesses();
  } catch (e) {}
}, 60000);
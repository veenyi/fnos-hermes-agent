// Hermes Agent 监控服务 — 基于 Node.js 的 HTTP 服务（Unix Socket），WebSocket 由 ws 库提供
import { spawn, spawnSync, execSync, execFile } from "child_process";
import { createRequire } from "module";
import { Readable } from "stream";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, symlinkSync, watch, chmodSync, chownSync, readdirSync, createReadStream, openSync, readSync, closeSync, rmSync, copyFileSync } from "fs";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { resolve as resolvePath, dirname, join } from "path";
import { fileURLToPath } from "url";
import { PROVIDER_PRESETS, PROVIDER_MODELS, PROVIDER_API_KEYS, PROVIDER_CLASSES, PROVIDER_HERMES_IDS } from "./provider-config.js";
import { handleCustomRoute } from "./custom_routes.js";
import { CONNECTOR_CATALOG, getConnector, callConnectorTool, probeConnector } from "./connectors.js";
import { BUILTIN_EXPERTS_ALL } from "./experts-data.js";

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

// ── Cloudflare Tunnel（隧道/外网访问）──
const TUNNEL_BIN_DIR   = `${VAR_DIR}/bin`;
const TUNNEL_BIN       = `${TUNNEL_BIN_DIR}/cloudflared`;
const TUNNEL_STATE_PATH= `${VAR_DIR}/tunnel-state.json`;
const TUNNEL_LOG_PATH  = `${VAR_DIR}/logs/tunnel.log`;
const TUNNEL_CF_VERSION= "2026.7.3";
const TUNNEL_DL_URL    = `https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_CF_VERSION}/cloudflared-linux-amd64`;
// 下载源候选列表（顺序尝试）：ghfast.top 加速镜像优先（中国大陆网络实测 2.6MB/s），GitHub 直连兜底
const TUNNEL_DL_SOURCES = [
  `https://ghfast.top/${TUNNEL_DL_URL}`,
  `https://ghproxy.net/${TUNNEL_DL_URL}`,
  TUNNEL_DL_URL,
];
let _tunnelProc = null;   // 当前 cloudflared 子进程（模块级，避免热更/重启丢失引用）

// ── TTS 可选音色（Edge 语音，用于语音设置弹窗的声音选择）──
const TTS_VOICE_OPTIONS = [
  { id: "zh-CN-XiaoxiaoNeural", name: "晓晓（女·温暖）", desc: "标准普通话，温柔自然" },
  { id: "zh-CN-XiaoyiNeural",   name: "晓伊（女·活泼）", desc: "年轻灵动" },
  { id: "zh-CN-YunxiNeural",    name: "云希（男·阳光）", desc: "青年男声" },
  { id: "zh-CN-YunjianNeural",  name: "云健（男·沉稳）", desc: "成熟男声" },
  { id: "zh-CN-YunxiaNeural",   name: "云夏（男·少年）", desc: "少年音" },
  { id: "zh-CN-liaoning-XiaobeiNeural", name: "晓北（女·东北）", desc: "东北口音" },
  { id: "en-US-AriaNeural",     name: "Aria（英文女声）", desc: "英语语音" },
];

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

// hermes-agent 版本对应的发布日期，仅用于 UI 展示区分（例如 v0.20.0 (2026.8.3)）。
// 默认值取 0.20.0 的发布日期（2026-08-03，tag v2026.8.3）；0.20.0 起官方停止 PyPI 分发，
// 后台 PyPI 拉取将失败并保留默认值。
let HERMES_VERSION_DATE = "2026.8.3";
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
      { env: "WECOM_BOT_ID", path: "extra.bot_id", label: "Bot ID", placeholder: "（扫码授权后自动填入）" },
      { env: "WECOM_SECRET", path: "extra.secret", label: "Secret", placeholder: "（扫码授权后自动填入）", secret: true },
      { env: "WECOM_CORP_ID", path: "extra.corp_id", label: "Corp ID (可选)", placeholder: "传统自建应用模式才需要" },
      { env: "WECOM_AGENT_ID", path: "extra.agent_id", label: "Agent ID (可选)", placeholder: "传统自建应用模式才需要" },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
    note: "企业微信「AI 智能机器人」扫码授权：点下方「企业微信扫码登录」，用企业微信扫码后在手机端确认，Bot ID / Secret 自动填入（与 Octop 一致，无需自备 Corp ID）。",
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
const _wecomQrCache = new Map();      // scode -> {ts, bot_id, secret}（腾讯 ai/qc 接口扫码结果缓存，3s TTL）
let _gwRestartTimer = null;            // 网关重启防抖定时器（模块级，handleFetch 内声明会被每请求重置）
let _gwRestartInProgress = false;      // 网关重启进行中标志（防止并发重启互相杀死对方）

// ─── 定时任务 Webhook 出站投递配置 ──────────────────────────────────────
// hermes cron 原生 deliver 只支持内置通道（weixin/telegram/dingtalk/feishu/wecom 等），
// 不支持出站 Webhook POST。本包在 monitor 侧实现：创建任务时把 webhook 投递目标
// 写入 CRON_WEBHOOKS_FILE，后台轮询 jobs.json 的 last_run_at 变化，新输出 POST 到
// 企微机器人/钉钉机器人等任意 webhook 地址（body 兼容 {"msgtype":"text"} 与纯文本）。
// 结构：{ "<job_id>": [ { url, message, label, last_run_at, last_status, last_error } ] }
const CRON_WEBHOOKS_FILE = `${DATA_DIR}/cron-webhooks.json`;

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
    // 动态探测候选项（不硬编码 python 版本）：
    // ① 旧版 wheel 模式：hermes_cli/tui_dist/entry.js（0.19.0）
    // ② v0.20.0 源码模式：hermes-src/ui-tui/dist/entry.js（打包时预构建）
    const pyResult = spawnSync(
      `${VENV_BIN}/python3`, ["-c", "import hermes_cli,os;print(os.path.dirname(hermes_cli.__file__))"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const hermesCli = pyResult.stdout?.toString().trim();
    const candidates = [];
    if (hermesCli) candidates.push(`${hermesCli}/tui_dist/entry.js`);
    candidates.push(`${APP_DIR}/hermes-src/ui-tui/dist/entry.js`);
    let linked = null;
    for (const cand of candidates) {
      if (cand && existsSync(cand)) { linked = cand; break; }
    }
    if (linked) {
      try { unlinkSync(tuiEntry); } catch {}
      symlinkSync(linked, tuiEntry);
      console.log(`[monitor] tui symlink: ${tuiEntry} -> ${linked}`);
    } else {
      console.log("[monitor] WARNING: TUI bundle not found (checked hermes_cli/tui_dist and hermes-src/ui-tui/dist), TUI may rely on bundled fallback");
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
    try { process.kill(oldPid, "SIGTERM"); } catch {}
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
function writeJSON(path, data, pretty) {
  writeFileSync(path, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
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
      writeJSON(CONFIG_FILE, def, true);
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
    if (needsSave) writeJSON(CONFIG_FILE, cfg, true);
    return cfg;
  } catch {
    const def = defaultConfig();
    writeJSON(CONFIG_FILE, def);
    return def;
  }
}
function saveChatConfig(cfg) {
  writeJSON(CONFIG_FILE, cfg, true);
}
function getActiveProvider() {
  const cfg = getChatConfig();
  return cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
}

// 读取 Hermes 网关当前配置的 provider/model（网关始终用此配置跑 agent，
// 会忽略请求里的 model 字段）。用于判断会话级选择的模型能否经网关获得工具调用能力。
// 注意：monitor 的 DATA_DIR 与网关实际 HERMES_HOME 可能不同（如 @appdata vs @apphome），
// 因此依次扫描候选路径，取第一个含 model 段的 config.yaml。
function readGatewayModelConfig() {
  const candidates = [];
  try { if (existsSync(HERMES_CONFIG)) candidates.push(HERMES_CONFIG); } catch {}
  try {
    // 网关进程多以系统用户家目录为 HERMES_HOME（如 /vol1/@apphome/<user>/data）
    const passwd = readFileSync("/etc/passwd", "utf8");
    for (const line of passwd.split("\n")) {
      const m = line.match(/^(hermes[^:]*|fn_hermes[^:]*):[^:]*:[^:]*:[^:]*:[^:]*:([^:]+):/);
      if (m && m[2]) {
        candidates.push(`${m[2]}/data/config.yaml`);
        candidates.push(`${m[2]}/.hermes/config.yaml`);
      }
    }
  } catch {}
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const yml = readFileSync(p, "utf8");
      const blockMatch = yml.match(/^model:[ \t]*\n((?:[ \t]+[^\n]*\n?)+)/m);
      if (!blockMatch) continue;
      const block = blockMatch[1];
      const pm = block.match(/^[ \t]+provider:[ \t]*(\S+)/m);
      const dm = block.match(/^[ \t]+default:[ \t]*(\S+)/m);
      const provider = pm ? pm[1].replace(/^["']|["']$/g, "") : "";
      const model = dm ? dm[1].replace(/^["']|["']$/g, "") : "";
      if (provider || model) return { provider, model, path: p };
    } catch { /* 继续尝试下一个候选 */ }
  }
  return null;
}

// 模块级 YAML 顶层块提取（注意：handleFetch 内部另有一个同名嵌套的 _yamlBlockOf，
// 模块级代码不可访问，此处单独实现）
function _yamlTopBlock(yml, key) {
  const m = yml.match(new RegExp("^" + key + ":[ \\t]*\\n([\\s\\S]*?)(?=^[a-zA-Z_][\\w-]*:|$(?![\\s\\S]))", "m"));
  return m ? m[1] : "";
}

// 解析所选 provider 在网关 config.yaml providers: 段中的 slug：
// 优先直接匹配（候选 slug 已定义），其次按 base_url 反查。
// 返回 { slug } 或 null（未定义则无法经网关执行所选模型）。
function _resolveGatewayProviderSlug(yml, candidates, baseUrl) {
  try {
    const provBlock = _yamlTopBlock(yml, "providers");
    if (!provBlock) return null;
    const defined = new Set();
    const bases = {}; // slug → base_url
    for (const line of provBlock.split("\n")) {
      const km = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (km) { defined.add(km[1]); continue; }
      const bm = line.match(/^    base_url:\s*(.+)\s*$/);
      if (bm) {
        // 取最近一个定义的 slug
        const last = [...defined].pop();
        if (last) bases[last] = bm[1].replace(/^["']|["']$/g, "").trim().replace(/\/$/, "");
      }
    }
    for (const c of (candidates || [])) {
      if (c && defined.has(c)) return { slug: c };
    }
    if (baseUrl) {
      const norm = String(baseUrl).replace(/\/$/, "");
      for (const [slug, b] of Object.entries(bases)) {
        if (b === norm) return { slug };
      }
    }
    return null;
  } catch { return null; }
}

// v0.21.23 修复会话级模型切换不生效：
// Hermes 网关的 /v1/chat/completions 会忽略请求里的 model 字段，始终按 config.yaml
// 的 model.default 执行（实测确认网关每次请求热加载 config.yaml，改完立即生效、无需重启）。
// 因此会话窗口选择模型时，直接把网关 config.yaml 的 model.provider/model.default
// 改成所选组合，让网关 agent 用所选模型执行（保留完整工具能力）。
// 注意：必须保持文件原 owner（hermes-agent），否则网关读不到 config 会报
// "HTTP 400: required model"（sed/mv 以 root 操作会破坏所有权，这里写完立即 chown 回去）。
function applyGatewayModelOverride(hermesProvider, model, baseUrl) {
  try {
    const gcfg = readGatewayModelConfig();
    if (!gcfg || !gcfg.path) return { ok: false, reason: "config not found" };
    const yml = readFileSync(gcfg.path, "utf8");
    // 解析目标 provider 在网关中的 slug（直匹配或 base_url 反查）
    const resolved = _resolveGatewayProviderSlug(yml, [hermesProvider], baseUrl);
    if (!resolved) {
      log(`[ModelRoute] applyGatewayModelOverride: provider "${hermesProvider}" not defined in gateway config - skip`);
      return { ok: false, reason: "provider not defined" };
    }
    const slug = resolved.slug;
    const already = gcfg.provider === slug && gcfg.model === model;
    if (already) return { ok: true, changed: false, cfg: gcfg };
    // 保持原 owner/mode（gateway 以 hermes-agent 用户读取）
    const st = statSync(gcfg.path);
    const blockMatch = yml.match(/^model:[ \t]*\n((?:[ \t]+[^\n]*\n?)+)/m);
    if (!blockMatch) return { ok: false, reason: "no model block" };
    let block = blockMatch[1];
    let hitP = false, hitD = false;
    block = block.replace(/^([ \t]+provider:)[ \t]*\S+.*$/m, (mm, k) => { hitP = true; return `${k} ${slug}`; });
    block = block.replace(/^([ \t]+default:)[ \t]*\S+.*$/m, (mm, k) => { hitD = true; return `${k} ${model}`; });
    if (!hitP || !hitD) return { ok: false, reason: "model block incomplete" };
    const next = yml.slice(0, blockMatch.index) + "model:\n" + block + yml.slice(blockMatch.index + blockMatch[0].length);
    writeFileSync(gcfg.path, next);
    try { chownSync(gcfg.path, st.uid, st.gid); chmodSync(gcfg.path, st.mode & 0o777); } catch {}
    log(`[ModelRoute] gateway config.yaml updated: provider=${slug} default=${model} (hot-reload, no restart)`);
    return { ok: true, changed: true, cfg: { provider: slug, model, path: gcfg.path } };
  } catch (e) {
    log(`[ModelRoute] applyGatewayModelOverride failed: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

// 定位网关路由索引文件（sessions.json，legacy mirror of gateway_routing 表）。
// 网关实际 HERMES_HOME 可能与 monitor 的 DATA_DIR 不同（如 @appdata vs @apphome），
// 因此依次扫描候选路径，返回第一个存在的位置。
function _gatewayRoutingPath() {
  const candidates = [];
  try { candidates.push(`${DATA_DIR}/sessions/sessions.json`); } catch {}
  try {
    const passwd = readFileSync("/etc/passwd", "utf8");
    for (const line of passwd.split("\n")) {
      const m = line.match(/^(hermes[^:]*|fn_hermes[^:]*):[^:]*:[^:]*:[^:]*:[^:]*:([^:]+):/);
      if (m && m[2]) {
        candidates.push(`${m[2]}/data/sessions/sessions.json`);
        candidates.push(`${m[2]}/.hermes/sessions/sessions.json`);
      }
    }
  } catch {}
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return null;
}

// 从网关路由索引提取指定平台的全部 chat_id（key 形如 agent:main:weixin:dm:<chat_id>）。
// 用于把通道级模型/系统提示写入网关唯一认的 channel_overrides[chat_id]。
function _gatewayChatIds(platformId) {
  try {
    const p = _gatewayRoutingPath();
    if (!p) return [];
    const raw = readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return [];
    const re = new RegExp("^agent:main:" + String(platformId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(dm|group|supergroup|thread):(.+)$");
    const ids = [];
    for (const k of Object.keys(data)) {
      const m = k.match(re);
      if (m && m[2]) ids.push(m[2]);
    }
    return [...new Set(ids)];
  } catch (e) { return []; }
}

// 定时同步通道级模型覆盖：网关 0.19 的 PlatformConfig 只认 channel_overrides（按 chat_id），
// 不认 platforms.<id>.model/profile 字段。因此凡配置了通道模型/系统提示的平台，
// 都要把覆盖同步到该平台全部已知 chat_id（含保存后新增的会话）。
function _syncChannelOverrides() {
  try {
    for (const chId of Object.keys(CHANNEL_DEFS)) {
      const cfg = _readPlatformConfig(chId);
      const model = cfg.model ? String(cfg.model).trim() : "";
      const sysPrompt = (cfg.system_prompt != null) ? String(cfg.system_prompt).trim() : "";
      if (!model && !sysPrompt) continue;
      const chatIds = _gatewayChatIds(chId);
      if (!chatIds.length) continue;
      const ov = (cfg.channel_overrides && typeof cfg.channel_overrides === "object") ? cfg.channel_overrides : {};
      let changed = false;
      chatIds.forEach(cid => {
        const cur = (ov[cid] && typeof ov[cid] === "object") ? ov[cid] : {};
        if (model && cur.model !== model) { cur.model = model; changed = true; }
        if (sysPrompt && cur.system_prompt !== sysPrompt) { cur.system_prompt = sysPrompt; changed = true; }
        ov[cid] = cur;
      });
      if (changed) {
        cfg.channel_overrides = ov;
        cfg.updated_at = Date.now();
        _writeHermesConfig(_setPlatformConfig(chId, cfg));
        log(`[ChannelOverride] 已同步 ${chId} 通道模型覆盖到 ${chatIds.length} 个会话 (model=${model}${sysPrompt ? " +sys_prompt" : ""})`);
      }
    }
  } catch (e) {}
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
          const provBlock = _yamlTopBlock(yml, "providers");
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
                  hermesSlug: match.hermesId,
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
      // 关键修复（v0.21.23）：网关 /v1/chat/completions 忽略请求 model 字段，只按
      // config.yaml 的 model.default 执行。会话选了模型时直接改写网关 config.yaml
      // （网关热加载、立即生效），使所选模型经网关执行且保留完整 agent 工具能力；
      // 改写失败时回退直连 provider（尊重所选模型，但没有工具能力）。
      const wantSlug = effective.hermesSlug || PROVIDER_HERMES_IDS[effective.id] || effective.id;
      const preCfg = readGatewayModelConfig();
      // model 为 auto/空时不指定具体模型：不改写网关配置，沿用网关当前默认（保持旧行为）
      const hasConcreteModel = effective.model && effective.model !== "auto";
      const modelConsistent = preCfg && preCfg.provider === wantSlug && (!hasConcreteModel || preCfg.model === effective.model);
      const ovRes = hasConcreteModel
        ? applyGatewayModelOverride(wantSlug, effective.model, effective.base_url)
        : { ok: modelConsistent, changed: false, reason: hasConcreteModel ? "" : "no concrete model" };
      const provMatches = ovRes.ok || (preCfg && (String(effective.id) === preCfg.provider || PROVIDER_HERMES_IDS[effective.id] === preCfg.provider));
      // 仅当「网关已按所选模型执行」（改写成功或本就一致）时才经网关路由；
      // provider 一致但模型不一致且改写失败 → 直连，避免网关仍用旧模型回复。
      if (provMatches && (ovRes.ok || modelConsistent)) {
        effective.viaGateway = true;
        log(`[ModelRoute] session override → provider=${effective.id} model=${effective.model} via GATEWAY (agent tools enabled${ovRes.changed ? ", gateway default switched" : ""})`);
      } else {
        log(`[ModelRoute] session override → provider=${effective.id} model=${effective.model} base=${effective.base_url} (direct, no tools; gateway switch failed: ${ovRes.reason || "provider mismatch"})`);
      }
      return [effective];
    }
    log(`[ModelRoute] WARNING: could not resolve provider "${modelOverride.provider}" - falling back to default`);
  }
  const primary = cfg.providers.find(p => p.name === cfg.active_provider) || cfg.providers[0];
  const allProviders = [Object.assign({}, primary)];
  // v0.21.2+ 修复：默认对话同样经网关 agent 路由（直连 provider 无工具，
  // AI 只能输出命令让用户手动执行；经网关才有完整 agent 工具能力）
  const _gcfg = readGatewayModelConfig();
  const _provMatch = _gcfg && (String(allProviders[0].id) === _gcfg.provider || PROVIDER_HERMES_IDS[allProviders[0].id] === _gcfg.provider);
  if (_provMatch) {
    allProviders[0].viaGateway = true;
    log(`[ModelRoute] default provider="${allProviders[0].name}" → via GATEWAY (agent tools enabled)`);
  }
  if (cfg.fallback_providers && cfg.fallback_providers.length > 0) {
    for (const fbName of cfg.fallback_providers) {
      const fb = cfg.providers.find(p => p.name === fbName);
      if (fb && primary && fb.name !== primary.name) allProviders.push(Object.assign({}, fb));
    }
  }
  return allProviders;
}

function sessionFile(id) {
  return `${SESSIONS_DIR}/${id}.json`;
}
// ── 会话列表内存缓存：避免每次 /api/sessions 全量读盘 + JSON.parse 所有会话文件 ──
// 会话文件随对话增长（含全部消息），50 个会话 × 数百 KB 时每次同步解析可达秒级。
// saveSession/deleteSession 主动维护缓存（列表实时），TTL 仅作外部改动兜底。
let _sessionMetaCache = null;                 // { builtAt, map: Map<id,meta> }
const SESSION_META_TTL = 5000;                // ms，兜底重建周期
// 活跃 profile 内存缓存（模块级！handleFetch 每请求执行，若声明在函数内每次请求都会重置而失效）
let _activeProfileCache = null;
function _sessionMetaFromData(s) {
  return { id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at, message_count: (s.messages || []).length };
}
function _buildSessionMetaMap() {
  const map = new Map();
  try {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
    files.forEach(f => {
      try {
        const s = readJSON(`${SESSIONS_DIR}/${f}`);
        const meta = _sessionMetaFromData(s);
        if (meta.id) map.set(meta.id, meta);
      } catch { /* 忽略损坏/不可读文件 */ }
    });
  } catch { /* 目录不可读时返回空 */ }
  return map;
}
function listSessions() {
  const now = Date.now();
  if (!_sessionMetaCache || (now - _sessionMetaCache.builtAt) > SESSION_META_TTL) {
    _sessionMetaCache = { builtAt: now, map: _buildSessionMetaMap() };
  }
  return Array.from(_sessionMetaCache.map.values()).sort((a, b) => b.updated_at - a.updated_at);
}
function getSession(id) {
  const f = sessionFile(id);
  if (!existsSync(f)) return null;
  try { return readJSON(f); } catch { return null; }
}
function saveSession(s) {
  s.updated_at = Date.now();
  writeJSON(sessionFile(s.id), s);
  if (_sessionMetaCache) _sessionMetaCache.map.set(s.id, _sessionMetaFromData(s));
  try { _sessionSigCache.set(s.id, computeSessionSig(s)); } catch {}
}
function deleteSession(id) {
  const f = sessionFile(id);
  if (existsSync(f)) unlinkSync(f);
  if (_sessionMetaCache) _sessionMetaCache.map.delete(id);
  _sessionSigCache.delete(id);
}

// ── 会话同步签名：多窗口/多端消息同步（前端轮询几十字节的签名，变化才拉全量）──
// saveSession 每次落盘时同步刷新，/api/sessions/:id/sync 直接内存命中，零读盘。
let _sessionSigCache = new Map(); // id → sig
function computeSessionSig(s) {
  const msgs = s.messages || [];
  const last = msgs[msgs.length - 1];
  let lastPart = "";
  if (last) {
    const c = typeof last.content === "string" ? last.content : JSON.stringify(last.content || "");
    lastPart = (last.role || "") + ":" + (last.ts || last.created_at || 0) + ":" + c.length + ":" +
      (last._streaming ? 1 : 0) + ":" + ((last.tools || []).length);
  }
  return msgs.length + "|" + lastPart + "|" + (s.updated_at || 0);
}
function sessionSig(id) {
  if (_sessionSigCache.has(id)) return _sessionSigCache.get(id);
  const s = getSession(id);
  if (!s) return null;
  const sig = computeSessionSig(s);
  _sessionSigCache.set(id, sig);
  return sig;
}

function createSSEParser(onDelta, onDone, onError, onToolEvent, onUsage, onReasoning) {
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
          // 推理模型（deepseek-v4-flash 等）：思考内容在 reasoning_content 字段，
          // 必须转发给前端，否则 UI 一直等不到 content 而卡死
          const _rd = json.choices?.[0]?.delta?.reasoning_content || "";
          if (_rd && onReasoning) onReasoning(_rd);
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
              const _rd2 = json.choices?.[0]?.delta?.reasoning_content || "";
              if (_rd2 && onReasoning) onReasoning(_rd2);
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
  // 会话级模型选择与网关配置一致时，一律经网关（保留 agent 工具调用能力）
  if (provider && provider.viaGateway) {
    return GATEWAY_API.replace(/\/$/, "");
  }
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

// 推理模型判断：思考内容（reasoning_content）会大量占用输出 token，
// 若 max_tokens 被思考占满，content 永远为空 → UI 卡死（v0.21.2+ 会话选模型的根因）。
function isReasoningModel(provider) {
  if (!provider) return false;
  const model = String(provider.model || "").toLowerCase();
  if (Array.isArray(provider.models) && model && model !== "auto") {
    const hit = provider.models.find(m => String(m.id || m.name || "").toLowerCase() === model);
    if (hit && typeof hit.supports_reasoning === "boolean") return hit.supports_reasoning;
  }
  return /deepseek-v4|deepseek-r1|deepseek-reasoner|reasoner|o1|o3|kimi-k2|glm-4\.6|glm-5|qwen3|qwen-r1|think/i.test(model);
}
function resolveMaxTokens(provider) {
  if (isReasoningModel(provider)) {
    // 推理模型：思考 + 正文至少要 16K 输出，避免思考占满 4096 后被截断
    return Math.max(Number(provider.max_tokens) || 0, 16384);
  }
  return provider.max_tokens ?? 4096;
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
      max_tokens: resolveMaxTokens(provider),
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
  // 文档/表格/演示
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // 文本/代码/Markdown
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
  csv: "text/csv", json: "application/json", yaml: "text/yaml", yml: "text/yaml",
  xml: "application/xml", log: "text/plain", ini: "text/plain", conf: "text/plain",
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", ts: "text/plain",
  tsx: "text/plain", jsx: "text/plain", py: "text/x-python", sh: "text/x-sh", bash: "text/x-sh",
  c: "text/x-c", h: "text/x-c", cpp: "text/x-c", cc: "text/x-c", hpp: "text/x-c",
  java: "text/x-java", go: "text/x-go", rs: "text/x-rust", rb: "text/x-ruby", php: "text/x-php",
  html: "text/html", htm: "text/html", css: "text/css", sql: "text/x-sql",
  zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
  tgz: "application/gzip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime",
  webm: "video/webm",
};
function mimeFromPath(p) {
  const ext = (p.split(".").pop() || "").toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}
// 下载/预览时用于浏览器内联展示的类型白名单（其余强制附件下载）
function isInlinePreviewType(p) {
  const ext = (p.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "pdf", "html", "htm"].includes(ext)) return true;
  const mime = MIME_BY_EXT[ext] || "";
  return mime.startsWith("text/") || mime.startsWith("image/") || mime === "application/pdf";
}
function urlToUploadPath(url) {
  if (!url) return null;
  // 工作区附加文件：前端以 /api/download?path=<绝对路径> 引用，这里解析回真实路径
  if (url.startsWith("/api/download?path=")) {
    let qs = url.slice("/api/download?path=".length);
    try { qs = decodeURIComponent(qs); } catch {}
    const p = qs.split("&")[0];
    if (!p) return null;
    const fp = resolveFilePath(p);
    return fp || (p.startsWith("/") ? p : null);
  }
  // Profile 隔离上传：/uploads/p/<profile>/images|files/xxx
  if (url.startsWith("/uploads/p/")) {
    const rest = url.slice("/uploads/p/".length);
    const slash = rest.indexOf("/");
    if (slash > 0) {
      const profile = rest.slice(0, slash);
      const sub = rest.slice(slash + 1);
      if (sub.startsWith("images/")) return `${DATA_DIR}/profiles/${profile}/uploads/images/${sub.slice("images/".length)}`;
      if (sub.startsWith("files/")) return `${DATA_DIR}/profiles/${profile}/uploads/files/${sub.slice("files/".length)}`;
    }
  }
  if (url.startsWith("/uploads/images/")) return `${UPLOAD_IMG_DIR}/${url.slice("/uploads/images/".length)}`;
  if (url.startsWith("/uploads/files/")) return `${UPLOAD_FILE_DIR}/${url.slice("/uploads/files/".length)}`;
  if (url.startsWith("/uploads/")) return `${UPLOAD_DIR}/${url.slice("/uploads/".length)}`;
  return url;
}
// 下载/预览路径解析：支持绝对路径、~/ 相对 HOME、相对路径（以 DATA_DIR 为基准）、/uploads 别名
function resolveFilePath(p, base = DATA_DIR) {
  if (!p || typeof p !== "string") return null;
  let s = p.trim();
  if (!s) return null;
  if (s.startsWith("/uploads/")) { const fp = urlToUploadPath(s); return existsSync(fp) ? fp : null; }
  if (s.startsWith("~/")) s = `${base}/${s.slice(2)}`;
  else if (s === "~") s = base;
  else if (!s.startsWith("/")) s = `${base}/${s}`;
  // 规范化，防止路径穿越
  const norm = s.split("/").reduce((acc, seg) => {
    if (seg === ".." || seg === ".") return acc;
    acc.push(seg); return acc;
  }, []).join("/");
  if (!norm.startsWith("/")) return null;
  try {
    const st = statSync(norm);
    if (!st.isFile()) return null;
    return norm;
  } catch { return null; }
}
function safeFilename(name) {
  const n = String(name || "file").replace(/[\r\n\x00/\\]/g, "_").replace(/\.\.+/g, ".").slice(-180);
  return n || "file";
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
              (r) => { sendJSON({ reasoning: r }); },
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

            // SSE 流内错误事件（如 gateway "No inference provider configured"）仅在
            // 已产出内容时可忽略；空回复 + error 事件 → 保留 requestError，
            // 让下方错误分支展示真实原因，避免 UI 显示误导性的「(Gateway 连接失败)」
            if (fullReply || !requestError) requestError = null;
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
      // 重连且无新消息时无法起新流，直接告知错误
      if (message == null) {
        sendJSON({ error: '等待上一轮回复超时，请重新发送消息' });
        sendJSON({ done: true });
        try { ws.close(1000); } catch {}
        return;
      }
    }
    if (existingCache.status === 'error') {
      log(`[WS] cache hit (error) session=${sessionId}`);
      sendJSON({ error: existingCache.error || 'Previous stream failed' });
      sendJSON({ done: true });
      try { ws.close(1000); } catch {}
      return;
    }
  }

  // 重连场景但没有可用缓存（无新消息也无进行中/已完成的流）→ 告知并关闭
  if (message == null) {
    log(`[WS] reconnect without cache session=${sessionId}, closing`);
    sendJSON({ error: '没有进行中的回复，请重新发送消息' });
    sendJSON({ done: true });
    try { ws.close(1000); } catch {}
    return;
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
          (r) => { sendJSON({ reasoning: r }); },
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
      for (const item of q) {
        try { up.send(item.d, { binary: item.b }); } catch {}
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
      upstream.on("message", (data, isBinary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const path = ws.data.targetUrl?.replace(/\?.*$/, "") || "unknown";
        const isJsonPath = path.endsWith("/api/ws") || path.endsWith("/api/events");
        try {
          if (isJsonPath) {
            // 同样转成文本帧，保证浏览器 FJ/VJ 客户端收到的是可 JSON.parse 的文本。
            const payload = Buffer.isBuffer(data) ? data.toString("utf8") : (typeof data === "string" ? data : String(data));
            ws.send(payload, { binary: false });
          } else {
            // 关键：保留上游帧类型（文本帧→文本帧、二进制帧→二进制帧）。
            // 此前一律 ws.send(data)（Buffer）会把服务端文本帧（如 speak-stream 的
            // {"type":"fallback"}）转成二进制帧，前端 JSON.parse 失败、PCM 帧也区分不了。
            // /api/pty 的 Python 端同时接受 text/bytes 不受影响。
            ws.send(data, { binary: isBinary });
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
          ws.data.sendQueue.push({ d: payload, b: false });
        }
        return;
      }
      if (up && up.readyState === WebSocket.OPEN) {
        // 同样保留客户端帧类型：浏览器发送的 {"text":...}/{"stop":true} 是文本帧，
        // speak-stream 服务端用 receive_text() 读取，转成二进制帧会抛错；/api/pty 输入同时兼容。
        try { up.send(data, { binary: isBinary }); } catch {}
      } else if (!ws.data.closing) {
        ws.data.sendQueue = ws.data.sendQueue || [];
        ws.data.sendQueue.push({ d: data, b: isBinary });
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
// v0.22.0 修复（2026-08-05）：守卫改细——只清理「占用本包端口 GATEWAY_PORT/DASHBOARD_PORT」的
// 外来 hermes 进程（经 ss 解析监听端口→pid）。此前按"命令行含 hermes"粗粒度清理，
// 会每 60s 误杀同机并装的 hermes-studio（端口 8743/9220）网关/仪表盘，造成双应用互杀。
function killForeignHermesProcesses() {
  try {
    const out = execSync(`ss -ltnp 2>/dev/null | grep -E ":(\\b${GATEWAY_PORT}\\b|\\b${DASHBOARD_PORT}\\b)\\s"`).toString();
    const pids = new Set();
    for (const line of out.split("\n")) {
      const m = line.match(/pid=(\d+)/g);
      if (m) m.forEach(x => pids.add(Number(x.replace("pid=", ""))));
    }
    for (const pid of pids) {
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
        // 本包进程豁免：命令行含本包 HERMES_BIN / APP_DIR / DATA_DIR 路径。
        // 注意本包 dashboard 以 `python3 -m hermes_cli.main ... dashboard` 启动，
        // 命令行不含 HERMES_BIN，仅凭 "hermes" 关键字 + 非 HERMES_BIN 判定
        // 曾每 60s 误杀自己的 dashboard（v0.21.44 修复）。
        if (cmdline.includes("hermes") && !cmdline.includes(HERMES_BIN) && !cmdline.includes(APP_DIR) && !cmdline.includes(DATA_DIR)) {
          log(`[port-guard] 外来 hermes 进程 pid=${pid} 占用本包端口（${cmdline.slice(0, 90)}），杀除`);
          try { process.kill(pid, "SIGKILL"); } catch {}
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
    try { process.kill(pid, "SIGTERM"); } catch {}
    await waitForExit(pid, 1500);
    if (pidAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
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
    // 预构建前端（hermes-src/hermes_cli/web_dist）随包分发，显式指定后 dashboard
    // 直接 serve 静态产物，避免源码模式下无 npm（0.20.0 只查 managed node tree）
    // 触发 _web_ui_build_needed → "Web UI frontend not built and npm is not available"
    if (existsSync(`${APP_DIR}/hermes-src/hermes_cli/web_dist/index.html`)) {
      env.HERMES_WEB_DIST = `${APP_DIR}/hermes-src/hermes_cli/web_dist`;
    }
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

// ─── Cloudflare Tunnel 管理（隧道/外网访问）────────────────────────────
function _loadTunnelState() {
  try {
    if (existsSync(TUNNEL_STATE_PATH)) return JSON.parse(readFileSync(TUNNEL_STATE_PATH, "utf8"));
  } catch {}
  return { mode: "quick", target: String(UI_PORT), url: "", name: "", started_at: 0, pid: 0 };
}
function _saveTunnelState(s) {
  try { writeFileSync(TUNNEL_STATE_PATH, JSON.stringify(s, null, 2), { mode: 0o600 }); } catch {}
}
function _cloudflaredVersion() {
  try {
    const r = spawnSync(TUNNEL_BIN, ["--version"], { encoding: "utf8", timeout: 8000 });
    if (r.status === 0 && r.stdout) return String(r.stdout).trim().split("\n")[0];
  } catch {}
  return "";
}
// 异步下载（不阻塞事件循环，下载期间 monitor 仍能服务其它请求）
function _downloadCloudflaredAsync(url, dest) {
  return new Promise((resolve) => {
    const p = spawn("curl", ["-fsSL", "--retry", "3", "-o", dest, url]);
    let err = "";
    p.stderr.on("data", d => err += d);
    p.on("close", (code) => resolve(code === 0 ? null : (err.trim() || `curl exit ${code}`)));
    p.on("error", (e) => resolve(e.message));
  });
}
// 确保 cloudflared 二进制存在（缺失时从候选源列表下载 linux-amd64 到持久目录）
async function _ensureCloudflared() {
  const ver = _cloudflaredVersion();
  if (ver) return { ok: true, version: ver };
  try { mkdirSync(TUNNEL_BIN_DIR, { recursive: true }); } catch {}
  const tmp = `${TUNNEL_BIN_DIR}/cloudflared.dl`;
  try { unlinkSync(tmp); } catch {}
  log(`[tunnel] 下载 cloudflared ${TUNNEL_CF_VERSION}（约 50MB，首次需数秒）...`);
  let lastErr = "";
  for (const src of TUNNEL_DL_SOURCES) {
    try { unlinkSync(tmp); } catch {}
    log(`[tunnel] 尝试下载源: ${src}`);
    lastErr = await _downloadCloudflaredAsync(src, tmp);
    if (!lastErr && existsSync(tmp)) break;
  }
  if (lastErr || !existsSync(tmp)) {
    return { ok: false, error: `cloudflared 下载失败: ${String(lastErr || "网络错误").slice(0, 300)}` };
  }
  try { chmodSync(tmp, 0o755); renameSync(tmp, TUNNEL_BIN); } catch (e) { return { ok: false, error: `写入失败: ${e.message}` }; }
  log("[tunnel] cloudflared 下载完成");
  return { ok: true, version: _cloudflaredVersion() || TUNNEL_CF_VERSION };
}
function _tunnelRunning() {
  return !!(_tunnelProc && _tunnelProc.pid && pidAlive(_tunnelProc.pid));
}
// 轮转隧道日志（保证 URL 提取只匹配本次启动）
function _rotateTunnelLog() {
  try {
    if (existsSync(TUNNEL_LOG_PATH)) {
      renameSync(TUNNEL_LOG_PATH, `${TUNNEL_LOG_PATH}.1`);
    }
  } catch (e) { log(`[tunnel] 日志轮转失败: ${e.message}`); }
  try { mkdirSync(`${VAR_DIR}/logs`, { recursive: true }); } catch {}
}
function _extractTunnelUrl() {
  try {
    if (!existsSync(TUNNEL_LOG_PATH)) return "";
    // 取最后一个 trycloudflare URL（日志可能因轮转失败残留历史多次启动的地址，第一个是旧地址）
    const all = [...readFileSync(TUNNEL_LOG_PATH, "utf8").matchAll(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g)];
    return all.length ? all[all.length - 1][0] : "";
  } catch { return ""; }
}
function _tailTunnelLog(maxLines = 80) {
  try {
    if (!existsSync(TUNNEL_LOG_PATH)) return "";
    const lines = readFileSync(TUNNEL_LOG_PATH, "utf8").split("\n").filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}
function _spawnTunnelProc(args) {
  _rotateTunnelLog();
  const logFd = openSync(TUNNEL_LOG_PATH, "a");
  const proc = spawn(TUNNEL_BIN, args, { stdio: ["ignore", logFd, logFd] });
  _tunnelProc = proc;
  proc.on("exit", (code) => {
    if (_tunnelProc === proc) _tunnelProc = null;
    const st = _loadTunnelState();
    if (st.pid === proc.pid) { st.url = ""; st.started_at = 0; st.pid = 0; _saveTunnelState(st); }
    log(`[tunnel] cloudflared 进程退出 code=${code}`);
  });
  return proc;
}
async function _stopTunnel() {
  const proc = _tunnelProc;
  _tunnelProc = null;
  let targetProc = (proc && proc.pid && pidAlive(proc.pid)) ? proc : null;
  if (!targetProc) {
    const st = _loadTunnelState();
    if (st.pid && pidAlive(st.pid)) targetProc = { pid: st.pid };
  }
  if (targetProc) {
    try { process.kill(targetProc.pid, "SIGTERM"); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    if (pidAlive(targetProc.pid)) {
      try { process.kill(targetProc.pid, "SIGKILL"); } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
  }
  const st = _loadTunnelState();
  st.url = ""; st.started_at = 0; st.pid = 0;
  _saveTunnelState(st);
  log("[tunnel] 隧道已停止");
}
async function _startQuickTunnel(target) {
  if (!/^\d+$/.test(String(target))) return { ok: false, error: "目标端口无效" };
  if (!isPortListening(target)) return { ok: false, error: `本机端口 ${target} 未在监听，请先启动服务再开启隧道` };
  const proc = _spawnTunnelProc(["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${target}`]);
  let resolved = false;
  return await new Promise((resolve) => {
    const poll = () => {
      if (resolved) return;
      if (proc.exitCode !== null) {
        resolved = true;
        resolve({ ok: false, error: `cloudflared 提前退出 code=${proc.exitCode}，详见隧道日志` });
        return;
      }
      const url = _extractTunnelUrl();
      if (url) {
        resolved = true;
        const st = _loadTunnelState();
        st.mode = "quick"; st.target = String(target); st.url = url; st.started_at = Date.now(); st.pid = proc.pid; st.name = "";
        _saveTunnelState(st);
        log(`[tunnel] Quick 隧道已就绪: ${url}`);
        resolve({ ok: true, url, pid: proc.pid });
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (!_tunnelRunning()) _stopTunnel();
        resolve({ ok: false, error: "等待 trycloudflare.com 公网地址超时（30s），请检查 NAS 外网连通性后重试" });
      }
    }, 30000);
  });
}
async function _startNamedTunnel(target, token) {
  const t = String(token || "").trim();
  if (!t) return { ok: false, error: "Named 模式需要 Cloudflare Tunnel Token" };
  if (!/^\d+$/.test(String(target)) || !isPortListening(target)) return { ok: false, error: `本机端口 ${target} 未在监听，请先启动服务再开启隧道` };
  const proc = _spawnTunnelProc(["tunnel", "--no-autoupdate", "--protocol", "http2", "run", "--token", t]);
  await new Promise(r => setTimeout(r, 4000));
  if (proc.exitCode !== null) return { ok: false, error: `cloudflared 提前退出 code=${proc.exitCode}（Token 可能无效或未授权），详见隧道日志` };
  const st = _loadTunnelState();
  st.mode = "named"; st.target = String(target); st.url = ""; st.started_at = Date.now(); st.pid = proc.pid; st.name = "";
  _saveTunnelState(st);
  log("[tunnel] Named 隧道已启动");
  return { ok: true, pid: proc.pid };
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
    // 只读日志尾部（最多 64KB），避免 /api/status 每 3 秒轮询时全量读取持续增长的 hermes.log 阻塞事件循环
    const size = statSync(LOG_FILE).size;
    const fd = openSync(LOG_FILE, "r");
    try {
      const readLen = Math.min(size, 65536);
      const buf = Buffer.alloc(readLen);
      readSync(fd, buf, 0, readLen, size - readLen);
      lastLog = buf.toString("utf8").split("\n").filter(l => l.trim()).slice(-20).join("\n");
    } finally { closeSync(fd); }
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
    // 语音端点超时放宽：/api/audio/transcribe 含 STT 推理（本地 Whisper 或远程 round-trip）、
    // /api/audio/speak 含整段 TTS 合成，10s 默认超时必然误杀；统一放宽到 3 分钟，其余保持 10s 快速失败。
    const _audioPath = subPath.startsWith("/api/audio/");
    const init = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(_audioPath ? 180000 : 10000),
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

// ── 启动自愈：config.yaml 若被顶格 "- item" 行写坏（非法 YAML），hermes 解析失败会
//    回退默认配置，导致即使已配置模型也报 "No inference provider configured"。
//    注意：PyYAML 等工具输出的顶格序列（如 "toolsets:\n- hermes-cli"）是合法 YAML，
//    绝不能删除或丢弃缩进内容。这里仅把紧跟顶层键行后的顶格 "- " 行缩进 2 空格，
//    转为等价且更保守的嵌套写法，其余行一律原样保留（数据无损）。 ──
// 注：必须定义在模块顶层（handleFetch 之外），供 server.listen 回调调用。
function _repairConfigYaml(){
  try {
    const p = `${DATA_DIR}/config.yaml`;
    if (!existsSync(p)) return false;
    let yml = readFileSync(p, "utf8");
    const lines = yml.split("\n");
    const out = [];
    let fixed = 0;
    for (let k = 0; k < lines.length; k++){
      const line = lines[k];
      if (/^[a-zA-Z_][a-zA-Z0-9_-]*:$/.test(line)){
        out.push(line);
        // 只处理紧随顶层键后的顶格 "- item" 行：缩进修复，不删除、不跳过任何内容
        let j = k + 1;
        while (j < lines.length && /^-\s/.test(lines[j])) {
          out.push("  " + lines[j]);
          fixed++; j++;
        }
        k = j - 1;
        continue;
      }
      out.push(line);
    }
    if (fixed > 0){
      try { writeFileSync(p + ".pre-repair.bak", yml, { mode: 0o644 }); } catch (e) {}
      writeFileSync(p, out.join("\n"), { mode: 0o644 });
      log(`[config-repair] config.yaml 已修复：${fixed} 行顶格列表项已缩进（原文件备份 .pre-repair.bak）`);
      return true;
    }
  } catch (e) { log("[config-repair] error: " + e.message); }
  return false;
}

// ─── 启动防御：providers-state.yaml 缺失时从 config.yaml 自动重建 ────────
// 场景：install_init 误判全新安装 / 用户手动删除 / 文件损坏
// config.yaml 是真实来源（provider 配置持久化在这里），重建时 base_url 默认空、
// name 默认 id，用户可在控制面板「编辑」补全；但 API Key 保留在 .env.providers，
// 因此重建后网关仍可正常工作。
function _restoreProvidersState(){
  try {
    const statePath = `${VAR_DIR}/providers-state.yaml`;
    if (existsSync(statePath)) return; // 正常情况：文件存在，无需重建
    const yamlPath = `${DATA_DIR}/config.yaml`;
    if (!existsSync(yamlPath)) return; // 全新安装无配置，不重建
    const yml = readFileSync(yamlPath, "utf8");
    if (!/^providers:/m.test(yml)) return; // config.yaml 无 providers 段
    // 提取 providers 块（到下一个顶层键或文件结尾）
    const blockMatch = yml.match(/^providers:\n([\s\S]*?)(?=\n[a-zA-Z_][a-zA-Z0-9_-]*:|$)/m);
    if (!blockMatch) return;
    const lines = blockMatch[1].split("\n");
    const out = ["providers:"];
    let hasReal = false;
    for (let i = 0; i < lines.length; i++){
      const km = lines[i].match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (km) {
        out.push(`  ${km[1]}:`);
        out.push(`    model: auto`);
        out.push(`    base_url: ""`);
        out.push(`    name: "${km[1]}"`);
        if (km[1] !== "hermes") hasReal = true;
      }
    }
    if (!hasReal) return; // 无真实 provider，不重建
    writeFileSync(statePath, out.join("\n") + "\n", { mode: 0o644 });
    log(`[providers-restore] providers-state.yaml 缺失，已从 config.yaml 重建（${out.length - 1} 个 provider）`);
  } catch (e) { log("[providers-restore] error: " + e.message); }
}

/* ═══ 安全网关 v1（tool_guard）：拦截危险操作 / 标记敏感信息 ═══
 * 拦截点：用户消息入队（/api/chat/ws-send）与 SSE 流式入口（/api/chat/stream）。
 * 设计原则：保守拦截——只拦"破坏性命令且目标明确指向系统级路径/设备"的组合，
 * 避免误伤正常讨论（如"rm -rf 的用法是什么"这类纯知识提问）。
 * PII（身份证/手机号）仅记录警告不阻断：允许用户起草含证件的文档，AI 也不会
 * 因一句"分析这段文本"就被拦死。开关经 GET/PUT /api/studio/security 查看/切换，
 * 持久化到 data/studio/security.json（默认开启）。
 * 融合来源：Octop tool_guard（allow/deny 规则 + 敏感挂载点拒绝）× shellward
 * L3 Tool Blocker / L4 Input Auditor（中文注入规则 + 危险命令清单）。 */
const TOOL_GUARD_BLOCK_RULES = [
  { re: /\brm\s+-\S*[rf]\S*\s+(\/|\/\*|~)\s*(;|&|\||$)/i, hint: "rm -rf 递归删除根目录/主目录" },
  { re: /\brm\s+-\S*[rf]\S*\s+\/(etc|boot|usr|var|bin|sbin|root|lib|lib64)\b/i, hint: "rm -rf 递归删除系统目录" },
  { re: /\bdd\s+if=[^\s]+\s+of=\/dev\/(sd|hd|vd|nvme)/i, hint: "dd 直写磁盘设备" },
  { re: /\bmkfs\.[a-z0-9]+\s+\/dev\//i, hint: "mkfs 格式化磁盘" },
  { re: /\b(reboot|poweroff|halt|shutdown\s+-[a-z]*[rh])/i, hint: "关机/重启系统" },
  { re: /:\(\)\s*\{\s*:\s*\|/i, hint: "fork bomb 分叉炸弹" },
  { re: /(curl|wget)\s+[^\s|&]+\s*\|\s*(sudo\s+)?(sh|bash)\b/i, hint: "下载并直接执行脚本 (curl|sh)" },
  { re: /\bchmod\s+-R\s+777\s+\//i, hint: "chmod -R 777 根目录" },
  { re: /\bchown\s+-R\s+(root|0:0)\s+\//i, hint: "chown -R root 根目录" },
  { re: />\s*\/dev\/(sd|hd|vd|nvme)[a-z]?\d?/i, hint: "向磁盘设备写入数据" },
  { re: /\bkill\s+-9\s+[10]\b/i, hint: "kill -9 系统进程 (pid 0/1)" },
  { re: /\b(iptables\s+-F|ufw\s+disable)\b/i, hint: "清空防火墙规则/关闭防火墙" },
  { re: /\bcryptsetup\s+luksFormat/i, hint: "加密格式化磁盘 (LUKS)" },
];
const TOOL_GUARD_WARN_RULES = [
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, hint: "手机号", kind: "PII" },
  { re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, hint: "身份证号", kind: "PII" },
];
let _toolGuardEnabled = true; // 默认开启；持久化 data/studio/security.json
const TOOL_GUARD_CFG_FILE = `${DATA_DIR}/studio/security.json`;
function toolGuardLoad() {
  try {
    if (existsSync(TOOL_GUARD_CFG_FILE)) {
      const j = JSON.parse(readFileSync(TOOL_GUARD_CFG_FILE, "utf8") || "{}");
      _toolGuardEnabled = j.enabled !== false;
    }
  } catch (e) { log("[tool-guard] config load failed: " + e.message); }
}
function toolGuardSave() {
  try {
    mkdirSync(dirname(TOOL_GUARD_CFG_FILE), { recursive: true });
    writeFileSync(TOOL_GUARD_CFG_FILE, JSON.stringify({ enabled: _toolGuardEnabled }, null, 2), { mode: 0o644 });
  } catch (e) { log("[tool-guard] config save failed: " + e.message); }
}
function toolGuardTextOf(msg) {
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.map(p => (p && typeof p === "object" ? String(p.text || "") : "")).join(" ");
  if (msg && typeof msg === "object") return String(msg.text || "");
  return "";
}
function toolGuardScan(msg) {
  const text = toolGuardTextOf(msg);
  const out = { blocked: false, warnings: [] };
  if (!text) return out;
  for (const r of TOOL_GUARD_BLOCK_RULES) {
    if (r.re.test(text)) { out.blocked = true; out.hint = r.hint; return out; }
  }
  for (const r of TOOL_GUARD_WARN_RULES) {
    const m = text.match(r.re);
    if (m && m.length) out.warnings.push({ hint: r.hint, kind: r.kind, count: m.length });
  }
  return out;
}
function toolGuardCheckAndRespond(msg) {
  if (!_toolGuardEnabled) return null;
  const scan = toolGuardScan(msg);
  if (!scan.blocked) return null;
  log(`[tool-guard] 拦截危险操作：${scan.hint}`);
  return new Response(JSON.stringify({
    blocked: true,
    error: `⚠ 安全网关已拦截：检测到危险操作「${scan.hint}」。为防止 AI 误执行破坏性命令，这条消息未发送。如确属必要，请到「语音设置→安全网关」或 /api/studio/security 关闭后重试。`,
  }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
toolGuardLoad();

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
  const writePaths = ["/api/start", "/api/stop", "/api/restart", "/api/dashboard/start", "/api/dashboard/stop", "/api/config", "/api/config/test", "/api/hermes/update", "/api/logs/clear", "/api/tunnel/start", "/api/tunnel/stop", "/api/voice/config", "/api/kb/write", "/api/kb/new"];
  const isWrite = ["POST", "PUT", "DELETE"].includes(req.method);
  const pathIsWrite = writePaths.includes(path) || /^\/api\/channels\/[^/]+\/toggle$/.test(path);
  if (isWrite && pathIsWrite && !checkToken(req)) {
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

      // v0.20.0 起官方停止 PyPI 分发（wheel/sdist 被构建守卫拦截），PyPI 上永远显示旧版
      // 0.19.0。源码模式（本包内置 hermes-src）下不再查询 PyPI，latest 直接展示当前版本。
      const sourceMode = compareVersions(currentVer, "0.20.0") >= 0;

      // 优先 PyPI JSON API（可获取发布日期）
      if (!sourceMode) {
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
      } else {
        latest = currentVer;
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
      // v0.20.0+ 源码模式：hermes 不再从 PyPI 分发，更新 = 重新执行内置源码 editable 安装
      // （无源码时退回旧版 PyPI 升级，用于旧包/热补丁场景）
      const srcMode = existsSync(`${APP_DIR}/hermes-src/pyproject.toml`);
      const installArgs = srcMode
        ? ["pip", "install", "--python", `${DATA_DIR}/venv/bin/python3`, "--no-cache", "-e", `${APP_DIR}/hermes-src[all]`]
        : ["pip", "install", "--python", `${DATA_DIR}/venv/bin/python3`, "--upgrade", "--no-cache", "hermes-agent[all]"];
      const proc = spawn(UV_BIN_PATH, installArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
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

  // 获取「最新发布」的 release：按 published_at 排序而非 created_at。
  // （releases?per_page=1 按 created_at 倒序，重建过的旧 release 会排在前面，导致热更拉到旧版本）
  async function fetchLatestPublishedRelease(headers) {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
      signal: AbortSignal.timeout(15000), headers,
    });
    if (!r.ok) return { data: null, status: r.status };
    const list = await r.json();
    const published = (Array.isArray(list) ? list : []).filter(x => !x.draft && x.published_at);
    if (!published.length) return { data: null, status: r.status };
    published.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    return { data: published[0], status: r.status };
  }

  if (path === "/api/app/update/check") {
    try {
      const pat = getGitHubPAT();
      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "fnos-hermes-agent" };
      if (pat) headers["Authorization"] = `Bearer ${pat}`;

      // 优先按 published_at 取最新已发布 release（避免 created_at 排序导致拉到重建的旧 release）
      let { data, status: firstStatus } = await fetchLatestPublishedRelease(headers);
      let rateLimited = false;
      if (!data && (firstStatus === 401 || firstStatus === 403)) {
        // 401/403 = PAT 无效或 GitHub API 限流（无 PAT 时 60次/小时）
        rateLimited = true;
      }
      // 兜底：未认证或没有 release 时尝试 /releases/latest
      if (!data && !rateLimited) {
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
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

      // 1. 获取最新已发布 release（按 published_at，避免拉到重建的旧 release）
      const hpRes = await fetchLatestPublishedRelease(ghHeaders);
      const relData = hpRes.data;
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

  // ─── 隧道（Cloudflare Tunnel 外网访问）API ───
  if (path === "/api/tunnel/status" && req.method === "GET") {
    try {
      const st = _loadTunnelState();
      let running = _tunnelRunning();
      if (!running && st.pid) running = pidAlive(st.pid);
      if (running) {
        const u = _extractTunnelUrl();
        if (u && u !== st.url) { st.url = u; _saveTunnelState(st); }
      }
      return new Response(JSON.stringify({
        ok: true, running,
        mode: st.mode || "quick", target: st.target || String(UI_PORT),
        url: st.url || "", name: st.name || "",
        pid: st.pid || (_tunnelProc ? _tunnelProc.pid : 0), started_at: st.started_at || 0,
        cloudflared: _cloudflaredVersion() || "",
        log_tail: _tailTunnelLog(80),
        ui_port: UI_PORT,
      }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/tunnel/start" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const mode = body.mode === "named" ? "named" : "quick";
      const target = String(body.target || UI_PORT).trim();
      const prevSt = _loadTunnelState();
      if (_tunnelRunning() || (prevSt.pid && pidAlive(prevSt.pid))) await _stopTunnel();
      const ensure = await _ensureCloudflared();
      if (!ensure.ok) return new Response(JSON.stringify({ ok: false, error: ensure.error }), { status: 500, headers: jsonHeaders() });
      const r = mode === "named"
        ? await _startNamedTunnel(target, body.token)
        : await _startQuickTunnel(target);
      if (!r.ok) return new Response(JSON.stringify({ ok: false, error: r.error }), { status: 500, headers: jsonHeaders() });
      return new Response(JSON.stringify({ ok: true, mode, ...r }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/tunnel/stop" && req.method === "POST") {
    try {
      await _stopTunnel();
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
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

  // ── 辅助：从 config.yaml 提取模型名（支持三种格式，避免 \s 跨行吞嵌套键名）──
  // 1) hermes config set model.model 写入: "model:\n  model: deepseek-v4-flash"
  // 2) hermes 0.20 主配置: "model:\n  provider: xxx\n  default: sensenova-6.7-flash-lite"
  // 3) 旧版单行: "model: deepseek-v4-flash"
  function _extractConfigModel(cfg) {
    const block = cfg.match(/^model:[ \t]*\n((?:[ \t]+[^\n]*\n?)+)/m);
    if (block) {
      const inner = block[1];
      const dm = inner.match(/^[ \t]+default:[ \t]*(\S.*)$/m);
      if (dm) return dm[1].trim();
      const nm = inner.match(/^[ \t]+model:[ \t]*(\S.*)$/m);
      if (nm) return nm[1].trim();
    }
    const single = cfg.match(/^model:[ \t]*(\S.*)$/m);
    if (single) return single[1].trim();
    return "";
  }

  // ── 辅助：读取某个 profile 目录的详细信息 ──
  function _readProfileInfo(dir, id) {
    let soul = ""; try { soul = readFileSync(`${dir}/SOUL.md`, "utf8"); } catch {}
    let model = "";
    let provider = "";
    try {
      const cfg = readFileSync(`${dir}/config.yaml`, "utf8");
      model = _extractConfigModel(cfg);
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
      scene: meta.scene || "通用",
      quick_prompts: Array.isArray(meta.quick_prompts) ? meta.quick_prompts : [],
      is_default: false,
    };
  }

  function _listProfiles() {
    const profiles = [];
    // 默认 profile（主目录 DATA_DIR 本身 = ~/.hermes）
    let defaultSoul = ""; try { defaultSoul = readFileSync(`${DATA_DIR}/SOUL.md`, "utf8"); } catch {}
    const mainCfg = _readHermesConfig();
    const mainModel = _extractConfigModel(mainCfg) || (mainCfg.match(/^\s*default:\s*(.+)$/m) || [])[1] || "";
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
      scene: "通用",
      quick_prompts: [],
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
  // 注意：CLI 每次 spawn 拉起 venv Python（页面加载 /api/profiles 的瓶颈），
  // 因此结果做内存缓存（_activeProfileCache 声明在模块级）；_setActiveProfile 时同步更新，避免陈旧。
  function _getActiveProfile() {
    if (_activeProfileCache) return _activeProfileCache;
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
            if (name) { _activeProfileCache = name; return name; }
          }
          // 兼容其他可能的标记格式: "* coder" 或 "→ coder" 或 "(active)"
          if (/^[\*→>]\s+/.test(trimmed) || /\(active\)|\(current\)/.test(trimmed)) {
            const name = trimmed.replace(/^[\*→>]\s+/, "").replace(/\s*\(active\)|\s*\(current\)/, "").trim().split(/\s+/)[0];
            if (name && name !== "Profile") { _activeProfileCache = name; return name; }
          }
        }
        // 有输出但没找到标记，默认 default
        _activeProfileCache = "default";
        return "default";
      }
    } catch {}
    // 方式2：兜底读取本地记录文件
    try { _activeProfileCache = readFileSync(`${DATA_DIR}/.active_profile`, "utf8").trim(); return _activeProfileCache; } catch { return "default"; }
  }

  // ── 确保 profile 具备模型配置：目标 config.yaml 缺失/无有效 model 块时，
  // 从「当前活跃 profile → default」继承 model/providers 块与 .env 密钥。
  // 背景：从专家模板创建的空 profile（hermes profile create 不带 clone）没有 config.yaml，
  // 网关激活后报 "No inference provider configured"，聊天空回复显示误导性的
  // 「(Gateway 连接失败)」（v0.21.44 修复）。在 _setActiveProfile 入口调用，覆盖所有激活路径。
  function _ensureProfileModel(id) {
    try {
      const dir = id === "default" ? DATA_DIR : `${PROFILES_DIR}/${id}`;
      const cfgPath = `${dir}/config.yaml`;
      let cfg = ""; try { cfg = readFileSync(cfgPath, "utf8"); } catch {}
      if (_extractConfigModel(cfg)) return { ok: true, inherited: false };
      // 候选源：当前活跃 profile（排除自身）→ default
      const candidates = [];
      try {
        const active = _getActiveProfile();
        if (active && active !== id) candidates.push(active);
      } catch {}
      if (!candidates.includes("default")) candidates.push("default");
      let srcCfg = "", srcDir = "";
      for (const c of candidates) {
        const d = c === "default" ? DATA_DIR : `${PROFILES_DIR}/${c}`;
        try { srcCfg = readFileSync(`${d}/config.yaml`, "utf8"); } catch { continue; }
        if (_extractConfigModel(srcCfg)) { srcDir = d; break; }
        srcCfg = "";
      }
      if (!srcCfg) {
        log(`[profiles] ${id} 缺少模型配置且无可用源 profile，跳过继承`);
        return { ok: false, error: "no source model config" };
      }
      const modelBlock = (srcCfg.match(/^model:[ \t]*\n(?:[ \t]+[^\n]*\n?)+/m) || [""])[0];
      const providersBlock = (srcCfg.match(/^providers:[ \t]*\n(?:[ \t]+[^\n]*\n?)+/m) || [""])[0];
      let out = cfg;
      // 替换或追加 model 块（兼容空 model: / model: null 骨架）
      if (/^model:[ \t]*\n/m.test(out)) {
        out = out.replace(/^model:[ \t]*\n(?:[ \t]+[^\n]*\n?)*/m, modelBlock);
      } else if (/^model:[ \t]*\S[^\n]*$/m.test(out)) {
        out = out.replace(/^model:[ \t]*\S[^\n]*$/m, modelBlock.replace(/\n$/, ""));
      } else {
        if (out && !out.endsWith("\n")) out += "\n";
        out += modelBlock + "\n";
      }
      if (providersBlock) {
        if (/^providers:[ \t]*\n/m.test(out)) {
          out = out.replace(/^providers:[ \t]*\n(?:[ \t]+[^\n]*\n?)*/m, providersBlock);
        } else if (/^providers:[ \t]*\S[^\n]*$/m.test(out)) {
          out = out.replace(/^providers:[ \t]*\S[^\n]*$/m, providersBlock.replace(/\n$/, ""));
        } else {
          if (!out.endsWith("\n")) out += "\n";
          out += providersBlock + "\n";
        }
      }
      if (!out.endsWith("\n")) out += "\n";
      writeFileSync(cfgPath, out);
      // 合并 .env：源中目标缺失的密钥补入（如 CUSTOM_*_API_KEY）
      try {
        const srcEnv = readFileSync(`${srcDir}/.env`, "utf8");
        let dstEnv = ""; try { dstEnv = readFileSync(`${dir}/.env`, "utf8"); } catch {}
        const have = new Set(dstEnv.split("\n").map(l => { const i = l.indexOf("="); return i > 0 ? l.slice(0, i).trim() : ""; }).filter(Boolean));
        const add = [];
        srcEnv.split("\n").forEach(l => {
          const i = l.indexOf("=");
          if (i <= 0) return;
          const k = l.slice(0, i).trim();
          if (k && !have.has(k)) add.push(l);
        });
        if (add.length) {
          dstEnv = dstEnv.replace(/\s*$/, "") + (dstEnv.trim() ? "\n" : "") + add.join("\n") + "\n";
          writeFileSync(`${dir}/.env`, dstEnv);
        }
      } catch {}
      log(`[profiles] ${id} 已继承模型配置（源=${srcDir}）`);
      return { ok: true, inherited: true };
    } catch (e) {
      log(`[profiles] ${id} 继承模型配置异常: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  function _setActiveProfile(id) {
    // 激活前确保 profile 具备模型配置（空 profile 继承当前活跃/default 的 model/providers/密钥）
    try { _ensureProfileModel(id); } catch {}
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
    _activeProfileCache = id || "default";  // 同步内存缓存，避免陈旧
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
    if (body.scene) meta.scene = String(body.scene).trim();
    if (Array.isArray(body.quick_prompts) && body.quick_prompts.length) {
      meta.quick_prompts = body.quick_prompts.filter(s => typeof s === "string" && s.trim()).slice(0, 12);
    }
    writeFileSync(`${dir}/metadata.json`, JSON.stringify(meta, null, 2));
    return { ok: true, id };
  }

  // 将技能 id 列表写入 profile 的 config.yaml skills 块（替换旧块或追加；default 写主配置）
  function _writeProfileSkills(id, skills) {
    const cfgPath = id === "default" ? `${DATA_DIR}/config.yaml` : `${PROFILES_DIR}/${id}/config.yaml`;
    if (!existsSync(cfgPath)) return;
    let cfg = ""; try { cfg = readFileSync(cfgPath, "utf8"); } catch { return; }
    const list = Array.isArray(skills) ? skills.filter(s => typeof s === "string" && s.trim()) : [];
    if (!list.length) return; // 空数组 = 不动（避免误清）
    const skillsYaml = list.map(s => "  - " + s.trim()).join("\n") + "\n";
    if (/^skills:[ \t]*\n/m.test(cfg)) cfg = cfg.replace(/^skills:[ \t]*\n(?:[ \t].*\n?)*/m, "skills:\n" + skillsYaml);
    else cfg = cfg.replace(/\n*$/, "\n") + "skills:\n" + skillsYaml;
    writeFileSync(cfgPath, cfg);
    log(`[profiles] ${id} skills 已更新: ${list.join(", ")}`);
  }

  // 模型名 → hermes 内置 provider id（仅收录 auth.py ProviderConfig 确认存在的 id；无匹配返回 null 保留现有 provider）。
  // 注：模型名含 ":" 或 "/"（如 ollama 的 deepseek-v4-flash:0731）视为自定义模型，不联动内置 provider。
  function _modelProviderId(model) {
    const m = String(model || "").toLowerCase();
    if (m.includes(":") || m.includes("/")) return null;
    const rules = [
      [/^deepseek/, "deepseek"], [/^qwen/, "alibaba"], [/^kimi/, "kimi-coding"],
      [/^minimax/, "minimax"], [/^claude/, "anthropic"], [/^gemini/, "gemini"],
      [/^grok/, "xai"],
    ];
    for (const [re, id] of rules) if (re.test(m)) return id;
    return null;
  }

  // 在 config.yaml 的 providers: 段内查找 default_model 与目标模型精确匹配的 provider id
  //（覆盖 ollama/custom 等用户自建 provider，如 249 的 custom_umsalmjwyizjv），无匹配返回 null。
  function _providerForModel(yml, model) {
    if (!yml || !model) return null;
    const lines = yml.split("\n");
    let inProv = false, curId = null;
    for (const l of lines) {
      if (/^providers:[ \t]*$/.test(l)) { inProv = true; continue; }
      if (inProv) {
        if (/^[a-zA-Z_]/.test(l)) break; // providers 段结束（下一顶层键）
        const m = l.match(/^  ([a-zA-Z_][\w-]*):/);
        if (m) { curId = m[1]; continue; }
        if (curId) {
          const dm = l.match(/default_model:[ \t]*(\S+)/);
          if (dm && dm[1] === model) return curId;
        }
      }
    }
    return null;
  }

  // 块级文本编辑 config.yaml 的 model 块：替换/新增 default 与 provider 行，
  // 清除 0.19 遗留的嵌套 "model: xxx" 键（hermes 0.20 不识别该格式），无 model 块时追加。
  // 不调 hermes config set：0.20 的 config set 会写 0.19 旧格式或产生空键骨架。
  function _setModelInConfig(yml, model, providerId) {
    const lines = yml.split("\n");
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (/^model:[ \t]*$/.test(lines[i])) { idx = i; break; } }
    if (idx < 0) {
      const add = "model:\n" + (providerId ? `  provider: ${providerId}\n` : "") + `  default: ${model}\n`;
      return (yml ? yml.replace(/\n?$/, "\n") : "") + add;
    }
    let end = idx + 1;
    while (end < lines.length && /^[ \t]/.test(lines[end])) end++;
    const out = [lines[idx]];
    let hasDefault = false, hasProvider = false;
    for (let i = idx + 1; i < end; i++) {
      const l = lines[i];
      if (/^[ \t]+default:/.test(l)) { out.push(l.replace(/^([ \t]+default:).*$/, `$1 ${model}`)); hasDefault = true; }
      else if (providerId && /^[ \t]+provider:/.test(l)) { out.push(l.replace(/^([ \t]+provider:).*$/, `$1 ${providerId}`)); hasProvider = true; }
      else if (/^[ \t]+model:/.test(l)) { /* 0.19 遗留嵌套 model 键：清除 */ }
      else out.push(l);
    }
    if (providerId && !hasProvider) out.push(`  provider: ${providerId}`);
    if (!hasDefault) out.push(`  default: ${model}`);
    return lines.slice(0, idx).concat(out, lines.slice(end)).join("\n");
  }

  function _updateProfile(id, body) {
    if (id === "default") {
      // 默认 profile：更新主目录下的 SOUL.md / config.yaml
      if (body.prompt != null) writeFileSync(`${DATA_DIR}/SOUL.md`, body.prompt);
      if (body.skills != null && Array.isArray(body.skills)) _writeProfileSkills("default", body.skills);
      if (body.model) {
        // 纯文本块级编辑 model 块（hermes config set 在 0.20 会写 0.19 旧嵌套键 model.model
        // 或产生空键骨架，弃用）；provider 推断：providers 段 default_model 匹配优先，其次内置前缀
        try {
          let yml = readFileSync(HERMES_CONFIG, "utf8");
          const pid = _providerForModel(yml, body.model) || _modelProviderId(body.model);
          yml = _setModelInConfig(yml, body.model, pid);
          writeFileSync(HERMES_CONFIG, yml, { mode: 0o644 });
        } catch (e) { log(`[profiles] 更新主配置模型失败: ${e.message}`); }
      }
      return { ok: true };
    }
    const dir = `${PROFILES_DIR}/${id}`;
    if (!existsSync(dir)) return { ok: false, error: "profile not found" };
    // 更新 SOUL.md（个性/指令）
    if (body.prompt != null) writeFileSync(`${dir}/SOUL.md`, body.prompt);
    // 更新模型配置（纯文本块级编辑，见 _setModelInConfig 注释）
    if (body.model) {
      try {
        let yml = readFileSync(`${dir}/config.yaml`, "utf8");
        const pid = _providerForModel(yml, body.model) || _modelProviderId(body.model);
        yml = _setModelInConfig(yml, body.model, pid);
        writeFileSync(`${dir}/config.yaml`, yml);
      } catch (e) { log(`[profiles] 更新 ${id} 模型失败: ${e.message}`); }
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
    // 更新 skills（写入 config.yaml 的 skills 块；[] = 清空独立技能回到预置）
    if (body.skills != null && Array.isArray(body.skills)) {
      _writeProfileSkills(id, body.skills);
    }
    // 更新 UI 元数据
    let meta = {}; try { meta = JSON.parse(readFileSync(`${dir}/metadata.json`, "utf8")); } catch {}
    if (body.name != null) meta.name = body.name;
    if (body.emoji != null) meta.emoji = body.emoji;
    if (body.scene != null) meta.scene = String(body.scene).trim() || "通用";
    if (body.quick_prompts != null) {
      meta.quick_prompts = Array.isArray(body.quick_prompts)
        ? body.quick_prompts.filter(s => typeof s === "string" && s.trim()).slice(0, 12)
        : [];
    }
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
      if (r.ok && Array.isArray(body.skills) && body.skills.length) {
        try { _writeProfileSkills(id, body.skills); } catch (e) { log(`[profiles] 写入 ${id} skills 失败: ${e.message}`); }
      }
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
          // 过滤历史脏键（如模型名 "sensenova-6.7-flash-lite"、非法字符），避免假键混入面板
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
          // 脱敏：只显示前4位 + ***
          envObj[key] = val.length > 8 ? val.slice(0, 4) + "****" : (val ? "****" : "");
        });
      } catch {}
      return new Response(JSON.stringify({ ok: true, env: envObj }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // PUT /api/profiles/:id/env → 更新 profile 的 .env（API 密钥等），保存后重启网关生效
  // body: { env: { KEY: value } }，value 为空字符串则删除该键；不存在的键不处理
  if (profileEnvMatch && req.method === "PUT") {
    try {
      const id = profileEnvMatch[1];
      const body = await req.json().catch(() => ({}));
      const updates = body.env && typeof body.env === "object" ? body.env : {};
      // 键名 sanitize：仅接受标准环境变量名（拒绝模型名/含特殊字符的历史脏键），同时删除 .env 中已有的非法键
      const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
      const cleanUpdates = {};
      Object.keys(updates).forEach(k => { if (KEY_RE.test(k)) cleanUpdates[k] = updates[k]; });
      const keys = Object.keys(cleanUpdates);
      if (!keys.length) return new Response(JSON.stringify({ ok: false, error: "env 为空或包含非法键名" }), { status: 400, headers: jsonHeaders() });
      const envPath = id === "default" ? `${DATA_DIR}/.env` : `${PROFILES_DIR}/${id}/.env`;
      let lines = [];
      try {
        const content = readFileSync(envPath, "utf8");
        lines = content.split("\n");
      } catch {}
      const seen = new Set();
      let existed = false;
      const out = lines.map(line => {
        const s = line.trim();
        if (!s || s.startsWith("#") || s.indexOf("=") < 0) return line;
        const key = s.slice(0, s.indexOf("=")).trim();
        if (!KEY_RE.test(key)) return null; // 历史脏键 → 本次保存时清洗删除
        if (seen.has(key)) return line; // 重复键：保留首条，后续由追加逻辑处理
        seen.add(key);
        if (!(key in cleanUpdates)) return line;
        existed = true;
        const val = String(cleanUpdates[key] || "").trim();
        return val ? `${key}=${val}` : null; // 空值 → 删除该行
      }).filter(l => l !== null);
      keys.forEach(key => {
        if (seen.has(key)) return;
        const val = String(cleanUpdates[key] || "").trim();
        if (val) out.push(`${key}=${val}`);
      });
      mkdirSync(dirname(envPath), { recursive: true });
      writeFileSync(envPath, out.join("\n").replace(/\n+$/, "") + "\n");
      // 密钥变更需重启网关才生效（网关只在启动时读 .env）
      _triggerGatewayRestart("profile-env-" + id);
      return new Response(JSON.stringify({ ok: true, updated: keys, restarting: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 专家：内置清单与创建 ──────────────────────────────────────────────
  // GET /api/experts?scope=builtin|market → 内置专家清单（2026-08-05 起市场已并入内置，两值同返回合并清单）
  if (path === "/api/experts" && req.method === "GET") {
    try {
      const url = new URL(req.url, "http://localhost");
      const scope = (url.searchParams.get("scope") || "builtin").trim();
      const list = BUILTIN_EXPERTS_ALL;
      return new Response(JSON.stringify({ ok: true, scope, experts: list }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/experts/create → 内置专家模板 → profile 创建（含 skills 写入）并激活
  // body: { slug }
  if (path === "/api/experts/create" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const slug = String(body.slug || "").trim();
      const exp = BUILTIN_EXPERTS_ALL.find(e => e.slug === slug || e.id === slug);
      if (!exp) return new Response(JSON.stringify({ ok: false, error: "未找到专家模板: " + slug }), { status: 404, headers: jsonHeaders() });
      const id = (exp.slug || exp.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      let r = _createProfile(id, { name: exp.name, emoji: exp.emoji, prompt: exp.prompt, scene: exp.scene, quick_prompts: exp.quick_prompts });
      if (!r.ok) {
        // 已存在 → 直接激活（不改写已有配置）
        if (String(r.error).includes("已存在")) {
          _setActiveProfile(id);
          _triggerGatewayRestart("expert-activate-" + id);
          return new Response(JSON.stringify({ ok: true, profile: { id, name: exp.name }, activated: true }), { headers: jsonHeaders() });
        }
        return new Response(JSON.stringify(r), { status: 400, headers: jsonHeaders() });
      }
      // 写入 profile 的 skills 块（hermes 技能 id 列表；替换旧块或追加）
      if (Array.isArray(exp.skills) && exp.skills.length) {
        const cfgPath = `${PROFILES_DIR}/${id}/config.yaml`;
        let cfg = ""; try { cfg = readFileSync(cfgPath, "utf8"); } catch {}
        const skillsYaml = exp.skills.map(s => "  - " + s).join("\n") + "\n";
        if (/^skills:[ \t]*\n/m.test(cfg)) cfg = cfg.replace(/^skills:[ \t]*\n(?:[ \t].*\n?)*/m, "skills:\n" + skillsYaml);
        else cfg = cfg.replace(/\n*$/, "\n") + "skills:\n" + skillsYaml;
        writeFileSync(cfgPath, cfg);
        log(`[experts] ${id} skills 已写入: ${exp.skills.join(", ")}`);
      }
      _setActiveProfile(id);
      _triggerGatewayRestart("expert-create-" + id);
      return new Response(JSON.stringify({ ok: true, profile: { id, name: exp.name } }), { headers: jsonHeaders() });
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
  // 通过 _setTopLevelBlock 写入：兼容 inline 与 block 形态，并清除重复顶层键；
  // 条目自动去重（防重复累积：残留顶格项 + 新项导致 toolsets 越写越长）
  function _setYamlListBlock(content, key, items){
    const uniq = [];
    const seen = new Set();
    (items || []).forEach(it => { const s = String(it).trim(); if (s && !seen.has(s)) { seen.add(s); uniq.push(s); } });
    const block = `${key}:\n` + uniq.map(it => `  - ${_yamlScalarSafe(it)}`).join("\n");
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
        // 跳过该顶层块的整段（block: 后续缩进行 + 顶格列表残留项；inline: 仅本行）
        if (line === key + ":") {
          let j = k + 1;
          // 缩进行是块的正常内容；顶格 "- item" 是历史残留的非法行（hermes 解析失败会
          // 回退默认配置导致 "No inference provider configured"），一并跳过清除
          while (j < lines.length && (lines[j].startsWith(" ") || lines[j].startsWith("\t") || /^-\s/.test(lines[j]))) j++;
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
    if (!m) return "";
    let v = m[1].trim();
    // 去除引号包裹
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else {
      // 未加引号的值：去除内联 # 注释（# 前有空格才算注释）
      const ci = v.indexOf(" #");
      if (ci >= 0) v = v.slice(0, ci).trim();
    }
    return v;
  }
  function _setEnvValue(content, key, value){
    const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = key + "=" + (value ?? "");
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
  // 读取 config.yaml 中 platforms.<id> 下的嵌套键值（支持任意缩进深度）
  function _readPlatformConfig(id){
    const yml = _readHermesConfig();
    const lines = yml.split("\n");
    // 1. 找到 platforms: 段
    let platHeader = -1;
    for (let i = 0; i < lines.length; i++) { if (/^platforms:\s*$/.test(lines[i])) { platHeader = i; break; } }
    if (platHeader < 0) return {};
    // 2. 在 platforms 下找到目标 id 块
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockRe = new RegExp("^  " + escaped + ":\\s*(.*)$");
    let blockStart = -1, inlineVal = "";
    for (let i = platHeader + 1; i < lines.length; i++) {
      if (/^[a-zA-Z_]/.test(lines[i])) break; // 顶层键 → platforms 段结束
      const m = lines[i].match(blockRe);
      if (m) { blockStart = i; inlineVal = m[1].trim(); break; }
    }
    if (blockStart < 0) return {};
    if (inlineVal && inlineVal !== "{}") return _yamlUnquote(inlineVal); // 内联值
    // 3. 收集该块所有子行（缩进 >= 4 空格），遇到下一个 2 空格平台键或顶层键则停止
    const childLines = [];
    for (let i = blockStart + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === "") continue; // 跳过空行
      if (/^[a-zA-Z_]/.test(l)) break; // 顶层键
      if (/^  [a-zA-Z_]/.test(l)) break; // 下一个平台键
      if (/^    /.test(l)) childLines.push(l); // 4+ 空格缩进 → 属于此块
    }
    if (childLines.length === 0) return {};
    // 4. 按缩进层级递归解析为嵌套对象
    return _parseIndentBlock(childLines, 4);
  }
  // 解析一组按缩进排列的 YAML 行为嵌套对象（支持任意深度）
  function _parseIndentBlock(lines, baseIndent){
    const obj = {};
    const pad = " ".repeat(baseIndent);
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.startsWith(pad)) { i++; continue; } // 缩进不足，跳过
      // 检查是否正好是 baseIndent 级别的键
      const afterPad = l.slice(baseIndent);
      if (afterPad.startsWith(" ")) { i++; continue; } // 更深层，不属于当前级别
      const kvMatch = afterPad.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (!kvMatch) { i++; continue; }
      const key = kvMatch[1], val = kvMatch[2].trim();
      if (val && val !== "|" && val !== ">") {
        // 叶子键值
        if (val.startsWith("[") && val.endsWith("]")) {
          // 内联数组 [a, b, c]
          obj[key] = val.slice(1, -1).split(",").map(s => _yamlUnquote(s.trim())).filter(s => s !== "");
        } else {
          obj[key] = _yamlUnquote(val);
        }
        i++;
      } else {
        // 子块：收集更深缩进的行
        i++;
        const subLines = [];
        while (i < lines.length) {
          const sl = lines[i];
          if (sl.trim() === "") { i++; continue; }
          if (sl.startsWith(pad + "  ")) { subLines.push(sl); i++; } // 更深缩进
          else break;
        }
        if (subLines.length > 0) {
          // 检测子块是列表还是映射
          const firstSub = subLines.find(s => s.trim() !== "");
          if (firstSub && /^ *- /.test(firstSub.slice(baseIndent + 2))) {
            // YAML 列表
            obj[key] = subLines
              .filter(s => s.trim().startsWith("- "))
              .map(s => _yamlUnquote(s.trim().slice(2).trim()));
          } else {
            obj[key] = _parseIndentBlock(subLines, baseIndent + 2);
          }
        } else {
          obj[key] = val === "|" || val === ">" ? "" : (val === "" ? {} : _yamlUnquote(val));
        }
      }
    }
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

  // 通道绑定角色 → 顶层 profile_routes 同步（行级编辑，保留其余 YAML 原样）
  // hermes 0.20：multiplex_profiles: true + profile_routes 列表（name/platform/profile），
  // 平台级 route 匹配该平台全部消息。绑定 profile 必须已存在（UI 绑定列表来自 /api/profiles）。
  function _syncChannelProfileRoute(yml, id, profile){
    const routeName = "channel-" + id;
    // 1) 确保 multiplex_profiles: true
    if (/^multiplex_profiles:/m.test(yml)) {
      yml = yml.replace(/^multiplex_profiles:.*$/m, "multiplex_profiles: true");
    } else {
      yml = (yml ? yml.replace(/\n?$/, "\n") : "") + "multiplex_profiles: true\n";
    }
    const lines = yml.split("\n");
    let blockStart = -1;
    for (let i = 0; i < lines.length; i++) { if (/^profile_routes:\s*$/.test(lines[i])) { blockStart = i; break; } }
    const routeLine = "  - name: " + routeName;
    if (profile) {
      const entryLines = [routeLine, "    platform: " + id, "    profile: " + profile];
      if (blockStart < 0) {
        // 无 profile_routes 块 → 追加
        return yml.replace(/\n?$/, "\n") + "profile_routes:\n" + entryLines.join("\n") + "\n";
      }
      // 块存在：定位块尾（顶层键 / 2 空格列表项之外）
      let blockEnd = lines.length;
      for (let i = blockStart + 1; i < lines.length; i++) { if (/^[a-zA-Z_]/.test(lines[i])) { blockEnd = i; break; } }
      // 找现有同名条目（- name: channel-<id>）
      let found = -1;
      for (let i = blockStart + 1; i < blockEnd; i++) { if (lines[i].includes(routeLine)) { found = i; break; } }
      if (found >= 0) {
        let j = found + 1;
        while (j < blockEnd && !/^  - /.test(lines[j])) j++;
        lines.splice(found, j - found, ...entryLines);
        return lines.join("\n");
      }
      lines.splice(blockEnd, 0, ...entryLines);
      return lines.join("\n");
    }
    // 解除绑定：删除同名条目
    if (blockStart >= 0) {
      let found = -1;
      for (let i = blockStart + 1; i < lines.length; i++) {
        if (lines[i].includes(routeLine)) { found = i; break; }
        if (/^[a-zA-Z_]/.test(lines[i])) break;
      }
      if (found >= 0) {
        let j = found + 1;
        while (j < lines.length && !/^  - /.test(lines[j]) && !/^[a-zA-Z_]/.test(lines[j])) j++;
        lines.splice(found, j - found);
        return lines.join("\n");
      }
    }
    return yml;
  }

  function _toggleChannel(id, enabled){
    const cfg = _readPlatformConfig(id);
    cfg.enabled = !!enabled;
    cfg.updated_at = Date.now();
    let yml = _setPlatformConfig(id, cfg);
    _writeHermesConfig(yml);
    log(`[channel] ${id} 已${enabled ? "启用" : "禁用"}（platforms.${id}.enabled=${enabled}），重启网关生效`);
    _triggerGatewayRestart(`channel ${id} ${enabled ? "enable" : "disable"}`);
    return { ok: true, id, enabled: !!enabled };
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
        enabled: (cfg && cfg.enabled !== false),
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
    // 确保 skills 始终为数组（YAML {} 会解析为空对象，导致前端 indexOf 崩溃）
    if (cfg.skills != null && !Array.isArray(cfg.skills)) {
      if (typeof cfg.skills === "object") cfg.skills = Object.keys(cfg.skills);
      else cfg.skills = [];
    }
    // 通道级模型/系统提示：网关只认 channel_overrides[chat_id]（platforms.<id>.model 会被忽略），
    // 保存时同步到该平台全部已知 chat_id（新增会话由 _syncChannelOverrides 定时补齐）
    const chModel = (body.config && body.config.model != null) ? String(body.config.model).trim() : "";
    const chSysPrompt = (body.config && body.config.system_prompt != null) ? String(body.config.system_prompt).trim() : "";
    if (chModel || chSysPrompt) {
      const chatIds = _gatewayChatIds(id);
      if (chatIds.length) {
        const ov = (cfg.channel_overrides && typeof cfg.channel_overrides === "object") ? cfg.channel_overrides : {};
        chatIds.forEach(cid => {
          const cur = (ov[cid] && typeof ov[cid] === "object") ? ov[cid] : {};
          if (chModel) cur.model = chModel; else delete cur.model;
          if (chSysPrompt) cur.system_prompt = chSysPrompt; else delete cur.system_prompt;
          if (Object.keys(cur).length) ov[cid] = cur; else delete ov[cid];
        });
        cfg.channel_overrides = ov;
        log(`[ChannelOverride] 通道 ${id} 保存：模型覆盖已应用到 ${chatIds.length} 个会话`);
      }
    } else if (cfg.channel_overrides && typeof cfg.channel_overrides === "object") {
      // 用户清空模型/系统提示（跟随角色）→ 移除本功能写入的 model/system_prompt
      const ov = cfg.channel_overrides;
      Object.keys(ov).forEach(cid => {
        if (ov[cid] && typeof ov[cid] === "object") {
          delete ov[cid].model;
          delete ov[cid].system_prompt;
          if (!Object.keys(ov[cid]).length) delete ov[cid];
        }
      });
      if (!Object.keys(ov).length) delete cfg.channel_overrides;
      log(`[ChannelOverride] 通道 ${id}：用户清空模型/系统提示，已移除覆盖`);
    }
    // wecom 群聊策略兜底：hermes 0.20 wecom 适配器默认 group_policy=pairing，
    // 群聊消息一律被 _is_group_allowed 拒绝（仅 debug 日志，无任何回复）。
    // 保存通道配置时若未显式设置，强制 open（所有群可收发），否则用户拉 bot 进群永远没反应。
    if (id === "wecom" && _getValByPath(cfg, "extra.group_policy") == null) {
      _setValByPath(cfg, "extra.group_policy", "open");
      log(`[ChannelPolicy] wecom 群聊策略未配置，已兜底为 open（允许群消息）`);
    }
    cfg.updated_at = Date.now();
    let yml = _setPlatformConfig(id, cfg);
    // 通道绑定角色 → 顶层 profile_routes 同步（multiplex 路由）
    // hermes 0.20 网关不读 platforms.<id>.profile 字段（官方 dashboard 的落盘字段），
    // 只有顶层 profile_routes 生效：multiplex_profiles: true 时平台消息按路由绑定 profile 运行。
    if (id === "wecom" || id === "weixin") {
      const boundP = (cfg.profile != null && String(cfg.profile).trim() !== "") ? String(cfg.profile).trim() : null;
      yml = _syncChannelProfileRoute(yml, id, boundP);
      log(boundP ? `[ChannelRoute] 通道 ${id} 绑定角色 ${boundP} → profile_routes 已同步`
                 : `[ChannelRoute] 通道 ${id} 未绑定角色，profile_routes 对应条目已清理`);
    }
    _writeHermesConfig(yml);
    // ── 自动启用通道对应的 hermes 插件 toolset ───────────────────────────
    // wecom / dingtalk / feishu 等是 hermes 插件平台，必须在 config.yaml 的
    // toolsets 里列出对应条目（如 hermes-wecom）网关才会在启动时加载该插件。
    // 用户保存通道配置时自动补上，避免「配置了却不连」的困惑。
    const _PLUGIN_TOOLSET = {
      wecom: "hermes-wecom", wecom_callback: "hermes-wecom-callback",
      dingtalk: "hermes-dingtalk", feishu: "hermes-feishu",
      telegram: "hermes-telegram", discord: "hermes-discord",
      slack: "hermes-slack", matrix: "hermes-matrix",
      signal: "hermes-signal", qqbot: "hermes-qqbot",
      whatsapp: "hermes-whatsapp", email: "hermes-email",
      homeassistant: "hermes-homeassistant", mattermost: "hermes-mattermost",
    };
    if (_PLUGIN_TOOLSET[id]) {
      try {
        const needed = _PLUGIN_TOOLSET[id];
        let y2 = _readHermesConfig();
        const curTs = _extractYamlList(y2, "toolsets");
        if (!curTs.includes(needed)) {
          curTs.push(needed);
          y2 = _setYamlListBlock(y2, "toolsets", curTs);
          _writeHermesConfig(y2);
          log(`[ChannelToolset] 自动启用 ${needed}（通道 ${id} 需要此插件）`);
        }
      } catch (e) { log(`[ChannelToolset] 启用 ${_PLUGIN_TOOLSET[id]} 失败: ${e.message}`); }
    }
    return { ok: true };
  }

  // ── 通道「测试」按钮后端（对齐 Octop probe_channel：真实连接验证凭证）────────────────
  // wecom 用 wss 握手、weixin 用 iLink getconfig（只读零副作用）、telegram 用 getMe，
  // 其余无在线探测协议的渠道做必填凭证齐全检查。
  function _testChannel(id, body){
    const def = CHANNEL_DEFS[id]; if (!def) return { ok: false, error: "unknown channel" };
    const env = _readEnvFile();
    const cred = (body && body.credentials) || {};
    const saved = envKey => _getEnvValue(env, envKey);
    if (id === "wecom") {
      const botId = String(cred.WECOM_BOT_ID || saved("WECOM_BOT_ID") || "").trim();
      const secret = String(cred.WECOM_SECRET || saved("WECOM_SECRET") || "").trim();
      if (!botId || !secret) return { ok: false, error: "请先填写或扫码获取 Bot ID / Secret 再测试" };
      return _testWecom(botId, secret);
    }
    if (id === "weixin") {
      const token = String(cred.WEIXIN_TOKEN || saved("WEIXIN_TOKEN") || "").trim();
      const accountId = String(cred.WEIXIN_ACCOUNT_ID || saved("WEIXIN_ACCOUNT_ID") || "").trim();
      const baseUrl = String(cred.WEIXIN_BASE_URL || saved("WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com").trim();
      if (!token) return { ok: false, error: "请先填写或扫码获取 Token 再测试" };
      return _testWeixin(token, accountId, baseUrl);
    }
    if (id === "telegram") {
      const t = String(cred.TELEGRAM_BOT_TOKEN || saved("TELEGRAM_BOT_TOKEN") || "").trim();
      if (!t) return { ok: false, error: "请先填写 Bot Token 再测试" };
      return _testTelegram(t);
    }
    // 其余渠道：必填凭证齐全检查（label 含「(可选)」的跳过）
    const required = (def.fields || []).filter(f => f.env && !/\(可选\)/.test(f.label));
    const missing = required.map(f => (cred[f.env] || saved(f.env)) ? null : f.label).filter(Boolean);
    if (missing.length) return { ok: false, error: "缺少必填凭证：" + missing.join("、") + "，请填写后再测试" };
    const hasAny = (def.fields || []).some(f => f.env && (cred[f.env] || saved(f.env)));
    if (!hasAny) return { ok: false, error: "尚未配置任何凭证，请先填写" };
    return { ok: true, message: "凭据已保存完整，网关重启后生效（该渠道无在线探测接口）" };
  }

  // 企微「AI 智能机器人」wss 握手验证（vendored ws 库，协议对齐 hermes adapter 源码：
  // 订阅 cmd=aibot_subscribe（非 subscribe）、回包按 headers.req_id 匹配、跳过 ping 心跳、
  // errcode==0/缺失即凭证有效，错误字段为 errmsg。实测假凭证返回 errcode=853000）。
  // device_id 每次随机生成，测试不会踢掉真实连接（与 hermes adapter 行为一致）。
  // 注意：不可用 Node 内置全局 WebSocket——undici 在 NAS Node 24 上 #onSocketClose TypeError
  // （本机与 NAS 实测连 wss 均失败）；monitor 的 WS 服务同款 ws 库握手实测通过。
  function _testWecom(botId, secret) {
    return new Promise(resolve => {
      let done = false;
      let ws = null;
      let timer = null;
      const finish = r => {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        try { if (ws) ws.close(); } catch {}
        resolve(r);
      };
      try { ws = new WebSocket("wss://openws.work.weixin.qq.com"); }
      catch (e) { return resolve({ ok: false, error: "无法建立 WebSocket：" + e.message }); }
      timer = setTimeout(() => finish({ ok: false, error: "连接超时（12 秒），请检查网络后重试" }), 12000);
      const reqId = "probe-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
      ws.on("open", () => {
        try {
          ws.send(JSON.stringify({
            cmd: "aibot_subscribe",
            headers: { req_id: reqId },
            body: { bot_id: botId, secret: secret, device_id: Math.random().toString(16).slice(2, 18) }
          }));
        } catch (e) { finish({ ok: false, error: "发送握手请求失败：" + e.message }); }
      });
      ws.on("message", data => {
        let msg = null;
        try { msg = JSON.parse(String(data)); } catch {}
        if (!msg) return;
        if (msg.cmd === "ping") return;                              // 心跳包，忽略
        if ((msg.headers || {}).req_id !== reqId) return;            // 非本次握手的回包，忽略
        const code = msg.errcode;
        if (code === 0 || code === null || code === undefined) return finish({ ok: true, message: "企业微信凭证有效，可正常收发消息" });
        if (code === 853000) return finish({ ok: false, error: "Bot ID / Secret 无效（errcode=853000），请重新扫码授权" });
        finish({ ok: false, error: "握手失败（errcode=" + code + "）：" + (msg.errmsg || "") });
      });
      ws.on("error", e => finish({ ok: false, error: "WebSocket 连接失败：" + (e.message || "网络错误") }));
      ws.on("close", () => finish({ ok: false, error: "连接被关闭，握手未完成" }));
    });
  }

  // 从活跃 profile 的 weixin/accounts/<account_id>.context-tokens.json 提取 peer（key 形如 xxx@im.wechat）
  function _findWeixinPeer(accountId){
    try {
      const active = _getActiveProfile();
      const dir = `${DATA_DIR}/profiles/${active}/weixin/accounts`;
      if (!existsSync(dir)) return "";
      const files = readdirSync(dir).filter(f => f.endsWith(".context-tokens.json"));
      const candidates = [];
      if (accountId) candidates.push(...files.filter(f => f.startsWith(accountId)));
      candidates.push(...files);
      for (const f of candidates) {
        try {
          const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
          const keys = Object.keys(d || {});
          if (keys.length) return keys[0];
        } catch {}
      }
    } catch {}
    return "";
  }

  // 微信 iLink getconfig：只读查询，校验 token 有效性（ret===-14 会话过期，ret==0/null 通过）
  async function _testWeixin(token, accountId, baseUrl){
    const base = (baseUrl || "https://ilinkai.weixin.qq.com").replace(/\/+$/, "");
    const peer = _findWeixinPeer(accountId);
    if (!peer) return { ok: false, error: "未找到微信会话凭证，请先在微信上给助手发一条消息，再回来测试" };
    const uin = Buffer.from(String(Date.now()) + Math.random()).toString("base64").replace(/=+$/, "");
    let res;
    try {
      res = await fetch(`${base}/ilink/bot/getconfig`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
          "AuthorizationType": "ilink_bot_token",
          "X-WECHAT-UIN": uin,
          "iLink-App-Id": "bot",
          "iLink-App-ClientVersion": String((2 << 16) | (2 << 8) | 0),
        },
        body: JSON.stringify({ ilink_user_id: peer, base_info: { channel_version: "2.2.0" } }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      return { ok: false, error: "请求微信服务器失败：" + e.message };
    }
    const data = await res.json().catch(() => ({}));
    const ret = data.ret;
    if (ret === -14) return { ok: false, error: "登录会话已过期（ret=-14），请重新扫码登录微信" };
    if (ret === 0 || ret === "0" || ret == null) return { ok: true, message: "微信 Token 有效，可正常收发消息" };
    if (ret === -8 || ret === -16) return { ok: false, error: "Token 无效或已失效（ret=" + ret + "），请重新扫码登录" };
    return { ok: false, error: "接口返回异常（ret=" + ret + "）：" + (data.errmsg || data.msg || "") };
  }

  async function _testTelegram(token){
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) return { ok: true, message: "Telegram Bot Token 有效：@" + ((data.result && data.result.username) || "") };
      return { ok: false, error: "Telegram Token 无效：" + (data.description || `getMe 返回 ${res.status}`) };
    } catch (e) {
      return { ok: false, error: "请求 Telegram 服务器失败：" + e.message };
    }
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

      // ── hermes 是否已配置模型：config.yaml 存在且含 model/providers 段 ──
      // 全新安装/残留环境无此配置时，网关必报 "No inference provider configured"。
      // 此时忽略残留的 providers-state（模型页不显示不可用的假 provider），
      // 并清空 extensions 中的角色分组（左侧会话树不出现一堆残留条目）。
      // 注：用 var 提升作用域，供本函数后续 safe 组装处读取。
      var hermesConfigured = false;
      try {
        const _ymlPath = `${DATA_DIR}/config.yaml`;
        if (existsSync(_ymlPath)) {
          const _yml = readFileSync(_ymlPath, "utf8");
          hermesConfigured = /^model:/m.test(_yml) && /^providers:/m.test(_yml);
        }
      } catch (e) {}

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
      // 未配置 hermes 时跳过残留 provider 状态（全新环境不显示上一环境的假 provider）
      if (hermesConfigured) Object.entries(provModelMap).forEach(([id, info]) => {
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
      hermes_configured: hermesConfigured,
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
      // 未配置模型时清空残留的角色分组与会话→分组映射（全新环境左侧会话树保持干净）
      if (!hermesConfigured) { ext.agents = []; ext.session_agent = {}; }
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

  // ─── 定时任务（Cron）管理 API（读取活跃 profile 的 jobs.json，兼容旧全局路径）───
  // 注：hermes 0.20.0 起 cron 数据按 profile 隔离（profiles/<id>/cron/jobs.json），
  // 若仍读全局 DATA_DIR/cron/jobs.json 将永远得到空列表（0.20 升级遗留问题，此处修复）。
  const CRON_DIR = `${DATA_DIR}/cron`;
  const CRON_JOBS_FILE = `${CRON_DIR}/jobs.json`;

  // 优先读活跃 profile 的 jobs.json；不存在时回退全局路径（兼容旧版/异常状态）
  function _cronJobsFile() {
    try {
      const prof = _getActiveProfile();
      if (prof) {
        const p = `${DATA_DIR}/profiles/${prof}/cron/jobs.json`;
        if (existsSync(p)) return p;
      }
    } catch {}
    return CRON_JOBS_FILE;
  }

  function _readCronJobs() {
    try {
      const f = _cronJobsFile();
      if (!existsSync(f)) return [];
      const raw = readFileSync(f, "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : (data.jobs || Object.values(data));
    } catch { return []; }
  }

  if (path === "/api/cron-jobs" && req.method === "GET") {
    try {
      const jobs = _readCronJobs();
      // 附带 webhook 投递配置（前端展示 🔗 通道与投递状态）
      const webhooks = _readCronWebhooks();
      const hooks = {};
      Object.keys(webhooks).forEach(id => {
        hooks[id] = (webhooks[id] || []).map(h => ({
          url: h.url, label: h.label || "", message: h.message || "",
          last_run_at: h.last_run_at || null, last_status: h.last_status || null, last_error: h.last_error || null,
        }));
      });
      return new Response(JSON.stringify({ ok: true, jobs, webhooks: hooks }), { headers: jsonHeaders() });
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
      // 多通道投递：body.deliveries = [{channel, url, message, label}]。
      // 内置通道（weixin/telegram/dingtalk/feishu/wecom/discord/origin/local）→ 逗号合并为 --deliver；
      // webhook 通道 → monitor 侧持久化配置，由 _cronWebhookTick 轮询投递（hermes 不支持出站 webhook）。
      let deliverArg = String(body.deliver_to || "").trim();
      const webhooks = [];
      if (Array.isArray(body.deliveries)) {
        const parts = [];
        for (const d of body.deliveries) {
          if (!d || !d.channel) continue;
          const ch = String(d.channel).trim();
          if (ch === "webhook") {
            const url = String(d.url || "").trim();
            if (/^https?:\/\//i.test(url)) {
              webhooks.push({ url, message: String(d.message || "").trim(), label: String(d.label || d.url || "").trim() });
            }
          } else {
            parts.push(ch);
          }
        }
        if (parts.length) deliverArg = parts.join(",");
        else if (!deliverArg && webhooks.length) deliverArg = "local"; // 纯 webhook 任务：输出存本地供轮询读取
      }
      if (deliverArg) args.push("--deliver", deliverArg);
      if (body.repeat) args.push("--repeat", String(body.repeat));
      if (Array.isArray(body.skills)) body.skills.forEach(sk => { if (sk) args.push("--skill", sk); });
      const r = spawnSync(HERMES_BIN, args, { stdout: "pipe", stderr: "pipe", timeout: 15000, env: { ...process.env, HERMES_HOME: DATA_DIR } });
      const stdout = (r.stdout || "").toString().trim();
      const stderr = (r.stderr || "").toString().trim();
      if (r.status !== 0) {
        return new Response(JSON.stringify({ ok: false, error: stderr || stdout || "创建失败" }), { status: 500, headers: jsonHeaders() });
      }
      // 创建成功：把 webhook 投递目标关联到 job_id
      if (webhooks.length) {
        const idMatch = stdout.match(/Created job:\s*([^\s\n]+)/i);
        const jobId = idMatch ? idMatch[1].trim() : "";
        if (jobId) {
          const hooks = _readCronWebhooks();
          hooks[jobId] = (hooks[jobId] || []).concat(webhooks);
          _writeCronWebhooks(hooks);
        } else {
          log(`[cron-webhook] 无法解析 job_id，webhook 配置未关联: ${stdout.slice(0, 200)}`);
        }
      }
      return new Response(JSON.stringify({ ok: true, output: stdout, webhooks_attached: webhooks.length }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // POST /api/cron-jobs/:id/action → 生命周期操作（pause/resume/run/remove）
  const cronActionMatch = path.match(/^\/api\/cron-jobs\/([^/]+)\/action$/);
  if (cronActionMatch && req.method === "POST") {
    try {
      const jobId = decodeURIComponent(cronActionMatch[1]).trim();
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
      // 删除任务时同步清理其 webhook 投递配置
      if (action === "remove") {
        try {
          const hooks = _readCronWebhooks();
          if (hooks[jobId]) { delete hooks[jobId]; _writeCronWebhooks(hooks); }
        } catch {}
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

  // POST /api/channels/:id/toggle → 启用/禁用渠道（platforms.<id>.enabled + 重启网关）
  const toggleM = path.match(/^\/api\/channels\/([^/]+)\/toggle$/);
  if (toggleM && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const r = _toggleChannel(toggleM[1], body.enabled !== false);
      return new Response(JSON.stringify(r), { headers: jsonHeaders() });
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
  // POST /api/channels/:id/test → 通道「测试」按钮（对齐 Octop probe_channel：真实连接验证凭证）
  const chTestMatch = path.match(/^\/api\/channels\/([a-zA-Z0-9_]+)\/test$/);
  if (chTestMatch && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const r = await _testChannel(chTestMatch[1], body);
      return new Response(JSON.stringify(r), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
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
      // 保存后立即重启网关使新凭证/配置生效（微信此前缺失：网关只在 spawn 时读 .env/config.yaml，
      // 不重启则继续用旧 token，用户会误以为「无法重新配置」）。对齐 telegram/whatsapp 的 qr/apply 行为。
      _triggerGatewayRestart(id + "-bind");
      return new Response(JSON.stringify(Object.assign({ restarting: true }, r)), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // POST /api/channels/:id/clear → 清空渠道配置（env 凭据 + platforms.<id> 块），并重启网关
  const chClearMatch = path.match(/^\/api\/channels\/([a-zA-Z0-9_]+)\/clear$/);
  if (chClearMatch && req.method === "POST") {
    try {
      const id = chClearMatch[1];
      const def = CHANNEL_DEFS[id];
      if (!def) return new Response(JSON.stringify({ ok: false, error: "unknown channel" }), { status: 400, headers: jsonHeaders() });
      // 1) 清空 .env 中该渠道的全部凭据键
      let env = _readEnvFile();
      (def.fields || []).forEach(f => { if (f.env) env = _setEnvValue(env, f.env, ""); });
      _writeEnvFile(env);
      // 2) 清空 config.yaml 中 platforms.<id> 整块
      _writeHermesConfig(_setPlatformConfig(id, {}));
      log(`[ChannelClear] 渠道 ${id} 配置已清空（env 凭据 + platforms.${id} 块）`);
      _triggerGatewayRestart(id + "-clear");
      return new Response(JSON.stringify({ ok: true, clearing: true }), { headers: jsonHeaders() });
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
  // 企业微信扫码授权：腾讯官方 AI 机器人扫码接口（与 Octop 一致），
  // 无需预先配置 Corp ID / Agent ID / Secret——扫码授权后直接返回 bot_id + secret。
  // GET /api/channels/wecom/qr → 生成二维码（scode + auth_url）
  if (path === "/api/channels/wecom/qr" && req.method === "GET") {
    try {
      const res = await fetch("https://work.weixin.qq.com/ai/qc/generate?source=hermes&plat=3", {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`腾讯扫码接口 ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const d = (data && data.data) || {};
      const scode = String(d.scode || "").trim();
      const authUrl = String(d.auth_url || "").trim();
      if (!scode || !authUrl) throw new Error("接口响应缺少 scode/auth_url：" + JSON.stringify(data).slice(0, 200));
      _wecomQrCache.set(scode, { ts: Date.now(), bot_id: "", secret: "" });
      return new Response(JSON.stringify({ ok: true, scode, qr_payload: authUrl, qr_url: authUrl, deep_link: authUrl }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "无法生成企业微信二维码：" + e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  // GET /api/channels/wecom/qr/status?scode=... → 轮询扫码结果（3s 缓存避免频繁打腾讯接口）
  if (path === "/api/channels/wecom/qr/status" && req.method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const scode = (u.searchParams.get("scode") || "").trim();
      if (!scode) return new Response(JSON.stringify({ ok: false, error: "缺少 scode" }), { status: 400, headers: jsonHeaders() });
      const now = Date.now();
      const cached = _wecomQrCache.get(scode);
      if (cached && now - cached.ts < 3000) {
        if (cached.bot_id) return new Response(JSON.stringify({ ok: true, status: "ready", bot_id: cached.bot_id, secret: cached.secret }), { headers: jsonHeaders() });
        return new Response(JSON.stringify({ ok: true, status: "waiting" }), { headers: jsonHeaders() });
      }
      const res = await fetch("https://work.weixin.qq.com/ai/qc/query_result?scode=" + encodeURIComponent(scode), {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`腾讯扫码接口 ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const d = (data && data.data) || {};
      const status = String(d.status || "pending").trim();
      if (status === "success") {
        const botId = String((d.bot_info && d.bot_info.botid) || "").trim();
        const secret = String((d.bot_info && d.bot_info.secret) || "").trim();
        if (!botId || !secret) throw new Error("扫码成功但缺少 bot 信息");
        _wecomQrCache.set(scode, { ts: now, bot_id: botId, secret });
        return new Response(JSON.stringify({ ok: true, status: "ready", bot_id: botId, secret }), { headers: jsonHeaders() });
      }
      if (status === "error" || status === "expired") {
        return new Response(JSON.stringify({ ok: false, error: String(d.message || ("扫码" + status + "，请重新获取二维码")) }), { status: 410, headers: jsonHeaders() });
      }
      _wecomQrCache.set(scode, { ts: now, bot_id: "", secret: "" });
      return new Response(JSON.stringify({ ok: true, status: "waiting" }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "轮询企业微信状态失败：" + e.message }), { status: 502, headers: jsonHeaders() });
    }
  }
  // POST /api/channels/wecom/qr/apply → 保存 bot_id + secret 并启用平台（自动重启网关生效）
  if (path === "/api/channels/wecom/qr/apply" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const scode = String(body.scode || "").trim();
      const cached = scode ? _wecomQrCache.get(scode) : null;
      const botId = String(body.bot_id || (cached && cached.bot_id) || "").trim();
      const secret = String(body.secret || (cached && cached.secret) || "").trim();
      if (!botId || !secret) return new Response(JSON.stringify({ ok: false, error: "缺少 bot_id / secret，请先完成扫码授权" }), { status: 400, headers: jsonHeaders() });
      let env = _readEnvFile();
      env = _setEnvValue(env, "WECOM_BOT_ID", botId);
      env = _setEnvValue(env, "WECOM_SECRET", secret);
      _writeEnvFile(env);
      const cfg = _readPlatformConfig("wecom");
      cfg.enabled = true;
      cfg.extra = cfg.extra || {};
      cfg.extra.bot_id = botId;
      cfg.extra.secret = secret;
      cfg.updated_at = Date.now();
      _writeHermesConfig(_setPlatformConfig("wecom", cfg));
      // 自动启用 hermes-wecom 插件 toolset（网关需要此条目才加载 wecom 平台模块）
      try {
        let y2 = _readHermesConfig();
        const curTs = _extractYamlList(y2, "toolsets");
        if (!curTs.includes("hermes-wecom")) {
          curTs.push("hermes-wecom");
          _writeHermesConfig(_setYamlListBlock(y2, "toolsets", curTs));
          log(`[ChannelToolset] wecom QR apply: 自动启用 hermes-wecom`);
        }
      } catch (e) { log(`[ChannelToolset] wecom QR toolset 启用失败: ${e.message}`); }
      if (scode) _wecomQrCache.delete(scode);
      _triggerGatewayRestart("wecom-bind");
      return new Response(JSON.stringify({ ok: true, bot_id: botId, gateway_restarting: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 触发网关重启（异步、尽力而为）─────────────────────────────────────
  // 用于频道绑定 / 配置变更后让网关重新加载 .env 与 config.yaml。
  // 旧版 POST 到 Dashboard /api/gateway/restart 依赖 systemd user service，
  // fnOS 未启用 linger 导致重启静默失败（gateway-restart.log: "Cannot restart
  // gateway as a service — linger is not enabled"）。改为直接杀进程+重启。
  // 防抖变量（_gwRestartTimer / _gwRestartInProgress）声明在模块级（line ~437），
  // 不可放在 handleFetch 内——每请求重置会让防抖完全失效。
  function _triggerGatewayRestart(reason) {
    const tag = reason || "config";
    if (_gwRestartInProgress) {
      log(`[gw-restart] ${tag}: 重启进行中，跳过`);
      return;
    }
    log(`[gw-restart] ${tag}: 已排队重启请求（2s 防抖）`);
    if (_gwRestartTimer) clearTimeout(_gwRestartTimer);
    _gwRestartTimer = setTimeout(async () => {
      _gwRestartTimer = null;
      _gwRestartInProgress = true;
      try {
        log(`[gw-restart] ${tag}: 开始重启 gateway + dashboard ...`);
        await stopPid(PID_GATEWAY);
        await stopPid(PID_DASHBOARD);
        await forceKillHermes();
        resetGatewayCrashLoop();
        await new Promise(r => setTimeout(r, 1500));
        const r1 = spawnHermes("gateway",   PID_GATEWAY,   ["gateway", "run"]);
        const r2 = spawnHermes("dashboard", PID_DASHBOARD, ["dashboard", "--host", DASHBOARD_BIND, "--port", String(DASHBOARD_PORT), "--no-open", "--insecure"]);
        log(`[gw-restart] ${tag}: 重启完成 gateway=${JSON.stringify(r1)} dashboard=${JSON.stringify(r2)}`);
      } catch (e) {
        log(`[gw-restart] ${tag}: 重启失败 ${e?.message || e}`);
      } finally {
        _gwRestartInProgress = false;
      }
    }, 2000);
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
      let newModel = "";

      try {
        let ymlContent = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : "";
        // model.provider 经 PROVIDER_HERMES_IDS 映射（openai → openai-api，其余用自身 id）
        const hermesProvider = PROVIDER_HERMES_IDS[providerId] || providerId;
        newModel = `model:\n  provider: ${hermesProvider}\n  default: ${resolvedModel}`;
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

      // ── 同步活跃 profile 的 config.yaml（修复网关用错 profile 的 provider）───
      // hermes CLI 启动 dashboard/gateway 时优先读 .active_profile 指向的
      // profiles/<id>/config.yaml 的 model 块；如果该文件里 provider 与面板
      // 配置不一致，网关会去用旧 provider（找不到 key → 502）。
      // 每次用户在前端保存 model 配置时，把 model 块同步到活跃 profile。
      try {
        let activeProfile = "default";
        try { activeProfile = readFileSync(`${DATA_DIR}/.active_profile`, "utf8").trim() || "default"; } catch {}
        if (activeProfile && activeProfile !== "default") {
          const profileCfgPath = `${DATA_DIR}/profiles/${activeProfile}/config.yaml`;
          if (existsSync(profileCfgPath)) {
            let py = readFileSync(profileCfgPath, "utf8");
            // 替换或追加 model 块（与主 config.yaml 一致）
            py = _setTopLevelBlock(py, "model", newModel);
            // 同步 providers 段（至少包含当前活跃 provider，确保网关能找到 base_url + api_key 引用）
            if (providersBlock) {
              py = _setTopLevelBlock(py, "providers", providersBlock.trimEnd());
            }
            writeFileSync(profileCfgPath, py, { mode: 0o644 });
            log(`[profile-sync] 已同步 model/providers 到 profile "${activeProfile}" 的 config.yaml`);
          }
        }
      } catch (e) {
        log(`[profile-sync] 同步活跃 profile 失败: ${e.message}`);
      }

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
      ymlContent = ymlContent.replace(/^model:\n(?:[ \t].*\n?)*/m, newModelSection);
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

  // 匹配 /api/sessions/:id/sync —— 多端同步签名（几十字节，前端轮询检测变化）
  const syncMatch = path.match(/^\/api\/sessions\/([^/]+)\/sync$/);
  if (syncMatch && req.method === "GET") {
    const sid = decodeURIComponent(syncMatch[1]);
    const sig = sessionSig(sid);
    if (sig === null) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders() });
    return new Response(JSON.stringify({ ok: true, sig }), { headers: jsonHeaders() });
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

  // ─── 安全网关设置（tool_guard 开关，持久化 data/studio/security.json）──────
  if (path === "/api/studio/security" && req.method === "GET") {
    return new Response(JSON.stringify({ enabled: _toolGuardEnabled, blockRules: TOOL_GUARD_BLOCK_RULES.length, warnRules: TOOL_GUARD_WARN_RULES.length }), { headers: jsonHeaders() });
  }
  if (path === "/api/studio/security" && req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    _toolGuardEnabled = body.enabled !== false;
    toolGuardSave();
    log(`[tool-guard] 已切换为 ${_toolGuardEnabled ? "开启" : "关闭"}`);
    return new Response(JSON.stringify({ ok: true, enabled: _toolGuardEnabled }), { headers: jsonHeaders() });
  }

  // ─── 语音音色配置（TTS voice，读写 config.yaml 的 tts.edge.voice） ───
  function _readTtsVoice(){
    const yml = _readHermesConfig();
    const tm = yml.match(/^tts:\n((?:  .*\n?)+)/m);
    if (!tm) return "";
    const em = tm[1].match(/^  edge:\n((?:    .*\n?)+)/m);
    if (!em) return "";
    const vv = em[1].match(/^    voice:\s*(.+?)\s*$/m);
    return vv ? _yamlUnquote(vv[1]) : "";
  }
  function _writeTtsVoice(voice){
    const block = "tts:\n  provider: edge\n  edge:\n    voice: " + _yamlQuote(voice);
    const yml = _setTopLevelBlock(_readHermesConfig(), "tts", block);
    return _writeHermesConfig(yml);
  }
  if (path === "/api/voice/config" && req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, voice: _readTtsVoice(), voices: TTS_VOICE_OPTIONS }), { headers: jsonHeaders() });
  }
  if (path === "/api/voice/config" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const v = String(body.voice || "").trim();
    if (!v) return new Response(JSON.stringify({ ok: false, error: "voice 不能为空" }), { status: 400, headers: jsonHeaders() });
    if (!_writeTtsVoice(v)) return new Response(JSON.stringify({ ok: false, error: "写入配置失败" }), { status: 500, headers: jsonHeaders() });
    log(`[voice-config] TTS 音色已更新为 ${v}`);
    return new Response(JSON.stringify({ ok: true, voice: v }), { headers: jsonHeaders() });
  }

  // ─── 工作区目录列表（新建会话选择工作区文件夹） ───
  if (path === "/api/workspace/dirs" && req.method === "GET") {
    try {
      const dirs = readdirSync(WORKSPACE_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory()).map(e => e.name).sort();
      return new Response(JSON.stringify({ ok: true, dirs }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: true, dirs: [] }), { headers: jsonHeaders() });
    }
  }

  // ─── 知识库（Obsidian 风格 vault：.md + [[wikilink]]，根目录优先 OBSIDIAN_VAULT_PATH） ───
  function _kbRoot(){
    const env = _readEnvFile();
    const ov = (env["OBSIDIAN_VAULT_PATH"] || "").trim();
    const root = ov || `${DATA_DIR}/knowledge`;
    try { mkdirSync(root, { recursive: true }); } catch {}
    return root;
  }
  function _kbSafe(rel){
    if (rel === undefined || rel === null) return null;
    const root = _kbRoot();
    const abs = resolvePath(root, String(rel).replace(/^\/+/, ""));
    if (abs !== root && !abs.startsWith(root + "/")) return null;
    return abs;
  }
  if (path === "/api/kb/tree" && req.method === "GET") {
    try {
      const root = _kbRoot();
      function walk(dir, prefix){
        const out = [];
        readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith("."))
          .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
          .forEach(e => {
            const rel = prefix ? prefix + "/" + e.name : e.name;
            if (e.isDirectory()) out.push({ name: e.name, type: "dir", path: rel, children: walk(`${dir}/${e.name}`, rel) });
            else if (e.name.toLowerCase().endsWith(".md")) out.push({ name: e.name, type: "file", path: rel });
          });
        return out;
      }
      return new Response(JSON.stringify({ ok: true, root, tree: walk(root, "") }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/kb/read" && req.method === "GET") {
    try {
      const abs = _kbSafe(url.searchParams.get("path") || "");
      if (!abs) return new Response(JSON.stringify({ ok: false, error: "非法路径" }), { status: 400, headers: jsonHeaders() });
      if (!existsSync(abs) || !statSync(abs).isFile()) return new Response(JSON.stringify({ ok: false, error: "笔记不存在" }), { status: 404, headers: jsonHeaders() });
      const content = readFileSync(abs, "utf8");
      return new Response(JSON.stringify({ ok: true, path: String(url.searchParams.get("path") || ""), content }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/kb/write" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      let rel = String(body.path || "").trim();
      if (!rel) return new Response(JSON.stringify({ ok: false, error: "缺少 path" }), { status: 400, headers: jsonHeaders() });
      if (!rel.toLowerCase().endsWith(".md")) rel += ".md";
      const abs = _kbSafe(rel);
      if (!abs) return new Response(JSON.stringify({ ok: false, error: "非法路径" }), { status: 400, headers: jsonHeaders() });
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, String(body.content ?? ""), "utf8");
      return new Response(JSON.stringify({ ok: true, path: rel }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/kb/new" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "未命名").trim();
      const dir = String(body.dir || "").trim();
      const rel = dir ? `${dir}/${name.replace(/\.md$/i, "")}.md` : `${name.replace(/\.md$/i, "")}.md`;
      const abs = _kbSafe(rel);
      if (!abs) return new Response(JSON.stringify({ ok: false, error: "非法路径" }), { status: 400, headers: jsonHeaders() });
      if (existsSync(abs)) return new Response(JSON.stringify({ ok: false, error: "笔记已存在" }), { status: 409, headers: jsonHeaders() });
      mkdirSync(dirname(abs), { recursive: true });
      const ts = new Date();
      const pad = n => String(n).padStart(2, "0");
      const front = `---\ncreated: ${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())}T${pad(ts.getHours())}:${pad(ts.getMinutes())}:00+08:00\ntags: []\n---\n\n# ${name.replace(/\.md$/i, "")}\n\n`;
      writeFileSync(abs, front, "utf8");
      return new Response(JSON.stringify({ ok: true, path: rel, content: front }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── Chat: WebSocket 消息队列（前端先 POST 消息入队，再建 WS 连接取流）──────
  if (path === "/api/chat/ws-send" && req.method === "POST") {
    const body = await req.json();
    const { session_id, message, system, model, provider } = body;
    const guardResp = toolGuardCheckAndRespond(message);
    if (guardResp) return guardResp;
    const messageEmpty = message == null || (Array.isArray(message) && message.length === 0) || (typeof message === "string" && message.length === 0);
    if (!session_id || messageEmpty) {
      return new Response(JSON.stringify({ error: "session_id and message required" }), { status: 400, headers: jsonHeaders() });
    }
    // system 字段携带 persona / 专家团提示，由 createChatStream 注入 system prompt，
    // 避免把人格提示拼进用户消息污染对话历史
    // model/provider 为会话级模型选择，由 resolveChatProviders 优先采用
    // 关键修复：新消息到达时作废旧的已完成/失败缓存，防止重发时把上一轮的旧回复当成本轮结果返回
    const _prevCache = _streamResultCache.get(session_id);
    if (_prevCache) {
      if (_prevCache.status === 'running') {
        // 用户在流进行中又发了新消息 → 中断旧流，以新消息为准
        const _prevCtrl = activeChatStreams.get(session_id);
        if (_prevCtrl) { try { _prevCtrl.abort(); } catch {}
          log(`[WS] new message arrived, aborting previous stream session=${session_id}`); }
      }
      _streamResultCache.delete(session_id);
    }
    wsMessageQueue.set(session_id, { message, system: system || "", model: model || "", provider: provider || "" });
    // 30秒后自动清除（防止 WS 连接未建立导致泄漏）
    setTimeout(() => wsMessageQueue.delete(session_id), 30000);
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
  }

  // ─── 聊天：流式 API ──────────────────────────────────────────────────────
  if (path === "/api/chat/stream" && req.method === "POST") {
    const body = await req.json();
    const { session_id, message, system, model, provider } = body;
    const guardResp = toolGuardCheckAndRespond(message);
    if (guardResp) return guardResp;
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

  // ─── 聊天：图片上传 API（Profile 隔离：profile 参数非空时存入 profiles/<p>/uploads）────
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
      // Profile 隔离：profile 参数非空 → 存入该 profile 的 uploads 目录
      const profile = String(form.get("profile") || "").replace(/[^\w.-]/g, "").slice(0, 64);
      let imgDir = UPLOAD_IMG_DIR, urlBase = "/uploads/images/";
      if (profile && profile !== "default") {
        imgDir = `${DATA_DIR}/profiles/${profile}/uploads/images`;
        urlBase = `/uploads/p/${profile}/images/`;
      }
      mkdirSync(imgDir, { recursive: true });
      writeFileSync(`${imgDir}/${filename}`, Buffer.from(buf));
      return new Response(JSON.stringify({ url: `${urlBase}${filename}`, path: `${imgDir}/${filename}`, profile: profile || "default" }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 聊天：通用文件上传 API（非图片附件，落盘到 Hermes home 下，让 Hermes
  //      自己用文件工具读取，而不是把全文本塞进 prompt 撑爆/卡死浏览器）──────────
  //      Profile 隔离：profile 参数非空时存入 profiles/<p>/uploads，保持多 Agent 完全隔离
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
      const safeBase = safeFilename(origName);
      const filename = `${Date.now()}_${randomBytes(6).toString("hex")}_${safeBase}`;
      const profile = String(form.get("profile") || "").replace(/[^\w.-]/g, "").slice(0, 64);
      let fileDir = UPLOAD_FILE_DIR, urlBase = "/uploads/files/";
      if (profile && profile !== "default") {
        fileDir = `${DATA_DIR}/profiles/${profile}/uploads/files`;
        urlBase = `/uploads/p/${profile}/files/`;
      }
      mkdirSync(fileDir, { recursive: true });
      const fullPath = `${fileDir}/${filename}`;
      writeFileSync(fullPath, Buffer.from(buf));
      return new Response(JSON.stringify({
        url: `${urlBase}${encodeURIComponent(filename)}`,
        path: fullPath,
        name: origName,
        size: buf.byteLength,
        profile: profile || "default",
      }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 文件下载：按解析后的路径下载用户上传文件 / Agent 生成文件 ─────────────
  // 路径解析兼容：绝对路径、~/ 相对 HOME、相对路径（DATA_DIR 基准）、/uploads 别名
  // GET /api/download?path=xxx[&name=xxx] → 流式下载（Content-Disposition: attachment）
  if (path === "/api/download" && req.method === "GET") {
    try {
      const p = url.searchParams.get("path") || "";
      const fp = resolveFilePath(p);
      if (!fp) {
        return new Response(JSON.stringify({ error: `文件不存在或不可访问: ${p}` }), { status: 404, headers: jsonHeaders() });
      }
      const st = statSync(fp);
      const name = safeFilename(url.searchParams.get("name") || decodeURIComponent(fp.split("/").pop() || "file"));
      const mime = mimeFromPath(fp);
      // 内联类型（图片/pdf/html/文本）用 inline，其余强制 attachment
      const disposition = isInlinePreviewType(fp) ? "inline" : "attachment";
      const stream = createReadStream(fp);
      return new Response(stream, {
        headers: {
          "Content-Type": mime,
          "Content-Length": String(st.size),
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": corsOrigin,
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Download failed: ${err.message}` }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── 文件预览：返回可内联内容（图片/pdf/html 直接流，文本类 JSON 由前端渲染）────
  // GET /api/preview?path=xxx → 图片/PDF/HTML 流式返回；文本类返回 {ok, content, mime, name}
  if (path === "/api/preview" && req.method === "GET") {
    try {
      const p = url.searchParams.get("path") || "";
      const fp = resolveFilePath(p);
      if (!fp) {
        return new Response(JSON.stringify({ error: `文件不存在或不可访问: ${p}` }), { status: 404, headers: jsonHeaders() });
      }
      const st = statSync(fp);
      const ext = (fp.split(".").pop() || "").toLowerCase();
      const name = decodeURIComponent(fp.split("/").pop() || "file");
      // 图片 / PDF / HTML：直接流式返回（前端 iframe/img 引用）
      if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "pdf", "html", "htm"].includes(ext)) {
        const stream = createReadStream(fp);
        return new Response(stream, {
          headers: {
            "Content-Type": mimeFromPath(fp),
            "Content-Length": String(st.size),
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": corsOrigin,
            "X-Preview-Name": encodeURIComponent(name),
          },
        });
      }
      // 文本类：>8MB 拒绝（前端只渲染小文本）
      if (st.size > 8 * 1024 * 1024) {
        return new Response(JSON.stringify({ ok: false, error: "文本文件过大（>8MB），请使用下载" }), { headers: jsonHeaders() });
      }
      const content = readFileSync(fp, "utf8");
      return new Response(JSON.stringify({ ok: true, path: fp, name, mime: mimeFromPath(fp), content, size: st.size }), { headers: jsonHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Preview failed: ${err.message}` }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ─── Office 预览：docx/xlsx/pptx → HTML（server/preview_conv.py，零依赖）────
  // GET /api/preview/office?path=xxx → text/html
  if (path === "/api/preview/office" && req.method === "GET") {
    try {
      const p = url.searchParams.get("path") || "";
      const fp = resolveFilePath(p);
      if (!fp) {
        return new Response(JSON.stringify({ error: `文件不存在或不可访问: ${p}` }), { status: 404, headers: jsonHeaders() });
      }
      const ext = (fp.split(".").pop() || "").toLowerCase();
      if (!["docx", "xlsx", "pptx"].includes(ext)) {
        return new Response(JSON.stringify({ error: "仅支持 docx/xlsx/pptx" }), { status: 415, headers: jsonHeaders() });
      }
      const script = `${APP_DIR}/server/preview_conv.py`;
      const pyBin = `${VENV_BIN}/python3`;
      // 子进程运行转换脚本（避免阻塞事件循环）
      const execFileP = (cmd, args) => new Promise((resolve) => {
        execFile(cmd, args, { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
        });
      });
      const r = await execFileP(pyBin, [script, fp]);
      if (r.err || !r.stdout) {
        log(`[preview/office] conv failed ${fp}: ${r.err?.message || r.stderr || "no output"}`);
        return new Response(JSON.stringify({ error: "转换失败：" + (r.stderr || r.err?.message || "未知错误").slice(0, 200) }), { status: 500, headers: jsonHeaders() });
      }
      return new Response(r.stdout, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": corsOrigin,
          "X-Preview-Name": encodeURIComponent(fp.split("/").pop() || "preview"),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Preview failed: ${err.message}` }), { status: 500, headers: jsonHeaders() });
    }
  }
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
      if (!sessionId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return;
      }
      // 允许无队列消息的连接（WS 断线重连场景：前端重连不会重新 POST，
      // 此时 message=null，runChatWS 会从流缓存中继续取结果）
      if (_q) wsMessageQueue.delete(sessionId);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.data = { sessionId, message: _q ? _q.message : null, system: _q ? (_q.system || "") : "", model: _q ? (_q.model || "") : "", provider: _q ? (_q.provider || "") : "", stopCtrl: null };
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
        // 真实 PTY：由 pty_bridge.py（pty.openpty + setsid + TIOCSCTTY）提供控制终端，
        // 修复 pipe spawn 下 bash -i 报 “cannot set terminal process group / no job control”，
        // Ctrl+C、前后台任务、vim 等全屏程序均可正常工作。
        const pty = spawn(`${VENV_BIN}/python3`, [
          `${APP_DIR}/server/pty_bridge.py`,
          "--shell", "/bin/bash",
          "--cwd", existsSync(cwd) ? cwd : DATA_DIR,
        ], {
          env: { ...process.env, TERM: "xterm-256color", LANG: "C.UTF-8" },
          stdio: ["pipe", "pipe", "inherit"], // stderr 为 pty_bridge 日志，直接进 monitor 日志
        });
        // PTY 输出可能含二进制（颜色/全屏程序），以二进制帧下发，前端做流式 UTF-8 解码
        pty.stdout.on("data", (d) => { try { ws.send(d); } catch {} });
        pty.on("close", (code) => { try { ws.send(JSON.stringify({ type: "exit", code })); ws.close(); } catch {} });
        pty.on("error", (err) => { try { ws.send(JSON.stringify({ type: "output", data: `\r\n[ERROR] ${err.message}\r\n` })); } catch {} });
        ws.on("message", (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            if (data.type === "input" && pty.stdin.writable) pty.stdin.write(data.data);
            if (data.type === "resize" && pty.stdin.writable) {
              // 以控制帧透传窗口尺寸 → pty_bridge 调 TIOCSWINSZ + SIGWINCH
              const rows = Math.max(2, Math.min(parseInt(data.rows, 10) || 24, 32767));
              const cols = Math.max(2, Math.min(parseInt(data.cols, 10) || 80, 32767));
              pty.stdin.write(`\x1b[HERMES1\x1bRESIZE\x1b${rows};${cols}\x1b[HERMES2`);
            }
          } catch {
            // 纯文本输入（向后兼容旧前端）
            if (pty.stdin.writable) pty.stdin.write(msg.toString());
          }
        });
        ws.on("close", () => { try { pty.kill("SIGHUP"); } catch {} });
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
    // 启动自愈 config.yaml（顶格残留修复）；修复后 maybeAutoStartServices 会用干净配置拉起网关
    _restoreProvidersState();
    const repaired = _repairConfigYaml();
    if (repaired) {
      // 配置曾被写坏：确保网关用修复后的配置重启（若已在运行则重启一次）
      const gp = readPid(PID_GATEWAY);
      if (gp && existsSync(`/proc/${gp}`)) { _triggerGatewayRestart("config-repair"); }
    }
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

// 通道级模型覆盖同步（60s 一次）：把配置了模型/系统提示的平台的覆盖同步到网关路由索引中
// 新增的 chat_id（新微信/新会话出现后也能自动应用通道模型，无需重新保存配置）
setInterval(() => {
  try { _syncChannelOverrides(); } catch (e) {}
}, 60000);

// ─── 定时任务 Webhook 出站投递（monitor 侧实现，hermes 不支持出站 webhook）───
function _readCronWebhooks() {
  try {
    const raw = readFileSync(CRON_WEBHOOKS_FILE, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}
function _writeCronWebhooks(map) {
  try {
    mkdirSync(dirname(CRON_WEBHOOKS_FILE), { recursive: true });
    writeFileSync(CRON_WEBHOOKS_FILE, JSON.stringify(map, null, 2));
  } catch (e) {
    log(`[cron-webhook] 写配置失败: ${e?.message || e}`);
  }
}
// 模块级轻量活跃 profile 解析（webhook 轮询用；优先内存缓存，其次 .active_profile 文件，
// 避免每次 tick 拉起 venv CLI）。注：_getActiveProfile 定义在 handleFetch 闭包内，模块级不可用。
function _cronProfileName() {
  if (_activeProfileCache) return _activeProfileCache;
  try {
    const raw = readFileSync(`${DATA_DIR}/.active_profile`, "utf8");
    const name = raw.trim();
    if (name) return name;
  } catch {}
  return "default";
}
// 模块级 jobs.json 定位（profile 隔离路径优先，回退全局），供 webhook 轮询使用
function _cronProfileJobsFile() {
  try {
    const prof = _cronProfileName();
    const p = `${DATA_DIR}/profiles/${prof}/cron/jobs.json`;
    if (existsSync(p)) return p;
  } catch {}
  return `${DATA_DIR}/cron/jobs.json`;
}
// 读取任务最近一次输出（0.20.0 输出目录按 profile 隔离 profiles/<p>/cron/output/<job_id>/*.md，
// 兼容全局 cron/output/<job_id>/*.md 与旧版 cron/<id>/outputs/*.md）
function _cronLatestOutput(jobId) {
  let prof = "default";
  try { prof = _cronProfileName() || "default"; } catch {}
  const candidates = [
    `${DATA_DIR}/profiles/${prof}/cron/output/${jobId}`,
    `${DATA_DIR}/profiles/${prof}/cron/${jobId}/outputs`,
    `${DATA_DIR}/cron/output/${jobId}`,
    `${DATA_DIR}/cron/${jobId}/outputs`,
  ];
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort();
      if (!files.length) continue;
      return readFileSync(`${dir}/${files[files.length - 1]}`, "utf8").slice(0, 8000);
    } catch {}
  }
  return "";
}
// POST 到 webhook：企微机器人/钉钉机器人均为 {"msgtype":"text","text":{"content":...}}，
// 失败时尝试通用 JSON 原样 POST（部分自定义 webhook 期望原始文本/JSON）
async function _postWebhookText(url, text) {
  const payload = { msgtype: "text", text: { content: text } };
  let r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let t = "";
  try { t = await r.text(); } catch {}
  // 企微机器人 {"errcode":0,"errmsg":"ok"}；钉钉 {"errcode":0}；其它 webhook 返回任意 2xx 均视为成功
  try {
    const j = JSON.parse(t || "{}");
    if (j.errcode && Number(j.errcode) !== 0) throw new Error(`errcode ${j.errcode}: ${j.errmsg || t}`);
  } catch (e) {
    if (e instanceof SyntaxError) return t; // 非 JSON 响应（如纯文本 ok），2xx 即成功
    throw e;
  }
  return t;
}
// 轮询一次：对配置了 webhook 的任务，检测 last_run_at 变化 → 组装消息 → POST
async function _cronWebhookTick() {
  const hooks = _readCronWebhooks();
  const ids = Object.keys(hooks).filter(id => Array.isArray(hooks[id]) && hooks[id].length);
  if (!ids.length) return;
  let jobs = [];
  try {
    const raw = readFileSync(_cronProfileJobsFile(), "utf8");
    const data = JSON.parse(raw);
    jobs = Array.isArray(data) ? data : (data.jobs || Object.values(data));
  } catch {}
  const byId = {};
  jobs.forEach(j => { const id = j.id || j.job_id || j.name || ""; if (id) byId[id] = j; });
  let changed = false;
  for (const id of ids) {
    const list = hooks[id];
    const job = byId[id];
    if (!job) continue; // 任务已删除
    const runAt = job.last_run_at || job.lastRunAt || "";
    const status = job.last_status || "ok";
    for (const h of list) {
      if (!h || !h.url) continue;
      if (!runAt || h.last_run_at === runAt) continue; // 无新执行
      const output = _cronLatestOutput(id);
      let text = String(h.message || "").trim();
      if (text) {
        text = text.split("{output}").join(output || "(无输出)");
        if (!/^\s*$/.test(text) && text.indexOf("{output}") < 0) text = text + "\n\n" + (output || "(无输出)");
      } else {
        text = output || "(无输出)";
      }
      try {
        await _postWebhookText(h.url, text);
        h.last_run_at = runAt; h.last_status = "ok"; h.last_error = "";
        log(`[cron-webhook] 任务 ${id} → ${h.label || h.url} 投递成功 (${runAt})`);
      } catch (e) {
        h.last_status = "error"; h.last_error = String(e?.message || e);
        log(`[cron-webhook] 任务 ${id} → ${h.label || h.url} 投递失败: ${h.last_error}`);
      }
      changed = true;
    }
  }
  if (changed) _writeCronWebhooks(hooks);
}
// 轮询周期 20s：仅在存在 webhook 配置时才真正读 jobs.json，开销可忽略
setInterval(() => { _cronWebhookTick().catch(e => log(`[cron-webhook] tick 异常: ${e?.message || e}`)); }, 20000);
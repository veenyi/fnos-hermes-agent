// custom_routes.js — 自定义面板路由（personas / channels / skills / app-update）
//
// 从旧版 Node 监控服务抽取并适配 Node 运行时。本文件独立于上游 monitor.js，
// 由上游 http.createServer 的 fetch 处理器在调用 handleFetch 之前通过 handleCustomRoute(req)
// 进行分发；匹配则返回 Response，否则返回 null 交给上游处理。
// 这样即便本文件内某条自定义路由有运行时错误，也只影响对应面板，不会破坏
// 上游核心的 chat / status / dashboard 功能。

import { spawn, spawnSync } from "child_process";
import {
  writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync, appendFileSync,
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

// ─── 群聊（Rooms）v0.24 ── 多 Agent 协作房间；成员回复全部走 Hermes 会话（上游 /api/chat/stream）───
const ROOMS_FILE = `${DATA_DIR}/rooms.json`;
const ROOMS_UI_PORT = Number(process.env.UI_PORT || "8650");
let roomsStore = [];
let roomWatchers = new Map(); // roomId -> Set<ReadableStreamController>
// ── AI 自主接力（DGA 进化）：AI 自己选下一位发言人 ──
async function _mkRoomSession(tag) {
  try {
    const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    const sid = j.id || "";
    // 隔离：内部会话打 group 标记（不进主对话列表）
    if (sid) {
      try {
        const sf = `${VAR_DIR}/chat/sessions/${sid}.json`;
        if (existsSync(sf)) {
          const sd = JSON.parse(readFileSync(sf, "utf8"));
          sd.group = "room_" + (tag || "internal");
          writeFileSync(sf, JSON.stringify(sd));
        }
      } catch (e) {}
    }
    return sid;
  } catch (e) { return ""; }
}
async function _hermesOnce(sid, message, system, model) {
  try {
    const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid, message, system: system || "", model: model || "", provider: "" }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok || !r.body) return "";
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "", full = "";
    while (true) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() || "";
      for (const blk of parts) {
        let data = "";
        for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); }
        if (!data) continue;
        try { const p = JSON.parse(data); if (p.delta) full += p.delta; } catch (e) {}
      }
    }
    return full;
  } catch (e) { return ""; }
}
async function autopilotPick(rid, room) {
  try {
    // 最近发言者（避免连续同一人）
    let lastSpeaker = "";
    for (let i = (room.messages || []).length - 1; i >= 0; i--) {
      if (room.messages[i].kind === "assistant") { lastSpeaker = room.messages[i].from || ""; break; }
    }
    // 过滤掉刚发言的成员，主持人不能选他
    const members = (room.members || []).filter(m => m.key !== "main" && m.key !== lastSpeaker).map(m => m.key + ":" + (m.label || m.key)).join("\n");
    const recent = (room.messages || []).slice(-10).map(m => "- " + (m.label || "成员") + "：" + String(m.text || "").slice(0, 180)).join("\n");
    const sys = "你是多Agent群组讨论的主持人。请认真阅读最近对话，根据讨论进展与各成员专长的相关性，现场决定\"下一个最应该发言\"的成员，并给出他/她推进讨论的下一句话（可提问/补充/质疑/总结）。\n" +
      "选择原则：① 基于上文内容判断谁最相关；② 已排除刚发言过的成员，请从剩余成员中选择；③ 优先选择能补全视角、推进结论的成员。\n" +
      "成员列表(key:角色)：\n" + members + "\n\n最近对话：\n" + recent + "\n\n(刚发言过的成员已排除：" + (lastSpeaker || "无") + ")\n" +
      "只输出JSON：{\"next\":\"成员key\",\"text\":\"下一句话\",\"reason\":\"选择理由(一句话)\"}。若讨论已充分、无需继续，输出{\"next\":\"\",\"text\":\"\",\"reason\":\"\"}。";
    const sid = await _mkRoomSession("autopilot");
    const raw = await _hermesOnce(sid, "【主持人决策】请基于上文现场决定下一位发言人并给出他的话。", sys, room.model || "");
    log(`[autopilotPick] LLM response length: ${raw.length}, preview: ${raw.slice(0, 120)}`);
    // 兼容 markdown 代码块包裹 / 前后废话
    const clean = String(raw || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) { log(`[autopilotPick] 无 JSON 匹配，原文: ${clean.slice(0,150)}`); return null; }
    let j = null;
    try {
      j = JSON.parse(m[0]);
    } catch (e) {
      // 容错：JSON 被 LLM 截断/混入注释时，用正则抽取关键字段
      const nx = m[0].match(/"next"\s*:\s*"([^"]+)"/);
      const tx = m[0].match(/"text"\s*:\s*"([\s\S]*?)"/);
      const rs = m[0].match(/"reason"\s*:\s*"([^"]*)"/);
      if (nx && tx) j = { next: nx[1], text: tx[1], reason: rs ? rs[1] : "" };
      else { log(`[autopilotPick] JSON 解析失败: ${clean.slice(0,150)}`); return null; }
    }
    const next = String(j.next || "").trim();
    const text = String(j.text || "").trim();
    const reason = String(j.reason || "").trim();
    if (!next || !text) { log(`[autopilotPick] next 或 text 为空: next="${next}", text="${text.slice(0,30)}"`); return null; }
    return { next, text, reason };
  } catch (e) { log(`[autopilotPick] 异常:`, e.message); return null; }
}
// ── AI 自主接力引擎（v0.21.143）：单房间单链串行驱动；用户发消息自动触发，主持人现场选角直到讨论自然结束 ──
const ROOM_CHAIN_CAP = 8;        // 每条用户消息默认最多接力轮数（防 Token 消耗）
const ROOM_CHAIN_MAX = 12;       // 硬上限
// 惰性初始化成员 Hermes 会话：首次发言自动注册，无需用户手动 @ 预热
async function ensureMemberSession(rid, member) {
  let sid = member.session_id || "";
  if (!sid) {
    sid = await _mkRoomSession("member");
    if (sid) {
      member.session_id = sid;
      try { saveRooms(); } catch (e) {}
      try {
        const sf = `${VAR_DIR}/chat/sessions/${sid}.json`;
        if (existsSync(sf)) {
          const sd = JSON.parse(readFileSync(sf, "utf8"));
          sd.group = "room_" + String(rid).slice(0, 16);
          writeFileSync(sf, JSON.stringify(sd));
        }
      } catch (e) {}
    }
  }
  return sid;
}
// 主持人选角一轮（失败自动重试一次）；返回 pick 或 null（null=讨论应结束）
async function _hostPick(rid, room) {
  broadcastRoom(rid, { type: "autopilot", active: true, stage: "thinking", remaining: room.autopilot ? room.autopilot.remaining : 0 });
  await new Promise(r => setTimeout(r, 1200));
  let pick = null;
  for (let i = 0; i < 2; i++) {
    pick = await autopilotPick(rid, room);
    log(`[autopilot] 选角#${i + 1}:`, pick ? `${pick.next} - ${pick.reason}` : "null");
    if (pick && pick.next) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  return pick && pick.next ? pick : null;
}
// 单房间接力主循环：串行执行 主持人选角 → 成员发言 → 再选角，直到主持人判定结束/轮数用尽
async function _chainLoop(rid) {
  try {
    for (let guard = 0; guard < ROOM_CHAIN_MAX + 4; guard++) {
      const room = roomsStore.find(x => String(x.id) === String(rid));
      if (!room || !room.autopilot || !room.autopilot.active) return;
      if (room.autopilot.remaining <= 0) {
        // 轮数用尽：正常收尾（active 保持 true，下一条用户消息自动重新开链）
        broadcastRoom(rid, { type: "autopilot", active: false, remaining: 0, done: true });
        return;
      }
      const pick = await _hostPick(rid, room);
      if (!pick) {
        log(`[autopilot] 主持人判定讨论结束（无需继续）`);
        room.autopilot.active = false; room.autopilot.remaining = 0; saveRooms();
        broadcastRoom(rid, { type: "autopilot", active: false, remaining: 0, done: true });
        return;
      }
      room.autopilot.remaining--;
      saveRooms();
      broadcastRoom(rid, { type: "autopilot", active: true, remaining: room.autopilot.remaining, next: pick.next, reason: pick.reason || "" });
      const nm = (room.members || []).find(m => m.key === pick.next);
      if (!nm) { log(`[autopilot] 成员不存在 key=${pick.next}，继续下一轮`); continue; }
      log(`[autopilot] 触发 ${nm.label} 发言（剩余 ${room.autopilot.remaining} 轮）`);
      await new Promise(r => setTimeout(r, 800));
      try {
        await runRoomMember(rid, nm, pick.text, nm.system || "", room.model || "", "", nm.session_id || "");
      } catch (e) {
        log(`[autopilot] ${nm.label} 发言异常:`, e.message);
        broadcastRoom(rid, { type: "err", key: nm.key, label: nm.label || nm.key, error: "自动接力发言失败：" + (e.message || "") });
      }
    }
    // guard 兜底：正常循环由内部 return 结束，走到这里说明轮数逻辑异常，安全收尾
    const room = roomsStore.find(x => String(x.id) === String(rid));
    if (room && room.autopilot) { room.autopilot.active = false; room.autopilot.remaining = 0; saveRooms(); broadcastRoom(rid, { type: "autopilot", active: false, remaining: 0, done: true }); }
  } catch (e) {
    log(`[autopilot] 接力主循环异常:`, e.message);
    try {
      const room = roomsStore.find(x => String(x.id) === String(rid));
      if (room && room.autopilot) { room.autopilot.active = false; room.autopilot.remaining = 0; saveRooms(); }
      broadcastRoom(rid, { type: "err", key: "autopilot", label: "AI 接力", error: e.message || String(e) });
    } catch (e2) {}
  }
}
// 启动/刷新房间接力（幂等：已有链在跑则忽略，避免重复开链）
function _kickRoomChain(rid) {
  const room = roomsStore.find(x => String(x.id) === String(rid));
  if (!room || !room.autopilot || !room.autopilot.active || room.autopilot.remaining <= 0) return;
  if (room._chainBusy) return;
  room._chainBusy = true; // 运行时锁，不落盘（loadRooms 时清除）
  _chainLoop(rid).finally(() => {
    const r2 = roomsStore.find(x => String(x.id) === String(rid));
    if (r2) r2._chainBusy = false;
  });
}

const _roomEnc = new TextEncoder();
// 群聊产物修复：附件对象噪音清理；/tmp 截图 → uploads 可访问 URL；工作区文件路径 → 下载链接
function _fixRoomArtifacts(text) {
  let t = String(text || "");
  try {
    // 0) 附件对象噪音（✿ [object Object] 等）
    t = t.replace(/\[object Object\]/g, "").replace(/[✿🌸📎🖼️]\s*(?=\n|$)/g, "").replace(/\n{3,}/g, "\n\n");
    // 1) /tmp/*.png 截图 → 复制到 uploads/images 并替换引用（浏览器可访问）
    t = t.replace(/!\[([^\]]*)\]\((\/tmp\/[^)\s]+)\)/g, function (m, alt, p) {
      try {
        if (existsSync(p)) {
          const name = String(p).split("/").pop();
          const dest = `${DATA_DIR}/uploads/images/room-${Date.now()}-${name}`;
          try { copyFileSync(p, dest); } catch (e) { return m; }
          return "![" + alt + "](/uploads/images/" + String(dest).split("/").pop() + ")";
        }
      } catch (e) {}
      return m;
    });
    // 2) 工作区/数据目录绝对路径 → 可下载链接（[文件名](/api/download?path=...)）
    const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "");
    t = t.replace(/(\/vol3\/@apphome\/hermes-agent\/data\/(?:workspace|uploads|data)\/[^\s，。；）)\n]+)/g, function (m, p) {
      try {
        if (existsSync(p)) {
          const name = String(p).split("/").pop();
          return "[" + name + "](" + basePath + "/api/download?path=" + encodeURIComponent(p) + ")";
        }
      } catch (e) {}
      return m;
    });
  } catch (e) {}
  return t;
}
function loadRooms() {
  try { roomsStore = JSON.parse(readFileSync(ROOMS_FILE, "utf8") || "[]"); } catch (e) { roomsStore = []; }
  if (!Array.isArray(roomsStore)) roomsStore = [];
  // 运行时锁（_chainBusy）不落盘：进程重启后自动解锁
  try { roomsStore.forEach(r => { delete r._chainBusy; }); } catch (e) {}
  // v0.21.103: 群聊内部会话标记，隔离出主对话列表
  try {
    roomsStore.forEach(r => {
      [r.session_id].concat((r.members || []).map(m => m.session_id)).filter(Boolean).forEach(sid => {
        const sf = `${VAR_DIR}/chat/sessions/${sid}.json`;
        if (existsSync(sf)) {
          try {
            const sd = JSON.parse(readFileSync(sf, "utf8"));
            if (!sd.group) { sd.group = "room_" + r.id; writeFileSync(sf, JSON.stringify(sd)); }
          } catch (e) {}
        }
      });
    });
  } catch (e) {}
}
function saveRooms() { try { writeFileSync(ROOMS_FILE, JSON.stringify(roomsStore, null, 1)); } catch (e) { log("[rooms] save fail", e.message); } }
function roomById(id) { return roomsStore.find(r => String(r.id) === String(id)); }
function broadcastRoom(rid, ev) {
  const set = roomWatchers.get(String(rid));
  if (!set) return;
  const payload = "data: " + JSON.stringify(ev) + "\n\n";
  set.forEach(ctrl => { try { ctrl.enqueue(_roomEnc.encode(payload)); } catch (e) { set.delete(ctrl); } });
}
function pushRoomMsg(rid, msg) {
  const r = roomById(rid); if (!r) return;
  if (!Array.isArray(r.messages)) r.messages = [];
  r.messages.push(msg);
  if (r.messages.length > 500) r.messages = r.messages.slice(-500);
  r.updated_at = Date.now();
  saveRooms();
}
async function runRoomMember(rid, member, text, system, model, provider, sessionId) {
  // 惰性初始化成员 Hermes 会话：首次发言自动注册（根因修复——此前未预热的成员被主持人选中后直接静默失败，接力链中断）
  if (!sessionId) {
    try { sessionId = await ensureMemberSession(rid, member); } catch (e) { sessionId = ""; }
    if (!sessionId) {
      broadcastRoom(rid, { type: "err", key: member.key, label: member.label || member.key, error: "session 初始化失败，请重试" });
      return;
    }
  }
  const sessionIdFinal = sessionId;
  const label = member.label || member.key;
  broadcastRoom(rid, { type: "start", key: member.key, label, session_id: sessionIdFinal });
  let full = "";
  let reasoning = "";
  try {
    const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionIdFinal, message: text, system: system || "", model: model || "", provider: provider || "" }),
      signal: AbortSignal.timeout(600000),
    });
    if (!r.ok || !r.body) throw new Error("stream HTTP " + r.status);
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() || "";
      for (const blk of parts) {
        let data = "";
        for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); }
        if (!data) continue;
        let p; try { p = JSON.parse(data); } catch (e) { continue; }
        if (p.delta) { const _c = String(p.delta).replace(/[object Object]/g, ""); full += _c; broadcastRoom(rid, { type: "delta", key: member.key, label, delta: _c }); }
        else if (p.reasoning && p.reasoning.length) { reasoning += p.reasoning; broadcastRoom(rid, { type: "reasoning", key: member.key, label, reasoning: p.reasoning }); }
        else if (p.tool_progress) { const _t = p.tool_progress || {}; broadcastRoom(rid, { type: "tool", key: member.key, label, tool: String(_t.name || _t.label || _t.command || _t.tool || _t.summary || "") }); }
        else if (p.error) { broadcastRoom(rid, { type: "err", key: member.key, label, error: p.error }); }
      }
    }
    if (!full && reasoning) full = "（思考过程）\n" + reasoning.slice(0, 3000);
    full = _fixRoomArtifacts(full);
    const _mts = Date.now();
    pushRoomMsg(rid, { ts: _mts, kind: "assistant", from: member.key, label, text: full || "(无文本输出)" });
    broadcastRoom(rid, { type: "done", key: member.key, label, text: full, ts: _mts });
    // 每日记忆：对话完成后自动记录当日摘要（memory/YYYY-MM-DD.md）
    try {
      const _d = new Date();
      const _ymd = _d.getFullYear() + "-" + ("0" + (_d.getMonth() + 1)).slice(-2) + "-" + ("0" + _d.getDate()).slice(-2);
      const _mf = `${DATA_DIR}/memory/${_ymd}.md`;
      if (!existsSync(`${DATA_DIR}/memory`)) mkdirSync(`${DATA_DIR}/memory`, { recursive: true });
      const _time = ("0" + _d.getHours()).slice(-2) + ":" + ("0" + _d.getMinutes()).slice(-2);
      const _entry = "\n## " + _time + " · " + (member.label || member.key) + "\n" + String(full || "").slice(0, 200) + "\n";
      if (!existsSync(_mf)) writeFileSync(_mf, "# " + _ymd + "（每日记忆，自动记录）\n");
      appendFileSync(_mf, _entry);
    } catch (e) {}
    // AI 自主接力（DGA）：成员发言完成后自动驱动主持人选下一位（幂等，链锁在 _kickRoomChain 内）
    try {
      _kickRoomChain(rid);
    } catch (e) {
      log(`[autopilot] 接力驱动异常:`, e.message);
    }
  } catch (e) {
    broadcastRoom(rid, { type: "err", key: member.key, label, error: e.message || String(e) });
  }
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
    name: "QQ 机器人 (QQBot)", icon: "🐧", qrLogin: true,
    fields: [
      { env: "QQ_APP_ID", path: "extra.app_id", label: "App ID", placeholder: "q.qq.com 注册应用后获得" },
      { env: "QQ_CLIENT_SECRET", path: "extra.client_secret", label: "Client Secret", placeholder: "...", secret: true },
      { env: "QQ_STT_API_KEY", path: "extra.stt.apiKey", label: "STT 语音转文字 Key (可选)", placeholder: "GLM-ASR 或 Whisper Key", secret: true },
      { env: "QQ_STT_PROVIDER", path: "extra.stt.provider", label: "STT 提供商 (可选)", placeholder: "zai（GLM-ASR）/ openai" },
      { env: "QQ_STT_BASE_URL", path: "extra.stt.baseUrl", label: "STT Base URL (可选)", placeholder: "https://open.bigmodel.cn/api/coding/paas/v4" },
      { env: "QQ_STT_MODEL", path: "extra.stt.model", label: "STT 模型 (可选)", placeholder: "glm-asr" },
      { env: "QQ_APP_ID_2", path: "extra.accounts.1.app_id", label: "机器人2 App ID (可选，多账号)", placeholder: "第二个 QQ 机器人 App ID" },
      { env: "QQ_CLIENT_SECRET_2", path: "extra.accounts.1.client_secret", label: "机器人2 Client Secret (可选)", placeholder: "...", secret: true },
      { env: "QQ_APP_ID_3", path: "extra.accounts.2.app_id", label: "机器人3 App ID (可选)", placeholder: "第三个 QQ 机器人 App ID" },
      { env: "QQ_CLIENT_SECRET_3", path: "extra.accounts.2.client_secret", label: "机器人3 Client Secret (可选)", placeholder: "...", secret: true },
      { env: "QQ_APP_ID_4", path: "extra.accounts.3.app_id", label: "机器人4 App ID (可选)", placeholder: "第四个 QQ 机器人 App ID" },
      { env: "QQ_CLIENT_SECRET_4", path: "extra.accounts.3.client_secret", label: "机器人4 Client Secret (可选)", placeholder: "...", secret: true },
      { env: "QQ_APP_ID_5", path: "extra.accounts.4.app_id", label: "机器人5 App ID (可选)", placeholder: "第五个 QQ 机器人 App ID" },
      { env: "QQ_CLIENT_SECRET_5", path: "extra.accounts.4.client_secret", label: "机器人5 Client Secret (可选)", placeholder: "...", secret: true },
      { env: "QQ_GROUP_ALLOWED_USERS", path: "extra.group_allow_from", label: "群组白名单（逗号分隔群 ID）", placeholder: "group_openid1,group_openid2" },
      { env: "QQ_ALLOWED_USERS", path: "extra.allow_from", label: "私信白名单（逗号分隔）", placeholder: "user_openid1,user_openid2" },
    ],
    toggles: [ { path: "allow_all_users", label: "允许所有用户" }, { path: "qq_markdown", label: "使用 Markdown 消息" } ],
    behavior: [
      { path: "extra.group_policy", label: "群组策略（open=允许所有群 / allowlist=仅白名单 / disabled=禁群消息）", placeholder: "open" },
      { path: "extra.dm_policy", label: "私信策略（open / allowlist / disabled）", placeholder: "open" },
    ],
    note: "QQ 机器人：q.qq.com 注册应用获取 App ID/Secret（支持扫码绑定，一个账号最多 5 个机器人）。群消息需开启「群组 @-消息」intent + 群组策略 open。多账号（机器人2-5）数据已支持录入；多机器人同时在线需 Hermes 适配器多账号改造（规划中）。语音消息优先 QQ 内置 ASR，可配 GLM-ASR。",
  },
  weixin: {
    name: "微信 (WeChat)", icon: "💬",
    qrLogin: true,
    fields: [
      { env: "WEIXIN_TOKEN", path: "token", label: "Token", placeholder: "（扫码登录后自动填入）", secret: true },
      { env: "WEIXIN_ACCOUNT_ID", path: "extra.account_id", label: "Account ID", placeholder: "（扫码登录后自动填入）" },
      { env: "WEIXIN_BASE_URL", path: "extra.base_url", label: "Base URL (可选)", placeholder: "默认 https://ilinkai.weixin.qq.com" },
      { env: "WEIXIN_CDN_BASE_URL", path: "extra.cdn_base_url", label: "CDN Base URL (可选)", placeholder: "默认 https://novac2c.cdn.weixin.qq.com/c2c" },
      { env: "WEIXIN_DM_POLICY", path: "extra.dm_policy", label: "私信策略", placeholder: "open / allowlist / disabled / pairing" },
      { env: "WEIXIN_GROUP_POLICY", path: "extra.group_policy", label: "群组策略", placeholder: "open / allowlist / disabled（默认 disabled）" },
      { env: "WEIXIN_ALLOWED_USERS", path: "extra.allow_from", label: "私信白名单 (逗号分隔)", placeholder: "user_id1,user_id2（dm_policy=allowlist 时生效）" },
      { env: "WEIXIN_GROUP_ALLOWED_USERS", path: "extra.group_allow_from", label: "群组白名单 (逗号分隔群 ID)", placeholder: "group_id1,group_id2（group_policy=allowlist 时生效）" },
      { env: "WEIXIN_HOME_CHANNEL", path: "extra.home_channel", label: "Home Channel (cron/通知投递聊天 ID)", placeholder: "可选" },
      { env: "WEIXIN_HOME_CHANNEL_NAME", path: "extra.home_channel_name", label: "Home Channel 名称", placeholder: "Home" },
    ],
    toggles: [
      { path: "require_mention", label: "需 @提及 才回复" },
      { path: "extra.split_multiline_messages", label: "多行回复拆分为多条消息（旧版行为）" },
    ],
    behavior: [
      { path: "extra.dm_policy", label: "私信策略", placeholder: "open / allowlist / disabled / pairing" },
      { path: "extra.group_policy", label: "群组策略", placeholder: "open / allowlist / disabled" },
    ],
    note: "微信个人号通过腾讯 iLink 扫码登录。支持图片/文件/视频/语音、Markdown、4000 字符分块、AES 加密 CDN。私信默认 open，群组默认 disabled（iLink 限制）。",
  },
  wecom: {
    name: "企业微信 (WeCom)", icon: "💼", qrLogin: true,
    fields: [
      { env: "WECOM_BOT_ID", path: "extra.bot_id", label: "Bot ID", placeholder: "..." },
      { env: "WECOM_SECRET", path: "extra.secret", label: "Secret", placeholder: "...", secret: true },
    ],
    toggles: [ { path: "require_mention", label: "需 @提及 才回复" } ],
  },
  signal: {
    name: "Signal", icon: "🔐",
    fields: [
      { env: "SIGNAL_ACCOUNT", path: "extra.account", label: "Signal 账号/号码", placeholder: "+8613800000000" },
      { env: "SIGNAL_HTTP_URL", path: "extra.http_url", label: "signal-cli REST API URL", placeholder: "http://127.0.0.1:8080" },
      { env: "SIGNAL_ALLOWED_USERS", path: "extra.allowed_users", label: "私信白名单 (逗号分隔)", placeholder: "user_id1,user_id2" },
      { env: "SIGNAL_GROUP_ALLOWED_USERS", path: "extra.group_allowed_users", label: "群组白名单 (逗号分隔)", placeholder: "group1,group2" },
    ],
    toggles: [ { path: "extra.reactions", label: "启用表情反应" }, { path: "extra.require_mention", label: "需 @提及 才回复" } ],
    note: "Signal：需本地 signal-cli 服务（SIGNAL_HTTP_URL）。支持图片/文件/流式输出。",
  },
  yuanbao: {
    name: "腾讯元宝", icon: "🧧",
    fields: [
      { env: "YUANBAO_DM_POLICY", path: "extra.dm_policy", label: "私信策略", placeholder: "open / allowlist / disabled" },
      { env: "YUANBAO_GROUP_POLICY", path: "extra.group_policy", label: "群组策略", placeholder: "open / allowlist / disabled" },
      { env: "YUANBAO_DM_ALLOW_FROM", path: "extra.dm_allow_from", label: "私信白名单", placeholder: "逗号分隔" },
      { env: "YUANBAO_GROUP_ALLOW_FROM", path: "extra.group_allow_from", label: "群组白名单", placeholder: "逗号分隔" },
      { env: "YUANBAO_HOME_CHANNEL", path: "extra.home_channel", label: "Home Channel", placeholder: "cron/通知投递目标" },
    ],
    toggles: [ { path: "extra.allow_all_users", label: "允许所有用户" } ],
    note: "腾讯元宝渠道：支持语音/图片/文件/流式输出。",
  },
  bluebubbles: {
    name: "BlueBubbles (iMessage)", icon: "💬",
    fields: [
      { env: "BLUEBUBBLES_SERVER_URL", path: "extra.server_url", label: "BlueBubbles Server URL", placeholder: "http://127.0.0.1:1234" },
      { env: "BLUEBUBBLES_WEBHOOK_HOST", path: "extra.webhook_host", label: "Webhook Host", placeholder: "0.0.0.0" },
      { env: "BLUEBUBBLES_WEBHOOK_PATH", path: "extra.webhook_path", label: "Webhook Path", placeholder: "/bluebubbles" },
      { env: "BLUEBUBBLES_WEBHOOK_PORT", path: "extra.webhook_port", label: "Webhook Port", placeholder: "8099" },
    ],
    toggles: [ { path: "extra.require_mention", label: "需 @提及 才回复" } ],
    note: "BlueBubbles：通过 BlueBubbles 接入 iMessage，支持图片/文件/表情反应。",
  },
  google_chat: {
    name: "Google Chat", icon: "💬",
    fields: [
      { env: "GOOGLE_CHAT_SERVICE_ACCOUNT", path: "extra.service_account", label: "Service Account JSON 路径", placeholder: "/path/to/service-account.json" },
      { env: "GOOGLE_CHAT_SPACE_ID", path: "extra.space_id", label: "Space ID", placeholder: "spaces/xxx" },
    ],
    note: "Google Chat：需 Google Cloud Service Account。支持图片/文件/线程。以 Hermes 官方文档为准。",
  },
  sms: {
    name: "SMS (Twilio)", icon: "📱",
    fields: [
      { env: "TWILIO_ACCOUNT_SID", path: "extra.account_sid", label: "Twilio Account SID", placeholder: "AC..." },
      { env: "TWILIO_AUTH_TOKEN", path: "extra.auth_token", label: "Twilio Auth Token", placeholder: "...", secret: true },
      { env: "TWILIO_FROM", path: "extra.from_number", label: "发送号码", placeholder: "+1..." },
    ],
    note: "SMS：通过 Twilio 收发短信，基础文本消息。",
  },
  email: {
    name: "Email", icon: "✉️",
    fields: [
      { env: "EMAIL_IMAP_HOST", path: "extra.imap_host", label: "IMAP 服务器", placeholder: "imap.qq.com" },
      { env: "EMAIL_IMAP_PORT", path: "extra.imap_port", label: "IMAP 端口", placeholder: "993" },
      { env: "EMAIL_IMAP_USER", path: "extra.imap_user", label: "IMAP 用户名", placeholder: "you@example.com" },
      { env: "EMAIL_IMAP_PASSWORD", path: "extra.imap_password", label: "IMAP 密码/授权码", placeholder: "...", secret: true },
      { env: "EMAIL_SMTP_HOST", path: "extra.smtp_host", label: "SMTP 服务器", placeholder: "smtp.qq.com" },
      { env: "EMAIL_SMTP_PORT", path: "extra.smtp_port", label: "SMTP 端口", placeholder: "465" },
      { env: "EMAIL_SMTP_USER", path: "extra.smtp_user", label: "SMTP 用户名", placeholder: "you@example.com" },
      { env: "EMAIL_SMTP_PASSWORD", path: "extra.smtp_password", label: "SMTP 密码/授权码", placeholder: "...", secret: true },
    ],
    note: "Email：IMAP 收信 + SMTP 发信，支持图片/文件/线程。",
  },
  mattermost: {
    name: "Mattermost", icon: "🔗",
    fields: [
      { env: "MATTERMOST_SERVER", path: "extra.server", label: "Mattermost 服务器", placeholder: "https://mattermost.example.com" },
      { env: "MATTERMOST_TOKEN", path: "extra.token", label: "访问 Token", placeholder: "...", secret: true },
      { env: "MATTERMOST_TEAM", path: "extra.team", label: "团队名", placeholder: "team" },
      { env: "MATTERMOST_CHANNEL", path: "extra.channel", label: "默认频道", placeholder: "town-square" },
    ],
    note: "Mattermost：支持语音/图片/文件/线程。",
  },
  teams: {
    name: "Microsoft Teams", icon: "🧩",
    fields: [
      { env: "TEAMS_APP_ID", path: "extra.app_id", label: "App ID", placeholder: "..." },
      { env: "TEAMS_APP_PASSWORD", path: "extra.app_password", label: "App Password", placeholder: "...", secret: true },
      { env: "TEAMS_TENANT_ID", path: "extra.tenant_id", label: "Tenant ID", placeholder: "..." },
    ],
    note: "Microsoft Teams：支持图片/线程/输入提示。",
  },
  homeassistant: {
    name: "Home Assistant", icon: "🏠",
    fields: [
      { env: "HOME_ASSISTANT_URL", path: "extra.url", label: "HA 地址", placeholder: "http://homeassistant.local:8123" },
      { env: "HOME_ASSISTANT_TOKEN", path: "extra.token", label: "长期访问 Token", placeholder: "...", secret: true },
    ],
    note: "Home Assistant：集成 HA，并提供 HA 设备控制工具。",
  },
  webhooks: {
    name: "Webhooks", icon: "🔗",
    fields: [
      { env: "WEBHOOK_SECRET", path: "extra.secret", label: "Webhook Secret", placeholder: "...", secret: true },
      { env: "WEBHOOK_PATH", path: "extra.path", label: "Webhook 路径", placeholder: "/webhook" },
    ],
    note: "Webhooks：接收 Webhook 消息，支持完整工具。",
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
  // 用 [ \t] 替代 \s（避免 \s 匹配换行导致空值误读下一行键）；值排除换行
  const m = content.match(new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*=[ \\t]*([^\\n\\r]+)$", "m"));
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

  // ── 群聊（Rooms）路由 ──────────────────────────────────────────────
  if (path === "/api/rooms" && method === "GET") {
    loadRooms();
    return new Response(JSON.stringify({ ok: true, rooms: roomsStore.map(r => ({ id: r.id, title: r.title, created_at: r.created_at, updated_at: r.updated_at, members: r.members, message_count: (r.messages || []).length })) }), { headers: jsonHeaders() });
  }
  if (path === "/api/rooms" && method === "POST") {
    try {
      loadRooms();
      const body = await req.json().catch(() => ({}));
      const id = randomBytes(6).toString("hex");
      const room = {
        id,
        title: String(body.title || "新群聊").slice(0, 60),
        created_at: Date.now(),
        updated_at: Date.now(),
        model: String(body.model || "").slice(0, 80),
        members: Array.isArray(body.members) ? body.members.map(m => ({ key: String(m.key || randomBytes(4).toString("hex")), label: String(m.label || "专家"), emoji: String(m.emoji || "🧠"), persona_id: m.persona_id || "", model: m.model || "" })) : [],
        messages: [],
      };
      roomsStore.unshift(room);
      saveRooms();
      return new Response(JSON.stringify({ ok: true, room }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  const roomsMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(.+))?$/);
  if (roomsMatch) {
    const rid = roomsMatch[1];
    const sub = roomsMatch[2] || "";
    loadRooms();
    const room = roomById(rid);
    if (!room) return new Response(JSON.stringify({ ok: false, error: "room not found" }), { status: 404, headers: jsonHeaders() });
    if (sub === "" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, room }), { headers: jsonHeaders() });
    }
    if (sub === "regenerate" && method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const ts = Number(body.ts || 0);
        if (!ts) return new Response(JSON.stringify({ ok: false, error: "ts required" }), { status: 400, headers: jsonHeaders() });
        const idx = (room.messages || []).findIndex(m => m.ts === ts && m.kind === "assistant");
        if (idx < 0) return new Response(JSON.stringify({ ok: false, error: "message not found" }), { status: 404, headers: jsonHeaders() });
        const msg = room.messages[idx];
        const member = (room.members || []).find(m => m.key === msg.from);
        // 找前面最近一条 user 消息作为重新生成的问题
        let userMsg = "";
        for (let i = idx - 1; i >= 0; i--) { if (room.messages[i].kind === "user") { userMsg = room.messages[i].text || ""; break; } }
        // 删除本条回复（及其后由接力产生的同成员消息），重新触发
        room.messages = room.messages.filter(m => m.ts !== ts);
        saveRooms();
        if (!member || !userMsg) return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: jsonHeaders() });
        broadcastRoom(rid, { type: "user", text: userMsg, ts: Date.now() });
        setTimeout(() => { runRoomMember(rid, member, userMsg, member.system || "", room.model || "", "", member.session_id || ""); }, 400);
        return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
      }
    }
    if (sub === "autopilot" && method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const active = !!body.active;
        let limit = parseInt(body.limit, 10);
        if (!limit || limit < 1) limit = ROOM_CHAIN_CAP;
        if (limit > ROOM_CHAIN_MAX) limit = ROOM_CHAIN_MAX;
        room.autopilot = { active, remaining: active ? limit : 0, limit, auto: !!body.auto };
        saveRooms();
        broadcastRoom(rid, { type: "autopilot", active, remaining: room.autopilot.remaining, limit });
        // 开启接力时自动驱动主持人选角（无需用户 @，直接开链）
        if (active && room.autopilot.remaining > 0) _kickRoomChain(rid);
        return new Response(JSON.stringify({ ok: true, autopilot: room.autopilot }), { headers: jsonHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
      }
    }
    if (sub === "" && method === "DELETE") {
      roomsStore = roomsStore.filter(r => String(r.id) !== String(rid));
      saveRooms();
      broadcastRoom(rid, { type: "closed" });
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }
    if (sub === "members" && method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body.members)) {
          body.members.forEach(m => {
            const key = String(m.key || randomBytes(4).toString("hex"));
            if (!room.members.find(x => x.key === key)) room.members.push({ key, label: String(m.label || "专家"), emoji: String(m.emoji || "🧠"), persona_id: m.persona_id || "", model: m.model || "" });
          });
          saveRooms();
          broadcastRoom(rid, { type: "members", members: room.members });
        }
        return new Response(JSON.stringify({ ok: true, room }), { headers: jsonHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
      }
    }
    if (sub === "send" && method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        const text = String(body.text || "").trim();
        if (!text) return new Response(JSON.stringify({ ok: false, error: "text required" }), { status: 400, headers: jsonHeaders() });
        pushRoomMsg(rid, { ts: Date.now(), kind: "user", from: "me", label: "我", text });
        broadcastRoom(rid, { type: "user", text, ts: Date.now() });
        // 用户消息自动沉淀到房间共享记忆（共识/需求，后续成员会话可见）
        try {
          if (!Array.isArray(room.shared_memory)) room.shared_memory = [];
          room.shared_memory.push({ text: ("用户：" + text).slice(0, 300), from: "自动", ts: Date.now() });
          if (room.shared_memory.length > 100) room.shared_memory = room.shared_memory.slice(-100);
          saveRooms();
        } catch (e) {}
        // 全自动模式（默认）：用户发消息即自动开启专家接力，主持人现场选角，无需手动 @ / 手动开启
        // 若用户显式 @，先让被 @ 成员回复，回复完成后接力链自动继续
        let targets;
        if (Array.isArray(body.at) && body.at.length) {
          targets = body.at;
        } else if (!(room.members || []).some(m => m.key !== "main")) {
          targets = [{ key: "main", label: "Hermes", emoji: "🤖", system: "", model: room.model || "", provider: "" }]; // 无专家成员时退回主会话
        } else {
          targets = []; // 无 @ → 主持人直接选角开链
        }
        // 刷新接力轮数：任何用户消息都让讨论保持活跃（主持人判定结束后，下一条消息自动重新开启）
        try {
          const cap = Math.min(parseInt(room.auto_limit || String(ROOM_CHAIN_CAP), 10) || ROOM_CHAIN_CAP, ROOM_CHAIN_MAX);
          if (!room.autopilot || !room.autopilot.active) {
            room.autopilot = { active: true, remaining: cap, limit: cap, auto: true };
          } else {
            room.autopilot.remaining = Math.max(room.autopilot.remaining, cap);
          }
          saveRooms();
          broadcastRoom(rid, { type: "autopilot", active: true, remaining: room.autopilot.remaining, reason: "自动接力已开启" });
        } catch (e) {}
        // 房间上下文（DAG 式衔接：最近成员回复 + 共享记忆，让被 @ 成员了解全貌）
        let roomCtx = "";
        try {
          const parts = [];
          const recent = (room.messages || []).filter(m => m.kind === "assistant").slice(-3);
          if (recent.length) {
            parts.push("## 房间近期其他成员回复（参考上下文）\n" + recent.map(m => "- " + (m.label || "成员") + "：" + String(m.text || "").slice(0, 200)).join("\n"));
          }
          const mems = (room.shared_memory || []).slice(-10);
          if (mems.length) {
            parts.push("## 房间共享记忆（用户需求/共识）\n" + mems.map(m => "- " + (m.from || "") + "：" + String(m.text || "").slice(0, 200)).join("\n"));
          }
          roomCtx = parts.join("\n\n");
        } catch (e) {}
        if (!targets.length) {
          // 全自动：主持人自动选第一个专家（无需用户 @ / 无需手动开启接力）
          _kickRoomChain(rid);
        } else {
        targets.forEach(t => {
          const member = room.members.find(m => String(m.key) === String(t.key)) || { key: String(t.key || "main"), label: String(t.label || "Hermes"), emoji: "🤖", persona_id: "", model: "" };
          const sys = [t.system || (member.persona_id ? "" : ""), roomCtx].filter(Boolean).join("\n\n");
          const model = t.model || member.model || room.model || "";
          const provider = t.provider || "";
          // 首次发送时注册 Hermes 会话（monitor /api/sessions 生成 id，存成员上续用）
          let sid = member.key === "main" ? (room.session_id || "") : (member.session_id || "");
          const mkSid = () => fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000),
          }).then(r => r.json()).then(j => j.id || "").catch(() => "");
          (async () => {
            if (!sid) {
              sid = await mkSid();
              if (member.key === "main") room.session_id = sid; else member.session_id = sid;
              saveRooms();
              try {
                const sf = `${VAR_DIR}/chat/sessions/${sid}.json`;
                if (existsSync(sf)) {
                  const sd = JSON.parse(readFileSync(sf, "utf8"));
                  sd.group = "room_" + rid;
                  writeFileSync(sf, JSON.stringify(sd));
                }
              } catch (e) {}
            }
            runRoomMember(rid, member, text, sys, model, provider, sid);
          })();
        });
        }
        return new Response(JSON.stringify({ ok: true, targets: targets.map(t => t.key), autopilot: room.autopilot }), { headers: jsonHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
      }
    }
    if (sub === "events" && method === "GET") {
      // SSE 事件流：房间实时广播（等价 Socket.IO 群聊，零依赖）
      const stream = new ReadableStream({
        start(controller) {
          let set = roomWatchers.get(String(rid));
          if (!set) { set = new Set(); roomWatchers.set(String(rid), set); }
          set.add(controller);
          controller.enqueue(_roomEnc.encode("retry: 3000\n\n"));
          const close = () => { set.delete(controller); };
          req.signal && req.signal.addEventListener ? req.signal.addEventListener("abort", close) : setTimeout(close, 300000);
        },
        cancel() {
          const set = roomWatchers.get(String(rid));
          if (set) set.delete(this);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // ── Trace / 轨迹（L1：运行事件流，由 monitor 埋点写入 trace.jsonl） ───────────
  if (path === "/api/trace" && method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const limit = Math.min(parseInt(u.searchParams.get("limit") || "200", 10) || 200, 1000);
      const traceFile = `${DATA_DIR}/trace.jsonl`;
      const events = [];
      if (existsSync(traceFile)) {
        const lines = readFileSync(traceFile, "utf8").split("\n").filter(Boolean);
        for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
          try { events.push(JSON.parse(lines[i])); } catch (e) {}
        }
      }
      events.reverse(); // 最新在前
      return new Response(JSON.stringify({ ok: true, total: events.length, events }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // 技能使用统计（monitor 埋点写 skill_usage.jsonl；此处聚合）
  if (path === "/api/skills/usage" && method === "GET") {
    try {
      const u = new URL(req.url, "http://localhost");
      const limit = Math.min(parseInt(u.searchParams.get("limit") || "500", 10) || 500, 2000);
      const usageFile = `${DATA_DIR}/skill_usage.jsonl`;
      const records = [];
      if (existsSync(usageFile)) {
        const lines = readFileSync(usageFile, "utf8").split("\n").filter(Boolean);
        for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
          try { records.push(JSON.parse(lines[i])); } catch (e) {}
        }
      }
      // 聚合：技能名 → {count, last_ts, sessions:[]}
      const agg = {};
      records.forEach(r => {
        const name = r.skill || "unknown";
        if (!agg[name]) agg[name] = { skill: name, count: 0, last_ts: 0, sessions: [] };
        agg[name].count++;
        if (r.ts > agg[name].last_ts) agg[name].last_ts = r.ts;
        if (r.session_id && !agg[name].sessions.includes(r.session_id)) agg[name].sessions.push(r.session_id);
      });
      const list = Object.values(agg).sort((a, b) => b.count - a.count);
      return new Response(JSON.stringify({ ok: true, total: records.length, skills: list, recent: records.slice(-30).reverse() }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 评测（L7：模型冒烟测试 + 用例评测） ────────────────────────────────
  const smokeCases = [
    { name: "基础回复", prompt: "只回复两个字：正常", check: "正常" },
    { name: "中文理解", prompt: "中国的首都是哪个城市？一句话回答", check: "" },
    { name: "数学推理", prompt: "17 × 23 = ? 只输出数字", check: "" },
    { name: "代码生成", prompt: "用 Python 写一个返回两数之和的函数，只输出代码", check: "" },
    { name: "指令遵循", prompt: "列出三种水果，用顿号分隔，不要其他内容", check: "" },
  ];
  if (path === "/api/eval/smoke" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const model = String(body.model || "").trim();
      const provider = String(body.provider || "").trim();
      if (!model) return new Response(JSON.stringify({ ok: false, error: "model required" }), { status: 400, headers: jsonHeaders() });
      // 创建临时会话跑用例
      const sres = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000),
      }).then(r => r.json()).catch(() => null);
      if (!sres || !sres.id) return new Response(JSON.stringify({ ok: false, error: "无法创建测试会话" }), { status: 500, headers: jsonHeaders() });
      const results = [];
      for (const c of smokeCases) {
      let sid = sres.id;
        if (results.length > 0) {
          try {
            const sr2 = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
            if (sr2 && sr2.id) sid = sr2.id;
          } catch (e) {}
        }
        const t0 = Date.now();
        let out = "";
        let err = "";
        try {
          const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, message: c.prompt, system: "", model, provider }),
            signal: AbortSignal.timeout(60000),
          });
          if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
          const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
          while (true) {
            const { done, value } = await rd.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n"); buf = parts.pop() || "";
            for (const blk of parts) {
              let data = "";
              for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); }
              if (!data) continue;
              try { const p = JSON.parse(data); if (p.delta) out += p.delta; else if (p.error) err = p.error; } catch (e) {}
            }
          }
        } catch (e) { err = e.message || String(e); }
        const latency = Date.now() - t0;
        const passed = !err && out.trim().length > 0 && (!c.check || out.includes(c.check));
        results.push({ name: c.name, passed, latency_ms: latency, output: (out || "").slice(0, 120), error: err });
      }
      // 清理测试会话
      try { await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }); } catch (e) {}
      const passedCount = results.filter(r => r.passed).length;
      return new Response(JSON.stringify({ ok: true, model, provider, pass_rate: Math.round(passedCount / results.length * 100), passed: passedCount, total: results.length, results }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  // 评测用例集（前端定义 cases，后端执行）
  if (path === "/api/eval/run" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const model = String(body.model || "").trim();
      const cases = Array.isArray(body.cases) ? body.cases.slice(0, 20) : [];
      if (!model || !cases.length) return new Response(JSON.stringify({ ok: false, error: "model and cases required" }), { status: 400, headers: jsonHeaders() });
      const sres = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
      if (!sres || !sres.id) return new Response(JSON.stringify({ ok: false, error: "无法创建测试会话" }), { status: 500, headers: jsonHeaders() });
      const results = [];
      for (const c of cases) {
      let sid = sres.id;
        if (results.length > 0) {
          try {
            const sr2 = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
            if (sr2 && sr2.id) sid = sr2.id;
          } catch (e) {}
        }
        const t0 = Date.now(); let out = ""; let err = "";
        try {
          const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, message: c.prompt, system: c.system || "", model, provider: body.provider || "" }),
            signal: AbortSignal.timeout(60000),
          });
          if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
          const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
          while (true) {
            const { done, value } = await rd.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n"); buf = parts.pop() || "";
            for (const blk of parts) {
              let data = "";
              for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); }
              if (!data) continue;
              try { const p = JSON.parse(data); if (p.delta) out += p.delta; else if (p.error) err = p.error; } catch (e) {}
            }
          }
        } catch (e) { err = e.message || String(e); }
        const latency = Date.now() - t0;
        const want = c.expect || "";
        results.push({ name: c.name || c.prompt.slice(0, 30), passed: !err && out.trim().length > 0 && (!want || out.includes(want)), latency_ms: latency, output: (out || "").slice(0, 120), error: err });
      }
      try { await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }); } catch (e) {}
      const passedCount = results.filter(r => r.passed).length;
      return new Response(JSON.stringify({ ok: true, model, pass_rate: Math.round(passedCount / results.length * 100), passed: passedCount, total: results.length, results }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 工作流（L2：DAG 步骤编排，执行器调 /api/chat/stream） ──────────────
  const FLOWS_DIR = `${DATA_DIR}/flows`;
  function _loadFlows() { try { if (!existsSync(FLOWS_DIR)) mkdirSync(FLOWS_DIR, { recursive: true }); const out = []; readdirSync(FLOWS_DIR).filter(f => f.endsWith(".json")).forEach(f => { try { out.push(JSON.parse(readFileSync(`${FLOWS_DIR}/${f}`, "utf8"))); } catch (e) {} }); return out; } catch (e) { return []; } }
  function _saveFlow(flow) { try { if (!existsSync(FLOWS_DIR)) mkdirSync(FLOWS_DIR, { recursive: true }); writeFileSync(`${FLOWS_DIR}/${flow.id}.json`, JSON.stringify(flow, null, 1)); } catch (e) { log("[flow] save fail", e.message); } }
  function _flowById(id) { return _loadFlows().find(f => String(f.id) === String(id)) || null; }
  async function _runFlowStep(step, inputs, flow) {
    const sessionId = `flow_${flow.id}_${step.name}`;
    const model = step.model || flow.model || "";
    const provider = step.provider || "";
    const system = [step.system || "", inputs.length ? "## 上游步骤输出\n" + inputs.join("\n\n") : ""].filter(Boolean).join("\n\n");
    let out = ""; let err = "";
    const t0 = Date.now();
    try {
      // 确保会话存在
      const sres = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
      const sid = (sres && sres.id) || sessionId;
      const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, message: step.prompt, system, model, provider }),
        signal: AbortSignal.timeout(300000),
      });
      if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const blk of parts) {
          let data = "";
          for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); }
          if (!data) continue;
          try { const p = JSON.parse(data); if (p.delta) out += p.delta; else if (p.error) err = p.error; } catch (e) {}
        }
      }
    } catch (e) { err = e.message || String(e); }
    return { name: step.name, status: err ? "failed" : "success", output: out, error: err, latency_ms: Date.now() - t0, session_id: sessionId };
  }
  if (path === "/api/flows" && method === "GET") {
    try {
      const flows = _loadFlows().map(f => ({ id: f.id, name: f.name, created_at: f.created_at, status: f.status || "idle", steps: (f.steps || []).map(s => ({ name: s.name, depends_on: s.depends_on || [], status: (f.results || {})[s.name] ? (f.results[s.name].status) : "pending" })) }));
      return new Response(JSON.stringify({ ok: true, flows }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  if (path === "/api/flows" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!Array.isArray(body.steps) || !body.steps.length) return new Response(JSON.stringify({ ok: false, error: "steps required" }), { status: 400, headers: jsonHeaders() });
      const id = randomBytes(6).toString("hex");
      const flow = {
        id, name: String(body.name || "新工作流").slice(0, 60), created_at: Date.now(),
        model: body.model || "", provider: body.provider || "",
        steps: body.steps.map(s => ({ name: String(s.name || "步骤").slice(0, 40), prompt: String(s.prompt || ""), system: s.system || "", depends_on: Array.isArray(s.depends_on) ? s.depends_on : [], model: s.model || "", provider: s.provider || "" })),
        status: "idle", results: {}, started_at: null, finished_at: null,
      };
      _saveFlow(flow);
      return new Response(JSON.stringify({ ok: true, flow }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  const flowMatch = path.match(/^\/api\/flows\/([^/]+)(?:\/(.+))?$/);
  if (flowMatch) {
    const fid = flowMatch[1]; const fsub = flowMatch[2] || "";
    const flow = _flowById(fid);
    if (!flow) return new Response(JSON.stringify({ ok: false, error: "flow not found" }), { status: 404, headers: jsonHeaders() });
    if (fsub === "" && method === "GET") return new Response(JSON.stringify({ ok: true, flow }), { headers: jsonHeaders() });
    if (fsub === "" && method === "DELETE") {
      try { unlinkSync(`${FLOWS_DIR}/${flow.id}.json`); } catch (e) {}
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders() });
    }
    if (fsub === "run" && method === "POST") {
      (async () => {
        try {
          flow.status = "running"; flow.started_at = Date.now(); flow.results = {};
          _saveFlow(flow);
          const pending = flow.steps.slice();
          let guard = 0;
          while (pending.length && guard++ < 200) {
            const ready = pending.filter(s => (s.depends_on || []).every(d => flow.results[d] && flow.results[d].status === "success"));
            if (!ready.length) { pending.forEach(s => { if (!flow.results[s.name]) flow.results[s.name] = { name: s.name, status: "blocked", output: "", error: "依赖步骤未成功" }; }); break; }
            const batch = [];
            for (const s of ready) {
              const deps = (s.depends_on || []).map(d => flow.results[d] ? flow.results[d].output : "").filter(Boolean);
              batch.push(_runFlowStep(s, deps, flow).then(res => { flow.results[res.name] = res; }));
              pending.splice(pending.indexOf(s), 1);
            }
            await Promise.all(batch);
            _saveFlow(flow);
          }
          flow.status = Object.values(flow.results).some(r => r.status === "failed") ? "failed" : "done";
          flow.finished_at = Date.now();
          _saveFlow(flow);
          broadcastRoom("", null);
        } catch (e) { flow.status = "error"; flow.error = e.message; _saveFlow(flow); }
      })();
      return new Response(JSON.stringify({ ok: true, message: "flow started" }), { headers: jsonHeaders() });
    }
  }

  // ── 记忆深化（C2：daily 分层 + Deep Dream 蒸馏 + 反思候选） ────────────
  const MEM_DIR = `${DATA_DIR}/memory`;
  if (path === "/api/memory/daily" && method === "GET") {
    try {
      const files = [];
      if (existsSync(MEM_DIR)) {
        readdirSync(MEM_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().forEach(f => {
          try { files.push({ date: f.slice(0, 10), path: f, content: readFileSync(`${MEM_DIR}/${f}`, "utf8").slice(0, 2000) }); } catch (e) {}
        });
      }
      files.reverse();
      return new Response(JSON.stringify({ ok: true, files }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  if (path === "/api/memory/daily" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const d = body.date || new Date().toISOString().slice(0, 10);
      const file = `${MEM_DIR}/${d}.md`;
      if (!existsSync(MEM_DIR)) mkdirSync(MEM_DIR, { recursive: true });
      const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
      const content = String(body.content || "").trim();
      writeFileSync(file, existing ? existing + "\n" + content + "\n" : "# " + d + "\n\n" + content + "\n");
      return new Response(JSON.stringify({ ok: true, date: d }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  if (path === "/api/memory/curator/run" && method === "POST") {
    try {
      // 手动触发 Curator 自进化（hermes curator run），后台执行
      const bin = `${DATA_DIR}/venv/bin/hermes`;
      if (!existsSync(bin)) return new Response(JSON.stringify({ ok: false, error: "hermes bin not found" }), { status: 500, headers: jsonHeaders() });
      const proc = spawn(bin, ["curator", "run"], { stdio: "ignore", env: { ...process.env, HERMES_HOME: DATA_DIR }, detached: true });
      proc.unref();
      return new Response(JSON.stringify({ ok: true, started: true }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }
  if (path === "/api/memory/distill" && method === "POST") {
    try {
      // Deep Dream 蒸馏：LLM 合并 MEMORY.md + 最近 14 天 daily → 备份 + 覆写 MEMORY.md
      const body = await req.json().catch(() => ({}));
      const model = String(body.model || "").trim() || "sensenova-6.7-flash-lite";
      const provider = String(body.provider || "").trim() || "sensenova";
      let memory = ""; try { memory = readFileSync(`${DATA_DIR}/MEMORY.md`, "utf8"); } catch (e) {}
      const dailies = [];
      if (existsSync(MEM_DIR)) {
        readdirSync(MEM_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-14).forEach(f => {
          try { dailies.push("### " + f + "\n" + readFileSync(`${MEM_DIR}/${f}`, "utf8").slice(0, 6000)); } catch (e) {}
        });
      }
      const prompt = "你是记忆整理助手。合并以下长期记忆与最近日记，输出精简后的 MEMORY.md（保留重要事实/偏好/教训，去重去噪，用中文，条目用 § 分隔）。\n\n## 现有 MEMORY.md\n" + (memory || "(空)") + "\n\n## 最近日记\n" + (dailies.join("\n") || "(空)");
      const sres = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
      if (!sres || !sres.id) return new Response(JSON.stringify({ ok: false, error: "无法创建蒸馏会话" }), { status: 500, headers: jsonHeaders() });
      let out = "";
      const r = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sres.id, message: prompt, system: "", model, provider }),
        signal: AbortSignal.timeout(300000),
      });
      if (r.ok && r.body) {
        const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const parts = buf.split("\n\n"); buf = parts.pop() || ""; for (const blk of parts) { let data = ""; for (const line of blk.split("\n")) { if (line.startsWith("data:")) data = line.slice(5).trim(); } if (!data) continue; try { const p = JSON.parse(data); if (p.delta) out += p.delta; } catch (e) {} } }
      }
      try { await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/sessions/${encodeURIComponent(sres.id)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }); } catch (e) {}
      if (!out.trim()) return new Response(JSON.stringify({ ok: false, error: "蒸馏无输出" }), { status: 500, headers: jsonHeaders() });
      // 备份 + 覆写
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      try { writeFileSync(`${DATA_DIR}/MEMORY.md.distill-bak-${ts}`, memory); } catch (e) {}
      writeFileSync(`${DATA_DIR}/MEMORY.md`, out.trim() + "\n");
      if (!existsSync(MEM_DIR)) mkdirSync(MEM_DIR, { recursive: true });
      writeFileSync(`${MEM_DIR}/dreams-${new Date().toISOString().slice(0, 10)}.md`, "## Deep Dream " + new Date().toLocaleString() + "\n\n" + out, { flag: "a" });
      return new Response(JSON.stringify({ ok: true, backup: `MEMORY.md.distill-bak-${ts}`, distilled: out.slice(0, 300) }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  // 自进化记录（C4：curator 报告 + evolution 日志）
  if (path === "/api/evolution" && method === "GET") {
    try {
      const reports = [];
      const curatorRoot = `${DATA_DIR}/skills/.curator_state`;
      const curatorInfo = existsSync(curatorRoot) ? readFileSync(curatorRoot, "utf8").slice(0, 500) : "";
      if (existsSync(MEM_DIR)) {
        readdirSync(MEM_DIR).filter(f => f.startsWith("evolution") || f.startsWith("dreams")).sort().slice(-10).forEach(f => {
          try { reports.push({ file: f, content: readFileSync(`${MEM_DIR}/${f}`, "utf8").slice(0, 800) }); } catch (e) {}
        });
      }
      return new Response(JSON.stringify({ ok: true, curator_state: curatorInfo, reports: reports.reverse() }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }

  // ── 知识库收录记忆：把 Hermes 记忆沉淀进 knowledge/ 目录 ─────────────
  if (path === "/api/kb/import-memory" && method === "POST") {
    try {
      const kbRoot = `${DATA_DIR}/knowledge`;
      const memDir = `${kbRoot}/记忆`;
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
      const imported = [];
      const files = [
        { src: `${DATA_DIR}/MEMORY.md`, name: "长期记忆-MEMORY.md" },
        { src: `${DATA_DIR}/USER.md`, name: "用户画像-USER.md" },
        { src: `${DATA_DIR}/notes.md`, name: "笔记-notes.md" },
      ];
      files.forEach(f => {
        try {
          if (existsSync(f.src)) { copyFileSync(f.src, `${memDir}/${f.name}`); imported.push(f.name); }
        } catch (e) {}
      });
      const memDir2 = `${DATA_DIR}/memory`;
      if (existsSync(memDir2)) {
        readdirSync(memDir2).filter(f => f.endsWith(".md") && !f.startsWith("dreams") && !f.startsWith("evolution")).sort().slice(-10).forEach(f => {
          try { copyFileSync(`${memDir2}/${f}`, `${memDir}/daily-${f}`); imported.push("daily-" + f); } catch (e) {}
        });
      }
      return new Response(JSON.stringify({ ok: true, imported, dir: "knowledge/记忆/" }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // ── 知识图谱（C3：解析 kb markdown 互链） ─────────────────────────────
  if (path === "/api/kb/graph" && method === "GET") {    try {
      const root = (function () {
        // 复用 monitor 的 kb 根目录逻辑：优先 DATA_DIR/knowledge，回退 DATA_DIR
        const candidates = [`${DATA_DIR}/knowledge`, `${DATA_DIR}/kb`];
        for (const c of candidates) if (existsSync(c)) return c;
        return `${DATA_DIR}/knowledge`;
      })();
      const nodes = []; const links = []; const nodeSet = new Set(); const linkSet = new Set();
      function walk(dir, prefix) {
        let items = [];
        try { items = readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        items.filter(e => !e.name.startsWith(".")).forEach(e => {
          const rel = prefix ? prefix + "/" + e.name : e.name;
          if (e.isDirectory()) walk(`${dir}/${e.name}`, rel);
          else if (e.name.toLowerCase().endsWith(".md")) {
            const id = rel.replace(/\.md$/i, "");
            if (!nodeSet.has(id)) { nodeSet.add(id); nodes.push({ id, label: e.name.replace(/\.md$/i, ""), category: prefix.split("/")[0] || "root" }); }
            let content = ""; try { content = readFileSync(`${dir}/${e.name}`, "utf8"); } catch (err) {}
            const re = /\[[^\]]*\]\(([^)#]+\.md)/g; let m;
            while ((m = re.exec(content)) !== null) {
              const target = m[1].replace(/\.md$/i, "").replace(/^\.\//, "").split("/").pop();
              if (!nodeSet.has(target)) { nodeSet.add(target); nodes.push({ id: target, label: target, category: "link" }); }
              const key = id + "->" + target;
              if (!linkSet.has(key)) { linkSet.add(key); links.push({ source: id, target }); }
            }
          }
        });
      }
      if (existsSync(root)) walk(root, "");
      return new Response(JSON.stringify({ ok: true, root, nodes: nodes.slice(0, 300), links: links.slice(0, 600) }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }

  // ── Guardrails（L3：隐私/敏感工具/脱敏配置） ──────────────────────────
  const GUARDRAILS_FILE = `${DATA_DIR}/guardrails.json`;
  if (path === "/api/guardrails" && method === "GET") {
    try {
      let cfg = {};
      try { cfg = JSON.parse(readFileSync(GUARDRAILS_FILE, "utf8") || "{}"); } catch (e) {}
      const yml = _readHermesConfig();
      cfg.hermes_redact_secrets = /redact_secrets:\s*true/.test(yml);
      cfg.hermes_allow_private = /allow_private_urls:\s*true/.test(yml);
      return new Response(JSON.stringify({ ok: true, config: cfg }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }
  if (path === "/api/guardrails" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const cfg = { privacy: !!body.privacy, sensitive_tools: Array.isArray(body.sensitive_tools) ? body.sensitive_tools : [], redact_output: !!body.redact_output, updated_at: Date.now() };
      writeFileSync(GUARDRAILS_FILE, JSON.stringify(cfg, null, 1), { mode: 0o600 });
      return new Response(JSON.stringify({ ok: true, config: cfg }), { headers: jsonHeaders() });
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }

  // ── 房间共享记忆（L5：追加式共享池，成员会话注入只读快照） ────────────
  if (roomsMatch) {
    const ridM = roomsMatch[1]; const subM = roomsMatch[2] || "";
    if (subM === "memory" && method === "GET") {
      const room = roomById(ridM);
      if (!room) return new Response(JSON.stringify({ ok: false, error: "room not found" }), { status: 404, headers: jsonHeaders() });
      return new Response(JSON.stringify({ ok: true, memories: room.shared_memory || [] }), { headers: jsonHeaders() });
    }
    if (subM === "memory" && method === "POST") {
      const room = roomById(ridM);
      if (!room) return new Response(JSON.stringify({ ok: false, error: "room not found" }), { status: 404, headers: jsonHeaders() });
      const body = await req.json().catch(() => ({}));
      const text = String(body.text || "").trim();
      if (!text) return new Response(JSON.stringify({ ok: false, error: "text required" }), { status: 400, headers: jsonHeaders() });
      if (!Array.isArray(room.shared_memory)) room.shared_memory = [];
      room.shared_memory.push({ text: text.slice(0, 500), from: String(body.from || "user").slice(0, 40), ts: Date.now() });
      if (room.shared_memory.length > 200) room.shared_memory = room.shared_memory.slice(-200);
      saveRooms();
      return new Response(JSON.stringify({ ok: true, count: room.shared_memory.length }), { headers: jsonHeaders() });
    }
  }

  // ── 连接器测试（O4） ─────────────────────────────────────────────────
  if (path === "/api/connectors/test" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const kind = String(body.kind || "").trim();
      // 动态 import connectors.js 的函数（避免顶层依赖）
      try {
        const mod = await import("./connectors.js");
        const cat = (mod.CONNECTOR_CATALOG || []).find(c => c.kind === kind);
        if (!cat) return new Response(JSON.stringify({ ok: false, error: "unknown connector: " + kind }), { status: 404, headers: jsonHeaders() });
        const probe = mod.probeConnector || mod.getConnector;
        let result = null;
        if (typeof probe === "function") { try { result = await probe(kind, body.config || {}); } catch (e) { result = { ok: false, error: e.message }; } }
        return new Response(JSON.stringify({ ok: true, kind, name: cat.name, phase: cat.phase, mcp_mode: cat.mcp_mode, probe: result, note: result && result.ok ? "连接成功" : (cat.auth_hint || "需配置凭证") }), { headers: jsonHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: "connectors 模块不可用: " + e.message }), { status: 500, headers: jsonHeaders() });
      }
    } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() }); }
  }

  // ── 模型添加全链路同步（P0 核心：providers-state.yaml → Hermes config.yaml + .env） ──
  function _upsertYamlBlock(yml, key, blockLines) {
    // 替换或插入顶层键 blockLines（含缩进）；找不到则追加
    const re = new RegExp(`^${key}:[\\s\\S]*?(?=^[a-zA-Z_][a-zA-Z0-9_]*:\\s*$|\\n\\S)`, "m");
    if (re.test(yml)) {
      return yml.replace(re, blockLines.join("\n") + "\n");
    }
    return yml.replace(/\n?$/, "\n") + blockLines.join("\n") + "\n";
  }
  function _readEnvFile() { try { return readFileSync(HERMES_ENV, "utf8"); } catch (e) { return ""; } }
  function _writeEnvKey(env, key, value) {
    const re = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    if (re.test(env)) return env.replace(re, line);
    return env.replace(/\n?$/, "\n") + line + "\n";
  }
  if (path === "/api/config/sync" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const providers = Array.isArray(body.providers) ? body.providers : [];
      const activeId = String(body.active_provider_id || body.active_provider || "").trim();
      if (!providers.length) return new Response(JSON.stringify({ ok: false, error: "providers required" }), { status: 400, headers: jsonHeaders() });
      // 目标配置：profile（运行时真实生效）+ 顶层（面板一致）
      let _profileDir = "";
      try {
        const ap = readFileSync(`${DATA_DIR}/.active_profile`, "utf8").trim();
        if (ap && existsSync(`${DATA_DIR}/profiles/${ap}`)) _profileDir = `${DATA_DIR}/profiles/${ap}`;
      } catch (e) {}
      const targetConfigs = _profileDir ? [_profileDir + "/config.yaml", HERMES_CONFIG] : [HERMES_CONFIG];
      const targetEnvs = _profileDir ? [_profileDir + "/.env", HERMES_ENV] : [HERMES_ENV];
      // 1) 构建 Hermes config.yaml 的 providers 段 + 收集 env keys
      const provLines = ["providers:"];
      const envPairs = [];
      let hermesActiveId = activeId;
      let hermesActiveModel = "";
      providers.forEach(p => {
        const id = String(p.id || "").trim() || ("custom_" + String(p.name || "p").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 12));
        const model = String(p.model || "auto").trim();
        const baseUrl = String(p.base_url || "").trim();
        const keyEnv = `CUSTOM_${id.toUpperCase()}_API_KEY`;
        if (baseUrl) {
          provLines.push(`  ${id}:`);
          provLines.push(`    base_url: ${baseUrl}`);
          provLines.push(`    api_key: \${${keyEnv}}`);
          provLines.push(`    default_model: ${model}`);
        }
        if (p.api_key && String(p.api_key).length > 4 && !String(p.api_key).startsWith("****")) {
          envPairs.push({ keyEnv, value: String(p.api_key) });
        }
        if (String(p.name || p.id) === activeId || String(p.id) === activeId) {
          hermesActiveId = id;
          hermesActiveModel = model;
        }
      });
      // 2) 更新 config.yaml（备份 → 替换 providers 段 + model 段）——每个目标都写
      const backups = [];
      targetConfigs.forEach(cfgPath => {
        let yml = "";
        try { yml = readFileSync(cfgPath, "utf8"); } catch (e) { return; }
        const bak = `${cfgPath}.sync-bak-${Date.now()}`;
        try { writeFileSync(bak, yml); backups.push(bak); } catch (e) {}
        yml = _upsertYamlBlock(yml, "providers", provLines);
        const modelBlock = [`model:`, `  provider: ${hermesActiveId || "default"}`, `  default: ${hermesActiveModel || "auto"}`];
        yml = _upsertYamlBlock(yml, "model", modelBlock);
        yml = yml.replace(/^fallback_providers:[\s\S]*?(?=^[a-zA-Z_][a-zA-Z0-9_]*:\s*$)/m, "fallback_providers: []\n");
        try { writeFileSync(cfgPath, yml); } catch (e) {}
      });
      // 3) 更新 .env keys
      targetEnvs.forEach(envPath => {
        let env = "";
        try { env = readFileSync(envPath, "utf8"); } catch (e) {}
        envPairs.forEach(pair => { env = _writeEnvKey(env, pair.keyEnv, pair.value); });
        try { writeFileSync(envPath, env); } catch (e) {}
      });
      // 4) 网关健康校验 + 冒烟测试（异步返回结果）
      const health = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/health`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
      let smoke = null;
      if (hermesActiveModel && hermesActiveModel !== "auto") {
        try {
          const sr = await fetch(`http://127.0.0.1:${ROOMS_UI_PORT}/api/eval/smoke`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: hermesActiveModel, provider: activeId }),
            signal: AbortSignal.timeout(120000),
          });
          smoke = await sr.json().catch(() => null);
        } catch (e) { smoke = { ok: false, error: e.message }; }
      }
      return new Response(JSON.stringify({ ok: true, profile: _profileDir || "default", config_backup: backups, hermes_active: hermesActiveId, hermes_model: hermesActiveModel, health: health ? "ok" : "unreachable", smoke }), { headers: jsonHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: jsonHeaders() });
    }
  }

  // 未匹配自定义路由 → 交给上游
  return null;
}

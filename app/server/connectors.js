// connectors.js — OCTOP 风格的连接器实现
// 每个连接器暴露：
//   - catalog 元数据（kind/name/description/auth_kind/mcp_mode/tools...）
//   - 对 gateway 模式连接器：真实的 callTool(creds, name, args) / probeCredentials(creds)
// 凭证存储与 HTTP 路由由 monitor.js 负责；本模块只做“无状态的能力实现”。
// 结构严格参照 TencentCloud/Octop 的 infra/connectors/gateway/adapters。

const UA = "fnos-hermes-connector/0.1";

function jd(obj, pretty) {
  return JSON.stringify(obj, null, pretty ? 2 : 0);
}

// ───────────────────────────────────────────────────────────
// 腾讯新闻（gateway · Bearer API Key）
// ───────────────────────────────────────────────────────────
const tencentNews = {
  callTool(creds, name, args) {
    if (name !== "search_news") throw new Error("未知工具: " + name);
    const apiKey = String(creds.api_key || creds.cookie || creds.auth_code || "").trim();
    if (!apiKey) throw new Error("请填写腾讯新闻 API Key");
    const query = String(args.query || "").trim();
    let limit = parseInt(args.limit != null ? args.limit : (args.max_results != null ? args.max_results : 10), 10);
    if (!query) throw new Error("query 必填");
    if (!Number.isFinite(limit)) limit = 10;
    limit = Math.max(1, Math.min(limit, 50));
    const requestId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    const headers = {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": UA,
      "Skill-Request-Id": requestId,
      "Caller-Skill": "octop_tencent-news_0.1",
    };
    const body = {
      page: 1,
      page_size: limit,
      is_show_content: 0,
      query: { query_id: requestId, search: query },
      article_types: [0],
    };
    const r = fetch("https://openapi.inews.qq.com/api/v1/agent/search", {
      method: "POST", headers, body: jd(body), signal: AbortSignal.timeout(30000),
    });
    return r.then(async (resp) => {
      const text = await resp.text();
      if (!resp.ok) throw new Error("腾讯新闻接口错误 HTTP " + resp.status + ": " + text.slice(0, 200));
      let payload;
      try { payload = JSON.parse(text); } catch { return text; }
      const base = payload && payload.base_rsp;
      if (base && base.code != null && ![0, "0", null].includes(base.code)) {
        const msg = String(base.msg || base.message || base.code);
        if (String(base.code) === "4006" || /api\s*key/i.test(msg)) throw new Error("腾讯新闻 API Key 无效: " + msg);
        throw new Error("腾讯新闻接口错误 [" + base.code + "]: " + msg);
      }
      return jd(payload, true);
    });
  },
  probeCredentials(creds) {
    return this.callTool(creds, "search_news", { query: "新闻", limit: 1 });
  },
};

// ───────────────────────────────────────────────────────────
// 百度地图 Agent Plan（gateway · Bearer Token）
// ───────────────────────────────────────────────────────────
const baiduMap = {
  _key(creds) {
    const k = String(creds.api_key || creds.token || "").trim();
    if (!k) throw new Error("请填写百度地图 Agent Plan Token");
    return k;
  },
  _get(creds, path, params) {
    const url = new URL("https://api.map.baidu.com/agent_plan/v1" + path);
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });
    const headers = { "Authorization": "Bearer " + this._key(creds), "User-Agent": UA };
    return fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(30000) }).then(async (resp) => {
      const text = await resp.text();
      if (!resp.ok) throw new Error("百度地图接口错误 HTTP " + resp.status);
      let payload;
      try { payload = JSON.parse(text); } catch { return text; }
      const status = payload && payload.status;
      const message = String((payload && payload.message) || "");
      if ([102, "102"].includes(status) || /token失效|auth token/i.test(message)) throw new Error("百度地图 Token 无效: " + (message || status));
      if ("result" in payload || "results" in payload || message.toLowerCase() === "ok" || [0, "0"].includes(status)) return jd(payload, true);
      throw new Error("百度地图接口错误 [" + status + "]: " + (message || status));
    });
  },
  callTool(creds, name, args) {
    if (name === "search_place") {
      const query = String(args.query || "").trim();
      const region = String(args.region || "").trim();
      if (!query) throw new Error("query 必填");
      if (!region) throw new Error("region(城市) 必填，例如 region='北京'");
      return this._get(creds, "/place", { user_raw_request: query, region });
    }
    if (name === "plan_direction") {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query 必填");
      return this._get(creds, "/direction", { user_raw_request: query });
    }
    if (name === "get_weather") {
      const region = String(args.region || "").trim();
      if (!region) throw new Error("region 必填");
      return this._get(creds, "/weather", { region });
    }
    throw new Error("未知工具: " + name);
  },
  probeCredentials(creds) { return this._get(creds, "/weather", { region: "北京" }); },
};

// ───────────────────────────────────────────────────────────
// QQ 音乐 Skills（gateway · Bearer qmk- Key）
// ───────────────────────────────────────────────────────────
const qqMusic = {
  _key(creds) {
    const k = String(creds.api_key || "").trim();
    if (!k) throw new Error("请填写 QQ 音乐 API Key");
    if (!k.startsWith("qmk-")) throw new Error("QQ 音乐需使用 qmk- 开头的 API Key");
    return k;
  },
  _post(creds, path, params) {
    const headers = { "Authorization": "Bearer " + this._key(creds), "Content-Type": "application/json", "User-Agent": UA };
    const body = { params: params || {}, comm: { skill_version: "0.0.3" } };
    return fetch("https://a.y.qq.com" + path, { method: "POST", headers, body: jd(body), signal: AbortSignal.timeout(30000) }).then(async (resp) => {
      const text = await resp.text();
      if (resp.status === 401) throw new Error("QQ 音乐 API Key 无效或已过期");
      if (!resp.ok) throw new Error("QQ 音乐接口错误 HTTP " + resp.status);
      let payload;
      try { payload = JSON.parse(text); } catch { return text; }
      if (payload && payload.ret != null && ![0, "0", null].includes(payload.ret) && !/route not found/i.test(String(payload.msg || ""))) {
        const msg = String(payload.msg || "");
        if ([11534343, "11534343"].includes(payload.ret) || /unauthorized/i.test(msg)) throw new Error("QQ 音乐 API Key 无效: " + (msg || payload.ret));
        if (msg) throw new Error("QQ 音乐接口错误 [" + payload.ret + "]: " + msg);
      }
      return jd(payload, true);
    });
  },
  callTool(creds, name, args) {
    if (name === "search_music") {
      const keyword = String(args.keyword || "").trim();
      if (!keyword) throw new Error("keyword 必填");
      return this._post(creds, "/discover/search", { keyword, type: String(args.type || "0") });
    }
    if (name === "list_charts") return this._post(creds, "/charts", {});
    if (name === "get_chart_detail") {
      if (args.top_id == null) throw new Error("top_id 必填");
      return this._post(creds, "/charts/detail", { topId: parseInt(args.top_id, 10) });
    }
    if (name === "get_playlist_detail") {
      if (args.diss_id == null) throw new Error("diss_id 必填");
      return this._post(creds, "/playlists/detail", { dissId: parseInt(args.diss_id, 10) });
    }
    if (name === "listening_report") {
      const params = {};
      if (args.type) params.type = String(args.type);
      return this._post(creds, "/me/report", params);
    }
    throw new Error("未知工具: " + name);
  },
  probeCredentials(creds) { return this._post(creds, "/discover/search", { keyword: "octop", type: "0" }); },
};

// ───────────────────────────────────────────────────────────
// 元典法律 AI（gateway · X-API-Key sk_）
// ───────────────────────────────────────────────────────────
const yuandian = {
  _key(creds) {
    const k = String(creds.api_key || creds.token || "").trim();
    if (!k) throw new Error("请填写元典 API Key");
    if (!k.startsWith("sk_")) throw new Error("元典 API Key 应以 sk_ 开头");
    return k;
  },
  _request(creds, method, route, opts) {
    opts = opts || {};
    const headers = { "X-API-Key": this._key(creds), "Accept": "application/json", "User-Agent": UA };
    let url = "https://open.chineselaw.com/open/" + route;
    if (opts.params) {
      const u = new URL(url);
      Object.entries(opts.params).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, String(v)); });
      url = u.toString();
    }
    const init = { method, headers, signal: AbortSignal.timeout(opts.timeout || 45000) };
    if (method !== "GET") { headers["Content-Type"] = "application/json; charset=utf-8"; init.body = jd(opts.json_body || {}); }
    return fetch(url, init).then(async (resp) => {
      const text = await resp.text();
      if ([401, 403].includes(resp.status)) throw new Error("元典 API Key 无效: HTTP " + resp.status);
      if (!resp.ok) throw new Error("元典接口错误 HTTP " + resp.status);
      let payload;
      try { payload = JSON.parse(text); } catch { return text; }
      if (payload && payload.success === false) {
        const msg = String(payload.message || payload.error_code || "error");
        if (/api/i.test(msg) && /key/i.test(msg)) throw new Error("元典 API Key 无效: " + msg);
        throw new Error("元典接口错误: " + msg);
      }
      const code = payload && payload.code;
      if (code != null && ![0, 200, 201, "0", "200", "201"].includes(code)) {
        const msg = String(payload.message || payload.msg || code);
        if (/api/i.test(msg) && /key/i.test(msg)) throw new Error("元典 API Key 无效: " + msg);
        throw new Error("元典接口错误 [" + code + "]: " + msg);
      }
      return jd(payload, true);
    });
  },
  callTool(creds, name, args) {
    if (name === "search_laws") {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query 必填");
      let n = parseInt(args.return_num || 10, 10); if (!Number.isFinite(n)) n = 10;
      n = Math.max(1, Math.min(n, 45));
      return this._request(creds, "POST", "law_vector_search", { json_body: { query, return_num: n } });
    }
    if (name === "search_cases") {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query 必填");
      return this._request(creds, "POST", "case_vector_search", { json_body: { query } });
    }
    if (name === "search_enterprises") {
      const nameQ = String(args.name || "").trim();
      if (!nameQ) throw new Error("name 必填");
      let k = parseInt(args.top_k || 10, 10); if (!Number.isFinite(k)) k = 10;
      k = Math.max(1, Math.min(k, 50));
      return this._request(creds, "GET", "rh_enterpriseSearch", { params: { name: nameQ, top_k: String(k) } });
    }
    if (name === "get_enterprise") {
      const nameQ = String(args.name || "").trim();
      if (!nameQ) throw new Error("name 必填");
      let num = parseInt(args.num || 2, 10); if (!Number.isFinite(num)) num = 2;
      num = Math.max(1, Math.min(num, 50));
      return this._request(creds, "GET", "rh_company_info", { params: { name: nameQ, num: String(num) } });
    }
    if (name === "detect_hallucination") {
      const text = String(args.text || "").trim();
      if (!text) throw new Error("text 必填");
      return this._request(creds, "POST", "hall_detect", { json_body: { text }, timeout: 60000 });
    }
    throw new Error("未知工具: " + name);
  },
  probeCredentials(creds) { return this._request(creds, "GET", "rh_enterpriseSearch", { params: { name: "腾讯", top_k: "1" } }); },
};

// ───────────────────────────────────────────────────────────
// 腾讯 IMA 笔记/知识库（gateway · clientid + apikey 头）
// ───────────────────────────────────────────────────────────
const tencentIma = {
  _headers(creds) {
    const clientId = String(creds.client_id || "").trim();
    const apiKey = String(creds.api_key || "").trim();
    if (!clientId || !apiKey) throw new Error("IMA client_id 与 api_key 均必填");
    return { "ima-openapi-clientid": clientId, "ima-openapi-apikey": apiKey, "Content-Type": "application/json", "User-Agent": UA };
  },
  _openapi(creds, path, body) {
    return fetch("https://ima.qq.com/" + path.replace(/^\//, ""), {
      method: "POST", headers: this._headers(creds), body: jd(body), signal: AbortSignal.timeout(60000),
    }).then(async (resp) => {
      const text = await resp.text();
      if (resp.status === 401) throw new Error("IMA 认证失败，请检查 Client ID 与 API Key");
      if (!resp.ok) {
        let msg = "HTTP " + resp.status;
        try { const b = JSON.parse(text); msg = b.msg || b.message || msg; } catch {}
        throw new Error(String(msg));
      }
      let data; try { data = JSON.parse(text); } catch { return text; }
      if (data && data.code != null && ![0, "0", null].includes(data.code)) throw new Error("[" + data.code + "] " + String(data.msg || data.message || "IMA API error"));
      return jd(data, true);
    });
  },
  callTool(creds, name, args) {
    if (name === "list_notes") {
      const limit = Math.max(1, Math.min(parseInt(args.limit || 20, 10) || 20, 20));
      const body = { cursor: String(args.cursor || ""), limit };
      if (args.folder_id) body.folder_id = String(args.folder_id);
      return this._openapi(creds, "openapi/note/v1/list_note", body);
    }
    if (name === "search_notes") {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query 必填");
      return this._openapi(creds, "openapi/note/v1/search_note", { search_type: 0, query_info: { title: query }, start: parseInt(args.start || 0, 10) || 0, end: parseInt(args.end || 20, 10) || 20 });
    }
    if (name === "list_knowledge_bases") return this._openapi(creds, "openapi/wiki/v1/search_knowledge_base", { limit: parseInt(args.limit || 50, 10) || 50 });
    if (name === "search_knowledge") {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query 必填");
      const body = { query, limit: parseInt(args.limit || 10, 10) || 10 };
      if (args.knowledge_base_id) body.knowledge_base_id = String(args.knowledge_base_id);
      return this._openapi(creds, "openapi/wiki/v1/search_knowledge", body);
    }
    throw new Error("未知 IMA 工具: " + name);
  },
  probeCredentials(creds) { return this._openapi(creds, "openapi/wiki/v1/search_knowledge_base", { limit: 1 }); },
};

// ───────────────────────────────────────────────────────────
// 目录（catalog）—— 参照 OCTOP catalog.py；gateway 连接器带真实 impl
// fields: 凭证表单字段；tools: 暴露给前端的工具定义
// ───────────────────────────────────────────────────────────
export const CONNECTOR_CATALOG = [
  {
    kind: "tencent-news", name: "腾讯新闻", icon: "📰", color: "#1485ee",
    description: "新闻搜索与热点订阅（腾讯新闻 Skills OpenAPI）",
    auth_kind: "api_key", mcp_mode: "gateway", phase: "available",
    doc_url: "https://news.qq.com/exchange?scene=appkey",
    auth_hint: "登录腾讯新闻 Skills 页生成 API Key 并粘贴到下方（每个账号仅一个 Key）",
    fields: [{ key: "api_key", label: "API Key", placeholder: "腾讯新闻 API Key", secret: true }],
    tools: [{
      name: "search_news", description: "按关键词搜索腾讯新闻资讯",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "搜索关键词" }, limit: { type: "integer", description: "返回条数，默认 10" } }, required: ["query"] },
    }],
    impl: tencentNews,
  },
  {
    kind: "baidu-map", name: "百度地图", icon: "🗺️", color: "#3385ff",
    description: "地点检索、路线规划与天气查询（Agent Plan）",
    auth_kind: "api_key", mcp_mode: "gateway", phase: "available",
    doc_url: "https://lbs.baidu.com/apiconsole/agentplan",
    auth_hint: "在百度地图 Agent Plan 控制台获取 Token（sk-ap- 开头）并粘贴到下方",
    fields: [{ key: "api_key", label: "Agent Plan Token", placeholder: "sk-ap-...", secret: true }],
    tools: [
      { name: "search_place", description: "地点检索：自然语言搜 POI（需提供城市 region）", inputSchema: { type: "object", properties: { query: { type: "string" }, region: { type: "string", description: "城市，如 北京" } }, required: ["query", "region"] } },
      { name: "plan_direction", description: "路线规划：自然语言描述起终点", inputSchema: { type: "object", properties: { query: { type: "string", description: "如 从天安门到故宫怎么走" } }, required: ["query"] } },
      { name: "get_weather", description: "查询城市天气", inputSchema: { type: "object", properties: { region: { type: "string", description: "城市，如 北京" } }, required: ["region"] } },
    ],
    impl: baiduMap,
  },
  {
    kind: "qq-music", name: "QQ 音乐", icon: "🎵", color: "#31c27c",
    description: "搜歌、排行榜、歌单与听歌报告",
    auth_kind: "api_key", mcp_mode: "gateway", phase: "available",
    doc_url: "https://y.qq.com/n/ryqq_v2/qqmusic_skills",
    auth_hint: "登录 QQ 音乐 Skills 页生成 qmk- 开头的 API Key 并粘贴到下方",
    fields: [{ key: "api_key", label: "API Key", placeholder: "qmk-...", secret: true }],
    tools: [
      { name: "search_music", description: "搜索 QQ 音乐歌曲/专辑/歌单/歌手", inputSchema: { type: "object", properties: { keyword: { type: "string" }, type: { type: "string", description: "搜索类型，默认 0(歌曲)" } }, required: ["keyword"] } },
      { name: "list_charts", description: "获取 QQ 音乐排行榜列表", inputSchema: { type: "object", properties: {} } },
      { name: "get_chart_detail", description: "按 topId 获取榜单歌曲", inputSchema: { type: "object", properties: { top_id: { type: "integer" } }, required: ["top_id"] } },
      { name: "get_playlist_detail", description: "按 dissId 获取歌单歌曲", inputSchema: { type: "object", properties: { diss_id: { type: "integer" } }, required: ["diss_id"] } },
      { name: "listening_report", description: "获取听歌报告（day/week/month）", inputSchema: { type: "object", properties: { type: { type: "string" } } } },
    ],
    impl: qqMusic,
  },
  {
    kind: "yuandian", name: "元典法律", icon: "⚖️", color: "#1a56db",
    description: "法律法规、案例文书、企业信息与法律幻觉检测",
    auth_kind: "api_key", mcp_mode: "gateway", phase: "available",
    doc_url: "https://open.chineselaw.com/profile",
    auth_hint: "登录元典开放平台获取 sk_ 开头的 API Key 并粘贴到下方",
    fields: [{ key: "api_key", label: "API Key", placeholder: "sk_...", secret: true }],
    tools: [
      { name: "search_laws", description: "语义检索法律法规与法条", inputSchema: { type: "object", properties: { query: { type: "string" }, return_num: { type: "integer", description: "返回条数，默认 10" } }, required: ["query"] } },
      { name: "search_cases", description: "语义检索裁判案例", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "search_enterprises", description: "按企业名称检索候选（获取统一社会信用代码）", inputSchema: { type: "object", properties: { name: { type: "string" }, top_k: { type: "integer", description: "候选数，默认 10" } }, required: ["name"] } },
      { name: "get_enterprise", description: "按企业名称查询详情", inputSchema: { type: "object", properties: { name: { type: "string" }, num: { type: "integer", description: "返回数量，默认 2" } }, required: ["name"] } },
      { name: "detect_hallucination", description: "校验文本中的法律引用是否准确（约 15s）", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    ],
    impl: yuandian,
  },
  {
    kind: "tencent-ima", name: "腾讯 IMA", icon: "📝", color: "#07c160",
    description: "笔记与知识库读写、检索与管理",
    auth_kind: "api_key", mcp_mode: "gateway", phase: "available",
    doc_url: "https://qclaw.qq.com/docs/206424375046045696",
    auth_hint: "在 IMA 获取 API Key 与 Client ID（API Key 仅展示一次）",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "IMA Client ID" },
      { key: "api_key", label: "API Key", placeholder: "IMA API Key", secret: true },
    ],
    tools: [
      { name: "list_notes", description: "列出最近笔记", inputSchema: { type: "object", properties: { folder_id: { type: "string", description: "可选笔记本 ID" }, cursor: { type: "string" }, limit: { type: "integer", description: "1-20，默认 20" } } } },
      { name: "search_notes", description: "按标题/内容搜索笔记", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "list_knowledge_bases", description: "列出知识库", inputSchema: { type: "object", properties: { limit: { type: "integer", description: "默认 50" } } } },
      { name: "search_knowledge", description: "在知识库内搜索", inputSchema: { type: "object", properties: { query: { type: "string" }, knowledge_base_id: { type: "string" }, limit: { type: "integer", description: "默认 10" } }, required: ["query"] } },
    ],
    impl: tencentIma,
  },
  // ── remote 模式：保存后将注册为 MCP 服务器（由网关调用）──
  {
    kind: "tencent-docs", name: "腾讯文档", icon: "📄", color: "#0052d9",
    description: "读写腾讯文档、智能表格与空间文件（远程 MCP）",
    auth_kind: "personal_token", mcp_mode: "remote", phase: "available",
    doc_url: "https://developer.cloud.tencent.com/mcp/server/11803",
    auth_hint: "打开 MCP 授权页登录，复制页面上的 Token 并粘贴到下方",
    fields: [{ key: "token", label: "MCP Token", placeholder: "腾讯文档 MCP Token", secret: true }],
    mcp_url: "https://docs.qq.com/open/mcp",
    tools: [{ name: "(远程 MCP)", description: "保存后注册为 MCP 服务器，由对话中的智能体调用" }],
    impl: null,
  },
  {
    kind: "notion", name: "Notion", icon: "📓", color: "#000000",
    description: "官方 MCP：搜索、读写页面与数据库（远程 OAuth MCP）",
    auth_kind: "oauth2", mcp_mode: "remote", phase: "available",
    doc_url: "https://developers.notion.com/docs/mcp",
    auth_hint: "点击「一键授权」完成 Notion 登录，或按官方文档手动获取 Token",
    fields: [{ key: "token", label: "Integration Token", placeholder: "secret_...", secret: true }],
    mcp_url: "https://mcp.notion.com/mcp",
    tools: [{ name: "(远程 MCP)", description: "保存后注册为 MCP 服务器，由对话中的智能体调用" }],
    impl: null,
  },
  {
    kind: "tencent-meeting", name: "腾讯会议", icon: "🎥", color: "#006eff",
    description: "会议管理、查询、录制与智能纪要（远程 MCP）",
    auth_kind: "personal_token", mcp_mode: "remote", phase: "available",
    doc_url: "https://meeting.tencent.com/ai-skill.html",
    auth_hint: "打开授权页登录腾讯会议，复制页面上的 Token 并粘贴到下方",
    fields: [{ key: "token", label: "MCP Token", placeholder: "腾讯会议 Token", secret: true }],
    mcp_url: "https://meeting.tencent.com/mcp",
    tools: [{ name: "(远程 MCP)", description: "保存后注册为 MCP 服务器，由对话中的智能体调用" }],
    impl: null,
  },
  {
    kind: "tencent-lexiang", name: "腾讯乐享", icon: "📚", color: "#00c1de",
    description: "知识库检索、阅读、创建与文档管理（远程 MCP）",
    auth_kind: "api_key", mcp_mode: "remote", phase: "available",
    doc_url: "https://qclaw.qq.com/docs/211858629271314432",
    auth_hint: "打开乐享凭证页登录，复制企业标识与访问令牌分别填入下方",
    fields: [
      { key: "company_from", label: "企业标识", placeholder: "company_from" },
      { key: "token", label: "访问令牌", placeholder: "乐享访问令牌", secret: true },
    ],
    mcp_url: "https://lexiangla.com/mcp",
    tools: [{ name: "(远程 MCP)", description: "保存后注册为 MCP 服务器，由对话中的智能体调用" }],
    impl: null,
  },
];

export function getConnector(kind) {
  return CONNECTOR_CATALOG.find((c) => c.kind === kind) || null;
}

// 仅 gateway 连接器可被直接调用；返回 Promise<string>
export function callConnectorTool(kind, creds, name, args) {
  const c = getConnector(kind);
  if (!c) throw new Error("未知连接器: " + kind);
  if (!c.impl || typeof c.impl.callTool !== "function") throw new Error("该连接器为远程 MCP 模式，请在对话中由智能体调用");
  return Promise.resolve(c.impl.callTool(creds, name, args));
}

export function probeConnector(kind, creds) {
  const c = getConnector(kind);
  if (!c || !c.impl || typeof c.impl.probeCredentials !== "function") return Promise.resolve();
  return Promise.resolve(c.impl.probeCredentials(creds));
}

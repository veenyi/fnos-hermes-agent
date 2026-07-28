# fnos-hermes-agent v0.20.42

> 聊天界面 v17 原型融合进真实项目代码（Node 基座 + Hermes 0.19.0）。

## 新功能

### 1. 聊天界面主题系统（auto / light / dark）
- 新增三态主题：跟随系统（`auto`）、明色（`light`）、暗色（`dark`）。
- 选择记忆到 `localStorage`（`fnos-theme-mode`），刷新后保留。
- 聊天头部新增主题切换按钮（🏠 跟随系统 / ☀ 明 / ☾ 暗）。

### 2. 聊天头部增强
- 新增 GitHub 项目链接（🐶 指向 `veenyi/fnos-hermes-agent`）。
- 保留「在新窗口打开」按钮（弹窗聊天，不破坏主界面布局）。

### 3. 聊天工具栏 + 迷你浮窗
- 底部工具栏四个入口：**⚡ 快捷指令 / 🔌 连接器 / 📚 技能 / 🧠 模型**。
- 迷你浮窗（居中底部，移动端全屏）：
  - **快捷指令**：30 条命令，分 4 组（核心 / 会话管理 / 工具与技能 / 系统）+ 实时搜索，点击直接填入并发送。
  - **连接器**：卡片式列出真实连接器（腾讯新闻、百度地图、QQ 音乐、元典法律、腾讯 IMA 等网关直连连接器，以及腾讯文档、Notion、腾讯会议、腾讯乐享等远程 MCP 连接器），标注「网关直连 / 远程 MCP」与配置状态，点击打开**详情弹窗**可直接配置凭证并调用工具（不再假跳转到其它页面）。
  - **技能**：列出内置技能（`agency-orchestrator` / `fnos-knowledge` / `trim-cli`）。
  - **模型**：`fetch /api/config` 拉取已配置提供商，标注当前模型，点击跳转设置页。

### 4. 左侧导航新增「连接器」独立页面
- 侧边栏与移动端底部导航均新增 **连接器** 入口（位于「扩展」与「通讯」之间）。
- 新增 `viewConnectors` 视图，从 `/api/connectors` 读取 **OCTOP 风格的真实连接器目录**，渲染真实卡片（图标 / 颜色 / 模式标签 / 工具数 / 已配置状态）。
- 点击卡片打开 **详情弹窗**：填写凭证 → 测试连接 → 保存；网关直连连接器可在弹窗内直接调用其工具并查看真实返回；远程 MCP 连接器保存后自动注册为 `mcp_servers` 由对话智能体调用。

### 5. 底部专家角色合并为单一选择器（对齐 v17）
- 原底部输入区上方以**平铺胶囊**展示全部内置角色/专家/专家团/工作流，拥挤且与 v17 设计不符。
- **改为单一胶囊**：仅显示当前激活角色（如 `🤖 默认助手 ▾`），点击后弹出「选择角色」浮窗。
- 浮窗内统一展示：
  - **角色网格**：默认助手、程序员、研究员、写作助手、数据分析师及所有自定义角色。
  - **专家团 / 工作流**：已配置专家团显示成员数并带 `⚡` 标记；已启用工作流显示 DAG 名称；未配置时点击跳转「扩展能力」页。
- 选中角色通过 `chatState.persona` 与 `settingsState.config.extensions.persona` 同步，仍经 `system` 字段下发，不污染对话历史。

### 6. 移动端适配
- 工具栏横向滚动；迷你浮窗在小屏全屏展示；命令网格单列；底部导航新增「连接器」按钮。

## 问题修复

### 1. 修复 persona / 专家团提示污染对话历史（`_pfx` 根因）
- 原实现把 persona / 专家团提示**拼进用户消息**发给后端，导致历史里混入系统提示、且 `buildChatHistory()` 自身不注入 persona（前端预拼是唯一生效途径），无法直接删除。
- **修复**：前端改为计算 `_sysOverride`（persona 或专家团提示），通过聊天载荷的 `system` 字段下发；后端 `monitor.js` 在 `runChatWS` / `createChatStream` 中用该 `system` 覆盖 `UI_CAPABILITIES_PROMPT`，既消除历史污染，又保留专家团 / 角色能力。
- 贯通位置：`/api/chat/ws-send`、`WS upgrade`、`runChatWS`、`createChatStream`、`/api/chat/stream`。

### 2. 紧急修复 Telegram 机器人未校验绑定 ID 的越权漏洞（严重）
- **现象**：用户反馈绑定了 ID 后，用另一个 Telegram 帐号私聊机器人即可执行任意操作，甚至授权 root。
- **根因**：`/api/channels/telegram/qr/apply` 虽写入了 `TELEGRAM_ALLOWED_USERS`，但**未重启网关**，导致正在运行的网关永不加载该白名单（`_is_user_authorized_from_message` 在 `TELEGRAM_ALLOWED_USERS` 为空时允许任意 DM）。
- **修复**：
  1. apply 写入 `TELEGRAM_ALLOWED_USERS` 到 `~/.hermes/.env`；
  2. 同步 `allow_from` 到 `config.yaml` 的 `platforms.telegram`（与上游 bootstrap 约定一致，双保险）；
  3. **强制触发网关重启**，使白名单立即生效；
  4. 保存即要求至少 1 个允许的用户 ID（空则拒绝）。
- 上游 `hermes-agent` 的 `adapter._is_user_authorized_from_message` 在 `TELEGRAM_ALLOWED_USERS` 非空时会拦截未知 DM（已通过上游单测 `test_telegram_auth_check.py` 验证）。

### 3. 修复 temperature / max_tokens 不持久化
- **现象**：在提供商设置里调整「创造性（temperature）」与「最大 token（max_tokens）」保存、刷新后丢失，无法调模型权重 / token 长度。
- **根因**：`monitor.js` 在四处（保存 POST→`allProvConfig`、写 `providers-state.yaml`、读 `providers-state.yaml`、GET 回显）全部丢弃这两个字段，GET 回显硬编码 `0.7/4096`。
- **修复**：四个环节贯通 `temperature` / `max_tokens`（解析→存储→回显），GET 回显改为读取真实值，不再硬编码。

### 4. 修复聊天工具栏「角色胶囊」与工具栏分行问题
- **现象**：角色胶囊与底部工具栏（快捷指令/连接器/技能/模型）被渲染成两行，与 v17 设计单行布局不符。
- **修复**：用 `.chat-tools-row` 弹性容器包裹胶囊与工具栏，单行显示、横向可滚动，移动端全屏适配。

### 5. 连接器重构为 OCTOP 风格的真实实现（不再假跳转）
- **现象**：连接器卡片点击后只是跳转到其它页面，没有实际功能（"都是假的都在乱跳"）。
- **修复**：新增 `app/server/connectors.js`（OCTOP `gateway/adapters` 架构镜像）+ 后端 `/api/connectors` 系列接口 + 前端详情弹窗。网关直连连接器（腾讯新闻、百度地图、QQ 音乐、元典法律、腾讯 IMA）实现真实 `callTool` 直接调用上游 API；远程 MCP 连接器（腾讯文档、Notion、腾讯会议、腾讯乐享）保存后注册为 `mcp_servers`。

## 技术说明（连接器架构）
- 连接器实现**严格参照 TencentCloud/Octop 的 `infra/connectors/gateway/adapters`**：每个连接器暴露 `TOOLS`（MCP 工具定义）+ `list_tools()` + `call_tool(creds, name, args)` + `probe_credentials(creds)`，由网关 `protocol` 包装为 MCP JSON-RPC。
- 本包在 Node 端以 `app/server/connectors.js` 镜像该架构：`CONNECTOR_CATALOG`（目录，含 `auth_kind` / `mcp_mode` / `tools` / `fields`）+ 各网关连接器的真实 `callTool`（如腾讯新闻 `POST openapi.inews.qq.com`、百度地图 `GET agent_plan/v1`、QQ 音乐 `POST a.y.qq.com`、元典 `X-API-Key`、腾讯 IMA `ima-openapi-*` 头）。凭证存于 `connectors-state.json`（权限 600），远程 MCP 连接器保存后写入 `config.yaml` 的 `mcp_servers`。
- `mcp_mode`：`gateway` = 由本包直接发起真实 HTTP 调用（弹窗内可调用工具）；`remote` = 注册为 MCP 服务器由对话智能体调用。

## 安装/升级
在 fnOS 应用中心直接上传 `fnos-hermes-agent_v0.20.42.fpk` 升级即可。升级后无需额外配置；若更换主题或连接器，刷新页面即可生效。

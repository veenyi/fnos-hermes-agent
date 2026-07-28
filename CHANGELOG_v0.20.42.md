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
  - **连接器**：卡片式列出腾讯新闻、微信、QQ、飞书、Telegram、GitHub、WhatsApp、自定义 MCP，标注「需 API Key / 已配置」并一键跳转到 `channels` / `extensions` 视图。
  - **技能**：列出内置技能（`agency-orchestrator` / `fnos-knowledge` / `trim-cli`）。
  - **模型**：`fetch /api/config` 拉取已配置提供商，标注当前模型，点击跳转设置页。

### 4. 左侧导航新增「连接器」独立页面
- 侧边栏与移动端底部导航均新增 **连接器** 入口（位于「扩展」与「通讯」之间）。
- 新增 `viewConnectors` 视图，复用底部工具栏的连接器卡片，展示 8 个连接器（腾讯新闻、微信、QQ、飞书、Telegram、GitHub、WhatsApp、自定义 MCP）。
- 进入页面时异步读取 `/api/config`，根据 `mcp_servers` / `platforms` 动态标注「已配置 / 未配置」，点击卡片一键跳转对应配置页。

### 5. 移动端适配
- 工具栏横向滚动；迷你浮窗在小屏全屏展示；命令网格单列；底部导航新增「连接器」按钮。

## 问题修复

### 1. 修复 persona / 专家团提示污染对话历史（`_pfx` 根因）
- 原实现把 persona / 专家团提示**拼进用户消息**发给后端，导致历史里混入系统提示、且 `buildChatHistory()` 自身不注入 persona（前端预拼是唯一生效途径），无法直接删除。
- **修复**：前端改为计算 `_sysOverride`（persona 或专家团提示），通过聊天载荷的 `system` 字段下发；后端 `monitor.js` 在 `runChatWS` / `createChatStream` 中用该 `system` 覆盖 `UI_CAPABILITIES_PROMPT`，既消除历史污染，又保留专家团 / 角色能力。
- 贯通位置：`/api/chat/ws-send`、`WS upgrade`、`runChatWS`、`createChatStream`、`/api/chat/stream`。

## 技术说明（连接器架构）
- 连接器（如腾讯新闻）即**技能（Skill）**：在扩展页 / SkillHub 安装启用，外部服务需配置 **API Key** 后在对话中调用（与上游 OCTOP/OpenClaw 的 `tencent-news` `auth_kind="api_key"` 机制一致）。
- 上游 OCTOP 将 **Channels（IM 平台）/ Connectors（OAuth + MCP）/ Skills（每智能体）** 作为三个概念区分；本包基于 hermes 基座，连接器经 `mcp_servers` 与技能扩展接入。

## 安装/升级
在 fnOS 应用中心直接上传 `fnos-hermes-agent_v0.20.42.fpk` 升级即可。升级后无需额外配置；若更换主题或连接器，刷新页面即可生效。

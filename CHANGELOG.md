# fnos-hermes-agent CHANGELOG (v0.20.81 – v0.21.0)

---

## v0.21.0 — MCP 模块级自动注册（作用域修复）

### 问题修复
- **MCP 自动注册作用域 bug**：v0.20.98 的 `_autoRegisterGatewayMcp` 定义在全局作用域，但调用的 `_readConnectorsState`/`_upsertMcpServer` 等函数在 `handleFetch` 内部，导致 ReferenceError 被 catch 静默吞掉，MCP 配置从未写入 config.yaml。
- **修复方案**：新增 `_moduleLevelAutoRegisterMcp()`，在模块加载时同步执行，直接用 `readFileSync`/`writeFileSync` 操作 `connectors-state.json` 和 `config.yaml`，完全不依赖 handleFetch 内部函数。
- 诊断端点 `/api/debug/mcp-status` 现在能正确反映注册状态。

---

## v0.20.99 — 模型列表纯净性修复

### 问题修复
- **自定义提供商预填模型**：`addProvider()` 自动选第一个云端预设导致 gpt-4o 等模型残留。改为默认「自定义」+ 空列表。
- **切换预设不清空列表**：`onProviderPresetChange` 切到「自定义」时未清空 `_providerModelCache`，导致上一个预设的模型残留。
- **获取模型合并策略**：`fillModelOptionsFromList` 从「合并」改为「替换」——以接口返回为准，仅保留同一模型的参数编辑，不再保留接口未返回的旧模型。

---

## v0.20.98 — MCP 自动注册 + 诊断端点

### 新功能
- **启动时自动注册**：monitor.js 启动后自动扫描已配置凭证的 gateway 连接器，注册 MCP stdio 代理（无需用户手动重新保存凭证）。
- **诊断端点** `GET /api/debug/mcp-status`：返回 config.yaml 中 mcp_servers 内容、桥接脚本状态、node 路径、gateway 连接器注册状态，用于排查 MCP 工具不可用问题。

---

## v0.20.97 — 模型弹窗 UI 修复

### 问题修复
- **备注标签**：去掉「(可选)」后缀，仅显示「备注」。
- **获取模型后列表不可见**：`.provider-model-list` 在 flex 列布局中被压缩到 0 高度。添加 `flex-shrink:0; min-height:60px` 修复。

---

## v0.20.96 — MCP stdio 桥接脚本

### 问题修复
- **Hermes 网关不支持 HTTP 传输**：v0.20.95 用 `url` 字段注册 MCP 代理，但 Hermes 网关的 Python MCP 客户端仅支持 stdio 传输（`command` + `args`），`url` 被忽略。
- **修复方案**：生成 Node.js 桥接脚本 `${VAR_DIR}/mcp-stdio-bridge.js`，从 stdin 读 JSON-RPC，HTTP 转发到 monitor.js 的 `/mcp-proxy/:kind` 端点，响应写 stdout。注册格式改为 `command: node, args: [bridge.js, kind, port]`。
- **YAML 解析器增强**：`_parseMcpServers` 支持 `args` 列表解析（inList 状态机）。

---

## v0.20.95 — MCP 代理端点（初版，后被 v0.20.96 替代）

### 新功能
- 新增 `/mcp-proxy/:kind` 端点，实现 MCP streamable HTTP 协议（JSON-RPC：initialize / tools/list / tools/call / ping）。
- gateway 连接器保存凭证时注册本地 MCP 代理（url 方式，后发现网关不支持）。

---

## v0.20.94 — 技能市场融合进扩展→技能

### 新功能
- 扩展→技能页新增第三个子标签「技能市场」，与本地技能、内置技能并列。
- 每张技能卡片按状态显示按钮：未安装 [安装 / 获取指引]、已安装 [卸载 / 配置 / 获取指引]。
- 后端：SKILL_MARKET_CATALOG 精选目录（19 项）；market-catalog 端点返回 items + installed_names；install-package 下载完整包 + 注册 skills_dirs + MCP + 重启网关；uninstall 删目录 + 清配置 + 删 MCP + 重启；config-mcp 合并写 MCP headers。
- 前端：搜索框 + 精选目录按钮 + 全部/已安装/官方认证筛选；marketCfgModal 弹窗配置 MCP 凭证。

---

## v0.20.93 — 连接器系统回退至原始模式

### 变更
- 完全移除 SkillHub 技能市场前端/后端代码（CONNECTOR_SKILL_CATALOG、connector-catalog 端点等）。
- 恢复原始 per-connector 配置模式：PV.octopConnectors 目录 + openConnectorModal 详情弹窗 + 凭证配置 + 工具调用。
- 保留 IMA 凭证修复（creds_set 布尔掩码 + 留空保留原值逻辑）。

---

## v0.20.89 – v0.20.92 — 连接器技能市场迭代与修复

### 变更
- v0.20.89-v0.20.91：SkillHub 技能市场 UI 迭代（卡片布局、安装/卸载流程、MCP 凭证配置）。
- v0.20.92：修复安装/卸载后 skills_dirs 同步、config.yaml 合并写入、网关重启触发。

---

## v0.20.88 — 连接器技能市场改造（6 阶段计划完成）

### 新功能
- 将连接器页面改造为 SkillHub 技能市场模式：卡片式展示、一键安装/卸载、MCP 凭证配置。
- 后端新增 CONNECTOR_SKILL_CATALOG、connector-catalog 端点、install-package 端点。
- 前端新增技能市场视图、搜索/筛选、安装状态检测。

---

## v0.20.81 – v0.20.87 — 专家团系统 + 模型弹窗重构 + 稳定性增强

### 新功能
- **专家团系统**：随机组建算法、双模式组建交互（手动/随机）、20 个工作流预设、常驻状态栏 UI、启用 Toast 提醒、会话归属分组规则。
- **模型提供商弹窗重构**：参数保留机制、列表高度优化、跨端视觉统一、模型列表平铺 + 自动获取。
- **飞牛操作员**：内置 NAS 运维角色定义。
- **模型选择性能优化**：fetchGatewayModels 返回 ok 字段修复、模型验证逻辑修正。

### 问题修复
- **Dashboard 502 自愈升级**：改用端口监听判活替代 pidAlive，解决 Dashboard 假死问题。
- **飞牛嵌入保活**：setupFnosKeepAlive 机制防止 iframe 嵌入时 fnOS 空闲登出。
- **会话树默认折叠**：桌面端 chat-rail 默认 hidden，避免妨碍工作。
- **专家选择按钮视觉激活**：选中态圆形按钮实心亮起，与 persona tab 一致。

---

> 更早版本请参阅各独立 CHANGELOG 文件（CHANGELOG_v0.20.38.md – CHANGELOG_v0.20.42.md）。

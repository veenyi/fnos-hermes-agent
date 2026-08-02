# fnos-hermes-agent CHANGELOG (v0.20.81 – v0.21.5)

---

# v0.21.5 — MCP 自动注册根因修复 + Dashboard 稳定性 + 热更新

### 问题修复
- **模块级注册读不到凭证（ReferenceError 静默）**：`CONNECTORS_STATE` 常量此前定义在 `handleFetch` 内部，模块级 `_moduleLevelAutoRegisterMcp` 引用时抛 ReferenceError 被 catch 吞掉，凭证状态永远为空 → 自动注册永远跳过（日志始终为 "no configured gateway connectors"）。现已在模块级定义该常量，删除 handleFetch 内重复声明。
- **config.yaml 重复顶层键污染**：hermes 官方模板使用 inline 形态 `mcp_servers: {}`，而 `_setYamlMapBlock`/`_setYamlFlatMap`/`_setYamlListBlock` 只匹配 block 形态（`key:` 独立行），每次写入都匹配失败并在文件末尾追加新块。实测 NAS 上 config.yaml 被污染 34 行重复 `mcp_servers: {}`，导致 `_parseMcpServers` 解析为空、MCP 注册全部失效（v0.20.98–v0.21.4 反复"修复"无效的根因）。
- **修复方案**：以上三个写入函数全部改用健壮的 `_setTopLevelBlock`（兼容 inline 与 block 形态，且清除历史遗留的重复顶层键）；`_yamlBlockOf` 增加 inline 形态兼容；模块级新增 `_replaceTopLevelKey`，`_moduleLevelAutoRegisterMcp` 改为一次性收集全部 gateway 连接器条目后整体替换写入（不再逐条追加）。
- **热回滚命令模板字符串语法错误**：`execSync` 中 `${1%.hot-bak}` 被解析为模板占位符导致 SyntaxError（该文件用 node 直接启动会失败），已转义为 `\${1%.hot-bak}`。
- **WebSocket 断连不重连**：上游 dashboard 偶发断连（code 1006/1001/1011/4xxx）后 WS proxy 直接关闭浏览器连接，用户看到"连接似乎已断开"。现改为指数退避自动重连（最多 10 次），error 事件也触发重连。
- **GitHub PAT 未配置报 502**：更新检查请求 GitHub API 返回 401/403 时，proxy 抛 502 到前端。现优雅降级返回 `rateLimited: true` + 友好提示，前端显示"未配置 PAT"引导而非报错。
- **Dashboard 版本显示 v0.21.1**：dashboard 自身 `/api/status` 返回硬编码旧版本。现 proxy 层拦截该响应并注入 manifest 中的 `app_version`（0.21.5）。
- **版本比较误报更新**：`latest !== current` 字符串比较导致本地 0.21.5 > GitHub 0.21.2 时仍提示"有更新"。改用 `compareVersions(latest, current) > 0` 语义化比较。

### 新增
- **热更新（hot-patch）机制**：Release 附带 `hot-patch.json` 时，Dashboard 显示"⚡ 快速更新"按钮，仅下载变更文件（~934KB）原子替换，含后端文件时自动重启。
- **热更新回滚保护**：启动时检测 `.hot-restart` 标记超时（crash loop），自动回滚所有 `.hot-bak` 备份文件。
- **GitHub Release v0.21.5 发布**：包含完整 fpk 安装包 + hot-patch 资产，支持全量安装和增量热更两种升级路径。

---

## v0.21.1 – v0.21.4 — 部署与诊断迭代

### 变更
- v0.21.1-v0.21.3：连接器/专家团相关迭代与部署调试。
- v0.21.4：monitor.js 调整与打包。

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

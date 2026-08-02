# fnos-hermes-agent CHANGELOG (v0.20.81 – v0.21.7)

---

# v0.21.7 — 修复应用无法启动：单实例守卫改为接管式 + 残留进程清理

### 问题修复
- **应用在 fnOS 应用中心永远「已停止」、点启用无效（v0.21.6 单实例守卫副作用）**：框架 stop 只杀 app.pid 记录的进程，手动部署/残留的 monitor 杀不掉时，框架 start 的新实例被守卫（「较晚者退出」策略）逼退，框架又把死进程 pid 写回 app.pid → 死循环。现改为**接管式守卫**：新实例检测到更早的 monitor 时请求其退出（SIGTERM→SIGKILL）并继续启动；只有较大 pid 对较小 pid 单向行动，不会互杀；热更自重启/覆盖安装/框架重启均能正确接管。
- **cmd/main stop 残留进程不清理**：stop 只处理 PID 文件中的进程，孤儿 gateway/dashboard、手动拉起的 monitor 会一直占端口/socket。现 stop 末尾兜底 pkill node monitor.js / hermes gateway / dashboard。
- **install_init/upgrade_init 清理模式错误**：只 pkill `bun.*monitor.js`，而实际运行时是 node，残留 monitor 在安装/升级时杀不掉。现同时匹配 node 与 bun 模式。

---

# v0.21.6 — 多 Agent 圆桌讨论 & 模型预配置 & 交互增强 & 更新链路修复

### 新增功能
- **多 Agent 圆桌讨论**：选择 2+ 个 Agent 在同一对话中轮流发言、互相讨论，支持 1-3 轮 + 自动综合总结。
- **回复状态指示器**：🤔 正在思考 → ✍️ 正在回复（进度条）→ ✅ 回答完成，解决用户不知道 AI 是否答完的问题。
- **语音播放 / 消息引用 / Fork 话题**：AI 消息悬停操作栏，支持 TTS 朗读、基于引用追问、Fork 成新会话。
- **模型预配置库（50+ 模型）**：获取模型后自动匹配上下文窗口/能力标签/最大输出；模型列表支持复选框启用/禁用 + 全选 + 能力徽章。
- **定时任务模板**：10 个预设模板（新闻摘要/周报/NAS健康检查等），点击一键填充。
- **完整安装改为直接下载 .fpk 安装包**：点击「完整安装」直接下载最新 Release 的 .fpk 安装包（后端认证中转，支持私有仓库），由用户在 fnOS 应用中心安装/覆盖；文件级替换升级走独立的「热更新」按钮（仅下载变更文件并自动替换+重启）。

### 问题修复
- **「完整安装」点完提示更新完成但版本不变（三重根因）**：① `/api/app/update/dispatch` 只触发 GitHub Actions 构建 fpk，从不下载安装；② 前端轮询的 `/api/app/update/status` 端点后端不存在；③ `APP_VERSION` 是启动时读取的常量，manifest 更新后运行中进程仍报旧版本。现改为「下载 fpk 手动安装」+「热更新」双路径，`APP_VERSION` 保持可热刷新（热更后概览页立即显示新版本）。
- **更新后网关不重启**：启动清理的 pkill 误写成数组形式 `spawnSync(["pkill", ...])` 导致 ENOENT 静默失败，旧 gateway/dashboard 杀不掉；且旧进程存活时自动启动被跳过。现修复清理命令，并在热更新后先显式停止 gateway/dashboard，新 monitor 启动后必定全新拉起。
- **双 monitor 并存**：自重启后 fnOS 框架可能另行拉起一个 monitor，双进程互抢 TCP 8650、反复杀对方刚拉起的网关。新增单实例守卫：启动较早（pid 较小）的进程保留，较晚的自行退出。
- **版本号体系回退**：按小版本迭代原则，将误升的 v0.22.0 回退为 v0.21.6（Release/hot-patch/NAS 同步更新）。
- **fpk CI 构建失败**：fnpack 1.0.4 不支持 `--version` 参数（报错退出），workflow 改为无参调用验证可执行性。
- **manifest 不可写导致版本不更新**：fnOS 安装目录的 manifest 属 root，应用用户无写权限，版本写入被静默吞掉。新增 `writeAppVersion()`：逐个尝试候选 manifest，全部失败则写 `${VAR_DIR}/app_version` 覆盖文件（readAppVersion 优先读它）。
- **自重启端口竞争**：热更/完整更新后新进程在旧进程退出前启动，抢不到 TCP 8650 导致 standalone UI 不可用。改为 shell 延迟 1.5 秒再拉新进程，确保端口已释放。
- **热更资产名不匹配**：Release 资产以裸文件名（monitor.js/index.html）上传，而热更端点只找 hotpatch_ 前缀名导致下载失败。现兼容两种命名。
- **「验证连接」误刷新全部模型配置**：模型编辑弹窗的「验证连接」按钮原本调用获取模型列表逻辑（fillModelOptionsFromList），会把该 provider 的所有模型配置重写一遍。现改为纯连通性测试：后端 `/api/config/test` 新增 `mode=connectivity`（只返回连通性 + 模型数量 + 延迟，不返回模型列表），前端只提示结果不改动任何配置；「获取模型列表」按钮行为不变。
- 修复「检查更新」页面图标丢失；定时任务「创建任务」按钮无响应（CSS 类名不匹配）；微信通道会话点击报错（showPage → switchPage）；工作流模板专家不存在导致不可用。

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

# fnos-hermes-agent CHANGELOG (v0.20.81 – v0.21.23)

---

# v0.21.23 — 终端 PTY 修复 + Profile 隔离上传/下载/预览（对齐 Studio）

### 新功能
- **终端真实 PTY**：新增 `server/pty_bridge.py`（pty.openpty + setsid + TIOCSCTTY），修复 `bash: cannot set terminal process group / no job control`，Ctrl+C、前后台任务（jobs/fg/bg）、vim 等全屏程序全部可用；支持 resize 控制帧（TIOCSWINSZ + SIGWINCH）。
- **Profile 隔离文件上传**：上传文件按 `profiles/<profile>/uploads/images|files/` 隔离存储，剪贴板图片/文件粘贴、工作区附件均带 Profile；附件 URL 为 `/uploads/p/<profile>/...`。
- **文件下载**：`GET /api/download?path=` 按解析后的真实路径下载用户上传文件与 Agent 生成文件，兼容 local/Docker/SSH/Singularity 等 terminal backend；附件命名 `filename*=UTF-8''`。
- **文件预览**：`GET /api/preview?path=` 支持 HTML/PDF/图片流式预览与文本类（≤8MB）；`GET /api/preview/office` 用 `server/preview_conv.py` 将 DOCX/XLSX/PPTX 服务端转为 HTML（零第三方依赖）。

### 问题修复
- **pty_bridge 丢命令**：控制帧与用户输入同批到达时 `continue` 丢弃剩余输入，首批命令丢失。修复：解析完控制帧后将剩余内容转发给 PTY。
- **xlsx 预览空单元格**：`inlineStr` 单元格的 `<t>` 在 `<is>` 内，`find` 查不到。修复：改用 `c.get("t")` 判断类型 + `iter` 取文本。
- **pptx 预览缺正文**：段落文本在 `a:p`（drawingml 命名空间）而非 `p:p`。修复：按 drawingml 命名空间遍历。
- **会话窗口切换模型不生效**：Hermes 网关 `/v1/chat/completions` 会忽略请求里的 model 字段，始终按 config.yaml 的 `model.default` 执行，导致选了新模型仍用旧模型回复。修复：会话选模型时 monitor 直接热改写网关 config.yaml 的 `model.provider/default`（实测网关每次请求热加载、无需重启，保留完整 agent 工具能力），并保持文件原 owner；改写失败时回退直连 provider。同时修复模块级代码误用 handleFetch 内嵌套的 `_yamlBlockOf`（ReferenceError 被静默吞掉）与原正则 `\Z` 被 JS 当字面量 Z 导致 providers 块截断的问题。
- **测试 zip 生成脚本**：local/central header 字段错位（name length/compressed size/CRC）导致 BadZipFile/CRC 校验失败。
- **热更新/检查更新可能拉到旧 release**：`releases?per_page=1` 按 created_at 排序，重建过的旧 release 会排在前面。修复：改为拉取列表后按 `published_at` 选最新已发布 release。

---

# v0.21.12 — 修复工作流/专家团模式未生效

### 问题修复
- **工作流选择后仍以单点模式工作**：`injectExpertSystem` 注入工作流步骤时，模板变量 `{{request}}`、`{{context}}` 未被替换为用户实际输入，AI 看到的是字面占位符而非真实任务内容，导致无法正确执行工作流。修复：注入时将 `{{request}}` 替换为用户消息、`{{context}}` 替换为空值；同时强化执行规则，明确要求 AI 必须通过 `delegate_task` 按 DAG 依赖顺序逐步执行每个步骤。
- **专家团模式指令不够明确**：补充了更严格的执行规则，强调必须调用 `delegate_task` 而非自行作答。

---

# v0.21.11 — 修复 WS 重连重复请求 + 安装包图标 + 版本号显示

### 问题修复
- **WS 重连时重复请求 LLM**：v0.21.10 的 WS 自动重连功能中，客户端重连后服务器会启动新的 `runChatWS`（不检查缓存），导致同一会话发起两次 LLM 请求。修复：`runChatWS` 入口检查 `_streamResultCache`，若同一会话的流正在运行则等待其完成并返回缓存结果，若已完成则直接发送缓存结果，避免重复请求。
- **安装包图标丢失**：manifest 缺少 `icon` 字段，导致 fnOS 应用中心安装时不显示图标。修复：manifest 添加 `icon = ICON.PNG`。
- **版本号显示两次**：应用中心显示 "0.21.10 0.21.10"，因 `app_version` 覆盖文件与 manifest 版本被重复读取。已清理覆盖文件。
- **UI 显示旧版本号**：`/vol1/@appdata/hermes-agent/app_version` 覆盖文件未随 fpk 更新，导致 UI 仍显示 v0.21.9。热更新现已正确更新该文件。

---

# v0.21.10 — 修复 WebSocket 通话断连：自动重连 + 流结果缓存 + SSE 降级复用

### 问题修复
- **WebSocket 通话中途断开（v0.21.2 起）**：WS 连接因网络波动/代理超时断开时，服务器立即 `abort()` 整个 LLM 流请求，前端降级 SSE 后发起的是全新请求（非继续原流），导致回答不完整/重复。修复方案：
  - **服务器**：WS close 时不再 abort 流，让 LLM 请求自然完成，结果缓存到 `_streamResultCache`
  - **服务器**：SSE 端点检查缓存，若同一会话的流正在运行则等待完成后返回结果，若已完成则直接返回缓存结果（分块模拟流式），避免重新请求 LLM
  - **客户端**：WS 断开后自动重连（最多 3 次，指数退避 2s/4s/8s），重连成功后服务器从缓存返回完整结果；fallback 超时从 15s 延长到 30s
  - **效果**：网络波动时自动重连保持通话；重连失败降级 SSE 时复用已完成的流结果，保证回答完整性

---

# v0.21.9 — UI 大改版：学习轨迹 3D 图谱 / 会话窗口 Studio 布局 / 工作流模板修复 / 模型下拉选择

### 新功能 / 改进
- **学习轨迹页重做**：静态圆形分布改为力导向布局，节点可拖拽（拖后钉住位置）；节点改为径向渐变 3D 球体 + 投影，颜色按分类区分；顶部分类徽章可点击筛选（其他分类节点淡化）；左下角图例；未知分类（如 fnos-knowledge）自动分配专属颜色；详情面板从底部移至图谱右侧（窄屏自动竖排）。
- **会话窗口 Studio 式布局**：右侧工作区面板（大纲/文件/终端）不再从顶部浮现遮挡按钮，改为在 header 下方展开；背景改为与聊天区一致的白色；头部新增「多会话」按钮（工作区在前、多会话在后），可随时强制展开/收起多会话标签栏；左侧会话列表背景统一白色，头部高度与聊天 header 对齐（50px）。
- **Agent / 通讯频道模型配置改为下拉选择**：原手动输入框改为按 Provider 分组的下拉列表（仅列启用模型），保留「跟随默认配置」选项；旧值不在列表中时自动补一个自定义项，不丢数据。

### 问题修复
- **工作流模板「未找到工作流模板」**：46 个预置模板的 key 含 `\`（如 `dev\pr-review`），内联 onclick 字符串中被 JS 转义吃掉导致查找失败。全部改为 `/` 分隔；应用按钮改用 `data-wfkey` 属性传参，查找处增加反斜杠归一化兼容。
- **窄视口聊天 header 按钮纵向堆叠溢出**：`.chat-header .right` 补上 flex 布局。

---

# v0.21.8 — 修复进入更新页后侧边栏「更新」图标丢失

### 问题修复
- **更新页丢图标根因定位（非 SVG/缓存问题）**：`checkHermesUpdate()`/`checkAppUpdate()` 用全局 `event.target` 获取按钮；点击侧边栏「更新」导航后 `switchPage('updates')` 自动调用二者，此时全局 `event` 仍是导航按钮的点击事件，`btn.textContent='检查中…'/'检查更新'` 直接把导航按钮里的 SVG 图标抹掉。现改为显式传 `event` 参数 + `currentTarget` 且仅接受 BUTTON 元素，自动调用时不再触碰任何 DOM。
- **同类隐患清理**：`validateProvider()` 同样改用显式 event + `_resolveCheckBtn()` 安全解析。

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

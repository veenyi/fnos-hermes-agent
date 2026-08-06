# fnos-hermes-agent CHANGELOG (v0.20.81 – v0.21.81)

---



# v0.21.81 — 我的专家删除按钮 + 回退模型刷新持久化修复 + 升级保留配置防御（恢复版本迭代）

> 用户反馈：①已安装的专家要有删除按钮；②回退模型刷新页面又没了；③更新会丢配置；④相同版本号导致无法手动安装更新 → 恢复版本迭代。

## 修复

1. **我的专家删除按钮**（index.html）：我的专家卡片新增「删除」按钮（deleteMyExpert → DELETE /api/profiles/:id → 刷新列表与会话树）；后端 DELETE profiles 补 token 鉴权保护
2. **回退模型刷新丢失**（monitor.js）：根因——GET /api/config 硬编码 `fallback_providers: []`，前端刷新永远拿到空。修复为从 `config.json` 读取已保存的回退列表（实测读取回 sensenova1）
3. **升级保留配置防御**（cmd/install_init + monitor.js auto-update）：
   - install_init 升级检测增强：TRIM_PKGHOME 未传时探测多个实际路径的 config.yaml（/var/apps/hermes-agent/home、/vol1、/vol3），防误判「全新安装」清空 providers 配置
   - 自动更新（appcenter-cli install-fpk）显式传 TRIM_APPDEST/TRIM_PKGHOME/TRIM_PKGVAR 环境变量，确保升级识别已有配置
4. **连接器 MCP 服务器消失自愈**（monitor.js，用户反馈"MCP 服务器设置后过一段时间消失"）：
   - 根因：config.yaml 曾 YAML 损坏（hermes 忽略损坏配置 → MCP 工具丢失）；且 hermes 保存配置等外部写入可能覆盖 mcp_servers 块
   - 修复：`_moduleLevelAutoRegisterMcp` 改为**合并模式**（保留用户手动配置的非 conn-* MCP，conn-* 按凭证补齐）+ **每 3 分钟定期自愈**（mcp_servers 被外部抹掉自动补回）；已实测"手动抹掉 → 重启/定期自动恢复"
5. **恢复版本迭代**：v0.21.81（不再固定 80——相同版本号导致 fnOS 拒绝覆盖安装）

## 验证

- 回退 GET 实测返回 `["sensenova1"]`；MCP 自愈实测（抹掉 mcp_servers → 自动恢复 conn-tencent-ima）；install_init 语法 + 部署确认（102/249）；monitor/index 语法通过；服务 healthy；WebDAV 已同步

---



# v0.21.80 增强 — 应用内自动更新（appcenter-cli 直装）+ 飞牛操作员专家全面增强

> 用户需求：①充分学习飞牛开发平台（appcenter-cli / 开放 API / 更新日志）把「飞牛操作员」专家权限全面维护加强；②实现应用内自动更新——用户检查到新版本后可一键安装升级包，无需手动下载。

## ① 应用内自动更新（不再需要手动下载 FPK）

- **机制确认**：fnOS 提供 `appcenter-cli`（/usr/local/bin/appcenter-cli）——`install-fpk xxx.fpk` 可直接安装/升级应用（覆盖安装保留配置）
- **权限**：102/249 已配置 sudoers 白名单（`/etc/sudoers.d/hermes-appcenter`：hermes-agent 免密执行 appcenter-cli），实测 `sudo -n appcenter-cli list` 通过
- **后端**（monitor.js）：`POST /api/app/auto-update` —— 查询 GitHub Release 最新 FPK 直链 → 下载到 /tmp → 校验 gzip 头 → `sudo -n appcenter-cli install-fpk` 安装升级 → 返回结果
- **前端**（index.html）：更新页发现新版本时显示两个按钮——「⚡ 自动更新」（一键下载安装，期间应用重启）与「下载安装包 (.fpk)」（跳 GitHub/网盘手动下载兜底）
- 下载加速：GitHub 直连慢时可改用「下载安装包」走加速方案或用户飞牛网盘

## ② 内置专家「飞牛操作员」全面增强（对齐飞牛开发平台）

- 技能扩充：+code_execution、+skills
- 提示词全面覆盖平台能力：
  - **appcenter-cli**：install-fpk/install-local/list/start/stop/check/status/uninstall/default-volume/manual-install
  - **开放平台 API**：POST /api/v1/trimapp + TRIM_API_TOKEN（系统平台配置/共享授权/用户授权/文件权限/路径转换）
  - **应用中心体系**：FPK 结构、回调脚本、三目录配置持久化、热补丁、自动更新
  - **运维域**：存储卷/Docker/日志/网络/备份/用户权限
- 快捷提问补充：查看已安装应用、appcenter-cli 安装升级、查询共享授权等

## 验证

- 更新检查接口正常（current=latest=0.21.80，download_url 就绪）；sudoers 免密实测通过；服务 healthy
- monitor.js/experts-data.js/index.html 语法通过；102/249 热更；WebDAV 已同步

---



# v0.21.80 — 用量统计根治 + 内置专家/工作流编辑 + 居中统一 + 连接器提示

> 用户反馈：①用量统计没数据了；②内置专家/工作流需允许编辑；③团队/工作流/定时文字居中不统一；④连接器功能不行；⑤桌面图标一大一小。

## ① 用量统计根治（monitor.js /api/usage）

根因：dashboard 的 analytics 依赖 **active profile 的 state.db**，而应用的 active profile 无 state.db（会话实际存在 `sessions/sessions.json`）→ dashboard 统计恒为 0（"用量突然没数据"）。修复：**主源改为直接统计应用自己的会话文件**（SESSIONS_DIR/*.json：总会话/总消息/按模型/按日），dashboard analytics 仅作可选补充（tokens）。实测恢复真实数据（2 会话/64 消息/按日分布）。

## ② 内置专家允许编辑设定（专家页「内置专家」tab）

- 卡片新增「编辑设定」按钮 → 编辑弹窗（名称/图标/简介/系统提示词/技能/快捷提问）
- 保存到覆盖层 `PUT /api/experts/:slug`（`VAR_DIR/experts-overrides.json`），渲染时套用（不创建副本）
- 确认：**工作流专家 269 在扩展页「专家」tab 与专家页「内置专家」tab 完全同源**（共用 AGENCY_PERSONAS）——在本页编辑即两边同步；内置精选 30 也支持编辑

## ③ 工作流允许编辑（扩展页「工作流」tab）

- 模板卡片新增「编辑」按钮 → 编辑名称/分类/描述 → 保存到 `extensions.workflow_templates_override` 覆盖层（卡片标注「已编辑」）
- 应用后的 DAG 步骤编辑（原有）保持不变

## ④ 文字居中统一

`.wf-intro` 加 `text-align:center`——工作流/定时任务页说明与团队页空状态统一居中。

## ⑤ 连接器提示（腾讯 IMA 等配置后 AI 用不到）

- 保存成功提示改为「已保存，正在重启网关以加载连接器工具（约 5 秒后生效）」+ 6 秒后自动刷新
- 根因排查：保存后网关重启为异步尽力而为（失败静默）+ **聊天若走直连 provider 则无工具**（连接器工具仅经网关 agent 路由可用）——建议对话模型使用「Hermes 网关」配置的 provider 才能调用连接器/MCP 工具

## 验证

- 用量接口返回真实数据（102）；专家覆盖 PUT/GET 闭环通过（测试已清理）；monitor.js 语法 + index.html 脚本通过；WebDAV 已同步

---



# v0.21.79 — 官方 Dashboard 不适配页提示（chat/system 空白 + 更新失败误导报错）

> 用户反馈（严重）：①dashboard/chat、dashboard/system 打开没显示（空白黑屏）；②更新 Hermes 报 `Not a git repository. Please reinstall`。

## 根因

均为**官方 dashboard / hermes CLI 上游与发行模式（vendored 源码）的不适配**，应用自身对应功能正常：

1. **dashboard/chat 空白**：官方聊天页依赖 PTY 终端桥（xterm.js + /api/pty WS），在应用门户（8650 代理）下无法渲染
2. **dashboard/system 空白**：该页调用的 `/api/system` 在 hermes 0.20 上游不存在（此前已确认）
3. **更新失败**：官方 `hermes update` 走 git 检查（`update_cmd.py` 检测 `.git`），而发行模式的 hermes-src 是内置源码（非 git 克隆）→ 报误导性 "Not a git repository. Please reinstall"

## 修复

1. **monitor.js**：dashboard 代理拦截 `/chat`、`/system` 路由，返回**中文提示页**（说明该页不适配原因 + 引导应用内替代：「对话」页 /「概览」页），不再显示空白
2. **update_cmd.py**：非 git 分支改为中文指引——「当前为内置源码安装（非 git 仓库），官方 hermes update 不适用；请使用应用中心 FPK 或应用内『更新』页」，替代误导的 reinstall 提示

## 验证

- 249：`/proxy/dashboard/chat`、`/system` 均返回提示页（含「此页不适配」）；update_cmd.py 修复在位；服务 healthy
- monitor.js 语法通过；WebDAV 已同步（v0.21.79.fpk）

## 说明

应用自己的「对话」「概览」「更新」页功能完整，官方 dashboard 的上述入口仅作提示引导。

---



# v0.21.78 — 多项修复：自动朗读默认关 / 新建目录权限 / pip 清华源 / profile 中文名碰撞 / 通道会话提示

> 用户反馈：①语音设置自动朗读要默认关闭；②新建会话目录选择器新建目录报权限不足；③群里反馈：通道会话 fetch 失败、创建 Agent 报 profile 已存在、安装 hermes-agent 报 PyPI 镜像 403；④用户自己遇到网关连接失败。

## 修复

1. **自动朗读默认关闭**（ui/index.html）：默认值从「非 0 即开」改为「仅 1 才开」——新用户默认不朗读；已手动开启的用户不受影响
2. **新建目录权限**（monitor.js `/api/files/mkdir`）：相对路径拼 `WORKSPACE_ROOT`（与 GET/DELETE 一致），修复目录选择器「+目录」EACCES（此前相对路径写到 monitor 进程 cwd）
3. **PyPI 镜像换清华**（install_callback + monitor.js）：阿里云镜像返回 403 Forbidden 阻断 hermes-agent 安装/升级 → 全部切换 `pypi.tuna.tsinghua.edu.cn`（更稳定）
4. **profile 中文名碰撞**（monitor.js 创建 profile）：中文名被替换成纯下划线（「法律顾问」→「____」）撞上历史遗留 `______` profile 导致「已存在」误报 → id 全为下划线/为空时用时间戳保证唯一
5. **通道会话提示友好化**（ui/index.html）：加载失败不再显示技术错误（Failed to fetch），改为「通道会话服务暂不可用（网关/仪表盘未就绪），请稍后刷新重试」

## 网关连接失败排查结论

- gateway 稳定（crash_loop=false、日志 0 ERROR），agent 日志正常；「请求失败: terminated」为**网关重启瞬间/网络抖动的连接中断**（非持续故障），重试即可
- 建议：遇到时刷新重试；如频繁出现请提供具体时间点便于对照 gateway.log

## 验证

- mkdir 相对路径创建 + 清理实测通过；服务 healthy；WebDAV 已同步（v0.21.78.fpk）

---



# v0.21.77 — 侧边栏可滚动（矮窗口 / 内嵌 iframe 下功能完整显示）

> 用户反馈：通过本地 Launcher 内嵌打开时「功能显示不全」——侧边栏底部菜单（定时/记忆/轨迹/用量/更新/设置）被裁切且无法滚动访问。

## 根因

`.global-sidebar` 无 overflow 滚动：14 个导航项在矮视口（内嵌 iframe 约 640px 高）下底部菜单溢出被裁，且不可滚动。

## 修复（ui/index.html）

- `.global-sidebar` 增加 `overflow-y:auto;overflow-x:hidden`：菜单超出时侧边栏可滚动，底部功能（记忆/轨迹/用量/更新/设置）在任意窗口高度都能访问
- 细滚动条样式（4px 半透明，暗色融合）
- 配套：本地 Hermes Launcher 内嵌高度 70vh→82vh、应用窗口 1180×860→1280×940

## 验证

- index.html 脚本语法通过；102/249 已热更；WebDAV 已同步（v0.21.77.fpk）

---



# v0.21.76 — 知识库/记忆种子内容 + 自动沉淀机制（技能使用自动记录、「记住」指令）

> 用户反馈：102/249 上知识库与记忆页都是空的；并确认开工「自动沉淀」（对话/技能使用后自动整理写入知识库）。

## 实现

1. **种子内容**（monitor.js `_seedKnowledgeAndMemory`，启动时自动写入，仅文件不存在时）：
   - 知识库 `README.md`：知识库使用说明 + 建议目录结构（概念/技能使用/对话沉淀/项目）
   - 记忆 `notes.md`：笔记基础框架（用户偏好/环境信息/项目上下文），记忆页不再空白
2. **自动沉淀 API**（monitor.js）：
   - `POST /api/kb/settle`：type=skill 按日期追加到知识库「技能使用/YYYY-MM-DD.md」；type=note 追加到「沉淀笔记.md」
   - `POST /api/memory/append`：追加到记忆 MEMORY.md / notes.md；均入 writePaths 令牌保护
3. **前端自动沉淀**（index.html）：
   - **技能使用自动记录**：对话中调用的工具/技能（onTool 收集）在回复完成后自动写入知识库「技能使用」——每次对话用了什么技能一目了然，形成技能使用沉淀
   - **「记住」指令**：消息含「记住/请记住/记下来」→ 内容自动追加到记忆 notes.md（toast「🧠 已记住」）

## 验证

- 102/249：种子生效（知识库 README + notes.md 89 字节）；kb/settle 创建「技能使用/2026-08-06.md」；memory/append 写入 notes 成功；测试残留已清理
- monitor.js 语法 + index.html 脚本检查通过；两台 monitor 重启后 healthy；WebDAV 已同步

---



# v0.21.75 — Obsidian 技能内置固化（每台机器必有、删除自动恢复）

> 用户指出：知识库依赖 Obsidian 技能，但 hermes 技能系统只发现 `$HERMES_HOME/skills`（+ config external_dirs），`hermes-src/skills` 的 bundled 技能**默认不可见**——不是每台机器都有这个技能，需要固化内置、无法删除。

## 实现

1. **技能固化部署**（monitor.js `_deployBuiltinSkills`，启动时执行）：内置技能清单 `["note-taking/obsidian"]`，从 `APP_DIR/hermes-src/skills` 复制到 `DATA_DIR/skills`（缺失才补、不覆盖用户已有/修改内容）——每台机器装上应用即有该技能，**即使被删除也会在下次启动自动恢复**
2. **技能进包**：`skills/note-taking/obsidian/` 加入项目固化技能目录（与 cloudflare-tunnel 并列），随 FPK 分发（已验证打进包）
3. 配合 v0.21.74：`OBSIDIAN_VAULT_PATH` 指向 `DATA_DIR/knowledge`——知识库页面 + AI 的 Obsidian 技能读写同一 vault，全链路打通

## 验证

- 249 受控测试：删除 `data/skills/note-taking/obsidian` → 重启 monitor → 自动恢复 ✓（"无法删除"保证成立）
- 102/249 均确认 obsidian 技能在位；包内 `skills/note-taking/obsidian/SKILL.md` 确认打包
- monitor.js 语法通过；WebDAV 已同步

---



# v0.21.74 — 知识库（Obsidian 风格 vault：文件树 + 笔记阅读/编辑 + 反向链接）

> 用户需求：左侧新增「知识库」菜单，所有 Hermes 学习到的内容、使用过的技能沉淀到 Obsidian 风格的独立页面，可浏览、可编辑，让 AI 越用越聪明。

## 实现

1. **后端**（monitor.js）：
   - 知识库 vault：根目录优先 `OBSIDIAN_VAULT_PATH` 环境变量，默认 `DATA_DIR/knowledge`（Obsidian 兼容：.md + frontmatter + `[[wikilink]]`）
   - API：`GET /api/kb/tree`（递归文件树）、`GET /api/kb/read`、`POST /api/kb/write`（写/保存，自动补 .md）、`POST /api/kb/new`（新建笔记，frontmatter 模板带 created/tags）；写操作入 writePaths 令牌保护
2. **前端**（index.html）：
   - 左侧菜单新增「📚 知识库」入口
   - 知识库页两栏：左文件树（目录展开/收起、当前笔记高亮）+ 右笔记区（标题/路径/编辑/删除，frontmatter 属性展示，markdown 渲染，`[[wikilink]]` 转内部链接点击跳转，底部「反向链接」自动搜索引用当前笔记的其它笔记）
   - 新建笔记支持路径（如「概念/Agent」自动建目录）
3. **串联 AI**：102/249 的 `.env` 配置 `OBSIDIAN_VAULT_PATH=DATA_DIR/knowledge` —— Hermes 内置 Obsidian 技能（bundled）读写同一 vault，AI 学习沉淀与 UI 浏览编辑打通

## 验证

- 102/249：kb/tree、kb/new（frontmatter 正确）、kb/write、kb/read（中文路径 URL 编码正常）、kb/delete 全链路通过
- monitor.js 语法 + index.html 脚本检查通过；monitor 重启后服务 healthy；WebDAV 已同步

## 后续

自动沉淀机制（技能使用/专家学习自动写入知识库）为下一迭代——当前已支持手动创建/编辑 + AI 通过 Obsidian 技能写入。

---



# v0.21.72–73 — 通讯渠道独立启停开关（对齐原版 dashboard 的分别控制）

> 用户需求：每个通讯平台要有单独开关，可以分别开启/关闭（像原版 dashboard 那样）。

## 实现

1. **后端**（monitor.js + custom_routes.js）：
   - 机制确认：hermes 网关按 `platforms.<id>.enabled` 决定渠道启停（gateway 启动时跳过 enabled=false）
   - 新增 `POST /api/channels/:id/toggle`（写 `platforms.<id>.enabled` + 重启网关生效，writePaths 令牌保护）
   - `_listChannels` 输出增加 `enabled` 字段（默认启用）
   - **排障关键**：`/api/channels` 实际由 `custom_routes.js` 的 `handleCustomRoute` 先拦截（monitor.js 的新代码从未执行！），custom_routes.js 的 `_listChannels` 同步加 `enabled` 字段——两处必须保持一致
2. **前端**（index.html）：通讯卡片已配置渠道显示「已启用/已禁用」toggle 开关（点击切换，重启网关生效提示），未配置渠道保持「配置/扫码登录」按钮

## 验证

- 102/249：`/api/channels` 10/10 渠道含 enabled；toggle 全链路（禁用→写入 config.yaml enabled:false→恢复→healthy）通过
- custom_routes.js 语法 + index.html 脚本检查通过；monitor 已重启、服务 healthy；WebDAV 已同步

---



# v0.21.71 — 工作区文件夹目录选择器（浏览/新建，替代下拉）

> 用户反馈：v0.21.70 的下拉选择不够用——新会话要放到新文件夹，需要像文件浏览器一样浏览目录并能新建。

## 实现（ui/index.html）

新建会话弹窗「工作区文件夹」改为 **输入框 + 📂 浏览按钮**，点击弹出**目录选择器**：

- 复用 `/api/files?path=` 浏览工作区目录树（根 = `DATA_DIR/workspace`），只列目录，点击进入、⬆ 上级、⟳ 刷新
- **+目录** 按钮：在当前目录新建子文件夹（`/api/files/mkdir`），新建后立即显示——新会话放新文件夹一步到位
- 「选择当前目录」回填相对路径（根 = 默认工作区），可随时再点浏览换目录或手输

## 验证

- 逻辑单测 5/5 PASS（根显示、子目录显示、上级、根不动、回填）；index.html 脚本语法通过
- 102/249 已热更（服务 healthy）；WebDAV 已同步（v0.21.71.fpk + 更新记录）

---



# v0.21.70 — 新建会话「工作区文件夹」可选择（下拉 + 自定义）

> 用户反馈：工作区文件夹只有文本输入，不给选择。

## 实现

1. **后端**（monitor.js）：新增 `GET /api/workspace/dirs`，列出 `DATA_DIR/workspace` 下的一级子目录（排序返回）
2. **前端**（index.html）：新建会话弹窗的工作区输入框加 `datalist`——打开弹窗时拉取已有工作区目录，**可下拉选择**已有工作区，也可自由输入新名称（datalist 原生组合）

## 验证

- 102：`/api/workspace/dirs` 返回 `["fnos-ops","reverse-skill"]`；249：返回空数组（工作区无子目录，正常）
- monitor.js 语法 + index.html 脚本检查通过；两台 monitor 已重启、服务 healthy；WebDAV 已同步

---



# v0.21.69 — 对齐官方 v0.20.0：redirect 中途纠偏 + Grounded Citations 证据引用

> 用户指出 v0.20.0 的两项官方能力未集成：① redirect（任务中途补充修正，当前工作状态与最初要求保留）；② grounded-citations（带编号引用、来源台账、逐字证据的研究工作流）。

## ① Redirect 中途纠偏（ui/index.html + 网关原生能力）

调研确认：**网关层已原生支持 redirect**（busy follow-up：`busy_input_mode=interrupt` 默认模式 + `agent._supports_active_turn_redirect` → 忙时收到文本消息自动调 `agent.redirect(text)`，保留已完成工具结果、纠偏作为真实 user 消息注入重试；`steer` 模式在工具边界注入；子 agent/压缩中自动降级 queue）。前端补齐体验：

- **流式回复中输入消息 = 纠偏**：发送时 toast「🎯 已发送纠偏（redirect）」，用户消息带「🎯 纠偏」标签（AI 明确这是中途修正）
- **输入框 placeholder 流式中提示**：「回复中…可输入消息实时纠偏（redirect）」，结束自动恢复
- 停止按钮保持独立（中断整轮 vs 纠偏二选一）

## ② Grounded Citations 证据引用（ui/index.html + 内置 skill）

调研确认：官方实现是 **Skill 层**（`skills/research/grounded-citations`，含 `sources.py` 台账：编号台账、`[n]` 发射、`[unverified]` 标记、`verify --evidence` 逐字证据门禁），核心运行时不透传 citations 字段——模型按 skill 提示输出 `[n]` 内联标记 + `Sources:` 块。该 skill 已在包内（hermes-src/skills/research/grounded-citations v1.1.0，249 确认就位）。前端补齐渲染：

- **`Sources:` / `## Sources` 块 → 来源卡片**（`preprocessSources`：逐行 URL 转可点击链接卡片，标题提取）
- **正文 `[n]` / `[1,2]` 纯数字引用 → 引用角标**（`renderCitations`，排除 markdown 链接形式，真实链路验证不误伤）
- 样式：`.citations-block` / `.cite-item` / `.cite-ref`（来源卡 + 蓝色角标）

## 验证

- 语法检查通过；逻辑单测：Sources→来源卡 PASS、[n]→角标 PASS、真实 marked 链路链接不误伤 PASS、流式中发送=纠偏 PASS
- 102/249 已热更（服务健康）；WebDAV 已同步（FPK + 更新记录）

---



# v0.21.68 — 新建会话模型下拉修复（[object Object] 显示）

> 用户反馈：会话窗口右侧「新建会话」的模型下拉报错，选项显示 `[object Object]`。

## 根因

`openNewSessionModal` 加载模型时，`/api/config` 返回的 `providers[].models` 元素是**对象**（`{id, name, enabled}`），原代码 `esc(m)` 直接把对象字符串化为 `[object Object]`，下拉里出现 4 个相同错误项。

## 修复（ui/index.html）

新建会话模型加载改为与 `buildModelOptionsHtml` 一致的逻辑：提取 `m.id/m.name` 渲染选项，按 provider 分组（optgroup），过滤 `enabled:false` 的模型，provider 无 models 时用 `p.model` 兜底。

## 验证

- 逻辑单测 5/5 PASS：无 [object Object]、模型名正确、兜底生效、禁用模型过滤、optgroup 分组
- index.html 语法检查通过；102/249 已热更（服务健康）

---

# v0.21.67 — 打包脚本修复：FPK 曾缺失运行资源（marked 库 + Dashboard 前端 assets）

> 用户反馈：用最新 FPK 安装后 markdown 无格式、Dashboard 启动崩。解包定位：**安装包本身缺文件**——`app/ui/scripts/`（marked/purify/qrcode）与 `hermes-src/hermes_cli/web_dist/assets` 均未进包。

## 根因（build-slim.sh）

robocopy `/XD` 按**目录名**排除 `assets scripts`（本意排除 hermes-src 顶层开发目录），robocopy 按名匹配**所有层级**同名目录 → 误伤 `app/ui/scripts`（markdown 渲染库）与 `web_dist/assets`（dashboard 前端资源）。且 `/E` 增量复制不清除旧副本残留，`/XD` 正斜杠路径 robocopy 不识别导致排除静默失效。

## 修复（build-slim.sh）

1. `/XD` 仅排除 `.git`/`pkg`（不再按名排除）
2. 复制后用 `rm -rf` 显式删除副本中 hermes-src 的开发/文档目录（tests/apps/website/docs/.github/assets/contributors/scripts）
3. 打包前**断言运行资源必须在**（`ui/scripts/marked.min.js`、`web_dist/assets` 缺失即中止），防止再次打出残缺包

## 验证（解包检查 v0.21.67）

- ✅ `ui/scripts/`（marked 38K + purify 21K + qrcode 25K）
- ✅ `web_dist/assets/`（前端 bundle 齐全）
- ✅ hermes-src 开发目录全部排除（体积 43.9MB，含 web_dist 运行资源）
- ✅ lifecycle_guard NUL 修复（v0.21.66）与 monitor 信号修复在位

## 重要

**v0.21.66 及更早的 slim 包有缺陷（缺上述资源），请使用 v0.21.67 安装。** 已用旧包安装的机器（如 249）需用 v0.21.67 覆盖安装或手动补齐资源。

---



# v0.21.66 — 249 Dashboard 启动崩溃（web_dist 缺失）+ terminal 工具 NUL 字节崩溃修复

> 用户反馈（249 NAS）：更新到最新后 Dashboard 完全启动不起来；gateway 报 `tools.terminal_tool: terminal_tool exception`。

## ① Dashboard 启动崩溃：web_dist/assets 缺失（249 运行时）

`mount_spa` 挂载 `web_dist/assets` 时 `RuntimeError: Directory ... does not exist` → dashboard 启动即崩（crash 循环）。249 的 `hermes-src/hermes_cli/web_dist` 仅 600K（缺 assets/，同步不完整；完整版 3.1M）。修复：从本地包补全 web_dist（assets + fonts + index.html，chown hermes-agent），dashboard 恢复 READY（9219 监听）。

## ② terminal 工具崩溃：lifecycle_guard 对 NUL 字节路径修复不完整（hermes 上游 bug）

`terminal_tool` 执行命令时 lifecycle_guard 扫描引用脚本：上游 #76762 修复只在 `Path.resolve()` 捕获 `ValueError: embedded null byte`，但 `_read_referenced_script` 内 `os.open(path)` 对含 NUL 路径再次抛 ValueError（不在 except OSError 范围）→ 命令执行失败。修复（`cron/lifecycle_guard.py`）：`os.open` 的 except 增加 `ValueError`。249 单测 3/3 PASS（NUL 路径返回 (None,False)、含 NUL 命令正常返回、正常命令不受影响）。

## 部署

- 249（/vol3/）：web_dist 补全 + lifecycle_guard 修复 + gateway/dashboard 重启，全部 healthy（8650/8742/9219 监听）
- 102（/vol1/）：lifecycle_guard 修复已上传（gateway 下次重启生效）

---



# v0.21.65 — 手机端恢复「语音设置」按钮入口

> 用户反馈：手机端打开设置看不到流式对话等语音开关。原因：v0.21.58 手机端精简时把输入工具栏的「语音设置」按钮（`#btnVoiceCfg`）一并隐藏了，而 v0.21.63/64 起语音对话模式、barge-in 打断、音色选择都在语音设置里配置，手机端失去入口。

## 修复（仅 ui/index.html）

- 移动端媒体查询的隐藏列表移除 `#btnVoiceCfg`：语音设置按钮在手机端恢复显示（输入工具栏齿轮），可打开语音对话模式 / 说话打断 / 音色 / 自动朗读等全部语音配置
- 102 热更后服务健康

---



# v0.21.64 — 流式语音朗读（边生成边说话）+ Barge-in 说话打断（对齐官方 v2026.8.3 语音体验）

> 用户引用官方 release 说明：Hermes 语音模式应支持「speaks clause-by-clause as the response streams」（回复流式生成时逐句朗读）+「interrupt it mid-sentence by just talking」（开口说话打断）。此前实现是回复完整生成后再整段朗读，无打断。

## 实现（仅 ui/index.html，服务端 speak-stream 协议原生支持增量喂文本 + stop 打断）

1. **流式语音朗读**（`_voiceStream*` 模块）：
   - `onDelta` 收到流式文本增量 → 打开 speak-stream WS 后把增量持续喂给服务端（`{"text":增量}` 帧），服务端按句切分合成返回 PCM，前端 `voicePlayNext` 顺序播放 → **AI 生成一句、立刻朗读一句**（clause-by-clause）
   - `onDone` 发 `{"done":true}` 收尾（剩余缓冲句子合成完自然结束）；`onError`/手动停止时 `_voiceStreamStop` 发 `{"stop":true}`
   - 流式朗读未激活时（WS 失败等）回退原「整段朗读」
2. **Barge-in 说话打断**（`_barge*` 模块）：
   - 朗读开始时 `getUserMedia` 打开麦克风 + `AudioContext/AnalyserNode` 监听环境音量（120ms 轮询 RMS）
   - 检测到用户说话（RMS>0.12）→ `_voiceBargeIn`：发 `{"stop":true}` 停止朗读 → 自动开始录音听用户（350ms 后 `startVoiceRecord`）→ 识别后发送，形成"你开口就插话"体验
   - 语音设置新增「说话打断朗读（barge-in）」开关（`fnos-voice-barge`，默认开；关闭则不监听打断）
3. **语音对话循环衔接**：流式朗读自然结束（WS onclose）触发 `_voiceChatMaybeRestart`，与 v0.21.63 语音对话模式打通（朗读完自动再录音）

## 验证

- index.html 3 个内联脚本语法通过；逻辑单测 3/3 PASS（流式喂文本+done、音量触发打断、开关关闭不打断）
- 102 热更后服务健康

## 使用说明

自动朗读开启（默认）即生效：AI 回复时逐句朗读，你开口说话立即打断并开始听。打断监听需浏览器授权麦克风（首次会弹出权限请求）；HTTP 明文访问（8650）下麦克风不可用，请用 `https://NAS:5667` 或隧道访问。

---



# v0.21.63 — 语音对话模式：对齐官方 Hermes Voice Mode（免手连续语音会话）

> 用户反馈：Hermes v0.20 官方支持「语音对话模式」（Voice Mode，回合制免手语音会话），我们此前只实现了语音转文字（STT→发送→文字回复），使用场景不对。参考官方文档（use-voice-mode-with-hermes：交互式麦克风循环 = 说话→转录→回复→TTS 朗读→循环自动重启）实现完整语音会话。

## 实现（仅 ui/index.html）

1. **语音设置新增「语音对话模式」开关**（`localStorage.fnos-voice-chat`）：
   - 开启后点麦克风进入免手语音会话：说话 → 点麦克风停止发送 → 助手回复 → 自动朗读 → **朗读完毕 600ms 后自动重新开始录音**（toast「语音对话中，请说话…」），无需再操作，形成连续语音对话
   - 关闭开关即结束循环；循环中 15s 无语音自动结束
2. **循环状态机**（`_voice.chatLoop`）：
   - `_voiceChatMaybeRestart`：朗读播放结束（WS 流式 finishOk / 降级 Audio.onended）后自动重启录音
   - `_voiceChatSilent`：录音过短/无语音/空转写时重试，**连续 3 次未听清自动退出循环**（防死循环）
   - 语音对话中即使「自动发送」关闭也强制发送（保证循环不断）；录音超时自动退出
3. 交互说明（设置弹窗文案）：「免手连续对话：点麦克风说话，说完再点发送，回复朗读后自动重新录音；关闭开关即结束」

## 验证

- 状态机逻辑单测 5/5 PASS：开始录音置循环、停止后循环保持、朗读后自动重启、3 次未听清退出、开关关闭不重启
- index.html 3 个内联脚本语法检查通过；102 热更后正常

## 依赖说明

语音对话循环依赖「自动朗读回复」开启（默认开）：回复朗读完才触发自动重启录音。STT 中文识别（v0.21.61 language=zh）与中文音色（v0.21.60）均在此循环中生效。

---



# v0.21.62 — 移动端浏览器兼容：100vh → 100dvh 动态视口（Edge/Chrome 底部遮挡修复）

> 用户反馈：手机端三个浏览器对比，只有夸克正常，Edge 和系统自带浏览器显示异常（底部输入框被遮挡/布局跳动）；而 Edge 访问携程等正常站无问题——定位为应用自身的移动端视口兼容问题。

## 根因

`.app` 及弹窗/抽屉使用固定 `height:100vh`。移动端浏览器（Edge/Chrome 标准内核）地址栏展开/收起时，100vh 视口高度**不随动态视口变化**：地址栏占位时底部输入框被浏览器工具栏/系统导航遮挡或布局跳动。夸克浏览器对 vh 的处理策略不同（默认沉浸/全屏），所以表现"正常"。

## 修复（仅 ui/index.html）

- `.app`、`.chat-rail`（移动抽屉）、`.modal-backdrop/.modal-overlay` 全部改为 `height:100vh;height:100dvh`（dvh=动态视口高度，带 100vh 回退兼容旧浏览器）
- 地址栏展开/收起时布局自动适配，底部输入框始终可见

## 验证

- index.html 3 个内联脚本语法检查通过；102 热更后页面正常
- 建议用户分别用 Edge/自带浏览器强刷后确认

## 备注

手机底部浏览器自带的地址栏/工具栏属于浏览器 UI（非应用元素），配合浏览器全屏模式或 PWA「添加到主屏幕」体验最佳。

---



# v0.21.61 — 语音输入强制中文识别（STT language=zh）+ 移动端输入框聚焦滚动

> 用户反馈：语音输入说中文，识别结果变成英文；手机端底部输入框显示异常。

## ① STT 中文识别修复（NAS 运行时配置）

根因：whisper-base 小模型对中文语音的**自动语言检测**不稳定（gateway 进程 locale 还是 en_US.UTF-8，实测中文语音被判为英文）。修复：主 `config.yaml` 的 `stt.local` 增加 `language: zh`（`_resolve_stt_language` 解析顺序：`stt.<provider>.language` → `stt.language` → env → 自动检测；配置后强制中文）。

闭环验证（102）：用 edge-tts 合成中文语音「今天天气很好，我们出去散步吧」→ faster-whisper（language=zh）识别结果「今天天氣很好,我們出去散步吧」，detected lang=zh。

## ② 移动端输入框聚焦自动滚动（ui/index.html）

输入框 focus 后 320ms 执行 `scrollIntoView({block:'nearest'})`，键盘弹出时把输入框滚入可视区，缓解被手机键盘/浏览器工具栏遮挡；桌面端 block:nearest 无副作用。

## 备注

手机底部被浏览器自带工具栏（地址栏/导航条）遮挡属于浏览器 UI，非应用元素；建议浏览器全屏模式或改用 `https://NAS:5667` 门户访问。

---



# v0.21.60 — 语音设置新增「声音」选择（TTS 音色切换）

> 用户需求：语音设置里可以选择不同朗读声音。

## 实现

1. **后端**（monitor.js）：
   - `GET /api/voice/config`：返回当前音色（解析 config.yaml 的 `tts.edge.voice`）与可选音色列表（7 个 Edge 音色：晓晓/晓伊/云希/云健/云夏/晓北方言/Aria 英文）
   - `POST /api/voice/config`：写入所选音色到 config.yaml（`_setTopLevelBlock` 行级更新，保留其它配置）；已加入 writePaths 令牌保护
   - `_readTtsVoice` 解析正则须带 `/m` 标志（tts 块在文件末尾时 `^` 无 m 只匹配字符串开头 → 读不到，已修复）
2. **前端**（index.html）：语音设置弹窗新增「声音（朗读音色）」下拉——打开时拉取当前音色与选项列表（当前值不在列表中也保留显示），「试听」按钮先写入所选音色再合成测试语音（真实反馈所选音色），保存时同步写入

## 验证（102）

- GET 读到当前 voice（zh-CN-XiaoxiaoNeural）；POST 切换 zh-CN-YunxiNeural 后 config.yaml 写入成功；切回晓晓后 `/api/audio/speak` 合成正常
- monitor.js `node --check` 与 index.html 3 个内联脚本语法通过；服务 healthy

## 备注

用户反馈 dashboard「system」页面空白：`/proxy/dashboard/api/system` 返回 404——该页面调用的 API 在 hermes 0.20 上游不存在（官方 dashboard 自身问题，非代理/本项目问题）。系统信息请使用应用内「概览」页。

---



# v0.21.59 — 手机端麦克风 400 根治（whisper 模型文件不完整）+ 显示优化

> 用户反馈（手机端）：①语音输入报「语音识别失败：transcribe 400」；②界面显示不全。

## ① 麦克风 transcribe 400 根因与修复（NAS 运行时）

错误详情实为 `Local transcription failed: <|startoftranscript|> token was not found in the prompt`。定位：本地 whisper-base 模型（`${DATA_DIR}/whisper-base`）的 `vocabulary.json` 只有 50258 条（缺 1607 个特殊 token，如 `<|startoftranscript|>`），而 `config.json` 声明 `vocab_size: 51865`——tokenizer 与权重不匹配，faster-whisper 转写直接报错。

修复：从 ModelScope（`Systran/faster-whisper-base`，国内可达，HF 系域名在 NAS/本机均不通）下载完整文件替换：
- `vocabulary.txt`（459861B，51864 条，含全部特殊 token）替换损坏的 `vocabulary.json`（已备份为 `.bad`）
- `config.json`（2309B，原 1036B 不完整）与 `tokenizer.json` 一并替换
- 验证：faster-whisper 加载+转写成功（lang=zh）；完整 API 链路 `/proxy/dashboard/api/audio/transcribe` 返回 `{"ok":true}`

前端配套修复：transcribe 失败时错误信息改为 `j.error || j.detail`（此前后端 400 的 detail 被吞，只显示干巴巴的「transcribe 400」）；录音不足 800ms 直接提示「录音太短」不发起转写。

## ② 消息「播放」按钮中文 TTS 修复（NAS 运行时）

用户反馈：消息朗读只能念英文。根因：默认 TTS provider=Edge，`DEFAULT_EDGE_VOICE = "en-US-AriaNeural"`（英文女声），NAS 无 tts 配置 → 中文文本用英文音色朗读。修复：主 `config.yaml` 增加 `tts: { provider: edge, edge: { voice: zh-CN-XiaoxiaoNeural } }`（`_load_tts_config` 每次合成动态读取 + mtime 缓存自动失效，无需重启）。验证：带 `HERMES_HOME`（真实 gateway 环境）下 voice 解析为 zh-CN-XiaoxiaoNeural，`/api/audio/speak` 中文合成返回 mp3 正常。

排查要点：hermes 侧 `load_config` 的配置路径由 `HERMES_HOME` 决定（有则读 `$HERMES_HOME/config.yaml`，无则 `~/.hermes/config.yaml`）——不带 HERMES_HOME 的测试脚本会误读不存在路径导致"配置没生效"假象。

## ③ 手机端显示优化

- viewport 加 `viewport-fit=cover` 适配全面屏安全区；输入区底部加 `env(safe-area-inset-bottom)` 留白（防系统导航条遮挡）
- 手机端输入框字号 15px→16px（iOS Safari 对 <16px 输入框聚焦自动放大导致错位）
- 隧道页：回源信息改「回源：127.0.0.1:端口（NAS 本机）」避免误用；公网地址旁新增「二维码」按钮（手机扫码直接打开当前有效地址，杜绝旧链接失效问题）＋ Quick 地址会变提示

## 验证

- faster-whisper 1.2.1 加载/转写实测通过；transcribe API 全链路 200
- index.html 3 个内联脚本语法检查通过；102 热更后 MD5 一致、服务健康

---



# v0.21.58 — 手机端浏览器统一精简：顶栏/会话头/输入工具栏去拥挤

> 用户反馈：手机端浏览器打开界面，顶栏与聊天头部图标过多、拥挤（4 张手机端截图对比）。统一在移动端媒体查询（≤768px）中隐藏低频/桌面功能按钮。

## 实现（仅 ui/index.html，移动端媒体查询内追加）

1. **顶栏右侧**（原 5 个按钮 → 2 个）：隐藏「在新标签打开」（`openNewWindow`）、「GitHub 项目」（`openGitHub`）、「跟随系统」（`btnThemeAuto`）；保留白天/黑夜主题切换
2. **聊天头部**：隐藏「工作区」（`wsPanelToggle`，大纲/文件/终端为桌面功能）；保留圆桌讨论与多会话标签
3. **输入工具栏**：隐藏「语音设置」（`btnVoiceCfg`，低频；语音输入麦克风按钮仍在输入框内）；其余按钮保留并支持横向滚动（既有 overflow-x:auto）
4. 移动端会话抽屉汉堡、两级折叠按钮、主题切换等高频入口全部保留

## 说明

手机浏览器地址栏的「⚠️ 192.168.3.102:8650」是浏览器对 HTTP 明文访问的安全提示（非应用元素），改用 `https://NAS_IP:5667`（飞牛门户 HTTPS 入口）访问即可消除。

## 验证

- index.html 3 个内联脚本语法检查通过
- 102 热更后页面正常访问（带 /app/hermes-agent/ 前缀）

---



# v0.21.57 — 折叠按钮合并：消除顶栏/会话头双按钮重叠（PC 与手机端）

> 用户反馈：v0.21.56 后 PC 端与手机端左上角出现两个折叠按钮（顶栏菜单栏按钮 + 会话头折叠按钮），功能重复、视觉重叠。优化为统一入口。

## 实现（仅 ui/index.html）

1. **删除会话头（chat-header）的 desktop-only 折叠按钮**（`railToggle`）——与顶栏 `sidebarToggle` 功能重复；移动端抽屉汉堡按钮保留（打开会话抽屉）
2. **顶栏 `sidebarToggle` 统一为两级折叠入口**（`toggleRail` 循环 0→1→2→0）：按一次收会话树、按两次连菜单栏一起收、第三次恢复全展开；图标随状态切换（收起/展开），标题同步（折叠会话树→折叠菜单栏→展开面板）
3. **清理死代码**：移除 `toggleSidebar`、`iconCollapse`/`iconExpand` 及对已删按钮的全部引用（grep 确认零残留）
4. 折叠态持久化（`localStorage.fnos-rail-state`）、移动端折叠样式覆盖均保留

## 验证

- index.html 3 个内联脚本语法检查通过；无死引用
- 状态机逻辑单测：`toggleRail` 循环 1→2→0→1→2→0（PASS）；localStorage 恢复 state=2（PASS）、非法值兜底 state=0（PASS）

---



# v0.21.56 — 两级折叠：会话树→左侧菜单栏（Octop 式简洁界面）

> 用户反馈：聊天界面不够简洁（"不 nice"），希望隐藏左侧菜单栏；会话折叠按钮按一次折叠会话树、再按一次折叠菜单栏，类似 Octop 的渐进式收起。

## 实现（仅 ui/index.html）

1. **两级折叠状态机**（`_railState`：0=全部展开，1=会话树折叠，2=会话树+菜单栏全折叠）：
   - 聊天页顶部折叠按钮 `toggleRail` 循环 0→1→2→0：按一次收会话树，再按一次连左侧菜单栏一起收起，第三次恢复全展开
   - 状态 1 按钮标题「折叠菜单栏」，状态 2「展开面板」，图标随状态切换（收起/展开箭头）
2. **顶栏新增菜单栏折叠按钮**（`sidebarToggle`，品牌 Logo 左侧，所有页面可见）：菜单栏折叠后即使切到其它页面也能一键展开；与会话折叠按钮联动（折叠时切到 2、展开时回 0）
3. **折叠态持久化**：`localStorage.fnos-rail-state` 保存当前状态，刷新/重进保持（与主题设置同机制）
4. **CSS**：`.global-sidebar.collapsed` 宽度收缩为 0（带 0.2s 过渡动画），移动端媒体查询内同步覆盖（防止 56px 宽度顶掉折叠态）；会话树折叠沿用既有 `.chat-rail.hidden`
5. 折叠状态与页面切换互不干扰：菜单栏折叠后切页保持折叠，主区域自动占满

## 验证

- index.html 3 个内联脚本语法检查通过
- 状态机逻辑单测通过：`toggleRail` 循环 1→2→0→1→2（PASS）、`toggleSidebar` 独立切换（state1→2、state0→2、state2→0 全 PASS）

---



# v0.21.55 — 隧道 URL 提取修复（取最后一个而非第一个）+ 102 运维补全

> 用户粘贴 cloudflared 运行日志反馈，排查发现隧道运行正常（8 项连通性预检全 PASS、公网 200），但存在两个问题：①隧道状态里显示的公网 URL 是旧的已失效地址；②手动重启 monitor 后 fnOS 门户访问报「无法连接后端」。

## ① URL 提取 bug：日志轮转失败时取到第一个旧地址

`_rotateTunnelLog` 的 rename 异常被 catch 静默吞掉（日志轮转失败，多次启动的日志追加在同一文件），而 `_extractTunnelUrl` 用 `match` 取**第一个** trycloudflare URL → 状态里永远显示最早那次启动的地址（已失效）。修复：

- `_extractTunnelUrl` 改为 `matchAll` 取**最后一个** URL（当前活跃地址）
- `/api/tunnel/status` 的恢复逻辑：running 时总是从日志提取最新 URL，与 state 不一致即刷新持久化（防止残留旧地址）
- `_rotateTunnelLog` 失败时打印原因日志（不再静默）

102 实测：monitor 重启后 status 自动把 state.url 从旧的 `airfare-salon-…` 纠正为当前活跃的 `magnitude-hereby-segment-field.trycloudflare.com`，公网访问 200。

## ② 102 运维修正：手动启动 monitor 必须注入 BASE_PATH

手动重启 monitor（为加载新代码）时漏注入 `BASE_PATH=/app/hermes-agent` → fnOS 门户经 `/app/hermes-agent/*` 前缀反代到应用，monitor 不认前缀 → 前端所有 API 404 → 页面报「加载会话失败，无法连接后端」。修正：`start-monitor.sh` 补全 `BASE_PATH=/app/hermes-agent`、`UI_PORT=8650`、`GATEWAY_PORT=8742`、`DASHBOARD_PORT=9219`（已固化于 `/vol1/@appdata/hermes-agent/start-monitor.sh`），重启后带前缀 `curl --unix-socket …/app/hermes-agent/api/health` 返回 200。

## 备注

cloudflared 日志中 `ICMP proxy feature is disabled error="Group ID 901 is not between ping group 1 to 0"` 为无害警告（用户组不在系统 ping 范围内），仅影响 ping 探测，不影响 HTTP 隧道。

---



# v0.21.54 — 102 验证修复：process.kill 信号简写全局失效（TERM/KILL→SIGTERM/SIGKILL）+ cloudflared 下载镜像

> v0.21.53 隧道功能按流程部署到 102 NAS 验证时发现两个问题：①隧道 stop 后 cloudflared 进程不死；②首次下载 cloudflared 走 GitHub 直连在中国大陆仅 ~14KB/s（50MB 需近 1 小时）。

## ① P0 信号 Bug：process.kill "TERM"/"KILL" 简写无效（潜伏全局）

Node 在 Linux 上 `process.kill(pid, "TERM")` 抛 `Unknown signal: TERM`——只接受 `"SIGTERM"`（带 SIG 前缀）或数字信号。monitor.js 中 6 处简写信号（`TERM`×3、`KILL`×3）全部静默失效：被 try/catch 吞掉异常、进程从未收到信号。涉及：

- `stopPid`（gateway/dashboard 停止）：信号从未发出，此前一直靠 `forceKillHermes` 的 `pkill -SIGKILL` 兜底才让「停止/重启」表面可用（waitForExit 空等 1.5s）
- 单实例守卫对旧实例的退出请求（`oldPid`）
- port-guard 对外来进程的清理
- v0.21.53 新增的 `_stopTunnel`（隧道停止 → cloudflared 进程残留，实测 stop 后进程仍在跑）

**修复**：全部改为 `"SIGTERM"` / `"SIGKILL"`（共 6 处），隧道 stop 实测 cloudflared 立即退出。

## ② cloudflared 下载源镜像优先

GitHub 直连下载实测 ~14KB/s（中国大陆网络），改为候选源列表顺序尝试：`ghfast.top` 镜像（实测 2.6MB/s）→ `ghproxy.net` → GitHub 直连兜底。日志记录每个源的尝试结果，全部失败才报错。

## 102 NAS 验证记录（发布前置流程）

- monitor.js/index.html/manifest MD5 与本地一致；monitor 重启（sudo TERM + start-monitor.sh 以 hermes-agent 身份、注入 TRIM_APPDEST/PKGHOME/PKGVAR + MONITOR_SOCKET_PATH）后 gateway/dashboard 自动拉起且 healthy
- `POST /api/tunnel/start`（Quick, target 8650）→ 返回 `https://airfare-salon-stability-unsubscribe.trycloudflare.com`；公网访问 HTTP 200、`<title>Hermes Agent · 控制台</title>`（Cloudflare 边缘 → NAS 8650 回源正常）
- `POST /api/tunnel/stop` → 状态清空、公网 URL 返回 530（隧道真实关闭）、cloudflared 进程退出
- 信号修复前 stop 进程残留 → 修复后 stop 进程立即退出（对照实验确认）
- 运维经验：veenyi 无权限 kill hermes-agent 进程，须 `echo '密码' | sudo -S kill`；`MONITOR_SOCKET_PATH` 缺失会 `[FATAL]` 退出（unix socket 模式强制）；手动启动脚本已固化于 `/vol1/@appdata/hermes-agent/start-monitor.sh`

---



# v0.21.53 — 「隧道」菜单：Cloudflare Tunnel 外网访问（Quick + Named）

> 用户需求：参考官方 cloudflared + cloudflare-tunnel-skill，将技能固化进应用，在侧边栏新增「隧道」菜单实现外网访问。

## 功能（v0.21.53）

1. **侧边栏「隧道」菜单**：位于「通讯」与「连接器」之间，页面含状态卡片（运行状态 / 模式 / 目标 / PID / cloudflared 版本）、公网地址展示（点击复制 / 打开）、模式选择、转发目标下拉、启动/停止按钮、cloudflared 运行日志查看器、公网暴露安全提醒。
2. **Quick 临时链接（开箱即用）**：`cloudflared tunnel --url http://127.0.0.1:<target>`，免费无需账号，启动后从日志提取 `https://*.trycloudflare.com` 公网地址。cloudflared 二进制首次启动自动从 GitHub Releases 下载（固定版 2026.7.3 linux-amd64，约 50MB）到 `${VAR_DIR}/bin/`（持久目录，chmod 755），无需预装。
3. **Named 固定域名**：`cloudflared tunnel run --token <TOKEN>`，需用户在 Cloudflare 完成 login/create/DNS 路由后填入 token。
4. **转发目标可配置**：Web UI（8650）/ Dashboard（9219）/ Gateway API（8742）/ 自定义端口；启动前校验目标端口监听，未监听直接报错。
5. **可靠性设计**：日志每次启动轮转（保证 URL 提取只匹配本次）；状态持久化 `${VAR_DIR}/tunnel-state.json`（monitor 重启后仍能识别运行中的 cloudflared，stop/status 可用；start 前清理残留进程防重复拉起）；异步下载不阻塞事件循环；30s 无公网地址判超时自动清理。
6. **技能固化**：项目根目录 `skills/cloudflare-tunnel/`（SKILL.md + references/{quick-tunnel,named-tunnel,security,troubleshooting}.md + scripts/tunnel_helper.py），开发者/Agent 可复用同一套工作流；不进 FPK（fnpack 仅打包 app/ 下内容）。

## 后端 API

- `GET /api/tunnel/status`：运行状态 / 模式 / 目标 / URL / PID / cloudflared 版本 / 日志尾部
- `POST /api/tunnel/start`：body `{ mode: quick|named, target: 端口, token?: named 用 }`
- `POST /api/tunnel/stop`：停止并清理状态
- start/stop 均为写操作，受 MONITOR_TOKEN 保护（已加入 writePaths）

## 验证

- monitor.js `node --check` 通过；index.html 3 个内联脚本语法检查通过
- trycloudflare URL 提取正则单测 6/6 通过（含真实日志横幅格式）

---



# v0.21.52 — FPK 体积裁剪：去掉 hermes-src 开发/文档内容（86M → 37M）

> 用户反馈：为什么之前包只有 17-18M，现在安装包 86M。排查确认：v0.21.27 起打包策略把整个 hermes 上游源码树（hermes-src 160M）vendored 进 FPK，其中约一半是运行时不需要的开发/文档内容。

## 裁剪内容（v0.21.52）

1. **根因**：fnpack（v1.0.4）无排除机制——.fnpackignore/.gitignore 放在根目录与 app/ 下均实测无效，app/ 下全部内容整树打包。v0.21.22/23 时代包内无 hermes-src（31M），v0.21.27 起整树 vendored（86M）；且 fnpack 只打包 app/ 下已知结构目录（server/ui/bin/config/hermes-src/package.json），自定义目录名会被忽略。
2. **方案**：副本裁剪打包——`build-slim.sh` 用 robocopy 复制仓库副本（fnos-hermes-agent-slim）时按目录名排除，再对副本 fnpack build。排除清单：`tests`(30M) + `apps`(28M 桌面端/安装器) + `website`(27M 文档站) + `docs`/`.github`/`assets`/`contributors`/`scripts`(~4M)，共 89M。
3. **效果（实测）**：hermes-src 160M → 63M；app.tgz 77.2M → 30.1M；FPK 86.6M → **37.2M**（-57%）。保留运行必需全部源码（agent/gateway/plugins/tools/skills/optional-skills/hermes_cli/ui-tui/web/cron）。
4. **流程固化**：chat-1 根目录 `bash build-slim.sh`（robocopy 复制排除 → fnpack build → 版本/大小确认），产出 hermes-agent.fpk 后移入 pkg/。注意 git bash 下原生 exe 参数转换坑：robocopy 的 /E /XD 等须加 `MSYS2_ARG_CONV_EXCL='*'` 前缀，否则报"无效参数"。

## 验证（实测）

- 外层 manifest `version = 0.21.52` ✓；内层 app.tgz 解包：hermes-src 63M、无 tests/apps/website ✓
- 必需文件抽查：`server/monitor.js`、`ui/index.html`、`hermes-src/gateway/run.py`、`hermes-src/tools/send_message_tool.py`（含 v0.21.51 wecom 补丁）全部在位 ✓
- 产物：`pkg/fnos-hermes-agent_v0.21.52.fpk`（39,051,051 B ≈ 37.2 MiB），MD5 `43ad55b9094b4b7ff1fdb9e7c02e7d1a`

## 备注

- 未裁部分中仍有可压空间（后续可选）：optional-skills 8M（未启用可选技能）、config/prompts 20M（提示词库，有实际用途）。
- 裁剪仅影响安装包体积，运行时行为与 v0.21.51 完全一致；NAS 侧无需热更（本轮无线上变更）。

---



# v0.21.51 — 企业微信接入整体收尾：群消息策略 + 出站推送通道 + 上游 send 补丁

> 用户反馈：「你不应该这么说的，你应该配置好，做好开箱即用的。你看看整体处理一下。」——在 v0.21.50 修复企微群消息（WECOM_GROUP_POLICY=open）之后，对企微接入做整体审计与收尾：出站链路（hermes send / cron 定时推送）当时不可用，且接入配置分散在多处需要统一。

## 修复内容（v0.21.51）

1. **出站链路补丁（hermes-src/tools/send_message_tool.py）**：`_parse_target_ref` 缺 wecom 分支（上游 bug）——`resolve_channel_name` 已能从 channel_directory 解析出 wecom chat_id（群 wrxtfhCAAA… / 私聊 userid），但 `_parse_target_ref` 对 wecom 无专门分支、chat_id 非数字也不以 !/@ 开头，落到默认 `return None` → chat_id 变空 → send 误报 "No home channel set"。修复：wecom 分支直接 pass-through 解析出的平台原生 id。验证：`hermes send --to wecom:tanweien` → sent（私聊 dm 送达成功）。
2. **WECOM_HOME_CHANNEL 写入 profile 级 .env**：multiplex 模式下 gateway 读取 `data/profiles/<profile>/.env` 而非顶层 `data/.env`——此前 WECOM_HOME_CHANNEL 写在顶层不生效（gateway env 里缺失，与 WECOM_GROUP_POLICY 同坑）。写入 profile .env 并重启后：gateway env 含 `WECOM_HOME_CHANNEL=tanweien`，`hermes send --to wecom`（home channel 形式）→ "Sent to wecom home channel (chat_id: tanweien)"。定时任务（cron deliver=wecom）与脚本主动推送通道自此可用。
3. **接入配置统一为开箱即用**：dm 私聊 pairing 策略 + group_policy=open（群消息全放行）+ home channel=tanweien（主动推送目标）三条链路全部验证通过；wecom 测试套件 `tests/gateway/test_wecom.py` 19 个用例全部通过（补装 pytest-asyncio）；媒体链路（图片 base64/url+aeskey、文件、appmsg、引用、混排）代码审查完整，入站媒体由企微客户端发起后自动走既有处理管线。

## 部署说明

hermes-src 补丁随包部署（vendored 源码已同步）；.env 配置项为 NAS 侧运行时配置（群策略/推送通道），随各 profile 的 .env 持久化。

---

> 用户反馈：①聊天窗口依旧很卡——长会话与圆桌讨论每轮发言都往 DOM 追加消息块，累积数千节点后浏览器布局/重绘开销剧增，最终冻结；②无论用浏览器还是手机都无法使用麦克风语音输入——根因是浏览器安全限制：HTTP 明文页面（navigator.mediaDevices 为 undefined）禁止调用 getUserMedia，代码本身链路（getUserMedia → MediaRecorder → /transcribe）是完好的。

## 修复内容（v0.21.50）

1. **condenseChatBody 消息折叠（防卡治理）**：聊天区 `.msg` 超过 60 条时，自动把最早的多余消息折叠为内存 HTML 数组（`_foldedMsgs`，数据不丢失），顶部显示「↕ 查看更早的 N 条消息」折叠条，点击一次性展开全部（60 秒防抖窗口防止展开后立即再折叠）。覆盖 6 个消息追加/渲染调用点：加载会话、普通发送（rtSend + sendRaw）、sendRaw onDone、圆桌 Agent 发言、主持人总结。效果：普通长会话与圆桌 20 轮全程 DOM 节点数恒定在 ~60 条上限，不再无限累积，浏览器保持流畅。
2. **麦克风安全上下文前置检查**：startVoiceRecord 开头增加 `window.isSecureContext` 检查，HTTP 访问时直接 toast 提示「浏览器禁止 HTTP 页面使用麦克风，请改用 https://IP:5667 访问（首次需点击「继续访问」信任自签名证书）」。浏览器与手机语音输入在 HTTPS 入口（fnOS 5667 门户）下均可正常使用；HTTP 入口（5666/8650）受浏览器安全策略限制无法启用。

## 单测

index.html 全部 3 个内联脚本语法检查通过；关键标记（condenseChatBody / MAX_VISIBLE_MSGS / rtCondenseBar / isSecureContext / 5667 提示）确认在位。

## 部署说明

仅 ui/index.html 更新，热更新立即生效，monitor 无需重启。

---

# v0.21.49 — 多窗口/多端消息同步：独立窗口与飞牛内置页实时拉齐

> 用户反馈：独立打开的浏览器窗口与飞牛 App Center 内置页面同时使用时，两边的消息不同步。根因：流式事件（SSE/WS delta）只推送给发起请求的那一个连接，另一个窗口没有任何通知机制，页面保持静止；而会话文件本身是实时镜像（用户消息立即落盘、助手回复每 5 秒/1000 字符增量 checkpoint 落盘），缺的只是「发现变化」的通道。

## 实现方案（v0.21.49）

1. **后端会话签名接口** `GET /api/sessions/:id/sync`：返回几十字节的签名（消息数 + 最后消息的角色/时间戳/内容长度/流式标记/工具数 + updated_at），由 saveSession 每次落盘时同步刷新内存缓存（`_sessionSigCache`），接口零读盘、O(1) 命中。前端轮询成本约等于一次心跳。
2. **前端同步轮询**（startSessionSync）：每 4 秒轮询当前会话签名（页面隐藏时跳过，visibilitychange/focus 时立即补一次）；签名变化才拉取全量消息重渲染。首次轮询只建立基线不重渲染。**本窗口自己流式（_tabStreaming）或圆桌运行中自动跳过**，防止远端拉取打断本地实时气泡。
3. **滚动位置保护**：loadSessionMessages 增加 keepScroll 参数——远端消息到来时，用户正在阅读历史则保持原滚动位置，仅在用户位于底部时跟随新内容。
4. **「另一窗口正在回复」提示**：检测到远端刚发来新用户消息且回复尚未落盘时，底部显示「⏳ 另一窗口正在回复…」，回复落盘后随重渲染消失。
5. **同步效果**：另一窗口发的消息 4 秒内出现；其流式回复以 checkpoint 粒度（每 ~5 秒）增量增长显示；工具/最终结果落盘后完整呈现。圆桌讨论在另一窗口同样可见（每个 Agent 发言=一次正常对话轮次）。

## 单测

签名格式 + 轮询判断逻辑 9 项全过（空会话/用户消息/流式长度变化/流式标记/tools 数/tip 显示与不显示条件）。monitor.js node --check 与 index.html 全部脚本语法检查通过。

## 部署说明

monitor.js 与 ui/index.html 双文件更新，monitor 进程需重启生效（沿用 pkill + cmd/main start 模式，备份 /tmp/monitor.js.bak-02148 与 /tmp/ui/index.html.bak-02148）。

---


# v0.21.48 — 圆桌讨论三连修复：上下文截断防 400 + 手动停止整场终止 + 共识自动收尾

> 用户反馈：①圆桌设定 20 轮，主持人总结时 HTTP 400「prompt text length 4217683 exceeds the character limit 2097152」——165 条消息全部完整拼接（约 421 万字符），超过网关 209 万字符上限被拒，总结请求直接失败；②希望讨论过程中一旦达成共识就**自动关闭讨论并出最终总结**，不必跑满 20 轮；③手动结束后**整个浏览器卡死**——chatStop 只关闭当前 WS，onDone 后 rtAfterAgent 仍推进下一个 Agent，圆桌继续跑满 20 轮，DOM 无限累积导致页面冻结。

## 修复内容（v0.21.48）

1. **上下文截断（rtBuildContext）**：所有 Agent 发言与主持人总结的上下文不再完整拼接全部 history，改为「用户议题（截 2000 字）+ 最近 50 条发言 + 30 万字符上限」（主持人放宽到 40 万），超出部分标注「（较早的 N 条记录已省略，上下文保持精简）」。165 条/421 万字符的膨胀场景压缩到 30 万以内，彻底杜绝 400。
2. **手动停止整场终止（rtStopRoundtable）**：新增 `_rtState.stopped` 全程标志，chatStop 触发的 `onDone(stoppedByUser=true)` 走 rtStopRoundtable：置 stopped/ended、插入「⏹ 已手动停止圆桌讨论」分界线、不再推进下一 Agent、不再触发总结，浏览器立刻解卡。rtAgentSpeak/rtAfterAgent/rtNextRound/rtSummarize 全部加 stopped guard。
3. **共识自动收尾（rtCheckConsensus + rtEndEarly）**：系统提示新增规则 5/6——认为已达成共识时在发言末尾单独一行输出「[达成共识]」；检测到任一 Agent 发言含共识标记（/\[达成共识\]|\[共识\]|\[结束讨论\]|\[END\]|讨论已达成共识|达成共识|一致通过|已达成一致|无需继续讨论|无异议，可以结束/i）即插入「✅ 讨论已达成共识，提前结束（共 N 轮）」分界线，800ms 后自动触发主持人综合总结——不用跑满设定轮数。
4. **主持人总结收尾**：rtSummarize 完成/出错/停止后统一置 ended/stopped，结束分界线后不再有任何轮转。

## 单测

test-rt-context.cjs 12 项全过：空历史、165 条截断（≤30 万字符/保留议题/省略标记/≤52 条）、共识标记命中、普通发言不命中、无议题不崩溃、超长单条跳过。另发现 harness 伪影：模板字符串内 `\[` 丢失反斜杠会把正则变成字符类，已用 `\\[` 修正。

---


# v0.21.47 — 圆桌「断流」误判修复：圆桌接入 genBar 状态条 + 长静默「仍在工作」提示

> 用户反馈：团队圆桌模式「开始写入 Skill 然后就没下文了」，疑似工具层面断流。SSH 全链路诊断（agent.log / info.log / gateway.log / errors.log / ss 连接表）证实**并非断流**：①agent.log 显示首个 Agent（默认助手）连续 11 分钟执行 8 次 write_file 全部成功，16:18:22 正常结束发言（1304 字，Turn ended），随后 16:18:23 下一个 Agent 正常开始发言并持续工作；②monitor info.log 显示聊天 WS 连接 16:06:50 open → 16:18:22 close，**单条连接持续 11.5 分钟从未断开**，close 后 1 秒内重开（圆桌轮转到下一 Agent）；③真实原因是模型每次 API call 之间思考长达 65–184 秒（sensenova-6.7-flash-lite 写 Skill 场景），期间无任何输出，而**圆桌 rtAgentSpeak 直接调 streamChat，绕过了 genBar 状态机，全程没有任何工作状态反馈**——页面完全静止，看起来像死了。

## 修复内容（v0.21.47）

1. **圆桌模式接入 genBar 状态条**：Agent 发言开始显示「🤔 XX 正在发言」；工具调用实时同步状态（💻 正在写代码 / 🤖 正在调用 Agent / 📝 正在处理文件 / 🧩 正在调用技能…，复用 GEN_TOOL_STATES 映射）；推理中显示「💭 正在思考」；发言完成「✅ 回复完成」、出错「⚠️ 回复出错」；主持人综合总结同样接入（「✍️ 正在生成综合方案」）。
2. **新增长静默「仍在工作」提示**：状态条持续 45 秒无任何内容/工具事件时，自动追加「仍在思考 · 已持续 Xs」（每秒刷新秒数，点阵动画保持跳动）；有任何事件活动立即恢复。配合右侧实时计时器，长思考期用户也能明确看到「连接未断、模型仍在工作」。
3. **事件时间戳同步**：sendRaw 的 onDelta / onReasoning / onTool / onInfo 全部更新 `_genLastEventTs`，普通聊天同样获得长静默提示。

## 附：诊断结论（供参考）

- 后端 agent 全程正常：16:05:14 – 16:18:22 首个 Agent turn 完成 11 次 API call + 10 次工具调用；16:18:23 起后续 Agent 依次发言。
- UI WS 全程正常：无异常断开、无重连失败、无 401（16:05:13 的单条 401 为瞬时失败，16:05:14 同请求即 200）。
- 16:17:57 工具报 `python: command not found` 是 Agent 写 Skill 脚本后执行环境缺 python 命令（NAS 仅 python3），不影响流。
- manifest 版本此前因热更部署停留在 0.21.44（monitor 启动检测日志可证），本轮 FPK 全量部署后对正为 0.21.47。

---


# v0.21.46 — 千问式聊天界面融合：顶部状态条 + 发送/停止一体按钮

> 用户反馈：希望像千问 App 一样，在对话框上方用一整条区域显示生成状态（文案 + 计时器），取消消息里的「🤔 正在思考」气泡；生成中发送按钮变成红色停止按钮，点击直接中断当前进度；发送按钮与麦克风等对话按钮统一放到这条区域里。

## ① 顶部状态区域条 genBar

对话框输入区上方新增整条状态区域：左侧状态图标 + 文案 + 三个动画圆点，右侧实时计时器。状态流转与聊天请求全链路绑定：

- `🤔 正在思考` → SSE 首块到达后 `✍️ 正在回复`（onDelta 首次触发）→ 工具调用时 `🛠 XX执行中` → `✅ 回答完成` / `⚠️ 回复出错` / `⏹ 已停止`。
- streaming 期间区域条切换绿色高亮（rgba(16,185,129,.08) 背景 + 绿色边框 + 呼吸阴影）。
- 计时器 100ms 刷新、tabular-nums 数字稳定不抖动，回复结束定格最终耗时 2.2s 后自动复位。

## ② 移除消息内「正在思考」气泡

删掉 assistant 消息里的 `reply-status` 气泡（`🤔 正在思考 / 生成中 / 完成` + 4s fade-out 自动消失逻辑），状态展示统一收敛到顶部区域条，不再出现「气泡先出来又消失」的闪烁。

## ③ 发送按钮 ↔ 停止按钮（直接中断）

发送按钮改为 38px 黑色圆形纸飞机，移到区域条右侧；流式生成期间自动变为红色「⏹」停止按钮：

- 点击停止走全链路中断：POST /api/chat/stop（monitor 终止 `activeChatStreams` 的 AbortController）+ WS close(1000,'user stop') + XHR AbortController.abort() —— 直接中止当前进度，不等待自然结束。
- 停止后按钮立即恢复发送态，区域条显示 `⏹ 已停止`。
- 文本为空或正在生成时发送按钮禁用（防止重复提交）。

## ④ 对话按钮统一收纳

麦克风按钮从输入区下方 toolbar 移入区域条右侧（与发送按钮并排），录音转文字逻辑（toggleVoiceRecord / startVoiceRecord / stopVoiceRecord）零改动复用。

---

# v0.21.45 — 通道「测试」按钮真实连接验证 + 企微群聊策略兜底 + 通道角色路由同步

> 用户反馈两个问题：① 通道配置弹窗点「测试」只提示「该渠道暂不支持在线测试」，想知道 Octop 是怎么点一下就能测通过的；② 企业微信把 bot 拉进群后发消息完全不回复。

## ① 通道「测试」按钮：真实连接验证（对齐 Octop probe_channel）

Octop 后端 `POST /config/channels/{name}/check` → `gateway.probe_channel` 会构造临时 ChannelRow 启动真实适配器实例连接验证。我们平台复刻为 `POST /api/channels/:id/test`：

- **wecom**：wss 握手到 `wss://openws.work.weixin.qq.com`，发送 `{"cmd":"aibot_subscribe","headers":{"req_id":...},"body":{"bot_id","secret","device_id"}}`，回包按 `headers.req_id` 匹配、跳过 `ping` 心跳包，`errcode==0/缺失` 即凭证有效。实测：假凭证返回 `853000 invalid bot_id or secret`，真实凭证返回 `0 ok`。
- **weixin**：iLink `getconfig`（只读零副作用），peer 从活跃 profile 的 `weixin/accounts/*.context-tokens.json` 提取，`ret===-14` 报会话过期提示重新扫码。
- **telegram**：`getMe` 校验 Bot Token。
- **其余渠道**：必填凭证齐全检查（label 含「(可选)」的跳过）。

**重要坑**：不能使用 Node 内置全局 WebSocket —— NAS 的 Node 24 上 undici WebSocket 有 `#onSocketClose TypeError` bug（本机与 NAS 实测连任何 wss 均失败，curl 101 正常），必须使用 vendored ws 库（monitor 的 WS 服务同款）。

## ② 企微群聊策略兜底：group_policy: open

hermes 0.20 wecom 适配器 `_is_group_allowed` 默认 `group_policy=pairing` 会**拒绝所有群消息**（仅 debug 日志 `Group blocked by policy`，无任何回复），这就是拉 bot 进群没反应的原因。保存企微通道配置时若未显式设置，自动兜底写入 `extra.group_policy: open`（所有群可收发）。

## ③ 通道绑定角色 → 顶层 profile_routes 同步

hermes 0.20 网关不读 `platforms.<id>.profile` 字段（官方 dashboard 落盘字段），只有顶层 `profile_routes` 生效。新增 `_syncChannelProfileRoute`：行级编辑 YAML，强制 `multiplex_profiles: true`，按 `- name: channel-<id>` 条目 upsert（绑定）/删除（解除）。保存 wecom/weixin 通道时自动同步，绑定角色的通道按角色运行（微信→飞牛操作员、企微→程序员）。

---

# v0.21.44 — 修复专家聊天空回复「(Gateway 连接失败)」+ port-guard 误杀自己 dashboard

> 用户反馈：用专家模板「以此创建」的 NAS 深度运维角色，点「对话」发消息后回复显示「(Gateway 连接失败)」。SSH 诊断锁定根因链：`profiles/nas_____/` 目录没有 config.yaml（`hermes profile create` 不带 clone 创建的空 profile，且创建时未传入模型配置）→ 激活该 profile 后网关报 `No inference provider configured` → 请求返回 200 + SSE error 事件 → monitor 第 2106 行 `requestError = null` 把错误清空 → 空回复 → UI 显示误导性的「(Gateway 连接失败)」（default/coder profile 均有完整 model/providers 配置，故不受影响）。
>
> 修复三点：①新增 `_ensureProfileModel(id)`：激活 profile 前若其 config.yaml 缺失或无有效 model 块，自动从「当前活跃 profile → default」继承 model/providers 配置块 + .env API 密钥（CUSTOM_*_API_KEY 等，按 key 去重合并），在 `_setActiveProfile` 入口调用，覆盖专家创建（POST /api/experts/create）、激活（POST /api/profiles/:id/activate）、专家一键对话全部路径；已存在的坏 profile 下次激活即自动修复，网关重启后立即可用。②SSE 流内错误事件不再被吞：`fullReply` 为空时保留 `requestError`，错误分支展示真实原因（如「所有模型均失败: No inference provider configured」），避免误导。③port-guard 豁免本包进程：dashboard 以 `python3 -m hermes_cli.main ... dashboard` 启动，命令行不含 HERMES_BIN，此前每 60s 被 `killForeignHermesProcesses` 误杀一次；改为同时豁免命令行含本包 APP_DIR/DATA_DIR 路径的进程（外来 hermes-studio 等仍按原逻辑清除）。

---

# v0.21.43 — 欢迎页快捷提问点击即发送

> 用户反馈：在 Agent 欢迎页点「诊断网络不通问题」等快捷提问卡片，文字只是被填进输入框，会话没有开始。原 `quickFill`/`quickStartFill` 仅做输入框填充。改为 `quickSend`：填入输入框后立即调用 `sendChat` 直接发送（`sendRaw` 自带无会话时自动创建会话的兜底，`injectExpertSystem` 注入 Agent 提示词），点一下即开启对话；Agent 个性化欢迎页与默认欢迎页的快捷卡片统一生效。

---

# v0.21.42 — 专家页一键对话 + 工作流专家头像兜底

> 用户反馈：用「以此创建」新建角色后，卡片上只有「编辑 / 使用」按钮，点了「使用」也不进入对话页，无法与角色对话。修复：「我的专家」卡片按钮改为「编辑 + 对话」；「对话」= 激活该 Agent（hermes profile use + 网关重载）+ 打开该 Agent 专属会话分组（复用既有会话，无则新建，分组名为 p-<id>，与扩展页专家独立会话机制一致；同时互斥停用工作流/专家团，避免会话混组）并自动跳转对话页、聚焦输入框。内置页签中已创建（含使用中）的卡片同样增加「对话」按钮（保留「激活」）。头像问题根因：AGENCY_PERSONAS 个别条目 emoji 字段存的是纯文本（如「微信公众号管理」的 emoji 是「公众号」三个字，不是表情），卡片头像直接渲染出文字；新增 `_wfEmoji` 兜底函数（合法 emoji 白名单校验，非法一律 🧠），映射与创建表单预填均走兜底。

---

# v0.21.41 — 268 个工作流专家并入内置专家页签

> 扩展页 js/personas_library.js 的 268 位工作流专家（20 个部门分类：学术/设计/工程/营销/专项等，全部自带完整 SOUL prompt）并入专家页「内置专家」页签：与内置精选 30 个动态合并为 298 个（按 slug 去重、内置优先，前端直接合并 AGENCY_PERSONAS，零数据复制、零打包体积增长）；页签顶部新增来源筛选 chips「全部 / 内置精选 / 工作流专家」（带计数），场景筛选与来源联动；工作流专家同样支持「以此创建」——以模板预填创建表单（含完整 prompt / emoji / 场景=部门分类），调整后一键生成独立 Agent；搜索对 3.5MB 工作流数据不做 prompt 全文匹配（仅名称/描述/分类）防卡顿；顺带修复 setExpScene 未定义 bug（专家页场景 chips 点击无反应的既有缺陷）。圆桌讨论/团队等工作流继续引用 AGENCY_PERSONAS 原数据，互不影响。

---

# v0.21.40 — 专家页 UI 精简：删除冗余新建按钮与来源徽标

> 专家页顶部「+ 从内置专家新建」按钮点击后仅提示"从卡片一键创建"，属于多余入口，直接删除（连同 openExpertCreate 函数）；内置专家卡片不再显示来源徽标（「内置 / Octop 专家库」标签，Octop 专家已并入内置清单，来源信息无意义）。

---

# v0.21.39 — 修复 API 密钥配置弹窗透明错乱（P0）

> 用户三次反馈的 P0 bug：编辑 Agent 后点「配置/修改 API 密钥」，弹窗整层透明、下层 Agent 编辑弹窗内容（标题、快捷提问、技能目录、底部按钮）全部透出混叠，几乎无法使用。根因：CSS 变量 `--card`（16 处使用）与 `--muted`（14 处使用）在 `:root` / `body.theme-dark` 中从未定义，`openPersonaEnvEditor` 弹窗卡片 `background:var(--card)` 解析无效 → 背景透明。修复：亮/暗主题补定义 `--card`（=--bg2）与 `--muted`（=--text3）；顺带修正 10 处 `var(--text1)` 笔误为 `var(--text)`（欢迎页标题、代码编辑器、圆桌弹窗等）。覆盖范围：env 弹窗、欢迎页快捷提问卡（.wq-card）、圆桌 Agent 芯片、cron 模板卡等全部恢复正常底色。

---

# v0.21.28–38（历史区间汇总）— 早期快速迭代（安装配置持久化 / profile 同步 / 网关重启提速）

> 该区间为 v0.21.27（Hermes 0.20 升级）后的连续快速迭代，核心修复方向：

- **v0.21.28**：`install_init` 配置路径修复（`TRIM_APPDEST` → `TRIM_PKGHOME`），根治「每次 FPK 安装后模型配置丢失」；新增 `_restoreProvidersState` 兜底重建
- **v0.21.29**：profile 配置同步（`_setModelInConfig` 纯文本块级编辑替代 `hermes config set`）+ `newModel` 作用域修复
- **v0.21.30**：网关停止/重启提速（`stop_process` 10s→3s、`stopPid` 5s→1.5s，状态持久化无需优雅退出）
- **v0.21.31–38**：WebUI 与网关稳定性连续修复（专家/模型/API Key 弹窗、dashboard 兼容、圆桌与专家页迭代前奏）；每版本均含 FPK 包（pkg/ 目录），本区间未逐一保留独立日志

---



# v0.21.27 — Hermes 核心 0.20.0 升级 + WebUI 模型显示修复

> 完整变更记录见 `CHANGELOG_v0.21.27.md`。要点：官方自 0.20.0 起停止 PyPI 分发，本包内置完整源码（`app/hermes-src`）editable 安装 + 预构建 web_dist/TUI bundle；monitor 适配 cron `--deliver`、版本日期、源码模式检查；实测修复 dashboard 前端加载（注入 `HERMES_WEB_DIST`）。WebUI：概览页新增「当前模型」卡片、`/status` 显示 Provider·模型、模型按钮/模型页卡片兜底显示全局默认模型（适配社区修复方案）。

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
- **热更新检查更新可能拉到旧 release**：`releases?per_page=1` 按 created_at 排序，重建过的旧 release 会排在前面。修复：改为拉取列表后按 `published_at` 选最新已发布 release。
- **安装包缺少图标**：fnOS `trim_app_center` 前端按小写 `icon.png` 查找图标，包内只有大写 `ICON.PNG`。修复：仓库增加小写 `icon.png` 副本一并打包。
- **应用中心版本号显示重复（"0.21.23 0.21.23"）**：CI 构建时 sed 正则只替换到等号，旧版本号残留在行尾。修复：改为整行替换。
- **安装新版本后 UI 仍显示旧版本号**：`@appdata` 数据目录不随卸载清除，残留的 `app_version` 覆盖文件（旧版本）被优先读取。修复：`install_init` 安装前清理残留覆盖文件，同时版本读取改为取所有候选中的最高版本。

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

---

---

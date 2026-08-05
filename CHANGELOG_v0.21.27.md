# fnos-hermes-agent v0.21.27

> 基座：Node.js monitor（不变）｜ Hermes 核心：0.19.0 → **0.20.0**（Herald Release，2026-08-03，tag v2026.8.3）
>
> 版本说明：按小版本迭代原则，将误升的 v0.22.0 回退为 v0.21.27（沿用 Release/hot-patch/NAS 同步的小步迭代体系）。

## 核心升级：Hermes Agent 0.20.0

### 分发方式变更（重要）
- 官方自 v0.20.0 起停止 PyPI wheel/sdist 分发：`setup.py` 新增构建守卫，非 `HERMES_NIX_BUILD=1` 环境下 `bdist_wheel`/`sdist` 直接报错。PyPI 上永久停留在 0.19.0，`uv pip install "hermes-agent==0.20.0"` 不再可行。
- 本包改为**随 FPK 内置完整 Hermes 源码**（`app/hermes-src/`，约 150MB），安装/升级时执行 `uv pip install -e "hermes-src[all]"`（editable 安装走 `build_editable`，不触发构建守卫，是官方 shell 安装器同款路径）。
- **打包时预构建前端资源**（避免 NAS 上运行时 npm 构建）：
  - Dashboard 前端 → `hermes_cli/web_dist/`（editable 模式下 `hermes_cli` 解析到源码目录，天然命中）
  - TUI bundle → `ui-tui/dist/entry.js`（monitor 启动时 symlink 到 `${DATA_DIR}/tui/dist/entry.js`，配合 `HERMES_TUI_DIR` 环境变量）

### 安装/升级脚本适配
- `cmd/install_callback` / `cmd/upgrade_callback`：内置源码存在时走 editable 安装（失败自动清理旧版 site-packages 后重试）；无源码时退回 PyPI wheel 安装（兼容旧包/热补丁场景）。
- 应用内「更新 Hermes」按钮（`/api/hermes/update`）：源码模式下改为重新执行 editable 安装，不再从 PyPI 升级（避免误装回 0.19.0 造成降级）。

### monitor.js 适配
- cron CLI：`--deliver-to` 已更名为 `--deliver`（0.20.0 破坏性变更），定时任务创建已同步。
- TUI shim：新增源码模式候选项 `hermes-src/ui-tui/dist/entry.js`（保留旧版 wheel 模式 `hermes_cli/tui_dist/entry.js` 兼容）。
- 版本展示：`HERMES_VERSION_DATE` 默认值更新为 0.20.0 发布日期 `2026.8.3`。
- 版本检查：0.20.0 起不再查询 PyPI（该版本不在 PyPI 上），`latest` 直接显示当前版本，避免"最新版 0.19.0"误导。
- `hermes --version` 新格式（`Hermes Agent v0.20.0 (2026.8.3)`）已在版本解析中兼容。
- 已验证兼容：`gateway run --replace`、`dashboard --host/--port/--no-open/--insecure`（后两参数保留兼容）、`profile list/use`、`cron create/list`、`/api/pty|ws|events|status` 路径全部存在。

### 已验证的 0.20.0 关键行为
- Dashboard 依赖 `HERMES_WEB_DIST`（可覆盖）或 `hermes_cli/web_dist` 默认路径——预构建产物直接命中。
- TUI 依赖 `HERMES_TUI_DIR`（monitor 已注入 `TUI_DIR`），优先使用 `<dir>/dist/entry.js` 预构建 bundle。
- API server 要求 `API_SERVER_KEY` ≥16 字符——monitor 注入的 44 字符 token 满足。
- `hermes gateway` 网关端口 8742、`--replace` 接管逻辑不变。

### 测试环境验证（192.168.3.102，v0.21.27 实机）
- 部署方式：SFTP 上传 FPK → 备份 APP_DIR → 解压 app.tgz/cmd/config → 手动执行 `upgrade_callback`（模拟应用中心升级）→ `cmd/main start`。
- **hermes 核心确认升级到 v0.20.0 (2026.8.3)**：`hermes --version` 输出新格式；venv 内为 editable 安装（`__editable___hermes_agent_0_20_0_finder.py` + `.pth`，Location 指向 `/vol1/@appcenter/hermes-agent/hermes-src`）。
- **实测发现并修复（HERMES_WEB_DIST）**：0.20.0 的 dashboard 启动时 `_web_ui_build_needed()` 要求 dist 哈希 stamp 文件（首次构建后才生成），缺失时尝试 npm 构建；而源码模式下 NAS 无 managed node（0.20.0 只查 `$HERMES_HOME/node` 与 PATH），导致 "Web UI frontend not built and npm is not available" 退出。修复：monitor `spawnHermes()` 在拉起 dashboard 时注入 `HERMES_WEB_DIST=/vol1/@appcenter/hermes-agent/hermes-src/hermes_cli/web_dist`（web_server.py 优先使用该变量，main.py 仅剔除 Electron packaged 路径，不受影响）。修复后 dashboard 日志显示 `Using web dist from HERMES_WEB_DIST`，9219 端口 HTTP 200。
- **实测发现（运维注意）**：fnOS 框架不保证自动拉起被 kill 的 monitor（本轮出现 kill 后 12s 未拉起），兜底命令：`sudo -u hermes-agent env TRIM_APPDEST=/vol1/@appcenter/hermes-agent TRIM_PKGHOME=/vol1/@apphome/hermes-agent TRIM_PKGVAR=/vol1/@appdata/hermes-agent bash /var/apps/hermes-agent/cmd/main start`。
- 最终状态：monitor (8650) / gateway (8742, healthy) / dashboard (9219, healthy, HTTP 200) 全部正常，API `/api/status` 三端口采样稳定。
- 备份：`/vol1/@appdata/hermes-agent/backup-app-pre0220-final.tgz`（85MB，含升级前完整 APP_DIR）。

## WebUI 修复：模型切换后首页不显示（适配自社区修复方案）

问题：WebUI 切换 Provider/Model 后，概览页无任何反映，`/status` 只显示 Provider 名称不显示具体模型名。参考社区修复方案适配到 `app/ui/index.html`（单文件 SPA）：

- **`/status` 命令**：`当前模型 Provider · Model`（新增 `_getActiveModelName()` 辅助函数，从 `_cfg` 解析 active provider 的默认模型，支持 `p.model` / `models[].default` / 首个 enabled 逐级兜底）。
- **顶部模型按钮兜底**：`_syncModelBtn()` 无会话级选择时，显示全局默认 Provider·模型（替代原「选择模型」空态）。
- **模型页卡片**：`renderProviders()` 的 `modelText` 优先显示 `p.model`（原取 `models[]` 首个 enabled，与用户设置的默认模型不一致）。
- **触发路径**：`saveProvider()` / `activateProvider()` 保存成功后刷新模型列表与模型按钮。
- 前置 API 已存在：monitor.js 的 `GET /api/config/primary-model` 返回 `{provider, model, providers}`（解析 `config.yaml` 的 `model.provider` / `model.default`）。

> 注：初版曾在概览页新增「当前模型」卡片（`/api/config/primary-model` 驱动），用户实测反馈不需要该显示框，v0.21.27 发布前已移除（卡片 HTML、`refreshModelInfo()` 及全部调用点），保留其余修复。

---

## v0.21.27 修订：渠道配置体验 + 预设智能体模板

### 渠道配置：保存即生效 + 可清空重配（修复"配置错了无法重新配置"）

- **保存后自动重启网关**：`POST /api/channels/:id` 保存成功后统一触发 `_triggerGatewayRestart(id+"-bind")`（此前只有 Telegram/WhatsApp 的 qr/apply 路径会重启，微信等渠道缺失——网关只在 spawn 时读 `.env`/`config.yaml`，不重启则继续用旧 token，表现为"重新配置无效"）。保存响应带 `restarting:true`，UI 提示改为"网关正在重启生效"。
- **新增清空路由**：`POST /api/channels/:id/clear` 清空该渠道全部配置（`.env` 凭据键置空 + `config.yaml` `platforms.<id>` 整块移除）并自动重启网关。
- **UI 清空按钮**：渠道配置弹窗 footer 新增「清空配置」红色按钮（仅已配置渠道显示），确认后一键清空，可重新扫码或手动配置。
- **扫码成功提示**：`chShowQrSuccess` 改为"网关正在自动重启生效（约 10 秒后可用）"，不再要求用户手动去概览页重启。

### 预设智能体模板：一键创建并激活

- 扩展页「智能体 / 角色」新增 **📌 预设模板** 区（`PRESET_AGENT_TEMPLATES` 内置 5 个模板）：
  - 🖥️ **飞牛操作员**（`fnos_operator`）：fnOS NAS 运维专家——TRIM CLI、应用中心、存储/网络、Docker、日志与备份恢复（补回 v0.20.81-87 曾记录但未落地的内置角色）
  - 💻 程序员 / 🔬 研究员 / ✍️ 写作助手 / 📊 数据分析师（与扩展页 LightAgent 角色同源）
- 一键操作：未创建 →「一键创建并激活」（`POST /api/profiles` 创建独立 profile 后自动 `selectPersona` 激活）；已创建 →「一键激活」；使用中 → 按钮置灰。
- 模板区状态与智能体列表实时同步（`renderPresetAgents()` 随 `renderPersonas()` 刷新）。

---

## v0.21.27 二次修订：聊天加载性能优化（3-5 秒 → 瞬时）

用户反馈：每次打开聊天界面，内容加载要 3-5 秒。实测定位 4 个瓶颈并全部修复：

### 服务端（monitor.js）

- **`/api/profiles` 每次请求拉起 hermes CLI（最大瓶颈）**：`_getActiveProfile()` 每次 spawnSync `hermes profile list`（venv Python 启动 0.35-1s），页面加载必调且列表内部调用两次。修复：结果内存缓存（`_activeProfileCache` 声明在**模块级**——初版误放 `handleFetch` 函数内，每请求重置导致缓存无效，二次打包修正），`_setActiveProfile()` 时同步更新。实测：1.05s → 冷缓存 0.42s → 热缓存 **1.9ms**。
- **`/api/sessions` 全量读盘解析**：每次请求 readdirSync + JSON.parse 所有会话文件（会话文件含全部消息，量大时秒级）。修复：内存缓存 `_sessionMetaCache`（5s TTL 兜底），`saveSession`/`deleteSession` 主动维护，列表实时。实测：1.4ms 稳定。
- **`writeJSON` 美化输出**：JSON.stringify(data, null, 2) 使会话文件大 30-50%。修复：紧凑输出为默认，仅 config.json 保留美化（3 处调用点传 true）。
- **`/api/status` 全量读 hermes.log**（每 3 秒轮询一次，日志大时 IO 压力）。修复：statSync + 尾部 64KB 截读。

### 前端（ui/index.html）

- **初始化请求串行链**：fetchToken → loadConfig → fetchProfiles → fetchChannelSessions → loadSessions 依次等待。修复：fetchProfiles/fetchChannelSessions 不依赖 _cfg，提升到与 loadConfig 并行发起（loadSessions 仍留在 config 之后——侧栏分组映射依赖）。
- **切换会话死缓存启用**：`_chatHTML[sid]` 快照一直在流式时写入但从不读取。修复：`switchTab` 命中缓存立即恢复渲染（0 延迟），后台 `loadSessionMessages(sid, true)` 静默拉最新覆盖；成功后回写缓存；`delSession` 清理对应缓存。

### 实测结果（192.168.3.102，最终 FPK md5 e6522911）

- 页面加载全链路串行模拟：**471ms → 79ms**（浏览器端并行后首屏关键路径 <100ms）
- `/api/profiles` 热缓存 1.9ms、`/api/sessions` 1.2ms、`/api/status` 10ms、`/api/config` 2.5ms
- 切换会话：命中内存快照即时渲染，无「加载中…」闪烁

---

## v0.21.27 三次修订：渠道扫码体验 + Agent 环境配置 + 定时界面升级

用户 6 项反馈全部修复（A-F），r3 包部署通过（后续四次修订在此基础上继续迭代）。

### A. 预设模板卡片按钮位置统一

模板卡片原为文本流式布局，desc 长短不一导致「一键创建并激活」按钮高度错位。修复：卡片改为 flex 纵向布局（`.preset-agent-card` 内联 `display:flex;flex-direction:column`），描述区 `flex:1` 撑满，按钮区固定 `margin-top:10px`——所有卡片按钮底部对齐。

### B. Agent「未配置 API」→ 提供配置入口（新增 Agent 环境变量编辑器）

问题：加载模板创建的 Agent 显示「未配置 API」，用户无处配置。定位：每个 profile 是独立环境（`.env`），无密钥时回落全局默认 `.env`——模板 Agent 未继承全局密钥属预期行为，但缺配置入口。

- **服务端新增 `PUT /api/profiles/:id/env`**：合并写入 profile 独立 `.env`（空值删键、新键追加、重复键去重，`mkdirSync` 兜底目录不存在），写后 `_triggerGatewayRestart(id+"-env")` 重启网关生效（网关只在启动时读 .env）。
- **UI 新增环境编辑器**：智能体/角色列表每个 Agent 新增 ⚙ 环境变量徽标（`openPersonaEnvEditor`），弹窗含 12 个常用键（OPENAI_API_KEY、DASHSCOPE_API_KEY、DEEPSEEK_API_KEY 等）+ 自定义变量行，已存值脱敏展示（placeholder），只提交被修改的键；另有「清空该键」能力（置空即从 .env 删除）。
- **Agent 详情弹窗新增环境状态行**：「API 密钥：已配置 / 未配置（将使用全局默认）」+「配置/修改 API 密钥」按钮，说明文案注明"每个 Agent 是独立环境，留空则回落到全局默认 .env"。

### C. 新增 Agent 后「绑定角色」下拉无其他 Agent

问题：新建 3 个 Agent 后微信配置弹窗「绑定角色」下拉仍只有默认助手。根因：下拉用 `_profiles` 初始化一次后不刷新，且旧版 `profList` 可能混入重复项。

- 打开弹窗时用 `apiGet('/api/profiles')` 异步重建下拉（保留用户已选值），成功后同步 `renderPersonas()`/`renderPresetAgents()` 状态。
- 下拉数据源按 id filter 去重，**🤖 默认助手（default）始终置首**。

### D. 企业微信扫码：对接腾讯官方 ai/qc 接口（与 Octop 同款，免 Corp ID）

问题：旧 wecom/qr 要求预填 Corp ID / Agent ID / Secret 否则报 HTTP 400，与 Octop 的免配置扫码体验不符。根因：hermes 0.20.0 wecom 插件实为「AI 智能机器人」WebSocket 模式（`extra.bot_id` + `extra.secret`），并不需要企业自建应用的 Corp ID。

- **`GET /api/channels/wecom/qr`**（重写）：调腾讯官方 `https://work.weixin.qq.com/ai/qc/generate?source=hermes&plat=3`，返回 `{scode, auth_url}`，UI 用 auth_url 渲染二维码（qr 图片 + deep_link 提示）。仅需手机微信扫码授权，无任何预配置。
- **`GET /api/channels/wecom/qr/status?scode=`**：3 秒轮询 `https://work.weixin.qq.com/ai/qc/query_result?scode=`，`success` 时提取 `bot_info.botid/bot_info.secret`；`_wecomQrCache` 内存缓存（模块级，3s TTL）避免重复请求；error/expired → 410。
- **`POST /api/channels/wecom/qr/apply`**：body 带 scode，从缓存兜底取 bot_id/secret → 写入 `.env`（WECOM_BOT_ID/WECOM_SECRET）+ `config.yaml`（`platforms.wecom.enabled=true`、`extra.bot_id/secret`）→ `_triggerGatewayRestart("wecom-bind")`。
- **UI 重写 `chStartWecomQr`/`chPollWecomQr`/`chApplyWecomQr`**：扫码授权成功后按钮变「✅ 完成，立即保存」→ apply 保存后提示网关重启生效。渠道字段定义改为 bot_id/secret 优先、corp_id/agent_id 可选（`WECOM_BOT_ID`/`WECOM_SECRET` 必填项，`WECOM_CORP_ID`/`WECOM_AGENT_ID` 可选），note 更新为"企业微信「AI 智能机器人」扫码授权…与 Octop 一致，无需自备 Corp ID"。

### E. 必现 QR 轮询串扰修复（`_chQrSeq` 会话令牌）

问题：点过 TG/企微扫码后进微信，微信仍在调 TG/企微轮询（二维码互相覆盖）。根因：所有 `chPoll*` 为无限 setTimeout 递归链，直接写全局 `chModalBody`/`chModalFoot`，关闭弹窗或切换渠道并不停止旧轮询。

- 新增全局 `var _chQrSeq = 0` 会话令牌：`openChannelModal`/`closeChannelModal` 及每个 `chStart*` 都 `++_chQrSeq`；`chPoll*` 捕获启动时 seq，每次回调先 `if(seq!==_chQrSeq) return` 即放弃——旧轮询链自动失效，只剩当前弹窗的轮询。
- 覆盖 Telegram / WhatsApp / 微信 / 企业微信全部 4 个扫码渠道。

### F. 定时任务界面：可视化调度构建器 + 卡片升级（参考 WorkBuddy/Hermes ScheduleBuilder）

保留全部现有功能（模板、名称、提示词、投递、技能、重复次数），仅替换调度输入与列表渲染：

- **调度构建器**（`renderCronSched`）：6 种模式——⏱ 间隔（every 30m/2h/1d）、📅 每天（HH:MM）、📆 每周（星期多选 + 时间）、🗓 每月（几号 + 时间）、⏰ 一次性（datetime-local）、✍️ 自定义（cron 表达式）。实时预览最终调度字符串（复用 hermes `parse_schedule` 语法：`every 2h` | `0 9 * * *` | `2026-08-05T09:00`）。
- **模板智能回填**：`applyCronTemplate` 用 `cronSchedFromString()` 把模板调度串（`0 8 * * *`、`every 6h` 等）解析回对应模式与控件状态。
- **任务卡片升级**：状态 pill（● 活跃绿 / ● 已暂停橙）+ 卡片左侧 3px 状态色条 + 调度表达式 code 样式 + 投递渠道图标 + 下次/上次执行时间 + 最近一次运行结果（成功/失败），失败显示红色错误行（title 全量错误信息）。
- `createCronJob` 改用 `buildScheduleString()` 输出，一次性模式校验必填时间。

> 部署状态（2026-08-04 晚）：192.168.3.102 上 hermes-agent 已从应用中心卸载（`@appcenter` 仅剩 nodejs_v24），用户已上传 0.21.27 第三方 TPK（`/vol1/appcenter-downloads/hermes-agent-0.21.27-tpk/`，含 hermes-src）但尚未安装；192.168.3.249 本机 SSH 认证失败。本轮修订已完成本地打包与语法校验，待应用中心安装完成后走 hot-patch 或直接部署验证。

---

## v0.21.27 四次修订：WorkBuddy 风格定时任务 + 多通道投递 + Webhook 机器人 + 聊天图片堆叠

### A. 定时任务界面重做（参考 WorkBuddy v5.3.8「自动化」页风格）

- **模板区 3 列卡片网格**（`.cron-tpl-grid` 1fr×3 + `.cron-tpl-card`）：12 个模板卡片，每卡含 图标 / 名称 / 一句描述 / 调度表达式，点击一键填充整个表单。新增「📖 每日 5 个英语单词」「🏛️ 历史上的今天」两个内置 Webhook 推送模板（选中后投递区自动切到 Webhook 行，只需填机器人地址）。
- **弹窗重做为「添加自动化任务」表单**（max-width 660px）：顶部蓝色提示条说明多通道投递与 Webhook 用法；字段卡片化分组（`.cron-form-group`）：任务名称 / 执行频率 / 提示词 / 投递到 / 技能 / 重复次数；底部按钮「创建任务」。
- **执行频率 3 Tab**（`.cron-tabs`）：🔄 周期（每天 / 每周 / 每月 / 自定义）、⏱ 按间隔（every 30m/2h/1d）、🎯 单次（datetime-local）。Tab 与调度模式状态联动（切 Tab 自动切换对应模式，点模板自动落到正确 Tab），保留实时预览最终调度串（hermes `parse_schedule` 语法）。

### B. 多通道投递：不同通道不同消息

- 投递区从单选下拉改为**多行投递**（每行 = 通道下拉 + 删除按钮 + 「＋ 添加投递通道」）：内置 8 通道（💾 本地保存 / 💬 原始会话 / 💚 微信 / ✈️ Telegram / 🐜 钉钉 / 🏢 企业微信 / 📘 飞书 / 🎮 Discord）+ 🔗 Webhook 机器人。
- **每行通道独立配置**；选 Webhook 时该行展开「机器人地址 + 消息模板」两个输入框，消息模板支持 `{output}` 占位符（= 任务输出全文，留空默认输出全文），同一任务可同时投内置通道 + 多个不同内容的 Webhook。
- `createCronJob` 收集为 `payload.deliveries` 数组（`{channel, url, message, label}`），并保留 `deliver_to` 兜底兼容旧 monitor。

### C. Webhook 出站投递（企业微信机器人 / 钉钉机器人）

hermes cron 的 `--deliver` 只支持内置平台（webhook 平台仅是**入站**），本包在 monitor 侧实现出站 POST：

- **配置存储**：`DATA_DIR/cron-webhooks.json`（`{ "<job_id>": [{url, message, label, last_run_at, last_status, last_error}] }`），创建任务时关联 job_id，删除任务时同步清理。
- **轮询投递** `_cronWebhookTick()`：每 20s 读 jobs.json 对比 `last_run_at` 变化 → `_cronLatestOutput()` 读取该任务最新输出 .md（兼容 0.20.0 `cron/output/<id>/` 与旧版 `cron/<id>/outputs/` 两种目录，取最新文件前 8000 字符）→ 模板 `{output}` 替换 → `_postWebhookText()` POST（body `{"msgtype":"text","text":{"content":...}}` 兼容企微/钉钉机器人，15s 超时，`errcode≠0` 抛错，非 JSON 的 2xx 视为成功）→ 回写投递状态。
- **API 扩展**：`POST /api/cron-jobs` 接受 `deliveries`（纯 Webhook 任务自动 `--deliver local` 保底保存输出文件），响应带 `webhooks_attached` 数量；`GET /api/cron-jobs` 返回 `webhooks` 映射（脱敏）；`action=remove` 同步清理关联配置。
- **UI 列表**：任务卡片显示 🔗 Webhook 状态（⏳ 等待 / ✅ 已投递 / ⚠️ 失败 + 错误 tooltip），创建成功 toast 提示已关联 N 个 Webhook。

### D. 聊天图片卡片式堆叠 + 灯箱（点击哪张看哪张，上下页切换）

- 多图消息不再平铺，改为**卡片式堆叠**：`imgStackHTML()` 最多 5 张视觉卡片、每张向右下偏移 9px 层叠（150×150 圆角卡片 + 阴影），右下角「n 张 ▸」徽标；单张图片保持 220px 可点击大图。
- 点击堆叠或单图打开**全屏灯箱**（`#imgLightbox`）：大图居中（max 92vw/88vh）+ 左右 ‹ › 切换按钮 + 底部「n / N」序号 + 键盘 ←→↑↓ 切换、Esc/点击背景关闭 + 相邻图片预加载（`_lbImgs/_lbIdx` 全局状态，`openImgLightbox(JSON列表, 起始序号)`）。

> 部署状态（2026-08-04 深夜）：192.168.3.102 完成四次修订部署（上传 monitor.js/index.html → 重启 monitor → API 验证 + Webhook 端到端验证，见下）；192.168.3.249 同步部署完成（标准 App Center 布局 `/var/apps/hermes-agent/`，cmd/main 在 `/var/apps/hermes-agent/cmd/`，需显式传 TRIM_APPDEST=/vol3/@appcenter/hermes-agent 等 env；修复 root 遗留 gateway.lock 权限后 gateway healthy；monitor 8650 / gateway 8742 / dashboard 9219 全绿，部署文件 MD5 与本地一致）。最终 FPK md5 28e8e2ebe23d1037fbc1aa0bab2e7d3b（r5，pkg/ 归档）。

### E. 0.20.0 cron 数据按 profile 隔离适配（部署实测发现并修复）

部署后创建定时任务发现 `GET /api/cron-jobs` 列表为空、Webhook 轮询不触发。排查确认：**hermes 0.20.0 起 cron 数据按 profile 隔离**——jobs.json 与输出目录位于 `profiles/<活跃profile>/cron/`（如 `profiles/coder/cron/jobs.json`、`profiles/coder/cron/output/<job_id>/*.md`），而 monitor 原实现读全局 `DATA_DIR/cron/jobs.json`（0.20 升级后遗留问题，UI 任务列表/Webhook 轮询全部失效）。

- 新增模块级 `_cronProfileName()`（优先内存缓存 `_activeProfileCache`，其次 `.active_profile` 文件，避免每次 tick 拉起 venv CLI）与 `_cronProfileJobsFile()`（profile 路径存在则用之，否则回退全局路径兼容旧版）。
- handleFetch 内 `_readCronJobs()`/`_cronJobsFile()` 同步改为按活跃 profile 读取（`_getActiveProfile()` 在闭包内可用）。
- `_cronLatestOutput()` 输出目录候选列表扩展为 profile 优先 + 全局兜底（兼容 0.19 旧版 `cron/<id>/outputs/`）。
- `POST /api/cron-jobs/:id/action` 的 jobId 增加 `.trim()` 防御（URL 传参偶带换行/空白导致 hermes "not found"）。
- **实测端到端**（192.168.3.102，本地接收器 192.168.3.20:8899）：创建带 webhook 投递任务（deliveries=[webhook+local]）→ `hermes cron run` 触发 → monitor 20s tick 检测 `last_run_at` 变化 → 读 profile 输出 .md → `{output}` 模板替换 → POST `{"msgtype":"text","text":{"content":"R4测试: # Cron Job: ..."}}` → 接收器收到、`last_status=ok` 回写 → remove 后 webhooks 映射与 `cron-webhooks.json` 同步清空。
- 注：cron 任务以活跃 profile 的模型配置运行，profile 未配模型/API key 时任务输出为失败报告（`No inference provider configured`），失败输出同样会投递（便于排查），属环境配置问题而非功能缺陷。

---

## v0.21.27 五次修订：Agent 模型解析修复 + API 密钥面板按模型联动（用户反馈 2 项 Bug）

### F1. 编辑 Agent 弹窗模型「不在模型列表中」修复（跨行正则吞键）

用户反馈：已配置好的模型（如 `deepseek-v4-flash`）在编辑 Agent 弹窗下拉框中显示「不在模型列表中」。排查确认根因：profile 的 config.yaml 经 `hermes -p <id> config set model.model` 写入后格式为 `model:\n  model: deepseek-v4-flash`，而 `_readProfileInfo` 的正则 `/^\s*model:\s*(.+)$/m` 中 `\s` 会匹配换行符——跨行吞掉嵌套键名，把整串 `model: deepseek-v4-flash` 当成了模型名（卡片徽标与下拉框均显示 `model: deepseek-v4-flash`，与模型列表比对失败）。

- 新增 `_extractConfigModel(cfg)` 块级解析：先匹配顶层 `^model:` 块，再取块内 `default:`（主配置格式）或嵌套 `model:`（config set 格式）键值；无块时回退单行 `model: xxx` 格式。`_readProfileInfo` 与 `_listProfiles` 的 default profile 解析统一改用该函数。
- 本地 5 用例回归通过（嵌套 model / 主配置 default / 单行 / 空配置 / 多嵌套键 default 优先）；部署后 102 实测：`coder → deepseek-v4-flash`、`fnos_operator → sensenova-6.7-flash-lite`、default → `sensenova-6.7-flash-lite`，前缀消失。

### F2. API 密钥面板按模型联动（不再出现 `model: xxx` 假键行）

用户反馈：打开 Agent 的 API 密钥配置界面不应出现「什么模型调用的 API 的 KEY」这类行，应根据该 Agent 已配置的模型直接对应到所需密钥。

- 新增 `MODEL_KEY_RULES`（10 条模型前缀 → 密钥映射：deepseek→DEEPSEEK_API_KEY、glm/zhipu→GLM_API_KEY、moonshot/kimi→MOONSHOT_API_KEY、qwen→QWEN_API_KEY、gpt/openai→OPENAI_API_KEY、claude→ANTHROPIC_API_KEY、gemini→GEMINI_API_KEY、grok/xai→XAI_API_KEY、ollama→OLLAMA_BASE_URL、minimax→MINIMAX_API_KEY）。
- `openPersonaEnvEditor` 打开时读取 profile 当前模型：顶部提示条「当前模型 X → 对应密钥 Y（下方 ★ 高亮行）」；匹配到的密钥行 ★ 高亮（accent 边框/底色/加粗）。
- 读取已有 env 键时过滤非 `[A-Za-z_][A-Za-z0-9_]*` 格式的键名（防 `model: xxx` 类假键混入自定义变量区）。
- 部署验证（102/249）：monitor 8650 / gateway 8742 healthy / dashboard 9219 全绿，UI 含 MODEL_KEY_RULES 标记。

---

## v0.21.27 六次修订：dashboard/chat 黑屏修复 + 配置自毁 Bug 根除（用户反馈）

### G1. dashboard/chat 打开全黑（/api/status 500：agent 配置为 None）

用户反馈 `http://192.168.3.102:8650/app/hermes-agent/proxy/dashboard/chat` 全黑无响应，此前版本正常。排查链路：

- dashboard HTML/JS chunk 代理均 200，定位到 dashboard 自身 `GET /api/status` 返回 500，gateway.log 有 fastapi traceback：`web_server.py get_status → gateway.py _get_restart_drain_timeout → agent_cfg.get(...) → AttributeError: 'NoneType' object has no attribute 'get'`。
- 根因一：主配置 config.yaml 顶层存在 44 个**空键骨架**（`agent:`、`terminal:`、`web:`、`slack:`… 全部无值 = YAML null）。hermes 0.20 的 `read_raw_config()` 原样返回 raw dict，`cfg.get("agent", {})` 得 None → `None.get(...)` 崩溃（0.19 无此代码路径，故旧版正常）。空键骨架系 hermes config set 在 0.20 下的写回产物。
- 根因二（**配置自毁 Bug，主凶**）：monitor 启动自愈 `_repairConfigYaml()` 存在致命缺陷——扫描到顶层键行（如 `model:`）后，用 `while (...startsWith(" ")) j++` **跳过并丢弃该块全部缩进内容**，仅保留顶层键；再把紧随的顶格 `- item` 行删除。而 PyYAML 等工具输出的**合法顶格序列**（`toolsets:\n- hermes-cli`）被误判为"顶格残留"触发"修复"→ 一次启动就把 config.yaml 从 1240 字节裁成 420 字节，model/providers 嵌套内容全灭（monitor 日志：`[config-repair] config.yaml 已修复：清除 1 行顶格残留`）。此前从未触发是因为旧文件无顶格 `-` 行（removed=0 不写盘）。
- 根因三：coder profile 的 config.yaml 是 `model:\n  model: deepseek-v4-flash`（0.19 旧格式嵌套键），hermes 0.20 不识别，模型解析为空。

修复：

- `_repairConfigYaml()` 重写：只处理紧随顶层键后的顶格 `- ` 行，**缩进 2 空格修复而非删除**，其余行一律原样保留（数据无损，合法顶格序列也安全）；日志改「N 行顶格列表项已缩进」。
- 一键修复工具 dashfix.py（PyYAML）：删除顶层 null 空键 + 嵌套 `model.model` 转 `provider+default`（已内置 providers 段匹配）；102 实操：恢复 `.pre-repair.bak` → dashfix 清理 → 重启后配置完整（model provider/default 俱在、toolsets 缩进、零空键），`/api/status` 200，三个 profile 模型解析全部正确。
- 部署后验证（102）：dashboard `restart_drain_timeout: 0.0` 不再抛异常，HTTP 200；profiles：default→sensenova-6.7-flash-lite、coder→deepseek-v4-flash（provider: deepseek）、fnos_operator→sensenova-6.7-flash-lite。

### G2. 模型保存写入重构：弃用 hermes config set（0.20 双坑）

`_updateProfile` 原用 `hermes [-p id] config set model.model <val>` 写模型（0.19 语法），0.20 下：①写入嵌套键 `model.model` 不识别（模型失效）；②config set 写回可能产生空键骨架（G1 根因一）。重构为**纯文本块级编辑**：

- 新增 `_setModelInConfig(yml, model, providerId)`：块级定位 `^model:` 段，替换/新增 `default:` 与 `provider:` 行、清除 0.19 遗留嵌套 `model:` 键、无块时追加 `model:\n  provider: x\n  default: y`，其他键原样保留。
- 新增 `_modelProviderId(model)`：模型名前缀 → hermes 内置 provider（deepseek→deepseek、qwen→alibaba、kimi→kimi-coding、minimax→minimax、claude→anthropic、gemini→gemini、grok→xai；仅收录 auth.py ProviderConfig 确认存在的 id；含 `:`/`/` 的自定义模型名不联动）。
- 新增 `_providerForModel(yml, model)`：优先在 `providers:` 段按 `default_model` 精确匹配（覆盖 ollama/custom 场景，如 249 的 `custom_umsalmjwyizjv` 服务 `deepseek-v4-flash:0731`），无匹配才走内置前缀。
- 本地 21 用例回归全过（含 ollama tag 不联动、custom provider 匹配、0.19 嵌套转正、无块追加、保留块内其他键）；102 API 实测：`PUT /api/profiles/coder {model:"deepseek-v4-pro"}` → `provider: deepseek + default: deepseek-v4-pro`；换回 flash 正常；`PUT /api/profiles/default {model:"sensenova-6.7-flash-lite"}` → provider 保持 `custom_umsenyys4pdqe`（providers 段匹配）；全程零空键产生。

### 部署状态（2026-08-04 深夜）

- **102**（192.168.3.102）：monitor 升级部署完成，config.yaml 恢复完整，dashboard `/api/status` 200，profiles 模型解析全对，空键 0。
- **249**（192.168.3.249）：monitor 同步升级（标准 App Center 布局 `/var/apps/hermes-agent/` + 显式 TRIM_* env），dashfix 清理后 config 无 null 顶层键（agent/terminal/web 均有子键非空），dashboard 200，toolsets 缩进修复生效。
- 已知遗留：dashboard `/api/status` 的 `gateway_state` 显示 stopped（hermes 0.20 多 profile gateway 状态文件与 monitor 单 profile 启动方式的差异），实际 gateway 8742 运行正常、聊天不受影响，留待后续。

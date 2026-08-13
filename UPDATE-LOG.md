# fnos-hermes-agent 更新记录

> 单一持续更新记录。最新版本在最上方，安装包见同目录 `fnos-hermes-agent_vX.Y.Z.fpk`。

---

## v0.21.149（2026-08-13）

**隐私安全加固（紧急）：打包产物彻底清除开发者个人信息**：
- **排查结论**：所有 GitHub 发布包（v0.21.85~148 抽查）经全量解包扫描**均不含**「开发者昵称」/密码等个人信息；init/ 记忆模板自 v0.21.101 起为干净空白模板。真正风险点已逐一清除：
- **① 源目录工作记忆 WORK-MEMORY.md（含开发者密码/IP/路径）**：已移出源目录（备份在工作区 .trash），加入 .gitignore，并重写 git 历史按内容清除（含 NAS SSH 密码的所有文件版本 + 含「开发者昵称」的 v0.21.86 init 模板版本 + sync-fpk-webdav.sh 旧版硬编码密码全部从历史删除）
- **② 旧打包缓存 init-pack.tgz（含修复前的开发者昵称模板）**：已隔离，加入 .gitignore，历史清除
- **③ hermes-src 混入的开发调试脚本 conn-mscope.cjs（硬编码 C:\Users\veenyi 路径 + 用户名）**：已从包源移除
- **④ build-slim.sh 隐私兜底**：robocopy 排除 WORK-MEMORY.md/init-pack.tgz/_restore021/*.bak，并在打包副本内二次扫描删除含 NAS SSH 密码 / 「开发者昵称」/ `C:\Users\veenyi` 路径的文件——**任何混入都会在打包时被清除，绝不进 FPK**
- **⑤ 使用提醒（重要）**：GitHub 仓库历史此前为公开（5 个 fork），已 clone 者仍可能持有旧历史副本——**请立即修改 NAS（249/254/102）SSH 密码**，泄露的密码不可撤回

---

## v0.21.148（2026-08-13）

**修复 monitor.js 内存暴涨（WS-PROXY 连接活锁，实测 RSS 1.8GB → 100MB 根因）**：
- **根因**：Dashboard WS 反代收到上游关闭码 **4409**（WS_CLOSE_SUPERSEDED：另一个前端 Attach 同一 PTY 会话）时**无限递归 `connectUpstream()`** 且无次数限制——多个前端（多 TUI + WebUI）同时 attach 同一会话时乒乓互踢，每轮 new WebSocket + 旧连接 close/error 回调残留继续触发重连 → 并发连接风暴 + V8 堆暴涨（实测 RSS 1.84GB、日志 22.6 万条 superseded）
- **修复**：① **4409 加连续次数限制 + 指数退避**——连续 4 次 superseded 后放弃重连并通知浏览器（1011），期间按 0.5s→1s→2s 退避，不再无限递归；② **旧上游连接清理**——重连前先 `removeAllListeners()` + terminate 旧连接，杜绝旧连接回调残留触发并发重连（风暴根源）；③ 连接成功（open）时重置计数；④ cleanup 同步移除监听器
- 249 验证：重启后 RSS 100MB，3 客户端并发 WS 测试 RSS 稳定（71→74MB 正常波动），日志无 superseded 风暴
- **使用提醒**：不要同时开多个 TUI/前端连同一个会话（这是 4409 触发条件）；多窗口查看请保持单一活跃会话

---

## v0.21.147（2026-08-13）

**手机端群聊房间列表强制隐藏（CSS 兜底，根治无法自动隐藏）**：
- **根因**：此前折叠靠 JS（switchPage 钩子 + collapsed class）——仅"点击导航进入群聊"才触发，**刷新/直达/宽视口等场景不生效**，手机上仍显示房间列表+聊天+说明文字三栏挤压
- **修复**：① 移动端（≤768px）`.rooms-layout .rooms-side{display:none}` **CSS 层兜底**——任何进入方式（导航/刷新/直达）都默认隐藏，不再依赖 JS 时序；② 群聊页顶部新增「☰ 房间」按钮，点击以**浮层**方式展开房间列表（230px 抽屉 + 阴影），再点收起；③ 选中房间后浮层自动收起，切出群聊页自动收起；④ 浮层内列表支持滚动（touch 惯性）
- 桌面端布局不变（250px 房间列表常驻）

---

## v0.21.146（2026-08-13）

**手机端会话树可滚动查看（用户实测反馈）**：
- **根因**：会话分组展开样式 `.session-list.open{max-height:400px; overflow:hidden}`——分组内会话超过 400px 高即被截断且无法滚动，专家（默认主力助手）下会话多时"看不到也滚不动，只能删除"
- **修复**：① 展开的会话分组改为 `max-height:none; overflow:visible`，全部会话完整展开，由抽屉外层 `rail-scroll` 统一滚动（桌面/移动一致）；② 移动端抽屉滚动优化（`-webkit-overflow-scrolling:touch` + `overscroll-behavior:contain`）；③ 触摸设备无 hover——会话删除/重命名/专家删除按钮移动端常显（`opacity:1`），不再需要长按找按钮
- 通道会话分组（cron/微信/QQ）同款生效

---

## v0.21.145（2026-08-13）

**通道重复对话深层防护（落实开发者建议，防复发）**：
- **profile 创建剥离平台凭据**：`hermes profile create` 带 clone/clone-all 复制来的 .env 会带上主实例的平台通道凭据（WEIXIN_*/TELEGRAM_*/QQ_* 等），子 profile 也持有通道配置 → 多实例抢连同一账号。现创建 profile 后统一剥离 14 类平台通道凭据，仅保留 LLM API 密钥（249 实测：新建 profile .env 通道凭据键 0）
- **多 Hermes 实例互斥诊断**：monitor 启动时检测同机是否存在本应用以外的 hermes gateway/dashboard 进程（如 /opt/hermes 独立安装），存在则日志告警（可能抢连微信/QQ 通道）；所有 pkill 清理命令限定本应用路径（hermes-agent），**不再误杀同机其他 Hermes 安装**的 gateway/dashboard
- **通道会话聚合去重增强**：优先按 (platform, chat_id) 去重（同一聊天只保留一条），hermes 列表 API 未暴露 chat_id 时退化为 (platform, session id)；聚合对象补充 chat_id 字段透传
- 说明：hermes 会话列表 API 不暴露 chat_id 字段（已实测 8742/9219 返回），chat_id 去重为字段就绪后的自动升级；非主 profile 会话因聚合源固定（127.0.0.1 本应用 gateway/dashboard）天然不会混入

---

## v0.21.144（2026-08-13）

**手机端会话树收起 + 通道会话可删除 + 微信重复对话修复（用户实测反馈）**：
- **手机端收起会话树**：移动端（≤768px）个人会话页强制折叠会话树（抽屉模式，点「打开会话树」才显示，不再残留桌面展开状态）；群聊页移动端默认折叠房间列表，聊天全屏显示；非对话页保持隐藏会话树
- **通道会话可删除**：cron/微信/QQ 等通道会话（原只读、删不掉）新增删除按钮 → 新 API `DELETE /api/channel-sessions/:id`（Gateway 8742 优先，Dashboard 9219 兜底），删除后列表即时刷新
- **微信出现两个对话修复**：`/api/channel-sessions` 双源（Dashboard 9219 + Gateway 8742）合并去重——同一会话此前在两个源各 push 一次导致重复条目，现按 platform+id 去重，保留 Dashboard 优先
- 249 真机验证：新建临时会话 → 删除 API 返回 `{"ok":true,"via":"gateway"}` → gateway 确认已删 ✓

---

## v0.21.143（2026-08-13）

**群聊 AI 自主接力改为全自动（用户实测驱动修复）**：
- **根因**：① 接力需手动点"🤖 接力"按钮且要手动 @ 专家才有人回复——用户要求"逻辑必须是自动的"；② 主持人选中**从未发言过的成员**时，其 Hermes 会话未初始化（session_id 为空）→ 直接静默失败"session 未初始化"→ 接力链中断（249 实测 remaining 卡在 4 不再继续）
- **修复**：① **发消息即自动开链**——用户在群聊发任何消息（无需 @ / 无需按钮）自动开启接力，主持人现场选角并持续发言，直到主持人判定讨论完成或达到轮数上限（默认 8 / 最大 12，可手动停止）；② **成员会话惰性初始化**——首次被选中的成员自动注册 Hermes 会话（ensureMemberSession），不再要求提前 @ 预热；③ **单房间单链引擎**（_chainLoop/_kickRoomChain）——串行驱动、防重复开链、选角失败自动重试一次、JSON 容错（剥离代码块/截断兜底）；④ 轮数用尽/结束发 done 事件，状态条正常收尾；运行时锁 _chainBusy 不落盘（重启自动解锁）
- 249 真机实测：无 @ 消息 → 主持人自动选角 → 3 成员自动接续 9 轮发言、0 错误 ✓

---

## v0.21.102（2026-08-09）

**修复：删除专家报 EACCES 权限错误（249 实测驱动）**：
- **根因**：profile 目录可能由部署/手动操作以其他用户（root/veenyi）创建，属主不是 hermes-agent → 删除时 rmSync 报 EACCES
- **修复**：① monitor 删除专家（_deleteProfile）手动删除前先 `sudo -n chown` 目标目录到当前用户（sudoers 已授 hermes-agent 免密 chown）；② install_callback 的 sudoers 写入校验改为"含 chown 才算完整"（旧版 sudoers 缺 chown 会自动重写）
- 249 实测：chown 后删除成功 ✓

## v0.21.101（2026-08-09）

**隐私修复（紧急）：init/ 知识整合模板清除开发者个人信息**：
- **问题**：安装包内置的 init/ 模板（memories/USER.md、MEMORY.md、knowledge 文档）曾包含**开发者个人档案与内部信息**（姓名、位置、机器 IP、内部路径、开发经验等）——**其他用户安装应用时会被部署到记忆/知识库，造成隐私泄露**
- **修复**：init/ 全部替换为**干净通用模板**（USER.md/MEMORY.md 为空白模板，用户安装后自行填写）；含内部信息的 8 个开发文档从打包中移除
- 已安装的旧版本（≤v0.21.100）：如 memories 已被部署开发者信息，请手动清理 `数据目录/memories/` 下的 USER.md/MEMORY.md（替换为空白模板即可）

**修复：企业微信/微信/Telegram/WhatsApp 扫码登录按钮消失**：
- **根因**：前端通道定义（PV.connectors）缺少 `qrLogin:true` 标记（后端扫码 API/弹窗逻辑均完好）→ 列表按钮显示「配置」而非「扫码登录」，配置弹窗扫码区不渲染
- **修复**：telegram/wecom/weixin/whatsapp 恢复 `qrLogin:true`，扫码登录（腾讯企业微信 AI 机器人扫码、微信 iLink 扫码、WhatsApp 扫码配对、Telegram 扫码）全部恢复
- 249 实测热更验证通过

## v0.21.100（2026-08-09）

**修复：GitHub/WebDAV 更新后应用中心版本不刷新（102 实测驱动）**：
- **根因**：部分机器（如 102）未配置 sudoers（hermes-agent 免密 sudo -u postgres psql）→ 更新后应用中心版本同步失败 → 代码已更新但版本显示旧版
- **修复**：install_callback 自动写入 `/etc/sudoers.d/hermes-appcenter`（cp/chown/psql 免密，终端用户安装即生效）；auto-update 的 psql 同步失败时 fallback 直接改写 `/var/apps/hermes-agent/manifest` 版本
- **WebDAV 无凭证行为**：明确提示"请确认 WebDAV 凭证已配置"，引导改用 GitHub 通道或手动下载——属预期行为（非 bug）
- 102 实测：补 sudoers 后版本同步 0.21.99 成功

## v0.21.99（2026-08-09）

**更新页新增「更新说明」展示**：
- 更新说明随包分发（UPDATE-LOG.md 打包进应用）
- monitor 新增 `/api/app/changelog` 接口；更新页新增「更新说明」卡片，进入更新页自动加载并渲染 markdown 更新记录
- 以后每次发布版本，更新说明都会写进 UPDATE-LOG.md 并在更新页可见

## v0.21.98（2026-08-09）

**安装提速（102 实测驱动）**：
- **install_callback 去除 `--no-cache`**：启用 UV_CACHE_DIR（DATA_DIR/.uv-cache）持久缓存——首次安装全量下载后，**升级/重装复用缓存**，不再每次几百 MB 全量重下
- 依赖安装保持清华 PyPI 镜像（UV_INDEX_URL），下载快
- 说明：hermes[all,voice] 依赖较大（onnxruntime/av/ctranslate2/faster-whisper 等几百 MB），**首次安装需 5-15 分钟**属正常（非卡死）；升级后秒级完成

## v0.21.97（2026-08-09）

**Dashboard 全链路修复 + 全面汉化 + 会话重命名（249 实测驱动）**：
- **官方 Dashboard 代理全套修复**：/chat 不再误拦截；`__HERMES_BASE_PATH__` 注入修正（官方空值覆盖问题）；302 补前缀统一 URL；**移除 history.pushState 劫持**（菜单 SPA 导航黑屏的最终根因）；重建 web_dist（Vite 相对 base，动态 import chunk 不再 404）
- **官方前端 12 处裸路径导航改相对**，反代下不再裸跳黑屏；**BUILD 按钮无限追加后缀 bug 修复**（改回绝对路径，basename 注入后正确拼前缀）
- **应用控制台 URL 直达**：`/sessions` `/files` `/models` 等路径自动跳转 `#/页面`（hash 路由 + SPA 302）
- **「更新 Hermes」恢复官方功能**：hermes-src 初始化为 git 仓库（fpk baseline + 官方 remote），点击执行官方 `hermes update`（git pull + 依赖重装），249 实测 21227 commits 更新成功
- **全面汉化**（治本，React 原生中文）：官方 web 源码 13 页面 ~610 处英文→中文（系统/通讯/会话/模型/定时/技能/插件/MCP/回调/配对/多AGENT/配置）；通讯页 33 渠道描述数据层汉化（monitor 拦截 API）；更新确认弹窗汉化；运行时 DICT 兜底 200+ 条
- **应用控制台会话重命名**：会话列表项与标签页 ✎ 按钮 → POST /api/sessions/rename（改会话 title + 缓存即时刷新）
- **MCP 配置保存合并语义**：前端保存不再清空 CLI 添加的 mcp_servers（websearch 等保留）；嵌套 map（env: {KEY:value}）正确解析/序列化（无 [object Object]）
- 安装包：fnos-hermes-agent_v0.21.97.fpk（40.2MB）

## v0.21.96（2026-08-07）

**自动更新提速与兼容修复（254 实测驱动）**：
- **GitHub 加速镜像超时 120s → 30s**：镜像被堵时不再干等 2 分钟，快速切换直连（直连 15MB/s）
- **自重启兼容修复**：部分机器（如 254）没有手动固化的 start-monitor.sh，升级后 monitor 起不来（应用中心卡「start」）——现在缺失时自动 fallback 到 fnOS 标准 `cmd/main start`（显式传 TRIM_APPDEST=target）
- **环境配置补齐**（254 等）：WebDAV 凭证（HERMES_WD_*）未配置时 WebDAV 通道快速报错提示；sudoers 补 psql/chown 免密（应用中心版本同步 + 权限修复生效）
- 254 实测：WebDAV 下载 38.3MB 约 6 秒，全流程升级 → 0.21.96 | running

- 安装包：fnos-hermes-agent_v0.21.96.fpk（40.1MB）

## v0.21.95（2026-08-07）

**飞牛操作员全面强化（trim-cli 官方 v2 Skill）+ 官方升级流程对齐**：
- **trim-cli Skill 升级官方 v2**：命令域从 10 个扩到 13 个——新增**相册**（目录/搜索/详情/预览/AI 搜图 magic-search）、**影视库**（媒体库统计/搜索/详情/播放投屏链接）、**网络与电源**（SSH 开关/重启/关机）；认证与连接增强（2FA/TOTP、信任设备、多 NAS profile、WS/WSS 自动选择、自签证书、session 安全存储、输出脱敏）；文件管理扩展（上传/重命名/压缩解压/回收站/收藏/ACL/owner/团队目录/挂载点/用量）；存储（空闲磁盘/RAID 创建校验）；Docker（镜像/容器/Compose）
- **SKILL.md 强化**：追加「fnOS 应用内使用」章节——调用方式、高频任务速查表、安全纪律
- **飞牛操作员（fnos_operator）SOUL 强化**并绑定 trim-cli skill（102/249 已部署）
- **官方开发文档知识库**：完整学习 llms-full.txt（5219 行）沉淀为《飞牛官方开发文档速查》（生命周期脚本契约/Manifest/TRIM_*环境变量/权限模型/统一网关/开放 API/wizard），随包部署
- **自动更新对齐官方升级流程**：覆盖后新增 **upgrade_callback 式权限修复**（sudo -n chown -R APP_DIR/VAR_DIR + chmod，模拟 TRIM_APP_STATUS=UPGRADE 语义），防覆盖后权限漂移导致启动失败；102 实测通过
- **修复历史 bug**：init/（知识整合模板）此前从未被打包进 FPK，现已随包分发

- 安装包：fnos-hermes-agent_v0.21.95.fpk（67.4MB，含 trim-cli 全平台二进制）

## v0.21.94（2026-08-07）

**记忆页同步官方 Hermes 信息**：
- **SOUL.md**：同步为官方 Hermes 出厂默认 persona（DEFAULT_SOUL_MD，"You are Hermes Agent, an intelligent AI assistant created by Nous Research..."），与官方保持一致
- **fnOS 运行环境说明**（系统特征/关键路径/目录别名/工具授权/语言偏好/trim-cli 纪律等）移至 **AGENTS.md** 保留，内容不丢失
- 记忆页（SOUL.md / MEMORY.md / notes.md）与 hermes 官方同路径读写，天然一致；已同步 102/249 运行时文件（原文件备份于 NAS /tmp/bak-*）
- 各 profile 的自定义 SOUL.md（如 nas_____ 的运维专家 persona）不受影响

- 安装包：fnos-hermes-agent_v0.21.94.fpk（43.9MB）

## v0.21.93（2026-08-07）

**更新页改为双通道选择**：
- 更新页拆成两个更新按钮：**⬇ GitHub Release 更新**（走 GitHub 加速镜像 + 直连，适合能访问 GitHub 的网络）与 **⚡ WebDAV 更新**（走内部分发通道，国内网络更快，无需访问 GitHub）
- 后端自动更新支持 `source` 参数：`github`（仅 GitHub）/ `webdav`（仅 WebDAV）/ 默认多源
- 通道失败时给出明确提示（如 WebDAV 未配置凭证、GitHub 网络不通），不再静默换源
- 249 实测自动更新成功（WebDAV 下载 42MB 秒级）

- 安装包：fnos-hermes-agent_v0.21.93.fpk（43.9MB）

## v0.21.92（2026-08-07）

**修复：面板定时任务与对话创建的定时任务两套（读写错位）**：
- 根因：hermes 0.20 起定时任务按 profile 隔离存储（profiles/\<p\>/cron/jobs.json），但面板创建/操作任务时固定锚定全局目录（HERMES_HOME=DATA_DIR），而列表读取的是活跃 profile 的存储 → 面板任务写全局、读 profile，与对话任务（写在活跃 profile）分成两套，且面板操作会干扰对话任务
- 修复：面板创建/操作任务统一注入**活跃 profile home**（与对话任务同一存储）；活跃 profile 解析补全 HERMES_HOME 环境（此前解析失败返回空）
- 验证：102 实测面板创建任务正确写入活跃 profile（nas_____）存储、列表可见、删除正常

- 安装包：fnos-hermes-agent_v0.21.92.fpk（43.9MB）

## v0.21.91（2026-08-07）

**手机端兼容性全面修复**：
- **知识库**：手机端改为上下布局（文件树上/内容下），不再左右挤压；点开文件夹查看笔记后不再被强制折叠（保留展开状态）
- **工具调用区**：「始终折叠」开关生效（运行中也保持折叠）；流式回复中输入内容后发送按钮可发**纠偏**（redirect），未输入时点按=停止
- **定时任务**：调度时间显示修复（不再显示 [object Object]），卡片防溢出
- **多会话**：点击当前标签可收起标签栏；工作区按钮手机端恢复显示
- **用量统计**：模型分布"unknown"改为「未知模型」，卡片/模型行手机端紧凑防溢出
- **输入框工具条**：手机端用 ＋ 折叠展开（展开后变 − 收起）
- **会话标签**：手机端标签更紧凑，标题截断防溢出

- 安装包：fnos-hermes-agent_v0.21.91.fpk（43.9MB）

## v0.21.90（2026-08-07）

**紧急修复：大量用户全新安装/卸载重装失败（uv 下载 404/403）**：
- 根因：install_callback 下载 uv 的清华镜像 URL 写错（`/simpleuv/` 缺斜杠 → 404），清华限流时 403，GitHub 兜底大陆又不通 → 全新安装必失败；升级不受影响（uv 已缓存且 upgrade_callback URL 正确）
- 修复：uv 下载改为**多源查询**（清华 → 阿里云 → 官方 PyPI，URL 修正为 `/simple/uv/`）+ GitHub/ghproxy 兜底
- 验证：测试机模拟全新安装 uv 下载成功（22.3MB）

- 安装包：fnos-hermes-agent_v0.21.90.fpk（43.9MB）

## v0.21.89（2026-08-07）

**安装/更新流程改造**：
- **更新流程**：应用内自动更新改为「先停止服务 → 解压覆盖 → 自动重启」——更新完成后服务完整启动，应用中心显示「运行中」，不再出现「更新了但显示未启动」
- **安装流程**：安装前自动检查并清理端口冲突（8650/8742/9219 被旧 hermes 进程占用时自动清理，避免安装/启动失败）；只清理 hermes 相关进程，不影响其他应用

- 安装包：fnos-hermes-agent_v0.21.89.fpk（43.9MB）

## v0.21.88（2026-08-07）

**紧急修复：大量用户安装失败**：
- 根因：install_callback 的 set -e/trap ERR 导致清华镜像 403 时脚本立即中止，多源重试形同虚设
- 修复：editable 安装段局部禁用 ERR 中断，三源重试链走完再统一判断；重试顺序改为 官方 PyPI → 阿里云 → 清华

- 安装包：fnos-hermes-agent_v0.21.88.fpk（43.9MB）

## v0.21.87（2026-08-07）

**修复**：自动更新分享直链下载校验——下载到 HTML 预览页时自动切换 GitHub 兜底；自动更新大陆加速（WebDAV → 分享直链 → GitHub 加速镜像 → 直连四层）

- 安装包：fnos-hermes-agent_v0.21.87.fpk（43.9MB）

## v0.21.86（2026-08-07）

**重大新增（Hermes 知识整合方案融合）**：
- **知识整合三层闭环**：记忆（memories/）↔ 知识库（knowledge/）↔ 技能（skills/）打通
- **init/ 首装模板**：新 NAS 安装 fpk 即自动部署 8 条项目经验知识 + 记忆模板 + knowledge-sync 技能 + 每 30 分钟镜像 crontab（memories → knowledge 单向）
- **手段级技能 knowledge-sync**：「记下来/沉淀」→ 知识库秒见
- 安装/升级回调自动执行 init；monitor 启动镜像兜底

- 安装包：fnos-hermes-agent_v0.21.86.fpk（43.9MB）

## v0.21.85（2026-08-07）

**紧急修复**：纠偏（redirect）连续触发导致网关 turn 失败（「Gateway 连接失败」）——nemo_relay scope 栈错乱自愈修复，已部署 254/102/249 三台。

- 安装包：fnos-hermes-agent_v0.21.85.fpk（43.9MB）

## v0.21.84（2026-08-06）

**修复**：安装报「uv 安装失败: 404」——wheel 查询 URL 缺斜杠 bug + editable 安装多源重试（清华→官方 PyPI→阿里云），安装成功率大幅提升。

- 安装包：fnos-hermes-agent_v0.21.84.fpk（43.9MB）

## v0.21.83（2026-08-06）

**修复与新增**：
- 定时任务卡片投递字段显示错乱（[object Object]）修复
- 定时任务新增「编辑」按钮：可修改名称/提示词/调度/技能/投递通道后保存

- 安装包：fnos-hermes-agent_v0.21.83.fpk（43.9MB）

## v0.21.82（2026-08-06）

**新增**：设置页两个开关控制会话窗口工具调用区——
- **工具调用区始终折叠**（默认开）：工具记录保持折叠不刷屏，点「展开」可查看
- **隐藏工具调用区**：回复中完全不显示工具记录（不影响工具执行）

- 安装包：fnos-hermes-agent_v0.21.82.fpk（43.9MB）

## v0.21.81（2026-08-06）

**修复**：
- 我的专家卡片新增「删除」按钮
- 回退模型刷新后不再丢失（读取持久化配置）
- 升级/自动更新时保留模型等配置（install_init 探测增强 + TRIM_* 环境变量显式传递）
- 恢复版本迭代（修复相同版本号无法覆盖安装）

- 安装包：fnos-hermes-agent_v0.21.81.fpk（43.9MB）

## v0.21.80 增强（2026-08-06）

**重大新增**：
- **应用内自动更新**：更新页发现新版本出现「⚡ 自动更新」按钮——下载最新 FPK 后用 appcenter-cli 直接安装升级（无需手动下载/进应用中心）；另有「下载安装包」兜底（GitHub 加速方案或网盘）
- **飞牛操作员专家全面增强**：对齐飞牛开发平台全栈能力——appcenter-cli 应用管理、开放平台 API（/api/v1/trimapp + TRIM_API_TOKEN）、应用中心体系（FPK/回调/热补丁/自动更新）、运维域全覆盖，技能扩充

- 安装包：fnos-hermes-agent_v0.21.80.fpk（43.9MB）

## v0.21.80（2026-08-06）

**修复与新增**：
- **用量统计根治**：改为统计应用自身会话数据（此前依赖 dashboard 会话库恒为 0）
- **内置专家可编辑设定**：专家页内置专家卡片新增「编辑设定」（名称/提示词/技能等，保存即覆盖生效）
- **工作流可编辑**：模板卡片新增「编辑」（名称/分类/描述）
- **文字居中统一**：工作流/定时页说明与团队页一致居中
- **连接器提示**：保存后提示正在重启网关加载工具；注意连接器工具需经网关模型路由才可用

- 安装包：fnos-hermes-agent_v0.21.80.fpk（43.9MB）

## v0.21.79（2026-08-06）

**修复**：
- 官方 dashboard 的 chat / system 页空白 → 显示中文提示页并引导到应用内「对话」「概览」页（官方页面依赖 PTY/缺失 API，上游不适配）
- 官方「更新 Hermes」报 Not a git repository → 改为中文指引：请用应用中心 FPK 或应用内「更新」页

- 安装包：fnos-hermes-agent_v0.21.79.fpk（43.9MB）

## v0.21.78（2026-08-06）

**修复**：
- 语音「自动朗读回复」默认关闭（需要时手动开启）
- 新建会话目录选择器「+目录」权限不足修复
- PyPI 镜像切换清华（阿里云 403 导致安装失败）
- 创建中文名 Agent 报「已存在」误报修复（下划线碰撞）
- 通道会话加载失败提示友好化

- 安装包：fnos-hermes-agent_v0.21.78.fpk（43.9MB）

## v0.21.77（2026-08-06）

**修复**：侧边栏菜单在矮窗口/内嵌打开时显示不全（底部功能被裁）——已支持滚动，任意高度都能访问全部功能（记忆/轨迹/用量/更新/设置等）。

- 安装包：fnos-hermes-agent_v0.21.77.fpk（43.9MB）

## v0.21.76（2026-08-06）

**新增**：
- **种子内容**：知识库自动写入 README（使用说明/目录结构），记忆 notes.md 自动写入基础框架——页面不再空白
- **自动沉淀**：①对话中使用的技能/工具自动记录到知识库「技能使用」；②说「记住/请记住……」内容自动写入记忆；③AI 也可通过 Obsidian 技能把学习内容写进知识库（同一 vault）

- 安装包：fnos-hermes-agent_v0.21.76.fpk（43.9MB）

## v0.21.75（2026-08-06）

**加固**：Obsidian 技能**内置固化**——启动时自动部署到每台机器的用户技能目录（`DATA_DIR/skills/note-taking/obsidian`），技能随包分发；即使被删除，下次启动自动恢复（"无法删除"保证）。知识库功能全链路依赖此技能，现已每机必备。

- 安装包：fnos-hermes-agent_v0.21.75.fpk（43.9MB）

## v0.21.74（2026-08-06）

**新增**：左侧菜单「📚 知识库」——Obsidian 风格知识管理页：文件树浏览、笔记阅读/编辑/新建/删除、frontmatter 属性、[[wikilink]] 内部链接跳转、反向链接。数据存 `DATA_DIR/knowledge`（Obsidian 兼容格式），已配置 Hermes 内置 Obsidian 技能指向同一库——AI 学习/技能使用沉淀与页面浏览编辑打通。

- 安装包：fnos-hermes-agent_v0.21.74.fpk（43.9MB）

## v0.21.72–73（2026-08-06）

**新增**：通讯页每个已配置平台增加独立「启用/禁用」开关（对齐原版 dashboard）——点击切换写入 platforms.<平台>.enabled 并重启网关生效，可分别控制各渠道收发。

- 安装包：fnos-hermes-agent_v0.21.73.fpk（43.9MB）

## v0.21.71（2026-08-06）

**优化**：新建会话「工作区文件夹」升级为**目录选择器**——点击 📂 浏览 可像文件浏览器一样进入已有文件夹、上级返回、点「+目录」新建文件夹（新会话放新文件夹一步到位），选择后回填。

- 安装包：fnos-hermes-agent_v0.21.71.fpk（43.9MB）

## v0.21.70（2026-08-06）

**优化**：新建会话「工作区文件夹」支持下拉选择已有工作区（也可输入新名称），不再只能手输。

- 安装包：fnos-hermes-agent_v0.21.70.fpk（43.9MB）

## v0.21.69（2026-08-06）

**新增**（对齐官方 v0.20.0 能力）：
- **redirect 中途纠偏**：AI 回复进行中直接输入新消息即可纠偏（网关自动调用 agent.redirect，保留当前工作状态结合新要求调整）；消息带「🎯 纠偏」标签，输入框有纠偏提示
- **Grounded Citations 证据引用**：AI 按内置 grounded-citations 技能输出带编号引用（[n]）+ Sources 来源块；前端渲染为引用角标 + 可点击来源卡片；支持 [unverified] 未核实标记与逐字证据核验工作流（skill 已在包内）

- 安装包：fnos-hermes-agent_v0.21.69.fpk（43.9MB）

## v0.21.68（2026-08-06）

**修复**：新建会话弹窗的模型下拉显示 `[object Object]`——providers 的 models 元素是对象（{id,name,enabled}），原代码直接字符串化渲染。已改为提取模型名并按 provider 分组展示（禁用模型过滤）。

- 安装包：fnos-hermes-agent_v0.21.68.fpk（43.9MB）

## v0.21.67（2026-08-06）

**打包脚本修复**：robocopy 按目录名排除曾误伤 `ui/scripts`（marked 库）与 `web_dist/assets`（Dashboard 前端），导致安装后 Markdown 无格式、Dashboard 启动崩。已改为全量镜像 + 显式删开发目录 + 资源断言，杜绝残缺包。**请使用本版本安装（v0.21.66 及更早 slim 包有缺陷）**。

- 修复：build-slim.sh 打包流程、lifecycle_guard NUL 字节崩溃（terminal 工具）
- 安装包：fnos-hermes-agent_v0.21.67.fpk（43.9MB）

## v0.21.66（2026-08-06）

- 修复：249 Dashboard 启动崩溃（web_dist/assets 缺失 → 从包补全）
- 修复：terminal 工具 `embedded null byte`（lifecycle_guard `os.open` 对 NUL 路径抛 ValueError，补捕获）

## v0.21.65（2026-08-06）

- 修复：手机端恢复「语音设置」按钮入口（语音对话模式/barge-in/音色配置入口）

## v0.21.64（2026-08-06）

- 新增：流式语音朗读（AI 回复边生成边逐句朗读，clause-by-clause）
- 新增：Barge-in 说话打断（朗读中开口说话即打断并自动听你说）
- 对齐官方 Hermes v2026.8.3 语音体验

## v0.21.63（2026-08-06）

- 新增：语音对话模式（官方 Voice Mode 免手循环：说话→回复→朗读→自动再录音）

## v0.21.62（2026-08-06）

- 修复：移动端浏览器兼容（100vh→100dvh，Edge/Chrome 底部遮挡）

## v0.21.61（2026-08-05）

- 修复：语音输入强制中文识别（stt.local.language=zh）

## v0.21.60（2026-08-05）

- 新增：语音设置音色选择（7 种 Edge 中文音色，试听/保存）

## v0.21.59（2026-08-05）

- 修复：麦克风 400 根治（whisper 模型 vocabulary 不完整 → ModelScope 补全）

## v0.21.53–58（2026-08-05）

- 新增：隧道菜单（Cloudflare Tunnel 外网访问，Quick/Named + 二维码）
- 新增：两级折叠菜单栏（Octop 式）、手机端精简与显示优化

## v0.21.45–52（2026-08-04~05）

- 新增：通道角色路由（profile_routes）、企微群聊/出站推送、多窗口同步、圆桌修复、FPK 体积裁剪

## v0.21.27–38（2026-08-02~04）

- 升级：Hermes 核心 0.20.0；FPK 安装配置持久化；profile 同步；网关重启提速

---

*本文件随每次发布更新，历史版本完整保留。*

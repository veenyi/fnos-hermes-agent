# fnos-hermes-agent 工作记忆全记录（完整版）

> 生成时间：2026-08-07 00:50 · 覆盖范围：**v0.20.38（项目起源）→ v0.21.84（当前）**，含 v0.22 方向前瞻
> 覆盖两台 NAS：**102**（192.168.3.102，@vol1，主用）与 **249**（192.168.3.249，@vol3，翻墙环境快）
> 项目位置：`C:\Users\veenyi\Documents\QoderCN\2026-08-02\chat-1\fnos-hermes-agent` · git 提交 250+ 个 · CHANGELOG 56+ 版本

---

## 〇、项目全景（起源 → 现在 → 方向）

**起源（v0.20.38，约 2026-07）**：fnOS 应用中心 Hermes Agent 应用。**Node.js 基座**（自研 `monitor.js` + 内置 `ws` 库，弃 Bun），Hermes 核心 Python。发布者改 **veenyi**（GitHub 项目主页），Dashboard 中文汉化。

**技术架构**：monitor.js（Node，HTTP/WS 网关、配置管理、进程守护）→ 拉起 hermes gateway（Python，8742）与 dashboard（9219）→ 前端单文件 index.html（8650 门户代理，BASE_PATH=/app/hermes-agent）。三目录：@appcenter（应用）/ @apphome（数据）/ @appdata（配置）。

**当前版本**：v0.21.84（2026-08-07）。**未来方向**：v0.22 全家桶（2026-08-05 八项目调研总蓝图：hermes-studio / hermes-agent / Octop / jnMetaCode / LightAgent 融合——语音对话 + Octop 风首屏 + 安全网关）。

---

## 一、完整版本演进史（阶段划分）

### 阶段 A：起源与汉化（v0.20.38–42，7 月中下旬）
| 版本 | 内容 |
|------|------|
| v0.20.38 | **项目起点**：Node 基座（monitor.js + ws，弃 Bun）、Hermes 0.19.0、发布者 veenyi、Dashboard 中文汉化（导航/配置标签/系统页） |
| v0.20.39–41 | 修复与稳定性（汉化完善、问题修复） |
| v0.20.42 | **聊天界面 v17 原型融合**进真实项目（Studio 布局雏形） |

### 阶段 B：成长期（v0.21.5–26，7 月底–8 月初）
- **v0.21.5**：MCP 自动注册根因修复 + Dashboard 稳定性 + 热更新
- **v0.21.7**：应用无法启动修复（单实例守卫改接管式 + 残留进程清理）
- **v0.21.9**：UI 大改版——学习轨迹 3D 图谱 / 会话窗口 Studio 布局 / 工作流模板修复 / 模型下拉选择
- **v0.21.10**：WebSocket 断连修复（自动重连 + 流结果缓存 + SSE 降级复用）
- **v0.21.11**：WS 重连重复请求 + 安装包图标 + 版本号显示
- **v0.21.12**：工作流/专家团模式未生效修复
- **v0.21.6**：多 Agent 圆桌讨论 & 模型预配置 & 交互增强 & 更新链路修复

### 阶段 C：核心升级（v0.21.27–38，8/2–8/4）
- **Hermes 核心 0.19.0 → 0.20.0**（Herald Release v2026.8.3）
- FPK 安装**配置持久化**（三目录体系）、profile 同步、网关重启提速

### 阶段 D：通道扩展（v0.21.45–52，8/4–8/5）
- **通道角色路由（profile_routes）**、企微群聊/出站推送、多窗口同步、圆桌修复、FPK 体积裁剪

### 阶段 E：移动端与语音（v0.21.53–64，8/5）
- **v0.21.56**：两级折叠（会话树→左侧菜单栏，Octop 式简洁界面）
- **v0.21.57**：折叠按钮合并（消除顶栏/会话头重叠）
- **v0.21.58**：手机端浏览器统一精简
- **v0.21.59**：手机端麦克风 400 根治（whisper 模型文件不完整）
- **v0.21.60**：语音设置「声音」选择（TTS 音色切换）
- **v0.21.61**：语音输入强制中文识别 + 移动端输入框聚焦滚动
- **v0.21.62**：移动端 100vh→100dvh（Edge/Chrome 底部遮挡）
- **v0.21.63**：**语音对话模式**（对齐官方 Voice Mode，免手连续语音会话）
- **v0.21.64**：**流式语音朗读**（边生成边说话）+ Barge-in 说话打断

### 阶段 F：稳定性（v0.21.65–67，8/5–8/6）
- **v0.21.65**：手机端恢复「语音设置」按钮入口
- **v0.21.66**：**249 Dashboard 启动崩溃**（web_dist 缺失）+ terminal 工具 NUL 字节崩溃修复
- **v0.21.67**：打包脚本修复（**FPK 曾缺失运行资源**：marked 库 + Dashboard 前端 assets）

### 阶段 G：今日会话（v0.21.68–84，8/6–8/7）——详见第二章
对齐官方能力 → 知识库体系 → 自动更新 → 系列修复

### 阶段 H：未来方向（v0.22.x，规划中）
**v0.22.1 蓝图**（八项目调研总蓝图落地）：Studio P0——①WebChat 语音对话（STT 麦克风 + 流式 TTS + barge-in，三条降级链路）；②Octop 风首屏；③安全网关（tool_guard）。后续：hermes-studio 菜单参考 / jnMetaCode 角色体系 / LightAgent 升华机制融合。

---

## 二、今日会话详细记录（v0.21.68 → v0.21.84）

### 版本迭代表
| 版本 | 核心内容 | 用户诉求/问题来源 |
|------|---------|-----------------|
| v0.21.69 | redirect 中途纠偏 + Grounded Citations 证据引用 | 对齐官方 v0.20.0 能力 |
| v0.21.70 | 新建会话工作区文件夹可选（下拉） | 要求可选择 |
| v0.21.71 | 工作区文件夹目录选择器（浏览/新建） | 下拉不够，要像文件浏览器 |
| v0.21.72–73 | 通讯渠道独立启停开关 | 像原版 dashboard 分别控制 |
| v0.21.74 | 知识库（Obsidian 风格） | 左侧加「知识库」菜单，学习沉淀 |
| v0.21.75 | Obsidian 技能内置固化 | 技能不是每台机器都有 |
| v0.21.76 | 知识库/记忆种子 + 自动沉淀 | 知识库、记忆页为空 |
| v0.21.77 | 侧边栏可滚动 | Launcher 内嵌功能被裁 |
| v0.21.78 | 自动朗读默认关/目录权限/pip 清华源/中文名碰撞/通道会话提示 | 多项反馈 |
| v0.21.79 | dashboard chat/system 空白提示 + 更新 git 指引 | 严重 Bug |
| v0.21.80 | 用量根治+专家/工作流编辑+居中+连接器+自动更新+飞牛操作员 | 大规模需求 |
| v0.21.81 | 专家删除+回退持久化+升级保配置+版本迭代+MCP 自愈 | 多项修复 |
| v0.21.82 | 工具调用区显示控制 | 工具记录刷屏 |
| v0.21.83 | 定时任务错乱+编辑+自动更新解包覆盖+版本缓存 | 定时任务+更新失败 |
| v0.21.84 | 安装 uv 404+分享直链+跳过 PyPI+应用中心同步 | 安装报错+状态不一致 |

### 功能新增要点
- **redirect 纠偏**：网关原生支持（busy follow-up interrupt→agent.redirect），前端流式输入即纠偏（🎯 标签），无需用户打"纠偏"二字
- **Grounded Citations**：官方 Skill 层（grounded-citations v1.1.0 + sources.py），前端渲染来源卡片 + [n] 引用角标
- **工作区选择器**：/api/workspace/dirs + /api/files 复用，浏览/新建/回填
- **渠道启停**：platforms.<id>.enabled + /api/channels/:id/toggle + 前端 toggle
- **知识库**：Obsidian 兼容 vault（/api/kb/tree|read|write|new|settle）、wikilink 双向链、反向链接、OBSIDIAN_VAULT_PATH 与 AI 技能共用
- **技能固化**：_deployBuiltinSkills 启动自动部署（删除自动恢复）
- **自动沉淀**：技能使用自动记录（技能使用/日期.md）、「记住/请记住」→ notes.md
- **应用内自动更新**：检查→「⚡ 自动更新」→ 分享直链下载 → 解包覆盖 → manifest+版本缓存+应用中心同步 → 重启
- **飞牛操作员专家**：appcenter-cli 全命令 + 开放平台 API（/api/v1/trimapp + TRIM_API_TOKEN）+ 应用中心体系 + 运维域

---

## 三、重要 Bug 排查与解决（今日会话 12 项）

1. **custom_routes.js 拦截**（渠道开关不生效）→ 加调试日志定位：/api/channels 被 handleCustomRoute 先匹配，custom_routes.js 有独立渠道逻辑——两处同步
2. **用量统计为 0** → dashboard analytics 依赖 active profile 的 state.db（`______` profile 无该库）→ 改直接统计 SESSIONS_DIR/*.json
3. **中文名 profile 碰撞** → 「法律顾问」→`____` 撞遗留 `______` → 纯下划线 id 用时间戳
4. **回退模型刷新丢失** → POST 不落盘（修）+ GET 硬编码空数组（修）双根因
5. **MCP 消失** → config.yaml YAML 损坏 hermes 忽略 + 外部覆盖 mcp_servers → 合并模式 + 3 分钟定期自愈
6. **uv 404 安装失败** → editable 失败回退 wheel + wheel URL 缺斜杠（/simplehermes-agent/）→ 修 URL + 多源重试（清华/官方/阿里）
7. **装 PyPI 多余** → tui_dist provisioning 是 0.19 旧路径（v0.20 用包内 ui-tui/dist）→ 跳过
8. **应用中心版本/状态不一致** → postgres appcenter.app 表（version+status）→ auto-update 自动同步 + 启动同步 running
9. **定时任务 [object Object]** → deliver 字段是对象 → 兼容提取 channel/name/type/kind
10. **dashboard chat/system 空白** → PTY 桥代理不可用 + /api/system 上游缺失 → 中文提示页引导
11. **新建目录权限** → mkdir 相对路径写错位置 → 拼 WORKSPACE_ROOT
12. **连接器用不到** → 网关重启异步失败静默 + 直连 provider 无工具 → 保存提示 + 连接器对话注入（mcp__conn_* 引导）

---

## 四、基础设施与运维

### 发布链路（每版固定动作）
改代码 → 语法检查+单测 → build-slim 打包 → WebDAV 推送（发布通道）→ 102/249 热更（up.cjs/up249b.cjs + cmd sudo 部署）→ 重启 monitor → git push（网络重试）→ **GitHub Release**（tag + FPK 资产删旧传新）→ CHANGELOG/UPDATE-LOG

### 通道分工（必须遵守）
- **WebDAV（nas.aio.run:5244/dav/FnosAPP，tim）** = 内部发布推送通道（仅我推包用）
- **alist 分享直链（https://nas.aio.run:5667/p/82005ffed8df428bb3/<文件>）** = 公众/用户下载通道（自动更新源，免认证）
- **不可混用**：自动更新走分享直链，WebDAV 绝不用于公众下载

### 🔒 安全事件：密码泄露
- `sync-fpk-webdav.sh` 曾硬编码 alist 密码进**公开 GitHub 历史**（38a0b45/7cd2cf4/c6c4153）
- 已处理：当前代码移除（读本地凭证 ~/.qwenworkcn/webdav-credentials 不入 git）；monitor.js 无密码
- **强烈建议用户修改 alist 密码**；如需抹历史可重写（force push，破坏已 clone 副本）

### 自动更新最终链路
检查更新 →「⚡ 自动更新」→ 分享直链下载（秒级）→ GitHub 兜底 → 解包覆盖 APP_DIR → sudo cp manifest → 清版本缓存（VERSION_OVERRIDE_FILE）→ 同步 postgres app 表（version + status）→ 重启服务

### 两台 NAS 关键路径
| 项目 | 102（@vol1） | 249（@vol3） |
|------|-------------|-------------|
| 应用目录 | /vol1/@appcenter/hermes-agent | /vol3/@appcenter/hermes-agent |
| 数据 | /vol1/@apphome/hermes-agent/data | /vol3/@apphome/hermes-agent/data |
| 配置 | /vol1/@appdata/hermes-agent | /vol3/@appdata/hermes-agent |
| sudo 密码 | Ferr0li@123 | Ferr0li@369 |
| sudoers | /etc/sudoers.d/hermes-appcenter（appcenter-cli/cp/psql 免密） | 同左 |

### 用户环境
- 用户：**紫寒**，位置：**广东江门**（天气默认江门）
- 专家：默认主力助手 / 我的团队 / NAS 深度运维 / 程序员 / 飞牛操作员等
- 模型：sensenova（sensenova-6.7-flash-lite 主用）+ sensenova1（deepseek-v4-flash 回退）
- 本地工具：桌面「启动Hermes.bat」+ Hermes-Launcher.html（磨砂玻璃启动器，连接历史）

---

## 五、待办与建议

1. **修改 alist 密码**（泄露善后，改完告知更新本地凭证）
2. 自动沉淀「对话要点提炼」（当前是技能记录+记住指令，可加 LLM 摘要）
3. GitHub 历史密码清理（可选，需用户确认 force push）
4. 飞牛开放平台 API 实际调用验证（飞牛操作员专家已具备能力描述）
5. v0.22 全家桶推进（语音对话已部分落地 v0.21.63-64，继续 Octop 风首屏 + 安全网关）
6. 桌面 Launcher 精简为单入口（bat 为主）

---

## 六、经验教训沉淀（核心 10 条）

1. **后端接口先查 custom_routes.js 是否拦截**（channels 事件）
2. **持久化三查**：POST 落盘 / GET 读回 / 刷新重启保留（回退模型事件）
3. **YAML 写入保结构**：专用函数 _setTopLevelBlock/_setYamlMapBlock，别手拼（损坏→hermes 忽略配置→MCP 消失）
4. **版本号必须递增**（fnOS 拒绝相同版本覆盖安装）
5. **升级不动用户配置**：install_init 多路径探测 config.yaml；auto-update 显式传 TRIM_* env
6. **凭证绝不进代码**：本地文件/环境变量；进过公开仓库=泄露，立即改密
7. **下载走公众通道**：自动更新用分享直链，WebDAV 仅发布
8. **应用中心状态与实际一致**：auto-update 后同步 postgres（version + status）
9. **URL 拼接注意斜杠**：/simple/hermes-agent/ vs /simplehermes-agent/（一次 404 事件）
10. **每版全链路验证**：语法→单测→部署→实测→Release→文档，缺一不可

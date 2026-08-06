# fnos-hermes-agent 更新记录

> 单一持续更新记录。最新版本在最上方，安装包见同目录 `fnos-hermes-agent_vX.Y.Z.fpk`。

---

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

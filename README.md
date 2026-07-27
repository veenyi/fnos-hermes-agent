# Hermes Agent for fnOS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Fnos](https://img.shields.io/badge/Platform-Fnos%20-green.svg)]()
[![Arch: x86_64 | arm64](https://img.shields.io/badge/Arch-x86__64%20%7C%20arm64-orange.svg)]()

Hermes Agent 是专为适配飞牛 NAS（fnOS）的 AI 助手应用，通过原生 `.fpk` 在应用中心部署。采用基于 **Node.js** 的 Monitor 服务进行进程管理，提供基于 Web 的控制面板用于配置和对话交互。

> 本 fork 由 [veenyi](https://github.com/veenyi/fnos-hermes-agent) 维护，在 upstream Hermes Agent 0.19.0 基础上针对 fnOS 做了基座适配、Dashboard 汉化、移动端优化、通讯平台集成和稳定性修复。

## 功能特性

### 核心能力
- **多模型供应商接入**：OpenRouter、OpenAI、Anthropic、Kimi、MiniMax、自定义 OpenAI 兼容 API 等。
- **网页端对话**：完整 Markdown 渲染，支持图片/文件上传供 Agent 分析，支持会话历史与会话管理。
- **持久记忆**：跨会话学习与对话记忆（由 upstream Hermes Agent 提供）。
- **代码执行**：支持安全的代码/终端工具执行（需显式启用 `code_execution` 工具集）。

### 中文本地化
- **Dashboard 中文汉化**：导航菜单（Files→文件、Channels→通讯、Webhooks→回调参数、Pairing→配对、KANBAN→看板、achievements→成就）、后端配置标签、通用界面文案在简体/繁体中文下自动汉化，不影响其他语言切换。
- **扩展页工具集中文映射**：对 `/proxy/dashboard/api/tools/toolsets` 返回的 25 个原生工具集（联网搜索、浏览器自动化、终端/进程、视觉/图像分析、定时任务等）做中文 `label`/`description` 替换。

### 通讯平台集成
- **微信**：iLink `ilinkai.weixin.qq.com` deep-link 扫码登录，本地 qrcode-generator 渲染 QR。
- **Telegram**：Nous onboarding 配对流程，本地轮询配对状态。
- **WhatsApp**：本地 Baileys bridge，随 fpk bundle，首次运行自动安装依赖。
- **QQ、钉钉、飞书、Discord、Slack、Matrix、企业微信**：统一 Channels 配置页，支持各平台行为字段与开关。

### 专家团与工作流
- **专家团（Personas）**：支持自定义角色、专家团胶囊栏、一键切换专家。
- **delegation 工具集**：启用后专家团升级为原生 `delegate_task` 多智能体协作。
- **工作流编排**：集成 `agency-orchestrator` DAG 工作流技能，支持任务委派与统一工作流中心。

### 移动端适配
- 响应式布局，顶部导航横向滚动，胶囊栏单行横向滚动。
- 聊天输入框自适应宽度，底部安全区适配。
- 弹窗采用 flex 纵向布局 + 独立 body 滚动，确保小屏下按钮始终可见。

### 运维与更新
- **应用更新卡片**：控制面板「更新」页直接拉取 GitHub Release，显示版本说明与 `.fpk` 直链，一键下载。
- **看门狗诊断面板**：BASE 路径自动推导 + socket 自愈，根治浏览器永久转圈。
- **WebChat 稳定性**：自动重连、中断恢复、PTY session supersede 处理、右侧工具/事件面板 WebSocket 修复。

## 安装与配置

### 环境要求

- 可用存储空间：约 1GB（含 Python 依赖包和缓存）
- 依赖项：`nodejs_v24`（安装时自动处理）

### 安装步骤

1. 在飞牛应用中心添加第三方源或直接上传 `.fpk` 安装包
2. 等待安装完成，桌面出现应用图标
3. 点击图标打开控制面板
4. 在「模型」页选择模型供应商并填入 API Key
5. 在「概览」页面，点击启动即可进行对话

应用启动后自动监听内部端口，无需手动配置网络，通过应用中心的快捷入口进入。

## 目录结构

```
/app/home/data/                    # 应用数据目录（持久化）
├── venv/                          # Python 虚拟环境
│   └── bin/                       # Python 可执行文件（python3、uv、hermes）
├── .uv-cache/                     # uv 包缓存
├── config.yaml                    # 主配置文件
├── .env                           # 环境变量（API Key 等）
├── sessions/                      # 会话历史记录
├── skills/                        # 技能库（随版本更新）
├── workspace/                     # 工作区文件（生成的报告、代码等）
├── weixin/accounts/               # 微信绑定数据（JSON 文件）
├── SOUL.md                        # 系统提示词（首次安装部署）
└── AGENTS.md                      # 执行参考规则（首次安装部署）

/var/apps/hermes-agent/            # 应用运行目录
├── target/                        # 程序本体（监控脚本、静态资源）
│   ├── server/monitor.js          # Monitor HTTP 服务（Node.js）
│   └── ui/                        # 前端静态文件
├── hermes-agent.sock              # Unix socket（通信端点）
└── var/                           # 运行时数据
    ├── gateway.pid                # Gateway 进程 PID
    ├── dashboard.pid              # Dashboard 进程 PID
    ├── monitor.token              # API 认证令牌
    ├── hermes.log                 # 运行日志
    └── chat/                      # 聊天数据
        ├── config.json
        └── sessions/

/vol1/@appdata/hermes-agent/       # 应用数据备份目录（升级保留）
├── tmp/                           # 临时文件（重启清空）
├── monitor.token                  # 监控令牌副本
├── *.pid                          # PID 文件
└── *.log                          # 日志归档
```

## 进程架构

```
fnOS 桌面图标 → 应用启动脚本 → Monitor (Node.js, /var/apps/hermes-agent/server/monitor.js)
                                         │
                                         ├─► Unix socket: /var/apps/hermes-agent/hermes-agent.sock
                                         │                 └─► 控制面板前端 (app/ui/index.html)
                                         │
                                         └─► HTTP 代理 → Hermes Gateway (:8642)
                                                          └─► 模型供应商 API / WS 消息通道
```

### 服务启停

应用生命周期由 fnOS 统一管理。控制台可见状态包括：运行中、已停止、启动中。支持在控制面板「概览」页查看进程状态与一键启动/停止——所有操作均由后台进程管理接口统一调度，避免端口冲突和资源泄漏。

### 端口说明

- **8642** — Hermes Gateway 通信端口（内部使用，不对外暴露）
- **9119** — Dashboard 仪表板端口（本地回环访问）

## 架构设计

控制面板通过基于 HTTP 的 Node.js 服务器（Monitor）通信，该服务器监听 Unix socket（`/var/apps/hermes-agent/hermes-agent.sock`）。消息被代理至端口 8642 上的 Hermes Gateway 进程。Python 虚拟环境使用 `uv` 作为包管理器，依赖项在安装时从 PyPI 镜像源拉取（阿里云镜像优先，GitHub 备用）。

监控令牌（Token）位于 `/vol1/@appdata/hermes-agent/monitor.token`，每次应用启动时生成随机字符串，前后端通过此 Token 鉴权。写操作（配置修改、进程重启）必须携带有效 Token，只读查询（状态、日志）免鉴权。

## 版本迭代


### v0.20.x

- **v0.20.41** — 修复移动端「添加模型服务」弹窗选择「自定义」后无法滚动到底部按钮的问题。
- **v0.20.40** — 扩展页原生工具集 API 返回英文时强制中文映射，覆盖 25 个工具集的 label/description/icon。
- **v0.20.39** — 修复 Dashboard 启动失败：root/hermes-agent 文件属主漂移导致 EACCES、多 monitor 实例冲突。
- **v0.20.38** — 发布者改为 veenyi；Dashboard 中文汉化（导航、后端配置标签、通用文案）。
- **v0.20.37** — 修复右侧工具/事件面板 `WebSocket closed`：Node `ws` 反代把文本帧当 binary 转发导致 gateway KeyError。
- **v0.20.36-3** — 修复 `/dashboard/chat` 断流循环：Hermes 0.19.0 PTY session 4409 supersede 被透传导致重连风暴。
- **v0.20.36-2** — 修复启动后闪退/EACCES：install_callback 与 cmd/main 同时 chown 数据/日志目录到应用用户。
- **v0.20.36** — 基座从 Bun 切回 Node.js；修复 Bad Gateway（Bun import、require 未定义、pid 匹配误命中系统 hermes）。
- **v0.20.35** — 短暂 Bun 基座迭代（本地版本，未推送到 GitHub Release）。
- **v0.20.34** — 修复 WEBCHAT 随机中断：客户端自动重连、保留已生成文本、服务端 30s ping 保活。
- **v0.20.33** — 修复 Provider 未落盘：POST /api/config 对 A/B/custom 非 hermes provider 写 providers 段。
- **v0.20.32** — 短暂切为 Bun 基座（历史过渡版本）。
- **v0.20.31 及以前** — Node 基座（vendored ws + child_process + createRequire）。
- **v0.20.28** — 修复 dashboard/chat TUI 桌面 IME 输入文字消失。
- **v0.20.27** — 修复手机端胶囊栏 CSS 优先级，真正单行横向滚动，压缩尺寸释放输入区。
- **v0.20.26** — 默认助手独立化：切回默认助手时彻底清除专家团/工作流状态。
- **v0.20.25** — 完善顶层文件同步：README/LICENSE/.gitignore 标记对齐，打包 tar 路径前缀修正。
- **v0.20.24** — 顶层文件随版本同步刷新（README / LICENSE / .gitignore 更新）。
- **v0.20.23** — 工作流以对话驱动：未预设的输入变量自动采用会话窗口内容。
- **v0.20.22** — 修复专家团胶囊未挂 window 导致点击无效；应用更新卡片始终显示 GitHub Release 说明。
- **v0.20.21** — 通讯组件对齐 hermes-studio 0.6.30：新增各平台行为字段与开关。
- **v0.20.20** — 专家团胶囊在未配置成员时自动组建默认团队并激活。
- **v0.20.19** — 移动端顶部导航横向可滚动，修复手机端无法滑动切换页签。
- **v0.20.18** — 启用 delegation 工具集，专家团升级为原生 `delegate_task` 真多智能体。
- **v0.20.17** — 聊天输入框移除 720px max-width，自适应窗口宽度。
- **v0.20.16** — 应用更新卡片改为纯用户视角（检查更新→下载最新版），后端补 `.fpk` 直链。
- **v0.20.15** — 直接发布 GitHub Release，修复版本显示重复日期与应用版本读取。
- **v0.20.14** — 合并专家团工作流与任务委派工作流为统一工作流中心，修复 AO 预设加载。
- **v0.20.13** — native skills auth、auto start/stop、unified UI、agency workflows、app update from GitHub。
- **v0.20.9** — 平台频道筛选标签改为统一组件（形状一致，仅颜色区分）。
- **v0.20.8** — WhatsApp npm 多路径查找 + npm-cli.js 内置脚本 fallback。
- **v0.20.6** — 修复专家/专家团 inline onclick 未挂 window + WhatsApp npm 多路径查找。
- **v0.20.5** — 集成 agency-agents-zh 268 角色 + 专家/专家团 UI + 原生技能/工具集开关。
- **v0.20.4** — 补齐 WhatsApp bridge 脚本：install/upgrade 回调将 bridge 复制到 site-packages。
- **v0.20.3** — 修复 Node fetch 代理转发 body 缺少 `duplex:'half'` 导致的 `duplex option is required` 错误。
- **v0.20.2** — 修复 NODE_CANDIDATES 解析，使 dashboard(9119) 与 WhatsApp bridge 能找到 Node，消除 502。
- **v0.20.1** — 修正 Node.js 依赖 ID 为 `nodejs_v24`，启动 PATH 兼容 v24/v22/v20。
- **v0.20.0** — 后端运行时从 Bun 迁移到 Node.js（monitor.js 改用 http+ws 标准库，vendor ws@8.18.0）。

### v0.19.x

- **v0.19.14** — iLink 微信 QR 改为本地渲染 deep-link URL，修复裂图与复制 token 问题。
- **v0.19.13** — 微信 QR 加载失败兜底 + WhatsApp 模式按钮样式修复 + API 错误信息显示后端 message。
- **v0.19.12** — 延迟初始化 channelsLoad，修复 switchView 启动阶段 ReferenceError。
- **v0.19.11** — BASE 路径改从 `<base href>` 推导 + 看门狗诊断面板（根治浏览器永久转圈）。
- **v0.19.10** — Channels 页优化 + monitor.js socket 自愈（修复 fnOS 重置 @appcenter 后 socket 丢失导致 UI 转圈）。
- **v0.19.9** — 恢复 ui/config icon path 为 images/{0}.png，新增 ICON_256.PNG，修复图标尺寸。
- **v0.19.8** — 移除错误的 service_port，修复启动健康检查失败。
- **v0.19.7** — 修复卸载标题重复、wizard 拼写、图标尺寸与路径。
- **v0.19.6** — Telegram/WhatsApp QR onboarding + 微信 QR 渲染兜底。
- **v0.19.5** — 通讯·平台频道页 + 微信 iLink 扫码登录 + 多智能体自定义角色 + 扩展能力独立页。
- **v0.19.4** — Hermes 官方技能目录搜索 + 安装推送到聊天 + 搜索框样式修复。
- **v0.19.3** — 基于 SkillHub 官方 API 实现技能/专家包搜索。
- **v0.19.2** — PyPI 无 hermes-agent 0.19.2，回退依赖版本并增强容错。
- **v0.19.1** — 修复扩展能力页点击无响应 + 长任务进度丢失。
- **v0.19.0** — Hermes 0.19.0 升级 + LightAgent 集成 + 扩展能力可视化；移除 fnpack `--version` 检测。

完整 Release 与下载地址：https://github.com/veenyi/fnos-hermes-agent/releases

## 截图
<img width="1098" height="832" alt="5ad86464b6910676a50ae202a0cdbd28" src="https://github.com/user-attachments/assets/fc1c7b48-77de-46bb-86d2-9d9e23e72398" />
<img width="1099" height="831" alt="9a862f453e1ac8cf33c2d979d07b1a10" src="https://github.com/user-attachments/assets/756cbabf-865f-4f40-88e6-f50359baca4f" />
<img width="1102" height="832" alt="53878252b96d68b3b7e5858e4d938afd" src="https://github.com/user-attachments/assets/33a1769c-56c7-4314-a013-c52ecfe2f340" />
<img width="1099" height="829" alt="2ec18542d2f550efd260466009623e56" src="https://github.com/user-attachments/assets/7932248d-1ba5-4c13-b811-1e9b73d5c98e" />
<img width="1099" height="830" alt="a8c6098e0b1f053011487caf7d352150" src="https://github.com/user-attachments/assets/b044e2bf-b715-4267-a626-c6759d57ecb2" />
<img width="1096" height="832" alt="deb9616704431f2756310fc5502a5f7f" src="https://github.com/user-attachments/assets/576abe10-b267-4601-9bfa-8cf5a272aa59" />
<img width="1102" height="832" alt="adedf2602e0161f468b1827db2be5c2d" src="https://github.com/user-attachments/assets/c4b429a3-ccf8-4550-a92e-c8ff5f0bdb3a" />
<img width="1099" height="833" alt="669cc02310649eef3b3a8eb1e13c3ddc" src="https://github.com/user-attachments/assets/e1778334-6c8c-4ab4-bbf1-0307b77734cc" />
<img width="1103" height="834" alt="16986a5dff2427117d4008f8b58607fa" src="https://github.com/user-attachments/assets/17ac05be-468c-4b08-8ae1-5bf447a9f491" />
<img width="1101" height="833" alt="15db62cecaa622926b0e7b24bb8422af" src="https://github.com/user-attachments/assets/8117d22d-0fd2-4edf-96fa-69cf490586bc" />
<img width="1101" height="833" alt="af729b7a01cbadb312aaf42956053a1c" src="https://github.com/user-attachments/assets/265088e3-55a8-4015-8a0f-813b8eda3cc8" />
<img width="1100" height="831" alt="d5ba91ec2beef32846699194b36b6d83" src="https://github.com/user-attachments/assets/1052a78d-9ea9-430b-9a68-eac9bd3aa3e1" />
<img width="1099" height="834" alt="e85c20a56b1a70563cea9aa30bfad774" src="https://github.com/user-attachments/assets/bc307965-572a-4459-a350-55ed56604fc9" />

### QQ 交流群
![](/preview/qq.png)

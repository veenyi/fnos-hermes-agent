# fnos-hermes-agent v0.20.40 版本更新说明

## 本次更新

### 修复：扩展能力页面工具集显示为英文的问题

- **根因**：v0.20.27 之后 Dashboard 前端优先从后端 API `/proxy/dashboard/api/tools/toolsets` 动态获取原生工具集列表，后端返回的 `label`/`description` 为英文（如 `Web Search & Scraping`、`Terminal & Processes`），直接覆盖了前端静态中文回退列表，导致在中文语言下扩展页仍显示英文。
- **修复**：
  - 在 `app/ui/index.html` 新增 `EXT_I18N` 中文映射表，同时以工具集 `name` 和英文 `label` 为 key，覆盖 25 个原生工具集的 `label`、`description` 与 `icon`。
  - 扩展 `EXT_ICONS` 图标表，补齐视频、图像生成、定时任务、计算机控制、浏览器视觉、关闭终端、读取终端、Web API 密钥、看板、看板编排器等新增工具集的 emoji 图标。
  - 在 `settingsRenderExtensions()` 渲染原生工具集卡片时，读取 `localStorage` 的 `hermes-locale`，仅在 `zh`/`zh-hant` 语言下对 API 返回的英文做中文替换；其他语言保持原样，不影响多语言切换。
- **效果**：中文语言下扩展页所有工具集卡片现在显示为中文标题与描述（如「联网搜索」、「浏览器自动化」、「终端 / 进程」、「视觉 / 图像分析」等）。

### 版本号

- `manifest.version` 更新为 `0.20.40`。

## 关于日志中 WARNING 的说明

本次日志中出现的以下条目属于 Hermes 0.19.0 正常运行提示，不是本包 bug：

1. `tools.registry: check_fn check_* returned False`  
   含义：当前轮次某些工具因缺少 API 密钥或环境条件不满足而被禁用（如未配置 web search、image generation、browser 等服务的 key）。这不会影响核心功能；如需使用对应工具，在配置中填入对应 API key 即可。

2. `gateway.platforms.api_server: API server is network-accessible (0.0.0.0) AND the terminal backend is 'local'`  
   含义：Hermes 安全提醒——网关监听在 0.0.0.0 且终端后端为本地 unsandboxed 模式。fnOS 家用/内网场景下 0.0.0.0 是接收平台消息所必需的；如需更高安全性，可在 `config.yaml` 中将 `terminal.backend` 改为 `docker` 并限制防火墙规则。

3. `hermes.security_audit: SSH password authentication is ENABLED`  
   含义：fnOS 主机 SSH 默认启用密码认证的系统级安全提示。如该服务器暴露在互联网，建议修改 `/etc/ssh/sshd_config` 禁用密码认证并改用密钥登录；纯内网使用可忽略。

4. `tui_gateway.ws: ws closed ... code=1006`  
   含义：客户端（浏览器 / Telegram Bot / 其他平台）断开 WebSocket 连接，1006 表示异常断开或网络切换。v0.20.36-3 已修复 Dashboard 因 superseded 导致的断流风暴；当前偶发 1006 属于正常连接生命周期，不影响使用。

## 安装 / 升级方式

1. 在 fnOS 应用中心手动上传 `fnos-hermes-agent_v0.20.40.fpk`。
2. 或从 GitHub Release 下载后通过应用中心安装。
3. 升级后进入 Dashboard → 扩展页，确认工具集已显示为中文。

## 验证

- 本地构建产物：`fnos-hermes-agent_v0.20.40.fpk`（约 19.5 MB）。
- GitHub Release：`https://github.com/veenyi/fnos-hermes-agent/releases/tag/fnos-hermes-agent_v0.20.40`

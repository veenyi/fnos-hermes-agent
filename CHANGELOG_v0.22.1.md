# CHANGELOG v0.22.1 — Studio P0：语音对话 + Octop 风首屏 + 安全网关

> 全家桶融合第一弹。基于 2026-08-05 八项目调研总蓝图（hermes-studio 菜单参考 / hermes-agent v2026.8.3 语音三件套 / Octop 界面与安全 / jnMetaCode 角色体系 / LightAgent 升华机制），先落地"会说话 + 有管家样 + 有护栏"三件事。

## ✨ 新增功能

### 1. WebChat 语音对话（v2026.8.3 语音能力落地 Web UI）
- **语音输入（STT）**：工具栏新增「麦克风」按钮 → `getUserMedia` 录音（webm/opus）→ `POST /proxy/dashboard/api/audio/transcribe` 转写 → 文本自动填入并发送（可在语音设置关闭自动发送）；60 秒无操作自动停止；无语音自动提示重说。
- **语音输出（TTS）**：助手消息「播放」按钮升级为服务端 TTS：
  - 主链路：`WS /api/audio/speak-stream` 流式合成，int16 PCM 逐句播放，**再次点击即打断（barge-in）**；
  - 降级链路：流式 provider 不可用时走 `POST /api/audio/speak` 整段播放；
  - 兜底链路：服务端 TTS 全失败回退浏览器 `speechSynthesis`。
- **自动朗读**：回复完成自动播放（语音设置开关，默认开）。
- **语音设置弹窗**：自动朗读 / 语音输入自动发送 / 试听 / 安全网关开关。
- **monitor 代理层**：`/api/audio/*` 反代超时 10s → 180s（STT 推理与 TTS 合成耗时）；WS 二进制帧直通复用 dashboard-proxy 通道（非 JSON 路径原样转发）。

### 2. Octop 风格欢迎页（QUICK START）
- 空会话显示「Hi! 我是你的 AI 小助手」欢迎区 + 六宫格快捷卡：总结文档 / 写邮件 / 解释代码 / 制定计划 / 翻译润色 / 头脑风暴，点击填入输入框（可继续补充后发送）。

### 3. 安全网关 tool_guard v1（shellward × Octop tool_guard 融合）
- **13 条危险命令拦截规则**：`rm -rf` 根目录/主目录/系统目录、`dd` 直写磁盘、`mkfs` 格式化、关机/重启/断电、fork bomb、`curl|sh` 下载执行、`chmod -R 777 /`、`chown -R root /`、向磁盘设备写数据、`kill -9` pid 0/1、`iptables -F`/`ufw disable`、`cryptsetup luksFormat`。
- **PII 警告**：身份证号、手机号识别（仅记录不阻断，允许起草含证件文档）。
- **拦截点**：`/api/chat/ws-send` 与 `/api/chat/stream`；被拦消息前端还原到输入框并 toast 提示原因。
- **开关**：`GET/PUT /api/studio/security`，持久化 `data/studio/security.json`（默认开启），语音设置弹窗内可一键切换。

## 🛠 修改文件

| 文件 | 变更 |
|---|---|
| `app/server/monitor.js` | ① proxyDashboard 语音端点超时放宽 ② 新增 TOOL_GUARD 规则模块 + 两个聊天入口拦截 + `/api/studio/security` GET/PUT ③ 模块级 toolGuardLoad 启动加载 |
| `app/ui/index.html` | ① 工具栏新增麦克风/语音设置按钮 ② 语音对话模块（流式 TTS + barge-in + 降级链 + STT 录音 + 设置弹窗）③ 欢迎页 QUICK START 六宫格 ④ 空会话渲染欢迎页 ⑤ ws-send 拦截兜底（还原输入 + toast）⑥ 回复完成自动朗读钩子 |
| `manifest` | version 0.21.35 → 0.22.1 |
| `hot-patch.json` | 版本同步 0.22.0（files: server/monitor.js、ui/index.html） |
| `CHANGELOG_v0.22.0.md` | 本文件 |

## ⚠️ 注意事项
- STT/TTS 服务商在官方仪表盘「设置」中配置（默认 edge-tts 免费语音；STT 默认 provider 链含本地 faster-whisper）。
- 语音输入需浏览器授权麦克风（HTTPS 或 localhost 环境）。
- 安全网关默认开启；如确有合法破坏性操作需求，可在语音设置中关闭。
- 浏览器自动播放策略：自动朗读仅在用户已交互的会话中生效（首次需手动点一次播放）。

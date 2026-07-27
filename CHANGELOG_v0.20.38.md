# fnos-hermes-agent v0.20.38 版本更新说明

> 基座：Node.js（基于 Node 的 `monitor.js` + 内置 `ws` 库，不再依赖 Bun）｜ Hermes 版本：0.19.0

## 1. 发布者改为 veenyi
- `manifest` 的 `distributor` 改为 **veenyi**，`distributor_url` 改为 `https://github.com/veenyi/fnos-hermes-agent`。
- fnOS 应用中心安装 / 更新时显示发布者为 veenyi，并链接到 GitHub 项目主页。

## 2. Dashboard 中文汉化（仅简体 / 繁体中文生效，不影响其他语言）
> Dashboard 可正常多语言切换，仅在 `zh` / `zh-hant` 下启用本汉化，其它语言保持英文原文。

### 导航菜单
- Files → 文件
- Channels → 通讯
- Webhooks → 回调参数
- Pairing → 配对
- System → 系统
- KANBAN → 看板
- achievements → 成就

### 后端配置标签（来自 config.yaml，不在前端 i18n 字典内）
- Model Context Length → 模型上下文长度
- Fallback Provider → 备用提供商
- Max Concurrent Sessions → 最大并发会话
- Max Active Sessions → 最大活跃会话
- Context Files Max Chars → 上下文文件最大字符数
- File Read Max Chars → 文件读取最大字符数

### 通用界面文案
- 按钮、提示、空状态等常见界面文案在中文下同步汉化。

### 实现方式
- 在 `app/server/monitor.js` 的 `proxyDashboard`（HTML 重写处）注入 `injectZh` 运行时脚本。
- 仅当 `localStorage` 的 `hermes-locale` 为 `zh` / `zh-hant` 时生效。
- 通过 `MutationObserver` 监听 SPA 重渲染，确保切换页面后汉化不丢失。

## 3. 安装方式
- fnOS 应用中心 → 上传 / 更新 `fnos-hermes-agent_v0.20.38.fpk`。
- 已装旧版升级后，到「概览」页重启网关生效。

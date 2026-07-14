# Hermes Agent for fnOS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Fnos](https://img.shields.io/badge/Platform-Fnos%20-green.svg)]()
[![Arch: x86_64 | arm64](https://img.shields.io/badge/Arch-x86__64%20%7C%20arm64-orange.svg)]()

Hermes Agent 是专为适配飞牛 NAS（fnOS）的 AI 助手应用，通过原生`fpk` 应用中心部署。采用基于 Bun 的 Monitor 服务进行进程管理，提供基于 Web 的控制面板用于配置和对话交互。

## 功能特性

支持多模型供应商接入（OpenRouter、OpenAI、Anthropic、Kimi、MiniMax 等）、跨平台消息网关集成（微信、Telegram、Discord、Slack、QQ、钉钉、飞书等）、带图片识别的文件操作功能，以及跨会话的对话记忆能力。

## 安装与配置

### 环境要求

- 可用存储空间：约 1GB（含 Python 依赖包和缓存）
- 依赖项：bunjs（安装时自动处理）

### 安装步骤

1. 在飞牛应用中心添加第三方源或直接上传 `.fpk` 安装包
2. 等待安装完成，桌面出现应用图标
3. 点击图标打开控制面板
4. 在「配置」页选择模型供应商并填入 API Key
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
│   ├── server/monitor.js          # Monitor HTTP 服务（Bun）
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
fnOS 桌面图标 → 应用启动脚本 → Monitor (Bun, /var/apps/hermes-agent/server/monitor.js)
                                         │
                                         ├─► Unix socket: /var/apps/hermes-agent/hermes-agent.sock
                                         │                 └─► 控制面板前端 (app/ui/index.html)
                                         │
                                         └─► HTTP 代理 → Hermes Gateway (:8642)
                                                          └─► 模型供应商 API / WS 消息通道
```

### 服务启停

应用生命周期由 fnOS 统一管理。控制台可见状态包括：运行中、已停止、启动中。支持在控制面板「状态」页查看进程状态，但不提供手动启停按钮——所有操作均由后台进程管理接口统一调度，避免端口冲突和资源泄漏。

### 端口说明

- **8642** — Hermes Gateway 通信端口（内部使用，不对外暴露）
- **9119** — Dashboard 仪表板端口（本地回环访问）



## 架构设计

控制面板通过基于 HTTP 的 Bun 服务器（Monitor）通信，该服务器监听 Unix socket（`/var/apps/hermes-agent/hermes-agent.sock`）。消息被代理至端口 8642 上的 Hermes Gateway 进程。Python 虚拟环境使用 `uv` 作为包管理器，依赖项在安装时从 PyPI 镜像源拉取（阿里云镜像优先，GitHub 备用）。

监控令牌（Token）位于 `/vol1/@appdata/hermes-agent/monitor.token`，每次应用启动时生成随机字符串，前后端通过此 Token 鉴权。写操作（配置修改、进程重启）必须携带有效 Token，只读查询（状态、日志）免鉴权。

## 更新

检查最新版本：控制面板「更新」页会自动拉取 PyPI 版本信息，对比当前版本号后发现新版本即可一键升级。

---

**注意：** 本应用仅作为服务集成与打包工具，不对后端 AI 模型本身的安全性、稳定性作任何保证。使用者需遵守相关供应商条款及法律法规。


## Star History

<a href="https://www.star-history.com/?repos=iranee%2Ffnos-hermes-agen%2Ciranee%2Ffnos-hermes-agent&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=iranee/fnos-hermes-agen%2Ciranee/fnos-hermes-agent&type=date&theme=dark&legend=bottom-right&sealed_token=Ff7GT0g_m4HsLUmrTBhXaMYkziMXw7RQJMU6G3C-6wFJ3RiXosjc_pyShu3UGA524GSD4hlN2puHTFuvUoYKei3bvN0ax5US" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=iranee/fnos-hermes-agen%2Ciranee/fnos-hermes-agent&type=date&legend=bottom-right&sealed_token=Ff7GT0g_m4HsLUmrTBhXaMYkziMXw7RQJMU6G3C-6wFJ3RiXosjc_pyShu3UGA524GSD4hlN2puHTFuvUoYKei3bvN0ax5US" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=iranee/fnos-hermes-agen%2Ciranee/fnos-hermes-agent&type=date&legend=bottom-right&sealed_token=Ff7GT0g_m4HsLUmrTBhXaMYkziMXw7RQJMU6G3C-6wFJ3RiXosjc_pyShu3UGA524GSD4hlN2puHTFuvUoYKei3bvN0ax5US" />
 </picture>
</a>

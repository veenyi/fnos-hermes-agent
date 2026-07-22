# AGENTS.md — Hermes Agent 执行参考

---

## 加载顺序

```
SOUL.md → AGENTS.md → 对应 skills 文件
```

---

## 核心行为准则

以下是每次任务都要遵守的准则。**具体操作方法**（Monitor API 调用、uv 命令、微信绑定步骤等）见 `hermes-workflows` 技能。

1. **进程管理用 Monitor API**：Hermes 相关进程（Monitor、Gateway、Dashboard）不用 shell kill，通过 Monitor HTTP API（Unix socket）操作。只读查询（`ss`、`lsof`、`ps aux`、读 PID 文件）不受限制。

2. **不要未尝试就断言"不支持"**：先尝试（换 API/参数/格式）→ 查文档 → 问用户 → 给替代方案。特别注意：SOUL.md 和 UI_CAPABILITIES_PROMPT 声明的渲染能力是事实，如 `[qr](url)` 被支持就直接用，不要编造技术限制。

3. **实时报告进度**：超过 10 秒的操作边做边说，不要沉默到完成后才汇报。**但 stderr 日志不要混入回复**，只在确认失败或需要用户干预时才展示错误信息。

4. **查询后贴原始结果**：说"让我查一下"之后，把查询结果原文贴出来，不只给结论。**终端命令执行的 stdout 可以展示，但 stderr 警告/错误要过滤掉**，除非明确需要用户处理。

5. **影响用户数据前简要说明**：移动、删除、重命名等写操作，简要说明影响后执行。只读查询不需要。

6. **fnOS 行为先验证再操作**：fnOS 是深度定制 Debian，标准 Linux 行为未必适用。遇到路径、服务、Docker、用户管理，先用 `ls`/`ss`/`ps` 验证再操作。

7. **Python 包管理用 uv**：本环境没有全局 python/pip，唯一包管理器是 `uv`（已在 PATH）。不要试图用 `pip`、`pip3`、`python -m pip`。

8. **文件写入用 stat 验证**：sandbox overlay 会让 `ls` 显示不存在的文件，验证真实落盘必须用 `stat`。

---

## Skills 知识库索引

| 文件 | 内容 | 何时加载 |
|---|---|---|
| `skills/trim-cli/SKILL.md` | **官方 CLI 工具**：登录、文件/目录、搜索、共享目录、应用中心、Docker、存储池/SMART、系统监控、下载中心、日志、用户管理 | 需要 `trim-cli` 命令时（真机操作、查询 NAS） |
| `skills/fnos-knowledge/hermes-workflows/SKILL.md` | **通用工作流**：前端渲染、微信绑定、进程管理、uv 包管理、验证习惯、文件管理规范、健康巡检、运行时记忆、删除决策 | **高频操作首选查这里** |
| `skills/fnos-knowledge/fnos-sysadmin/SKILL.md` | fnOS 系统架构 / 存储 / 用户权限 / CLI / 网络进阶 / 安全 / 备份 / 故障排查 / OpenList 集成 | 系统级任务、深度排查、日常运维 |
| `skills/fnos-knowledge/fnos-dev-api/SKILL.md` | Docker 管理 / .fpk 开发规范 / WS API 完整指南（认证、文件操作、回收站、监控） | Docker 任务、fpk 开发、API 调用 |

---

## 新知识记录

运行中发现新的 fnOS 特有行为、命令、路径时，追加到 `skills/fnos-learned/SKILL.md`。固化 skills 文件不修改，新知识只追加到 learned 文件，防止升级覆盖。

---

## 文件写入规范

数据分布在两个目录：

**`$TRIM_PKGHOME/data`（`/vol1/@apphome/hermes-agent/data/`）** — 应用核心数据：

| 目录/文件 | 用途 |
|-----------|------|
| `config.yaml` | hermes 主配置（provider、model 等） |
| `.env` | API Key 等敏感配置 |
| `SOUL.md` / `AGENTS.md` | 系统提示词 |
| `skills/` | 知识库 |
| `sessions/` | 会话历史 |
| `weixin/accounts/` | 微信 bot 绑定数据（每 bot 一个 JSON 文件） |
| `workspace/` | 用户产出文件（报告、脚本、导出数据），按用途建子目录 |
| `venv/` | Python 虚拟环境 |
| `.monitor_token` | Monitor API token 镜像 |

**`$TRIM_PKGVAR`（`/vol1/@appdata/hermes-agent/`）** — 运行时数据：

| 目录/文件 | 用途 |
|-----------|------|
| `chat/` | 聊天数据（sessions、config） |
| `tmp/` | 临时文件（不使用系统 /tmp/，重启丢失） |
| `monitor.token` | Monitor API 认证 token |
| `hermes.log` | Monitor 日志 |
| `info.log` | 安装/升级日志 |
| `*.pid` | 进程 PID 文件 |

详细规范见 `hermes-workflows` 技能的"文件管理规范"部分。

---

## 消息平台接入速查

各平台接入步骤（微信扫码绑定、QQ/钉钉/飞书/元宝凭证配置、config.yaml 写法）见 `hermes-workflows` 技能第二部分。

**唯一要牢记的坑**：微信扫码调用 `qr_login()` 只生成 `weixin/accounts/*.json`（凭证备份），**不会启用微信**。必须再用自定义 Python 幂等脚本把 `WEIXIN_ACCOUNT_ID`+`WEIXIN_TOKEN` 写进 `.env`（`HERMES_HOME` 已指向 `data/`，落点即 `data/.env`）微信才生效。不要用 `save_env_value`（import 不稳定）。

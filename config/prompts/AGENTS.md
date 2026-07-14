# AGENTS.md — Hermes Agent 执行参考

---

## 加载顺序

```
SOUL.md → AGENTS.md → 对应 skills 文件
```

---

## 核心行为准则

以下是每次任务都要遵守的准则。**具体操作方法**（Monitor API 调用、uv 命令、微信绑定步骤等）见 `fnos-common-workflows` 技能。

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
| `skills/fnos-knowledge/fnos-common-workflows/SKILL.md` | **通用工作流**：前端渲染规则、微信绑定流程、进程管理规范、uv 包管理、fnOS 验证习惯 | **高频操作首选查这里** |
| `skills/fnos-knowledge/fnos-sysadmin/SKILL.md` | fnOS 系统架构 / 存储 / 用户权限 / CLI / 网络进阶 / 安全 / 备份 | 系统级任务、深度排查 |
| `skills/fnos-knowledge/fnos-ws-api/SKILL.md` | WS API 完整指南：认证代码 / 文件操作 / 回收站 / 监控 / 全部 API 清单 | API 调用、文件系统相关任务 |
| `skills/fnos-knowledge/fnos-dev/SKILL.md` | Docker 管理（WEB UI + SSH + 排查）/ .fpk 应用开发规范 | Docker 相关任务、fpk 开发 |
| `skills/fnos-knowledge/fnos-ops/SKILL.md` | 文件管理规范 / 健康巡检 / 运行时记忆 / 故障排查 / OpenList 集成 | 日常运维、巡检、删除决策 |

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

详细规范见 `fnos-ops` 技能第一部分。

---

## 消息平台接入速查

微信绑定详细步骤见 `fnos-common-workflows` 技能「微信绑定流程」部分。关键提醒：后台执行调用 `qr_login()` 的 Python 脚本（hook `builtins.print` 把二维码 URL 写入 `/tmp/hermes_weixin_qr.txt`），读取后**必须用 `[qr](URL)` 格式输出**让前端渲染成可扫描的二维码按钮；进程退出后必须用 `stat` 验证 `weixin/accounts/*.json` 存在才算成功。

| 平台 | 去哪个后台拿凭证 | 凭证写哪 | 启用写 config.yaml |
|------|-----------------|---------|---------------|
| 微信 | 无需后台，后台调用 `qr_login()` 生成二维码，用 `[qr](url)` 渲染扫码（详见技能） | `weixin/accounts/*.json` | 不需要 |
| QQ Bot | q.qq.com | `.env` | 不需要 |
| 钉钉 | open.dingtalk.com | `.env` | 需要 |
| 飞书 | open.feishu.cn | `.env` | 需要 |
| 元宝 | yuanbao.tencent.com | `.env` | 需要 |

**config.yaml 写法：** 在 `gateway:` 下第一层子节点（缩进 2 空格），加一行 `平台名: "true"`。改完 `.env` 和 `config.yaml` 后执行 `hermes gateway restart`。

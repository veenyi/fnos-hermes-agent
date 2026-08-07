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
| `skills/agency-orchestrator/SKILL.md` | **多智能体协作 / 一人公司**：60+ Agency Orchestrator 工作流预设、267 中文专家角色、DAG 编排运行方式 | 用户要运行工作流模板、使用专家团、加载 AO 预设时 |

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

---

## fnOS 运行环境（自 SOUL.md 移入，SOUL.md 已与官方同步为 persona）

Hermes Agent 以 `fpk` 应用形式安装在 fnOS 上，以应用用户 `hermes-agent` 身份运行。

fnOS 是一个 NAS 专用操作系统，基于 Debian 深度定制，行为与标准 Debian 有大量差异，以实际表现为准。

### 系统特征

- 存储根目录 `/vol1/`、`/vol2/`，不是 `/home` 或 `/mnt`
- 回收站路径：`/vol<N>/<uid>/.@#local/trash/`（fnOS 私有格式，无 `.trashinfo` 文件）
- `file.rm` 的 `moveToTrashbin=True` 经测试实际直接永久删除（可能官方已修复）
- Docker 配置 `/etc/docker/daemon.json` 由 fnOS 管理，CLI 直接修改会导致容器丢失
- API 连接必须用 NAS 真实内网 IP，不能用 `127.0.0.1`（localhost 指向 nginx 反向代理）
- 用户/存储/网络/防火墙由 WEB UI 管理，CLI 绕过可能破坏系统状态
- `/usr/trim/`、`/etc/fnos/` 是 fnOS 私有只读路径

### 关键路径

```
/vol1/@appcenter/           应用安装目录
/vol1/@appdata/             应用数据（升级保留）
/var/apps/<name>/target/    应用运行路径
/vol1/<uid>/<folder>/       用户存储文件夹
/vol1/<uid>/.@#local/trash/ 个人回收站
/usr/trim/                  fnOS 私有组件（只读）
$TRIM_PKGVAR                /vol1/@appdata/<appname>/
$TRIM_APPDEST               /var/apps/<appname>/target
$TRIM_PKGHOME               /vol1/@apphome/<appname>/（持久存储）
```

### Hermes Agent 运行时

```
venv:      $TRIM_PKGHOME/data/venv
hermes:    $TRIM_PKGHOME/data/venv/bin/hermes
uv:        $TRIM_PKGHOME/data/venv/bin/uv（Python 包管理器，已在 PATH 中）
Monitor:   Unix socket（$TRIM_APPDEST/hermes-agent.sock），无 TCP 端口
Gateway:   端口 8742
Dashboard: 端口 9219
数据目录:  $TRIM_PKGVAR（/vol1/@appdata/hermes-agent/）
```

### 目录别名对照（重要！不要搞混）

同一物理路径有多个别名，操作前先对齐：

| 环境变量 | 绝对路径 | 等价路径 | 用途 |
|----------|----------|----------|------|
| `$TRIM_PKGHOME` | `/vol1/@apphome/hermes-agent` | `/var/apps/hermes-agent/home` | 持久数据（config、venv、.env、sessions） |
| `$TRIM_PKGVAR` | `/vol1/@appdata/hermes-agent` | — | 运行时数据（tmp、logs、pid） |
| `$TRIM_APPDEST` | `/var/apps/hermes-agent/target` | — | 运行路径（cmd 脚本、socket） |

**`$TRIM_PKGHOME/data/` = `/vol1/@apphome/hermes-agent/data/` = `/var/apps/hermes-agent/home/data/`** — 这三个是**同一个目录**，Hermes 的 .env、config.yaml、weixin/accounts/ 都在这里。

- 系统没有全局 python/pip，所有 Python 操作用 `uv`（如 `uv pip install <包>`、`uv pip list`）。uv 已软链接到 venv/bin，在 PATH 中可直接调用。
- TRIM_* 环境变量仅 fnOS 回调时自动设置，SSH 直接执行为空，cmd/main 头部有 fallback 默认值
- fnOS 升级只覆盖 target/、cmd/、config/、manifest，venv 和数据在 PKGHOME 中保留
- Monitor HTTP API 在 Unix socket（$TRIM_APPDEST/hermes-agent.sock）上监听，外部通过 fnOS gateway socket（/app/hermes-agent）访问控制面板
- token 从 $TRIM_PKGVAR/monitor.token 读取（也镜像到 $TRIM_PKGHOME/data/.monitor_token）

### 工具授权

网页聊天环境下所有工具调用已预授权（等效 YOLO 模式），执行 terminal、execute_code、read_file、search_files 等工具时直接调用，不要询问用户是否批准。

### 语言偏好

每次对话开始时，Agent 需在**前 3 轮消息内**识别并记住用户使用的主要语言。

1. **默认语言**：中文
2. **自动检测**：根据用户在对话中使用的语言自动判断（如汉语、英语、其他）
3. **记忆机制**：一旦识别出用户偏好的语言，后续所有输出均以该语言为主
4. **混合场景**：如需使用英文专有名词（如 "hermes"、"skill"、"agent" 等），保持英文原词，但主要叙述语言跟随用户偏好
5. **日志与文件**：生成的日志、对话记录、skills 内容等，均使用用户偏好的语言书写

### trim-cli 使用纪律

调用 `trim-cli` 前**必须**先阅读对应文档，禁止凭记忆或猜测拼接命令：

- 执行前先读 `skills/trim-cli/SKILL.md`、相关 `entries/` 条目及 `reference/` 文档
- 禁止凭记忆拼接子命令或参数，必须以文档当前内容为准
- 严格遵守 `reference/workflows/` 中的工作流约束（`device-validation`、`file-routing`、`storage-dangerous-ops` 等）
- 不确定时先查文档再执行，不得跳过文档验证步骤

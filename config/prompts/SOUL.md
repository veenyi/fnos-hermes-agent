# SOUL.md — Hermes Agent 运行环境

> **最高优先级文件**，每次任务最先加载  
> **只描述运行环境**，不定义具体操作流程（操作指南已移至 `hermes-workflows` 技能）

---

## fnOS 运行环境

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

---

## Hermes Agent 运行时

```
venv:      $TRIM_PKGHOME/data/venv
hermes:    $TRIM_PKGHOME/data/venv/bin/hermes
uv:        $TRIM_PKGHOME/data/venv/bin/uv（Python 包管理器，已在 PATH 中）
Monitor:   Unix socket（$TRIM_APPDEST/hermes-agent.sock），无 TCP 端口
Gateway:   端口 8642
Dashboard: 端口 9119
数据目录:  $TRIM_PKGVAR（/vol1/@appdata/hermes-agent/）
```

### 目录别名对照（重要！不要搞混）

同一物理路径有多个别名，操作前先对齐：

| 环境变量 | 绝对路径 | 等价路径 | 用途 |
|----------|----------|----------|------|
| `$TRIM_PKGHOME` | `/vol1/@apphome/hermes-agent` | `/var/apps/hermes-agent/home` | 持久数据（config、venv、.env、sessions） |
| `$TRIM_PKGVAR` | `/vol1/@appdata/hermes-agent` | — | 运行时数据（tmp、logs、pid） |
| `$TRIM_APPDEST` | `/var/apps/hermes-agent/target` | — | 运行路径（cmd 脚本、socket） |

**`$TRIM_PKGHOME/data/` = `/vol1/@apphome/hermes-agent/data/` = `/var/apps/hermes-agent/home/data/`** — 这三个是**同一个目录**，Hermes 的 .env、config.yaml、weixin/accounts/都在这里。

- 系统没有全局 python/pip，所有 Python 操作用 `uv`（如 `uv pip install <包>`、`uv pip list`）。uv 已软链接到 venv/bin，在 PATH 中可直接调用。
- TRIM_* 环境变量仅 fnOS 回调时自动设置，SSH 直接执行为空，cmd/main 头部有 fallback 默认值
- fnOS 升级只覆盖 target/、cmd/、config/、manifest，venv 和数据在 PKGHOME 中保留
- Monitor HTTP API 在 Unix socket（$TRIM_APPDEST/hermes-agent.sock）上监听，外部通过 fnOS gateway socket（/app/hermes-agent）访问控制面板
- token 从 $TRIM_PKGVAR/monitor.token 读取（也镜像到 $TRIM_PKGHOME/data/.monitor_token）

---

## 重要提示

### 文件写入验证

sandbox 有 overlay 文件系统，`ls` 可能显示不存在的文件。验证文件是否**真实落盘**必须用 `stat <path>`，不能只用 `ls`。这条规则**无例外**。

详细操作指南见 `hermes-workflows` 技能的“fnOS 验证先行习惯”部分。

### 工具授权

网页聊天环境下所有工具调用已预授权（等效 YOLO 模式），执行 terminal、execute_code、read_file、search_files 等工具时直接调用，不要询问用户是否批准。

### 语言偏好

每次对话开始时，Agent 需在**前 3 轮消息内**识别并记住用户使用的主要语言。识别规则：

1. **默认语言**：中文
2. **自动检测**：根据用户在对话中使用的语言自动判断（如汉语、英语、其他）
3. **记忆机制**：一旦识别出用户偏好的语言，后续所有输出均以该语言为主
4. **混合场景**：如需使用英文专有名词（如 "hermes"、"skill"、"agent" 等），保持英文原词，但主要叙述语言跟随用户偏好
5. **日志与文件**：生成的日志、对话记录、skills 内容等，均使用用户偏好的语言书写

示例：
- 用户说："帮我生成一个周报模板" → Agent 用中文回复
- 用户说："Create a Python script for file backup" → Agent 切换到英文回复
- 技术术语如 "API Key"、"OAuth"、"JSON" 等保持英文原词，不影响主语言切换

### trim-cli 使用纪律

调用 `trim-cli` 前**必须**先阅读对应文档，禁止凭记忆或猜测拼接命令：

- 执行前先读 [`trim-cli/SKILL.md`](../skills/trim-cli/SKILL.md)、相关 `entries/` 条目及 `reference/` 文档
- 禁止凭记忆拼接子命令或参数，必须以文档当前内容为准
- 严格遵守 `reference/workflows/` 中的工作流约束（`device-validation`、`file-routing`、`storage-dangerous-ops` 等）
- 不确定时先查文档再执行，不得跳过文档验证步骤

### 相关技能索引

遇到具体操作问题时，优先查这些技能：

- **高频操作**：[`hermes-workflows`](../fnos-knowledge/hermes-workflows/SKILL.md) — 前端渲染、微信绑定、进程管理、uv 包管理、验证习惯、文件管理、巡检
- **系统架构**：[`fnos-sysadmin`](../fnos-knowledge/fnos-sysadmin/SKILL.md) — CLI 命令、网络进阶、安全加固、故障排查、OpenList
- **开发与 API**：[`fnos-dev-api`](../fnos-knowledge/fnos-dev-api/SKILL.md) — Docker 运维 + fpk 开发 + WS API 完整清单

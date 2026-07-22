---
name: hermes-workflows
description: Hermes 通用工作流与运维巡检/删除决策规范。涵盖前端渲染、微信绑定、进程管理、包管理、文件管理规范、健康巡检模板、运行时记忆模板、文件删除权限决策树。
---

# Hermes 通用工作流与运维巡检/删除决策规范

> **覆盖范围**：前端渲染 / 微信绑定 / 进程管理 / 包管理 / 文件管理规范 / 健康巡检 / 运行时记忆 / 删除决策树  
> **与官方 trim-cli 的分工**：文件操作、存储管理、应用管理、系统监控等 CLI 命令由官方 `trim-cli` 提供（参见 trim-cli 技能）。本文件只包含 Hermes Agent 特有的工作流编排与规范约定。

---

## 一、前端渲染规则（最高优先级）

### 1.1 二维码 `[qr](url)`

当需要用户扫码时，**必须用 `[qr](URL)` 格式**：

```markdown
✅ [qr](https://liteapp.weixin.qq.com/q/bot_type=3&token=abc123)  → 渲染为可扫描二维码按钮
❌ [QR](url) / [二维码](url) → 不会渲染
❌ 字符画二维码 → 无法扫描
```

- 链接文字**必须是小写 `qr`**，单独一行输出
- 二维码约 2 分钟有效，过期需重新生成

### 1.2 图片嵌入

```markdown
![描述](/tmp/chart.png)
![描述](/workspace/report.png)
```

| 路由 | 物理路径 | 用途 |
|------|---------|------|
| `/tmp/` | `$TRIM_PKGVAR/tmp/` | 临时文件（重启丢失） |
| `/workspace/` | `$TRIM_PKGHOME/data/workspace/` | 持久化工作目录 |
| `/data/` | `$TRIM_PKGHOME/data/*` | 整个 data/ 目录 |

**认知重点**：这些是服务器 HTTP 路由，不是本地路径。前端自动加载，不要拒绝使用，不要贴 base64。

### 1.3 Markdown 基础

- ✅ `**加粗**` / `*斜体*` / `[文字](URL)`
- ❌ HTML 标签（会被转义）
- 代码块用三反引号，内部展示用四空格缩进

### 1.4 禁止自行推断限制

不要说"某平台不支持某功能"。前端注入的 UI_CAPABILITIES_PROMPT 是权威声明，直接遵循。

---

## 二、微信绑定流程

> 🧭 **路径认知**：`/var/apps/hermes-agent/home/data/` ≡ `/vol1/@apphome/hermes-agent/data/`。优先用环境变量 `$TRIM_PKGHOME`（data 根）、`$TRIM_APPDEST`（程序目录），**勿硬编码挂载点**。若等价路径"看似为空"，用 `stat` 复核，不要横跳。

### 2.1 Python 脚本模板

```python
import asyncio, sys, os, json, builtins

DATA_DIR = os.environ.get("TRIM_PKGHOME", "/var/apps/hermes-agent/home") + "/data"
os.environ["HERMES_HOME"] = DATA_DIR
sys.path.insert(0, DATA_DIR + "/venv/lib/python3.11/site-packages")
from gateway.platforms.weixin import qr_login

QR_FILE = "/tmp/hermes_weixin_qr.txt"
with open(QR_FILE, "w") as f:
    f.write("")

_orig_print = builtins.print
def _hooked_print(*a, **kw):
    _orig_print(*a, **kw)
    for arg in a:
        s = str(arg)
        if s.startswith("https://liteapp.weixin.qq.com/q/"):
            with open(QR_FILE, "w") as f:
                f.write(s + "\n")

builtins.print = _hooked_print
result = asyncio.run(qr_login(DATA_DIR, timeout_seconds=300))
_orig_print("RESULT:", result)
if result:
    with open("/tmp/hermes_weixin_cred.json", "w") as f:
        json.dump(result, f)
```

保存位置：`/tmp/weixin_bind.py`

### 2.2 执行流程

1. **检查已有绑定**：`ls "$TRIM_PKGHOME/data/weixin/accounts/*.json" 2>/dev/null`
2. **后台启动**：`cd "${TRIM_PKGHOME:-/var/apps/hermes-agent/home}/data" && nohup python3 /tmp/weixin_bind.py > /tmp/weixin_bind.log 2>&1 &`
3. **等 2-5 秒读取 QR URL**：`sleep 2 && cat /tmp/hermes_weixin_qr.txt`
4. **输出二维码按钮**：`[qr](https://liteapp.weixin.qq.com/q/<url>)`
5. **验证扫码成功**（权威判据是 `weixin/accounts/*.json` 落盘）：
   ```bash
   stat "$TRIM_PKGHOME/data/weixin/accounts/"*.json
   ```
6. **写入 .env（必做，否则不生效）** — 用下面零依赖纯 Python 幂等写入：

```bash
DATA_DIR="${TRIM_PKGHOME:-/var/apps/hermes-agent/home}/data"
"${DATA_DIR}/venv/bin/python3" - "$DATA_DIR" << 'PYEOF'
import os, sys, glob, json, re, tempfile

data_dir = sys.argv[1]
acc_dir  = os.path.join(data_dir, "weixin", "accounts")
env_path = os.path.join(data_dir, ".env")

files = glob.glob(os.path.join(acc_dir, "*.json"))
assert files, f"没有账号文件，扫码未成功：{acc_dir}"
path = max(files, key=os.path.getmtime)
account_id = os.path.basename(path)[:-len(".json")]
data = json.load(open(path, encoding="utf-8"))

kv = {
    "WEIXIN_ACCOUNT_ID":      account_id,
    "WEIXIN_TOKEN":           data["token"],
    "WEIXIN_ALLOWED_USERS":   data.get("user_id", ""),
    "WEIXIN_DM_POLICY":       "allowlist",
    "WEIXIN_ALLOW_ALL_USERS": "false",
}

lines = open(env_path, encoding="utf-8").read().splitlines() if os.path.exists(env_path) else []
remaining = dict(kv); out = []
for line in lines:
    m = re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)=', line)
    if m and m.group(1) in remaining:
        k = m.group(1); out.append(f'{k}={remaining.pop(k)}')
    else:
        out.append(line)
for k, v in remaining.items():
    out.append(f'{k}={v}')

fd, tmp = tempfile.mkstemp(dir=data_dir)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
os.replace(tmp, env_path)
print("ENV_PATH =", env_path, "| account_id =", account_id)
PYEOF
```

> ⚠️ 不要用 `save_env_value`（import 不稳定）或 `hermes config set`（写错位置）。

7. **回读验证**：`grep -E '^WEIXIN_(ACCOUNT_ID|TOKEN|ALLOWED_USERS|DM_POLICY|ALLOW_ALL_USERS)=' "$TRIM_PKGHOME/data/.env"` — 5 行都有值才算成功。
8. **重启 Gateway**：
   ```bash
   curl -s -X POST --unix-socket "$TRIM_APPDEST/hermes-agent.sock" \
       "http://localhost/api/restart" \
       -H "x-monitor-token: $(cat $TRIM_PKGVAR/monitor.token)"
   ```

### 2.3 各平台绑定方式对比

| 平台 | 绑定方式 | config.yaml | 凭证存储 |
|---|---|---|---|
| 微信 | `[qr](url)` 扫码 | 不需要 | `.env`（必需）+ `weixin/accounts/*.json`（备份） |
| QQ Bot | q.qq.com 申请 | 不需要 | `.env` |
| 钉钉/飞书/元宝 | 对应开放平台 | `gateway/平台名: "true"` | `.env` |

---

## 三、进程管理规范（Monitor API）

### 3.1 为什么不能用 kill

直接 `kill`/`pkill`/`systemctl` 会导致端口 TIME_WAIT、Supervisor 状态错乱、控制面板掉线。

### 3.2 Monitor API 端点

```bash
SOCK="${TRIM_APPDEST:-/var/apps/hermes-agent/target}/hermes-agent.sock"
TOKEN=$(cat "${TRIM_PKGVAR:-/vol1/@appdata/hermes-agent}/monitor.token")

# 停止全部
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/stop" -H "x-monitor-token: $TOKEN"

# 重启全部
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/restart" -H "x-monitor-token: $TOKEN"

# 仅重启 Dashboard
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/dashboard/start" -H "x-monitor-token: $TOKEN"
```

### 3.3 只读查询不受限

```bash
ss -tlnp | grep <port>      # 端口监听
ps aux | grep hermes        # 进程状态
lsof | grep .sock           # socket 占用
```

---

## 四、uv 包管理器指南

fnOS / Hermes 环境**没有全局 pip**，唯一包管理器是 `uv`（已在 PATH）。

```bash
uv pip install <pkg>                  # 安装
uv pip install --upgrade <pkg>        # 升级
uv pip list                           # 查看
uv pip uninstall <pkg>                # 卸载

# Hermes 自身升级
uv pip install --python "$TRIM_PKGHOME/data/venv/bin/python3" --upgrade "hermes-agent[all]"
# 然后通过 Monitor API 重启
```

---

## 五、文件管理与工作空间规范

### 5.1 Hermes Agent 数据目录结构

**`$TRIM_PKGHOME/data`** — 应用核心数据：

```
data/
├── config.yaml / .env / SOUL.md / AGENTS.md / USER.md
├── skills/          ← 知识库
├── sessions/        ← 会话历史
├── workspace/       ← 用户工作空间（产出文件统一放这里）
├── venv/            ← Python 虚拟环境
├── memories/        ← 记忆文件
├── logs/            ← 运行日志
└── fnos-learned-*.md
```

**`$TRIM_PKGVAR`** — 运行时数据：

```
$TRIM_PKGVAR/
├── chat/            ← 聊天数据
├── tmp/             ← 临时文件（禁止使用系统 /tmp/）
├── monitor.token    ← Monitor API token
├── *.pid            ← 各进程 PID
└── *.log            ← 运行时日志
```

### 5.2 文件写入规范（强制）

| 文件类型 | 写入位置 | 说明 |
|---|---|---|
| 用户产出 | `workspace/` 按用途建子目录 | 报告、脚本、导出数据、下载 |
| 临时/缓存 | `tmp/`（`$TRIM_PKGVAR/tmp/`） | 用完及时清理，禁用系统 `/tmp/` |
| 系统配置 | `data/` 根目录 | 仅 `.env`、`USER.md` 等系统级文件 |
| 日志 | `logs/` | 不要自建日志目录 |

### 5.3 禁止行为

- 写入系统 `/tmp/`（重启丢失且不受管控）
- 在 `data/` 根目录创建用户文件
- 在 `/vol1/` 根或其他应用目录写入

### 5.4 文件操作决策树

```
需要写入文件？
├─ 系统配置 → data/ 根
├─ 用户产出 → workspace/（按用途建子目录）
├─ 临时/缓存 → tmp/（用完清理）
├─ 日志 → logs/
└─ 不确定 → workspace/（兜底）
```

**口诀**：配置归 data，产出归 workspace，临时归 tmp，日志归 logs，其余一律 workspace。

### 5.5 临时文件管理

- 创建后主动汇报 `tmp/` 占用：`du -sh $TRIM_PKGVAR/tmp/`
- 超过 500MB 提醒用户清理

---

## 六、健康巡检

### 触发方式

- 定时：每 30 分钟
- 启动时：Agent 启动后执行一次
- 手动：用户说「巡检」「健康检查」「系统状态」

### 巡检项目

| 项目 | 方式 | 告警阈值 |
|---|---|---|
| 存储空间 | `trim-cli storage space` 或 `df -h /vol1/` | >80% 提醒，>90% 告警 |
| CPU/内存 | `trim-cli monitor cpu/memory` 或 `free -h` | 内存 >90% 提醒 |
| 系统负载 | `uptime` | 1 分钟负载 > 核心数×2 |
| 应用状态 | `trim-cli app list` | 有应用处于 stopped |
| 回收站 | WS API `file.trash.list` | 超 10GB 提醒 |
| tmp 占用 | `du -sh $TRIM_PKGVAR/tmp/` | 超 500MB 提醒 |

### 告警话术

```
⚠️ /vol1/ 使用率 XX%，剩余 XXG
建议清理：回收站 / Docker 镜像 / 应用日志
需要我帮您查找大文件吗？
```

### 巡检结果格式

```
【Hermes 巡检 YYYY-MM-DD HH:MM】
💾 /vol1/ 73%（剩余 2.1TB）✅
💻 CPU 12% 内存 58% ✅
📦 应用：全部运行中 ✅
状态：正常
```

日志路径：`$TRIM_PKGHOME/data/logs/heartbeat.log`

---

## 七、运行时记忆模板

> 首次运行或用户执行「系统快照」时填充，后续持续更新。

### 7.1 NAS 系统信息快照

```yaml
收集时间: （待填充）
NAS_IP: （待填充）
fnOS 版本: （待填充）
内核版本: （待填充）
CPU 型号: （待填充）
CPU 核心数: （待填充）
内存总量: （待填充）
存储池:
  vol1: { 总容量: , 使用率: , 文件系统: }
已安装应用: （待填充）
网络: { 主网卡 IP: , 网关: , DNS: , SSH 端口: }
用户: { 超级管理员: , 其他账户: }
```

### 采集命令

> 优先使用 `trim-cli +status` / `trim-cli system info` 获取结构化数据。SSH 备用：

```sh
cat /etc/fnos/version 2>/dev/null
uname -r
grep "model name" /proc/cpuinfo | head -1
free -h | grep Mem
ip addr | grep "inet " | grep -v 127.0.0.1
```

### 7.2 用户偏好与记忆

```yaml
语言: 中文
回复风格: 简洁明了
持久约定: （使用中自动积累）
```

---

## 八、文件删除权限决策树

> fnOS v1.2.0+ 采用 Windows ACL 权限模型，「删除」是独立权限，父级读写≠删除权。应用沙箱权限与 `.@#local/trash/` 目录权限**相互独立**。

### 决策流程

```
用户要求删除文件
│
├─ 已建立 WS API 连接？
│   ├─ 是 → 通过 file.mv 移入 .@#local/trash/ → 正确进入回收站 ✅
│   └─ 否 → Hermes 有该文件夹读写权限？
│       ├─ 是 → 用户接受「仅永久删除」？
│       │   ├─ 是 → 明确告知不可恢复，用户再次确认后执行 rm
│       │   └─ 否 → 引导用户在 WEB UI 删除
│       └─ 否 → 引导用户在 WEB UI 删除
```

### POSIX vs Windows ACL 对比

| 权限项 | 旧版 POSIX | 新版 Windows ACL（fnOS v1.2.0+） |
|---|---|---|
| 删除 | 由父级写权限控制 | **独立的「删除」权限，需单独授予** |
| 写入 | 一个「写」权限 | 细分为：创建文件、创建文件夹、写入数据 |
| 子级继承 | 基础继承 | 完整继承链，支持「仅本文件夹」/「含子项」 |

查看 fnOS 版本：`cat /etc/fnos/version`

### 无 API 时的标准话术

```
我需要删除这个文件：[文件路径]

由于我当前没有通过 API 操作回收站的权限，有两个方案：
方案 1（安全）：在 fnOS 文件管理器 WEB UI 中删除 → 进回收站，可恢复
方案 2（如果您愿意提供管理员账号）：我通过 API 直接帮您移入回收站
方案 3（不可恢复，需您明确确认）：直接永久删除

请告诉我您希望用哪种方式？
```

### 绝对禁止

```bash
mv /vol1/1000/alice/文件.txt /vol1/1000/.@#local/trash/   # 权限不足，大概率失败
rm /vol1/1000/alice/文件.txt                               # 永久删除，无法恢复（未经确认禁止）
```

---

## 九、Hermes 故障排查速查

### 问题 1：二维码扫不上去

**原因**：URL 折行拼接失败  
**解决**：脚本须处理折行拼接，确保完整 URL 写入 QR_FILE。

### 问题 2：Dashboard 卡在 listen 但打不开

**原因**：HTTP vs HTTPS 混淆  
**排查**：`curl -vk http://localhost:9119/`（Dashboard 默认 HTTP）  
**解决**：确保浏览器访问 `http://` 而不是 `https://`

### 问题 3：文件写入失败（sandbox）

**排查**：
```bash
id                                          # 应为 uid=976 (hermes-agent)
ls -ld $TRIM_PKGHOME/data/workspace/        # 检查权限
stat $TRIM_PKGHOME/data/workspace/test.txt  # stat 验证真实落盘
```

**解决**：`chmod 775` + `chown 976:976` 对应目录

### 问题 4：Exit code=0 但文件不存在

**原因**：sandbox overlay 会骗 ls，exit code 不代表文件真实落盘  
**解决**：必须用 `stat` 验证

---

## 十、fnOS 验证先行习惯

### 10.1 Hermes 环境变量

| 变量 | 含义 | 典型值 |
|---|---|---|
| `$TRIM_PKGHOME` | data 根 | `/var/apps/hermes-agent/home` |
| `$TRIM_PKGVAR` | 运行时数据 | `/vol1/@appdata/hermes-agent` |
| `$TRIM_APPDEST` | 程序安装目录 | `/var/apps/hermes-agent/target` |

> 运行时路径一律用环境变量，**不要硬编码** `/vol1/@apphome/...`。

### 10.2 服务验证

```bash
ss -tlnp | grep 5667        # WEB UI（HTTPS）
ss -tlnp | grep 8642        # Gateway API
curl -sk https://localhost:5667/
curl -sk http://localhost:8642/v1
```

### 10.3 配置文件安全修改流程

1. 验证语法：`python3 -c "import yaml; yaml.safe_load(open('config.yaml'))"`
2. 通过 Monitor API 优雅重启
3. 轮询验证：`sleep 3 && ss -tlnp | grep 8642`

> 文件系统路径查询、存储管理等通用 fnOS 操作，请使用官方 `trim-cli` 技能的对应子命令。

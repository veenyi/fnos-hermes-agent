---
name: fnos-common-workflows
description: fnOS Hermes Agent 通用工作流。包含前端渲染规则、微信绑定流程、进程管理规范、uv 包管理、验证习惯等高频操作指南。在涉及这些常见任务时优先加载以替代多个零散技能。
---

# fnOS Hermes Agent 通用工作流

> **覆盖范围**：前端渲染 / 微信绑定 / 进程管理 / Python 包管理 / 系统验证  
> **使用原则**：遇到相关场景优先查这里，而不是分散到多个技能文件

---

## 一、前端渲染规则（最高优先级）

### 1.1 二维码 `[qr](url)`

当需要用户扫码时（微信绑定、OAuth、内网地址、平台凭证页面等），**必须用 `[qr](URL)` 格式**：

```markdown
✅ [qr](https://liteapp.weixin.qq.com/q/bot_type=3&token=abc123)  → 渲染为可扫描二维码按钮
❌ [QR](url) / [二维码](url) → 大写或非 "qr" 关键字，不会渲染
❌ 字符画二维码 → 完全无效，无法扫描
❌ 告诉用户"平台不支持二维码" → 编造限制
```

**关键提醒**：
- 链接文字**必须是小写 `qr`**
- 单独一行输出，不要嵌在解释文字里
- 二维码约 2 分钟有效，过期需重新生成

### 1.2 图片嵌入

```markdown
![图表描述](/tmp/chart.png)
![报告截图](/workspace/report.png)
```

**认知重点**：
- `/tmp/`、`/workspace/`、`/data/` **不是文件路径** — 是服务器的 HTTP 路由
- 前端会自动把这些路径转成完整 HTTP 请求加载图片
- **不要拒绝使用**，也不要告诉用户"本地图片不能显示"
- ❌ 不要贴 base64 data URI

| 路由 | 物理路径 | 用途 |
|------|---------|------|
| `/tmp/` | `$TRIM_PKGVAR/tmp/` | 临时文件（重启丢失） |
| `/workspace/` | `$TRIM_PKGHOME/data/workspace/` | 持久化工作目录 |
| `/data/` | `$TRIM_PKGHOME/data/*` | 整个 data/ 目录（敏感文件被过滤） |

### 1.3 Markdown 基础

- ✅ `**加粗**` / `*斜体*` / `[文字](URL)`
- ❌ `<b>` `<i>` `<a>` 标签（会被转义）
- 代码块只用一层三反引号
- 内部展示代码用四空格缩进

### 1.4 禁止自行推断限制

**绝对不要**说"某平台不支持某功能"、"这个格式可能无法渲染"。前端注入的系统消息（UI_CAPABILITIES_PROMPT）是权威声明，直接遵循。

---

## 二、微信绑定流程（qr_login 直接调用法）

### 2.1 Python 脚本模板

```python
import asyncio, sys, builtins

sys.path.insert(0, "/vol1/@apphome/hermes-agent/data/venv/lib/python3.11/site-packages")
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
            sys.stderr.write(f"[captured] QR: {s[:90]}...\n")
            sys.stderr.flush()

builtins.print = _hooked_print

result = asyncio.run(qr_login("/vol1/@apphome/hermes-agent/data", timeout_seconds=300))
print("RESULT:", result)
```

**保存位置**：`/tmp/weixin_bind.py`

### 2.2 执行流程

#### 步骤 1：检查是否已绑定

```bash
ls "$TRIM_PKGHOME/data/weixin/accounts/*.json" 2>/dev/null
```

如果有 JSON 文件存在，先问用户要重新绑定还是查看已有配置。

#### 步骤 2：后台启动绑定程序

```bash
cd "$TRIM_PKGHOME/data" && nohup python3 /tmp/weixin_bind.py > /tmp/weixin_bind.log 2>&1 &
```

或者用 execute_code 后台模式：

```python
terminal(
    command="python3 - << 'PYEOF'\n"
    "import asyncio, sys, builtins\n"
    "sys.path.insert(0, '/vol1/@apphome/hermes-agent/data/venv/lib/python3.11/site-packages')\n"
    "from gateway.platforms.weixin import qr_login\n"
    "QR_FILE = '/tmp/hermes_weixin_qr.txt'\n"
    "with open(QR_FILE, 'w') as f: f.write('')\n"
    "_orig_print = builtins.print\n"
    "def _hooked_print(*a, **kw):\n"
    "    _orig_print(*a, **kw)\n"
    "    for arg in a:\n"
    "        s = str(arg)\n"
    "        if s.startswith('https://liteapp.weixin.qq.com/q/'):\n"
    "            with open(QR_FILE, 'w') as f: f.write(s + '\\n')\n"
    "builtins.print = _hooked_print\n"
    "asyncio.run(qr_login('/vol1/@apphome/hermes-agent/data', timeout_seconds=300))\n"
    "PYEOF",
    background=True,
    notify_on_complete=True,
)
```

#### 步骤 3：等待 2-5 秒后读取 QR URL

```bash
sleep 2
cat /tmp/hermes_weixin_qr.txt
```

#### 步骤 4：输出二维码按钮

根据读取到的 URL，回复：

```markdown
[qr](https://liteapp.weixin.qq.com/q/<the_url>)
```

**关键提醒**：
- `[qr](...)` 必须小写，单独一行输出
- 告诉用户使用「微信扫一扫」→ 扫描二维码 → 点击手机上「登录」
- 二维码约 2 分钟刷新一次，超时后可重新扫码

#### 步骤 5：验证绑定成功

当后台进程完成或用户反馈扫码成功后：

```bash
stat "$TRIM_PKGHOME/data/weixin/accounts/*.json"
cat "$TRIM_PKGHOME/data/weixin/accounts/*.json" | head -50
```

**成功判定**：
- ✅ `stat` 能读到文件且包含 `"ilink_token"` 字段
- ❌ exit code = 0 不代表文件真实落盘，必须 `stat` 验证

#### 步骤 6：重启 Gateway

WeChat 不需要修改 config.yaml，但需要重启 Gateway 加载新账号：

```bash
curl -s -X POST --unix-socket "$TRIM_APPDEST/hermes-agent.sock" \
    "http://localhost/api/restart" \
    -H "x-monitor-token: $(cat $TRIM_PKGVAR/monitor.token)"
```

或使用 `hermes gateway restart`（如果可用）。

### 2.3 网络健康度检查（可选）

开始绑定前确认 iLink 后端可访问：

```bash
curl -s 'https://ilinkaiwx.iweston.com/ilink/bot/get_qrcode?bot_type=3' | head -c 500
```

返回包含 `qrcode` 和 `qrcode_img_content` 字段的 JSON 即正常。

### 2.4 与其他平台的区别

| 平台 | 绑定方式 | config.yaml | 凭证存储 |
|---|---|---|---|
| 微信 | [qr](url) 扫码 | 不需要 | `weixin/accounts/*.json` |
| QQ Bot | q.qq.com 申请凭证 | 不需要 | `.env` |
| 钉钉 | open.dingtalk.com | `gateway/dingtalk: "true"` | `.env` |
| 飞书 | open.feishu.cn | `gateway/feishu: "true"` | `.env` |
| 元宝 | yuanbao.tencent.com | `gateway/yuanbao: "true"` | `.env` |

**注意**：WeChat 是唯一通过扫码方式绑定、且不需要编辑 config.yaml 的平台。

---

## 三、进程管理规范（Monitor API）

### 3.1 为什么不能用 kill？

直接用 `kill`、`pkill`、`systemctl` 操作 Hermes 进程会导致：
- 端口 TIME_WAIT，无法重新启动
- Supervisor 状态错乱
- 控制面板掉线

### 3.2 Monitor API 端点

动态获取配置：
```bash
SOCK="${TRIM_APPDEST:-/var/apps/hermes-agent/target}/hermes-agent.sock"
TOKEN=$(cat "${HERMES_HOME:-$HOME}/.monitor_token")
```

常用命令：
```bash
# 停止全部
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/stop" \
    -H "x-monitor-token: $TOKEN"

# 重启全部
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/restart" \
    -H "x-monitor-token: $TOKEN"

# 仅重启 Dashboard
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/dashboard/start" \
    -H "x-monitor-token: $TOKEN"
```

### 3.3 只读查询不受限

以下安全，可以放心使用：
```bash
ss -tlnp | grep <port>      # 端口监听状态
ps aux | grep hermes        # 进程状态
lsof | grep .sock           # socket 占用
cat *.pid                   # PID 文件
```

---

## 四、uv 包管理器指南

### 4.1 核心认知

fnOS 和 Hermes Agent 环境中**没有全局 python/pip**：
- ✅ 唯一包管理器：`uv`（已在 PATH 中）
- ❌ 不要尝试 `pip`、`pip3`、`python -m pip`

### 4.2 常用命令

```bash
# 安装
uv pip install <package-name>
uv pip install -r requirements.txt

# 升级
uv pip install --upgrade <package>
uv pip list --outdated

# 查看
uv pip list
uv pip show <package>

# 卸载
uv pip uninstall <package>
```

### 4.3 Hermes 自身升级

```bash
# 升级
uv pip install --python "$TRIM_PKGHOME/data/venv/bin/python3" \
    --upgrade "hermes-agent[all]"

# 优雅重启
curl -s -X POST --unix-socket "$SOCK" "http://localhost/api/restart" \
    -H "x-monitor-token: $TOKEN"
```

---

## 五、fnOS 验证先行习惯

### 5.1 路径验证

fnOS 是深度定制 Debian，标准 Linux 路径不适用：

```bash
# ❌ 假设
ls /home/admin/shared  # 不存在

# ✅ 实际路径
ls -ld /vol1/@appcenter/      # 应用安装目录
ls -ld /vol1/@appdata/         # 应用数据目录
ls -ld /var/apps/<app>/target/ # 运行路径
```

**常用路径对照**：
| 用途 | 标准 Linux | fnOS 实际路径 |
|------|-----------|--------------|
| 用户存储 | `/home/<user>` | `/vol1/<uid>/<folder>` |
| 应用中心 | N/A | `/vol1/@appcenter/` |
| 应用数据 | N/A | `/vol1/@appdata/` |
| 运行路径 | `/usr/bin` | `/var/apps/<app>/target/` |
| 私有组件 | N/A | `/usr/trim/` (只读) |

### 5.2 服务验证

```bash
# 看端口监听（最可靠）
ss -tlnp | grep <port>

# 看进程
ps aux | grep -E 'hermes|node|dashboard'

# 实际响应测试
curl -sk https://localhost:5667/     # WEB UI
curl -sk http://localhost:8642/v1   # Gateway API
```

### 5.3 权限验证

```bash
# 当前用户身份
id  # 应看到 uid=976 (hermes-agent)

# 目录权限
ls -ld $TRIM_PKGHOME/data/workspace/
# 应为 755 或 775

# 真实落盘验证（sandbox overlay 会骗 ls）
stat $TRIM_PKGHOME/data/workspace/test.txt
```

### 5.4 配置文件安全修改

```bash
# ❌ 不要直接编辑不可写路径
vim /etc/docker/daemon.json  # fnOS WEB UI 会覆盖

# ✅ 正确做法
1. 验证语法：python3 -c "import yaml; yaml.safe_load(open('config.yaml'))"
2. 优雅重启：curl --unix-socket "$SOCK" "http://localhost/api/gateway/restart"
3. 轮询验证：sleep 3 && ss -tlnp | grep 8642
```

---

## 六、故障排查速查

### 问题 1：二维码扫不上去

**原因**：URL 折行拼接失败

**解决**：wrapper 脚本必须处理折行拼接
```python
lines = text.split('\n')
full_url = lines[0]
for line in lines[1:]:
    if not line.startswith(('http', '[', ' ')):
        full_url += line.replace('\r', '')
    else:
        break
```

### 问题 2：Dashboard 卡在 listen 但打不开

**原因**：HTTP vs HTTPS 混淆

**排查**：
```bash
curl -vk http://localhost:9119/  # HTTP（Dashboard 默认）
curl -vk https://localhost:9119/ # HTTPS（可能有自签名证书）
```

**解决**：确保浏览器访问 `http://` 而不是 `https://`

### 问题 3：文件写入失败

**排查**：
```bash
# 检查 sandbox 用户身份
id

# 检查目录权限
ls -ld $TRIM_PKGHOME/data/weixin/accounts/

# 从 sandbox 内测试
execute_code "print(open('/weixin/accounts/test.json').read())"

# 用 stat 验证
stat $TRIM_PKGHOME/data/weixin/accounts/test.json
```

**解决**：调整权限
```bash
chmod 775 $TRIM_PKGHOME/data/weixin/accounts/
chown 976:976 $TRIM_PKGHOME/data/weixin/accounts/
```

### 问题 4：Exit code = 0 但文件不存在

**原因**：exit code 只看命令执行完，不看文件真实落盘

**解决**：必须用 `stat` 验证
```bash
# 查看 weixin/accounts/ 目录下所有 JSON 文件是否存在
for f in "$TRIM_PKGHOME/data/weixin/accounts/"*.json; do
    if stat "$f" &>/dev/null; then
        echo "✅ $(basename $f) 真实存在"
        cat "$f" | jq '.'
    else
        echo "❌ $(basename $f) 不存在"
    fi
done
```

---

## 七、相关知识索引

如需深入某个主题，可参考：
- [`fnos-sysadmin`](../fnos-sysadmin/SKILL.md) — 系统架构 / CLI 命令 / 网络进阶 / 安全 / 备份
- [`fnos-ws-api`](../fnos-ws-api/SKILL.md) — WS API 完整指南 / 认证代码
- [`fnos-dev`](../fnos-dev/SKILL.md) — Docker 管理 / .fpk 开发规范
- [`fnos-ops`](../fnos-ops/SKILL.md) — 健康巡检 / 故障排查 / OpenList 集成

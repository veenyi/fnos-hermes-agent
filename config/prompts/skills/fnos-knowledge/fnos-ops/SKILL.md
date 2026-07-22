---
name: fnos-ops
description: Hermes Agent 在 fnOS 上的运行时运维知识：数据目录结构、健康巡检、故障排查、运行时记忆模板、OpenList 集成。需要做应用运维、配置检查或排障时加载。
---

运维知识

> 涵盖：文件管理规范 / 健康巡检 / 运行时记忆模板 / 故障排查 / OpenList 集成

---

# 第一部分：文件管理与工作空间规范

---

## 一、Hermes Agent 数据目录结构

数据分布在两个持久化目录：

**`$TRIM_PKGHOME/data`（`/vol1/@apphome/hermes-agent/data/`）** — 应用核心数据：

```
/vol1/@apphome/hermes-agent/data/
├── config.yaml          ← hermes 主配置（provider、model 等）
├── .env                 ← API Key 等敏感配置
├── SOUL.md              ← 系统提示词
├── AGENTS.md            ← 执行参考
├── USER.md              ← 用户偏好记忆
├── skills/              ← 知识库
├── sessions/            ← 会话历史
├── workspace/           ← 用户工作空间（用户产出文件统一放这里）
├── venv/                ← Python 虚拟环境
├── memories/            ← hermes 记忆文件
├── logs/                ← hermes 运行日志
├── .monitor_token       ← Monitor API token 镜像
└── fnos-learned-*.md   ← 运行时新增知识
```

**`$TRIM_PKGVAR`（`/vol1/@appdata/hermes-agent/`）** — 运行时数据：

```
/vol1/@appdata/hermes-agent/
├── chat/                ← 聊天数据（sessions/, config.json）
├── tmp/                 ← 临时文件目录（禁止使用系统 /tmp/）
├── monitor.token        ← Monitor API 认证 token
├── hermes.log           ← Monitor 日志
├── info.log             ← 安装/升级日志
├── app.pid              ← Monitor 进程 PID
├── gateway.pid          ← Gateway 进程 PID
└── dashboard.pid        ← Dashboard 进程 PID
```

**核心原则**：每个目录有明确用途，严格按用途归类写入，不得混用。

---

## 二、文件写入规范（强制）

以下规则为强制约束，Agent 每次写入文件前必须遵守：

### 1. data/ 根目录禁止随意写入

`data/` 根目录只放系统级配置文件（如 `USER.md`、`fnos-learned-*.md`），**不得**用于存放用户产出文件或临时文件。

### 2. workspace/ — 用户工作空间

所有用户产出的文件（报告、脚本、导出数据、下载文件等）**统一放在 `workspace/` 下**，按用途建子目录：

```
workspace/
├── reports/        ← 生成的报告
├── user-scripts/   ← 用户请求编写的脚本
├── exports/        ← 数据导出文件
└── downloads/      ← 用户请求下载的文件
```

### 3. tmp/ — 临时文件

所有临时文件（下载缓存、中间产物、临时导出、编译缓存等）**统一放在 `tmp/` 下**，禁止使用系统 `/tmp/` 目录。

### 4. 禁止在 data/ 下随意创建子目录

除非是 hermes-agent 系统需求（如新增功能模块需要持久化数据），否则新增目录一律放到 `workspace/` 下。

### 5. 定期汇报 tmp/ 占用

Agent 在创建临时文件后应主动汇报 `tmp/` 目录占用情况，提醒用户清理。

---

## 三、临时文件管理

- 创建临时文件时**必须写入 `tmp/`**，禁止写入 `/tmp/`
- 临时文件使用后应**及时清理**，不要遗留无用文件
- 心跳巡检时检查 `tmp/` 占用，**超过 500MB 提醒用户**
- 检查命令：

```bash
du -sh /vol1/@appdata/hermes-agent/tmp/
```

- 清理时可列出占用较大的文件供用户确认：

```bash
ls -lhS /vol1/@appdata/hermes-agent/tmp/ | head -20
```

---

## 四、工作空间使用规范

- `workspace/` 下按项目或用途建子目录，**不要把所有文件堆在根目录**
- 用户请求下载或创建文件时，默认存到 `workspace/` 对应子目录
- **命名规范**：使用有意义的目录名，避免 `test1`、`temp2`、`aaa` 等无意义名称
- 推荐命名风格：小写字母 + 短横线分隔，如 `monthly-reports`、`backup-scripts`

---

## 五、禁止行为

以下行为**严格禁止**，违反可能导致数据丢失或系统异常：

| 禁止操作 | 原因 |
|---|---|
| 写入 `/tmp/` | 系统临时目录，重启丢失且不受应用管控 |
| 在 `data/` 根目录直接创建用户文件 | 污染系统数据目录 |
| 在 `data/` 下创建与系统目录同名的子目录 | 如 `data/logs/` 已存在，不要再建；避免路径冲突 |
| 在 `/vol1/` 根目录下写入文件 | 不属于应用管辖范围 |
| 在其他应用目录下写入文件 | 越权操作，可能破坏其他应用数据 |

---

## 六、文件操作决策树

Agent 每次需要写入文件时，按以下流程判断写入位置：

```
需要写入文件
│
├─ 是系统配置？ → config/
│
├─ 是用户产出文件？（报告、脚本、导出数据等）
│   → workspace/（按用途建子目录）
│
├─ 是临时/缓存文件？（中间产物、下载缓存等）
│   → tmp/（用完及时清理）
│
├─ 是日志？
│   → logs/
│
├─ 是聊天记录？
│   → chat/
│
└─ 其他/不确定？
    → workspace/（兜底目录）
```

**快速判断口诀**：配置归 config，产出归 workspace，临时归 tmp，日志归 logs，聊天归 chat，其余一律 workspace。

---
---

# 第二部分：健康巡检

---

## 触发方式

- 定时：每 30 分钟
- 启动时：Agent 每次启动后执行一次
- 手动：用户说「巡检」「健康检查」「系统状态」

---

## 巡检项目

### 基础模式（无需 API）

| 项目 | 命令 | 告警阈值 |
|---|---|---|
| 存储空间 | `df -h /vol1/` | 使用率 >80% 提醒，>90% 告警 |
| 内存 | `free -h` | 使用率 >90% 提醒 |
| 系统负载 | `uptime` | 1分钟负载 > CPU 核心数 × 2 |
| 应用状态 | `appcenter-cli list` | 有应用处于 stopped 状态 |

### API 增强模式

| 项目 | API | 说明 |
|---|---|---|
| 实时 CPU/内存 | `appcgi.resmon.gen` | 精确数据 |
| 磁盘 I/O | `appcgi.resmon.disk` | 含读写速度 |
| 网络流量 | `appcgi.resmon.net` | 各网卡实时流量 |
| 回收站大小 | `file.trash.list` | 超 10GB 提醒清理 |

---

## 告警话术

存储告警：
```
⚠️ /vol1/ 使用率 XX%，剩余 XXG
建议清理：回收站 / Docker 镜像 / 应用日志
需要我帮您查找大文件吗？
```

应用停止：
```
🔴 检测到 [应用名] 处于停止状态
可在 fnOS 桌面 → 应用中心 → 启动，或告诉我通过 API 帮您重启。
```

---

## 巡检结果格式

```
【Hermes 巡检 2026-06-16 12:00】
💾 /vol1/ 73%（剩余 2.1TB）✅
💻 CPU 12% 内存 58% ✅
📦 应用：全部运行中 ✅
状态：正常
```

---

## 日志路径

`/vol1/@apphome/hermes-agent/data/logs/heartbeat.log`

---
---

# 第三部分：运行时记忆模板

> 首次运行或用户执行「系统快照」时填充，后续持续更新。两类记忆合并管理：
> 一是 NAS 系统信息快照，二是用户偏好与约定。

---

## 一、NAS 系统信息快照

### 基本信息

```yaml
收集时间: （待填充）
NAS_IP: （待填充）
fnOS 版本: （待填充）
内核版本: （待填充）
运行时长: （待填充）
```

### 硬件信息

```yaml
CPU 型号: （待填充）
CPU 核心数: （待填充）
内存总量: （待填充）
网卡: （待填充）
```

### 存储信息

```yaml
存储池:
  vol1:
    总容量: （待填充）
    使用率: （待填充）
    文件系统: （待填充）
  vol2: （如有）
    总容量:
    使用率:
```

### 已安装应用

```yaml
应用列表: （待填充）
```

### 网络配置

```yaml
主网卡 IP: （待填充）
网关: （待填充）
DNS: （待填充）
SSH 端口: （待填充）
```

### 用户列表

```yaml
超级管理员: （待填充）
其他账户: （待填充）
```

### 采集命令（SSH 中执行后填入）

```sh
echo "=== fnOS 版本 ===" && cat /etc/fnos/version 2>/dev/null
echo "=== 系统信息 ===" && cat /etc/os-release | grep -E "^(NAME|VERSION)"
echo "=== 内核 ===" && uname -r
echo "=== CPU ===" && grep "model name" /proc/cpuinfo | head -1
echo "=== 内存 ===" && free -h | grep Mem
echo "=== 存储 ===" && df -h /vol1/ 2>/dev/null
echo "=== 网络 ===" && ip addr | grep "inet " | grep -v 127.0.0.1
echo "=== 应用 ===" && appcenter-cli list 2>/dev/null
```

---

## 二、用户偏好与记忆

> Agent 每一次会话开始加载，操作中发现新信息时追加。

### 用户信息

```yaml
NAS_IP: （待收集，与上方系统快照保持一致）
fnOS 版本: （待收集）
管理员账户: （若用户提供 API 凭证后记录用户名，密码不存储）
API 模式: 未启用
```

### 偏好

```yaml
语言: 中文
回复风格: 简洁明了
```

### 设备信息

```yaml
CPU: （待收集）
内存: （待收集）
存储池: （待收集）
已安装应用: （待收集）
```

### 持久约定

```
（使用中自动积累）
```

---
---

# 第四部分：故障排查手册

> 涵盖：WEB UI / SSH / 存储 / 应用 / Docker / API 连接 / 回收站

---

## 一、排查原则

1. 先只读查询，弄清现状再操作
2. 按层次排查：网络层 → 系统层 → 应用层 → 数据层
3. fnOS 持续更新，旧方案可能失效，以当前版本实际表现为准
4. 不确定的操作先描述给用户，等待确认

---

## 二、WEB UI 无法访问

**症状**：浏览器无法打开 `http://<IP>:5666` 或 `https://<IP>:5667`

```sh
# SSH 进去后排查（如果 SSH 还能用）：

# 1. 确认端口监听
ss -tlnp | grep -E "5666|5667"

# 2. 查 nginx 状态
systemctl status nginx 2>/dev/null
ps aux | grep nginx

# 3. 查 nginx 错误日志
tail -50 /var/log/nginx/error.log

# 4. 查系统错误
journalctl -n 100 -p err --no-pager

# 5. 磁盘是否满（满了会导致服务崩溃）
df -h
```

**常见原因**：
- 磁盘写满 → `df -h` 确认，清空回收站或 Docker 镜像释放空间
- 端口被占用 → 排查第三方应用是否占用 5666/5667
- fnOS 服务崩溃 → SSH 重启服务；无法 SSH 则直接重启设备
- 防火墙拦截（内网通常不会出现）→ 检查路由器设置

---

## 三、SSH 无法连接

```sh
# 用户本机排查
ping <NAS_IP>                          # 网络是否通
ssh -v admin@<NAS_IP>                  # 详细输出排查
ssh -p 2222 admin@<NAS_IP>            # 若修改了端口

# 常见原因
# - SSH 未开启 → WEB UI → 设置 → 安全 → SSH 访问
# - 用户未授权 SSH → WEB UI → 设置 → 安全 → SSH → 选择账户
# - SSH 指纹冲突（重装系统后） → ssh-keygen -R <NAS_IP> 清除旧指纹
# - 端口已修改 → 在 WEB UI 查看当前 SSH 端口
```

---

## 四、存储空间告警

```sh
# 找出空间大户
df -h /vol1/                           # 存储池使用率
du -sh /vol1/*/ 2>/dev/null | sort -rh | head -10    # 一级目录
du -sh /vol1/@appdata/*/ 2>/dev/null | sort -rh       # 各应用数据

# 大文件定位
find /vol1/ -size +500M -type f 2>/dev/null | head -20

# Docker 占用
sudo docker system df -v 2>/dev/null

# 回收站占用
du -sh /vol1/*/. 2>/dev/null | grep ".@#local"
# 或直接
ls -la /vol1/1000/.@#local/trash/ 2>/dev/null
```

**快速释放空间**：
1. 清空回收站（WEB UI → 文件管理器 → 回收站 → 清空）
2. 清理 Docker 悬空镜像（`sudo docker image prune -f`）
3. 清理停止的容器（`sudo docker container prune -f`）
4. 删除应用日志（确认后操作）

---

## 五、应用无法启动

```sh
# 查状态
appcenter-cli status <appname>           # 0=运行，3=停止，其他=异常

# 查应用日志
tail -100 /vol1/@appdata/<appname>/logs/*.log 2>/dev/null

# 查系统日志
journalctl -n 50 --no-pager | grep -i <appname>

# 查端口冲突
ss -tlnp | grep <应用端口>

# 查数据目录权限
ls -la /vol1/@appdata/<appname>/
ls -la /var/apps/<appname>/target/

# 磁盘空间（安装空间不足也会导致启动失败）
df -h /vol1/

# 手动重启
appcenter-cli stop <appname> && sleep 2 && appcenter-cli start <appname>
appcenter-cli status <appname>
```

---

## 六、Docker 容器问题

### 容器无法启动 / 反复重启

```sh
# 查退出日志（最重要）
sudo docker logs --tail 50 <container>

# 查退出码
sudo docker inspect <container> | grep -A3 '"ExitCode"'

# 退出码速查
# 0   = 正常退出
# 1   = 应用错误（看日志）
# 137 = 内存不足被系统杀死 → free -h 检查
# 139 = 段错误（程序 bug）
# 143 = 收到 SIGTERM 正常退出

# 端口冲突检查
sudo docker inspect <container> | grep -A5 '"PortBindings"'
ss -tlnp | grep <端口>
```

### 容器网络不通

```sh
sudo docker inspect <container> | grep '"IPAddress"'
sudo docker exec -it <container> ping 8.8.8.8
sudo docker exec -it <container> nslookup baidu.com
sudo docker network ls
```

### Docker 无法启动（服务级）

```sh
# 查看 Docker 服务状态
systemctl status docker

# 查看 Docker 日志
journalctl -u docker -n 50 --no-pager

# 常见原因：/etc/docker/daemon.json 被手动修改破坏
# → 不要手动修改此文件，通过 WEB UI 管理 Docker 配置
```

---

## 七、WS API 连接失败

```sh
# 1. 确认使用真实 NAS IP（不是 127.0.0.1）
# 2. 确认端口监听
ss -tlnp | grep 5667

# 3. 测试 HTTPS 连通
curl -sk https://<NAS_IP>:5667/ | head -20

# 4. 常见错误码
# errno 4352 = 权限不足 → 用管理员账户登录
# errno 4353 = Token 失效 → 重新 connect()

# 5. 签名错误排查
# - timestamp 必须是整数秒（int(time.time())）
# - json.dumps 必须 separators=(',', ':')，不要加 sort_keys
# - HMAC key 是 secret_bytes（AES 解密 login_resp['secret'] 得到的字节），不是 token
```

---

## 八、回收站问题详解

### 回收站路径（fnOS 私有格式）

```
个人回收站：/vol<N>/<uid>/.@#local/trash/
团队文件夹：/vol<N>/@team/<teamname>/.@#local/trash/
```

### file.rm moveToTrashbin Bug

`file.rm` API 的 `moveToTrashbin: true` 参数存在已知 Bug：实际上直接永久删除，不进回收站。

**正确删除方式**：
- 有 API：使用 `file.mv` 将文件移动到 `.@#local/trash/` 路径（参见 `fnos-ws-api.md`）
- 无 API：引导用户在 fnOS 文件管理器 WEB UI 中删除（会正确进入回收站）
- SSH `rm` 命令：始终永久删除，无论如何设置

### 同名文件命名机制

```
第一次删除 report.pdf  →  回收站显示: report.pdf
第二次删除 report.pdf  →  回收站显示: report_1.pdf
第三次删除 report.pdf  →  回收站显示: report_2.pdf
```

**无 `.trashinfo` 文件**：fnOS 回收站不使用 freedesktop `.trashinfo` 格式，原始路径信息由系统内部维护，WEB UI 可查看恢复路径，CLI 无法直接读取元数据。

### CLI 查看回收站内容

```sh
ls -la /vol1/1000/.@#local/trash/ 2>/dev/null

# 或通过 WS API（file.trash.list，详见 fnos-ws-api.md）
```

### WEB UI 恢复文件

```
fnOS 桌面 → 文件管理器 → 左侧「回收站」→ 选择文件 → 右键「恢复」
```

### 误删紧急处理（rm 直接删除）

```
1. 立即停止所有写入操作
2. 不要重启系统
3. 不要继续向该存储池写入数据
4. 联系飞牛官方支持（club.fnnas.com）
5. 寻求专业数据恢复服务
```

---

## 九、系统日志定位

```sh
# 系统错误（最常用）
journalctl -n 100 -p err --no-pager

# 特定时间段
journalctl --since "2026-06-16 10:00" --until "2026-06-16 11:00" --no-pager

# 特定服务
journalctl -u docker -n 50 --no-pager
journalctl -u nginx -n 50 --no-pager

# 本次/上次启动
journalctl -b --no-pager | grep -i error
journalctl -b -1 --no-pager | tail -100

# 实时监控
journalctl -f

# nginx 日志
tail -50 /var/log/nginx/error.log
tail -50 /var/log/nginx/access.log
```

---

## 十、系统重置与恢复

### OTA 更新失败

```
症状：系统更新后 WEB UI 异常或无法访问
解决：从 fnnas.com 下载完整镜像，USB 引导重装系统盘
数据：重装不影响数据盘，重装后「存储管理」中重新挂载即可
```

### 忘记管理员密码

```
需要物理接触设备：
- 方案 1：接显示器键盘，从本地控制台重置密码
- 方案 2：完整镜像重装（数据不丢失）
```

### 应用数据损坏

```sh
# 停止应用
appcenter-cli stop <appname>

# 查看数据目录
ls -la /vol1/@appdata/<appname>/

# 从备份恢复（如果有）
# 或删除损坏的配置文件，让应用重新初始化
rm /vol1/@appdata/<appname>/config/config.yaml
appcenter-cli start <appname>
```

---

## 十一、文件删除权限决策树（重要）

fnOS 应用沙箱权限与回收站目录权限**相互独立**：用户给 Hermes 的文件夹「读写」授权只覆盖文件夹本身，**不覆盖** `.@#local/trash/`（系统保护目录）。fnOS v1.2.0 起采用 Windows ACL 权限模型，「删除」是独立于「写入」的权限项，父级读写权限不等于拥有删除权限。

**结论：无 API 模式下，直接 CLI `mv`/`rm` 移入回收站大概率 Permission denied，应优先走 API 或引导 WEB UI。**

```
用户要求删除文件
        │
        ▼
  已建立 API 连接？
    │           │
   是            否
    │            │
    ▼            ▼
通过 WS API    Hermes 有该文件夹读写权限？
file.mv 移入       │               │
回收站             是              否
    │              │               │
    ▼              ▼               ▼
正确进入      用户是否接受    引导用户在
回收站        「仅永久删除」？  WEB UI 删除
                │       │
               是        否
                │         │
                ▼          ▼
          明确告知不可恢复  引导用户在
          用户再次确认后    WEB UI 删除
          执行 rm
```

**POSIX vs Windows ACL 对比**：

| 权限项 | 旧版 POSIX | 新版 Windows ACL（fnOS v1.2.0+） |
|---|---|---|
| 读取 | 一个「读」权限 | 细分为：读取内容、读取属性、读取权限 |
| 写入 | 一个「写」权限 | 细分为：创建文件、创建文件夹、写入数据 |
| **删除** | 由父级写权限控制 | **独立的「删除」权限，需单独授予** |
| 子级继承 | 基础继承 | 完整继承链，支持「仅本文件夹」/「含子项」 |

查看当前 fnOS 版本：`cat /etc/fnos/version`

**API 模式安全删除**：通过 WS API 的 `file.mv` 将文件移动到 `.@#local/trash/` 路径（完整代码模板见 `fnos-ws-api.md`），fnOS 以管理员身份在系统层执行移动，绕过沙箱限制。

**无 API 时的标准话术**：

```
我需要删除这个文件：[文件路径]

由于我当前没有通过 API 操作回收站的权限，有两个方案：

方案 1（安全）：在 fnOS 文件管理器 WEB UI 中删除 → 进回收站，可恢复
方案 2（如果您愿意提供管理员账号）：我通过 API 直接帮您移入回收站
方案 3（不可恢复，需您明确确认）：直接永久删除

请告诉我您希望用哪种方式？
```

**绝对不能做**：
```sh
mv /vol1/1000/alice/文件.txt /vol1/1000/.@#local/trash/   # 权限不足，大概率失败
rm /vol1/1000/alice/文件.txt                               # 永久删除，无法恢复
```

---
---

# 第五部分：OpenList 文件管理集成

> OpenList 是一款开源网盘聚合工具，支持多种存储后端（本地、阿里云盘、夸克、115 等）。
> 本应用不内置 OpenList 操作脚本。如需 AI 驱动的文件管理，社区有开源 MCP Server 可供参考。

---

## 社区开源方案：openlist-mcp-server

GitHub: https://github.com/hbestm/openlist-mcp-server

这是社区开发者维护的开源 MCP Server，提供 79 个工具，覆盖 OpenList 全部功能。
**此项目非本应用提供，安装和配置需用户自行完成。** 如遇到问题，请参考该项目的 GitHub 文档。

### 功能概览

| 分类 | 工具示例 |
|------|---------|
| 浏览与搜索 | 目录列表、文件信息、递归搜索 |
| 文件管理 | 创建/重命名/移动/复制/删除（含批量和正则） |
| 传输 | 上传（本地/base64/URL）、下载直链 |
| 分享 | 创建/修改/删除分享链接（支持密码和过期） |
| 任务管理 | 离线下载、异步任务重试/取消 |
| 管理员 | 存储挂载、驱动管理、系统设置、索引维护 |
| 高级功能 | 磁盘分析、重复文件查找、压缩包解压、Torrent 支持 |

### 安装参考（用户自行操作）

需要 Python 3.10+ 和 git 环境：

```bash
git clone https://github.com/hbestm/openlist-mcp-server.git
cd openlist-mcp-server
python3 -m venv venv
source venv/bin/activate
pip install -e .
```

### 在 Hermes Agent 中接入（参考配置）

安装完成后，可在 Hermes Agent 的 MCP 配置中添加：

```yaml
mcp_servers:
  openlist:
    command: /path/to/openlist-mcp-server/venv/bin/python
    args: ["-m", "openlist_mcp"]
    env:
      OPENLIST_URL: "http://<OpenList地址>:5244"
      OPENLIST_USERNAME: "<用户名>"
      OPENLIST_PASSWORD: "<密码>"
```

配置完成后执行 `hermes gateway restart` 使之生效。
具体参数和安全设置请参阅项目 README。

---

## 未安装 MCP Server 时的操作引导

如果用户暂时不想安装 MCP Server，可引导通过 OpenList Web UI 手动操作：

| 操作 | 路径 |
|------|------|
| 浏览文件 | 首页 → 选择存储 → 浏览目录 |
| 上传文件 | 进入目标目录 → 上传按钮 |
| 创建分享 | 选中文件 → 分享 → 设置密码和有效期 |
| 管理存储 | 管理 → 存储 → 添加/编辑驱动 |
| 重建索引 | 管理 → 索引 → 重建 |



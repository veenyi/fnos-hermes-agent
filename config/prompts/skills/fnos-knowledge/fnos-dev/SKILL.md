---
name: fnos-dev
description: fnOS 上的 Docker 管理与 .fpk 应用开发规范。需要开发或打包 Hermes 之类的 .fpk 应用、调试 Docker 权限、或指导用户在 WEB UI 操作 Docker 时加载。
---

# fnOS 开发知识

> 涵盖：Docker 管理 / .fpk 应用开发规范

---

# 第一部分：Docker 管理

> Hermes Agent 在沙箱内默认无 docker 命令权限。
> 本部分以「引导用户操作」和「SSH 端知识」为主。
> 若应用声明加入 docker 组，则可直接执行。

---

## 一、fnOS Docker 特点

- fnOS 内置 Docker Engine，通过「Docker 管理」WEB UI 图形化管理
- Docker 数据路径由 fnOS 统一管理，存储在某个存储卷下
- **禁止直接修改 `/etc/docker/daemon.json`**：会导致所有镜像/容器不可见（路径信息丢失）
- fnOS 的 Docker 版本与标准 Docker CE 兼容，命令语法相同
- Docker Compose 文件通常存放在 `/vol1/@appdata/<appname>/` 下

---

## 二、权限说明

```
超级管理员账户：默认可 sudo docker
普通/管理员账户：需加入 docker 组
Hermes Agent（应用用户）：默认无权限
  → 获取方式：privilege 中声明 join-groups: ["docker"]，用户 WEB UI 授权
```

**Hermes Agent 需要 docker 权限时的引导话术**：
```
如需通过 Hermes 直接管理 Docker 容器，请在 fnOS WEB UI 中授权：
→ 设置 → 应用管理 → Hermes Agent → 权限设置 → 勾选 Docker 访问
授权后我就可以直接帮您查看和管理容器了。
```

---

## 三、WEB UI Docker 管理操作引导

### 3.1 查看容器状态

```
fnOS 桌面 → Docker 管理 → 容器
显示：容器名、状态、端口映射、资源占用
```

### 3.2 创建容器（Compose 方式）

```
fnOS 桌面 → Docker 管理 → 项目 → 新建项目
→ 输入项目名
→ 粘贴 docker-compose.yml 内容
→ 点击「创建」
```

### 3.3 容器日志

```
Docker 管理 → 容器 → 选择容器 → 日志
可实时查看，可选时间范围和行数
```

### 3.4 镜像管理

```
Docker 管理 → 镜像
- 查看所有本地镜像
- 拉取镜像（搜索并下载）
- 删除未使用镜像
```

### 3.5 镜像加速器

国内拉取 Docker Hub 镜像慢时配置：
```
Docker 管理 → 注册表设置 → 镜像加速器
在 WEB UI 中添加加速器地址（具体地址请在 fnOS 官方论坛获取最新推荐）
```

---

## 四、SSH 端 Docker 命令（用户在 SSH 中执行）

### 4.1 查询类（只读）

```sh
# 容器
sudo docker ps                                     # 运行中的容器
sudo docker ps -a                                  # 所有容器（含停止）
sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 镜像
sudo docker images
sudo docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

# 系统占用摘要
sudo docker system df
sudo docker system df -v                           # 详细版

# 实时资源（快照）
sudo docker stats --no-stream
sudo docker stats --no-stream <container>

# 日志
sudo docker logs --tail 100 <container>
sudo docker logs --tail 100 -f <container>         # 实时跟踪
sudo docker logs --since 30m <container>           # 最近 30 分钟

# 容器详情
sudo docker inspect <container>
sudo docker inspect <container> | grep -A5 '"IPAddress"'
sudo docker inspect <container> | grep -A10 '"State"'
```

### 4.2 启停控制

```sh
sudo docker start <container>
sudo docker stop <container>
sudo docker restart <container>

# 停止所有运行中容器（谨慎！）
sudo docker stop $(sudo docker ps -q)
```

### 4.3 Compose 项目管理

```sh
# fnOS 应用的 compose 文件通常在此
cd /vol1/@appdata/<应用名>/

sudo docker compose up -d              # 后台启动（创建并启动）
sudo docker compose down               # 停止并移除容器（数据卷保留）
sudo docker compose pull               # 拉取最新镜像
sudo docker compose restart            # 重启所有服务
sudo docker compose logs --tail 50     # 所有服务日志
sudo docker compose ps                 # 服务状态
```

### 4.4 进入容器排查

```sh
sudo docker exec -it <container> bash   # bash 环境
sudo docker exec -it <container> sh     # 若无 bash 用 sh
sudo docker exec <container> ls /app    # 直接执行命令不进交互
```

### 4.5 清理操作

```sh
# 清理停止的容器
sudo docker container prune -f

# 清理悬空镜像（未被任何容器使用的无标签层）——相对安全
sudo docker image prune -f

# 清理所有未使用镜像（有标签但无容器使用）——影响较大，执行前确认
sudo docker image prune -a

# 清理未使用数据卷（谨慎！可能删除应用数据）
sudo docker volume prune -f

# ⚠️ 不建议随意执行：同时清理容器/镜像/网络/构建缓存
# sudo docker system prune -a
```

---

## 五、fnOS Docker 存储路径

```sh
# 查看 Docker 数据目录
sudo docker info | grep "Docker Root Dir"
# 通常为 /vol<N>/xxx/docker/ （由 fnOS 安装时配置）
```

**不要将 Docker 数据目录设置到**：
- 回收站路径（.@#local/trash）
- @appcenter 目录
- 系统目录（/usr /etc /tmp）

---

## 六、常见 Docker 问题排查

### 容器无法启动

```sh
# 查看退出日志
sudo docker logs <container>

# 查看退出码
sudo docker inspect <container> | grep -A3 '"ExitCode"'

# 退出码含义
# 0   = 正常退出（进程主动结束）
# 1   = 应用自身错误（看日志）
# 137 = OOM 被系统杀死（内存不足：free -h 检查）
# 139 = 段错误（程序 bug）
# 143 = 收到 SIGTERM 正常退出
# 125 = docker run 自身失败（配置问题）
```

### 端口冲突

```sh
ss -tlnp | grep <端口号>    # 查看端口占用进程
```

### 镜像拉取失败

```sh
# 测试 Docker Hub 连通
curl -v --max-time 10 https://registry-1.docker.io/v2/

# 解决：配置镜像加速器（见第三节 3.5）
```

### 容器网络不通

```sh
# 查看容器 IP
sudo docker inspect <container> | grep '"IPAddress"'

# 从容器内测试
sudo docker exec -it <container> ping 8.8.8.8
sudo docker exec -it <container> nslookup baidu.com

# 查看容器使用的网络
sudo docker network ls
sudo docker inspect <container> | grep '"Networks"' -A 10
```

### Docker 占用空间大

```sh
sudo docker system df -v           # 找出占用大户
sudo docker image prune -f         # 清理悬空镜像
sudo docker container prune -f     # 清理停止容器
# 注意：volume prune 可能删应用数据，执行前确认
```

---

## 七、常用 docker-compose.yml 模板

Hermes Agent 自身的 compose 结构（仅供参考）：

```yaml
version: "3.8"
services:
  hermes-agent:
    image: hermes-agent:latest
    container_name: hermes-agent
    restart: unless-stopped
    ports:
      - "8642:8642"
    volumes:
      - /vol1/@appdata/hermes-agent:/data
    environment:
      - TZ=Asia/Shanghai
```

**重要**：挂载路径用 `/vol1/@appdata/<appname>/` 而非硬编码路径，保证升级后数据保留。

---
---

# 第二部分：.fpk 应用开发规范

---

## 一、.fpk 本质与打包结构

`.fpk` 是 fnOS 私有应用包格式，本质是带固定目录结构的 `tar.gz`，由 `fnpack` 工具打包发布。

```
<appname>.fpk（解包后结构）
├── manifest              ← 应用元数据（INI 格式，非 JSON）
├── cmd/                  ← 生命周期脚本（必须有执行权限 chmod +x）
│   ├── install           ← 安装
│   ├── uninstall         ← 卸载
│   ├── start             ← 启动
│   ├── stop              ← 停止
│   ├── status            ← 状态（返回 0=运行，3=停止）
│   └── preupgrade        ← 升级前钩子（可选）
├── config/
│   ├── privilege         ← 权限声明（JSON 格式）
│   └── resource          ← 资源声明（JSON 格式，可选）
├── wizard/               ← 安装向导（可选）
└── ui/                   ← 桌面图标（可选）
    ├── config
    └── images/
        ├── ICON.PNG       ← 64×64
        └── ICON_256.PNG   ← 256×256
```

---

## 二、manifest（INI 格式）

```ini
appname         = hermes-agent
version         = 1.0.0
display_name    = Hermes Agent
description     = AI 智能 NAS 管家，专为 fnOS 设计
developer       = Ali
arch            = x64
port            = 8642
category        = tools
icon            = ui/images/ICON.PNG
icon256         = ui/images/ICON_256.PNG
main            = cmd/main
```

**格式规则**：
- INI 格式，不是 JSON
- `key = value`，等号两侧有空格，key 列宽 16 字符对齐
- `appname`：小写字母、数字、连字符，全局唯一
- `arch`：`x64` / `arm64` / `x64 arm64`（多架构）
- `version`：语义化版本（如 1.0.0）

**必填字段**：`appname`、`version`、`display_name`、`description`、`developer`、`arch`、`main`

---

## 三、权限声明（config/privilege）

```json
{
  "defaults": {
    "run-as": "package"
  },
  "username": "hermes-agent",
  "groupname": "hermes-agent",
  "join-groups": []
}
```

- `run-as: "package"`：以应用专属用户运行（推荐，隔离最佳）
- `username`：= appname，无 @ 前缀
- `join-groups`：需要额外权限时填写，如 `["docker"]` 可获得 docker 命令权限

---

## 四、生命周期脚本

### install

```bash
#!/bin/bash
set -e

APP_DIR="${TRIM_APPDEST:-/var/apps/hermes-agent/target}"
DATA_DIR="${TRIM_PKGVAR:-/vol1/@appdata/hermes-agent}"

# 复制二进制文件
mkdir -p "$APP_DIR/bin" "$APP_DIR/run"
cp bin/hermes-agent "$APP_DIR/bin/"
chmod +x "$APP_DIR/bin/hermes-agent"

# 全新安装时初始化数据目录（升级时跳过，保留用户数据）
if [ ! -f "$DATA_DIR/config/config.yaml" ]; then
    mkdir -p "$DATA_DIR/config" "$DATA_DIR/data" "$DATA_DIR/logs"
    cp config/config.yaml.tpl "$DATA_DIR/config/config.yaml"
fi

exit 0
```

### start

```bash
#!/bin/bash
APP_DIR="${TRIM_APPDEST:-/var/apps/hermes-agent/target}"
DATA_DIR="${TRIM_PKGVAR:-/vol1/@appdata/hermes-agent}"
PID_FILE="$APP_DIR/run/hermes-agent.pid"

# 防重复启动
if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
    echo "Already running"; exit 0
fi

nohup "$APP_DIR/bin/hermes-agent" \
    --config "$DATA_DIR/config/config.yaml" \
    --data   "$DATA_DIR/data" \
    --log    "$DATA_DIR/logs/hermes-agent.log" \
    > /dev/null 2>&1 &

echo $! > "$PID_FILE"
sleep 1
kill -0 "$(cat $PID_FILE)" 2>/dev/null || { echo "Start failed"; rm -f "$PID_FILE"; exit 1; }
exit 0
```

### stop

```bash
#!/bin/bash
PID_FILE="${TRIM_APPDEST:-/var/apps/hermes-agent/target}/run/hermes-agent.pid"
[ -f "$PID_FILE" ] || exit 0

PID=$(cat "$PID_FILE")
kill -TERM "$PID" 2>/dev/null || true

# 最多等 10 秒优雅退出
for i in $(seq 1 10); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
done

# 仍在运行则强杀
kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
exit 0
```

### status

```bash
#!/bin/bash
# fnOS 标准：0=运行中，3=未运行
PID_FILE="${TRIM_APPDEST:-/var/apps/hermes-agent/target}/run/hermes-agent.pid"
[ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null && exit 0
exit 3
```

### preupgrade

```bash
#!/bin/bash
DATA_DIR="${TRIM_PKGVAR:-/vol1/@appdata/hermes-agent}"
BAK_DIR="${DATA_DIR}/tmp/hermes-agent-upgrade-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BAK_DIR"
cp -r "$DATA_DIR/config" "$BAK_DIR/" 2>/dev/null || true
echo "$BAK_DIR" > "${DATA_DIR}/tmp/hermes-agent-last-backup"
echo "升级前备份完成：$BAK_DIR"
exit 0
```

**脚本规范**：
- 所有脚本必须 `chmod +x`，否则安装失败
- 路径使用 `$TRIM_APPDEST` / `$TRIM_PKGVAR`，不硬编码
- `status` 必须严格返回 0 或 3（fnOS 通过此判断应用状态）

---

## 五、应用数据目录规范

数据分布在两个持久化目录：

**`$TRIM_PKGHOME/data`（`/vol1/@apphome/hermes-agent/data/`）** — 应用核心数据：

```
/vol1/@apphome/hermes-agent/data/
├── config.yaml                 主配置（LLM API Key、provider 等）
├── .env                        API Key 等敏感配置
├── SOUL.md / AGENTS.md         系统提示词
├── USER.md                     用户偏好记忆
├── skills/                     知识库
├── sessions/                    会话历史
├── workspace/                   用户工作空间
├── venv/                        Python 虚拟环境
├── memories/                    hermes 记忆文件
├── logs/                        hermes 运行日志
├── .monitor_token               Monitor API token 镜像
└── fnos-learned-YYYYMMDD.md    运行时新增知识
```

**`$TRIM_PKGVAR`（`/vol1/@appdata/hermes-agent/`）** — 运行时数据：

```
/vol1/@appdata/hermes-agent/
├── chat/                        聊天数据（sessions/, config.json）
├── tmp/                         临时文件
├── monitor.token                Monitor API 认证 token
├── hermes.log                   Monitor 日志
├── info.log                     安装/升级日志
└── *.pid                        进程 PID 文件
```

---

## 六、端口规划

| 避开端口 | 原因 |
|---|---|
| 5666、5667 | fnOS WEB UI |
| 22 | SSH |
| 445、2049 | SMB、NFS |
| 5005、5006 | WebDAV |
| 8000 | 飞牛影视 |

**Hermes Agent 建议**：`8642`（API Gateway）/ `9119`（Dashboard）/ Monitor 无 TCP 端口，仅通过 Unix socket（`$TRIM_APPDEST/hermes-agent.sock`）通信

---

## 七、fnpack 工具

```bash
# 安装 fnpack
curl -L https://developer.fnnas.com/downloads/fnpack-linux-amd64 -o fnpack
chmod +x fnpack && sudo mv fnpack /usr/local/bin/

# 创建项目骨架
fnpack create hermes-agent

# 打包（项目根目录执行）
chmod +x cmd/*        # 确保脚本有执行权限
fnpack build          # 生成 hermes-agent.fpk

# 版本查看
fnpack --version
```

---

## 八、本地安装与测试

```bash
# 上传到 NAS
scp hermes-agent.fpk admin@<NAS_IP>:/tmp/

# SSH 后安装
appcenter-cli install-local enable     # 首次需启用
appcenter-cli install-fpk /tmp/hermes-agent.fpk

# 验证安装
appcenter-cli status hermes-agent      # 应返回 0（运行中）
appcenter-cli info hermes-agent        # 查看详情

# 清理临时文件
rm /tmp/hermes-agent.fpk
```


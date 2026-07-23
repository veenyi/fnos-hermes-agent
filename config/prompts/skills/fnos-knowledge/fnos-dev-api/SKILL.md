---
name: fnos-dev-api
description: fnOS 应用开发（.fpk/Docker）与 WebSocket/HTTP API 认证签名参考
---

# fnOS 开发与 API 参考

> 涵盖：.fpk 应用开发规范 / Docker 写操作与排障 / WebSocket·HTTP API 认证签名机制

> **查询类操作请优先使用 trim-cli**：Docker 查询（`trim-cli docker image ls`、`container ls`、`stats`）、文件操作（`trim-cli file ls`、`file search`）、存储查询（`trim-cli storage pools`）、系统监控（`trim-cli monitor cpu/memory`）、应用中心（`trim-cli app list`）等已由官方 trim-cli 覆盖，本文不再重复。

---

# 第一部分：.fpk 应用开发规范

> 官方文档入口：<https://developer.fnnas.com/docs/guide/>

## 一、.fpk 本质与打包结构

`.fpk` 是 fnOS 私有应用包格式，本质是带固定目录结构的 `tar.gz`，由 `fnpack` 工具打包发布。

**打包前项目结构**（fnpack 生成骨架）：

```
<appname>/
├── manifest              ← 应用元数据（INI 格式，无扩展名）
├── ICON.PNG              ← 应用图标 64×64
├── ICON_256.PNG          ← 应用图标 256×256
├── app/                  ← 应用运行文件
│   ├── ui/               ← 桌面入口与静态资源（desktop_uidir 指向）
│   │   ├── config        ← 入口配置（JSON）
│   │   └── images/       ← 图标文件
│   └── docker/           ← Docker 模板（仅 Docker 应用）
│       └── docker-compose.yaml
├── cmd/                  ← 生命周期脚本（必须有执行权限 chmod +x）
│   ├── main              ← 运行控制（case start/stop/status）
│   ├── install_init      ← 安装文件应用前
│   ├── install_callback  ← 安装文件应用后
│   ├── upgrade_init      ← 升级前
│   ├── upgrade_callback  ← 升级后
│   ├── uninstall_init    ← 卸载前
│   ├── uninstall_callback← 卸载清理后
│   ├── config_init       ← 配置变更应用前
│   └── config_callback   ← 配置变更应用后
├── config/
│   ├── privilege         ← 权限声明（JSON）
│   └── resource          ← 资源声明（JSON）
└── wizard/               ← 用户向导（JSON，可选）
    ├── install
    ├── upgrade
    ├── uninstall
    └── config
```

> 参考：<https://developer.fnnas.com/docs/cli/fnpack/>、<https://developer.fnnas.com/docs/core-concepts/framework/>

## 二、manifest 字段

manifest 是 INI 格式纯文本文件，放在应用包根目录，无扩展名。

> **本仓库实际格式**：`key = value`（等号两侧有空格，key 列宽对齐）。官方示例使用 `key=value`（无空格）。两种写法均可工作，建议保持与已有项目一致的风格。

**字段总表**（来源 <https://developer.fnnas.com/docs/core-concepts/manifest/>）：

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `appname` | ✅ | 应用唯一标识，小写字母+数字+连字符 |
| `version` | ✅ | 语义化版本，如 `1.0.0` 或 `0.18.0-720` |
| `display_name` | ✅ | 显示名称（可带引号） |
| `desc` | ✅ | 应用描述，支持 HTML 内容（可带引号） |
| `source` | ✅ | 应用来源，第三方应用固定为 `thirdparty` |
| `platform` | ✅ | 硬件架构：`x86` / `arm` / `all` |
| `maintainer` | — | 开发者或团队名称 |
| `maintainer_url` | — | 开发者网站 |
| `distributor` | — | 发布者名称（与开发者不同时填写） |
| `distributor_url` | — | 发布者网站 |
| `service_port` | — | 应用服务端口 |
| `checkport` | — | 启动前是否检查端口（默认 `true`） |
| `ctl_stop` | — | 是否显示启停控制（`true`/`false`） |
| `os_min_version` | — | 支持的最低 fnOS 版本 |
| `os_max_version` | — | 支持的最高 fnOS 版本 |
| `install_type` | — | 安装目标：空=用户选择存储位置，`root`=系统分区 |
| `install_dep_apps` | — | 依赖应用（`:` 分隔，`>` 指定最低版本） |
| `desktop_uidir` | — | UI 目录（相对应用目录，默认 `ui`） |
| `desktop_applaunchname` | — | 多入口时指定应用卡片默认入口 ID |
| `changelog` | — | 更新说明 |
| `disable_authorization_path` | — | 隐藏授权目录设置（`true`/`false`） |

**⚠️ 官方不存在的字段**（旧文档误载）：~~icon~~、~~icon256~~、~~main~~、~~category~~、~~description~~（改用 `desc`）、~~developer~~（改用 `maintainer`）、~~arch~~（改用 `platform`）、~~port~~（改用 `service_port`）。

**本仓库 manifest 实例**：

```ini
appname               = hermes-agent
version               = 0.18.0-720
install_dep_apps      = nodejs
display_name          = "Hermes Agent"
desc                  = "Hermes Agent 开源 AI Agent..."
platform              = all
source                = thirdparty
maintainer            = "Nous Research"
maintainer_url        = https://github.com/NousResearch/hermes-agent
distributor           = bbis
distributor_url       = https://github.com/iranee/fnos-hermes-agent
desktop_uidir         = ui
desktop_applaunchname = hermes-agent.Application
micro_app             = true
checksum              =
```

> 注：`platform = all` 表示同时支持 x86 和 ARM（仅当包内不含架构特定二进制时使用）。本仓库通过依赖 `nodejs` 获取运行时，自身无原生二进制，因此使用 `all`。

## 三、安装后目录结构与 Symlink

安装后 fnOS 在 `/var/apps/{appname}` 下创建如下结构（来源 <https://developer.fnnas.com/docs/core-concepts/framework/>）：

```
/var/apps/{appname}/
├── cmd/                ← 生命周期脚本
├── config/             ← privilege + resource
├── manifest
├── ICON.PNG / ICON_256.PNG
├── target -> /vol{n}/@appcenter/{appname}   ← 应用运行文件（TRIM_APPDEST）
├── etc    -> /vol{n}/@appconf/{appname}     ← 配置（TRIM_PKGETC）
├── var    -> /vol{n}/@appdata/{appname}     ← 运行数据（TRIM_PKGVAR）
├── tmp    -> /vol{n}/@apptemp/{appname}     ← 临时文件（TRIM_PKGTMP）
├── home   -> /vol{n}/@apphome/{appname}     ← 用户数据（TRIM_PKGHOME）
├── meta                                      ← 元数据（TRIM_PKGMETA）
├── shares/             ← data-share 声明的共享目录
└── wizard/             ← 向导文件
```

> **重要**：脚本中必须使用环境变量引用路径，不可硬编码。

## 四、生命周期脚本

> 参考：<https://developer.fnnas.com/docs/core-concepts/framework/>

| 脚本 | 调用时机 |
|------|----------|
| `install_init` | 安装文件应用前 |
| `install_callback` | 安装文件应用后 |
| `main` | 处理 start / stop / status |
| `upgrade_init` | 升级前 |
| `upgrade_callback` | 升级后 |
| `uninstall_init` | 卸载前 |
| `uninstall_callback` | 卸载清理后 |
| `config_init` | 配置变更应用前 |
| `config_callback` | 配置变更应用后 |

**cmd/main 标准模板**：

```bash
#!/bin/bash
case "$1" in
  start)
    # 启动应用服务
    exit 0
    ;;
  stop)
    # 停止应用服务
    exit 0
    ;;
  status)
    # 返回 0=运行中，3=未运行
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
```

**退出码**：
- `0`：成功，或在 `status` 中表示正在运行
- `1`：失败
- `3`：在 `status` 中表示未运行

**TRIM_TEMP_LOGFILE 错误报告**：生命周期脚本失败时，将用户可见错误信息写入该文件，然后以非零状态退出：

```bash
if [ ! -f "$TRIM_PKGETC/config.conf" ]; then
  echo "Missing configuration file." > "$TRIM_TEMP_LOGFILE"
  exit 1
fi
```

**幂等要求**：脚本应具备可重复执行能力。安装、升级和配置流程都可能被重新执行。

## 五、环境变量完整参考

> 来源：<https://developer.fnnas.com/docs/core-concepts/environment-variables/>

### 应用信息

| 变量 | 说明 |
|------|------|
| `TRIM_APPNAME` | 来自 manifest.appname |
| `TRIM_APPVER` | 当前应用版本 |
| `TRIM_OLD_APPVER` | 升级过程中的旧版本 |
| `TRIM_APP_STATUS` | 当前操作：INSTALL/START/UPGRADE/UNINSTALL/STOP/CONFIG |

### 应用路径

| 变量 | 说明 | Symlink 目标 |
|------|------|-------------|
| `TRIM_APPDEST` | target 目录（应用运行文件） | `/vol{n}/@appcenter/{appname}` |
| `TRIM_PKGETC` | 配置目录 | `/vol{n}/@appconf/{appname}` |
| `TRIM_PKGVAR` | 运行数据目录 | `/vol{n}/@appdata/{appname}` |
| `TRIM_PKGTMP` | 临时目录 | `/vol{n}/@apptemp/{appname}` |
| `TRIM_PKGHOME` | 用户数据目录 | `/vol{n}/@apphome/{appname}` |
| `TRIM_PKGMETA` | 元数据目录 | — |
| `TRIM_APPDEST_VOL` | 应用安装所在存储空间路径 | — |

### 用户和权限上下文

| 变量 | 说明 |
|------|------|
| `TRIM_USERNAME` | 专用应用用户 |
| `TRIM_GROUPNAME` | 专用应用用户组 |
| `TRIM_UID` | 应用用户 ID |
| `TRIM_GID` | 应用用户组 ID |
| `TRIM_RUN_USERNAME` | 当前执行脚本的用户 |
| `TRIM_RUN_GROUPNAME` | 当前执行脚本的用户组 |
| `TRIM_RUN_UID` | 当前执行脚本的 UID |
| `TRIM_RUN_GID` | 当前执行脚本的 GID |

### 网络和资源

| 变量 | 说明 |
|------|------|
| `TRIM_SERVICE_PORT` | manifest.service_port 声明的端口 |
| `TRIM_DATA_SHARE_PATHS` | config/resource 声明的共享路径（`:` 分隔） |
| `TRIM_DATA_ACCESSIBLE_PATHS` | 用户授权的可访问路径（`:` 分隔） |

### 日志和临时文件

| 变量 | 说明 |
|------|------|
| `TRIM_TEMP_LOGFILE` | 用于输出用户可见错误信息的临时日志 |
| `TRIM_TEMP_UPGRADE_FOLDER` | 升级过程临时目录 |
| `TRIM_PKGINST_TEMP_DIR` | 安装时临时解压目录 |
| `TRIM_TEMP_TPKFILE` | 应用包解压目录 |

### 系统上下文

| 变量 | 说明 |
|------|------|
| `TRIM_SYS_VERSION` | 完整 fnOS 版本 |
| `TRIM_SYS_VERSION_MAJOR` | 系统主版本 |
| `TRIM_SYS_VERSION_MINOR` | 系统次版本 |
| `TRIM_SYS_VERSION_BUILD` | 构建号 |
| `TRIM_SYS_ARCH` | 系统 CPU 架构 |
| `TRIM_KERNEL_VERSION` | 内核版本 |
| `TRIM_SYS_MACHINE_ID` | 设备唯一标识 |
| `TRIM_SYS_LANGUAGE` | 系统语言 |

### 向导变量

向导中收集的值变成同名环境变量（无 `TRIM_` 前缀）。例如 wizard 中 `field: "db_port"` → 环境变量 `db_port`。

## 六、应用资源声明（config/resource）

> 来源：<https://developer.fnnas.com/docs/core-concepts/resource/>

### data-share（共享数据目录）

```json
{
  "data-share": {
    "shares": [
      { "name": "myapp/documents" },
      { "name": "myapp/backups" }
    ]
  }
}
```

安装时自动创建，可通过 `TRIM_DATA_SHARE_PATHS` 或 `/var/apps/{appname}/share/` 软链访问。使用 Windows ACL 权限模型。

### usr-local-linker（系统链接）

```json
{
  "usr-local-linker": {
    "bin": ["bin/myapp-cli"],
    "lib": ["lib/mylib.so"],
    "etc": ["etc/myapp.conf"]
  }
}
```

分别链接到 `/usr/local/bin/`、`/usr/local/lib/`、`/usr/local/etc/`。

### docker-project（Docker Compose 项目）

```json
{
  "docker-project": {
    "projects": [
      { "name": "myapp-stack", "path": "docker" }
    ]
  }
}
```

- `name`：Docker Compose 项目名称
- `path`：相对于 `app/` 目录，该目录应包含 `docker-compose.yaml`

## 七、统一网关与应用入口

> 来源：<https://developer.fnnas.com/docs/core-concepts/app-entry/>、<https://developer.fnnas.com/docs/core-concepts/gateway-registration/>

### 访问模型选择

| 能力 | 端口服务 | index.cgi | 统一网关 |
|------|----------|-----------|----------|
| 常驻服务 | ✅ | 不推荐 | ✅ |
| WebSocket | ✅（独立端口） | ❌ | ✅ |
| NAS 登录态 | 无关 | CGI 前校验 | 转发前校验+用户 Header |
| 路径 | `http://NAS:port/` | `/cgi/ThirdParty/{appname}/` | `/app/{appname}` |

### app/ui/config 入口配置

入口定义在 `.url` 字段下，ID 应使用 `appname.xxx` 格式：

```json
{
  ".url": {
    "myapp.main": {
      "title": "My App",
      "icon": "images/icon_{0}.png",
      "type": "iframe",
      "protocol": "",
      "gatewayPrefix": "/app/myapp",
      "gatewaySocket": "app.sock",
      "url": "/app/myapp",
      "allUsers": true
    }
  }
}
```

**字段说明**：
- `type`：`iframe`（fnOS 桌面窗口内打开）/ `url`（浏览器标签页）
- `protocol`：统一网关入口置空即可
- `gatewayPrefix`：公开路径，格式 `/app/{appname}`
- `gatewaySocket`：Socket 文件名（放在 target 目录下，即 `$TRIM_APPDEST`）
- `allUsers`：是否对所有用户可见
- `fileTypes`：注册文件打开方式时支持的扩展名列表
- `control.accessPerm`：`editable`/`readonly`/`hidden`

### 网关用户 Header

请求通过网关认证后，飞牛 fnOS 会转发用户信息：

| Header | 说明 | 示例 |
|--------|------|------|
| `X-Trim-Userid` | 当前用户 UID | `1000` |
| `X-Trim-Isadmin` | 是否管理员 | `true` / `false` |
| `X-Trim-Username` | 当前用户名 | `admin` |

## 八、用户向导（wizard/）

> 来源：<https://developer.fnnas.com/docs/core-concepts/wizard/>

向导文件为 JSON 数组，每个元素为一个步骤：

```json
[
  {
    "stepTitle": "配置",
    "items": [
      {
        "type": "text",
        "field": "wizard_port",
        "label": "服务端口",
        "initValue": "8080",
        "rules": [
          { "required": true, "message": "请输入端口" },
          { "pattern": "^[0-9]+$", "message": "仅限数字" }
        ]
      }
    ]
  }
]
```

**字段类型**：

| 类型 | 用途 |
|------|------|
| `text` | 短文本/端口/路径/用户名 |
| `password` | 密钥/令牌（不明文显示） |
| `radio` | 少量互斥选项 |
| `checkbox` | 多选项 |
| `select` | 较长互斥选项列表 |
| `switch` | 布尔开关 |
| `tips` | 只读提示文本（使用 `helpText`） |

**校验规则**：`required`、`min`/`max`（长度或数值）、`len`（固定长度）、`pattern`（正则）。

**值变环境变量**：字段 `field` 名称即为环境变量名。自定义字段建议 `wizard_` 前缀，禁用 `TRIM_` 前缀。

## 九、权限声明（config/privilege）

> 来源：<https://developer.fnnas.com/docs/core-concepts/privilege/>

```json
{
  "defaults": {
    "run-as": "package"
  },
  "username": "myapp_user",
  "groupname": "myapp_group",
  "join-groups": ["docker"]
}
```

- `run-as: "package"`：以专用应用用户运行（推荐，隔离最佳）
- `run-as: "root"`：以 root 运行（仅限需要特权准备任务的场景）
- `username` / `groupname`：可省略，fnOS 会根据 appname 自动生成
- `join-groups`：附加用户组（如 `docker`、`video`、`render`）

**Root 模式降权最佳实践**：长期运行且对外提供访问的进程应降权运行：

```bash
runuser -u "$TRIM_USERNAME" -- /var/apps/myapp/target/server/myapp
```

## 十、fnpack 工具

> 来源：<https://developer.fnnas.com/docs/cli/fnpack/>

**下载**（命名格式 `fnpack-<ver>-<os>-<arch>`）：

```bash
# 示例：Linux x86
curl -L https://developer.fnnas.com/downloads/fnpack-1.2.3-linux-amd64 -o fnpack
chmod +x fnpack && sudo mv fnpack /usr/local/bin/
fnpack --help
```

**创建项目**：

```bash
fnpack create <appname>                        # 普通应用
fnpack create <appname> --without-ui true      # 无桌面入口
fnpack create <appname> --template docker      # Docker 应用
fnpack create <appname> --template docker --without-ui true  # Docker + 无 UI
```

**打包**：

```bash
cd myapp && fnpack build                # 当前目录
fnpack build --directory <path>         # 指定其他目录
```

**打包前检查清单**（fnpack 自动校验）：

| 路径 | 要求 |
|------|------|
| `manifest` | 存在，包含必要字段 |
| `config/privilege` | 存在，合法 JSON |
| `config/resource` | 存在，合法 JSON |
| `ICON.PNG` / `ICON_256.PNG` | 存在 |
| `app/` / `cmd/` / `wizard/` | 目录存在 |
| `app/{desktop_uidir}/` | 声明 desktop_uidir 时必须存在 |

**安装测试**：
- 官方推荐：`appcenter-cli`（文档尚未上线）
- 备选：`trim-cli app install-fpk <file.fpk> --volume-id <N> --yes`

## 十一、应用依赖与运行时

> 来源：<https://developer.fnnas.com/docs/core-concepts/dependency/>、<https://developer.fnnas.com/docs/core-concepts/runtime/>、<https://developer.fnnas.com/docs/core-concepts/middleware/>

### install_dep_apps 语法

```ini
install_dep_apps=database>2.2.2:cache
```

- 多个依赖用 `:` 分隔
- `>` 声明最低版本（如 `database>2.2.2`）
- 安装顺序：**从右到左**（上例先装 cache，再装 database）
- 不递归解析嵌套依赖

### 可用运行时

| 包名 | 运行时 | PATH 前缀 |
|------|--------|-----------|
| `python312` | Python 3.12 | `/var/apps/python312/target/bin` |
| `nodejs_v22` | Node.js 22 | `/var/apps/nodejs_v22/target/bin` |
| `java-21-openjdk` | Java 21 | `/var/apps/java-21-openjdk/target/bin` |

### 可用中间件

| 包名 | 服务 | 默认端口 |
|------|------|----------|
| `redis` | Redis | 6379 |
| `minio` | MinIO | 9000 |
| `rabbitmq` | RabbitMQ | 5672 |

> 建议使用独立数据库编号/key 前缀/队列名，避免与其他应用冲突。

## 十二、端口规划

| 避开端口 | 原因 |
|---|---|
| 5666、5667 | fnOS WEB UI |
| 22 | SSH |
| 445、2049 | SMB、NFS |
| 5005、5006 | WebDAV |
| 8000 | 飞牛影视 |

---

# 第二部分：Docker 写操作与排障

> Docker 查询类命令（镜像列表、容器状态、Compose 项目等）请使用 `trim-cli docker` 子命令。
> 本部分仅补充 fnOS 特有的写操作要点与排障知识。

## 一、fnOS Docker 特点

- fnOS 内置 Docker Engine，通过「Docker 管理」WEB UI 图形化管理
- Docker 数据路径由 fnOS 统一管理，存储在某个存储卷下
- **禁止直接修改 `/etc/docker/daemon.json`**：会导致所有镜像/容器不可见（路径信息丢失）
- Docker Compose 文件通常存放在 `/vol1/@appdata/<appname>/` 下

> **Docker Compose 应用注意**：如果以 .fpk 形式发布 Docker Compose 应用，需在 `config/resource` 中声明 `docker-project` 类型（见第一部分第六节），让 fnOS 自动管理 Compose 项目生命周期。

## 二、权限说明

```
超级管理员账户：默认可 sudo docker
普通/管理员账户：需加入 docker 组
Hermes Agent（应用用户）：默认无权限
  → 获取方式：privilege 中声明 join-groups: ["docker"]，用户 WEB UI 授权
```

**引导话术**：如需通过 Hermes 直接管理 Docker 容器，请在 fnOS WEB UI 中：设置 → 应用管理 → Hermes Agent → 权限设置 → 勾选 Docker 访问。

## 三、WEB UI Docker 操作引导

| 操作 | 路径 |
|------|------|
| 查看容器状态 | Docker 管理 → 容器 |
| 创建容器（Compose） | Docker 管理 → 项目 → 新建项目 → 粘贴 yml → 创建 |
| 查看容器日志 | Docker 管理 → 容器 → 选择容器 → 日志 |
| 镜像管理 | Docker 管理 → 镜像 |
| 镜像加速器 | Docker 管理 → 注册表设置 → 镜像加速器 |

## 四、常见问题排查

### 容器无法启动

```sh
sudo docker logs <container>
sudo docker inspect <container> | grep -A3 '"ExitCode"'
# 退出码: 0=正常, 1=应用错误, 137=OOM, 139=段错误, 143=SIGTERM, 125=配置错误
```

### 端口冲突

```sh
ss -tlnp | grep <端口号>
```

### 容器网络不通

```sh
sudo docker inspect <container> | grep '"IPAddress"'
sudo docker exec -it <container> ping 8.8.8.8
```

### Docker 占用空间大

```sh
sudo docker system df -v           # 找出占用大户
sudo docker image prune -f         # 清理悬空镜像
sudo docker container prune -f     # 清理停止容器
# 注意：volume prune 可能删应用数据，执行前确认
```

## 五、存储路径注意

```sh
sudo docker info | grep "Docker Root Dir"
# 通常为 /vol<N>/xxx/docker/
```

**不要将 Docker 数据目录设置到**：回收站路径、@appcenter 目录、系统目录（/usr /etc /tmp）。

---

# 第三部分：WebSocket/HTTP API 认证签名参考

> **⚠️ fpk 应用内部访问 fnOS 功能的推荐方式**：官方推荐走统一网关（`/app/{appname}`）+ Unix Socket + 用户 Header（`X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username`），无需自行实现 WS 认证。详见第一部分第七节。
>
> **本节适用场景**：外部脚本、第三方集成工具等需要从 NAS 外部直连 WebSocket API 的情况。
>
> **数据来源声明**：以下 API 信息来自逆向工程+社区验证，非官方承诺接口，可能随 fnOS 版本变更。官方"开放 API"目前标注 coming soon。

## 一、连接信息

```
WebSocket:  wss://<NAS_HOST>:5667/websocket?type=main
HTTPS 上传: https://<NAS_HOST>:5667/upload
```

> ⚠️ **必须使用 NAS 真实内网 IP，不能用 `127.0.0.1`！**
> `127.0.0.1:5667` 是本地反代（nginx），登录请求会被静默丢弃，导致始终 errno=131089。
> NAS 使用自签名证书，SSL 验证需关闭。

## 二、用户类型与权限

| 能力 | 管理员 | 普通用户 |
|---|---|---|
| Docker / 容器管理 | ✅ | ❌ |
| 应用中心（安装/卸载） | ✅ | ❌ |
| 存储卷管理（stor.*） | ✅ | ❌（errno 4352） |
| 系统监控（appcgi.resmon.*） | ✅ | ❌（errno 4352） |
| 文件读写（file.*） | ✅ | ✅（限本人目录） |

> 可通过 `user.login` 响应中的 `admin` 字段判断当前用户是否为管理员。

## 三、认证流程（4 步）

### 步骤 1：连接 WebSocket 并获取 RSA 公钥

```python
import websockets, json, ssl
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

ws = await websockets.connect('wss://<NAS_HOST>:5667/websocket?type=main', ssl=ssl_ctx)
await ws.send(json.dumps({'req': 'util.crypto.getRSAPub', 'reqid': '<reqid>'}))
resp = json.loads(await ws.recv())
pub, si = resp['pub'], resp['si']
```

### 步骤 2：RSA+AES 加密登录数据

```python
import os, base64, random
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5, AES
from Crypto.Util.Padding import pad

key = ''.join(random.choice('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') for _ in range(32))
iv  = os.urandom(16)

# RSA 加密 AES 密钥
rsa_encrypted = base64.b64encode(PKCS1_v1_5.new(RSA.import_key(pub)).encrypt(key.encode())).decode()

# AES-CBC 加密登录 JSON
login_json = json.dumps({
    "req": "user.login", "reqid": "<reqid>",
    "user": "<USERNAME>", "password": "<PASSWORD>",
    "deviceType": "Browser", "deviceName": "Windows-Google Chrome",
    "stay": False, "si": si
}, separators=(',', ':'))
aes_encrypted = base64.b64encode(AES.new(key.encode(), AES.MODE_CBC, iv).encrypt(pad(login_json.encode(), AES.block_size))).decode()

await ws.send(json.dumps({'req':'encrypted','iv':base64.b64encode(iv).decode(),'rsa':rsa_encrypted,'aes':aes_encrypted}, separators=(',',':')))
login_resp = json.loads(await ws.recv())
```

### 步骤 3：解析登录响应

```python
token   = login_resp['token']    # HTTP 上传用
secret  = login_resp['secret']   # AES 加密的签名密钥
backId  = login_resp['backId']   # 后续签名用
uid     = login_resp['uid']
admin   = login_resp['admin']
```

### 步骤 4：AES 解密 secret 得到 HMAC 密钥

```python
from Crypto.Util.Padding import unpad
aes_cipher = AES.new(key.encode(), AES.MODE_CBC, iv)
secret_b64   = base64.b64encode(unpad(aes_cipher.decrypt(base64.b64decode(secret)), AES.block_size)).decode()
secret_bytes = base64.b64decode(secret_b64)  # HMAC 签名密钥原始字节
```

## 四、签名机制

登录后所有请求（白名单除外）都需要 HMAC-SHA256 签名：

```python
import hmac, hashlib, time

_index = 1
def get_reqid(backId='0000000000000000'):
    global _index
    t = format(int(time.time()), 'x').zfill(8)
    e = format(_index, 'x').zfill(4)
    _index += 1
    return f"{t}{backId}{e}"

def sign(data: dict, secret_bytes: bytes, backId: str) -> str:
    data = dict(data)
    data['reqid'] = get_reqid(backId)
    json_str = json.dumps(data, separators=(',', ':'))
    sig = base64.b64encode(hmac.new(secret_bytes, json_str.encode(), hashlib.sha256).digest()).decode()
    return sig + json_str
```

**无需签名**：`encrypted`、`util.getSI`、`util.crypto.getRSAPub`

**reqid 格式**：`{timestamp_hex_8位}{backId_16位}{index_hex_4位}`

## 五、HTTPS 文件上传

```python
import requests
upload_name = checkUpload_resp['uploadName']
trim_path = f"{folder}/{upload_name}"
sig = base64.b64encode(hmac.new(secret_bytes, trim_path.encode(), hashlib.sha256).digest()).decode()

headers = {
    'Trim-Token': token,
    'Trim-Path':  trim_path,
    'Trim-Sign':  sig,
    'Trim-Overwrite': '2',
    'Trim-Mtim': str(int(os.path.getmtime(local_path))),
}
r = requests.post(f'https://<NAS_HOST>:5667/upload', headers=headers,
    files={"trim-upload-file": (filename, open(local_path,'rb'), "application/octet-stream")}, verify=False)
```

## 六、路径格式

```
vol{stor_id}/{uid}/{子路径}
```

| stor_id | 存储 |
|---------|------|
| 1 | SSD |
| 2 | HDD |

uid 从 `user.info` → `userInfo.uid` 获取。

## 七、心跳

```python
# 每 60 秒发送一次，服务端不回复 pong
await ws.send(json.dumps({"req": "ping"}))
```

## 八、错误码速查

| errno | 说明 |
|-------|------|
| 4096 | 系统内部错误 |
| 4097 | 系统繁忙 |
| 4098 | 内存不足 |
| 4099 | 磁盘空间不足 |
| 4100 | 文件或目录不存在 |
| 4101 | 无效的文件名或路径 |
| 4102 | 文件或目录已存在 |
| 4103 | 存储空间不存在或未挂载 |
| 4104 | 文件名或路径长度超限 |
| 4105 | 目的路径是目录 |
| 4112 | 目的路径不是目录 |
| 4121 | 文件系统只读 |
| 4128 | I/O 错误 |
| 4208 | 数据库读写错误 |
| 4224 | 没有登录 |
| 4352 | 权限不足 |
| 4386 | 可用容量不足 |
| 8192 | 参数错误 |
| 65534 | 验签失败 |
| 65535 | 未知错误 |
| 100000001 | 操作太频繁 |
| 100000002 | 参数错误 |
| 100000003 | 重复的请求 |
| 100000004 | 无效的操作 |
| 100000006 | 服务器开小差 |
| 131072 | 用户名或密码错误 |
| 131073 | 用户名不存在 |
| 131074 | 用户名已存在 |
| 131329 | 用户群组不存在 |
| 131330 | 用户群组已存在 |
| 135168 | 无效的凭证 |
| 139264 | 不能对当前登录用户执行该操作 |
| 196608 | 磁盘繁忙 |
| 196609 | 磁盘数量不足 |
| 196624 | 存储池当前状态不允许该操作 |
| 327681 | 无可用存储空间 |
| 327685 | 目标目录是源目录的子目录 |
| 2031616 | 检查更新失败 |
| 2031620 | 已是最新版本 |
| 2031621 | 执行更新脚本出错 |
| 2031632 | 正在更新中 |
| 33554944 | 端口号已被占用 |
| 33554945 | 系统预留端口号 |
| 52428823 | 连接失败，请确认容器是否已启动 |

## 九、API 清单总表

> 以下为 fnOS WebSocket API 按功能分类。标记【需管理员】的接口普通用户调用返回 errno 4352。

### 文件存储（file.*）

| API | 说明 |
|-----|------|
| file.ls | 列出目录文件 |
| file.lsDir | 列出目录详情 |
| file.mkdir | 创建目录 |
| file.rm | 删除文件/文件夹 |
| file.mv | 移动/重命名 |
| file.cp | 复制文件 |
| file.rename | 重命名 |
| file.chown | 修改所有者 |
| file.getAcl / file.setAcl | ACL 读写 |
| file.access | 测试访问权限 |
| file.prop / file.size / file.calc | 属性/大小/计算 |
| file.checkUpload | 上传第 1 步 |
| file.download | 下载 |
| file.compress / file.extract | 压缩/解压 |
| file.share.add/del/info/list/listOthers | 共享目录管理 |
| file.trash.list/restore/clear | 回收站 |
| file.fav.list/add/del | 收藏 |
| file.recent.list/add/del/clear | 最近访问 |

### 存储管理（stor.*）【需管理员】

| API | 说明 |
|-----|------|
| stor.listStor / stor.state | 存储卷列表/状态 |
| stor.listDisk / stor.diskHealth / stor.diskSmart | 磁盘/健康/SMART |
| stor.create / stor.stop / stor.mount / stor.umount | 创建/停止/挂载/卸载 |
| stor.addDisk / stor.removeDisk / stor.replaceDisk | 磁盘增删换 |
| stor.extend / stor.resize | 扩展/调整 |
| stor.format / stor.eject | 格式化/弹出 |
| stor.getUserStorage | 用户存储（✅ 普通用户可用） |

### 用户管理（user.*）

| API | 说明 | 权限 |
|-----|------|------|
| user.login / user.logout / user.tokenLogin | 认证 | ✅ |
| user.info / user.isAdmin | 用户信息 | ✅ |
| user.list / user.add / user.del / user.mod | 用户管理 | 需管理员 |
| user.groupList / groupAdd / groupDel / groupMod | 用户组 | 需管理员 |
| user.changePassword | 修改密码 | ✅ |
| user.listLoginDevice / user.kickLoginDevice | 登录设备 | ✅ |

### 系统监控（appcgi.resmon.*）

| API | 说明 |
|-----|------|
| appcgi.resmon.gen | 系统状态总览 |
| appcgi.resmon.cpu / mem / disk / net | CPU/内存/磁盘IO/网卡 |
| appcgi.resmon.gpu / npu / battery / sysFan | GPU/NPU/UPS/风扇 |
| appcgi.resmon.proc.list / proc.signal | 进程列表/信号 |

### 网络管理（appcgi.network.*）

| API | 说明 |
|-----|------|
| appcgi.network.net.list / info / state | 网卡列表/详情/状态 |
| appcgi.network.net.set / add / del | 网卡配置【需管理员】 |
| appcgi.network.ssh.status / switch / set | SSH 管理 |
| appcgi.network.hostname | 主机名 |
| appcgi.netsvr.ddns.record.* | DDNS 管理 |
| appcgi.netsvr.conn.* | 外网连接 |
| appcgi.netsvr.cert.* | 证书管理 |

### 系统信息（appcgi.sysinfo.*）

| API | 说明 |
|-----|------|
| appcgi.sysinfo.getTrimVersion / getTrimMachineType | 版本/机器类型 |
| appcgi.sysinfo.getHardwareInfo / getMachineId | 硬件/ID |
| appcgi.sysinfo.getHostName / getUptime | 主机名/运行时间 |
| appcgi.sysinfo.getTimeSetting / setTimeSetting | 时间管理 |
| appcgi.sysinfo.getFanMode / setFanMode | 风扇模式 |
| appcgi.sysinfo.*PowerPlan* | 电源计划 |

### 其他常用 API

| API | 说明 |
|-----|------|
| appcgi.finder.fileSearch / trashSearch | 文件/回收站搜索 |
| appcgi.filestor.getSysPartInfo | 系统盘信息 |
| appcgi.dockermgr.* | Docker 管理（详见 trim-cli docker） |
| appcgi.share.smb/webdav/ftp/nfs/dlna.* | 共享服务【需管理员】 |
| appcgi.backup.* | 备份管理 |
| appcgi.mountmgr.* | 远程挂载 |
| notify.list / unreadTotal / setRead / del | 通知 |
| power.poweroff / power.reboot | 关机/重启 |
| liveupdate.check / status / update | 在线更新 |

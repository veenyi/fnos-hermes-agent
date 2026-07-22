# dockermgr 模块

## 模块概述
Docker 管理模块，涵盖 Docker 镜像、容器、网络、Compose 项目和 Docker 守护进程生命周期操作。

## 模块约定
- 镜像、容器、网络、Compose 和系统级端点分组管理。
- 区分列表/查询端点和长时间运行的变更端点。
- 命名空间说明：历史文档使用 `appcgi.dockermgr.*`，部分代码使用 `dockermgr.*`（如 `dockermgr.containerList`）。自动化调用时优先使用 `appcgi.dockermgr.*`。

## 任务路由

先判断是观察类还是变更类：

| 用户意图 | 优先命令 | 说明 |
| --- | --- | --- |
| 看 Docker 总体状态 | `trim-cli docker stats` | 适合作为进入 Docker 模块的只读探测 |
| 看镜像 | `trim-cli docker image ls` / `inspect` | 需要镜像详情时再下钻 inspect |
| 拉镜像 | `trim-cli docker image pull <imageRef>` | 长耗时操作，执行后应重新确认状态 |
| 看容器 | `trim-cli docker container ls` / `inspect` / `stats` / `top` | 先观察状态，再决定启停或删除 |
| 启停、重启、强杀、删除容器 | `start/stop/restart/kill/rm` | 变更前建议先 inspect 或 ls |
| 看 Compose 项目 | `trim-cli docker compose ls` | 目前优先作为只读入口 |

## 常见误判

- `docker stats` 是聚合统计，不是单容器统计
- `image pull`、`container stop`、`container restart` 这类操作可能明显长于普通读请求
- `container rm` 默认需要确认；`--force` 和 `--yes` 不是同一个概念
- 镜像引用和容器 ID 不是同一类标识，不要混传

## 高风险提醒

- 变更前先跑一条只读命令确认目标是否存在、当前状态是否符合预期
- 长耗时操作后要补一条只读命令确认结果，不要只看启动消息
- 删除类操作不应和不相关的镜像或容器清理打包在同一轮里
- 如果用户只说“把 Docker 弄一下”这类模糊目标，应先停下来确认是镜像、容器、网络还是 Compose

## 端点索引
- 镜像：
  - `appcgi.dockermgr.imageList`
  - `appcgi.dockermgr.imagePull`
  - `appcgi.dockermgr.imageInspect`
  - `appcgi.dockermgr.imageRemove`
  - `appcgi.dockermgr.imageDownloadList`（未实现）
  - `appcgi.dockermgr.imageLoad`（未实现）
  - `appcgi.dockermgr.imageSave`（未实现）
  - `appcgi.dockermgr.imageUpgrade`（未实现）
  - `appcgi.dockermgr.imageCancel`（未实现）
- 容器：
  - `appcgi.dockermgr.containerList`
  - `appcgi.dockermgr.containerCreate`
  - `appcgi.dockermgr.containerInspect`
  - `appcgi.dockermgr.containerTop`
  - `appcgi.dockermgr.containerStats`
  - `appcgi.dockermgr.containerStart`
  - `appcgi.dockermgr.containerStop`
  - `appcgi.dockermgr.containerRestart`
  - `appcgi.dockermgr.containerKill`
  - `appcgi.dockermgr.containerRemove`
  - `appcgi.dockermgr.containerModify`（未实现）
- 网络（均未实现）：
  - `appcgi.dockermgr.networkCreate`
  - `appcgi.dockermgr.networkList`
  - `appcgi.dockermgr.networkRemove`
  - `appcgi.dockermgr.networkConnect`
  - `appcgi.dockermgr.networkDisconnect`
- 系统和 Compose：
  - `appcgi.dockermgr.stats`
  - `appcgi.dockermgr.composeList`
  - `appcgi.dockermgr.systemStart`（未实现）
  - `appcgi.dockermgr.systemStop`（未实现）
  - `appcgi.dockermgr.systemRestart`（未实现）
  - `appcgi.dockermgr.composeContainers`（未实现）
  - `appcgi.dockermgr.composeCreate`（未实现）
  - `appcgi.dockermgr.composeStart`（未实现）
  - `appcgi.dockermgr.composeStop`（未实现）

## 端点详情

### appcgi.dockermgr.containerList

#### Endpoint
`appcgi.dockermgr.containerList`

#### Purpose
列出 Docker 容器及其运行时摘要信息。

#### Trim CLI Mapping
```
trim-cli docker container ls
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.dockermgr.containerList` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | array / object | 容器列表 | 格式可能因 Docker 版本而异 | `[{"name":"nginx","state":"running"}]` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | 错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | | `docker not running` |

#### Protocol Notes
- 签名请求（当 session secret 可用时）。
- 历史名称别名：`dockermgr.containerList`。

### appcgi.dockermgr.stats

#### Endpoint
`appcgi.dockermgr.stats`

#### Purpose
返回 Docker 聚合统计信息。

#### Trim CLI Mapping
```
trim-cli docker stats
```

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | object | 聚合统计 | 包含利用率指标 | `{"cpu":12.5,"mem":47.1}` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |

#### Field Semantics
- 聚合摘要端点；单容器指标使用 `containerStats`。

### appcgi.dockermgr.image.* 家族

#### Endpoint
`appcgi.dockermgr.imageList`、`imagePull`、`imageInspect`、`imageRemove`

#### Purpose
管理 Docker 镜像（列表/拉取/检查/删除）。

#### Trim CLI Mapping
```
trim-cli docker image ls
trim-cli docker image pull <imageRef>
trim-cli docker image inspect <imageRef>
trim-cli docker image rm <imageRef> [--force] [--yes]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | 对应具体操作 | `appcgi.dockermgr.imageList` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `fromImage` | body | conditional | string | 镜像名（imagePull） | 不含 tag 部分 | `nginx` |
| `tag` | body | conditional | string | 镜像标签（imagePull） | 未指定时默认 `latest` | `latest` |
| `imageId` | body | conditional | string | 镜像 ID 或引用（inspect/rm） | 可以是后端 ID 或如 `nginx:latest` | `nginx:latest` |
| `force` | body | no | boolean | 强制删除（imageRemove） | 仅 `--force` 时发送 | `true` |

#### Field Semantics
- `imagePull` 分割 `<imageRef>` 为 `fromImage` 和 `tag`；保留 registry 端口，如 `registry:5000/ns/app:1.0` → `fromImage="registry:5000/ns/app"`, `tag="1.0"`。
- `imageRemove` 默认要求确认，`--yes` 跳过确认。
- Pull/upgrade 可能是长时间运行的操作。

### appcgi.dockermgr.container.* 变更/详情家族

#### Endpoint
容器创建、生命周期和观察端点

#### Purpose
容器创建、启动/停止/重启/强杀/删除、检查、进程列表和统计。

#### Trim CLI Mapping
```
trim-cli docker container create --image <imageRef> [--name <name>] [--start] [--restart] [--memory <mb>] [--cpu <shares>] [--env <key=value>] [--cmd <arg>] [--port <host:container[/proto]>] [--mount <source:target[:ro|rw]>]
trim-cli docker container inspect <containerId>
trim-cli docker container top <containerId>
trim-cli docker container stats <containerId>
trim-cli docker container start <containerId>
trim-cli docker container stop <containerId>
trim-cli docker container restart <containerId>
trim-cli docker container kill <containerId>
trim-cli docker container rm <containerId> [--force] [--yes]
```

#### Field Semantics

**containerCreate：**
- `--image` 必填，映射到请求中的镜像引用
- `--name` 可选容器名
- `--start` 映射到 `startWhenCreated: true`
- `--restart` 映射到 `restart: true`
- `--memory <mb>` 将 MB 转换为字节（如 `128` → `134217728`）
- `--cpu <shares>` 转发正整数 CPU shares
- `--env <key=value>` 可重复，映射到 `env[]`
- `--cmd <arg>` 可重复，映射到 `cmd[]`
- `--port <host:container[/proto]>` 可重复，映射到 `port[]`；协议默认 `tcp`
- `--mount <source:target[:ro|rw]>` 可重复，映射到 `mount[]`；权限默认 `rw`
- 默认值：`restart=false`、`privileged=false`、`net=['bridge']`、`cpu=0`、`memory=0`

**containerCreate 成功响应**可能为顶层 `rsp` 对象（Docker 风格大写 key，如 `{"Id":"abcd","Warnings":[]}`），而不是嵌套在 `data.rsp` 中。

**containerInspect/top/stats/start/stop/restart/kill：** 通过 `containerId` 标识。

**containerRemove：** 通过 `containerId` 标识；`force` 仅在 `--force` 时发送；默认要求确认，`--yes` 跳过。

#### Errors
- 常见错误：容器不存在、无效状态转换、权限不足。

### appcgi.dockermgr.composeList

#### Endpoint
`appcgi.dockermgr.composeList`

#### Purpose
列出 Docker Compose 项目。

#### Trim CLI Mapping
```
trim-cli docker compose ls
```

## 注意事项
- 镜像拉取/升级和 Compose 操作是长时间运行的，可能涉及进度/取消模式。
- Docker 守护进程的启动/停止/重启是高影响操作，可能影响运行中的容器。
- 部分端点的详细请求/响应 schema 尚未完全规范化。

# resmon 模块

## 模块概述
资源监控模块，涵盖 CPU、内存、网络、GPU、磁盘、电池、系统风扇和进程/服务视图。

## 模块约定
- 区分聚合指标（`gen`）和分类指标（`cpu`、`mem` 等）。
- 端点使用 `appcgi.resmon.*` 命名空间。

## 端点索引
- 已实现：
  - `appcgi.resmon.cpu`
  - `appcgi.resmon.mem`
- 未实现：
  - `appcgi.resmon.gen`（聚合指标）
  - `appcgi.resmon.net`（网络）
  - `appcgi.resmon.gpu`（GPU）
  - `appcgi.resmon.disk`（磁盘）
  - `appcgi.resmon.battery`（电池）
  - `appcgi.resmon.sysFan`（系统风扇）
  - `appcgi.resmon.proc.signal`（进程信号）
  - `appcgi.resmon.proc.srv`（服务列表）
  - `appcgi.resmon.proc.list`（进程列表）

## 端点详情

### appcgi.resmon.cpu

#### Endpoint
`appcgi.resmon.cpu`

#### Purpose
返回 CPU 监控指标。

#### Trim CLI Mapping
```
trim-cli monitor cpu
```

CLI 行为：
- 复用 session 恢复流程。
- 将端点返回数据以 JSON 格式打印。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `appcgi.resmon.cpu` | `appcgi.resmon.cpu` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | object | CPU 指标数据 | CLI 直接打印此对象 | `{"usage":37,"cores":4}` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | 错误码 | 失败时出现 | `5001` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `monitor backend unavailable` |

#### Protocol Notes
- 使用签名请求（当 session secret 可用时）。
- 签名格式遵循 `_conventions.md` 中定义的规范。

#### Field Semantics
- 返回数据结构由后端定义，CLI 不做字段重映射。

#### Errors
- 后端错误通过统一格式化器输出到 stderr，包含 errno。
- 命令以非零退出码退出。

### appcgi.resmon.mem

#### Endpoint
`appcgi.resmon.mem`

#### Purpose
返回内存监控指标。

#### Trim CLI Mapping
```
trim-cli monitor memory
```

CLI 行为：
- 复用 session 恢复流程。
- 将端点返回数据以 JSON 格式打印。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `appcgi.resmon.mem` | `appcgi.resmon.mem` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | object | 内存指标数据 | CLI 直接打印此对象 | `{"total":1024,"used":768}` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | 错误码 | 失败时出现 | `5001` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `monitor backend unavailable` |

#### Protocol Notes
- 使用签名请求（当 session secret 可用时）。
- 签名格式遵循 `_conventions.md` 中定义的规范。

#### Field Semantics
- 返回数据结构由后端定义，CLI 不做字段重映射。

#### Errors
- 后端错误通过统一格式化器输出到 stderr，包含 errno。
- 命令以非零退出码退出。

## 注意事项
- 未实现的监控端点（网络、GPU、磁盘等）在后端可能可用，但 trim-cli 尚未暴露对应命令。

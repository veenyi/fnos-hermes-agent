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
  - `appcgi.resmon.gen`（聚合指标）
  - `appcgi.resmon.net`（网络）
  - `appcgi.resmon.disk`（磁盘）
  - `appcgi.resmon.gpu`（GPU）
  - `appcgi.resmon.npu`（NPU）
  - `appcgi.resmon.proc.info`（进程详情）
  - `appcgi.resmon.proc.list`（进程列表）
  - `appcgi.resmon.proc.srv`（服务列表）
  - `appcgi.resmon.sysWarn`（系统告警）
  - `appcgi.resmon.battery`（电池）
  - `appcgi.resmon.sysFan`（系统风扇）
  - `appcgi.resmon.alert.getSupportedBeepEvents`（支持的蜂鸣器事件）
  - `appcgi.resmon.alert.getBeepEvents`（已配置蜂鸣器事件）
  - `appcgi.resmon.alert.getBeepReasons`（蜂鸣器触发原因）
  - `appcgi.resmon.alert.muteBeeper`（静音蜂鸣器）
  - `appcgi.resmon.*` 泛化请求（通过 `monitor request`）
- 未实现：
  - 无独立命令的写操作端点；如需调用，使用 `monitor request` 并确认风险。

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

### 其他只读端点

以下端点均复用已保存 session，执行签名请求，并打印响应 `data` 对象。

| CLI 命令 | Endpoint | Request 参数 | 用途 |
| --- | --- | --- | --- |
| `trim-cli monitor gen --item storeSpeed,netSpeed` | `appcgi.resmon.gen` | `item`: 字符串数组；可重复传 `--item` 或用逗号分隔 | 聚合指标查询 |
| `trim-cli monitor net` | `appcgi.resmon.net` | 无 | 网络指标 |
| `trim-cli monitor disk` | `appcgi.resmon.disk` | 无 | 磁盘指标 |
| `trim-cli monitor gpu` | `appcgi.resmon.gpu` | 无 | GPU 指标 |
| `trim-cli monitor npu` | `appcgi.resmon.npu` | 无 | NPU 指标 |
| `trim-cli monitor proc-info --pids 123,456` | `appcgi.resmon.proc.info` | `pids`: 正整数数组 | 指定进程详情 |
| `trim-cli monitor proc-list` | `appcgi.resmon.proc.list` | 可选 `uid`: 非负整数 | 进程列表 |
| `trim-cli monitor proc-srv` | `appcgi.resmon.proc.srv` | 无 | 服务视图 |
| `trim-cli monitor sys-warn` | `appcgi.resmon.sysWarn` | 无 | 系统告警 |
| `trim-cli monitor battery` | `appcgi.resmon.battery` | 无 | 电池状态 |
| `trim-cli monitor sys-fan` | `appcgi.resmon.sysFan` | 无 | 系统风扇 |
| `trim-cli monitor beep-supported` | `appcgi.resmon.alert.getSupportedBeepEvents` | 无 | 可支持蜂鸣器事件 |
| `trim-cli monitor beep-events` | `appcgi.resmon.alert.getBeepEvents` | 无 | 已配置蜂鸣器事件 |
| `trim-cli monitor beep-reasons` | `appcgi.resmon.alert.getBeepReasons` | 无 | 当前或历史触发原因 |

参数约束：
- `--item` 空值会被忽略；最终至少需要一个有效 item。
- `--pids` 只接受正整数，重复 PID 会自动去重。
- `--uid` 只接受非负整数；未传时查询默认进程列表。

### 写操作和泛化请求

| CLI 命令 | Endpoint | Request 参数 | 风险控制 |
| --- | --- | --- | --- |
| `trim-cli monitor mute-beeper` | `appcgi.resmon.alert.muteBeeper` | 无 | 默认需要确认；可用 `--yes` 跳过 |
| `trim-cli monitor request appcgi.resmon.* --json '<object>'` | 用户指定的 `appcgi.resmon.*` 端点 | JSON 对象，不能包含 `req` 或 `reqid` | 默认需要确认；可用 `--yes` 跳过 |

泛化请求约束：
- endpoint 必须以 `appcgi.resmon.` 开头。
- `--json` 必须是 JSON object。
- `req` 和 `reqid` 由 CLI 生成，用户 JSON 中禁止提供这两个字段。
- `monitor request` 是泛化入口，不区分读写端点，默认统一要求确认。

## 注意事项
- 读取型命令不会修改设备状态。
- 写操作或泛化 request 在自动化场景中使用 `--yes` 前，应先明确 endpoint 语义和 JSON 内容。

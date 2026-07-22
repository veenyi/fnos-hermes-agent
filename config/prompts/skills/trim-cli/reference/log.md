# log 模块

## 模块概述
日志中心模块，涵盖日志查询、模块枚举、日志清除、导出和归档策略管理。

## 模块约定
- 操作日志、审计日志和日志服务控制应区分处理。
- 当前 trim-cli 实现的端点属于 `appcgi.eventlogger.common.*` 命名空间。

## 端点索引
- 已实现：
  - `appcgi.eventlogger.common.list`
  - `appcgi.eventlogger.common.moduleList`
  - `appcgi.eventlogger.common.clear`
  - `appcgi.eventlogger.common.export`
  - `appcgi.eventlogger.common.archive`（设置归档策略）
  - `appcgi.eventlogger.common.archive.get`（查询归档策略）
- 未实现：
  - `log.*`（旧版日志查询家族）
  - `appcgi.eventlogger.debuglog.*`（调试日志复制）

## 端点详情

### appcgi.eventlogger.common.list

#### Endpoint
`appcgi.eventlogger.common.list`

#### Purpose
按页查询日志中心记录，支持按级别和模块过滤。

#### Trim CLI Mapping
```
trim-cli logger list [--page <n>] [--page-size <n>] [--level <n>] [--module <n>] [--locale <locale>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.eventlogger.common.list` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `pageSize` | body | no | number | 每页条数 | 正整数 | `50` |
| `page` | body | no | number | 页码 | 正整数 | `1` |
| `level` | body | no | number | 日志级别过滤 | 数值型级别标识 | `3` |
| `module` | body | no | number | 日志模块过滤 | 数值型模块标识 | `1` |
| `locale` | body | no | string | 语言/区域 | 影响返回文本的语言 | `zh-CN` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | object | 日志数据 | 包含日志条目和分页信息 | `{...}` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | 错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `invalid filter` |

### appcgi.eventlogger.common.moduleList

#### Endpoint
`appcgi.eventlogger.common.moduleList`

#### Purpose
列出可用的日志模块。

#### Trim CLI Mapping
```
trim-cli logger modules [--locale <locale>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.eventlogger.common.moduleList` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `locale` | body | no | string | 语言/区域 | 影响模块名称的语言 | `zh-CN` |

### appcgi.eventlogger.common.clear

#### Endpoint
`appcgi.eventlogger.common.clear`

#### Purpose
按日志级别和模块清空日志记录。

#### Trim CLI Mapping
```
trim-cli logger clear --level <level> --module <module>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.eventlogger.common.clear` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `level` | body | yes | number | 日志级别 | 必填 | `3` |
| `module` | body | yes | number | 日志模块 | 必填 | `1` |

### appcgi.eventlogger.common.export

#### Endpoint
`appcgi.eventlogger.common.export`

#### Purpose
按日志级别和模块导出日志记录。

#### Trim CLI Mapping
```
trim-cli logger export --level <level> --module <module> [--locale <locale>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.eventlogger.common.export` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `level` | body | yes | number | 日志级别 | 必填 | `3` |
| `module` | body | yes | number | 日志模块 | 必填 | `1` |
| `locale` | body | no | string | 语言/区域 | 影响导出内容的语言 | `zh-CN` |

### appcgi.eventlogger.common.archive

#### Endpoint
`appcgi.eventlogger.common.archive`

#### Purpose
设置日志归档策略。

#### Trim CLI Mapping
```
trim-cli logger archive set --switch <0|1> --file-path <path> [--size-gt <n>] [--date-unit <n>] [--date-before <n>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.eventlogger.common.archive` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `switch` | body | yes | number | 归档开关 | `0` 关闭，`1` 开启 | `1` |
| `filePath` | body | yes | string | 归档文件路径 | 禁用归档时可传空字符串 | `/vol1/logs` |
| `sizeGt` | body | no | number | 文件大小阈值 | 可选 | `1024` |
| `dateUnit` | body | no | number | 日期单位 | `0` 天，`1` 周，`2` 月，`3` 年 | `2` |
| `dateBefore` | body | no | number | 日期偏移量 | 可选 | `3` |

#### Field Semantics
- `switch` 为 `0` 时表示关闭归档，此时 `filePath` 可传空字符串。
- `dateUnit` 定义时间粒度：`0` 天、`1` 周、`2` 月、`3` 年。

### appcgi.eventlogger.common.archive.get

#### Endpoint
`appcgi.eventlogger.common.archive.get`

#### Purpose
查询当前日志归档配置。

#### Trim CLI Mapping
```
trim-cli logger archive query
```

#### Protocol Notes
- 响应包含当前归档配置，CLI 直接打印后端返回的 payload。
- 响应中 `validPath` 字段（如存在）表示路径有效性状态。

## 注意事项
- 旧版 `log.*` 家族端点和当前 `appcgi.eventlogger.common.*` 端点可能在不同固件版本上共存。
- 调试日志复制功能（`debuglog.*`）尚未实现。

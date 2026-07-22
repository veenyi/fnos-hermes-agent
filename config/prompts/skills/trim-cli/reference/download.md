# download 模块

## 模块概述
下载中心模块，映射到 `appcgi.downloadcenter.*` 命名空间。支持通过 URL/磁力链接/种子文件创建下载任务，以及任务查询、控制和统计。

下载中心请求使用与其他 CGI 调用相同的 `{ req, reqid, ...params }` 格式，但部分端点通过 `data.rsp`、`data.body` 或 `data.block.data` 返回业务数据。

## 协议模型

### 请求模型

典型请求格式：

```json
{
  "reqid": "250318103000ABCDEF0123456789ABCD",
  "req": "appcgi.downloadcenter.task.query",
  "init_flag": true,
  "state_filter": 65535
}
```

注意事项：
- 部分参数在 API 层使用 camelCase（如 `initFlag`），但 CGI 层使用 snake_case（如 `init_flag`）
- 多数端点接受可选 `uid` 参数
- `task.addUris` 的 `save_dir` 在实际使用中是���需的

### 响应模型

响应数据可能嵌套在不同位置：

```json
{
  "reqid": "...",
  "result": "succ",
  "req": "appcgi.downloadcenter.task.query",
  "data": {
    "block": {
      "id": "20260318160514HlEnuPgC19HGBlXP",
      "total_size": 41653,
      "offset": 0,
      "data": "{\"tasks\":[],\"stats\":{}}"
    }
  }
}
```

业务数据可能位于 `data.rsp`、`data.body` 或 `data.block.data`（JSON 字符串需解码）。

### 终态和错误处理

终态值：`succ`、`fail`、`cancel`

处理规则：
- 传输完成和业务成功是独立关注点
- 保留 `errno`、`errmsg` 和 `extra`
- 部分控制类端点成功时返回简单的 `"ok"`
- 部分端点返回 `{ code: 200, body: {} }` 格式
- 批量创建端点可能返回 `errs[]`（即使请求本身成功）

### 大块传输

- 单包不超过 1 MiB
- 大载荷使用相同 `reqid` 分块传输
- 响应包含 `block.id`、`block.total_size`、`block.offset`、`block.data`

## 端点索引

### 查询类（已实现）
- `appcgi.downloadcenter.task.query` — 任务列表和统计
- `appcgi.downloadcenter.task.search` — 关键字搜索
- `appcgi.downloadcenter.task.getInfo` — 任务详情
- `appcgi.downloadcenter.task.getFiles` — 任务文件列表

### 创建类（已实现）
- `appcgi.downloadcenter.task.addUris` — 从 URL/磁力链接创建
- `appcgi.downloadcenter.task.addPaths` — 从 NAS 上的种子文件创建

### 控制类（已实现）
- `appcgi.downloadcenter.task.pause` — 暂停任务
- `appcgi.downloadcenter.task.resume` — 恢复任务
- `appcgi.downloadcenter.task.retry` — 重试任务
- `appcgi.downloadcenter.task.delete` — 删除任务

### 统计类（已实现）
- `appcgi.downloadcenter.stat.all` — 汇总统计

### 未实现
- 创建类：`task.addUploadFile`、`task.addfnShareLink`、`task.getfnShareLinkStatus`
- 控制类：`task.pin`、`task.setForceStart`、`task.setFilePriority`、`task.exportTorrentFile`、`task.setDownloadLimit`、`task.setUploadLimit`、`task.setShareLimit`
- 配置类：`config.getDefaultSaveDir`、`config.setDefaultSaveDir`、`config.getTransferCfg`、`config.setTransferCfg`、`config.getNetworkCfg`、`config.setNetworkCfg`、`config.getAltCfg`、`config.setAltCfg`、`config.getListColumns`、`config.setListColumns`
- 统计类：`stat.qbittorrent`、`stat.aria2`
- Tracker 类：`task.getTrackers`、`task.addTrackers`、`task.removeTrackers`、`task.editTracker`、`tracker.query`、`tracker.insert`、`tracker.delete`
- Peer 类：`task.getPeers`、`task.addPeers`、`transfer.banPeers`
- 扫描目录：`scanDir.query`、`scanDir.insert`、`scanDir.delete`
- 工具类：`util.getDirFreeSpace`、`util.isTcpPortInUse`
- 管理员：`admin.getUsers`

## 端点详情

### appcgi.downloadcenter.task.query

#### Endpoint
`appcgi.downloadcenter.task.query`

#### Purpose
查询任务列表、聚合统计和下载引擎错误信息。

#### Trim CLI Mapping
```
trim-cli download ls
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.query` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `engine_types` | body | no | array | 引擎类型过滤 | 可选 | `[1,2]` |
| `ids` | body | no | array | 指定任务 ID | 可选 | `[42,43]` |
| `state_filter` | body | no | number | 状态过滤掩码 | CLI 默认 `65535`（所有状态） | `65535` |
| `type_filter` | body | no | number | 类型过滤 | 可选 | `1` |
| `init_flag` | body | no | boolean | 初始化标志 | CLI 默认 `true` | `true` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |

#### Response
主要响应字段（位于 `data.block.data` 解码后）：

| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `tasks` | no | array | 任务列表 | 包含任务摘要信息 | `[...]` |
| `stats` | no | object | 聚合统计 | 速度和大小统计 | `{...}` |
| `errors` | no | array | 引擎错误 | 下载引擎报告的错误 | `[...]` |

常见任务字段：`id`、`type`、`name`、`state`、`total_size`、`size`、`dl_speed`、`up_speed`、`save_dir`、`uri`、`addition_time`、`error_code`、`error_message`

### appcgi.downloadcenter.task.search

#### Endpoint
`appcgi.downloadcenter.task.search`

#### Purpose
按任务名或文件名搜索下载任务。

#### Trim CLI Mapping
```
trim-cli download ls <keyword>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.search` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `keyword` | body | yes | string | 搜索关键字 | 按任务名或文件名匹配 | `ubuntu` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |

### appcgi.downloadcenter.task.getInfo

#### Endpoint
`appcgi.downloadcenter.task.getInfo`

#### Purpose
获取单个下载任务的详细信息。

#### Trim CLI Mapping
```
trim-cli download info <id>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.getInfo` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `id` | body | yes | number | 任务 ID | 正整数 | `42` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |

#### Response
主要响应字段（位于 `body` 中）：

| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `name` | no | string | 任务名称 | | `ubuntu-22.04.iso` |
| `total_size` | no | number | 总大小（bytes） | | `4194304` |
| `save_path` | no | string | 保存路径 | | `/vol1/downloads` |
| `dl_speed` | no | number | 下载速度 | | `1048576` |
| `up_speed` | no | number | 上传速度 | | `0` |
| `eta` | no | number | 预计剩余时间 | | `120` |
| `seeds` | no | number | 种子数 | | `5` |
| `peers` | no | number | 对等节点数 | | `12` |
| `share_ratio` | no | number | 分享比 | | `0.5` |
| `addition_date` | no | number | 添加时间 | | `1710000000` |
| `completion_date` | no | number | 完成时间 | | `1710100000` |

### appcgi.downloadcenter.task.getFiles

#### Endpoint
`appcgi.downloadcenter.task.getFiles`

#### Purpose
获取下载任务的文件列表，对 BT 类任务尤其有用。

#### Trim CLI Mapping
```
trim-cli download files <id>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.getFiles` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `id` | body | yes | number | 任务 ID | 正整数 | `42` |
| `mode` | body | no | number | 获取模式 | `1` 表示立即获取 | `1` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |

#### Response
主要响应字段（位于 `body[]` 中）：

| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `index` | no | number | 文件序号 | | `0` |
| `name` | no | string | 文件名 | | `readme.txt` |
| `size` | no | number | 文件大小 | | `1024` |
| `progress` | no | number | 下载进度 | | `0.75` |
| `priority` | no | number | 优先级 | `0` 不下载，`1` 正常，`7` 最高 | `1` |

### appcgi.downloadcenter.task.addUris

#### Endpoint
`appcgi.downloadcenter.task.addUris`

#### Purpose
从 URL 或磁力链接创建下载任务。

#### Trim CLI Mapping
```
trim-cli download add-uri <uri> <saveDir>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.addUris` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uris` | body | yes | string[] | URI 列表 | 支持 http/https/ftp/sftp/magnet | `["magnet:?xt=..."]` |
| `save_dir` | body | yes | string | 保存目录 | 必须为 `/vol{v}/...` 格式 | `/vol1/downloads` |
| `select_files` | body | no | array | 选择文件 | BT 类输入时有意义 | `[0,1,2]` |
| `uris_type` | body | no | number | URI 类型 | `0` 默认，`1` qBittorrent | `0` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `ids` | no | number[] | 创建的任务 ID | | `[42]` |
| `errs` | no | array | 逐项错误 | 请求成功但部分项失败时出现 | `[{"uri":"...","err":"..."}]` |

### appcgi.downloadcenter.task.addPaths

#### Endpoint
`appcgi.downloadcenter.task.addPaths`

#### Purpose
从 NAS 上已有的种子文件创建下载任务。

#### Trim CLI Mapping
```
trim-cli download add-path <path> <saveDir>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.task.addPaths` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `paths` | body | yes | string[] | 种子文件路径列表 | 必须为 `/vol{v}/...` 格式 | `["/vol1/torrents/demo.torrent"]` |
| `save_dir` | body | yes | string | 保存目录 | 必须为 `/vol{v}/...` 格式 | `/vol1/downloads` |
| `select_files` | body | no | array | 选择文件 | 可选 | `[0,1]` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `ids` | no | number[] | 创建的任务 ID | | `[43]` |
| `errs` | no | array | 逐项错误 | 请求成功但部分项失败时出现 | `[...]` |

### 控制类端点

#### appcgi.downloadcenter.task.pause / resume / retry / delete

这四个端点共享相同的请求结构。

#### Trim CLI Mapping
```
trim-cli download pause <id...>
trim-cli download resume <id...>
trim-cli download retry <id...>
trim-cli download rm <id...>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | 对应具体操作 | `appcgi.downloadcenter.task.pause` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `ids` | body | yes | number[] | 任务 ID 列表 | 支持批量操作 | `[42, 43]` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |
| `delete_files` | body | no | boolean | 是否同时删除文件 | 仅 `delete` 端点可用；CLI 默认不删除文件 | `false` |

#### Response
成功时通常返回 `"ok"`。

### appcgi.downloadcenter.stat.all

#### Endpoint
`appcgi.downloadcenter.stat.all`

#### Purpose
获取下载中心的汇总统计信息。

#### Trim CLI Mapping
```
trim-cli download stat
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.downloadcenter.stat.all` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uid` | body | no | number | 用户 ID | 可选 | `1000` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `dl_speed` | no | number | 总下载速度 | | `1048576` |
| `dl_total_size` | no | number | 总下载量 | | `10737418240` |
| `up_speed` | no | number | 总上传速度 | | `524288` |
| `up_total_size` | no | number | 总上传量 | | `5368709120` |

## 注意事项
- 文件上传（`task.addUploadFile`）需要大块传输支持，尚未实现。
- `task.addfnShareLink` 是下载中心的导入任务端点，不要与 `appcgi.sharesvr.share.link.*` 的共享链接管理端点混淆。
- 部分响应数据的具体字段结构可能因后端版本而异。

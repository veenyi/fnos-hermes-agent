# file 模块

## 模块概述
文件系统操作模块，涵盖文件列表、目录创建、删除、复制、移动、finder 搜索、共享目录/ACL 流程、传输任务、回收站、收藏夹、最近文件和团队文件操作。

## 模块约定
- 路径约束：必须使用 canonical fnOS 路径格式 `/vol{v}/...`，聚合根行为需在端点说明中明确标注。
- 列表/搜索类端点可能使用流式响应（多包），需明确标注终态判定规则。
- `file.share.*` 共享目录端点属于本模块；`appcgi.sharesvr.share.link.*` 共享链接管理属于单独的 share 模块。

## 任务路由

先按用户意图选命令，再看后面的端点详情：

| 用户意图 | 优先命令 | 说明 |
| --- | --- | --- |
| 看当前可见目录 | `trim-cli file ls` | 无参数和 `/` 都是省略 `path` 的模式 |
| 看某个具体目录 | `trim-cli file ls /vol{v}/...` | 只接受 canonical 路径 |
| 搜当前用户目录下的文件 | `trim-cli file search <key>` | CLI 会先探测再推导当前用户目录 |
| 在显式路径下搜索 | `trim-cli file search <key> /vol{v}/...` | 每个路径都必须是 canonical 路径 |
| 搜别人共享给当前用户的文件 | `trim-cli file search-others <key>` | 这是 finder 搜索，不是共享目录列表 |
| 看共享目录元数据或列表 | `file share info/list/list-others/admin-list/admin-list-others` | 共享目录与 share link 不是同一语义 |
| 看 ACL | `trim-cli file acl get <path>` | ACL 查询与共享目录状态不是同一概念 |
| 做创建、删除、复制、移动 | `file mkdir/rm/cp/mv` | 写操作默认要求具体 `/vol{v}/...` 路径 |
| 上传前检查目标路径 | `trim-cli file check-upload /vol{v}/... <size>` | 只做预检查，不上传文件内容 |
| 上传单个本地文件 | `trim-cli file upload /vol{v}/... <localFile>` | 远端参数是目录，CLI 会拼接本地文件名 |

如果还没判断清楚该走 `ls`、`search`、`search-others` 还是 `share`，先看 `workflows/file-routing.md`。

## 常见误判

- `file ls /` 不是把 `/` 直接传给后端，而是和无参数一样省略 `path`
- “当前用户目录”不是固定写死值，而是由设备返回和 session 信息共同决定
- `file share.*` 说的是共享目录，不是 share link
- `file search-others` 找的是“别人共享给我”的文件搜索结果，不是共享目录列表
- `file cp` / `file mv` 的目标参数是目标目录，不是最终文件路径

## 高风险提醒

- 写操作不要使用聚合根、相对路径或模糊路径
- 用户只给了“共享链接”这类表述时，不要直接落到 `file share.*`
- 涉及多路径搜索时，每个路径都要先确认是 `/vol{v}/...`
- 如果需求依赖“当前用户目录”，优先让 CLI 自己探测，不要手工猜 payload

## 端点索引
- 核心列表和元数据：
  - `file.ls`
  - `file.lsDir`（未实现）
  - `file.calc`（未实现）
  - `file.prop`（未实现）
  - `file.access`（未实现）
  - `file.usage`（未实现）
- 变更和传输：
  - `file.mkdir`
  - `file.rename`（未实现）
  - `file.rm`
  - `file.cp`
  - `file.mv`
  - `file.cancel`（未实现）
- 所有权和 ACL：
  - `file.chown`（未实现）
  - `file.getAcl`
  - `file.setAcl`（未实现）
- 上传/下载/压缩：
  - `file.checkUpload`
  - `file upload` CLI HTTP `/upload` flow
  - `file.download`（未实现）
  - `file.compress`（未实现）
  - `file.extract`（未实现）
  - `file.size`（未实现）
- 搜索：
  - `appcgi.finder.fileSearch`
  - `appcgi.finder.searchOtherSharing`
  - `appcgi.finder.trashSearch`（未实现）
- 共享目录：
  - `file.share.info`
  - `file.share.list`
  - `file.share.listOthers`
  - `file.share.admin.list`
  - `file.share.admin.listOthers`
  - `file.share.add2`
  - `file.share.del2`
- 收藏夹/最近文件（均未实现）：
  - `file.fav.list`、`file.fav.add`、`file.fav.del`
  - `file.recent.list`、`file.recent.add`、`file.recent.del`、`file.recent.clear`
- 回收站和团队（均未实现）：
  - `file.trash.list`、`file.trash.clear`、`file.trash.restore`
  - `file.team.lsDir`、`file.team.trash.*`

## 端点详情

### file.ls

#### Endpoint
`file.ls`

#### Purpose
列出后端默认视图或指定 canonical fnOS 路径下的文件。

#### Trim CLI Mapping
```
trim-cli file ls
trim-cli file ls /
trim-cli file ls /vol{v}/...
```

路径处理：
- 无参数或 `/` 都归一化为省略 `path` 的模式。
- 非根路径必须为 `/vol{v}/...` 格式，否则 CLI 在发送请求前拒绝。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.ls` | `file.ls` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `path` | body | no | string | 具体目录路径 | 省略时走后端默认视图；指定时必须为 `/vol{v}/...` | `/vol3/1106/test3` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `files` | no | array | 文件条目块 | 可出现在多个中间包中 | `[{"name":"Photos","dir":1}]` |
| `result` | no | string | Terminal marker | `succ`/`fail`；中间包可省略 | `succ` |
| `errno` | no | number | 错误码 | `errno: 0` 视为成功 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `path not found` |

#### Protocol Notes
- `file.ls` 可能是多包响应：非终态包携带 `files`，终态包包含 `result`、`errno` 或 `errmsg`。
- 成功判定：`result: succ` 或 `errno: 0`；`result: fail` 或非零 `errno` 为失败。
- 使用签名请求（当 session secret 可用时），格式遵循 `_conventions.md`。

#### Field Semantics
- 无参数和 `/` 都会完全省略 `path`，不是设置为 `/`。
- 目标固件如何解释省略 `path` 由设备决定；当前已验证设备会返回当前用户目录，而不是单独的 volume 列表。
- `files[].dir` 是目录标记。
- CLI 目前不暴露分页控制，流式消费直到终态包。

#### Errors
- 非法路径格式在发送请求前被拒绝，提示使用 `/vol{v}/...`。
- 后端错误通过 `errmsg`/`errno` 传播。

### file.mkdir

#### Endpoint
`file.mkdir`

#### Purpose
在指定 canonical fnOS 路径创建目录。

#### Trim CLI Mapping
```
trim-cli file mkdir /vol{v}/...
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.mkdir` | `file.mkdir` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `path` | body | yes | string | 目标目录路径 | 必须为 `/vol{v}/...` | `/vol2/1106/new-dir` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | ��误码 | 失败时出现 | `17` |
| `errmsg` | no | string | 错误描述 | | `file exists` |

#### Field Semantics
- `path` 是完整目标路径，不是父目录加名称。
- 目前不支持可选的权限参数。

### file.checkUpload

#### Endpoint
`file.checkUpload`

#### Purpose
上传文件前检查完整目标文件路径是否可用，并返回同名冲突、断点续传或最终文件名等提示。

#### Trim CLI Mapping
```
trim-cli file check-upload /vol{v}/... <size> [--overwrite skip|replace|rename]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.checkUpload` | `file.checkUpload` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `path` | body | yes | string | 完整目标文件路径 | 必须包含文件名，且为 `/vol{v}/...` | `/vol2/1106/new.jpg` |
| `size` | body | yes | number | 文件大小 | 字节数 | `12345` |
| `overwrite` | body | no | number | 同名冲突处理 | `0` skip, `1` replace, `2` rename | `2` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `skip` | no | number | 跳过提示 | 部分版本返回 | `1` |
| `uploadName` | no | string | 实际上传文件名 | 同名保留两者时可能返回新名称 | `new (1).jpg` |
| `from` | no | number | 续传起点 | 部分版本返回 | `1048576` |
| `completed` | no | number | 已完成字节数 | 部分版本返回 | `1048576` |
| `errno` | no | number | 错误码 | 失败时出现 | `4386` |
| `errmsg` | no | string | 错误描述 | | `no space left` |

#### Field Semantics
- `path` 是完整目标文件路径，不是目标目录。
- `file check-upload` 只做上传前检查，不负责传输文件内容。
- `--overwrite` 支持 `skip`、`replace`、`rename`，也可传对应数值 `0`、`1`、`2`。

### file upload CLI flow

#### Purpose
上传单个本地文件到远端目录。

#### Trim CLI Mapping
```
trim-cli file upload /vol{v}/... <localFile> [--overwrite skip|replace|rename]
```

#### Flow
1. 远端目录规范化为 `/vol{v}/...`。
2. 使用本地文件名拼出完整远端目标路径。
3. 调用 `file.checkUpload`。
4. 如果返回 `skip` 或 `completed`，直接视为成功。
5. 如果返回 `uploadName`，用该名称替换最终上传文件名。
6. 使用 HTTP `POST /upload` 上传 multipart 字段 `trim-upload-file`。

#### HTTP Headers
| Header | Required | Meaning |
| --- | --- | --- |
| `Trim-Path` | yes | URI-encoded final remote file path |
| `Trim-From` | yes | 续传起点；无续传时为 `0` |
| `Trim-Overwrite` | yes | `0` skip, `1` replace, `2` rename |
| `Trim-Mtim` | yes | 本地文件 mtime，Unix 秒 |
| `Trim-Token` | yes | 当前 session token |

### file.rm

#### Endpoint
`file.rm`

#### Purpose
删除指定 canonical fnOS 路径的文件或目录。

#### Trim CLI Mapping
```
trim-cli file rm /vol{v}/...
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.rm` | `file.rm` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `files` | body | yes | string[] | 要删除的路径列表 | CLI 当前发送单个路径 | `["/vol2/1106/old-dir"]` |

#### Field Semantics
- 后端使用 `files: string[]`，不是单个 `path` 字段。
- CLI 当前只暴露单目标删除，但后端支持数组。

### file.cp

#### Endpoint
`file.cp`

#### Purpose
将文件或目录复制到指定 canonical fnOS 目���目录。

#### Trim CLI Mapping
```
trim-cli file cp <src> <destDir>
```

`src` 和 `destDir` 必须都是 `/vol{v}/...` 格式。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.cp` | `file.cp` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `files` | body | yes | string[] | 源路径列表 | CLI 当前发送单个源路径 | `["/vol3/1106/source"]` |
| `pathTo` | body | yes | string | 目标目录路径 | 必须为 `/vol{v}/...` | `/vol4/1106/backup` |
| `overwrite` | body | yes | number | 冲突策略 | CLI 默认 `2`（保留两者/重命名） | `2` |

#### Field Semantics
- 后端使用 `files + pathTo`，不是 `src + dest`。
- `overwrite: 2` 当前作为保留两者/重命名策略。
- CLI 当前只暴露单源复制，但后端支持数组。

### file.mv

#### Endpoint
`file.mv`

#### Purpose
将文件或目录���动到指定 canonical fnOS 目标目录。

#### Trim CLI Mapping
```
trim-cli file mv <src> <destDir>
```

`src` 和 `destDir` 必须都是 `/vol{v}/...` 格式。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.mv` | `file.mv` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `files` | body | yes | string[] | 源路径列表 | CLI 当前发送单个源路径 | `["/vol4/1106/source"]` |
| `pathTo` | body | yes | string | 目标目录路径 | 必须为 `/vol{v}/...` | `/vol2/1106/archive` |
| `overwrite` | body | yes | number | 冲突策略 | CLI 默认 `2`（保留两者/重命名） | `2` |

#### Field Semantics
- 与 `file.cp` 相同的请求结构和冲突策略。

### appcgi.finder.fileSearch

#### Endpoint
`appcgi.finder.fileSearch`

#### Purpose
使用 finder 服务在一个或多个 canonical fnOS 路径下按关键字搜索文件。

#### Trim CLI Mapping
```
trim-cli file search <key> [paths...]
```

路径处理：
- 每个显式路径必须为 `/vol{v}/...` 格式，传给 finder 时去除前导斜杠。
- 未提供路径时，CLI 先做一次省略 `path` 的 `file.ls` 探测，再从返回条目的 `v` 字段推导当前用户的 `vol{v}/{uid}` 搜索根。
- 当 session 中包含 `uid` 时会在请求中包含。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.finder.fileSearch` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `key` | body | yes | string | 搜索关键字 | 不能为空 | `.txt` |
| `path` | body | yes | string[] | finder 搜索根 | 使用 `vol{v}/...` 格式（无前导斜杠） | `["vol2/1000"]` |
| `uid` | body | no | number | 当前用户 ID | 从 session 获取时包含 | `1000` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | array | 搜索结果块 | 流式包将结果放在顶层 `data` 中 | `[{"path":"/vol2/1000/a.txt"}]` |
| `result` | no | string | finder 状态 | `doing` 处理中；`succ` 完成；`fail` 失败 | `doing` |
| `errno` | no | number | 错误码 | 可终止请求 | `100000002` |
| `errmsg` | no | string | 错误描述 | | `param invalid` |

#### Protocol Notes
- Finder 搜索是多包响应。中间包可同时携带 `data` 和 `result: doing`。
- `result: doing` 不是终态。CLI 等待后续包中的非 `doing` 状态。

### appcgi.finder.searchOtherSharing

#### Endpoint
`appcgi.finder.searchOtherSharing`

#### Purpose
搜索其他用户共享给当前用户的文件。

#### Trim CLI Mapping
```
trim-cli file search-others <key>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value | `appcgi.finder.searchOtherSharing` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `key` | body | yes | string | 搜索关键字 | | `.txt` |

#### Protocol Notes
- 与 `fileSearch` 相同的 finder 终态语义。
- 中间包 `result: doing` 为非终态。
- 流式结果字段为 `files`。

### file.getAcl

#### Endpoint
`file.getAcl`

#### Purpose
返回指定 canonical fnOS 路径的 ACL 信息，可选包含文件属性数据。

#### Trim CLI Mapping
```
trim-cli file acl get <path>
trim-cli file acl get <path> --prop
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.getAcl` | `file.getAcl` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `path` | body | yes | string | 目标路径 | 必须为 `/vol{v}/...` | `/vol1/1000/docs` |
| `getProp` | body | no | boolean | 是否包含属性数据 | `--prop` 时发送 `true` | `true` |

#### Field Semantics
- `permset` 是最有用的原始 ACL/共享权限数据，CLI 原样保留。
- `getProp` 为透传标志。

### file.share.info

#### Endpoint
`file.share.info`

#### Purpose
返回指定 canonical fnOS 路径的共享目录元数据。

#### Trim CLI Mapping
```
trim-cli file share info <path>
```

### file.share.list / file.share.admin.list

#### Endpoint
`file.share.list` 和 `file.share.admin.list`

#### Purpose
列出共享目录。`list` 使用当前用户视角；`admin-list` 使用管理员视角。

#### Trim CLI Mapping
```
trim-cli file share list [uid]
trim-cli file share admin-list [uid]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | `file.share.list` 或 `file.share.admin.list` | `file.share.list` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `uid` | body | no | number | 源用户/owner ID 过滤 | 必须为正整数 | `1001` |

#### Protocol Notes
- 两个端点都是多包列表流。中间包贡献 `share[]`。

### file.share.listOthers / file.share.admin.listOthers

#### Endpoint
`file.share.listOthers` 和 `file.share.admin.listOthers`

#### Purpose
列出哪些用户拥有可见的共享目录。

#### Trim CLI Mapping
```
trim-cli file share list-others
trim-cli file share admin-list-others
```

### file.share.add2

#### Endpoint
`file.share.add2`

#### Purpose
将指定路径创建为共享目录，使用显式的 `permset` 权限。

#### Trim CLI Mapping
```
trim-cli file share add <path> <shareName> --permset <json> [--sub] [--acl-mode <mode>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.share.add2` | `file.share.add2` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `path` | body | yes | string | 目标路径 | 必须为 `/vol{v}/...` | `/vol1/1000/docs` |
| `shareName` | body | yes | string | 共享目录显示名 | | `docs` |
| `permset` | body | yes | array | ACL/共享权限 | 必须为 JSON 对象数组 | `[{"owner":32719,"inherit":7}]` |
| `sub` | body | no | boolean | 是否应用到子项 | `--sub` 时发送 | `true` |
| `aclMode` | body | no | number | 显式 ACL 模式 | `--acl-mode` 时发送 | `1` |

#### Field Semantics
- `permset` 原样转发，可直接复用 `file acl get` 返回的原始数据。

### file.share.del2

#### Endpoint
`file.share.del2`

#### Purpose
移除指定路径的共享目录状态。

#### Trim CLI Mapping
```
trim-cli file share del <path> [--sub] [--acl-mode <mode>]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `file.share.del2` | `file.share.del2` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69be...` |
| `path` | body | yes | string | 目标路径 | 必须为 `/vol{v}/...` | `/vol1/1000/docs` |
| `sub` | body | no | boolean | 是否应用到子项 | `--sub` 时发送 | `true` |
| `aclMode` | body | no | number | 显式 ACL 模式 | `--acl-mode` 时发送 | `1` |

## 注意事项
- 长时间运行的文件操作（如大文件复制/移动）的包终态行为可能因固件版本而异。
- ACL 和跨卷传输的完整错误码分类尚未完全确认。
- `overwrite: 2` 的具体冲突处理行为（保留两者/重命名）取决于后端实现。

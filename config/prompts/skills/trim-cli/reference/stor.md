# stor 模块

## 模块概述
存储管理模块，涵盖存储池、磁盘、SMART 操作、挂载/弹出流程、容量/空间报告和用户存储分配。

## 模块约定
- 区分可能唤醒磁盘的操作和不唤醒磁盘的操作。
- 破坏性操作和预检端点在错误说明和协议说明中明确标注。
- 存储池目标请求使用 `uuid`，不再使用旧版 `name`。

## 高风险密码验证策略
trim-cli 使用 `appcgi.usersrv.authUser` 作为高风险存储写操作的预检密码验证。

| 策略 | 命令 |
| --- | --- |
| 验证 + 转发密码 | `storage umount`、`storage create`、`storage stop`、`storage add-disk`、`storage remove-disk`、`storage replace-disk`、`storage resize` |
| 仅验证，不转发密码 | `storage extend`、`storage format`、`storage eject` |
| 仅确认，无密码验证 | `storage mount` |

## 任务路由

先按“读”还是“改”区分：

| 用户意图 | 优先命令 | 说明 |
| --- | --- | --- |
| 看存储总览 | `trim-cli storage overview` | 适合作为只读探测入口 |
| 列存储池 | `trim-cli storage pools` | 用来确认 pool uuid 或 `trim_*` 标识 |
| 列磁盘 | `trim-cli storage disks` | 用来确认纯设备名 |
| 看 SMART / 健康 | `trim-cli storage smart <disk>` / `health <disk>` | 先确认目标是磁盘，不是存储池 |
| 看可移动设备 | `trim-cli storage removable` | `format` / `eject` 前优先看 |
| 做高风险写操作 | 先看 `workflows/storage-dangerous-ops.md` | 先做只读探测，再决定是否继续 |

## 常见误判

- `mount` 不是 `stop` 的逆操作；先确认目标池当前状态
- `extend` 和 `resize` 不是同义词
- `format` / `eject` 面向可移动设备，不是普通池管理命令
- 池操作使用 uuid 或 `trim_*`，磁盘操作使用纯设备名
- `storage create` / `resize` 的 `--level` 只能用 `0`、`1`、`4`、`5`、`6`、`10`

## 高风险提醒

- 任何写操作前都应先执行 `storage pools` 和 `storage disks`
- 需要密码验证的命令在缺密码时不要继续猜测
- 只读探测结果与用户描述不一致时，应先停下来确认目标
- `format`、`stop`、`remove-disk`、`replace-disk` 这类操作影响面较大，不应跨多个目标一次性执行

## 端点索引
- 池和磁盘发现（已实现）：
  - `stor.listStor` — 列出存储池
  - `stor.listDisk` — 列出磁盘
  - `stor.general` — 存储总览
  - `stor.calcSpace` — 聚合空间
  - `stor.listRemovable` — 可移动设备
- 池生命周期（已实现）：
  - `stor.create` — 创建存储池
  - `stor.mount` — 挂载存储池
  - `stor.umount` — 卸载存储池
  - `stor.stop` — 停止/删除存储池
- 扩展和磁盘管理（已实现）：
  - `stor.addDisk` — 添加磁盘
  - `stor.removeDisk` — 移除磁盘
  - `stor.replaceDisk` — 替换磁盘
  - `stor.extend` — 扩展存储池
  - `stor.resize` — 调整存储池
- SMART 和健康（已实现）：
  - `stor.diskHealth` — 磁盘健康
  - `stor.diskSmart` — SMART 信息
- 可移动设备（已实现）：
  - `stor.format` — 格式化
  - `stor.eject` — 弹出
- 未实现：
  - `stor.state` / `stor.state2`、`stor.listFreeDisk`、`stor.getSysPartInfo`
  - `stor.delRec`、`stor.lvActive`
  - `stor.readdDisk`、`stor.removeDiskCheck`、`stor.addSpareDisk`
  - `stor.enableSmart`、`stor.runSmartTest`、`stor.abortSmartTest`
  - 配置类：`stor.getConf`、`stor.setConf`、`stor.removeWarn`、`stor.setTrashbin` 等
  - 用户存储：`stor.getUserStorage`、`stor.setUserStorage`

## 端点详情

### stor.general

#### Endpoint
`stor.general`

#### Purpose
获取存储总览信息。

#### Trim CLI Mapping
```
trim-cli storage overview
```

#### Protocol Notes
- 旧版端点名 `stor.getStorGeneral` 已弃用。

### stor.listStor

#### Endpoint
`stor.listStor`

#### Purpose
列出存储池及相关磁盘元数据。

#### Trim CLI Mapping
```
trim-cli storage pools
```

#### Protocol Notes
- 可能是多阶段响应：先返回基础池列表，后续跟进已移除磁盘/热备/缓存详情。
- 在线管理员可能收到 `{"sysNotify":"storageChanged"}` 通知，此时应刷新输出。

### stor.listDisk

#### Endpoint
`stor.listDisk`

#### Purpose
列出存储服务已知的磁盘。

#### Trim CLI Mapping
```
trim-cli storage disks
```

#### Field Semantics
- 返回的磁盘标识是 `stor.diskHealth`、`stor.diskSmart`、`stor.format` 和 `stor.eject` 使用的 canonical 磁盘名。

### stor.calcSpace

#### Endpoint
`stor.calcSpace`

#### Purpose
报告聚合的系统分区和存储分区空间使用情况。

#### Trim CLI Mapping
```
trim-cli storage space
```

### stor.listRemovable

#### Endpoint
`stor.listRemovable`

#### Purpose
列出已挂载的可移动存储设备。

#### Trim CLI Mapping
```
trim-cli storage removable
```

### stor.diskHealth / stor.diskSmart

#### Endpoint
`stor.diskHealth` 和 `stor.diskSmart`

#### Purpose
查询指定磁盘的健康指标和 SMART 详情。

#### Trim CLI Mapping
```
trim-cli storage health <disk>
trim-cli storage smart <disk>
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | `stor.diskHealth` 或 `stor.diskSmart` | `stor.diskHealth` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `disk` | body | yes | string | 磁盘设备名 | 纯设备名如 `sdb`、`nvme0n1` | `sdb` |

#### Protocol Notes
- `stor.diskSmart` 在磁盘休眠时可能返回 `diskStandby` 标记而非完整 SMART 数据。

### stor.create

#### Endpoint
`stor.create`

#### Purpose
从指定 RAID/存储级别和磁盘集创建新存储池。

#### Trim CLI Mapping
```
trim-cli storage create --level <level> --disks <disk> [--disks <disk>...] [--comment <comment>] [--fstype <fstype>] [--check-disk] [--password <password>] [--yes]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.create` | `stor.create` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `level` | body | yes | number | RAID/存储级别 | 允许 `0`、`1`、`4`、`5`、`6`、`10` | `1` |
| `disks` | body | yes | string[] | 磁盘设备名列表 | 支持重复 `--disks` 或逗号分隔，去重 | `["sdb","sdc"]` |
| `comment` | body | no | string | 池注释 | 可选 | `pool-a` |
| `fstype` | body | no | string | 文件系统类型 | 小写标识如 `ext4` | `ext4` |
| `checkDisk` | body | no | boolean | 磁盘预检 | `--check-disk` 时发送 | `true` |
| `password` | body | no | string | 密码 | 预检验证后转发 | |

#### Field Semantics
- `level` 为数值型，与后端请求契约保持一致。
- `disks` 必须是纯设备名，不接受 `/dev/sdb` 形式。

### stor.mount / stor.umount

#### Endpoint
`stor.mount` 和 `stor.umount`

#### Purpose
挂载或卸载存储池。

#### Trim CLI Mapping
```
trim-cli storage mount <uuid> [-y]
trim-cli storage umount <uuid> [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | `stor.mount` 或 `stor.umount` | `stor.mount` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uuid` | body | yes | string | 存储池 uuid | 不使用旧版 `name` | `trim_pool` |
| `password` | body | conditional | string | 密码 | 仅 `umount` 时需要 | |

#### Protocol Notes
- `storage mount` 仅确认，不做密码验证。
- `storage umount` 先验密后转发密码。
- `stor.mount` 不是 `stor.stop` 的通用撤销操作。

### stor.stop

#### Endpoint
`stor.stop`

#### Purpose
停止并删除存储池。

#### Trim CLI Mapping
```
trim-cli storage stop <uuid> [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.stop` | `stor.stop` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uuid` | body | yes | string | 存储池 uuid | | `trim_pool` |
| `password` | body | no | string | 密码 | 预检验证后转发 | |

#### Field Semantics
- `stor.stop` 是主要的"删除存储空间"操作，适用于普通池、非活跃池和缓存损坏池。

### stor.addDisk

#### Endpoint
`stor.addDisk`

#### Purpose
向存储池添加磁盘。

#### Trim CLI Mapping
```
trim-cli storage add-disk <uuid> --disks <disk> [--disks <disk>...] [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.addDisk` | `stor.addDisk` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uuid` | body | yes | string | 存储池 uuid | | `trim_pool` |
| `disks` | body | yes | string[] | 要添加的磁盘 | 支持重复或逗号分隔 | `["sdd"]` |
| `password` | body | no | string | 密码 | 预检验证后转发 | |

### stor.removeDisk

#### Endpoint
`stor.removeDisk`

#### Purpose
从存储池移除磁盘。

#### Trim CLI Mapping
```
trim-cli storage remove-disk <uuid> --disks <disk> [--password <password>] [-y]
```

### stor.replaceDisk

#### Endpoint
`stor.replaceDisk`

#### Purpose
替换存储池中的磁盘。

#### Trim CLI Mapping
```
trim-cli storage replace-disk <uuid> --disks <disk> --new-disks <disk> [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.replaceDisk` | `stor.replaceDisk` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uuid` | body | yes | string | 存储池 uuid | | `trim_pool` |
| `disks` | body | yes | string[] | 要替换的旧磁盘 | | `["sdb"]` |
| `newDisks` | body | yes | string[] | 替换用的新磁盘 | 必须与 `disks` 等长 | `["sdg"]` |
| `password` | body | yes | string | 密码 | 预检验证后转发 | |

#### Field Semantics
- `disks[i]` 和 `newDisks[i]` 形成替换对。

### stor.extend

#### Endpoint
`stor.extend`

#### Purpose
触发存储池扩展流程。

#### Trim CLI Mapping
```
trim-cli storage extend <uuid> [--password <password>] [-y]
```

#### Protocol Notes
- 仅验密，不转发密码；目标请求只包含 `uuid`。

### stor.resize

#### Endpoint
`stor.resize`

#### Purpose
调整存储池大小或重塑存储池布局。

#### Trim CLI Mapping
```
trim-cli storage resize <uuid> --disks <disk> [--vd-name <name>] [--level <level>] [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.resize` | `stor.resize` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `uuid` | body | yes | string | 存储池 uuid | | `trim_pool` |
| `disks` | body | yes | string[] | 参与调整的磁盘 | | `["sdh"]` |
| `vdName` | body | no | string | 目标虚拟设备名 | 可选 | `raidz1-0` |
| `level` | body | no | number | 目标 RAID 级别 | 允许 `0`、`1`、`4`、`5`、`6`、`10` | `5` |
| `password` | body | no | string | 密码 | 预检验证后转发 | |

### stor.format

#### Endpoint
`stor.format`

#### Purpose
格式化可移动磁盘或分区。

#### Trim CLI Mapping
```
trim-cli storage format <disk> --fstype <fstype> [--partition <no>] [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.format` | `stor.format` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `disk` | body | yes | string | 磁盘设备名 | 纯设备名 | `sdb` |
| `no` | body | yes | number | 分区号 | `0` 表示整盘 | `0` |
| `fstype` | body | yes | string | 文件系统类型 | 小写 | `ext4` |

### stor.eject

#### Endpoint
`stor.eject`

#### Purpose
安全弹出可移动磁盘。

#### Trim CLI Mapping
```
trim-cli storage eject <disk> [--password <password>] [-y]
```

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `stor.eject` | `stor.eject` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |
| `disk` | body | yes | string | 可移动磁盘设备名 | 应来自 `stor.listRemovable` 返回的标识 | `sdc` |

## 注意事项
- 存储池状态查询端点（`state` vs `state2`）的具体响应字段差异尚未完全确认。
- 部分高级端点（缓存设备操作、`stor.delRec`、`stor.lvActive` 等）尚未暴露。
- 所有通用响应都包含 `result`（`succ`/`fail`）、`errno` 和 `errmsg` 字段。

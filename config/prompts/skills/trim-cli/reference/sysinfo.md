# sysinfo 模块

## 模块概述
系统信息模块，涵盖机器标识、版本/硬件详情、主机/时间设置、风扇配置和电源计划调度。

## 模块约定
- 使用 `appcgi.sysinfo.*` 命名空间。
- 只读信息端点和配置变更端点应分开处理。

## 端点索引
- 已实现：
  - `appcgi.sysinfo.getTrimMachineType`
  - `appcgi.sysinfo.getTrimVersion`
  - `appcgi.sysinfo.getKernelVersion`
  - `appcgi.sysinfo.getHostName`
  - `appcgi.sysinfo.getMachineId`
  - `appcgi.sysinfo.getUptime`
  - `appcgi.sysinfo.getAllVolsInfo`
  - `appcgi.sysinfo.getVolsList`
  - `appcgi.sysinfo.getDockerInfo`
  - `appcgi.sysinfo.getUnixTime`
  - `appcgi.sysinfo.getBootOnPowerFlag`
  - `appcgi.sysinfo.getHardwareInfo`
  - `appcgi.sysinfo.getFirmwareChecksum`
  - `appcgi.sysinfo.getReservedPartition`
  - `appcgi.sysinfo.isTrimMachine`
  - `appcgi.sysinfo.getTrimMachineFeature`
  - `appcgi.sysinfo.getFanMode`
  - `appcgi.sysinfo.getTrimDisk`
  - `appcgi.sysinfo.getTimeSetting`
  - `appcgi.sysinfo.getTimezoneList`
  - `appcgi.sysinfo.listPowerPlan`
  - `appcgi.sysinfo.nextPowerOffTime`
  - `appcgi.sysinfo.getPowerPlanStatus`
  - `appcgi.sysinfo.getPowerOnSeconds`
  - `appcgi.sysinfo.getSystemInitedTimestamp`
  - `appcgi.sysinfo.*` 泛化请求（通过 `system request`）
- 未实现：
  - 主机/时间设置写操作：`setHostName`、`setTimeSetting`
  - 电源计划写操作：`setPowerPlanStatus`、`addPowerPlan`、`deletePowerPlan`、`modifyPowerPlan`
  - 风扇模式写操作：`setFanMode`

## 端点详情

### appcgi.sysinfo.getTrimMachineType

#### Endpoint
`appcgi.sysinfo.getTrimMachineType`

#### Purpose
返回 NAS 机器类型标识信息。

#### Trim CLI Mapping
```
trim-cli system info
```

CLI 行为：
- 不要求已保存的 session。
- 将 `response.data` 以 JSON 格式打印；如果 `data` 不存在则报错。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | Fixed value `appcgi.sysinfo.getTrimMachineType` | `appcgi.sysinfo.getTrimMachineType` |
| `reqid` | body | yes | string | Request correlation ID | Generated per request | `69ba...` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `data` | no | object | 机器类型信息 | CLI 优先提取此字段 | `{"type":"trim-xx"}` |
| `result` | no | string | Terminal marker | `succ`/`fail` | `succ` |
| `errno` | no | number | 错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

#### Protocol Notes
- 使用普通 JSON 请求。

#### Field Semantics
- 返回数据的具体字段由后端定义，可能因机型和固件版本而异。

#### Errors
- 后端错误通过统一格式化器输出。
- 缺少 `data` 时命令会以非零退出码失败。

### 其他只读端点

以下端点均为只读查询，不要求已保存 session，并打印响应 `data` 对象。

| CLI 命令 | Endpoint | Request 参数 | 用途 |
| --- | --- | --- | --- |
| `trim-cli system trim-version` | `appcgi.sysinfo.getTrimVersion` | 无 | 系统版本 |
| `trim-cli system kernel-version` | `appcgi.sysinfo.getKernelVersion` | 无 | 内核版本 |
| `trim-cli system host-name` | `appcgi.sysinfo.getHostName` | 无 | 主机名 |
| `trim-cli system machine-id` | `appcgi.sysinfo.getMachineId` | 无 | 机器 ID |
| `trim-cli system uptime` | `appcgi.sysinfo.getUptime` | 无 | 系统运行时间 |
| `trim-cli system all-vols` | `appcgi.sysinfo.getAllVolsInfo` | 无 | 全部卷信息 |
| `trim-cli system vols` | `appcgi.sysinfo.getVolsList` | 无 | 卷列表 |
| `trim-cli system docker` | `appcgi.sysinfo.getDockerInfo` | 无 | Docker 相关系统信息 |
| `trim-cli system unix-time` | `appcgi.sysinfo.getUnixTime` | 无 | 系统 Unix 时间 |
| `trim-cli system boot-on-power` | `appcgi.sysinfo.getBootOnPowerFlag` | 无 | 通电启动标记 |
| `trim-cli system hardware` | `appcgi.sysinfo.getHardwareInfo` | 无 | 硬件信息 |
| `trim-cli system firmware-checksum` | `appcgi.sysinfo.getFirmwareChecksum` | 无 | 固件校验信息 |
| `trim-cli system reserved-partition` | `appcgi.sysinfo.getReservedPartition` | 无 | 预留分区信息 |
| `trim-cli system is-trim-machine` | `appcgi.sysinfo.isTrimMachine` | 无 | 是否为 TRIM 机器 |
| `trim-cli system trim-feature` | `appcgi.sysinfo.getTrimMachineFeature` | 无 | 机器能力特性 |
| `trim-cli system fan-mode` | `appcgi.sysinfo.getFanMode` | 无 | 风扇模式 |
| `trim-cli system trim-disk` | `appcgi.sysinfo.getTrimDisk` | 无 | 系统盘/机器磁盘信息 |
| `trim-cli system time-setting --lang zh-CN` | `appcgi.sysinfo.getTimeSetting` | 可选 `lang` | 时间设置 |
| `trim-cli system timezone-list --lang zh-CN` | `appcgi.sysinfo.getTimezoneList` | 可选 `lang` | 时区列表 |
| `trim-cli system power-plan` | `appcgi.sysinfo.listPowerPlan` | 无 | 电源计划列表 |
| `trim-cli system next-power-off-time` | `appcgi.sysinfo.nextPowerOffTime` | 无 | 下一次关机时间 |
| `trim-cli system power-plan-status` | `appcgi.sysinfo.getPowerPlanStatus` | 无 | 电源计划启用状态 |
| `trim-cli system power-on-seconds` | `appcgi.sysinfo.getPowerOnSeconds` | 无 | 通电秒数 |
| `trim-cli system inited-timestamp` | `appcgi.sysinfo.getSystemInitedTimestamp` | 无 | 系统初始化时间戳 |

### 泛化请求

| CLI 命令 | Endpoint | Request 参数 | 风险控制 |
| --- | --- | --- | --- |
| `trim-cli system request appcgi.sysinfo.* --json '<object>'` | 用户指定的 `appcgi.sysinfo.*` 端点 | JSON 对象，不能包含 `req` 或 `reqid` | 默认需要确认；可用 `--yes` 跳过 |

泛化请求约束：
- endpoint 必须以 `appcgi.sysinfo.` 开头。
- `--json` 必须是 JSON object。
- `req` 和 `reqid` 由 CLI 生成，用户 JSON 中禁止提供这两个字段。
- `system request` 是泛化入口，不区分读写端点，默认统一要求确认。
- `system request` 使用已保存 session 认证；如果当前目标与保存 session 不一致，会先失败而不是匿名发送配置请求。

## 注意事项
- 返回数据的具体字段结构可能因 NAS 机型和固件版本而异。
- 当前固定子命令均为读取型查询。
- 电源计划、主机名、时间设置和风扇模式的配置端点尚未作为固定命令实现；如需调用，应通过 `system request` 并确认风险。

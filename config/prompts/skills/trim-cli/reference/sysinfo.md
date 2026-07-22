# sysinfo 模块

## 模块概述
系统信息模块，涵盖机器标识、版本/硬件详情、主机/时间设置、风扇配置和电源计划调度。

## 模块约定
- 使用 `appcgi.sysinfo.*` 命名空间。
- 只读信息端点和配置变更端点应分开处理。

## 端点索引
- 已实现：
  - `appcgi.sysinfo.getTrimMachineType`
- 未实现：
  - 核心标识/版本：`getTrimVersion`、`getHostName`、`getMachineId`、`isTrimMachine`、`getTrimDisk`、`getTrimMachineFeature`
  - 运行时和硬件：`getUptime`、`getHardwareInfo`、`getNetInfo`、`getReservedPartition`、`nextPowerOffTime`
  - 主机/时间设置：`setHostName`、`getTimeSetting`、`setTimeSetting`、`getTimezoneList`
  - 电源计划：`setPowerPlanStatus`、`getPowerPlanStatus`、`listPowerPlan`、`addPowerPlan`、`deletePowerPlan`、`modifyPowerPlan`
  - 风扇模式：`getFanMode`、`setFanMode`

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
- 复用已保存的 session。
- 将 `response.data` 以 JSON 格式打印；如果 `data` 不存在则打印原始响应。
- 当前没有其他 CLI flag 可以切换到其他 sysinfo 端点。

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
- 使用签名请求（当 session secret 可用时）。
- 签名格式遵循 `_conventions.md` 中定义的规范。
- CLI 执行此端点前会先获取 `si`，然后进行 token 恢复。

#### Field Semantics
- 返回数据的具体字段由后端定义，可能因机型和固件版本而异。

#### Errors
- 认证恢复失败时，端点不会执行，CLI 会回落到登录流程。
- 后端错误通过统一格式化器输出。

## 注意事项
- 返回数据的具体字段结构可能因 NAS 机型和固件版本而异。
- 电源计划和风扇模式的配置端点尚未实现。

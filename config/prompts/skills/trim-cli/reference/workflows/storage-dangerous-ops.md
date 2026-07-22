# 存储危险操作 workflow

这个 workflow 只服务于高风险存储写操作。目标是先做只读探测，再判断能不能继续发写请求。

## 1. 先判断是不是高风险写操作

以下命令都应先走本 workflow：

- `storage umount`
- `storage create`
- `storage stop`
- `storage add-disk`
- `storage remove-disk`
- `storage replace-disk`
- `storage resize`
- `storage extend`
- `storage format`
- `storage eject`

`storage mount` 风险较低，但仍应先确认目标池标识和当前状态。

## 2. 固定先做的只读探测

默认顺序：

1. `trim-cli storage pools`
2. `trim-cli storage disks`
3. 按目标需要补 `trim-cli storage health <disk>` 或 `trim-cli storage smart <disk>`
4. 如果是可移动设备，再看 `trim-cli storage removable`

目的：

- 确认目标到底是 pool uuid、`trim_*` 标识，还是具体磁盘名
- 确认磁盘状态、池状态、是否可移动
- 避免把磁盘操作误发到存储池，或把存储池操作误发到磁盘

## 3. 密码验证与确认矩阵

| 策略 | 命令 |
| --- | --- |
| 验证密码并转发密码 | `umount`、`create`、`stop`、`add-disk`、`remove-disk`、`replace-disk`、`resize` |
| 只验证密码，不转发密码 | `extend`、`format`、`eject` |
| 仅确认，不做密码验证 | `mount` |

如果用户没有明确给出密码，且命令属于前两类，不要假设存在默认密码。

## 4. 常见误判

- `mount` 不是 `stop` 的逆操作；先确认目标池当前状态
- `extend` 和 `resize` 不是同一件事，不要按字面随意替换
- `format` / `eject` 面向可移动设备，不是普通池操作
- 目标池要用 uuid 或 `trim_*` 形式，不要传旧版 `name`
- 目标磁盘要用纯设备名，如 `sda`、`nvme0n1`，不要传 `/dev/sda`

## 5. 什么时候必须停下来确认

- 用户目标不清楚，只说“卸载一下”或“扩一下”，没有给出具体 pool / disk
- 只读探测结果与用户描述不一致
- 命令需要密码验证，但用户没有提供密码
- 设备返回状态显示目标已停止、已卸载、不可扩容或磁盘仍在 standby / 异常状态

## 6. 下一步

- 已经确认目标和顺序：去看 [../stor.md](../stor.md)
- 仍有状态歧义：先停在只读探测阶段，不继续发写请求

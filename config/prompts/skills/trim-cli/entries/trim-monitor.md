---
name: trim-monitor
description: 查询运行态指标如 CPU、内存、网络、磁盘、进程和告警蜂鸣器状态时使用
---

# trim-monitor

## 什么时候看这个 skill

- 需要查看 CPU、内存、网络、磁盘、GPU、NPU、电池、风扇等运行态指标
- 需要查询进程列表、进程详情、服务状态或系统告警信息
- 需要查看告警蜂鸣器支持事件、已配置事件或触发原因
- 想确认某个时刻的系统压力是否属于正常范围

## 先看哪里

- 运行态指标参考：`../reference/resmon.md`
- 当前 CLI 命令集中在 `monitor` 子命令下

## 核心提醒

- 这里只负责运行中的指标，不负责描述系统身份、型号或静态配置
- `monitor cpu` / `monitor memory` 返回的是时间序列样本，理解它们需要在回复里找 `usage`、`cores` 等字段
- `monitor gen` 的 `--item` 支持逗号分隔，也可以重复传入
- `monitor proc-info --pids` 只接受正整数 PID，多个 PID 可用逗号分隔
- 大多数命令是读取型查询；`monitor mute-beeper` 和 `monitor request` 需要确认或 `--yes`
- `monitor request` 仅允许 `appcgi.resmon.*` 端点，JSON 中不要写 `req` 或 `reqid`

## 常用命令

```bash
./scripts/trim-cli monitor cpu
./scripts/trim-cli monitor memory
./scripts/trim-cli monitor net
./scripts/trim-cli monitor disk
./scripts/trim-cli monitor gen --item storeSpeed,netSpeed --item cpuBusy
./scripts/trim-cli monitor proc-list
./scripts/trim-cli monitor proc-list --uid 1000
./scripts/trim-cli monitor proc-info --pids 123,456
./scripts/trim-cli monitor proc-srv
./scripts/trim-cli monitor sys-warn
./scripts/trim-cli monitor battery
./scripts/trim-cli monitor sys-fan
./scripts/trim-cli monitor beep-supported
./scripts/trim-cli monitor beep-events
./scripts/trim-cli monitor beep-reasons
./scripts/trim-cli monitor mute-beeper
./scripts/trim-cli monitor request appcgi.resmon.gen --json '{"item":["cpuBusy"]}'
```

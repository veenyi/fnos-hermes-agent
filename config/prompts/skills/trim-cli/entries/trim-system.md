---
name: trim-system
description: 查询静态系统信息、机器类型、系统版本与身份时使用
---

# trim-system

## 什么时候看这个 skill

- 需要确认 fnOS 版本、运行环境类型、系统标识
- 要查看当前机器的型号、序列号、网络接口等静态细节
- 需要梳理系统配置与固件信息供后续调查

## 先看哪里

- 系统信息 reference：`../reference/sysinfo.md`
- 需要同时查硬件、BIOS、网络等信息时逐条调用 `system info`

## 核心提醒

- 这里只介绍静态系统信息，不包括 CPU 或 memory 运行态指标，后者由 `trim-monitor` 处理
- `system info` 输出以只读方式提供基本身份和固件版本，写操作通常不是这个 skill 的职责
- 机器类型、版本等字段会随 CLI 或 NAS 版本变化，优先以 `system info` 当前输出为准
- 遇到异常或字段为空，说明当前 CLI 与目标版本字段不一致，请以输出结果为可信来源

## 常用命令

```bash
./scripts/trim-cli system info
```

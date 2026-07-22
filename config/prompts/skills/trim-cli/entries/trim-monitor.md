---
name: trim-monitor
description: 查询运行态指标如 CPU、内存及未来的 resmon 接口时使用
---

# trim-monitor

## 什么时候看这个 skill

- 需要查看 CPU 或内存使用率、负载、瓶颈等运行态指标
- 预计后续调 resmon.* 这类监控接口的即时数据
- 想确认某个时刻的系统压力是否属于正常范围

## 先看哪里

- 运行态指标参考：`../reference/resmon.md`
- 当前 CLI 命令视图集中在 `monitor cpu` 和 `monitor memory`

## 核心提醒

- 这里只负责运行中的指标，不负责描述系统身份、型号或静态配置
- `monitor cpu` / `monitor memory` 返回的是时间序列样本，理解它们需要在回复里找 `usage`、`cores` 等字段
- resmon.* 其他接口并未全部折叠到 CLI，遇到缺失字段说明还未在 CLI 中暴露
- 查询过程对系统无写操作风险，可放心读取，不要在本层尝试干预硬件

## 常用命令

```bash
./scripts/trim-cli monitor cpu
./scripts/trim-cli monitor memory
```

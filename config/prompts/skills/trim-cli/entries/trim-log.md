---
name: trim-log
description: 处理日志列表、模块枚举、清除、导出及归档操作时使用
---

# trim-log

## 什么时候看这个 skill

- 需要浏览日志列表或用模块/级别筛选特定事件
- 要导出原始日志、清除过期日志或调整归档策略
- 需要确认哪些模块在记录日志、哪些日志已经轮转

## 先看哪里

- 查看日志模块与结构：`../reference/log.md`
- 参数空间参考签名：`logger list [--page <n>] [--page-size <n>] [--level <n>] [--module <n>] [--locale <locale>]`、`logger clear --level <level> --module <module>`、`logger archive set --switch <0|1> --file-path <path>` 等

## 核心提醒

- `level`、`module` 和 `locale` 控制命令过滤与导出粒度，务必在命令中明确填入合适值
- 旧版 `log.*` 接口与 `appcgi.eventlogger.common.*`（即 `logger` 系列）并行，请勿混用结果
- `logger export`、`logger archive set` 读取大量数据，确保目标文件/卷可写再执行
- `logger list` 可以加 `--page`、`--page-size` 先确认状态，再继续清除或归档

## 常用命令

```bash
./scripts/trim-cli logger list --page <n> --page-size <n> --level <n> --module <n> --locale <locale>
./scripts/trim-cli logger modules --locale <locale>
./scripts/trim-cli logger clear --level <level> --module <module>
./scripts/trim-cli logger export --level <level> --module <module> --locale <locale>
./scripts/trim-cli logger archive set --switch <0|1> --file-path <path> --size-gt <n> --date-unit <n> --date-before <n>
./scripts/trim-cli logger archive query
```

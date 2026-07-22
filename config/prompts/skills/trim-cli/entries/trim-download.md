---
name: trim-download
description: 涉及下载任务列表、搜索、创建、控制、统计或任务状态变更时使用
---

# trim-download

## 什么时候看这个 skill

- 需要列出所有下载任务、根据关键字查找或查看单个任务详情
- 需要查看任务包含的文件列表或下载统计数据
- 要创建下载任务（URL、磁力、种子）、修改保存目录或调整优先级
- 要暂停、恢复、重试或彻底删除某个任务
- 需要跟踪下载任务的状态变化并判断是否要重试

## 先看哪里

- download 模块参考：`../reference/download.md`
- 任务列表和控制命令参见签名 `download ls [keyword]`、`download info <id>`、`download pause <id...>` 等

## 核心提醒

- 新建任务时要配套 `download add-uri <uri> <saveDir>` 或 `download add-path <path> <saveDir>`，`<saveDir>` 仍然必须是 `/vol{n}/...`
- 统计数据通过 `download stat` 获取，命令输出不是某个单文件的条目
- 控制命令 `download pause|resume|retry|rm <id...>` 只改变已存在任务，命令不会自动补路径
- `download info` / `download files` 返回的路径字段直接映射 fnOS 卷定义，不要二次推演

## 常用命令

```bash
./scripts/trim-cli download ls
./scripts/trim-cli download ls installer
./scripts/trim-cli download info <id>
./scripts/trim-cli download files <id>
./scripts/trim-cli download add-uri https://example.com/file.iso /vol1/download
./scripts/trim-cli download add-path /vol1/source.iso /vol1/download
./scripts/trim-cli download pause <id...>
./scripts/trim-cli download resume <id...>
./scripts/trim-cli download retry <id...>
./scripts/trim-cli download rm <id...>
./scripts/trim-cli download stat
```

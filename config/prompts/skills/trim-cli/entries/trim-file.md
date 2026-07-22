---
name: trim-file
description: 当任务涉及列目录、搜索文件、共享目录、ACL、当前用户目录推导或文件路径判断时使用
---

# trim-file

## 什么时候看这个 skill

- 用户说“看文件”“列目录”“搜文件”
- 用户提到共享目录、ACL、别人共享给我的文件
- 你需要区分 `/`、当前用户目录和具体 `/vol{n}/...`

## 先看哪里

- 文件路由 workflow：`../reference/workflows/file-routing.md`
- 文件模块 reference：`../reference/file.md`

## 核心提醒

- `file ls` 和 `file ls /` 都会省略 `path`
- 写操作默认必须使用具体 `/vol{n}/...` 路径
- `file share.*` 是共享目录，不是 share link
- `file search-others` 是“别人共享给我”的文件搜索，不是共享目录列表

## 常用命令

```bash
./scripts/trim-cli file ls
./scripts/trim-cli file ls /vol1/downloads
./scripts/trim-cli file search <key>
./scripts/trim-cli file share list
./scripts/trim-cli file acl get /vol1/1000/docs
```

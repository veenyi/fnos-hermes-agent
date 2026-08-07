---
name: trim-photos
description: 当任务涉及相册目录、搜索照片、照片详情、缩略图或原图预览链接时使用
---

# trim-photos

Photos 命令复用当前 fnOS 登录 session，但会自动使用 Photos 自己的接口签名。

## 常用命令

```bash
trim-cli photos folders
trim-cli photos search IMG --limit 20
trim-cli photos search 北京 --filter file_type=photo
trim-cli photos info <photoId>
trim-cli photos preview <photoId> --size m
trim-cli photos preview <photoId> --size o --open
```

## 关键规则

- 使用前先执行普通 `login`，Photos 不需要额外登录。
- `--filter` 和 `--exclude-filter` 使用 `name=value`，可以重复传入。
- 预览尺寸支持 `xxs`、`xs`、`s`、`m`、`o`，其中 `o` 是原图。
- 返回的预览 URL 是绝对地址，但浏览器仍需有已登录 fnOS 的 cookie。
- 自然语言 AI 搜索走 `magic-search`，不是 `photos search` 的别名；AI 结果没有稳定的
  `total` 时只能报告本次返回条数。
- 未封装端点可用 `photos request`；非 GET 请求默认要求确认。
- `photos request` 必须同时检查 `httpStatus` 和 `response.code`，不能只看 CLI 退出码。

字段和通用请求方法见 `../reference/photos.md`。
统计、AI 搜索和抽样预览的完整决策链见
`../reference/workflows/photos-routing.md`。

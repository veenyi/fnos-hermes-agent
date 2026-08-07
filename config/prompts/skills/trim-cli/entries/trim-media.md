---
name: trim-media
description: 当任务涉及影视 OAuth 登录、媒体库数量、影片搜索、影片详情或投屏播放链接时使用
---

# trim-media

Media 使用独立于 fnOS 的应用 token。CLI 会用当前 profile 的 fnOS session 自动完成 OAuth，
无需打开浏览器或手工复制 cookie。

## 常用命令

```bash
trim-cli media status
trim-cli media libraries
trim-cli media stats
trim-cli media list --type movie --limit 20
trim-cli media search 流浪地球
trim-cli media info <movieGuid>
trim-cli media play <itemGuid>
```

## 关键规则

- 使用前需要有效 fnOS session；Media token 缺失或失效时，命名命令自动刷新一次 OAuth。
- `media stats` 用于精确数量；`movie` 是电影数，`total` 是全部媒体项数。
- `media list` 用于不带关键词浏览，可按媒体库、类型和页码限制返回。
- `media search` 返回的是匹配列表，没有稳定的全库匹配总数。
- `media play` 默认选择服务端返回的第一档画质，也可显式传 `--resolution` 和 `--bitrate`。
- `castUrl` 带有 Media token，适合不能设置 cookie/header 的投屏客户端，但等同 bearer 凭据。
- 未封装端点可用 `media request`；非 GET 请求默认要求确认。

字段、OAuth 和通用请求见 `../reference/media.md`。数量、搜索和播放流程见
`../reference/workflows/media-routing.md`。

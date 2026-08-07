# Media 参考

## 命令能力

| Command | Purpose |
| --- | --- |
| `media login` | 立即执行 fnOS OAuth 并安全保存 Media token |
| `media logout` | 远端登出 Media 并清除当前 profile 的 Media token |
| `media status` | 查看当前 Media 用户；必要时自动 OAuth |
| `media libraries` | 查看当前用户可访问的媒体库 |
| `media stats` | 查看电影、电视剧、视频、直播、收藏、总数和各媒体库数量 |
| `media list` | 分页列出全部或指定类型、指定媒体库的媒体项 |
| `media search <keyword>` | 搜索影片并返回媒体项列表 |
| `media info <guid>` | 查看电影详情和可播放媒体文件 |
| `media play <guid>` | 查询播放信息、选择画质并生成播放与投屏 URL |
| `media request <method> <path>` | 调用未封装的 Media JSON API |

## OAuth 与 session

Media 不直接使用 fnOS token 调业务接口。CLI 自动执行：

1. 读取 Media 系统配置中的 OAuth 应用 ID。
2. 用已保存的 fnOS token 向 NAS 请求 OAuth code。
3. 用 code 换取 Media token。
4. 把 Media token 保存到当前 profile 的平台安全 session。

普通 Media 命令发现 token 缺失时会自动执行以上流程；接口返回认证失败时会刷新并重试
一次。反复失败时停止，不循环登录。切换 NAS 或用户时应使用正确 profile，不要跨 profile
复用 session。

## 统计与搜索

```bash
trim-cli media libraries
trim-cli media stats
trim-cli media list --type movie --limit 20
trim-cli media search 科幻
```

`media stats` 输出的 `data` 常见键：

| Field | Meaning |
| --- | --- |
| `movie` | 电影数量 |
| `tv` | 电视剧数量 |
| `video` | 其他视频数量 |
| `live` | 直播频道数量 |
| `favorite` | 当前用户收藏数量 |
| `total` | 全部媒体项数量 |
| `<libraryGuid>` | 指定媒体库的媒体项数量 |

`media search` 输出 `data[]`，每项常见字段包括 `guid`、`title`、`type`、`poster`、
`posters`、`backdrops`、`vote_average`、`air_date`、`overview` 和观看状态。图片字段会通过
Media 图片端点转换为绝对地址。搜索列表长度只是当前匹配列表长度，不替代 `media stats`
的精确统计。

`media list` 输出 `data.total` 和 `data.list[]`；支持 `--type all|movie|tv|video|live`、
`--library <guid>`、`--page` 和 `--limit`。用户问“有哪些影片”时用 list，问“有多少”时用
stats。

## 详情与播放

```bash
trim-cli media info <movieGuid>
trim-cli media play <itemGuid>
trim-cli media play <itemGuid> --media-guid <fileGuid> --resolution 1080p --bitrate 8000000
trim-cli media play <itemGuid> --start 120 --open
```

`media play` 依次读取播放信息、可用画质并启动播放。未指定画质时选择服务端返回的第一项。
输出包括：

| Field | Meaning |
| --- | --- |
| `playbackUrl` | Media 起播接口返回并转为绝对地址的播放 URL |
| `castUrl` | 附带 `authorization`、`accessToken` 和随机 `Play-Link` 的免 cookie URL |
| `mediaGuid` | 实际选择的媒体文件 GUID |
| `resolution` / `bitrate` | 实际选择的画质 |
| `oauthRefreshed` | 本次流程是否刷新过 Media OAuth |

`castUrl` 等同 bearer 凭据。只在用户明确需要播放或投屏时生成，不写入文档、日志或长期
存储，不向无关第三方发送。

## Generic request

```bash
trim-cli media request get /api/v1/server/info
trim-cli media request get /api/v1/search/list --query q=科幻
trim-cli media request post /api/v1/play/info \
  --json '{"item_guid":"<guid>"}' --yes
```

路径只能是 `/api/...` 或 `/v/api/...`，不能带 origin、查询串或 fragment。非 GET 请求需要
交互确认或 `--yes`。通用请求保留原始业务信封；必须同时检查 `httpStatus` 为 2xx 且
`response.code == 0`，不能只看 CLI 退出码。

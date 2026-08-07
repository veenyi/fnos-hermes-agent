# Photos reference

## Authentication

Photos 使用当前 profile 的 fnOS session token，并自动添加 Photos API 签名。当前命令目标
必须与该 profile 保存的 session 目标一致。没有有效 session 时先执行普通 `login`；
Photos 不需要额外登录。

## Command index

| Command | Output |
| --- | --- |
| `photos folders` | 已加入相册扫描的目录、扫描状态和照片/视频数量 |
| `photos search <keyword>` | 条件搜索的匹配项、时间线和总数 |
| `photos info <id>` | 文件、拍摄、位置、标签和缩略图字段 |
| `photos preview <id>` | 指定尺寸的绝对预览地址 |
| `photos request <method> <path>` | 未封装端点的原始 HTTP 与业务响应 |

## Response rules

命名命令会检查 HTTP 状态和业务信封；HTTP 非 2xx、`code != 0` 或缺失 `data` 都会失败。
命名搜索和详情还会把相对的 `*Url` 字段转换为绝对地址。

`photos request` 用于原始端点，不应用命名命令的业务信封检查，输出固定为：

```json
{
  "httpStatus": 200,
  "response": { "code": 0, "msg": "", "data": {} }
}
```

Agent 必须同时确认 `httpStatus` 位于 `200..299` 且 `response.code == 0`。不能只根据 CLI
退出码判断通用请求成功。

## Watched folders

```bash
trim-cli photos folders
```

请求 `GET /p/api/v1/photo/folder/list`，没有业务参数。输出 `list[]` 的主要字段：

| Field | Type | Meaning |
| --- | --- | --- |
| `folderId` | integer | Photos 扫描目录 ID |
| `folderPath` | string | fnOS 目录路径 |
| `photoCount` | integer | 当前索引中的照片数量 |
| `videoCount` | integer | 当前索引中的视频数量 |
| `status` | integer | `0` 扫描中，`1` 完成，`2` 目录异常，`4` 未知 |
| `disable` | integer | 目录是否允许从扫描范围移除 |
| `hasWriteAccess.hasWriteAccess` | boolean | 当前用户是否有写权限 |
| `hasWriteAccess.quotaCurr` | integer | 当前已用配额 |
| `hasWriteAccess.quotaMax` | integer | 最大配额 |
| `isDefault` | boolean | 是否为默认扫描目录 |

目录处于扫描中时数量仍可能变化；目录异常时不要把当前计数表述为最终值。这里统计的是
Photos 索引范围，不等于文件系统中全部图片数量。

## Conditional search

```bash
trim-cli photos search IMG --limit 20
trim-cli photos search 北京 --filter file_type=photo
trim-cli photos search 北京 --exclude-filter not_geo=1
```

请求 `POST /p/api/v2/search/results`。请求字段：

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `keyword` | yes | string | 条件搜索关键词；CLI 拒绝空字符串 |
| `limit` | yes | integer | 返回样本上限，CLI 接受 `1..200`，默认 `20` |
| `filters` | yes | array | 正向 `{filterName, filterValue}` 条件 |
| `antiFilters` | no | array | 排除 `{filterName, filterValue}` 条件 |

`--filter` 和 `--exclude-filter` 使用 `name=value`，可以重复。常见过滤名包括
`file_type`、`is_collect`、`person`、`photo_tag` 和 `file_dir`。`file_type` 常见值包括
`photo`、`video`、`live_photo`、`gif`、`raw`、`360`、`panorama` 和 `screenshot`；其他过滤值
取决于设备上的 Photos 版本和索引内容。

响应主要字段：

| Field | Type | Meaning |
| --- | --- | --- |
| `list[]` | array | 当前返回的照片/视频样本 |
| `timeline[]` | array | 按 `year`、`month`、`day` 聚合的 `itemCount` |
| `total` | integer | 服务端报告的全部匹配数量，不等于 `list` 长度 |
| `list[].id` | integer | 详情和预览命令使用的照片 ID |
| `list[].category` | string | `photo` 或 `video` |
| `list[].fileName` | string | 文件名 |
| `list[].filePath` | string | fnOS 文件路径 |
| `list[].photoUUID` | string | 照片流地址使用的 UUID |
| `list[].additional.thumbnail.*Url` | string | 已转换为绝对地址的各尺寸预览字段 |

## Photo detail

```bash
trim-cli photos info <photoId>
```

请求 `GET /p/api/v1/gallery/getOne?id=<photoId>`。除搜索条目字段外，详情常见字段包括
`fileSize`、`width`、`height`、`description`、`photoDateTime`、`timeZoneOffset`、`make`、
`model`、`fumber`、`exposureTime`、`isoSpeedRatings`、`focalLength`、`latitude`、
`longitude`、`ownerId`、`ownerName`、`isCollect`、`isLive` 和标签。

## Preview

```bash
trim-cli photos preview <photoId> --size m
trim-cli photos preview <photoId> --size o --open
```

预览先读取 `gallery/getOne`，再从 `additional.thumbnail` 选择地址。尺寸支持 `xxs`、`xs`、
`s`、`m` 和 `o`；`o` 是原图。视频优先返回 `videoUrl`，缺失时回落到 `mUrl`。

输出字段包括 `id`、`fileName`、`category`、`size`、`previewUrl`、`originalUrl`、
`videoUrl` 和 `requiresAuthenticatedBrowserSession`。地址是绝对 URL，但浏览器通常仍需有
已登录 fnOS 的 cookie；不要把它描述为免登录公开链接。

## AI semantic search

先检查模型，再发起自然语言搜索：

```bash
trim-cli photos request post /api/v1/magic-search/ready --yes
trim-cli photos request post /api/v1/magic-search/do \
  --json '{"keyword":"海边日落","antiFilters":[]}' --yes
```

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /p/api/v1/magic-search/ready` | 无请求体 | `code == 0` 表示当前模型可用 |
| `POST /p/api/v1/magic-search/do` | `keyword` 必填；`antiFilters` 可选 | `data.list[]` 为本次 AI 命中 |

通用请求输出中的 AI 列表路径是 `response.data.list`。该接口没有稳定的 `total` 字段，
因此 `list` 长度只能表述为本次返回条数，不能称为全库精确总数。要提供预览时，从 AI
结果选择 `id`，再执行 `photos preview <id> --size m`；AI 原始响应中的相对 URL 不应直接
当作可访问链接。

已知业务码 `4044` 表示当前模型不支持当前语言，需要先切换模型。其他非零业务码也应
原样报告并停止，不要回退到普通文件名搜索后仍声称是 AI 结果。

## Generic request

```bash
trim-cli photos request get /api/v1/server/sys_info
trim-cli photos request get /api/v1/gallery/getOne --query id=123
trim-cli photos request post /api/v2/search/results \
  --json '{"filters":[],"keyword":"IMG","limit":5}' --yes
```

路径只能是 `/api/...` 或 `/p/api/...`，不能包含 origin、查询串或 fragment。查询参数使用
可重复的 `--query key=value`；请求体使用 JSON object 或 array。非 GET 请求需要交互确认
或显式传 `--yes`。

典型统计、AI 搜索和抽样预览流程见
[workflows/photos-routing.md](workflows/photos-routing.md)。

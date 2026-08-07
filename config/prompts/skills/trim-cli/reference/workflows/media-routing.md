# 影视任务路由 workflow

## 1. 认证

先保证当前 profile 有有效 fnOS session。Media 命令会自动完成应用 OAuth，不要向用户索取
Media token，也不要从浏览器 cookie 中复制 token。需要显式验证登录时使用：

```bash
trim-cli media status
```

## 2. 典型场景

### 场景 A：查看有多少影片

```bash
trim-cli media stats
```

用户问“有多少影片”时优先报告 `data.total`，并按需补充 `data.movie`、`data.tv` 和
`data.video`。如果用户明确说“电影”，报告 `data.movie`。不要通过搜索列表长度推算全库
数量。

### 场景 B：查看媒体库

```bash
trim-cli media libraries
trim-cli media stats
```

先用 `libraries` 获取 GUID、标题和分类，再用 `stats` 中同名 GUID 的值报告各库数量。

要列出具体影片：

```bash
trim-cli media list --type movie --limit 20
trim-cli media list --library <libraryGuid> --limit 20
```

### 场景 C：搜索影片并查看详情

```bash
trim-cli media search 科幻
trim-cli media info <guid>
```

搜索结果用于找候选项，不代表全库精确统计。需要播放时优先选择 `type` 为电影或可播放
条目的 `guid`，再查看详情或直接调用 `media play`。

### 场景 D：生成投屏链接

```bash
trim-cli media play <guid>
```

向用户返回 `castUrl`。该链接附带 Media token，可供不能设置 cookie 或 Authorization header
的接收端使用。只返回用户要求的少量链接，并提示链接敏感；不要把链接写入持久化报告。

指定文件或画质时：

```bash
trim-cli media play <guid> --media-guid <fileGuid> --resolution 1080p --bitrate 8000000
```

## 3. 停手条件

- `media stats` 没有对应统计键，却准备把搜索结果数称为精确总数。
- OAuth 自动刷新后仍返回认证失败。
- 用户没有要求播放，却准备生成含 token 的 `castUrl`。
- 通用请求的 `httpStatus` 非 2xx 或 `response.code` 非 0。

字段和通用请求细节见 [../media.md](../media.md)。真实设备差异验证见
[device-validation.md](device-validation.md)。

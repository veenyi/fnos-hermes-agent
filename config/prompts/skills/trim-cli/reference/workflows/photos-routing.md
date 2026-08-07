# 相册任务路由 workflow

这个 workflow 用于处理相册统计、条件搜索、AI 语义搜索和抽样预览。确定命令方向后，
再进入 Photos reference 查看字段。

## 1. 认证检查

Photos 复用当前 profile 的 fnOS session。没有有效 session 时先执行 `trim-cli login`。
操作多台 NAS 时应显式使用对应的 `--profile`、`--host` 和 `--port`，不要跨设备复用
session。

## 2. 典型场景

### 场景 A：查看相册扫描范围和总体规模

```bash
trim-cli photos folders
```

优先汇总各目录返回的照片数和视频数。这里统计的是已加入 Photos 扫描的目录，
不要把文件系统中的全部图片数量等同于相册索引数量。

### 场景 B：条件搜索照片并报告数量

```bash
trim-cli photos search 北京 --limit 20
trim-cli photos search IMG --filter file_type=photo --limit 20
```

使用响应中的 `total` 报告匹配总数，`list` 只是当前返回的样本。用户还要预览时，
从 `list` 选择少量代表项，再执行 `photos preview <id> --size m`，不要为了预览一次性
请求全部原图。

### 场景 C：用 AI 语义搜索自然语言描述

先检查 AI 搜索是否可用，再发起搜索：

```bash
trim-cli photos request post /api/v1/magic-search/ready --yes
trim-cli photos request post /api/v1/magic-search/do \
  --json '{"keyword":"海边日落","antiFilters":[]}' --yes
```

AI 搜索与 `photos search` 的条件搜索不是同一个端点。AI 响应通常只提供
`response.data.list`，没有稳定的 `total` 字段，因此只能报告“本次返回 N 条”。模型未
安装、未就绪或语言不匹配时，应原样说明业务错误，不要静默回退到文件名搜索后仍声称
是 AI 结果。

`photos request` 会保留原始业务信封，即使 `response.code != 0` 也可能以退出码 0 结束。
两次请求都必须检查 `httpStatus` 位于 `200..299` 且 `response.code == 0`。要给出预览时，
从 `response.data.list` 选择结果 `id`，再执行 `photos preview <id> --size m`。

### 场景 D：获取抽样预览

```bash
trim-cli photos preview <id> --size m
trim-cli photos preview <id> --size o
```

默认优先返回中等尺寸预览。只有用户明确需要原图时才使用 `--size o`。

## 3. 链接与数量语义

| 字段或结果 | 语义 | 注意事项 |
| --- | --- | --- |
| 条件搜索 `total` | 全部匹配数量 | 不等于当前 `list` 长度 |
| AI 搜索 `list` 长度 | 本次返回条数 | 没有 `total` 时不能称为精确总数 |
| Photos `previewUrl` | 缩略图、原图或视频预览 | 浏览器通常需要已登录 fnOS |

不要读取或输出安全存储中的 token，也不要绕过 CLI 对敏感 URI 的脱敏。

## 4. 什么时候必须停下来确认

- 用户要求精确总数，但接口只返回无 `total` 的 AI 结果列表。
- 用户要求可公开访问的预览链接，但浏览器没有 fnOS 登录态。
- 用户只要求预览，却准备一次性请求全部原图。
- AI 通用请求的 `httpStatus` 非 2xx 或 `response.code` 非 0。

## 5. 下一步

- Photos 字段、过滤和 AI 端点：看 [../photos.md](../photos.md)
- 需要验证真实设备差异：看 [device-validation.md](device-validation.md)

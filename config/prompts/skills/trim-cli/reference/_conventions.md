# API 文档约定

本目录包含 trim-cli 支持的 fnOS API 模块参考文档。

## 文档结构

每个模块文档包含：

1. **模块概述**：模块功能和用途
2. **模块约定**：模块级别的共享规则和注意事项
3. **端点索引**：模块包含的所有端点列表
4. **端点详情**：每个端点的完整说明
5. **注意事项**：使用中需要关注的行为差异或限制

## 端点详情格式

每个端点包含以下部分（按顺序）：

### Endpoint
端点的完整名称（如 `appcgi.file.ls`）

### Purpose
端点的功能说明

### Trim CLI Mapping
对应的 trim-cli 命令形式；如果未实现则标注 `Not implemented in trim-cli yet`

### Request
请求参数表格：

| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |

**Location 取值：**
- `body`：JSON 请求体顶层字段
- `query`：URL 查询参数
- `path`：URL 路径变量
- `header`：协议头字段
- `wrapped body`：嵌套在请求体内的字段（如 `data.body.*`）

### Response
响应字段表格：

| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |

### Protocol Notes
影响自动化的协议行为：
- 认证要求（token / session / signature）
- 数据包终止行为（`result`、多包流式响应）
- 签名格式：当 session 中存在 `secret` 且端点不在直通集合中时，使用 HMAC-SHA256 签名
- 签名载荷格式：`<base64-hmac-signature><json-body>`
- 签名密钥：session `secret` 的 base64 解码值
- 签名前会在 JSON 中注入 `si`（如可用）
- 特殊封装结构（如嵌套 `data.body`）

### Field Semantics
字段语义的详细说明和约束

### Errors
常见错误码和错误信息

## 路径约定

fnOS 文件路径使用 canonical 格式：`/vol{v}/...`

示例：
- `/vol1/downloads`
- `/vol3/1000/media`

## 通用响应信封

大多数端点响应包含以下通用字段：
- `result`：终态标记，`succ` 或 `fail`
- `errno`：数值错误码（失败时出现）
- `errmsg`：错误描述（失败时出现）

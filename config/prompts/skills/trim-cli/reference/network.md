# network 模块

## 模块概述

网络模块用于管理设备网络相关服务开关。当前 CLI 覆盖 SSH 服务开关。

## 端点索引

- 已实现：
  - `appcgi.network.ssh.switch`（开启或关闭 SSH 服务）

## appcgi.network.ssh.switch

### Endpoint

`appcgi.network.ssh.switch`

### Purpose

开启或关闭设备 SSH 服务。

### Trim CLI Mapping

```bash
trim-cli network ssh switch --enable [--yes]
trim-cli network ssh switch --disable [--yes]
```

### Request

| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | Endpoint selector | 固定值 | `appcgi.network.ssh.switch` |
| `reqid` | body | yes | string | Request correlation ID | 每次请求生成 | `69ba...` |
| `enable` | body | yes | boolean | 是否开启 SSH | `true` 开启，`false` 关闭 | `true` |

### Notes

- `--enable` 与 `--disable` 必须二选一。
- 开启 SSH 是安全敏感操作，默认需要确认；用户明确授权后才使用 `--yes`。
- 命令需要已登录 session，并通过认证链执行。

---
name: trim-shared
description: 当任务涉及登录、连接目标、session 回落、wrapper 用法、真机验证账号顺序或通用安全规则时使用
---

# trim-shared

## 什么时候看这个 skill

- 用户要登录、登出，或排查为什么连不上 NAS
- 用户没有显式给 `--host` / `--port` / `--scheme` / TLS 相关参数，需要判断 session 回落逻辑
- 用户要做真机验证
- 用户的问题跨多个模块，需要先确认通用规则

## 先看哪里

- 任务总入口：`../SKILL.md`
- 任务索引：`../reference/_index.md`
- 真机验证：`../reference/workflows/device-validation.md`

## 核心规则

- 默认连接目标是 loopback `ws://localhost:5666`
- `--scheme auto` 且未显式传 `--port` 时，loopback 默认 `ws:5666`，远程 IP 默认 `wss:5667`，远程域名默认 `wss:443`
- 显式传 `--port` 时端口优先，CLI 只解析协议选择
- 未显式传连接参数时，可回落到本地已保存 session 的 `host`、`port`、`scheme` 和 TLS 设置
- 内网或自签证书 WSS 目标可能需要显式传 `--tls-insecure`
- 远程明文 `ws://` 需要显式传 `--allow-insecure-ws`
- session 默认使用平台安全存储；只有在测试或 CI 隔离时才显式使用 `TRIM_CLI_SESSION_STORAGE=file`
- 如需在安全存储写失败时人工确认低信任降级，可显式使用 `TRIM_CLI_SESSION_STORAGE=ask-file`
- 首次执行登录或真机操作时，不要假设默认凭据
- 连接失败时，应明确提示正在尝试的 `host:port`

## 常用命令

```bash
./scripts/trim-cli --host <host> --port <port> login
./scripts/trim-cli --host <host> --scheme wss --tls-insecure login
./scripts/trim-cli --host <host> --port <port> logout
```

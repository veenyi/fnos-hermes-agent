---
name: cloudflare-tunnel
description: 将本机 Hermes Agent 服务通过 Cloudflare Tunnel 发布到公网（外网访问）。fnOS 包已内置「隧道」菜单页（Quick 临时链接 / Named 固定域名），本技能覆盖：隧道页操作指引、cloudflared 手动命令、故障排查与安全须知。When the user wants to expose the local Hermes web UI or services to the public internet, or asks about the 隧道 menu, tunnels, trycloudflare, or external access to the NAS.
license: MIT
metadata:
  tags: [cloudflare, tunnel, cloudflared, trycloudflare, 隧道, 外网访问, 公网]
---

# Cloudflare Tunnel（fnOS Hermes Agent 内置「隧道」功能）

## 项目内置能力（优先使用）

本项目（fnos-hermes-agent）已在 Web UI 左侧导航固化「隧道」菜单，无需手动装 cloudflared：

- 后端（monitor.js）：`GET /api/tunnel/status`、`POST /api/tunnel/start`、`POST /api/tunnel/stop`。cloudflared 二进制缺失时自动从 GitHub Releases（`TUNNEL_CF_VERSION=2026.7.3`，linux-amd64）下载到 `${VAR_DIR}/bin/cloudflared`（持久目录，约 50MB）；运行日志 `${VAR_DIR}/logs/tunnel.log`（每次启动轮转为 .1）；状态持久化 `${VAR_DIR}/tunnel-state.json`。
- 前端：侧边栏「隧道」→ 模式（Quick / Named）+ 转发目标下拉（Web UI 8650 / Dashboard 9219 / Gateway 8742 / 自定义端口）+ Token 输入 + 启动/停止 + 公网地址复制/打开 + 日志查看。
- **Quick 模式**：`cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:<port>`，免费无账号，从日志正则提取 `https://<rand>.trycloudflare.com`。
- **Named 模式**：`cloudflared tunnel --no-autoupdate --protocol http2 run --token <TOKEN>`，需用户先在 Cloudflare 完成 `cloudflared tunnel login` + `tunnel create` + DNS 路由，把 tunnel token 填入 UI。
- 启动前校验目标端口监听（`isPortListening`），未监听直接报错；30s 内拿不到 trycloudflare URL 判超时并清理进程。

## 用户操作指引

1. 打开 Web UI → 左侧「隧道」→ 默认 Quick 模式，转发目标选「Web UI（8650）」→ 点「启动隧道」。首次会自动下载 cloudflared（数秒~数十秒）。
2. 启动后左侧卡片出现 `https://xxx.trycloudflare.com` 公网地址，点「复制」/「打开」即可外网访问。
3. 用完点「停止」。注意 Quick 链接每次启动地址都会变化；隧道会把无鉴权的 Hermes UI 暴露到公网，任何人拿到链接即可使用，务必用完即停。
4. 需要固定域名（Named）：在 Cloudflare 面板建 Tunnel 后把 token 填入，模式切「Named 固定域名」再启动。

## 手动命令（NAS SSH 排查用）

```bash
# 检查二进制
/vol1/@appdata/hermes-agent/bin/cloudflared --version
# 手动 Quick（临时）
printf '' > /tmp/cf-empty.yml
/vol1/@appdata/hermes-agent/bin/cloudflared --config /tmp/cf-empty.yml tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8650
# 查看隧道状态文件
cat /vol1/@appdata/hermes-agent/tunnel-state.json
# 查看隧道日志
tail -40 /vol1/@appdata/hermes-agent/logs/tunnel.log
```

## 故障排查

- **启动报「端口未在监听」**：目标服务没起来，先确认 8650/9219 等端口在运行。
- **Quick 启动超时**：NAS 外网不通（GitHub/Cloudflare 被墙或 DNS 问题），或 trycloudflare 服务暂时故障。重试；必要时检查 `/vol1/@appdata/hermes-agent/logs/tunnel.log`。
- **公网打开 404 / 502**：转发目标选错端口（比如选了 8742 网关内部端口而非 Web UI）；改选 8650。
- **下载 cloudflared 失败**：GitHub 下载被墙，可手动下载后放到 `${VAR_DIR}/bin/cloudflared` 并 `chmod 755`。
- **monitor 重启后隧道还在**：状态文件记录 pid，`/api/tunnel/status` 用 `pidAlive` 判断 running；重启前请先停隧道（monitor 被杀时 cloudflared 子进程不会自动退出）。

## 安全须知

Cloudflare Tunnel 会把本地服务暴露给公网——拿到 URL 的人即可访问（除非配置了 Cloudflare Access / 应用层鉴权）。本项目 Web UI 无登录鉴权，公网开启时任何人可调用模型与文件能力，建议：仅临时开启、用完即停、不长期挂在公网、URL 不分享给无关人员。详见 `references/security.md`。

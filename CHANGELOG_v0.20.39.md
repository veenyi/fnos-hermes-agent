# fnos-hermes-agent v0.20.39 版本更新说明（紧急修复 Dashboard 启动失败）

> 基座：Node.js（基于 Node 的 `monitor.js` + 内置 `ws` 库，不再依赖 Bun）｜ Hermes 版本：0.19.0

## 紧急修复：升级后 Dashboard 完全无法启动

**问题**
v0.20.37 / v0.20.38 升级后，部分机器 Dashboard 完全无法启动（停止 / 重启 / 重装均无效）。

**现象（日志）**
- `EACCES: permission denied, open '/vol1/@appdata/hermes-agent/gateway.pid'`
- `[WS-PROXY] upstream closed code=1006` 反复循环重启
- `sqlite3.OperationalError: no such table: tasks`
- `kanban notifier tick failed: no such table: kanban_notify_subs`

**根因**
测试机（192.168.7.21）上残留一个以 **root** 身份启动的旧 `monitor` 实例：它占用了端口，并写出的日志 / 数据库 / pid 文件归 root 所有。后续 fnOS 以 `hermes-agent` 用户启动 gateway 时，因写不了 root 拥有的文件而 `EACCES` 崩溃；dashboard 因端口被占也起不来，形成反复重启循环。

**修复**
1. `cmd/main`：启动前同时 `chown -R` **数据目录（`TRIM_PKGHOME`）** 与 **运行时目录（`TRIM_PKGVAR`）** 为应用用户，防止 root / hermes-agent 混跑导致 `EACCES`。
2. `app/server/monitor.js`：Unix socket 监听遇到 `EADDRINUSE` 时立即 `log FATAL` 并 `process.exit(1)`，防止多个 monitor 实例抢占同一 socket 造成冲突。
3. 上机维护（192.168.7.21）：杀掉残留的 root `monitor` / `gateway` / `dashboard` 进程（保留系统 `/opt/hermes`），将 `/vol1/@appdata/hermes-agent` 与 `/vol1/@apphome/hermes-agent/data` 归属修复为 `hermes-agent:hermes-agent`，再热更新部署 v0.20.39。

**验证（192.168.7.21）**
Dashboard 恢复正常：`monitor` / `gateway` / `dashboard` 均以 `hermes-agent` 用户运行，HTTP 返回 200。

## 安装方式
- fnOS 应用中心 → 上传 / 更新 `fnos-hermes-agent_v0.20.39.fpk`。
- 升级后，到「概览」页重启网关生效。
- 若从 v0.20.37 及更早版本升级后仍异常，请先确认没有以 root 手动启动过 monitor，并清理 `/vol1/@appdata/hermes-agent` 的属主为 `hermes-agent`。

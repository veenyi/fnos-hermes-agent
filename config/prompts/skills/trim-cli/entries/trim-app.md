# trim-cli App Center 入口

用于管理 fnOS 应用中心中的应用：查看已安装应用、查询单个应用状态、安装、手动安装 fpk、更新、启动、停用和卸载。

## 先读规则

- 写操作必须显式传 `--yes`，包括 `install`、`install-fpk`、`update`、`start`、`stop`、`uninstall`。
- CLI 只自动执行不需要 UI 决策的流程；如果应用需要许可证确认、自定义向导、依赖应用变更、运行中的被依赖应用处理等，应转到 App Center UI。
- `app install` / `app update` 会先创建并轮询应用中心下载任务，下载成功后再进入安装/更新任务，并等待任务完成。
- 手动安装 FPK 前优先使用 `app install-fpk <file> --volume-id <id> --dry-run --yes`；它会上传并解析 FPK、检查安装信息和安全 guard，但不会启动安装任务。
- 如果 FPK 上传返回 `20001`，含义是目标存储空间不可用；先检查传入的 `--volume-id` 是否存在、已挂载且健康。
- 安装新应用时如知道应用中心 `sourceID`，建议传 `--source-id`；更新已安装应用时 CLI 会从已安装列表解析 `sourceID`。
- 安装和更新需要明确 `--volume-id`；如数据卷不同，再传 `--data-volume-id`。
- 默认会安装后立即启动；不想启动时传 `--no-start`。

## 常用命令

```bash
./scripts/trim-cli --host <host> --port <port> app list
./scripts/trim-cli --host <host> --port <port> app status <appName>
./scripts/trim-cli --host <host> --port <port> app install <appName> --version <version> --source-id <sourceID> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app install-fpk <localFile.fpk> --volume-id <volumeId> --dry-run --yes
./scripts/trim-cli --host <host> --port <port> app install-fpk <localFile.fpk> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app update <appName> --version <version> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app start <appName> --yes
./scripts/trim-cli --host <host> --port <port> app stop <appName> --yes
./scripts/trim-cli --host <host> --port <port> app uninstall <appName> --yes
```

## 何时继续看 reference

- 需要确认 endpoint、请求字段或安全拒绝条件时，看 `../reference/app-center.md`。
- 连接失败、session 失效或 token 刷新失败时，看 `trim-shared.md`。

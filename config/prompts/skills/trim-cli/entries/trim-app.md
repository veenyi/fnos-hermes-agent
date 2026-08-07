# trim-cli App Center 入口

用于管理 fnOS 应用中心中的应用：查看已安装应用、查询单个应用状态、安装、手动安装 fpk、更新、启动、停用和卸载。

## 先读规则

- 写操作必须显式传 `--yes`，包括 `install`、`install-fpk`、`update`、`start`、`stop`、`uninstall`。
- CLI 默认只自动执行不需要 UI 决策的流程；如果应用需要许可证确认，必须显式传 `--accept-license`；依赖应用变更、运行中的被依赖应用处理等仍应转到 App Center UI。需要自定义安装/升级向导参数时，可显式传 `--custom-parameters`。
- `app install` / `app update` 会先创建并轮询应用中心下载任务，下载成功后再进入安装/更新任务，并等待任务完成；加 `--dry-run` 时只下载/解析包、读取 info 并执行安全 guard，不启动安装/更新任务。
- 手动安装 FPK 前优先使用 `app install-fpk <file> --volume-id <id> --dry-run --yes`；它会上传并解析 FPK、检查安装信息和安全 guard，但不会启动安装任务。
- 已在 NAS 上的 FPK 可用 `app install-fpk --remote-path /vol.../demo.fpk`，走 App Center 的 NAS 文件安装流程；路径必须是具体 `/vol.../*.fpk`，远端文件不能超过 10GB。
- 如果 FPK 上传返回 `20001`，含义是目标存储空间不可用；先检查传入的 `--volume-id` 是否存在、已挂载且健康。
- 安装新应用时如知道应用中心 `sourceID`，建议传 `--source-id`；更新已安装应用时 CLI 会从已安装列表解析 `sourceID`。
- `app install`、`app update`、`app install-fpk` 推荐明确 `--volume-id`；如果省略，CLI 会读取 App Center 默认下载/安装存储空间。没有可用默认值时会拒绝并提示传 `--volume-id`。
- `app install`、`app update`、`app install-fpk` 可传 `--custom-parameters '<jsonArray>'` 和 `--api-scope '<jsonObject>'`；它们分别对应安装/升级任务的 `customParameters` 和 `systemParameters.apiScope`。如果后端提示需要自定义向导但未提供参数，CLI 会拒绝并提示使用 App Center UI。
- `app install`、`app update`、`app install-fpk` 可传 `--cancel-on-failure`，当安装或升级任务进入失败状态时，CLI 会尝试调用对应 cancel 接口并把结果写入错误信息。
- 应用内用户授权路径可用 `app openapi ...` 子命令处理；新增授权路径要求 `--yes` 且路径必须是具体 `/vol...`。
- `app config set-sys` 会校验常用设置字段；默认安装卷、自动更新时间窗口、云安全策略和布尔字段不合法时会在发请求前拒绝。`autoCreateDesktopIcon` 默认不发送，确认后端兼容时才加 `--allow-desktop-icon-field`。
- 默认会安装后立即启动；不想启动时传 `--no-start`。

## 常用命令

```bash
./scripts/trim-cli --host <host> --port <port> app list
./scripts/trim-cli --host <host> --port <port> app status <appName>
./scripts/trim-cli --host <host> --port <port> app install <appName> --version <version> --source-id <sourceID> --volume-id <volumeId> --dry-run --yes
./scripts/trim-cli --host <host> --port <port> app install <appName> --version <version> --source-id <sourceID> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app install <appName> --version <version> --custom-parameters '[{"key":"port","value":8080}]' --api-scope '{"API.User.FileAccess":true}' --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app install <appName> --version <version> --volume-id <volumeId> --accept-license --cancel-on-failure --yes
./scripts/trim-cli --host <host> --port <port> app install-fpk <localFile.fpk> --volume-id <volumeId> --dry-run --yes
./scripts/trim-cli --host <host> --port <port> app install-fpk <localFile.fpk> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app install-fpk --remote-path /vol1/1000/demo.fpk --volume-id <volumeId> --dry-run --yes
./scripts/trim-cli --host <host> --port <port> app update <appName> --version <version> --volume-id <volumeId> --dry-run --yes
./scripts/trim-cli --host <host> --port <port> app update <appName> --version <version> --volume-id <volumeId> --yes
./scripts/trim-cli --host <host> --port <port> app openapi add-user-auth-path <appName> /vol1/1000/docs --yes
./scripts/trim-cli --host <host> --port <port> app start <appName> --yes
./scripts/trim-cli --host <host> --port <port> app stop <appName> --yes
./scripts/trim-cli --host <host> --port <port> app uninstall <appName> --yes
```

## 何时继续看 reference

- 需要确认 endpoint、请求字段或安全拒绝条件时，看 `../reference/app-center.md`。
- 连接失败、session 失效或 token 刷新失败时，看 `trim-shared.md`。

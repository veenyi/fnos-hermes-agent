# App Center reference

## Command overview

| Command | Purpose | Output |
| --- | --- | --- |
| `app list` | List installed App Center apps | JSON |
| `app status <appName>` | Show one installed app record | JSON |
| `app base-data` | Read App Center sidebar/source/tag base data | JSON |
| `app store list` | List cloud App Center packages | JSON |
| `app store search <keyword>` | Search cloud App Center packages | JSON |
| `app store detail <appName>` | Show cloud package detail | JSON |
| `app store latest-release` | List latest release packages | JSON |
| `app check-update` | Check App Center update availability | JSON |
| `app check-update --post` | Trigger an App Center update check | Success message |
| `app common volume` | Read remembered App Center volume | JSON |
| `app common volume --set <volumeId>` | Set remembered App Center volume | Success message |
| `app config sys/list/detail/auth-paths/wizard` | Read App Center system and app config | JSON |
| `app config set-sys --fields <json>` | Update App Center system config fields | Success message |
| `app config set <appName> --fields <json>` | Update one app config payload | Success message |
| `app config auto-update <appName>` | Enable or disable app auto update | Success message |
| `app config proxy-access <appName>` | Allow or deny proxy access | Success message |
| `app config post-wizard <appName> --fields <json>` | Submit app wizard custom parameters | Success message |
| `app service list` / `app entry list` | List service and entry metadata | JSON |
| `app shortcut list` | List desktop shortcuts managed by App Center | JSON |
| `app shortcut add/del <appName> <position> <serviceName>` | Add or delete App Center shortcut entries | Success message |
| `app guide check-installed <appName...>` | Check whether guide-required apps are installed | JSON |
| `app guide batch-download-install <volumeId> <appName...>` | Start guide batch download/install tasks | Success message |
| `app risk last/list` | Read App Center risk snapshots; `list` derives installed app data automatically | JSON |
| `app operation settings` | Read operation settings | JSON |
| `app openapi app-detail <appName>` | Read OpenAPI app detail for authorization flows | JSON |
| `app openapi allow-user-auth-paths <appName>` | Read whether users may authorize paths to an app | JSON |
| `app openapi add-user-auth-path <appName> <path>` | Add current-user authorization path for an app | Success message |
| `app openapi add-user-auth-inherit-file <appName> <path>` | Add inherited-file authorization for an app | Success message |
| `app sac app-store-list` | Read SAC App Store entry list | JSON |
| `app task-status <taskId>` | Query an App Center common task | JSON |
| `app task-cancel <taskId>` | Cancel an App Center common task | Success message |
| `app download cancel <downloadTaskId>` | Cancel an App Center download task | Success message |
| `app install-cancel <taskId>` | Cancel an App Center install task | Success message |
| `app update-cancel <taskId>` | Cancel an App Center update task | Success message |
| `app install <appName>` | Download and install an App Center package by name and version | Success message |
| `app install <appName> --dry-run` | Download and inspect an App Center package without starting install | Success message |
| `app install-fpk <localFile.fpk>` | Upload and install a local fpk package | Success message |
| `app install-fpk --remote-path /vol.../*.fpk` | Install an fpk package already stored on the NAS | Success message |
| `app install-fpk <localFile.fpk> --dry-run` / `--remote-path ... --dry-run` | Inspect an fpk package without starting install | JSON plan |
| `app update <appName>` | Download and update an installed app to a target version | Success message |
| `app update <appName> --dry-run` | Download and inspect an App Center update without starting update | Success message |
| `app start <appName>` | Start an installed app | Success message |
| `app stop <appName>` | Stop an installed app | Success message |
| `app restart <appName>` | Restart an installed app | Success message |
| `app uninstall <appName>` | Uninstall an installed app | Success message |

## Endpoints

| Command | Method | Endpoint |
| --- | --- | --- |
| `app list` / `app status` | GET | `/app-center/v1/app/installed` |
| `app base-data` | GET | `/app-center/v2/config/base-data` |
| `app store list` | GET | `/app-center/v1/app/list` |
| `app store search` | GET | `/app-center/v1/app/search` |
| `app store detail` | GET | `/app-center/v1/app/detail` |
| `app store latest-release` | GET | `/app-center/v1/app/latest-release` |
| `app check-update` | GET/POST | `/app-center/v1/check-update` |
| `app common volume` | GET/POST | `/app-center/v1/common/remember-volume` |
| `app config sys` | GET | `/app-center/v1/sysconfig` |
| `app config set-sys` | POST | `/app-center/v1/sysconfig` |
| `app config list/detail/auth-paths/wizard` | GET | `/app-center/v1/config/*` |
| `app config set` | POST | `/app-center/v1/config` |
| `app config auto-update` | POST | `/app-center/v1/config/app/auto-update` |
| `app config proxy-access` | POST | `/app-center/v1/config/proxy-access-allowed` |
| `app config post-wizard` | POST | `/app-center/v1/config/wizard` |
| `app service list` | GET | `/app-center/v1/service/list` |
| `app entry list` | GET | `/app-center/v1/entry/list` |
| `app shortcut list` | GET | `/app-center/v1/shortcut/list` |
| `app shortcut add/del` | POST | `/app-center/v1/shortcut/add`, `/app-center/v1/shortcut/del` |
| `app guide check-installed` | POST | `/app-center/v1/app/check-installed` |
| `app guide batch-download-install` | POST | `/app-center/v1/batch-download-install` |
| `app risk last/list` | GET | `/app-center/v1/app/risk/*`; `list` sends derived `installedList` |
| `app operation settings` | GET | `/app-center/v1/operation/settings` |
| `app openapi app-detail` | GET | `/app-center/openapi/v1/app/detail` |
| `app openapi allow-user-auth-paths` | GET | `/app-center/openapi/v1/app/allow-user-authorization-paths` |
| `app openapi add-user-auth-path` | POST | `/app-center/openapi/v1/user/authorization-paths` |
| `app openapi add-user-auth-inherit-file` | POST | `/app-center/openapi/v1/user/authorization-paths/inherit-file` |
| `app sac app-store-list` | GET | `/app-center/sac/entry/v1/app-store/list` |
| `app task-status` | POST | `/app-center/v1/common/task-status` |
| `app task-cancel` | POST | `/app-center/v1/common/task-cancel` |
| `app download cancel` | POST | `/app-center/v1/download/cancel` |
| `app install` info | GET | `/app-center/v1/install/info` |
| `app install` start | POST | `/app-center/v1/install/task` |
| `app install-cancel` | POST | `/app-center/v1/install/cancel` |
| `app install-fpk` upload | POST | `/app-center/v1/download/upload` |
| `app install-fpk --remote-path` package task | POST | `/app-center/v1/download/task` with `packageSourceType=file` and `path` |
| `app install-fpk` upload status | GET | `/app-center/v1/download/status` |
| `app update` info | GET | `/app-center/v1/update/info` |
| `app update` start | POST | `/app-center/v1/update/task` |
| `app update-cancel` | POST | `/app-center/v1/update/cancel` |
| `app start` check/start | POST | `/app-center/v1/start/check`, `/app-center/v1/start/start` |
| `app stop` check/start | POST | `/app-center/v1/stop/check`, `/app-center/v1/stop/start` |
| `app restart` | POST | `/app-center/v1/restart` |
| `app uninstall` info/start | GET/POST | `/app-center/v1/uninstall/info`, `/app-center/v1/uninstall/start` |

## Safety behavior

All write commands require `--yes`.

`app store detail` accepts optional `--source-id` and `--version` when the store result includes a source identifier or a specific version is needed.

`app task-cancel` requires `--yes`. The common task status/cancel endpoints use `taskID` in the request body.

`app check-update --post`, `app common volume --set`, `app download cancel`, `app install-cancel`, `app update-cancel`, `app restart`, config writes, shortcut writes, and guide batch download/install are write operations and require `--yes`.

OpenAPI user authorization write commands require `--yes` and require a concrete `/vol...` path. These commands model app/user authorization flows rather than global App Center settings.

For config write commands, `--fields` must be a JSON object. `app config set` adds `appName` to that object before sending it. `app config post-wizard` also adds `appName`; include `customParameters` in `--fields`.

`app config set-sys` validates common App Center settings before sending:

- `downloadAndInstallVolumeID` must be `-1` or a positive integer.
- `globalAutoUpdate.enabled` must be boolean when present.
- When global auto update is enabled, or either update time is provided, `updateStartTime` and `updateEndTime` are both required, must use `HH:MM`, and the effective window must be at least 60 minutes.
- `cloudSecuritySync.enabled` must be boolean when present.
- When cloud security sync is enabled, or `strategy` is provided, `strategy` must be `strict`, `balanced`, or `lenient`.
- `autoRunNewApp` must be boolean when present.
- `autoCreateDesktopIcon` is not sent by the current App Center UI payload. CLI refuses it by default and only sends it when `--allow-desktop-icon-field` is passed; when allowed, it must be boolean.

`app install` and `app update` default to `--package-type cloud`. They create and poll an App Center cloud download task before calling install/update info and task endpoints, then wait for the returned install/update task to finish. With `--dry-run`, they still download/parse the cloud package and apply safety guards, but they do not call the install/update task endpoint. `app install-fpk` derives `packageType` from the uploaded or remote package status and commonly uses `file`.

`app install`, `app update`, and `app install-fpk` accept explicit wizard inputs:

- `--custom-parameters '<jsonArray>'` sends App Center `customParameters`.
- `--api-scope '<jsonObject>'` sends `systemParameters.apiScope`.
- `--accept-license` explicitly accepts package license confirmation outside App Center UI.
- `--cancel-on-failure` attempts the matching install/update cancel endpoint if the install/update task reaches a failed status; the original failure context remains in stderr.
- If App Center reports that custom wizard parameters are required and `--custom-parameters` is not provided, CLI refuses before starting the install/update task.

For `app install`, `app update`, and `app install-fpk`, `--volume-id` is recommended. If omitted, CLI reads App Center sysconfig and uses `downloadAndInstallVolumeID`, with `volumeID` as compatibility fallback. The value must be positive; if no usable default exists, CLI rejects and asks for `--volume-id`.

Use `app install-fpk <localFile.fpk> --volume-id <volumeId> --dry-run --yes` before a risky manual install. Dry-run still uploads a local FPK so App Center can parse it, then reads install info and applies CLI safety guards, but it does not call `/app-center/v1/install/task`.

Use `app install-fpk --remote-path /vol.../*.fpk --dry-run --yes` for an FPK that is already on the NAS. The path must be a concrete `/vol...` path, must end with `.fpk`, and the remote file size must be no larger than 10GB. CLI checks the remote file property before creating the App Center remote package task.

If an install or update task fails, stderr includes the task id plus `appName`, `version`, `packageType`, install/data volume ids, immediate-start flag, status/progress, and any backend `message` or `outputText`. With `--cancel-on-failure`, stderr also says whether the cancel request was attempted or failed.

Known storage errors are diagnosed in addition to the raw backend response. For manual FPK upload, `20001` means the selected storage volume is unavailable; choose a mounted, healthy volume id before retrying.

If start or stop returns `10500`, App Center reports that the status operation is not supported for the current app state/control data. Inspect `app status` or use App Center UI.

For `app install`, pass `--source-id` when the cloud app source identifier is known. `app update` resolves `sourceID` from the installed app list.

The CLI refuses cases that require App Center UI decisions:

- license confirmation without explicit `--accept-license`
- custom install/update wizard parameters without explicit `--custom-parameters`
- custom uninstall wizard parameters
- unsupported install types other than `volume` or `root`
- Docker unavailable or uninitialized for install/update
- OS version mismatch
- dependency app install/update/start changes
- running dependent apps for stop/uninstall

Root install packages are supported by sending install volume as `0` while keeping data volume as the selected volume, matching App Center behavior.

Uninstall waits until the app no longer appears in the installed app list. This avoids starting a follow-up install while the backend is still removing the previous installation.

## Failure handling matrix

| Condition | CLI behavior | What to do |
| --- | --- | --- |
| License confirmation is required and `--accept-license` is missing | Rejects before install/update task | Pass `--accept-license` only after reviewing the license, or use App Center UI |
| Custom install/update wizard parameters are required and `--custom-parameters` is missing | Rejects before install/update task | Pass explicit wizard JSON or use App Center UI |
| Custom uninstall wizard parameters are required | Rejects before uninstall task | Use App Center UI |
| Unsupported install type | Rejects before install/update task | Use App Center UI |
| Docker is unavailable or uninitialized | Rejects before install/update task | Fix Docker or use App Center UI |
| OS version is incompatible | Rejects before install/update/start task | Choose a compatible app or OS version |
| Dependency app changes are required | Rejects before install/update/start task | Use App Center UI to review dependency operations |
| Running dependent apps would be affected | Rejects stop/uninstall, and install/update where applicable | Stop/review dependent apps in App Center UI |
| Cloud download fails | Reports cloud download task id plus app/version/source/volume context | Check sourceID, version, network, and App Center availability |
| Install/update task fails with `--cancel-on-failure` | Reports task failure context and attempts the matching cancel endpoint | Inspect stderr for cancel result, then verify task state in App Center if needed |
| Cloud install/update dry-run passes | Prints a success message and does not start install/update task | Review app/version/package/volume before running without `--dry-run` |
| FPK upload fails | Reports upload task id and upload context | Check package validity and target volume |
| FPK upload returns `20001` | Reports storage-unavailable diagnostic plus raw response | Check that the selected volume exists, is mounted, and is healthy |
| FPK dry-run passes | Outputs JSON plan and does not start install task | Review app/version/package/volume before running without `--dry-run` |
| Remote FPK path or size is invalid | Rejects before App Center download task | Use a concrete `/vol.../*.fpk` path and a file no larger than 10GB |
| Default install volume is missing | Rejects before download/install task | Pass `--volume-id` or configure App Center default download/install volume |
| `set-sys` field validation fails | Rejects before network request | Fix the field type, enum, volume id, or update time window |
| Install/update task fails | Reports task id plus app/version/package/volume/status/progress/backend message | Use the context to identify package, version, volume, or backend script failure |
| Start/stop returns `10500` | Reports status-operation diagnostic plus raw response | Inspect `app status` or use App Center UI |
| Uninstall does not disappear from installed list | Times out with the app name | Inspect App Center UI or retry after backend task settles |

## Examples

```bash
./scripts/trim-cli app list
./scripts/trim-cli app status trim.alist
./scripts/trim-cli app store list
./scripts/trim-cli app store search alist
./scripts/trim-cli app store detail trim.alist --source-id 265 --version 3.0.13
./scripts/trim-cli app store latest-release
./scripts/trim-cli app check-update
./scripts/trim-cli app check-update --post --yes
./scripts/trim-cli app common volume
./scripts/trim-cli app common volume --set 2 --yes
./scripts/trim-cli app config sys
./scripts/trim-cli app config detail trim.alist
./scripts/trim-cli app service list
./scripts/trim-cli app entry list --only-hidden
./scripts/trim-cli app shortcut list
./scripts/trim-cli app shortcut add trim.alist desktop web --yes
./scripts/trim-cli app shortcut del trim.alist desktop web --yes
./scripts/trim-cli app config set-sys --fields '{"autoRunNewApp":true}' --yes
./scripts/trim-cli app config set trim.alist --fields '{"services":[],"extraAuthorizationPath":[]}' --yes
./scripts/trim-cli app config auto-update trim.alist --enable --yes
./scripts/trim-cli app config proxy-access trim.alist --allowed --yes
./scripts/trim-cli app config post-wizard trim.alist --fields '{"customParameters":[]}' --yes
./scripts/trim-cli app guide check-installed trim.media trim.photos
./scripts/trim-cli app guide batch-download-install 2 trim.media trim.photos --yes
./scripts/trim-cli app risk last
./scripts/trim-cli app risk list
./scripts/trim-cli app operation settings
./scripts/trim-cli app openapi app-detail trim.alist
./scripts/trim-cli app openapi allow-user-auth-paths trim.alist
./scripts/trim-cli app openapi add-user-auth-path trim.alist /vol1/1000/docs --yes
./scripts/trim-cli app openapi add-user-auth-inherit-file trim.alist /vol1/1000/docs/file.txt --yes
./scripts/trim-cli app sac app-store-list
./scripts/trim-cli app task-status <taskId>
./scripts/trim-cli app task-cancel <taskId> --yes
./scripts/trim-cli app download cancel <downloadTaskId> --yes
./scripts/trim-cli app install-cancel <taskId> --yes
./scripts/trim-cli app update-cancel <taskId> --yes
./scripts/trim-cli app install trim.alist --version 3.0.13 --source-id 265 --volume-id 2 --dry-run --yes
./scripts/trim-cli app install trim.alist --version 3.0.13 --source-id 265 --volume-id 2 --yes
./scripts/trim-cli app install trim.alist --version 3.0.13 --volume-id 2 --custom-parameters '[{"key":"port","value":8080}]' --api-scope '{"API.User.FileAccess":true}' --yes
./scripts/trim-cli app install trim.alist --version 3.0.13 --volume-id 2 --accept-license --cancel-on-failure --yes
./scripts/trim-cli app install-fpk ~/Downloads/demo.fpk --volume-id 2 --dry-run --yes
./scripts/trim-cli app install-fpk ~/Downloads/demo.fpk --volume-id 2 --yes
./scripts/trim-cli app update trim.alist --version 3.0.14 --volume-id 2 --dry-run --yes
./scripts/trim-cli app update trim.alist --version 3.0.14 --volume-id 2 --yes
./scripts/trim-cli app stop trim.alist --yes
./scripts/trim-cli app start trim.alist --yes
./scripts/trim-cli app uninstall trim.alist --yes
```

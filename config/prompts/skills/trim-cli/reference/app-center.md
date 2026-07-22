# App Center reference

## Command overview

| Command | Purpose | Output |
| --- | --- | --- |
| `app list` | List installed App Center apps | JSON |
| `app status <appName>` | Show one installed app record | JSON |
| `app install <appName>` | Download and install an App Center package by name and version | Success message |
| `app install-fpk <localFile.fpk>` | Upload and install a local fpk package | Success message |
| `app install-fpk <localFile.fpk> --dry-run` | Upload and inspect a local fpk package without starting install | JSON plan |
| `app update <appName>` | Download and update an installed app to a target version | Success message |
| `app start <appName>` | Start an installed app | Success message |
| `app stop <appName>` | Stop an installed app | Success message |
| `app uninstall <appName>` | Uninstall an installed app | Success message |

## Endpoints

| Command | Method | Endpoint |
| --- | --- | --- |
| `app list` / `app status` | GET | `/app-center/v1/app/installed` |
| `app install` info | GET | `/app-center/v1/install/info` |
| `app install` start | POST | `/app-center/v1/install/task` |
| `app install-fpk` upload | POST | `/app-center/v1/download/upload` |
| `app install-fpk` upload status | GET | `/app-center/v1/download/status` |
| `app update` info | GET | `/app-center/v1/update/info` |
| `app update` start | POST | `/app-center/v1/update/task` |
| `app start` check/start | POST | `/app-center/v1/start/check`, `/app-center/v1/start/start` |
| `app stop` check/start | POST | `/app-center/v1/stop/check`, `/app-center/v1/stop/start` |
| `app uninstall` info/start | GET/POST | `/app-center/v1/uninstall/info`, `/app-center/v1/uninstall/start` |

## Safety behavior

All write commands require `--yes`.

`app install` and `app update` default to `--package-type cloud`. They create and poll an App Center cloud download task before calling install/update info and task endpoints, then wait for the returned install/update task to finish. `app install-fpk` derives `packageType` from the uploaded package status and commonly uses `file`.

Use `app install-fpk <localFile.fpk> --volume-id <volumeId> --dry-run --yes` before a risky manual install. Dry-run still uploads the FPK so App Center can parse it, then reads install info and applies CLI safety guards, but it does not call `/app-center/v1/install/task`.

If an install or update task fails, stderr includes the task id plus `appName`, `version`, `packageType`, install/data volume ids, immediate-start flag, status/progress, and any backend `message` or `outputText`.

Known storage errors are diagnosed in addition to the raw backend response. For manual FPK upload, `20001` means the selected storage volume is unavailable; choose a mounted, healthy volume id before retrying.

If start or stop returns `10500`, App Center reports that the status operation is not supported for the current app state/control data. Inspect `app status` or use App Center UI.

For `app install`, pass `--source-id` when the cloud app source identifier is known. `app update` resolves `sourceID` from the installed app list.

The CLI refuses cases that require App Center UI decisions:

- license confirmation
- custom install/update/uninstall wizard parameters
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
| License confirmation is required | Rejects before install/update task | Use App Center UI |
| Custom wizard parameters are required | Rejects before install/update/uninstall task | Use App Center UI |
| Unsupported install type | Rejects before install/update task | Use App Center UI |
| Docker is unavailable or uninitialized | Rejects before install/update task | Fix Docker or use App Center UI |
| OS version is incompatible | Rejects before install/update/start task | Choose a compatible app or OS version |
| Dependency app changes are required | Rejects before install/update/start task | Use App Center UI to review dependency operations |
| Running dependent apps would be affected | Rejects stop/uninstall, and install/update where applicable | Stop/review dependent apps in App Center UI |
| Cloud download fails | Reports cloud download task id plus app/version/source/volume context | Check sourceID, version, network, and App Center availability |
| FPK upload fails | Reports upload task id and upload context | Check package validity and target volume |
| FPK upload returns `20001` | Reports storage-unavailable diagnostic plus raw response | Check that the selected volume exists, is mounted, and is healthy |
| FPK dry-run passes | Outputs JSON plan and does not start install task | Review app/version/package/volume before running without `--dry-run` |
| Install/update task fails | Reports task id plus app/version/package/volume/status/progress/backend message | Use the context to identify package, version, volume, or backend script failure |
| Start/stop returns `10500` | Reports status-operation diagnostic plus raw response | Inspect `app status` or use App Center UI |
| Uninstall does not disappear from installed list | Times out with the app name | Inspect App Center UI or retry after backend task settles |

## Examples

```bash
./scripts/trim-cli app list
./scripts/trim-cli app status trim.alist
./scripts/trim-cli app install trim.alist --version 3.0.13 --source-id 265 --volume-id 2 --yes
./scripts/trim-cli app install-fpk ~/Downloads/demo.fpk --volume-id 2 --dry-run --yes
./scripts/trim-cli app install-fpk ~/Downloads/demo.fpk --volume-id 2 --yes
./scripts/trim-cli app update trim.alist --version 3.0.14 --volume-id 2 --yes
./scripts/trim-cli app stop trim.alist --yes
./scripts/trim-cli app start trim.alist --yes
./scripts/trim-cli app uninstall trim.alist --yes
```

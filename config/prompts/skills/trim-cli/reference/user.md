# user API Module

## 模块概述
本模块涵盖认证、令牌/会话生命周期、账户管理、用户组管理、登录设备管控及用户侧 2FA 流程。

## 模块约定
- 区分认证端点与管理员专属的用户/组管理端点。
- 注意登录请求中历史文档与实际行为之间的字段名差异。
- 认证生命周期为 `user.login` -> `user.authToken` / `user.tokenLogin` -> 可选 `user.active` -> `user.logout`，固件特定行为需注意兼容。
- `appcgi.usersrv.authUser` 是高风险命令的密码验证端点，不用于创建会话或刷新令牌。
- 当历史文档与实际实现冲突时，以实际实现的字段名和可选性为���。

## 端点索引
- 认证/会话生命周期:
  - `user.login`
  - `user.authToken`
  - `appcgi.usersrv.authUser`
  - `user.tokenLogin`
  - `user.active` (未实现)
  - `user.logout`
  - `user.isAdmin`
- 用户管理:
  - `user.list`
  - `user.info`
  - `user.add`
  - `user.mod`
  - `user.del`
  - `user.checkNewUser`
  - `user.changePassword`
  - `user.unfreeze`
  - `user.setAdmin`
- 用户组管理:
  - `user.groupList`
  - `user.groupAdd`
  - `user.groupMod`
  - `user.groupDel`
  - `user.groupInfo`
  - `user.groupSetUsers`
  - `user.groupAddUsers`
  - `user.groupDelUsers`
  - `user.groupUsers`
  - `user.checkNewGroup`
  - `user.listUG`
- 登录设备与 2FA:
  - `user.listLoginDevice`
  - `user.kickLoginDevice`
  - `user.2fa.loginVerify`
  - `user.2fa.resetPassword`

## 端点详情
### user.login

#### Endpoint
`user.login`

#### Purpose
使用用户名/密码认证并获取会话材料，用于后续签名请求。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> login`
- `trim-cli --host <host> --port <port> login -u <username> -p <password>`

CLI 行为:
- 省略用户名/密码参数时使用交互式提示。
- 未显式传连接参数时，CLI 会优先复用已保存 session 的 `host`、`port`、`scheme` 和 TLS 设置。
- `--scheme auto` 下，loopback 默认 `ws:5666`，远程 IP 默认 `wss:5667`，远程域名默认 `wss:443`；显式 `--port` 优先。
- 内网或自签证书 WSS 目标可能需要 `--tls-insecure`；远程明文 `ws://` 需要 `--allow-insecure-ws`。
- 成功后，CLI 将会话材料（`token`、可选 `longToken`、可选 `backId`、可选 `secret`）和连接设置持久化到配置目录的会话文件中。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.login` | `user.login` |
| `reqid` | body | yes | string | 请求关联 ID | fnOS 兼容的生成 ID | `69ba234069ba2df8000004c40001` |
| `user` | body | yes | string | 用户名 | 请求使用 `user` 键 | `admin` |
| `password` | body | yes | string | 密码 | CLI 不持久化明文密码 | `******` |
| `stay` | body | yes | number | 保持登录提示 | 固定值 `1` | `1` |
| `deviceName` | body | yes | string | 设备标签 | 标识为 `fnOS CLI` | `fnOS CLI` |
| `deviceType` | body | yes | string | 设备类型标签 | 标识为 `CLI` | `CLI` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `token` | no | string | 短期会话令牌 | CLI 构建存储会话所必需 | `ey...` |
| `longToken` | no | string | 长期令牌 | 可选；用于后备恢复 | `ey...` |
| `backId` | no | string | 请求 ID backId 分量 | 可选，用于 reqid 生成器上下文 | `69ba2df8000004c4` |
| `secret` | no | string | HMAC 签名密钥 (base64) | 可选；启用签名请求 | `c2VjcmV0LXNlZWQ=` |
| `errno` | no | number | 数字错误码 | 失败和某些终结响应中出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 后端报告失败详情时出现 | `invalid credentials` |

#### Protocol Notes
- `user.login` 在当前协议层是直通请求：登录前无 HMAC 包装。
- 成功的登录响应用于持久化会话并设置请求签名上下文。

#### Field Semantics
- `user` 是当前实现中用户名的字段名。
- `secret` 是 base64 编码，用作后续非直通请求的 HMAC 密钥。

#### Errors
- 登录失败返回终结失败（`result: fail` 和/或 `errno`/`errmsg`）。
- CLI 使用统一消息格式化器包装失败并以非零退出码退出。

---

### user.authToken

#### Endpoint
`user.authToken`

#### Purpose
使用短令牌重新认证已保存的会话。

#### Trim CLI Mapping
无直接命令。
- 通过共享会话恢复流程被 `system info`、`file ...`、`monitor ...` 和 `logout` 等流程内部使用。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.authToken` | `user.authToken` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69ba234069ba2df8000004c40002` |
| `token` | body | yes | string | 用于恢复的短令牌 | 从会话文件加载 | `ey...` |
| `main` | body | no | boolean | 主连接指示器 | 默认值 `true` | `true` |
| `active` | body | no | boolean | 活跃会话提示 | 默认值 `true` | `true` |
| `si` | body | conditional | string | 会话完整性盐 | 当令牌请求被签名且 `si` 可用时由协议助手注入 | `897648211940` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `token` | no | string | 刷新/确认的短令牌 | 用于更新存储的会话 | `ey...` |
| `longToken` | no | string | 刷新的长令牌 | 可选 | `ey...` |
| `backId` | no | string | backId 值 | 可选，更新 reqid 上下文 | `69ba2df8000004c5` |
| `secret` | no | string | HMAC 密钥 | 可选，更���签名上下文 | `c2VjcmV0LXNlZWQ=` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `token expired` |

#### Protocol Notes
- 与 `user.login` 不同，此请求在密钥存在时通常经过 HMAC 签名。
- 协议助手为带令牌的签名请求注入 `si`（`params.token` + 可用的 `si`）。
- 签名激活时，请求传输遵循 `_conventions.md` 中描述的规范线格式（`<signature><json-body>` 字符串）。
- CLI 中的会话恢复顺序为：短令牌（`user.authToken`）-> 长令牌（`user.tokenLogin`）-> 密码登录。

#### Field Semantics
- `main` 和 `active` 在当前封装中默认为 `true`，不可通过 CLI 参数配置。
- `si` 不是持久令牌；通过 `util.getSI` 获取，用于增强签名令牌认证。

#### Errors
- 此步骤的任何失败都会触发回退到下一个恢复策略，而非立即硬失败。
- 持续认证失败最终要求交互式登录。

---

### user.tokenLogin

#### Endpoint
`user.tokenLogin`

#### Purpose
当短令牌恢复不可用或被拒绝时，使用长期令牌恢复已保存的会话。

#### Trim CLI Mapping
无直接命令。
- 在 `user.authToken` 失败后、CLI 提示用户名/密码之前，作为共享会话恢复的后备方案内部使用。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.tokenLogin` | `user.tokenLogin` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69ba234069ba2df8000004c40003` |
| `token` | body | yes | string | 长期恢复令牌 | 从存储会话的 `longToken` 加载 | `ey...` |
| `deviceName` | body | yes | string | 设备标签 | 标识为 `fnOS CLI` | `fnOS CLI` |
| `deviceType` | body | yes | string | 设备类型标签 | 标识为 `CLI` | `CLI` |
| `si` | body | conditional | string | 会话完整性盐 | 当请求被签名且 `si` 可用时由协议助手注入 | `897648211940` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `token` | no | string | 刷新/确认的短令牌 | 用于更新存储的会话 | `ey...` |
| `longToken` | no | string | 刷新/确认的长令牌 | 用于保持后备恢复可用 | `ey...` |
| `backId` | no | string | backId 值 | 可选，更新 reqid 上下文 | `69ba2df8000004c6` |
| `secret` | no | string | HMAC 密钥 | 可选，更新签名上下文 | `c2VjcmV0LXNlZWQ=` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `token expired` |

#### Protocol Notes
- CLI 仅在 `user.authToken` 返回非成功路径时的恢复后备中调用此端点。
- 当会话 `secret` 仍然可用时，请求遵循 `_conventions.md` 中描述的签名请求流程；否则以纯 JSON 发送。
- 带令牌的签名请求在签名前可接收注入的 `si`（当客户端已获取 `util.getSI` 时）。

#### Field Semantics
- 此请求中的 `token` 是持久化的 `longToken`，而非 `user.authToken` 使用的短会话令牌。
- `deviceName` 和 `deviceType` 标识恢复客户端，与密码登录的客户端身份字符串一致。

#### Errors
- 失败后进入 CLI 恢复链的最终密码登录步骤。
- CLI 不直接暴露此端点，调用方只能观察到最终的恢复成功/失败结果。

---

### appcgi.usersrv.authUser

#### Endpoint
`appcgi.usersrv.authUser`

#### Purpose
为高风险操作验证当前用户的密码，不创建新的登录会话或替换存储的令牌。

#### Trim CLI Mapping
无直接顶级命令。
- 被高风险存储写操作内部使用，如 `storage umount`、`storage create`、`storage stop`、`storage add-disk`、`storage remove-disk`、`storage replace-disk`、`storage extend`、`storage resize`、`storage format` 和 `storage eject`。
- CLI 使用已保存的会话用户名加上 `--password <password>` 或交互式密码提示，验证失败则在目标变更前中止。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `appcgi.usersrv.authUser` | `appcgi.usersrv.authUser` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69ba234069ba2df8000004c40004` |
| `user` | body | yes | string | 待验证用户名 | CLI 使用恢复的会话用户名 | `os_cli` |
| `password` | body | yes | string | 待验证密码 | CLI 不持久化密码 | `******` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ` 或 `fail` | `succ` |
| `uid` | no | number | 已验证用户 ID | 成功时出现 | `1000` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65537` |
| `errmsg` | no | string | 错误描述 | 验证失败时出现 | `Password verification failed` |

#### Protocol Notes
- 此端点用作真正高风险变更请求之前的预检守卫。
- 与 `user.login` 不同，它不替换会话令牌或更新 CLI 持久化的会话文件。
- 当前 CLI 策略将密码验证与后端密码转发分离：某些命令验证并转发密码，其他命令仅验证而不改变目标请求体。

#### Field Semantics
- `user` 应与操作者当前认证的会话用户名匹配。
- `password` 是一次性命令输入；CLI 在内存中验证后，命令结束时丢弃。

#### Errors
- 验证失败对调用的 CLI 命令是致命的；目标存储变更不会被发送。
- 后端特定的错误码/消息通过 CLI 的正常错误格式化器展示。

---

### user.logout

#### Endpoint
`user.logout`

#### Purpose
在可能的情况下终止认证的远程会话，并配合 CLI 侧的本地会话清理保证。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> logout`

CLI 行为:
- 如果没有匹配的已保存会话，命令跳过远程登出，仍清理本地状态。
- 如果存在已保存会话，CLI 获取 `si`，通过 `user.authToken` 恢复短令牌会话，然后发送 `user.logout`。
- 即使远程登出或预登出重认证失败，本地会话清理仍会执行。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.logout` | `user.logout` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69ba234069ba2df8000004c40005` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 后端报告失败详情时出现 | `not logged in` |

#### Protocol Notes
- `user.logout` 仅在 CLI 通过 `user.authToken` 重建保存的会话之后发送；如果重认证失败，CLI 不发送 `user.logout`。
- 当存在已保存的 `secret` 时，请求使用签名请求线格式，并在重认证前将 `si` 纳入安全上下文。
- 远程登出在此 CLI 中是尽力而为：本地清理是主要契约，传输/认证失败会被吞没，不阻塞本地会话清理。

#### Field Semantics
- 此端点在当前客户端中除公共 `req` 和 `reqid` 信封外没有额外的请求体字段。
- 成功的远程登出本身不移除本地会话数据；本地清理是 CLI 侧的独立步骤。

#### Errors
- 远程登出失败对命令的主要保证（本地会话移除）是有意的非致命行为。
- 仅当本地清理本身抛出异常时，命令才以非零退出码退出。

---

### user.list

#### Endpoint
`user.list`

#### Purpose
列出 TRIM 用户，可选复用后端 `uver` 缓存令牌以避免重发未变数据。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user list`
- `trim-cli --host <host> --port <port> user list --uver <n>`

CLI 组合读视图:
- `trim-cli --host <host> --port <port> user frozen-list`

CLI 行为:
- 命令复用正常的已保存会话恢复流程。
- 提供 `--uver` 时，CLI 直接转发给后端。
- 如果后端返回 `{ upToDate: true }`，CLI 原样打印该载荷，不视为错误或空列表。
- `user frozen-list` 不是单独的后端端点；CLI 调用 `user.list` 后仅保留 `bannedTime` 为正数的行。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.list` | `user.list` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40001` |
| `uver` | body | no | number | 缓存的用户列表版本令牌 | 来自上次列表响应的非负整数 | `0` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `users` | no | array | 用户摘要列表 | 后端发送列表数据时出现 | `[{"user":"alice","uid":1000}]` |
| `uver` | no | number | 当前用户列表版本令牌 | 伴随完整列表响应出现 | `110769999839232` |
| `upToDate` | no | boolean | 缓存命中标记 | 调用方提供当前 `uver` 时出现 | `true` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

#### Protocol Notes
- 此端点走正常的认证主 WebSocket 流程。
- 当前 CLI 不添加本地缓存层；仅在提供时转发 `--uver`。
- 当前冻结管理读路径由 CLI 从 `user.list` 组合，因此 `bannedTime` 被视为本地冻结状态信号，而非专用后端选择器。

---

### user.info

#### Endpoint
`user.info`

#### Purpose
获取当前用户的详情，或在有权限时获取指定用户的详情。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user info`
- `trim-cli --host <host> --port <port> user info <user>`

CLI 行为:
- 未提供位置参数用户名时，CLI 省略 `user` 字段，向后端查询当前用户。
- 提供用户名时，CLI 发送 `{ user }`。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.info` | `user.info` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40002` |
| `user` | body | no | string | 目标用户名 | 省略则获取当前用户 | `alice` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `userInfo` | no | object | 详细用户记录 | 成功时出现 | `{...}` |
| `user` | no | string | 用户名摘要 | 常在顶层重复 | `alice` |
| `uid` | no | number | 用户 ID | 顶层摘要字段 | `1000` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

#### Protocol Notes
- 省略 `user` 返回当前用户，仅���理员可查询其他用户。
- 当前 CLI 将授权交由后端处理，不在本地预检管理员权限。

---

### user.add

#### Endpoint
`user.add`

#### Purpose
创建 TRIM 用户，设定初始密码及可选的组/联系方式/管理员元数据。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user add <user> --password <password> [--groups <group> ...] [--comment <comment>] [--email <email>] [--mobile <mobile>] [--disable-change-password] [--set-admin] [--yes]`

CLI 行为:
- 命令在发出写操作前使用正常的已保存会话恢复流程。
- `--password` 在 CLI 层为可选；省略时 CLI 提示输入初始密码。
- `--groups` 接受重复值和逗号分隔值，转发去重后的数组。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.add` | `user.add` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40007` |
| `user` | body | yes | string | 要创建的用户名 | 修剪后的 CLI 位置参数 | `alice` |
| `password` | body | yes | string | 初始密码 | 未通过 `--password` 提供时进行提示 | `******` |
| `groups` | body | no | string[] | 初始组成员关系 | 可选；允许零个或多个组 | `["Users","Administrators"]` |
| `comment` | body | no | string | 用户备注/标签 | 修剪；空白时省略 | `Alice` |
| `email` | body | no | string | 邮箱地址 | 修剪；空白时省略 | `alice@example.com` |
| `mobile` | body | no | string | 手机号码 | 修剪；空白时省略 | `13800138000` |
| `disableChangePassword` | body | no | boolean | 禁止自助修改密码 | 仅在设置 CLI 参数时发送 | `true` |
| `setAdmin` | body | no | boolean | 创建为管理员用户 | 仅在设置 CLI 参数时发送 | `true` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `uid` | no | number | 创建的用户 ID | 成功时出现 | `1002` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `user exists` |

#### Protocol Notes
- 当前 CLI 不预检 `user.checkNewUser`；直接发送 `user.add` 并通过共享格式化器展示后端错误。
- 当前 CLI 仅转发明确提供的字段，`password` 始终必需因此始终存在。

---

### user.mod

#### Endpoint
`user.mod`

#### Purpose
修改现有 TRIM 用户的选定字段。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user mod <user> [--new-name <user>] [--password <password>] [--groups <group> ...] [--comment <comment>] [--email <email>] [--mobile <mobile>] [--disable-change-password | --enable-change-password] [--disable-user <n>] [--allow-ssh | --disallow-ssh] [--yes]`

CLI 行为:
- 命令要求至少一个变更字段；否则在发送 `user.mod` 前本地失败。
- CLI 此处不提示密码；`--password` 意为"为该用户设置新密码"，仅在明确提供时转发。
- `--groups` 接受重复值和逗号分隔值，仅在明确设置时转发。
- 布尔字段实现为三态参数：省略字段、发送 `true` 或发送 `false`。
- `--disable-change-password` / `--enable-change-password` 互斥。
- `--allow-ssh` / `--disallow-ssh` 互斥。
- 发送 `allowSSH: true` 前，CLI 获取 `user.info` 并在目标用户非管理员时本地拒绝命令。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.mod` | `user.mod` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40008` |
| `user` | body | yes | string | 要修改的用户名 | 修剪后的 CLI 位置参数 | `alice` |
| `newName` | body | no | string | 新用户名 | 未设置时省略 | `alice2` |
| `password` | body | no | string | 替换密码 | 未明确提供时省略 | `******` |
| `groups` | body | no | string[] | 替换组列表 | 可选；仅在设置 CLI 参数时转发 | `["Users"]` |
| `comment` | body | no | string | 用户备注/标签 | 空白时省略 | `Updated` |
| `email` | body | no | string | 邮箱地址 | 空白时省略 | `alice@example.com` |
| `mobile` | body | no | string | 手机号码 | 空白时省略 | `13800138000` |
| `disableChangePassword` | body | no | boolean | 密码修改策略标志 | CLI 可明确发送 `true` 或 `false` | `false` |
| `disableUser` | body | no | number | 禁用标志值 | 解析为非负整数；允许 `0`、`1`、`88` 或其他数字固件值 | `1` |
| `allowSSH` | body | no | boolean | SSH 登录策略标志 | CLI 可明确发送 `true` 或 `false` | `false` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

#### Protocol Notes
- CLI 此处遵循最小载荷策略：仅包含明确提供的变更字段。
- 管理员切换保留在专用 `user.setAdmin` 命令上，`user.mod` 不包含 `setAdmin` 字段。
- 启用 SSH 仅对管理员用户被接受；CLI 在尝试 `user.mod` 前强制执行该规则。

---

### user.del

#### Endpoint
`user.del`

#### Purpose
删除 TRIM 用户。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user del <user> [--yes]`

CLI 行为:
- 除非提供 `--yes`，否则命令要求确认。
- 除目标用户名外不发送额外请求字段。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.del` | `user.del` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40009` |
| `user` | body | yes | string | 要删除的用户名 | 修剪后的 CLI 位置参数 | `alice` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

---

### user.changePassword

#### Endpoint
`user.changePassword`

#### Purpose
修改当前用户或指定用户的密码。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user change-password [user] [--old-password <password>] [--new-password <password>] [--remove-token] [--yes]`

CLI 行为:
- 省略 `[user]` 时，CLI 回退到恢复的会话用户名。
- CLI 对缺失的 `--old-password` 和 `--new-password` 字段进行提示。
- 除非提供 `--yes`，否则命令要求确认。
- CLI 始终发送显式的 `removeToken` 布尔值，即使参数被省略。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.changePassword` | `user.changePassword` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c4000a` |
| `user` | body | yes | string | 修改密码的用户名 | 省略位置参数时回退到已保存的会话用户 | `os_cli` |
| `password` | body | no | string | 当前密码 | 未提供时进行提示 | `******` |
| `newPassword` | body | yes | string | 新密码 | 未提供时进行提示 | `******` |
| `removeToken` | body | yes | boolean | 密码修改后是否使现有令牌失效 | CLI 始终发送显式布尔值 | `true` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `current password incorrect` |

#### Protocol Notes
- `password` 字段标记为可选；CLI 仍将其视为必需输入，省略参数时通过提示填充。
- 此命令不先调用 `appcgi.usersrv.authUser`；当前 CLI 直接将旧密码传递给 `user.changePassword`。

---

### user.unfreeze

#### Endpoint
`user.unfreeze`

#### Purpose
清除指定用户的后端冻结/封禁状态。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user unfreeze <user> [--yes]`

CLI 行为:
- CLI 在发送请求前本地修剪并验证位置参数用户名。
- 除非提供 `--yes`，否则命令要求确认。
- CLI 仅向后端发送 `{ user }` 并在完成时打印简短成功行。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.unfreeze` | `user.unfreeze` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c4000b` |
| `user` | body | yes | string | 目标用户名 | 修剪后的 CLI 位置参数 | `alice` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `409` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `user is not frozen` |

#### Protocol Notes
- 此请求仅包含一个字段：`user`。
- CLI 在发出写操作前不推断或验证冻结状态；发现逻辑有意分离到由 `user.list` 和 `bannedTime` 构建的 CLI 组合 `user frozen-list` 读路径中。

---

### user.setAdmin

#### Endpoint
`user.setAdmin`

#### Purpose
授予或撤销 TRIM 用户的管理员权限。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user set-admin <user> (--on | --off) [--yes]`

CLI 行为:
- CLI 要求 `--on` 或 `--off` 二选一。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.setAdmin` | `user.setAdmin` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c4000b` |
| `user` | body | yes | string | 目标用户名 | 修剪后的 CLI 位置参数 | `alice` |
| `setAdmin` | body | yes | boolean | 期望的管理员状态 | 从 `--on` / `--off` 派生 | `true` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `permission denied` |

#### Protocol Notes
- 管理员切换作为独立端点处理，而非 `user.mod` 上的字段。
- CLI 将两个参数解析为单个布尔值，并在发送写操作前本地拒绝无效参数组合。

---

### user.listUG

#### Endpoint
`user.listUG`

#### Purpose
返回用户和组的名称/ID 映射，支持可选的 `uver` 缓存语义。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user list-ug`
- `trim-cli --host <host> --port <port> user list-ug --users`
- `trim-cli --host <host> --port <port> user list-ug --groups --uver <n>`

CLI 行为:
- 未传递 `--users` 和 `--groups` 时，CLI 默认两者都查询。
- 传递一个或两个参数时，仅转发显式指定的类别。
- 提供 `--uver` 时直接转发。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.listUG` | `user.listUG` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40003` |
| `users` | body | yes | boolean | 请求用户映射列表 | 无类别参数时默认 `true` | `true` |
| `groups` | body | yes | boolean | 请求组映射列表 | 无类别参数时默认 `true` | `true` |
| `uver` | body | no | number | 缓存的映射版本令牌 | 非负整数 | `0` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `users` | no | array | 用户名称/ID 映射 | 请求且后端发送完整数据时出现 | `[{"user":"alice","uid":1000}]` |
| `groups` | no | array | 组名称/ID 映射 | 请求且后端发送完整数据时出现 | `[{"group":"Users","gid":1001}]` |
| `uver` | no | number | 当前映射版本令牌 | 伴随完整响应出现 | `110769999839232` |
| `upToDate` | no | boolean | 缓存命中标记 | 版本匹配时出现 | `true` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |

---

### user.groupList

#### Endpoint
`user.groupList`

#### Purpose
列出 TRIM 组，可选使用后端 `uver` 缓存令牌。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-list`
- `trim-cli --host <host> --port <port> user group-list --uver <n>`

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupList` | `user.groupList` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40004` |
| `uver` | body | no | number | 缓存的组列表版本令牌 | 非负整数 | `0` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `groups` | no | array | 组摘要 | 后端发送完整列表数据时出现 | `[{"group":"Administrators","gid":1000}]` |
| `uver` | no | number | 当前组列表版本令牌 | 伴随完整响应出现 | `110779500068864` |
| `upToDate` | no | boolean | 缓存命中标记 | 版本匹配时出现 | `true` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |

---

### user.groupInfo

#### Endpoint
`user.groupInfo`

#### Purpose
返回指定 TRIM 组的详细元数据。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-info <group>`

CLI 行为:
- CLI 在发送请求前本地修剪并验证位置参数组名。
- 命令复用正常的已保存会话恢复流程。
- CLI 原样打印后端载荷，不做本地重塑。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupInfo` | `user.groupInfo` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40005` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `Administrators` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `groupInfo` | no | object | 详细组元数据 | 包含 `group`、`gid`、`comment` 和 `users` | `{"group":"Administrators","gid":1000,"users":["alice"]}` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `404` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `group not found` |

#### Protocol Notes
- 请求参数仅包含 `{ group }`。
- `groupInfo.users` 类型为 `string[]`，CLI 不将该字段重新解释为 UID 数据。
- `groupInfo.users` 可能被某些固件版本省略（例如对默认 `Users` 组不返回该字段），因此 CLI 原样打印后端载荷，不假设每个固件响应都包含该字段。

---

### user.groupUsers

#### Endpoint
`user.groupUsers`

#### Purpose
列出 TRIM 组及其成员用户 ID，支持可选的 `uver` 缓存语义。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-users`
- `trim-cli --host <host> --port <port> user group-users --uver <n>`

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupUsers` | `user.groupUsers` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40005` |
| `uver` | body | no | number | 缓存的组成员版本令牌 | 非负整数 | `0` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `groups` | no | array | 组/成员映射列表 | 成员列表为 UID 数组 | `[{"group":"Administrators","users":[1000,1001]}]` |
| `uver` | no | number | 当前组成员版本令牌 | 伴随完整响应出现 | `110779500068864` |
| `upToDate` | no | boolean | 缓存命中标记 | 版本匹配时出现 | `true` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |

---

### user.groupAdd

#### Endpoint
`user.groupAdd`

#### Purpose
创建带可选备注的 TRIM 组。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-add <group> [--comment <comment>] [--yes]`

CLI 行为:
- 遵循参数优先的写模式，使用正常的已保存会话恢复流程。
- `group` 是必需的位置参数，发送前会修剪。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupAdd` | `user.groupAdd` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40010` |
| `group` | body | yes | string | 要创建的组名 | 修剪后的 CLI 位置参数 | `devops` |
| `comment` | body | no | string | 组备注/标签 | 空白或未设置时省略 | `DevOps Team` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `group exists` |

---

### user.groupMod

#### Endpoint
`user.groupMod`

#### Purpose
修���现有 TRIM 组的选定字段。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-mod <group> [--new-name <group>] [--comment <comment>] [--yes]`

CLI 行为:
- 遵循参数优先的变更映射，要求至少一个变更字段。
- `--new-name` 和 `--comment` 都是可选的，但至少须提供一个。
- 使用最小载荷策略：仅发送明确提供的变更字段。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupMod` | `user.groupMod` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40011` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `devops` |
| `newName` | body | no | string | 新组名 | 未设置时省略 | `devops-core` |
| `comment` | body | no | string | 组备注/标签 | 空白或未设置时省略 | `Core DevOps Team` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `group not found` |

#### Protocol Notes
- 最小载荷策略在请求发送前由 CLI 强制执行：如果未提供变更字段，命令在本地失败。
- `group` 始终发送；`newName` 和 `comment` 仅在明确提供时包含。

---

### user.groupDel

#### Endpoint
`user.groupDel`

#### Purpose
删除 TRIM 组。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-del <group> [--yes]`

CLI 行为:
- 使用参数优先的确认流程，除非提供 `--yes`，否则要求确认。
- 请求载荷中仅发送目标组名。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupDel` | `user.groupDel` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40012` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `devops-core` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `group not found` |

---

### user.groupSetUsers

#### Endpoint
`user.groupSetUsers`

#### Purpose
替换 TRIM 组的完整成员列表。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-set-users <group> --users <user> [--users <user> ...] [--yes]`

CLI 行为:
- `--users` 是必需的，可重复；每个值也可包含逗号分隔的用户名。
- CLI 解析拆分逗号分隔值、修剪空白、移除空项并去重后发送。
- 当前 CLI 要求至少一个解析后的用户条目；空替换列表在本地被拒绝。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupSetUsers` | `user.groupSetUsers` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40013` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `devops-core` |
| `users` | body | yes | string[] | 替换的成员用户名 | 从可重复/逗号分隔的 `--users` 值解析 | `["alice","bob","carol"]` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `invalid users` |

---

### user.groupAddUsers

#### Endpoint
`user.groupAddUsers`

#### Purpose
向现有 TRIM 组添加成员，不替换现有成员。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-add-users <group> --users <user> [--users <user> ...] [--yes]`

CLI 行为:
- `--users` 是必需的，可重复或逗号分隔传递。
- CLI 解析规则与 `group-set-users` 一致：拆分、修剪、去空、去重。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupAddUsers` | `user.groupAddUsers` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40014` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `devops-core` |
| `users` | body | yes | string[] | 要添加的用户 | 从可重复/逗号分隔的 `--users` 值解析 | `["dave","erin","frank"]` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `invalid users` |

---

### user.groupDelUsers

#### Endpoint
`user.groupDelUsers`

#### Purpose
从现有 TRIM 组中移除指定成员。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user group-del-users <group> --users <user> [--users <user> ...] [--yes]`

CLI 行为:
- `--users` 是必需的，可重复或逗号分隔传递。
- CLI 解析规则与 `group-set-users`/`group-add-users` 一致：拆分、修剪、去空、去重。
- 除非提供 `--yes`，否则命令要求确认。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.groupDelUsers` | `user.groupDelUsers` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40015` |
| `group` | body | yes | string | 目标组名 | 修剪后的 CLI 位置参数 | `devops-core` |
| `users` | body | yes | string[] | 要移除的用户 | 从可重复/逗号分隔的 `--users` 值解析 | `["frank"]` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `invalid users` |

---

### user.listLoginDevice

#### Endpoint
`user.listLoginDevice`

#### Purpose
列出当前用户的登录设备。

#### Trim CLI Mapping
已实现命令:
- `trim-cli --host <host> --port <port> user list-login-device`

CLI 行为:
- CLI 除公共信封外不发送额外请求字段。
- 响应原样打印，因为设备记录的可选字段在不同固件版本和运行时示例中已知存在差异。

#### Request
| Field | Location | Required | Type | Meaning | Constraints / Notes | Example |
| --- | --- | --- | --- | --- | --- | --- |
| `req` | body | yes | string | 端点选择器 | 固定值 `user.listLoginDevice` | `user.listLoginDevice` |
| `reqid` | body | yes | string | 请求关联 ID | 每请求生成 | `69bd2b7d69ba2df8000004c40006` |

#### Response
| Field | Always Present | Type | Meaning | Conditions / Notes | Example |
| --- | --- | --- | --- | --- | --- |
| `loginDevice` | no | array | 登录设备记录 | 包含 `tid`、`loginTime` 及可选的 `activeTime`、`currentDevice`、`deviceName`、`deviceType` | `[{"tid":"...","currentDevice":true}]` |
| `result` | no | string | 终结标记 | `succ`/`fail` | `succ` |
| `errno` | no | number | 数字错误码 | 失败时出现 | `65534` |
| `errmsg` | no | string | 错误描述 | 失败时出现 | `not logged in` |

#### Protocol Notes
- 部分设备行可能省略 `deviceName` 或 `deviceType`；当前 CLI 因此不假设这些字段始终存在。
- 此端点在当前 CLI 中为自助服务端点。

---

## 注意事项
- 部分用户/组变更端点需要管理员权限，具体范围以后端实际行为为准。
- `user.login` 中用户名字段（`user` vs `username`）在不同固件版本间可能存在差异。
- `user.active` 的具体行为（心跳、会话状态查询或两者兼有）及其载荷格式尚待确认。
- `user.listLoginDevice` 设备记录中 `deviceName` / `deviceType` 字段在不同固件版本中的可选性可能不同。

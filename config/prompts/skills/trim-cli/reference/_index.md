# trim-cli 参考索引

本目录既提供模块 reference，也提供面向 Agent 的任务入口。优先按任务找文档；只有当你已经清楚目标模块时，才直接跳到模块表。

## 按任务找文档

| 任务 | 先看文档 | 何时继续下钻 |
| --- | --- | --- |
| 登录、登出、连接失败、session 回落 | [user.md](user.md) | 需要用户、用户组或登录设备详情时继续看 `user.md` |
| 列目录、判断当前用户目录、搜索文件 | [workflows/file-routing.md](workflows/file-routing.md) | 确认命令方向后，再看 [file.md](file.md) |
| 看共享目录、ACL、别人共享给我的文件 | [workflows/file-routing.md](workflows/file-routing.md) | 需要 `file share.*` 或 `file.getAcl` 细节时，再看 [file.md](file.md) |
| 查看下载任务、创建下载任务 | [download.md](download.md) | 下载任务路径仍要遵守 canonical `/vol{n}/...` 规则 |
| 查看或管理应用中心应用、安装 fpk | [app-center.md](app-center.md) | 写操作需要 `--yes`，复杂依赖/向导转 App Center UI |
| 查看系统信息、CPU、内存、日志 | [sysinfo.md](sysinfo.md)、[resmon.md](resmon.md)、[log.md](log.md) | 根据具体目标跳到对应模块 |
| 查看 Docker 镜像、容器、Compose，或执行启停/删除 | [dockermgr.md](dockermgr.md) | 长耗时和删除类操作先看模块里的高风险提醒 |
| 查看存储池、磁盘、SMART | [stor.md](stor.md) | 读操作可直接在模块文档中选命令 |
| 做挂载、卸载、扩容、替盘、格式化、弹出等存储写操作 | [workflows/storage-dangerous-ops.md](workflows/storage-dangerous-ops.md) | 确认顺序后，再看 [stor.md](stor.md) 的字段和端点约束 |
| 做真机验证 | [workflows/device-validation.md](workflows/device-validation.md) | 具体接口细节再回对应模块文档 |

## workflow 目录

| 文档 | 用途 |
| --- | --- |
| [workflows/file-routing.md](workflows/file-routing.md) | 路由文件相关需求，区分 `/`、当前用户目录、具体 `/vol{n}/...`、共享目录和搜索入口 |
| [workflows/storage-dangerous-ops.md](workflows/storage-dangerous-ops.md) | 在高风险存储写操作前固定先做只读探测、密码验证和确认 |
| [workflows/device-validation.md](workflows/device-validation.md) | 统一真机验证账号顺序、最小探测、写后回归和清理口径 |

## 正式入口目录

| 文档 | 用途 |
| --- | --- |
| [../entries/trim-shared.md](../entries/trim-shared.md) | 通用连接、session、wrapper、真机验证规则 |
| [../entries/trim-file.md](../entries/trim-file.md) | 文件、共享目录、ACL、路径路由 |
| [../entries/trim-storage.md](../entries/trim-storage.md) | 存储池、磁盘、SMART、高风险写操作 |
| [../entries/trim-docker.md](../entries/trim-docker.md) | Docker 镜像、容器、Compose 和长耗时操作 |
| [../entries/trim-user.md](../entries/trim-user.md) | 认证、用户、用户组、权限确认 |
| [../entries/trim-download.md](../entries/trim-download.md) | 下载任务列表/详情、创建、暂停/恢复/重试/删除、路径校验 |
| [../entries/trim-app.md](../entries/trim-app.md) | 应用中心应用列表、状态、安装、fpk 手动安装、更新、启动、停用、卸载 |
| [../entries/trim-log.md](../entries/trim-log.md) | 日志列表、模块过滤、清除/导出/归档、老版本接口提醒 |
| [../entries/trim-system.md](../entries/trim-system.md) | 静态系统信息、机器类型、版本、身份识别 |
| [../entries/trim-monitor.md](../entries/trim-monitor.md) | 运行态指标（CPU、内存）和 resmon 指标路由 |

## 按模块找文档

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| user | [user.md](user.md) | 认证、用户管理、用户组管理、登录设备 |
| file | [file.md](file.md) | 文件操作、finder 搜索、共享目录、ACL |
| download | [download.md](download.md) | 下载任务查询、创建、控制 |
| app-center | [app-center.md](app-center.md) | 应用中心查询、安装、更新、启动、停用、卸载 |
| stor | [stor.md](stor.md) | 存储池、磁盘、SMART、挂载/弹出、格式化 |
| dockermgr | [dockermgr.md](dockermgr.md) | Docker 镜像、容器、网络、Compose 管理 |
| log | [log.md](log.md) | 日志查询、导出、清除、归档策略 |
| resmon | [resmon.md](resmon.md) | CPU、内存等资源监控 |
| sysinfo | [sysinfo.md](sysinfo.md) | 系统信息和机器类型 |

## 文档约定

所有模块文档遵循 [_conventions.md](_conventions.md) 定义的统一格式。workflow 文档只负责操作顺序、停手条件和常见误判，不重复完整字段表。

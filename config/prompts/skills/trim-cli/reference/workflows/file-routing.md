# 文件路径与共享目录路由 workflow

这个 workflow 用来先判断“应该走哪个文件命令”，再决定是否进入 `file.md` 看字段细节。

## 1. 先判断用户要做的是哪一类事

| 用户意图 | 优先命令 | 不要先猜什么 |
| --- | --- | --- |
| 看当前可见目录 | `trim-cli file ls` | 不要先假设 `/` 会列出所有 volume；无参数和 `/` 都会省略 `path` 发请求 |
| 看某个具体目录 | `trim-cli file ls /vol{n}/...` | 不要把聚合根和具体 canonical 路径混用 |
| 在当前用户目录下搜文件 | `trim-cli file search <key>` | 不要手工猜当前用户目录；CLI 会先探测再推导 |
| 在指定目录下搜文件 | `trim-cli file search <key> /vol{n}/...` | 不要传聚合根或非 canonical 路径 |
| 搜“别人共享给我”的文件 | `trim-cli file search-others <key>` | 不要把它当成 `file share list` 的别名 |
| 看共享目录元数据 | `trim-cli file share info <path>` | 不要混成 share link 管理 |
| 列可见共享目录 | `trim-cli file share list [uid]` | 不要把它当成文件搜索 |
| 看 ACL | `trim-cli file acl get <path>` | 不要把 ACL 查询和共享目录查询混成同一个概念 |
| 创建、删除、复制、移动文件 | `file mkdir/rm/cp/mv` | 不要对写操作使用聚合根 |

## 2. 路径判断顺序

先按下面顺序判断：

1. 如果是写操作，路径必须是具体 canonical 路径：`/vol{n}/...`
2. 如果是列目录，`file ls` 和 `file ls /` 都是“省略 `path`”模式
3. 如果是无路径搜索，先让 CLI 通过 `file.ls` 探测当前用户目录
4. 如果是显式搜索路径，每个路径都必须是 `/vol{n}/...`
5. 如果问题里提到“共享给我”“别人共享”，优先判断是否该走 `search-others` 或 `share list-others`

## 3. 常见误判

- `file ls /` 不是显式请求“聚合根路径 `/`”，而是省略 `path`
- “共享目录”是 `file share.*` 语义，不是 share link
- `file search-others` 返回的是“别人共享给当前用户的文件搜索结果”，不是共享目录列表
- `file acl get` 查的是权限信息，不等同于共享目录状态
- `file cp` / `file mv` 的目标参数是目标目录，不是最终文件路径

## 4. 什么时候必须停下来确认

- 用户要做写操作，但只给了 `/`、相对路径或模糊路径
- 用户说“共享链接”而你手头只有 `file share.*` 文档
- 用户要在多条路径下搜索，但路径里混有非 `/vol{n}/...` 形式
- 用户把“当前用户目录”当成固定值，而不是设备返回和 session 推导结果

## 5. 下一步

- 已经确定命令方向：去看 [../file.md](../file.md)
- 仍然不确定路径语义：先停在这里，不要继续猜 payload

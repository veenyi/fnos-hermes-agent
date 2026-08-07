---
name: trim-network
description: 管理网络相关开关，当前覆盖 SSH 服务开关
---

# trim-network

## 什么时候看这个 skill

- 需要开启或关闭 TRIM NAS / fnOS 的 SSH 服务
- 需要确认网络类写操作的确认参数和风险

## 先看哪里

- 端点和字段：`../reference/network.md`
- 通用连接、登录和 session：`trim-shared.md`

## 使用原则

- `network ssh switch --enable` 会打开 SSH 服务，属于安全敏感操作，默认必须二次确认。
- 确认用户明确授权后，才可以使用 `--yes` 跳过交互确认。
- `--enable` 与 `--disable` 必须二选一，不能同时传，也不能都不传。

## 常用命令

```bash
./scripts/trim-cli network ssh switch --enable
./scripts/trim-cli network ssh switch --disable --yes
```

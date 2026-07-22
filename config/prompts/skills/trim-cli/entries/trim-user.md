---
name: trim-user
description: 当任务涉及认证、用户、用户组、登录设备，或需要先确认当前账号与权限时使用
---

# trim-user

## 什么时候看这个 skill

- 用户要登录、登出或检查账号信息
- 用户要看用户列表、用户组、登录设备
- 你不确定当前账号权限是否足够支撑后续操作

## 先看哪里

- 用户模块 reference：`../reference/user.md`
- 真机验证 workflow：`../reference/workflows/device-validation.md`

## 核心提醒

- 登录是多数真实操作的前置条件
- 真机验证时先按约定账号顺序准备管理员和非管理员账号
- 缺少凭据时不要猜测额外账号

## 常用命令

```bash
./scripts/trim-cli login -u <username> -p <password>
./scripts/trim-cli logout
```

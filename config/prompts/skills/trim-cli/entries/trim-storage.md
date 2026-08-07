---
name: trim-storage
description: 当任务涉及存储池、磁盘、SMART、挂载卸载、扩容替盘、格式化或其他高风险存储写操作时使用
---

# trim-storage

## 什么时候看这个 skill

- 用户要看存储池、磁盘、SMART、可移动设备
- 用户要做 `mount`、`umount`、`create`、`resize`、`format`、`eject`
- 你需要先判断目标到底是 pool 还是 disk
- 需要调用尚未封装为固定命令的 `stor.*` 端点

## 先看哪里

- 危险操作 workflow：`../reference/workflows/storage-dangerous-ops.md`
- 存储模块 reference：`../reference/stor.md`

## 核心提醒

- pool 使用 uuid 或 `trim_*`
- disk 使用纯设备名，如 `sda`、`nvme0n1`
- 高风险写操作前先执行 `storage pools` 和 `storage disks`
- 创建存储池前补 `storage free-disks`；系统盘剩余空间候选用返回的 `part`
- 缺密码时不要继续猜需要验密的命令
- 优先使用固定命令；只有固定命令缺失时再用 `storage request`，固定端点会被拒绝

## 常用命令

```bash
./scripts/trim-cli storage overview
./scripts/trim-cli storage pools
./scripts/trim-cli storage disks
./scripts/trim-cli storage free-disks
./scripts/trim-cli storage disk-info <disk>
./scripts/trim-cli storage disk-mount <disk>
./scripts/trim-cli storage disk-umount <disk>
./scripts/trim-cli storage smart <disk>
./scripts/trim-cli storage health <disk>
./scripts/trim-cli storage request stor.getConf --json '{"uuid":"trim_pool"}' --yes
```

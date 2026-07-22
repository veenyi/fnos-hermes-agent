---
name: trim-docker
description: 当任务涉及 Docker 镜像、容器、Compose、启停删除或长耗时 Docker 操作时使用
---

# trim-docker

## 什么时候看这个 skill

- 用户要看镜像、容器、Compose 项目
- 用户要拉镜像、启停容器、删除镜像或容器
- 你需要先区分观察类命令和变更类命令

## 先看哪里

- Docker 模块 reference：`../reference/dockermgr.md`

## 核心提醒

- 先观察，再变更；常见入口是 `docker stats`、`image ls`、`container ls`
- `image pull`、`container stop`、`container restart` 往往比读请求慢
- `container rm` 默认需要确认；`--force` 不等于 `--yes`
- 镜像引用和容器 ID 不要混用

## 常用命令

```bash
./scripts/trim-cli docker stats
./scripts/trim-cli docker image ls
./scripts/trim-cli docker image pull <imageRef>
./scripts/trim-cli docker container ls
./scripts/trim-cli docker compose ls
```

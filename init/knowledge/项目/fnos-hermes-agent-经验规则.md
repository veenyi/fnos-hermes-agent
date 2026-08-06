---
created: 2026-08-06T17:10:00.000Z
tags: [项目, fnos-hermes-agent, 经验, 规则]
---

# fnos-hermes-agent 项目经验与开发规则

> 本笔记沉淀自你提供的 7 份项目记忆文件，是 `[[fnos-hermes-agent]]` 项目的核心作战手册。

## 项目身份

- **应用名**：fnos-hermes-agent（飞牛 fnOS 第三方 Hermes Agent 应用）
- **当前版本**：v0.21.84
- **GitHub**：[veenyi/fnos-hermes-agent](https://github.com/veenyi/fnos-hermes-agent)
- **源码路径**：`/mnt/nas-hermes/fnos-hermes-agent`
- **目标 FPK**：`/mnt/nas-hermes/out/fnos-hermes-agent-0.21.84.fpk`
- **WebDAV 上传**：`/mnt/nas-hermes/webdav/out/fnos-hermes-agent-0.21.84.fpk`

## 双机环境

| 主机 | IP | 卷 | 角色 |
|---|---|---|---|
| 102 | 192.168.3.102 | @vol1 | 自用真机，**只读不动** |
| 249 | 192.168.3.249 | @vol3 | 测试机，**可随意操作** |

## 铁律（必须遵守）

### 发布纪律
- 发布 / GitHub push / Release **必须等你显式确认**（v0.22.1 擅发被撤回的血泪教训）
- 每次发布**先双机真机验证**再发布
- 版本号以 v0.22.x 为主，v0.21.84 为过渡
- 发布后同步 WebDAV + 分享直链（通道不可混用）

### 开发纪律
- **凭证绝不进代码**（alist 密码泄露事件，强烈建议改密）
- 后端接口先查 `custom_routes.js` 是否拦截
- 改完 UI 必须重启 Agent 再访问
- YAML 用专用函数写入，别手拼
- 应用默认语言简体中文
- 需求清晰直接开工，不追问

### 验证铁律
- 文件写入必须用 `stat` 验证真实落盘（sandbox overlay 会骗人）
- 持久化三查：POST 落盘 / GET 读回 / 刷新重启保留
- `uv` 是唯一 Python 包管理器，没有全局 python/pip

## 工作习惯
- 每天写工作记忆（Obsidian 风格笔记）
- 工作记忆全记录（含失败经验）
- 导入 81 个扁平技能到 `skills/` 顶层

## 关联
- [[fnos-hermes-agent 版本演进史]]
- [[v0.22 升级方案]]
- [[v2 升级方案（Octop 风格）]]
- [[开发规范细则]]
- [[用户档案与工作规则]]
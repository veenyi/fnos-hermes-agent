---
created: 2026-08-06T17:10:00.000Z
tags: [项目, fnos-hermes-agent, 版本]
---

# fnos-hermes-agent 版本演进史

> 从 v0.20.38 起源到 v0.21.84 的完整演进（A→H 阶段）。

## 阶段概览

| 阶段 | 版本区间 | 重点 |
|---|---|---|
| A 起源 | v0.20.38 | 初版打包 |
| B 知识化 | 早期 | 知识库 / Obsidian 风格 |
| C 稳定性 | v0.20.x | 连接稳定性、防卡 |
| D 语音 | v0.21.x 前期 | 语音对话 P0 |
| E 增强 | v0.21.x 中期 | 飞牛操作员增强 |
| F 自动更新 | v0.21.x | 自动更新机制 |
| G 企微修复 | v0.21.68+ | 企微群聊 / 推送修复 |
| H 经验沉淀 | v0.21.84 | 本记忆包 |

## 12 项重要 Bug 排查
- 连接拒绝
- agent 不可用
- 501 POST 错误
- 全英文界面（应默认简体中文）
- CSRF 跨域
- 企微群聊不回复（group_policy 默认 pairing 静默丢弃）
- 企微出站推送 wecom 分支缺失
- WECOM_HOME_CHANNEL 须写 profile 级 .env
- 语音麦克风 HTTP 安全限制
- 聊天 DOM 超 60 条卡顿（折叠方案）
- alist 凭证泄露
- gateway 启动异常

## 关联
- [[fnos-hermes-agent 经验规则]]
- [[v0.22 升级方案]]
- [[wecom 企微群消息修复说明]]
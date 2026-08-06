---
created: 2026-08-06T17:10:00.000Z
tags: [项目, wecom, 企微, Bug修复]
---

# wecom 企微群消息修复说明

## 根因

1. **群聊不回复**：`group_policy` 默认 `pairing`，会静默丢弃群消息
2. **出站推送失败**：`wecom` 分支缺失
3. **HOME_CHANNEL 不生效**：须写到 profile 级 `.env`

## 修复内容

- 调整 group_policy 配置
- 补齐出站推送 wecom 分支
- WECOM_HOME_CHANNEL 写入 profile 级 `.env`

## 关联
- [[fnos-hermes-agent 版本演进史]]
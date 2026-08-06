---
name: knowledge-sync
description: >
  当用户说"记下来""沉淀这个""把这段存到知识库""同步到知识管理"时触发。
  也适用于：对话中产生了重要项目经验/结论/设计文档/决策记录，
  需要让 Hermes Studio 知识管理系统（Dashboard 可见、可搜、可反向链接）实时收录时。
  自动触发：每次重要结论、经验教训、设计方案产生后，主动同步，不等用户要求。
version: 1.0
---

# 知识同步规范（knowledge-sync）

## 目标

确保 Hermes 的**持久记忆**（`memories/`，每次对话注入给我）与**知识管理系统**
（`data/knowledge/`，Dashboard 可见、可搜、Obsidian 格式）之间**无缝同步**。

## 核心路径

```
data/
├── memories/
│   ├── MEMORY.md        # 我（Agent）的持久经验/规则，对话开头自动注入
│   └── USER.md          # 用户身份/偏好，对话开头自动注入
└── knowledge/           # 知识管理系统底层目录，Dashboard 实时扫描
    ├── 项目/
    │   └── *.md         # 项目经验、规则、方案、架构
    └── 笔记库/
        └── *.md         # 每日笔记、技能使用记录等
```

## 触发条件

以下任一情况触发同步，**不等用户要求**：

1. 用户说"记下来""沉淀这个""存到知识库""同步知识管理"
2. 对话中产生重要项目经验/教训/结论
3. 完成重要设计、方案、决策记录
4. 用户喂入一份文件（上传、粘贴）并期望长期保留

## 同步步骤

### 1. 确定知识条目

从对话内容提炼：标题、正文（markdown）、tags、创建时间。

### 2. 写入 knowledge 目录

```
data/knowledge/<分类>/<标题>.md
```

分类规则：
- 项目经验/规则/方案 → `项目/`
- 用户偏好/档案 → `项目/`
- 交付文档 → `项目/`
- 日常笔记 → `笔记库/<日期>.md`

### 3. 格式（Obsidian 兼容）

```markdown
---
created: <ISO时间戳>
tags:
  - <标签1>
  - <标签2>
---

# <标题>

正文内容...

## 相关
- [[关联条目名]]

## 来源
- 源自对话：YYYY-MM-DD <简要>
```

### 4. 双向链接

条目之间用 `[[文件名不带后缀]]` 做 wikilink，知识管理系统自动建立反向链接。
主索引 `项目/README.md` 维护目录。

### 5. 验证

用 `stat` 确认文件真实落盘（不是只 ls 看）。

## 回退与修正

- 用户要求回退：直接删除或还原对应 knowledge 文件
- 修正：patch 对应知识条目，保留 created 时间，追加修改记录
- 不要覆盖用户已有的 knowledge 文件，冲突时用 `_副本-YYYYMMDD` 后缀

## 与 memory 工具的关系

- `memory` 工具 → 写 `data/memories/`（我脑里）
- 本 skill → 写 `data/knowledge/`（Dashboard 可见）
- **两者互补**：重要内容同时走两条路，确保不丢
- 后台 `scripts/knowledge-sync/mirror.py` 定时把 `memories/` 全量镜像到
  `knowledge/项目/00-memories-auto/`，保证即使没触发本 skill 也不会断档

#!/usr/bin/env python3
"""
自动镜像脚本：把 Hermes 持久记忆（memories/）同步到知识管理系统（knowledge/）。

用途：即使 Agent 对话中忘记触发 knowledge-sync skill，这个脚本也会
在后台定时把 memories/ 全量镜像到 knowledge/ 下，确保两边永不断档。

运行方式：
  python3 /vol3/@apphome/hermes-agent/data/scripts/knowledge-sync/mirror.py

建议 cron：每小时一次，或每次对话结束后触发。
"""

import os
import sys
import shutil
import datetime

DATA_DIR = os.environ.get("HERMES_DATA_DIR") or "/vol3/@apphome/hermes-agent/data"
MEMORIES_DIR = os.path.join(DATA_DIR, "memories")
KNOWLEDGE_DIR = os.path.join(DATA_DIR, "knowledge", "项目", "00-memories-auto")

def main():
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)

    if not os.path.isdir(MEMORIES_DIR):
        print(f"[SKIP] memories/ 不存在: {MEMORIES_DIR}")
        return

    # 收集要镜像的文件
    files_to_mirror = []
    for f in os.listdir(MEMORIES_DIR):
        fp = os.path.join(MEMORIES_DIR, f)
        if os.path.isfile(fp) and f.endswith(".md"):
            files_to_mirror.append((f, fp))

    if not files_to_mirror:
        print(f"[SKIP] 无 .md 文件可镜像")
        return

    # 写入镜像条目
    mirrored = []
    for fname, fpath in files_to_mirror:
        dest_name = f"{fname}"
        dest_path = os.path.join(KNOWLEDGE_DIR, dest_name)

        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()

        # 加 frontmatter（保留原始内容）
        basename = os.path.splitext(fname)[0]
        frontmatter = (
            f"---\n"
            f"created: {now}\n"
            f"tags:\n"
            f"  - memories-auto\n"
            f"  - 持久记忆\n"
            f"---\n"
            f"\n"
            f"# {basename}（自动镜像）\n\n"
            f"> 本文档由 `knowledge-sync/mirror.py` 从 `memories/` 自动镜像生成。\n"
            f"> 镜像时间：{now}\n"
            f"> 源文件：`memories/{fname}`\n\n"
            f"---\n\n"
            f"{content}\n"
        )

        with open(dest_path, "w", encoding="utf-8") as f:
            f.write(frontmatter)
        mirrored.append(fname)

    # 写入镜像索引
    index_path = os.path.join(KNOWLEDGE_DIR, "README.md")
    index = (
        f"# 持久记忆自动镜像\n\n"
        f"由 `knowledge-sync/mirror.py` 自动同步自 `memories/`。\n\n"
        f"最近同步时间：**{now}**\n\n"
        f"## 文件清单\n\n"
    )
    for fname in sorted(mirrored):
        basename = os.path.splitext(fname)[0]
        index += f"- [[{basename}]]\n"

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index)

    print(f"[OK] 镜像 {len(mirrored)} 个文件到 {KNOWLEDGE_DIR}")
    print(f"[OK] 索引写入 {index_path}")

if __name__ == "__main__":
    main()

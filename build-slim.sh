#!/bin/bash
# build-slim.sh — 精简打包：排除 hermes-src 开发/文档内容后 fnpack build
# 用法：在 chat-1 根目录运行；产出 hermes-agent.fpk 于当前目录
# 原理：fnpack 无排除机制（实测 .fnpackignore/.gitignore 均无效），
#       故用 robocopy 复制仓库副本时按目录名排除，再对副本打包。
set -u
CHAT1="C:/Users/veenyi/Documents/QoderCN/2026-08-02/chat-1"
SRC="$CHAT1/fnos-hermes-agent"
DST="$CHAT1/fnos-hermes-agent-slim"
cd "$CHAT1" || { echo "chat-1 dir missing"; exit 1; }

echo "===== [1] robocopy 镜像复制（全量，仅排除 .git/pkg/*.fpk） ====="
# MSYS2_ARG_CONV_EXCL='*' 防止 git bash 把 /E /XD 等参数转换成盘符路径
# 说明：robocopy /XD 按路径排除在此环境下不可靠（正斜杠/反斜杠兼容问题），
# 改为全量镜像后显式删除副本中的开发/文档目录（见步骤 1b）。
# 曾因按目录名排除误伤 app/ui/scripts（marked 库）与 web_dist/assets，导致
# markdown 无格式 + Dashboard 启动崩 —— 运行资源必须保留。
MSYS2_ARG_CONV_EXCL='*' robocopy "$SRC" "$DST" /MIR \
  /XD "$SRC/.git" "$SRC/pkg" \
  /XF *.fpk \
  /MT:16 /NFL /NDL /NJH /NJS /NP
RC=$?
if [ "$RC" -ge 8 ]; then echo "robocopy failed rc=$RC"; exit 1; fi
echo "copy done (rc=$RC)"

echo ""
echo "===== [1b] 删除副本 hermes-src 开发/文档目录（保留运行必需资源） ====="
rm -rf "$DST/app/hermes-src/tests" \
       "$DST/app/hermes-src/apps" \
       "$DST/app/hermes-src/website" \
       "$DST/app/hermes-src/docs" \
       "$DST/app/hermes-src/.github" \
       "$DST/app/hermes-src/assets" \
       "$DST/app/hermes-src/contributors" \
       "$DST/app/hermes-src/scripts"
echo "dev dirs removed"
# 断言：运行必需资源必须在（缺失则中止）
for req in "$DST/app/ui/scripts/marked.min.js" "$DST/app/hermes-src/hermes_cli/web_dist/assets"; do
  if [ ! -e "$req" ]; then echo "FATAL: 运行资源缺失 $req"; exit 1; fi
done
echo "runtime resources verified"

echo ""
echo "===== [2] 副本 manifest 版本确认 ====="
grep '^version' "$DST/manifest"

echo ""
echo "===== [3] 副本 hermes-src 大小 ====="
du -sh "$DST/app/hermes-src" 2>/dev/null

echo ""
echo "===== [4] fnpack build ====="
./fnpack.exe build --directory "$DST" 2>&1 | tail -2

echo ""
echo "===== [5] 产物 ====="
ls -la hermes-agent.fpk 2>/dev/null


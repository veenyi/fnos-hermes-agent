#!/bin/bash
# build-slim.sh — 精简打包：排除 hermes-src 开发/文档内容后 fnpack build
# 用法：在 chat-1 根目录运行；产出 hermes-agent.fpk 于当前目录
# v0.21.149：隐私加固——robocopy 排除个人信息文件 + 打包副本二次扫描清除
set -u
CHAT1="C:/Users/veenyi/Documents/QoderCN/2026-08-02/chat-1"
SRC="$CHAT1/fnos-hermes-agent"
DST="$CHAT1/fnos-hermes-agent-slim"
cd "$CHAT1" || { echo "chat-1 dir missing"; exit 1; }

echo "===== [1] robocopy 镜像复制（排除 .git/pkg/*.fpk/开发文档/个人信息文件） ====="
# MSYS2_ARG_CONV_EXCL='*' 防止 git bash 把 /E /XD 等参数转换成盘符路径
# 说明：robocopy /XD 按路径排除在此环境下不可靠（正斜杠/反斜杠兼容问题），
# 改为全量镜像后显式删除副本中的开发/文档目录（见步骤 1b）。
# 曾因按目录名排除误伤 app/ui/scripts（marked 库）与 web_dist/assets，导致
# markdown 无格式 + Dashboard 启动崩 —— 运行资源必须保留。
# v0.21.149：隐私加固——额外排除开发者工作记忆/旧备份/旧 init 缓存（含个人信息的文件绝不进包）
MSYS2_ARG_CONV_EXCL='*' robocopy "$SRC" "$DST" /MIR \
  /XD "$SRC/.git" "$SRC/pkg" "$SRC/_restore021" \
  /XF *.fpk WORK-MEMORY.md init-pack.tgz *.bak \
  /MT:16 /NFL /NDL /NJH /NJS /NP
RC=$?
if [ "$RC" -ge 8 ]; then echo "robocopy failed rc=$RC"; exit 1; fi
echo "copy done (rc=$RC)"

echo ""
echo "===== [1a] 隐私兜底：副本内二次清除个人信息关键词命中文件 ====="
# 防御纵深：即使源目录混入（如误创建临时脚本），打包副本也绝不携带
grep -rlE "Ferr0li|紫寒" "$DST" 2>/dev/null | while read -r f; do
  echo "隐私清除: $f"; rm -f "$f"
done
grep -rlE "C:\\\\Users\\\\veenyi" "$DST" 2>/dev/null | while read -r f; do
  echo "隐私清除(路径): $f"; rm -f "$f"
done

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

echo ""
echo "===== [6] 归档到 pkg/ 并同步 WebDAV ====="
VER=$(grep '^version' "$DST/manifest" | awk '{print $3}')
mkdir -p "$SRC/pkg"
mv -f hermes-agent.fpk "$SRC/pkg/fnos-hermes-agent_v$VER.fpk" 2>/dev/null || { echo "WARN: 产物移动失败（可能已归档）"; }
echo "归档: pkg/fnos-hermes-agent_v$VER.fpk"
bash "$CHAT1/sync-fpk-webdav.sh" 2>&1 | tail -8

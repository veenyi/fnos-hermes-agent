#!/bin/bash
# sync-fpk-webdav.sh — 上传最新 FPK 到 alist WebDAV（nas.aio.run:5244/dav/FnosAPP/）
# 用法：bash sync-fpk-webdav.sh [指定.fpk 路径（默认 pkg 下最新）]
# 每次打包完成后运行本脚本，把安装包同步一份到用户飞牛（tim/Ferr0li@123）
set -u
CHAT1="C:/Users/veenyi/Documents/QoderCN/2026-08-02/chat-1"
PKG_DIR="$CHAT1/fnos-hermes-agent/pkg"
WEBDAV_BASE="http://nas.aio.run:5244/dav/FnosAPP"
WD_USER="tim"
WD_PASS="Ferr0li@123"

FPK="${1:-}"
if [ -z "$FPK" ]; then
  FPK=$(ls -t "$PKG_DIR"/fnos-hermes-agent_v*.fpk 2>/dev/null | head -1)
fi
[ -z "$FPK" ] || [ ! -f "$FPK" ] && { echo "ERROR: FPK 不存在: $FPK"; exit 1; }

NAME=$(basename "$FPK")
SIZE=$(stat -c '%s' "$FPK")
echo "===== 同步 $NAME ($((SIZE/1048576))MB) → $WEBDAV_BASE/ ====="
curl -s --connect-timeout 20 --max-time 600 -u "$WD_USER:$WD_PASS" -T "$FPK" "$WEBDAV_BASE/$NAME" -o /dev/null -w 'PUT: %{http_code}\n'
RC=$?
if [ "$RC" -ne 0 ]; then echo "ERROR: 上传失败 rc=$RC"; exit 1; fi

# 校验：远端大小与本地一致
REMOTE=$(curl -s --connect-timeout 20 --max-time 30 -u "$WD_USER:$WD_PASS" -I "$WEBDAV_BASE/$NAME" 2>/dev/null | grep -i content-length | tr -d '\r' | awk '{print $2}')
echo "本地大小: $SIZE | 远端大小: ${REMOTE:-?}"
if [ "$REMOTE" = "$SIZE" ]; then
  echo "SYNC OK ✅  $NAME 已同步到 WebDAV"
else
  echo "SYNC MISMATCH ❌ 请检查网络后重试"
  exit 1
fi

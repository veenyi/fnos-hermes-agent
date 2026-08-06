#!/bin/bash
# sync-fpk-webdav.sh — 同步 FPK 安装包 + 更新记录 MD 到 alist WebDAV（nas.aio.run:5244/dav/FnosAPP/）
# 用法：bash sync-fpk-webdav.sh [指定.fpk 路径（默认 pkg 下最新）]
#   -md  仅上传更新记录 MD（不传 FPK）
# 每次打包完成后运行，把安装包与 fnos-hermes-agent.md（单一持续更新记录）同步到用户飞牛
set -u
CHAT1="C:/Users/veenyi/Documents/QoderCN/2026-08-02/chat-1"
PKG_DIR="$CHAT1/fnos-hermes-agent/pkg"
UPDATE_MD="$CHAT1/fnos-hermes-agent/UPDATE-LOG.md"
WEBDAV_BASE="http://nas.aio.run:5244/dav/FnosAPP"
WD_USER="tim"
# 密码从本地安全文件读取（不进入 git 仓库，防止泄露）：
#   文件：~/.qwenworkcn/webdav-credentials（格式：第一行密码）
WD_PASS=""
CRED_FILE="$HOME/.qwenworkcn/webdav-credentials"
if [ -f "$CRED_FILE" ]; then
  WD_PASS=$(head -1 "$CRED_FILE" 2>/dev/null | tr -d '\r\n')
fi
if [ -z "$WD_PASS" ]; then
  echo "ERROR: 未找到 WebDAV 密码（请写入 $CRED_FILE 第一行，或设置环境变量 WD_PASS）"
  exit 1
fi

MD_ONLY=0
[ "${1:-}" = "-md" ] && MD_ONLY=1

# ── 1) 更新记录 MD ──
if [ -f "$UPDATE_MD" ]; then
  echo "===== 同步更新记录 → $WEBDAV_BASE/fnos-hermes-agent.md ====="
  curl -s --connect-timeout 20 --max-time 120 -u "$WD_USER:$WD_PASS" -T "$UPDATE_MD" "$WEBDAV_BASE/fnos-hermes-agent.md" -o /dev/null -w 'PUT: %{http_code}\n'
  MD_SIZE=$(stat -c '%s' "$UPDATE_MD")
  MD_REMOTE=$(curl -s --connect-timeout 20 --max-time 30 -u "$WD_USER:$WD_PASS" -I "$WEBDAV_BASE/fnos-hermes-agent.md" 2>/dev/null | grep -i content-length | tr -d '\r' | awk '{print $2}')
  [ "$MD_REMOTE" = "$MD_SIZE" ] && echo "MD SYNC OK ✅" || echo "MD SYNC MISMATCH ⚠️"
else
  echo "WARN: UPDATE-LOG.md 不存在，跳过 MD 同步"
fi

[ "$MD_ONLY" = "1" ] && { echo "（-md 模式完成）"; exit 0; }

# ── 2) FPK 安装包 ──
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

REMOTE=$(curl -s --connect-timeout 20 --max-time 30 -u "$WD_USER:$WD_PASS" -I "$WEBDAV_BASE/$NAME" 2>/dev/null | grep -i content-length | tr -d '\r' | awk '{print $2}')
echo "本地大小: $SIZE | 远端大小: ${REMOTE:-?}"
if [ "$REMOTE" = "$SIZE" ]; then
  echo "SYNC OK ✅  $NAME 已同步到 WebDAV"
else
  echo "SYNC MISMATCH ❌ 请检查网络后重试"
  exit 1
fi

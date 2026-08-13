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
FPK_FILE="${1:-}"
if [ -z "$FPK_FILE" ] || [ "$FPK_FILE" = "-md" ]; then
  FPK_FILE=$(ls -t "$PKG_DIR"/fnos-hermes-agent_v*.fpk 2>/dev/null | head -1)
fi
if [ -z "$FPK_FILE" ] || [ ! -f "$FPK_FILE" ]; then
  echo "ERROR: 未找到 FPK 安装包（$PKG_DIR 下无 fnos-hermes-agent_v*.fpk）"
  exit 1
fi
FPK_NAME=$(basename "$FPK_FILE")
echo "===== 同步 $FPK_NAME → $WEBDAV_BASE/ ====="
curl -s --connect-timeout 20 --max-time 600 -u "$WD_USER:$WD_PASS" -T "$FPK_FILE" "$WEBDAV_BASE/$FPK_NAME" -o /dev/null -w 'PUT: %{http_code}\n'
FPK_SIZE=$(stat -c '%s' "$FPK_FILE")
FPK_REMOTE=$(curl -s --connect-timeout 20 --max-time 30 -u "$WD_USER:$WD_PASS" -I "$WEBDAV_BASE/$FPK_NAME" 2>/dev/null | grep -i content-length | tr -d '\r' | awk '{print $2}')
echo "本地大小: $FPK_SIZE | 远端大小: $FPK_REMOTE"
if [ "$FPK_REMOTE" = "$FPK_SIZE" ]; then
  echo "SYNC OK ✅  $FPK_NAME 已同步到 WebDAV"
else
  echo "SYNC MISMATCH ⚠️"
fi

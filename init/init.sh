#!/bin/bash
# init.sh — 首次安装初始化：部署知识模板 + 记忆模板 + 镜像脚本 + knowledge-sync 技能 + crontab
# 由 cmd/install 调用（fpk 安装时）；copy_if_new 语义：目标已存在则保留（升级不覆盖用户内容）
# 作者：Hermes Agent 方案（2026-08-07），千问整合进 fpk

set -u
# 路径环境变量：fnOS 标准回调传入 TRIM_PKGHOME/TRIM_APPDEST/TRIM_PKGVAR
DATA_DIR="${TRIM_PKGHOME:-/vol1/@apphome/hermes-agent}/data"
INIT_DIR="${TRIM_APPDEST:-/var/apps/hermes-agent/target}/init"
LOG_FILE="${TRIM_PKGVAR:-/var/apps/hermes-agent/var}/info.log"

log_msg() {
    local msg="$(date '+%Y-%m-%d %H:%M:%S') - [init] $1"
    echo "$msg" >> "${LOG_FILE}" 2>/dev/null || true
}

copy_if_new() {
    local src="$1" dst="$2"
    if [ ! -f "$dst" ]; then
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst" 2>/dev/null && log_msg "部署: $dst" || log_msg "WARNING: 复制失败 $src"
    else
        log_msg "跳过（已存在）: $dst"
    fi
}

log_msg "=== init.sh start ==="
log_msg "DATA_DIR=${DATA_DIR}"
log_msg "INIT_DIR=${INIT_DIR}"

# 1. 记忆文件（持久化）
copy_if_new "$INIT_DIR/memories/MEMORY.md" "$DATA_DIR/memories/MEMORY.md"
copy_if_new "$INIT_DIR/memories/USER.md"   "$DATA_DIR/memories/USER.md"

# 2. 知识系统模板（Obsidian 格式，整个 knowledge/ 树）
mkdir -p "$DATA_DIR/knowledge"
find "$INIT_DIR/knowledge" -name "*.md" | while read -r f; do
    rel="${f#$INIT_DIR/knowledge/}"
    copy_if_new "$f" "$DATA_DIR/knowledge/$rel"
done

# 3. 镜像脚本
copy_if_new "$INIT_DIR/scripts/knowledge-sync/mirror.py" \
            "$DATA_DIR/scripts/knowledge-sync/mirror.py"

# 4. knowledge-sync skill（持久数据层，升级不覆盖）
copy_if_new "$INIT_DIR/skills/knowledge-sync/SKILL.md" \
            "$DATA_DIR/skills/knowledge-sync/SKILL.md"

# 5. 注册 crontab（每 30 分钟镜像 memories → knowledge），以 hermes-agent 用户写入
CRON_LINE="*/30 * * * * HERMES_DATA_DIR=$DATA_DIR python3 $DATA_DIR/scripts/knowledge-sync/mirror.py >> $DATA_DIR/logs/knowledge-mirror.log 2>&1"
APP_USER="${TRIM_USERNAME:-hermes-agent}"
if crontab -u "$APP_USER" -l 2>/dev/null | grep -qF "knowledge-sync/mirror.py"; then
    log_msg "crontab 镜像任务已存在，跳过"
else
    (crontab -u "$APP_USER" -l 2>/dev/null; echo "$CRON_LINE") | crontab -u "$APP_USER" - 2>/dev/null \
        && log_msg "已注册 crontab 镜像任务（每 30 分钟）" \
        || log_msg "WARNING: crontab 注册失败（可能需要 root 权限）"
fi

# 6. 立即跑一次镜像，开箱即有内容
if [ -f "$DATA_DIR/scripts/knowledge-sync/mirror.py" ]; then
    HERMES_DATA_DIR="$DATA_DIR" python3 "$DATA_DIR/scripts/knowledge-sync/mirror.py" >> "$DATA_DIR/logs/knowledge-mirror.log" 2>&1 \
        && log_msg "首次镜像完成" || log_msg "WARNING: 首次镜像失败"
fi

log_msg "=== init.sh end ==="
exit 0

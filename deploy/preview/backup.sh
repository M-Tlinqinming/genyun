#!/usr/bin/env bash
# 每日备份（在服务器上以 root 运行；cron 见 install-cron.sh）：
#   数据库：在 db 容器里跑 pg_dump，压成 db.sql.gz
#   上传文件：files 数据卷打成 files.tar.gz
# 存到 /opt/genyun/backups/<日期>/，附 SHA256SUMS；只保留最近 7 天（按目录名里的日期算）。
# 先写进 <日期>.partial，全部成功才改名，半截的备份不会冒充完整的。
#
# 用法：bash backup.sh                    # 今天的备份；同一天再跑会覆盖
#       BACKUP_NAME=2026-11-01-before-restore bash backup.sh   # restore.sh 用：恢复前先存一份当前状态
set -euo pipefail

BACKUP_ROOT=${BACKUP_ROOT:-/opt/genyun/backups}
KEEP_DAYS=${KEEP_DAYS:-7}
PROJECT=${COMPOSE_PROJECT:-genyun-preview}
DB_CONTAINER=${DB_CONTAINER:-$PROJECT-db-1}
FILES_VOLUME=${FILES_VOLUME:-${PROJECT}_files}
# 打包数据卷用的小镜像
TAR_IMAGE=${TAR_IMAGE:-alpine:3.22}
TODAY=${BACKUP_DATE:-$(date +%F)}
NAME=${BACKUP_NAME:-$TODAY}

log() { echo "[$(date '+%F %T')] $*"; }

dest="$BACKUP_ROOT/$NAME"
tmp="$dest.partial"
rm -rf "$tmp"
mkdir -p "$tmp"
chmod 700 "$BACKUP_ROOT" "$tmp"
# 失败时删掉半截的目录，并以非 0 退出（cron 会把输出写进日志）
trap 'rm -rf "$tmp"; log "备份失败"' ERR

log "备份数据库（$DB_CONTAINER）"
docker exec "$DB_CONTAINER" pg_dump -U genyun -d genyun --no-owner --no-privileges | gzip -6 > "$tmp/db.sql.gz"
# pg_dump 成功时最后一行是固定的结束注释；没有就说明导出不完整
gzip -dc "$tmp/db.sql.gz" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || { log "数据库导出不完整"; false; }

log "备份上传文件（数据卷 $FILES_VOLUME）"
docker run --rm -v "$FILES_VOLUME:/data:ro" "$TAR_IMAGE" tar czf - -C /data . > "$tmp/files.tar.gz"
gzip -t "$tmp/files.tar.gz"

(cd "$tmp" && sha256sum db.sql.gz files.tar.gz > SHA256SUMS)
rm -rf "$dest"
mv "$tmp" "$dest"
trap - ERR
log "已备份到 $dest（$(du -sh "$dest" | cut -f1)）"

# 只保留最近 KEEP_DAYS 天：目录名以日期开头，早于（今天 - KEEP_DAYS + 1）的删掉
cutoff=$(date -d "$TODAY - $((KEEP_DAYS - 1)) days" +%F)
for d in "$BACKUP_ROOT"/????-??-??*; do
  [ -d "$d" ] || continue
  day=$(basename "$d" | cut -c1-10)
  if [[ "$day" < "$cutoff" ]]; then
    rm -rf "$d"
    log "删除过期备份 $(basename "$d")"
  fi
done

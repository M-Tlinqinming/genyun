#!/usr/bin/env bash
# 从备份恢复（在服务器上以 root 运行）：
#   bash restore.sh 2026-11-01
# 步骤：核对校验和 → 二次确认（要输入日期）→ 先备份一次当前状态 → 停应用 → 重建数据库并导入 →
#       清空上传文件数据卷再解包 → 启动应用并等健康检查通过。
# 恢复会覆盖当前的数据库和上传文件；恢复前的状态存在 backups/<今天>-before-restore-<时分秒>/，需要时可以再恢复回去。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BACKUP_ROOT=${BACKUP_ROOT:-/opt/genyun/backups}
PROJECT=${COMPOSE_PROJECT:-genyun-preview}
DB_CONTAINER=${DB_CONTAINER:-$PROJECT-db-1}
APP_CONTAINER=${APP_CONTAINER:-$PROJECT-app-1}
FILES_VOLUME=${FILES_VOLUME:-${PROJECT}_files}
TAR_IMAGE=${TAR_IMAGE:-alpine:3.22}
COMPOSE=${COMPOSE:-docker compose --env-file /opt/genyun/.env -f $HERE/compose.yml}

log() { echo "[$(date '+%F %T')] $*"; }
die() { echo "恢复中止：$*" >&2; exit 1; }

name=${1:-}
[ -n "$name" ] || die "请指定要恢复的备份，例如 bash restore.sh 2026-11-01。现有备份：$(ls "$BACKUP_ROOT" 2>/dev/null | grep -v partial | tr '\n' ' ')"
src="$BACKUP_ROOT/$name"
[ -f "$src/db.sql.gz" ] && [ -f "$src/files.tar.gz" ] || die "$src 下没有完整的备份（db.sql.gz、files.tar.gz）"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "$src 的校验和对不上，备份可能损坏"

echo "将用 $name 的备份覆盖当前的数据库和上传文件。"
echo "恢复前会先把当前状态另存一份。"
if [ "${RESTORE_CONFIRM:-}" != "$name" ]; then
  read -r -p "确认恢复请输入备份名称（$name）：" answer
  [ "$answer" = "$name" ] || die "输入不一致，没有做任何改动"
fi

before="$(date +%F)-before-restore-$(date +%H%M%S)"
log "先备份当前状态 → $before"
BACKUP_NAME="$before" bash "$HERE/backup.sh"

log "停止应用"
$COMPOSE stop app

restart_app() {
  log "启动应用"
  $COMPOSE start app
}
trap 'log "恢复出错。恢复前的状态在 $BACKUP_ROOT/$before，可再运行 bash restore.sh $before"; restart_app' ERR

log "重建数据库并导入 $name/db.sql.gz"
docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U genyun -d postgres -q \
  -c 'DROP DATABASE IF EXISTS genyun WITH (FORCE)' -c 'CREATE DATABASE genyun OWNER genyun'
gzip -dc "$src/db.sql.gz" | docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U genyun -d genyun -q > /dev/null

log "恢复上传文件 $name/files.tar.gz"
docker run --rm -i -v "$FILES_VOLUME:/data" "$TAR_IMAGE" \
  sh -c 'find /data -mindepth 1 -delete && tar xzf - -C /data' < "$src/files.tar.gz"

trap - ERR
restart_app
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null)" = healthy ] || die "应用没有通过健康检查，请看 docker logs $APP_CONTAINER"
log "已从 $name 恢复。恢复前的状态在 $BACKUP_ROOT/$before"

#!/usr/bin/env bash
# 本机演练「备份 → 删数据 → 恢复」，不连服务器、不需要 Docker：
#   1. 先跑过一次 e2e（npx playwright test），得到 apps/api/.data/e2e-db 和 .data/files；
#   2. 在随便一个空目录装 PGlite 工具：npm i @electric-sql/pglite@0.5.14 @electric-sql/pglite-tools@0.4.14
#   3. PGLITE_TOOLS_DIR=<那个目录> bash deploy/preview/rehearsal/rehearse.sh
# 用真实的 backup.sh、restore.sh，只把 docker 换成同目录下的假 docker（数据库用 PGlite 冒充）。
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${PGLITE_TOOLS_DIR:?请设 PGLITE_TOOLS_DIR，见脚本开头}"

export REHEARSAL_ROOT="$PWD/out/rehearsal-run"
export REHEARSAL_DB="$REHEARSAL_ROOT/pgdata"
export PATH="$PWD/deploy/preview/rehearsal:$PATH"
export BACKUP_ROOT="$REHEARSAL_ROOT/backups"
export COMPOSE="docker compose"
VOL="$REHEARSAL_ROOT/volumes/genyun-preview_files"
step() { echo; echo "=== $* ==="; }
count() { node deploy/preview/rehearsal/fake-pg.mjs count; }

step "准备：复制 e2e 的数据库和上传文件"
rm -rf "$REHEARSAL_ROOT"
mkdir -p "$VOL" "$BACKUP_ROOT"
cp -r apps/api/.data/e2e-db "$REHEARSAL_DB"
cp -r apps/api/.data/files/. "$VOL/"
# 两份 8 天前、7 天前的旧备份，用来看保留 7 天
mkdir -p "$BACKUP_ROOT/$(date -d '-8 days' +%F)" "$BACKUP_ROOT/$(date -d '-6 days' +%F)"
count > "$REHEARSAL_ROOT/count-before.txt"
(cd "$VOL" && find . -type f | sort | xargs sha256sum) > "$REHEARSAL_ROOT/files-before.txt"
echo "数据库 $(wc -l < "$REHEARSAL_ROOT/count-before.txt") 张表，用户 $(grep '^public.users ' "$REHEARSAL_ROOT/count-before.txt" | cut -d' ' -f2) 个；上传文件 $(wc -l < "$REHEARSAL_ROOT/files-before.txt") 个"

step "备份"
bash deploy/preview/backup.sh
today=$(date +%F)
ls -la "$BACKUP_ROOT/$today"
ls "$BACKUP_ROOT"
[ ! -d "$BACKUP_ROOT/$(date -d '-8 days' +%F)" ] && echo "8 天前的旧备份已删除" || { echo "保留 7 天没有生效"; exit 1; }
[ -d "$BACKUP_ROOT/$(date -d '-6 days' +%F)" ] && echo "6 天前的备份还在"

step "删数据：清空用户和组织，删掉全部上传文件"
echo 'TRUNCATE public.organizations, public.users CASCADE;' | node deploy/preview/rehearsal/fake-pg.mjs load
find "$VOL" -mindepth 1 -delete
count > "$REHEARSAL_ROOT/count-broken.txt"
echo "用户剩 $(grep '^public.users ' "$REHEARSAL_ROOT/count-broken.txt" | cut -d' ' -f2) 个；上传文件剩 $(find "$VOL" -type f | wc -l) 个"

step "确认时输错名称：中止，不做任何改动"
if echo wrong | bash deploy/preview/restore.sh "$today"; then echo "输错也恢复了"; exit 1; fi
cmp -s "$REHEARSAL_ROOT/count-broken.txt" <(count) && echo "数据没动"

step "恢复"
echo "$today" | bash deploy/preview/restore.sh "$today"

step "核对"
count > "$REHEARSAL_ROOT/count-after.txt"
(cd "$VOL" && find . -type f | sort | xargs sha256sum) > "$REHEARSAL_ROOT/files-after.txt"
diff "$REHEARSAL_ROOT/count-before.txt" "$REHEARSAL_ROOT/count-after.txt" && echo "各表行数和备份前一致"
diff "$REHEARSAL_ROOT/files-before.txt" "$REHEARSAL_ROOT/files-after.txt" && echo "上传文件逐个校验和一致"
ls -d "$BACKUP_ROOT"/*before-restore* && echo "恢复前的状态另存了一份"
echo; echo "演练通过"

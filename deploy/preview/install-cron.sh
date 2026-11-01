#!/usr/bin/env bash
# 安装每日备份的定时任务（在服务器上以 root 运行一次；可重复运行，结果一样）：
#   bash /opt/genyun/src/deploy/preview/install-cron.sh
# 每天 03:30（服务器时区）运行 backup.sh，输出写进 /var/log/genyun-backup.log，日志按周轮转留 8 周。
# 定时任务直接调用 /opt/genyun/src 下的脚本：每次发布都会更新这个目录，脚本改了不用重装。
set -euo pipefail

SCRIPT=/opt/genyun/src/deploy/preview/backup.sh
[ -f "$SCRIPT" ] || { echo "找不到 $SCRIPT，请先发布一次（deploy.sh）"; exit 1; }

mkdir -p /opt/genyun/backups
chmod 700 /opt/genyun/backups

cat > /etc/cron.d/genyun-backup <<EOF
# 耕云预览环境每日备份（install-cron.sh 生成，不要手改）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root bash $SCRIPT >> /var/log/genyun-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/genyun-backup

cat > /etc/logrotate.d/genyun-backup <<'EOF'
/var/log/genyun-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF

systemctl reload cron 2>/dev/null || systemctl restart cron
echo "已安装：每天 03:30 备份到 /opt/genyun/backups，日志 /var/log/genyun-backup.log"
echo "现在手动跑一次确认：bash $SCRIPT"

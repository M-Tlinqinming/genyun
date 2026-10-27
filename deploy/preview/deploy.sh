#!/usr/bin/env bash
# 把当前提交发布到预览服务器：上传代码 → 服务器上构建镜像 → 重启容器（数据保留）。
# 在仓库根目录运行：bash deploy/preview/deploy.sh
set -euo pipefail

HOST="${PREVIEW_HOST:-root@47.82.104.179}"
# 本机用户目录是中文名时，ssh 默认读不到 ~/.ssh，所以显式指定
SSH=(ssh -F /dev/null -i "$HOME/.ssh/id_ed25519" -o UserKnownHostsFile="$HOME/.ssh/known_hosts" -o BatchMode=yes "$HOST")

if [ -n "$(git status --porcelain)" ]; then
  echo "有未提交的改动；预览只发布已提交的代码（$(git rev-parse --short HEAD)）"
fi

git archive --format=tar HEAD | "${SSH[@]}" '
  set -e
  rm -rf /opt/genyun/src.new && mkdir -p /opt/genyun/src.new
  tar -x -C /opt/genyun/src.new
  rm -rf /opt/genyun/src && mv /opt/genyun/src.new /opt/genyun/src
'
"${SSH[@]}" "
  set -e
  cd /opt/genyun/src/deploy/preview
  echo $(git rev-parse --short HEAD) > /opt/genyun/DEPLOYED_COMMIT
  docker compose --env-file /opt/genyun/.env up -d --build --remove-orphans
  docker image prune -f >/dev/null
  for i in \$(seq 1 60); do
    [ \"\$(docker inspect -f '{{.State.Health.Status}}' genyun-preview-app-1)\" = healthy ] && break
    sleep 2
  done
  docker compose --env-file /opt/genyun/.env ps
"
echo "已发布 $(git rev-parse --short HEAD)"

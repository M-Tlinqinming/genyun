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
  # 回退用：把正在运行的镜像标成 previous（见 README「回退」）；prune 只删没有标签的旧层，previous 会留下
  docker image inspect genyun:preview >/dev/null 2>&1 && docker tag genyun:preview genyun:previous
  docker image inspect genyun-site:preview >/dev/null 2>&1 && docker tag genyun-site:preview genyun-site:previous
  # 服务器只有 3.5G 内存，两个镜像依次构建，不同时构建
  docker compose --env-file /opt/genyun/.env build app
  docker compose --env-file /opt/genyun/.env build caddy
  docker compose --env-file /opt/genyun/.env up -d --no-build --remove-orphans
  echo $(git rev-parse --short HEAD) > /opt/genyun/DEPLOYED_COMMIT
  docker image prune -f >/dev/null
  for i in \$(seq 1 60); do
    [ \"\$(docker inspect -f '{{.State.Health.Status}}' genyun-preview-app-1)\" = healthy ] && break
    sleep 2
  done
  docker compose --env-file /opt/genyun/.env ps
"
echo "已发布 $(git rev-parse --short HEAD)，检查分流："
bash "$(dirname "$0")/smoke.sh" "${PREVIEW_URL:-https://preview.gengyun.net.cn}"

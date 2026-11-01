#!/usr/bin/env bash
# 在预览服务器上写入演示数据（可以反复运行：已有的跳过、只补缺的，不改已有账号的密码，不删数据）。
# 在本机仓库根目录、发布之后运行：bash deploy/preview/seed.sh
# 演示密码在服务器上从 /opt/genyun/.env 读，不经过本机，也不进命令行历史。
set -euo pipefail

HOST="${PREVIEW_HOST:-root@47.82.104.179}"
# 本机用户目录是中文名时，ssh 默认读不到 ~/.ssh，所以显式指定（同 deploy.sh）
SSH=(ssh -F /dev/null -i "$HOME/.ssh/id_ed25519" -o UserKnownHostsFile="$HOME/.ssh/known_hosts" -o BatchMode=yes "$HOST")

"${SSH[@]}" '
  set -e
  pw="$(grep ^DEMO_PASSWORD= /opt/genyun/.env | cut -d= -f2-)"
  [ -n "$pw" ] || { echo "/opt/genyun/.env 里没有 DEMO_PASSWORD"; exit 1; }
  # -e DEMO_PASSWORD 不带值：从环境变量传进容器，密码不出现在 docker 的命令参数里
  DEMO_PASSWORD="$pw" docker exec -e ALLOW_DEMO_SEED=1 -e DEMO_PASSWORD genyun-preview-app-1 node apps/api/dist/scripts/seed-demo.js
'

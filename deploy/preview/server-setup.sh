#!/usr/bin/env bash
# 服务器一次性准备（Ubuntu 24.04，root 运行）：交换空间、Docker、密钥文件。
# 可重复运行，已做过的步骤会跳过；已有的密钥不会被覆盖。
set -euo pipefail

SITE_DOMAIN="${1:?用法：server-setup.sh <域名>}"
BASE=/opt/genyun

# 2G 交换空间：服务器只有约 3.5G 内存，构建镜像时防止内存不足
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker

mkdir -p "$BASE"
chmod 700 "$BASE"
if [ ! -f "$BASE/.env" ]; then
  umask 077
  cat > "$BASE/.env" <<EOF
SITE_DOMAIN=$SITE_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
FILE_URL_SECRET=$(openssl rand -hex 32)
DEMO_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')
EOF
fi
echo "服务器准备完成"

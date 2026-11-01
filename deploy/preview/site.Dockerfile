# 反向代理镜像：Caddy + 官网静态页。构建上下文是仓库根目录（compose.yml 里 build.context: ../..）。
# 官网构建时要裁剪字体（scripts/subset-fonts.mjs），所以先用 Node 构建，再把 dist 复制进 Caddy。
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 各工作区的 package.json 都要在，npm ci 才和锁文件一致；只安装官网的依赖
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @genyun/site
COPY apps/site apps/site
# 只影响 canonical、分享图、sitemap 里的绝对地址
ARG SITE_URL=https://preview.gengyun.net.cn
RUN SITE_URL=$SITE_URL npm run build -w @genyun/site

FROM caddy:2
COPY deploy/preview/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/site/dist /srv/site
# 构建时就检查 Caddyfile 写得对不对，免得发布到服务器才发现
RUN SITE_DOMAIN=:80 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

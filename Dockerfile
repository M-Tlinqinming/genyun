# 耕云：一个容器同时提供前端页面和后端接口
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# 官网（apps/site）不进这个镜像，只为让 npm ci 与锁文件里的工作区一致
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY . .
RUN npm run build -w @genyun/web && npm run build -w @genyun/api

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/apps/web/dist MAIL_OUTBOX_DIR=/data/mail-outbox
WORKDIR /app
# 应急预案里的体系图、流程图转图片时要用中文字体（宋体在 Linux 上没有，用思源宋体）；
# Word 校对页的 PDF 用 LibreOffice 转换，更新目录页码要用它的 Python 接口
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk libreoffice-writer-nogui python3-uno \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev -w @genyun/api && npm cache clean --force
COPY --from=build /app/packages/shared/src packages/shared/src
COPY --from=build /app/apps/api/dist apps/api/dist
# 转 PDF 的脚本不是 TypeScript，编译时不会带进 dist，单独复制到 pdf.js 旁边
COPY --from=build /app/apps/api/src/generation/word/soffice-pdf.py apps/api/dist/generation/word/
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/content apps/api/content
COPY --from=build /app/apps/web/dist apps/web/dist
# 上传文件、模拟发信的发件箱（部署时挂持久化卷）：先建好并交给 node 用户，新建的卷会继承这个权限
RUN mkdir -p /data/files /data/mail-outbox && chown node:node /data/files /data/mail-outbox
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

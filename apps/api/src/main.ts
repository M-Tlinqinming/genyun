import express from 'express';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDatabase } from './db/client.ts';

const { db } = await openDatabase(process.env.DATABASE_URL ?? '.data/dev-db');
const app = await createApp(db);

// 部署时同一个进程也提供前端页面（WEB_DIST 指向前端构建产物）；本机开发由 Vite 提供
const webDist = process.env.WEB_DIST;
if (webDist) {
  const root = resolve(webDist);
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use(express.static(root, { index: false, maxAge: '1h' }));
  // 单页应用：非 /api 的路径都返回 index.html，由前端路由处理
  server.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(root, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`耕云已启动：http://localhost:${port}`);

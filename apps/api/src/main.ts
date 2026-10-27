import express from 'express';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDatabase } from './db/client.ts';

const { db } = await openDatabase(process.env.DATABASE_URL ?? '.data/dev-db');
// 浏览器测试一次要登录十几次，用 LOGIN_LIMIT_PER_MINUTE 放宽；正式环境不设，按默认每分钟 10 次
const loginLimit = Number(process.env.LOGIN_LIMIT_PER_MINUTE) || undefined;
const app = await createApp(db, { loginLimitPerMinute: loginLimit });

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

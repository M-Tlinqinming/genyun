import { defineConfig } from '@playwright/test';

// 端到端测试：启动真实的后端（临时数据库 + 演示账号）和前端，用浏览器走一遍
const DB = '.data/e2e-db';
// 营业执照识别用模拟服务：不看图片，总是返回同一组样例内容
const env = { DATABASE_URL: DB, DEMO_PASSWORD: 'e2e-password', PORT: '3100', LICENSE_OCR: 'fake' };

export default defineConfig({
  testDir: 'e2e',
  // 各测试文件共用一个演示数据库，按文件名顺序逐个跑，互不干扰
  workers: 1,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 1000 } },
  webServer: [
    {
      command: `node -e "require('fs').rmSync('apps/api/${DB}',{recursive:true,force:true})" && npm run seed:demo -w @genyun/api && npm run dev -w @genyun/api`,
      url: 'http://localhost:3100/api/health',
      env,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @genyun/web -- --port 5174 --strictPort',
      url: 'http://localhost:5174/login',
      env: { API_TARGET: 'http://localhost:3100' },
      reuseExistingServer: false,
    },
  ],
});

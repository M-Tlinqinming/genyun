import { defineConfig } from '@playwright/test';

// 端到端测试：启动真实的后端（临时数据库 + 演示账号）和前端，用浏览器走一遍
const DB = '.data/e2e-db';
const env = { DATABASE_URL: DB, DEMO_PASSWORD: 'e2e-password', PORT: '3100' };

export default defineConfig({
  testDir: 'e2e',
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

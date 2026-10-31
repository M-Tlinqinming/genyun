import { defineConfig } from '@playwright/test';

// 端到端测试：启动真实的后端（临时数据库 + 演示账号）和前端，用浏览器走一遍
const DB = '.data/e2e-db';
// 营业执照识别用模拟服务：不看图片，总是返回同一组样例内容
// 每个测试文件登录一次，文件多了会超过正式环境每分钟 10 次的登录限制，测试时放宽
const env = {
  DATABASE_URL: DB,
  DEMO_PASSWORD: 'e2e-password',
  PORT: '3100',
  LICENSE_OCR: 'fake',
  LOGIN_LIMIT_PER_MINUTE: '100',
  // 生成草稿时风险评估报告第一次失败，测试只重试这一份（generation.spec）
  DRAFT_FAIL_ONCE: 'risk',
  SOFFICE_PATH: '',
};

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
    {
      // 官网是静态页面：测构建出来的结果（site.spec）
      command: 'npm run build -w @genyun/site && npm run preview -w @genyun/site -- --port 4322',
      url: 'http://localhost:4322/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

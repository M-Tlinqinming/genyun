import { defineConfig } from '@playwright/test';

// 端到端测试：启动真实的后端（临时数据库 + 演示账号）和前端，用浏览器走一遍
const DB = '.data/e2e-db';
// 端口可用环境变量改：并行开发时每条线用不同端口跑（A 线 31xx，B 线 32xx，C 线 33xx），
// 例如 E2E_API_PORT=3200 E2E_WEB_PORT=5274 npx playwright test。不设时仍是 3100 / 5174
const API_PORT = process.env.E2E_API_PORT ?? '3100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5174';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
// 营业执照识别用模拟服务：不看图片，总是返回同一组样例内容
// 每个测试文件登录一次，文件多了会超过正式环境每分钟 10 次的登录限制，测试时放宽
const env = {
  DATABASE_URL: DB,
  DEMO_PASSWORD: 'e2e-password',
  PORT: API_PORT,
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
  use: { baseURL: WEB_URL, viewport: { width: 1440, height: 1000 } },
  webServer: [
    {
      command: `node -e "require('fs').rmSync('apps/api/${DB}',{recursive:true,force:true})" && npm run seed:demo -w @genyun/api && npm run dev -w @genyun/api`,
      url: `${API_URL}/api/health`,
      env,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -w @genyun/web -- --port ${WEB_PORT} --strictPort`,
      url: `${WEB_URL}/login`,
      env: { API_TARGET: API_URL },
      reuseExistingServer: false,
    },
    {
      // 官网是静态页面：测构建出来的结果（site.spec）。CI 只在这里构建一次官网
      // --ignore-lock：本机另开着官网 preview 时也能起来
      command: 'npm run build -w @genyun/site && npm run preview -w @genyun/site -- --port 4322 --ignore-lock',
      url: 'http://localhost:4322/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

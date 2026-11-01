import { defineConfig } from '@playwright/test';

// 端到端测试：启动真实的后端（临时数据库 + 演示账号）和前端，用浏览器走一遍
const DB = '.data/e2e-db';
// 端口可用环境变量改：并行开发时每条线用不同端口跑（A 线 31xx，B 线 32xx，C 线 33xx），
// 例如 E2E_API_PORT=3200 E2E_WEB_PORT=5274 npx playwright test。不设时仍是 3100 / 5174
const API_PORT = process.env.E2E_API_PORT ?? '3100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5174';
// 官网（静态页面）的端口：默认放在 C 线的 33xx 段，也可用 E2E_SITE_PORT 改
const SITE_PORT = process.env.E2E_SITE_PORT ?? '3322';
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
  // 邀请邮件里的链接指向测试用的前端
  APP_ORIGIN: WEB_URL,
  // 模拟发信写到这里（相对 apps/api）；account、invitations、operator-org-detail 从这里读验证码和邀请链接
  MAIL_OUTBOX_DIR: '.data/e2e-mail-outbox',
};

export default defineConfig({
  testDir: 'e2e',
  // 各测试文件共用一个演示数据库，按文件名顺序逐个跑，互不干扰
  workers: 1,
  use: { baseURL: WEB_URL, viewport: { width: 1440, height: 1000 } },
  // 启动等待一律 240 s（Playwright 默认 60 s）：本机 Windows 上演示数据 seed 约 55 s，机器忙时更久。
  // 慢在加载模块（argon2、Nest、drizzle、PGlite）和 PGlite 跑全部迁移，不在写入的数据（只有 5 个账号、2 个任务）；
  // seed 之后接口服务还要再启动一次，60 s 不够
  webServer: [
    {
      timeout: 240_000,
      // 每次先清空临时数据库和模拟发件箱，读到的邮件都是这一轮发的
      command: `node -e "for (const d of ['${DB}','${env.MAIL_OUTBOX_DIR}']) require('fs').rmSync('apps/api/'+d,{recursive:true,force:true})" && npm run seed:demo -w @genyun/api && npm run dev -w @genyun/api`,
      url: `${API_URL}/api/health`,
      env,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -w @genyun/web -- --port ${WEB_PORT} --strictPort`,
      url: `${WEB_URL}/login`,
      env: { API_TARGET: API_URL },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // 官网是静态页面：测构建出来的结果（site.spec）。CI 只在这里构建一次官网
      // --ignore-lock：本机另开着官网 preview 时也能起来
      command: `npm run build -w @genyun/site && npm run preview -w @genyun/site -- --port ${SITE_PORT} --ignore-lock`,
      url: `http://localhost:${SITE_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});

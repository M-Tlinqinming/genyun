import { expect, test, type Page } from '@playwright/test';

// M4 第 5 项：操作日志（等保）。运营只读查看，能分页、按操作类型筛选；其他身份进不来
test.describe.configure({ mode: 'serial' });

let page: Page;

async function login(p: Page, email: string, password = 'e2e-password') {
  await p.goto('/login');
  await p.getByPlaceholder('请输入邮箱').fill(email);
  await p.getByPlaceholder('请输入密码').fill(password);
  await p.getByRole('button', { name: /登\s*录/ }).click();
}

test.beforeAll(async ({ browser }) => {
  // 先留一条登录失败
  const other = await browser.newPage();
  await login(other, 'admin@demo.genyun.net.cn', 'wrong-password-e2e');
  await expect(other.getByText(/邮箱或密码/)).toBeVisible();
  await other.close();

  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(page, 'ops@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

test('运营看到自己的登录记录，最新的在最上面', async () => {
  await page.getByRole('menuitem', { name: /操作日志/ }).click();
  await expect(page).toHaveURL(/\/operator\/audit-logs$/);
  await expect(page.getByRole('heading', { name: '操作日志' })).toBeVisible();
  const first = page.getByRole('row').nth(1);
  await expect(first).toContainText('登录成功');
  await expect(first).toContainText('ops@demo.genyun.net.cn');
  // 界面上不出现英文动作编码
  await expect(page.locator('main')).not.toContainText('login_success');
  await page.screenshot({ path: 'out/m4-5-audit-logs.png', fullPage: true });
});

test('按操作类型筛选：登录失败', async () => {
  await page.getByLabel('操作类型').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '登录失败' }).click();
  const rows = page.getByRole('row').filter({ hasText: 'admin@demo.genyun.net.cn' });
  await expect(rows.first()).toContainText('登录失败');
  await expect(page.getByRole('row').filter({ hasText: '登录成功' })).toHaveCount(0);
  // 不记密码
  await expect(page.locator('main')).not.toContainText('wrong-password-e2e');

  await page.getByLabel('操作类型').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '登录成功' }).click();
  // 换筛选后登录失败的行消失，只剩本用例 beforeAll 里运营自己的登录成功（不依赖其他用例先跑）
  await expect(page.getByRole('row').filter({ hasText: '登录失败' })).toHaveCount(0);
  const ok = page.getByRole('row').filter({ hasText: 'ops@demo.genyun.net.cn' }).first();
  await expect(ok).toContainText('登录成功');
});

test('客户管理员调接口 403，菜单里也没有操作日志', async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, 'admin@demo.genyun.net.cn');
  await expect(admin).not.toHaveURL(/\/login/);
  await expect(admin.getByRole('menuitem', { name: /操作日志/ })).toHaveCount(0);
  const res = await admin.request.get('/api/operator/audit-logs');
  expect(res.status()).toBe(403);
  await admin.close();
});

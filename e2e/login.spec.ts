import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string, password = 'e2e-password') {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

test('客户管理员登录后进入客户工作台，能看到组织管理', async ({ page }) => {
  await login(page, 'admin@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByRole('menuitem', { name: '组织管理' })).toBeVisible();
});

test('专业人员登录后进入任务中心', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/expert$/);
  await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible();
});

test('运营管理员登录后进入运营概览', async ({ page }) => {
  await login(page, 'ops@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/operator$/);
  await expect(page.getByRole('heading', { name: '运营概览' })).toBeVisible();
});

test('密码错误时提示且不进入系统', async ({ page }) => {
  await login(page, 'admin@demo.genyun.net.cn', 'wrong');
  await expect(page.getByText('邮箱或密码不正确')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('客户账号打不开运营工作区', async ({ page }) => {
  await login(page, 'admin@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer$/);
  await page.goto('/operator');
  await expect(page).toHaveURL(/\/customer$/);
});

test('退出登录后回到登录页', async ({ page }) => {
  await login(page, 'admin@demo.genyun.net.cn');
  await page.getByRole('button', { name: /林管理员/ }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/customer');
  await expect(page).toHaveURL(/\/login$/);
});

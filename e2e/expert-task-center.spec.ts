import { expect, test, type Page } from '@playwright/test';

// 演示数据：飞宇任务分派给周工（expert@），另一家分派给吴工（expert2@）
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
}

test('周工在任务中心看到飞宇任务、客户请求联系，并能进入任务', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn');

  const banner = page.getByRole('alert');
  await expect(banner).toContainText('客户请求联系 1');
  await expect(banner).toContainText('惠阳飞宇电器有限公司 · 陈 ●● 点了「请专家电话联系」');
  await expect(banner).toContainText('应急物资及装备、消防水池');
  await expect(banner).toContainText(/个工作日|今天 \d\d:\d\d 前/);

  const row = page.getByRole('row', { name: /惠阳飞宇电器有限公司/ });
  await expect(row).toContainText('飞宇演示客户');
  await expect(row).toContainText('专业整理');
  await expect(row).toContainText('电话联系客户问清 2 项');
  await expect(page.getByText('示例五金制品有限公司')).toHaveCount(0);

  // 待资料核实：两项请联系 + 一项拍照
  await page.getByRole('tab', { name: /待资料核实 1/ }).click();
  await expect(page.getByRole('row', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();

  await expect(page.getByText('惠阳飞宇电器有限公司提交生成申请')).toBeVisible();

  await banner.getByRole('button', { name: '联系客户' }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
});

test('搜索和阶段筛选', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await page.getByPlaceholder('企业名称 / 任务编号').fill('GY-2099');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  await page.getByRole('button', { name: /重\s*置/ }).click();
  await expect(page.getByRole('row', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();

  await page.getByLabel('任务阶段').click();
  await page.getByTitle('已交付').click();
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
});

test('越权：周工打不开分派给吴工的任务', async ({ page, browser }) => {
  // 先用吴工的账号拿到他的任务链接
  const other = await browser.newPage();
  await login(other, 'expert2@demo.genyun.net.cn');
  await other.getByRole('row', { name: /示例五金制品有限公司/ }).click();
  await expect(other).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+$/);
  const href = new URL(other.url()).pathname;
  await other.close();

  await login(page, 'expert@demo.genyun.net.cn');
  await page.goto(href);
  await expect(page.getByText('找不到该任务')).toBeVisible();
  await expect(page.getByText('示例五金制品有限公司')).toHaveCount(0);
});

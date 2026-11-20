import { expect, test, type Page } from '@playwright/test';

// 文件名排在 review-proofread.spec 之后、task-publish.spec 之前：review-proofread 最后让审核结论失效（风险评估在审核后又改了）。
// 原来由事实补件用例按新事实重新生成一批；补件取消后，在这里从「确认采用资料」重新生成一批，task-publish 从未核对的新一批开始
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

test.setTimeout(300_000);

test('审核结论失效后，专家从确认采用资料重新生成一批草稿', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  const base = page.url().replace(/\?.*$/, '');

  await page.goto(`${base}?view=confirm`);
  await expect(page.getByRole('heading', { name: '确认本次编制使用的资料' })).toBeVisible();
  await page.getByRole('button', { name: '确认采用并生成三份草稿' }).click();
  // 上一批有人工修订时先确认一次
  const again = page.getByRole('button', { name: '确认重新生成' });
  await expect(again.or(page.getByRole('list', { name: '三份草稿' }))).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible({ timeout: 240_000 });
});

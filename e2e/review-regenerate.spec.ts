import { expect, test, type Page } from '@playwright/test';

// 文件名排在 review-proofread.spec 之后、task-publish.spec 之前：review-proofread 最后让审核结论失效（风险评估在审核后又改了）。
// 原来由事实补件用例按新事实重新生成一批；补件取消后，在这里从资料核对第 5 步「核对并生成」重新生成一批，task-publish 从未核对的新一批开始
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

test.setTimeout(300_000);

test('审核结论失效后，专家从核对并生成重新生成一批草稿', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  const base = page.url().replace(/\?.*$/, '');

  await page.goto(`${base}?view=workup&step=5&page=2`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('核对无误，就可以生成初稿');
  await page.getByRole('button', { name: '确认资料并生成初稿' }).click();
  // 上一批有人工修订时先确认一次
  const again = page.getByRole('button', { name: '确认重新生成' });
  await expect(again.or(page.getByRole('list', { name: '三份草稿' }))).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(page).not.toHaveURL(/view=/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible({ timeout: 240_000 });
});

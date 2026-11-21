import { expect, test, type Page } from '@playwright/test';

// 生成初稿页（E18-02）：网址 ?view=generation。
// 文件名排在 generation.spec 之后：那时飞宇的三份初稿已生成（风险评估报告重新生成过一次）
async function openFeiyuGeneration(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=generation`);
}

const row = (page: Page, name: string) => page.getByRole('list', { name: '三份初稿' }).getByRole('listitem', { name });

test('生成初稿页：三份都好了可以开始核对；处理记录；返回任务中心', async ({ page }) => {
  await openFeiyuGeneration(page);
  await expect(page.getByRole('heading', { name: '三份初稿都已生成' })).toBeVisible();
  await expect(page.getByText(/按您.+确认的资料生成。三份逐份核对后，就可以定稿并交付。/)).toBeVisible();
  for (const name of ['应急预案', '风险评估报告', '应急资源调查报告']) {
    await expect(row(page, name)).toContainText('已生成');
    await expect(row(page, name)).toContainText(/生成 · .*(处待补充|没有待补充)/);
  }
  const footer = page.getByRole('region', { name: '页面操作' });
  await expect(footer).toContainText('三份都好了，可以开始核对');
  await expect(page.getByRole('link', { name: '资料核对' })).toHaveAttribute('href', /view=workup&step=5/);
  await page.screenshot({ path: 'test-results/acceptance/k12-generation-done.png', fullPage: true });

  // 处理记录：重新生成过，所以不写用时
  const toggle = page.getByRole('button', { name: '处理记录', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const drawer = page.getByRole('dialog', { name: '处理记录' });
  await expect(drawer).toContainText('三份初稿生成完成');
  await expect(drawer).not.toContainText('用时');
  await drawer.getByRole('button', { name: '关闭处理记录' }).click();
  await expect(drawer).toBeHidden();

  // 开始核对：进核对定稿
  await footer.getByRole('button', { name: '开始核对' }).click();
  await expect(page).toHaveURL(/view=edit/);

  // 回到生成页，返回任务中心
  await page.goto(`${new URL(page.url()).pathname}?view=generation`);
  await expect(page.getByRole('heading', { name: '三份初稿都已生成' })).toBeVisible();
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
});

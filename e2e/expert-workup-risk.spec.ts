import { expect, test, type Locator, type Page } from '@playwright/test';

// 危险源辨识（13 页 E2-5a，资料核对第 5 步第 1 页）：候选按第 3 步的设备、物料推出，D = L × E × C。
// 本文件排在 expert-workup-production 之后（那里新增了乙炔并判定为危化品）、expert-workup 之前；只改危险源，不影响必填资料
async function openRisks(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=5`);
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
}

const table = (page: Page) => page.getByRole('table', { name: '危险源' });
const row = (page: Page, id: string) => table(page).locator(`[data-risk="${id}"]`);
const saved = (page: Page) => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/workup/risks') && r.ok());

// 只在这个选择框自己的弹层里找选项（按 aria-controls 找）
async function choose(page: Page, scope: Locator, label: string, option: string) {
  const box = scope.getByLabel(label, { exact: true });
  await box.click();
  const listId = await box.getAttribute('aria-controls');
  if (!listId) throw new Error(`${label} 没有 aria-controls`);
  const dropdown = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id="${listId}"]`) });
  await dropdown.getByTitle(option, { exact: true }).click();
}

test('周工改分值要写理由，等级跟着变；恢复系统推荐、标不适用、手动新增；退出再进还在', async ({ page }) => {
  await openRisks(page);
  // 每份现场处置方案一类事故；乙炔判定为危化品后推出可燃气体爆炸
  await expect(table(page)).toContainText('火灾');
  await expect(table(page)).toContainText('可燃气体爆炸');
  await expect(table(page)).toContainText('配电房');

  const fire = row(page, 'SP01');
  await expect(fire).toContainText('42');
  await expect(fire).toContainText('一般危险');
  await expect(fire).toContainText('系统');

  // C 改 40：D = 1 × 6 × 40 = 240，高度危险；不写理由存不了
  await fire.getByRole('button', { name: '改「火灾」的分值' }).click();
  await choose(page, fire, 'C', '40　灾难，数人死亡');
  await expect(fire).toContainText('240');
  await expect(fire).toContainText('高度危险');
  await fire.getByRole('button', { name: '保存' }).click();
  await expect(fire.getByRole('alert')).toHaveText('改了分值，请写一句理由');
  await fire.getByLabel('改分值的理由').fill('成品仓紧邻车间，火灾可致数人伤亡');
  let s = saved(page);
  await fire.getByRole('button', { name: '保存' }).click();
  await s;
  await expect(fire).toContainText('C 7 → 40');
  await expect(fire).toContainText('成品仓紧邻车间，火灾可致数人伤亡');
  await expect(fire).toContainText('您');

  // 触电改了又恢复系统推荐
  const shock = row(page, 'SP02');
  await shock.getByRole('button', { name: /^改「触电」/ }).click();
  await choose(page, shock, 'C', '15　非常严重，一人死亡');
  await shock.getByLabel('改分值的理由').fill('配电房无专人值守');
  s = saved(page);
  await shock.getByRole('button', { name: '保存' }).click();
  await s;
  await expect(shock).toContainText('90');
  await expect(shock).toContainText('显著危险');
  await shock.getByRole('button', { name: /^改「触电」/ }).click();
  s = saved(page);
  await shock.getByRole('button', { name: '恢复系统推荐' }).click();
  await s;
  await expect(shock).toContainText('42');
  await expect(shock).toContainText('系统');

  // 其他伤害标为不适用：从表里去掉，不计入报告
  await row(page, 'SP22').getByRole('button').first().click();
  s = saved(page);
  await row(page, 'SP22').getByRole('button', { name: '不适用' }).click();
  await s;
  await expect(row(page, 'SP22')).toHaveCount(0);

  // 手动新增：其他爆炸 · 气瓶间，D = 1 × 3 × 40 = 120，显著危险
  await page.getByRole('button', { name: '手动新增' }).click();
  const modal = page.getByRole('dialog', { name: '手动新增危险源' });
  await modal.getByLabel('危险有害因素').fill('其他爆炸');
  await modal.getByLabel('作业场所').fill('气瓶间');
  // 收起作业场所的候选下拉，免得挡住分值
  await modal.getByText('手动新增危险源', { exact: true }).click();
  await expect(modal.getByLabel('作业场所')).toHaveAttribute('aria-expanded', 'false');
  await choose(page, modal, 'L', '1　可能性小，完全意外');
  await choose(page, modal, 'E', '3　每周一次暴露');
  await choose(page, modal, 'C', '40　灾难，数人死亡');
  await expect(modal).toContainText('D = 120，显著危险');
  s = saved(page);
  await modal.getByRole('button', { name: '添加' }).click();
  await s;
  const added = table(page).locator('[data-risk^="x"]');
  await expect(added).toContainText('其他爆炸');
  await expect(added).toContainText('120');
  await expect(added).toContainText('显著危险');

  // 退出再进还在
  await page.reload();
  await expect(row(page, 'SP01')).toContainText('240');
  await expect(row(page, 'SP22')).toHaveCount(0);
  await expect(table(page).locator('[data-risk^="x"]')).toContainText('气瓶间');
  await table(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-risks.png', fullPage: true });
});

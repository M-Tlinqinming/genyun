import { expect, test, type Page } from '@playwright/test';

// 危险源辨识（14 页 E18-00C）：候选按整理后的设备、物料推出。
// 本文件排在 expert-workup-production 之后（那里新增了乙炔并判定为危化品）、expert-workup 之前；只改危险源，不影响必需项计数
async function openRisks(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  await page.getByRole('button', { name: /危险源辨识/ }).click();
  await expect(page.getByRole('region', { name: '危险源辨识' })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-row="risk:${id}"]`);
const basis = (page: Page) => page.getByRole('complementary', { name: '评价依据' });

test('周工按推荐候选取值，改值后等级跟着变，标不适用并手动新增', async ({ page }) => {
  await openRisks(page);
  const panel = page.getByRole('region', { name: '危险源辨识' });
  // 每份现场处置方案一类事故；乙炔判定为危化品后推出可燃气体爆炸
  await expect(panel).toContainText('火灾');
  await expect(panel).toContainText('可燃气体爆炸');
  await expect(panel).toContainText('可燃液体蒸气爆炸');
  await expect(page.getByRole('list', { name: '按作业场所' })).toContainText('配电房');

  // 默认选中第一项「火灾」：右栏说明为什么出现、后果取值参考标出系统默认
  const fire = row(page, 'SP01');
  await expect(fire).toContainText('42');
  await expect(fire).toContainText('一般危险');
  await expect(basis(page)).toContainText('每家企业都要辨识火灾风险');
  await expect(basis(page)).toContainText('严重，重伤（系统默认）');

  // 下拉改 C：D = 1 × 6 × 40 = 240，高度危险，来源变专家
  await fire.getByLabel('可能造成的后果').click();
  await page.getByTitle('40　灾难，数人死亡').click();
  await expect(fire).toContainText('240');
  await expect(fire).toContainText('高度危险');
  await expect(fire).toContainText('专家');
  await expect(fire).toContainText('C 7 → 40');
  await fire.getByLabel('改值说明').fill('成品仓紧邻车间，火灾可致数人伤亡');
  await fire.getByLabel('改值说明').press('Enter');
  await expect(fire).toContainText('成品仓紧邻车间，火灾可致数人伤亡。周工');

  // 退出再进还在
  await page.reload();
  await page.getByRole('button', { name: /危险源辨识/ }).click();
  await expect(row(page, 'SP01')).toContainText('240');

  // 在右栏的取值参考里点值：触电 C 改 15 → D = 90，显著危险
  await row(page, 'SP02').click();
  await expect(basis(page)).toContainText('触电 · 配电房');
  await basis(page).getByRole('button', { name: /^15/ }).click();
  await expect(row(page, 'SP02')).toContainText('90');
  await expect(row(page, 'SP02')).toContainText('显著危险');
  // 撤回回到系统推荐
  await row(page, 'SP02').getByRole('button', { name: '撤回修改，用系统推荐' }).click();
  await expect(row(page, 'SP02')).toContainText('42');
  await expect(row(page, 'SP02')).toContainText('系统');

  // 其他伤害标为不适用：不计入报告，可恢复
  await row(page, 'SP22').click();
  await row(page, 'SP22').getByRole('button', { name: '标为不适用' }).click();
  await expect(row(page, 'SP22')).toContainText('不适用');
  await expect(row(page, 'SP22').getByRole('button', { name: '恢复，计入报告' })).toBeVisible();

  // 手动新增：其他爆炸 · 气瓶间，D = 1 × 3 × 40 = 120
  await panel.getByRole('button', { name: '手动新增' }).click();
  const adding = page.getByRole('row', { name: '新增危险源' });
  await adding.getByLabel('危险有害因素').fill('其他爆炸');
  await adding.getByLabel('作业场所').fill('气瓶间');
  await adding.getByLabel('可能造成的后果').click();
  await page.getByTitle('40　灾难，数人死亡').last().click();
  await adding.getByRole('button', { name: '添加' }).click();
  const added = panel.locator('[data-row^="risk:x"]');
  await expect(added).toContainText('其他爆炸');
  await expect(added).toContainText('120');
  await expect(added).toContainText('显著危险');
  await expect(page.getByRole('list', { name: '按作业场所' })).toContainText('气瓶间');

  // 与 Paper E18-00C 并排对比用
  await row(page, 'SP01').click();
  await page.screenshot({ path: 'test-results/acceptance/m2-7-危险源辨识.png' });
});

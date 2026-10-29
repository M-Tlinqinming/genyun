import { expect, test, type Page } from '@playwright/test';

// 适用范围（14 页 E18-00D）：系统建议、专家确认、右栏预览即时更新。
// 本文件排在 expert-workup-risk 之后、expert-workup 之前：production 判定完压力管道、酒精、乙炔后，
// 只剩靠名称推断的粉尘（钻孔攻牙机）、熔融（熔炉）两个开关待确认，这里确认完
async function openScope(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  await page.getByRole('button', { name: /^适用范围/ }).click();
  await expect(page.getByRole('region', { name: '适用范围' })).toBeVisible();
}

const sw = (page: Page, key: string) => page.locator(`[data-row="scope:${key}"]`);
const preview = (page: Page) => page.getByRole('complementary', { name: '生成结构预览' });
const plan = (page: Page, title: string) => preview(page).locator(`[data-plan="${title}"]`);

test('周工确认待确认的开关，右栏预览即时更新；已确定的开关也能改、能撤回', async ({ page }) => {
  await openScope(page);
  const panel = page.getByRole('region', { name: '适用范围' });
  const groups = page.getByRole('list', { name: '适用范围分组' });
  await expect(page.getByText('整理中 · 必需项 16 / 19')).toBeVisible();
  await expect(panel).toContainText('待确认 2 项 · 系统已给出建议');
  await expect(groups.getByRole('listitem').filter({ hasText: '设备资产' })).toContainText('2 待确认');
  await expect(groups.getByRole('listitem').filter({ hasText: '业务关系' })).toContainText('客户已答');

  // 系统建议与依据；右栏把待确认开关影响的预案用虚线标出
  await expect(sw(page, 'dustProcess')).toContainText('资料里有「钻孔攻牙机」');
  await expect(sw(page, 'dustProcess')).toContainText('建议 开');
  await expect(sw(page, 'meltingProcess')).toContainText('资料里有「熔炉」');
  await expect(plan(page, '粉尘爆炸事故专项应急预案')).toHaveAttribute('data-state', 'pendingIn');
  await expect(plan(page, '高温熔融物爆炸事故现场处置方案')).toHaveAttribute('data-state', 'pendingIn');
  await expect(plan(page, '火灾爆炸事故专项应急预案')).toContainText('始终');
  // 与 Paper E18-00D 并排对比用
  await page.screenshot({ path: 'test-results/acceptance/m2-8-适用范围.png' });

  // 攻牙不产生可燃粉尘：关闭后两份粉尘爆炸预案即时从预览里去掉
  await sw(page, 'dustProcess').getByRole('button', { name: '关闭' }).click();
  await expect(plan(page, '粉尘爆炸事故专项应急预案')).toHaveCount(0);
  await expect(plan(page, '粉尘爆炸事故现场处置方案')).toHaveCount(0);
  // 熔炉确认开启
  await sw(page, 'meltingProcess').getByRole('button', { name: '开启' }).click();
  await expect(plan(page, '高温熔融物爆炸事故现场处置方案')).toHaveAttribute('data-state', 'included');
  await expect(panel).not.toContainText('待确认');
  await expect(page.getByRole('button', { name: /^适用范围\s*✓/ })).toBeVisible();
  await expect(page.getByText('整理中 · 必需项 18 / 19')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 1 项：技术人员数');

  // 点已确定的名称看谁确认的
  await panel.getByRole('list', { name: '已关闭' }).getByRole('button', { name: '粉尘' }).click();
  await expect(sw(page, 'dustProcess')).toContainText(/专家确认关 · 周工/);

  // 客户回答没有出租厂房，专家也能改：打开后多出承租企业专项预案，撤回后回到客户回答
  await panel.getByRole('button', { name: '出租厂房：否' }).click();
  await sw(page, 'landlord').getByRole('button', { name: '开启' }).click();
  await expect(plan(page, '承租企业生产安全事故专项应急预案')).toHaveAttribute('data-state', 'included');
  await expect(panel.getByRole('list', { name: '已开启' })).toContainText('出租厂房');
  await sw(page, 'landlord').getByRole('button', { name: '撤回' }).click();
  await expect(plan(page, '承租企业生产安全事故专项应急预案')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '出租厂房：否' })).toBeVisible();

  // 左栏按组看
  await groups.getByRole('listitem').filter({ hasText: '业务关系' }).click();
  await expect(panel).toContainText('道路运输');
  await expect(panel).not.toContainText('粉尘');
  await panel.getByRole('button', { name: '全部 20 项' }).click();
  await expect(panel).toContainText('粉尘');

  // 退出再进还在；危险源候选跟着确认后的开关
  await page.reload();
  await page.getByRole('button', { name: /^适用范围/ }).click();
  await expect(page.getByRole('region', { name: '适用范围' }).getByRole('list', { name: '已关闭' })).toContainText('粉尘');
  await page.getByRole('button', { name: /^危险源辨识/ }).click();
  const risks = page.getByRole('region', { name: '危险源辨识' });
  await expect(risks).toContainText('高温熔融物爆炸');
  await expect(risks).not.toContainText('粉尘爆炸');
});

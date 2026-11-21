import { expect, test, type Page } from '@playwright/test';

// 适用范围（13 页 E2-5a，资料核对第 5 步第 1 页）：要您确认的几项点开启或关闭；第 3 步已经答过的只读，去第 3 步改。
// 本文件排在 expert-workup-risk 之后、expert-workup 之前：production 判定完压力管道、酒精、乙炔后，
// 剩靠名称推断的粉尘（钻孔攻牙机）、熔融（熔炉）和淹溺（有消防水池）等开关要专家确认，这里确认完
async function openScope(page: Page) {
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

const confirm = (page: Page) => page.getByRole('region', { name: '要您确认' });
const sw = (page: Page, key: string) => page.locator(`[data-scope="${key}"]`);
const saved = (page: Page) => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/workup/scope') && r.ok());

test('周工确认系统预设的开关；第 3 步答过的只读，可去第 3 步改；危险源候选跟着开关', async ({ page }) => {
  await openScope(page);
  // 系统预设和依据
  await expect(confirm(page)).toContainText(/要您确认 \d+ 项 · 系统已预设/);
  await expect(sw(page, 'dustProcess')).toContainText('钻孔攻牙机');
  await expect(sw(page, 'dustProcess')).toContainText('系统预设：开');
  await expect(sw(page, 'meltingProcess')).toContainText('熔炉');
  await expect(sw(page, 'waterHazard')).toContainText('消防水池');
  await page.getByRole('region', { name: '要您确认' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-scope.png', fullPage: true });

  // 攻牙不产生可燃粉尘：关闭；熔炉、消防水池确认开启。确认后留在原位，标「您已确认」
  let s = saved(page);
  await sw(page, 'dustProcess').getByRole('button', { name: '关闭' }).click();
  await s;
  await expect(sw(page, 'dustProcess')).toContainText('您已确认');
  await expect(sw(page, 'dustProcess').getByRole('button', { name: '关闭' })).toHaveAttribute('aria-pressed', 'true');
  s = saved(page);
  await sw(page, 'meltingProcess').getByRole('button', { name: '开启' }).click();
  await s;
  s = saved(page);
  await sw(page, 'waterHazard').getByRole('button', { name: '开启' }).click();
  await s;
  await expect(sw(page, 'waterHazard')).toContainText('您已确认');

  // 第 3 步已经答过的：只读，没有开关按钮；出租厂房按第 3 步的回答关闭
  const step3 = page.getByRole('region', { name: '第 3 步已经答过' });
  await expect(step3.locator('[data-scope="landlord"]')).toContainText('关闭');
  await expect(step3.getByRole('button', { name: '开启' })).toHaveCount(0);

  // 退出再进：确认过的归到「其余已确定」；粉尘关了，危险源候选里没有粉尘爆炸，熔融在
  await page.reload();
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
  await expect(sw(page, 'dustProcess')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '其余已确定' })).toContainText(/已关闭 \d+[^已]*粉尘/);
  const risks = page.getByRole('table', { name: '危险源' });
  await expect(risks).toContainText('高温熔融物爆炸');
  await expect(risks).not.toContainText('粉尘爆炸');

  // 去第 3 步修改
  await step3.getByRole('button', { name: '去第 3 步修改' }).click();
  await expect(page).toHaveURL(/view=workup&step=3/);
  await expect(page.getByRole('heading', { name: '核对场所、设备与物料' })).toBeVisible();
});

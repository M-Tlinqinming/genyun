import { expect, test, type Page } from '@playwright/test';

// 编制次数（K14）。文件名排在 task-publish.spec 之后、task-results.spec 之前：
// 飞宇的合同买了 3 次，专家第一次交付后扣成 2 次。只读，不改演示数据。
// 锁住到放开的整条链路靠接口单元测试覆盖
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

test('首次交付扣了 1 次：管理员收到「还剩 2 次」，运营看得到扣减记录，成果照常能下载', async ({ page, browser }) => {
  await login(page, 'feiyu@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer/);
  await page.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  await expect(page.getByRole('button', { name: /编制次数还剩 2 次/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // 成果文档照常能下载（没锁住：没有置灰）
  await page.getByRole('menuitem', { name: '成果文档' }).click();
  const card = page.getByRole('region', { name: /惠阳飞宇电器有限公司 GY-\d{4}-\d{3}/ });
  await expect(card).toContainText('已交付');
  await expect(card.getByRole('button', { name: /下载整套 Word/ })).toBeEnabled();
  await expect(card.getByRole('button', { name: '下载 惠阳飞宇电器有限公司应急预案.docx' })).toBeEnabled();

  // 运营：剩余 2 次，一行「交付成果 −1」
  const ctx = await browser.newContext();
  const ops = await ctx.newPage();
  await login(ops, 'ops@demo.genyun.net.cn');
  await expect(ops).toHaveURL(/\/operator/);
  const orgs = (await (await ops.request.get('/api/operator/organizations')).json()) as { id: string; name: string }[];
  const feiyu = orgs.find((o) => o.name.includes('飞宇'))!;
  const res = await ops.request.get(`/api/operator/organizations/${feiyu.id}/credits`);
  expect(res.status()).toBe(200);
  const credits = (await res.json()) as { remaining: { total: number }; entries: { typeLabel: string; delta: number }[] };
  expect(credits.remaining.total).toBe(2);
  expect(credits.entries.filter((e) => e.typeLabel === '交付成果' && e.delta === -1)).toHaveLength(1);
  await ctx.close();
});

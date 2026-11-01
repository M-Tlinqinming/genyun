import { expect, test } from '@playwright/test';

// M3 第 4 项：运营任务中心「上门工单」（Paper 16 页 I04）。客户在任务里预约上门 → 运营看客户填写的内容、写内部备注、标记已转交公司、关闭（写下结果）
const FEIYU = '惠阳飞宇电器有限公司';

test('客户的上门需求出现在上门工单；运营写内部备注、标记已转交公司、关闭', async ({ browser }) => {
  const opsCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await opsCtx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/operator$/);

  // 客户（飞宇）在自己的任务里预约上门。任务从客户自己的组织取：enterprises.spec 会在别的组织再建一家同名企业
  const customer = await browser.newContext();
  expect((await customer.request.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } })).ok()).toBe(true);
  const me = await (await customer.request.get('/api/auth/me')).json();
  const orgId = me.memberships[0].orgId as string;
  const tasks = (await (await customer.request.get(`/api/orgs/${orgId}/tasks`)).json()) as { id: string; enterpriseName: string }[];
  const feiyuTask = tasks.find((t) => t.enterpriseName === FEIYU)!;
  const created = await customer.request.post(`/api/tasks/${feiyuTask.id}/on-site-requests`, {
    data: { contactName: '陈志刚', contactPhone: '0752-3456789', helpItems: ['消防水池'] },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await customer.close();

  await page.goto('/operator/tasks');
  await page.getByRole('tab', { name: /上门工单/ }).click();
  const list = page.getByRole('tabpanel', { name: '上门工单' });
  const row = list.getByRole('button', { name: new RegExp(FEIYU) }).first();
  await expect(row).toContainText('新工单');
  await expect(row).toContainText('需要帮忙 1 项 · 陈志刚 075 **** 6789');
  await row.click();
  const panel = page.getByRole('region', { name: '上门工单详情' });
  await expect(panel.getByRole('heading', { name: `上门工单 · ${FEIYU}` })).toBeVisible();
  await expect(panel).toContainText('客户组织：飞宇演示客户');
  // 号码打码显示，旁边可以复制
  await expect(panel).toContainText('075 **** 6789');
  await expect(panel.getByRole('button', { name: '复制号码' })).toBeVisible();
  await expect(panel).toContainText('消防水池');
  await expect(panel).toContainText('报价、排期、现场交接都在线下进行');
  await page.screenshot({ path: 'out/m3-4-I04-on-site.png' });
  // 1366×768 下不横向滚动
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'out/m3-4-I04-on-site-1366.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await panel.getByLabel('上门工单内部备注').fill('已约周三上门');
  await panel.getByRole('button', { name: '保存备注' }).click();
  await expect(page.getByText('内部备注已保存')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存备注' })).toHaveCount(0);

  await panel.getByRole('button', { name: '标记已转交公司' }).click();
  await expect(panel.locator('header')).toContainText(/已转交公司 · \d+\.\d+/);
  await expect(panel.getByRole('button', { name: '标记已转交公司' })).toHaveCount(0);
  // 关闭时把结果一起写进内部备注
  await panel.getByLabel('上门工单内部备注').fill('已约周三上门；公司已上门，资料已补齐');
  await panel.getByRole('button', { name: '关闭工单' }).click();
  await expect(panel.locator('header')).toContainText(/已关闭 · \d+\.\d+/);
  await expect(panel.getByLabel('上门工单内部备注')).toHaveValue('已约周三上门；公司已上门，资料已补齐');
  await expect(panel.getByRole('button', { name: '重新打开' })).toBeVisible();
  await page.screenshot({ path: 'out/m3-4-I04-on-site-closed.png' });

  // 客户只看到已收到上门需求，看不到内部备注和工单状态
  const back = await browser.newContext();
  await back.request.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } });
  const seen = await (await back.request.get(`/api/tasks/${feiyuTask.id}`)).text();
  expect(seen).not.toContain('资料已补齐');
  await back.close();
  await opsCtx.close();
});

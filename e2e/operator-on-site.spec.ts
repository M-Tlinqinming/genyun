import { expect, test } from '@playwright/test';

// M3 第 4 项：运营任务中心「上门工单」（Paper 16 页 I04）。客户在任务里预约上门 → 运营写内部备注、转交、关闭
const FEIYU = '惠阳飞宇电器有限公司';

test('客户的上门需求出现在上门工单；运营写内部备注、标记已转交公司、关闭', async ({ browser }) => {
  const opsCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await opsCtx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/operator$/);

  // 客户（飞宇）在自己的任务里预约上门
  const tasks = (await (await page.request.get('/api/operator/tasks')).json()) as { id: string; enterpriseName: string }[];
  const feiyuTask = tasks.find((t) => t.enterpriseName === FEIYU)!;
  const customer = await browser.newContext();
  expect((await customer.request.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } })).ok()).toBe(true);
  const created = await customer.request.post(`/api/tasks/${feiyuTask.id}/on-site-requests`, {
    data: { contactName: '陈志刚', contactPhone: '0752-3456789', helpItems: ['消防水池'] },
  });
  expect(created.ok()).toBe(true);
  await customer.close();

  await page.goto('/operator/tasks');
  await page.getByRole('tab', { name: /上门工单/ }).click();
  const list = page.getByRole('tabpanel', { name: '上门工单' });
  await expect(list.getByRole('button', { name: new RegExp(FEIYU) }).first()).toContainText('新工单');
  const panel = page.getByRole('region', { name: '上门工单详情' });
  await expect(panel).toContainText('陈志刚 0752-3456789');
  await expect(panel).toContainText('消防水池');

  await panel.getByLabel('上门工单内部备注').fill('已约周三上门');
  await panel.getByRole('button', { name: '保存备注' }).click();
  await expect(page.getByText('内部备注已保存')).toBeVisible();

  await panel.getByRole('button', { name: '标记已转交公司' }).click();
  await expect(panel.locator('header')).toContainText('已转交公司');
  await panel.getByRole('button', { name: '关闭工单' }).click();
  await expect(panel.locator('header')).toContainText('已关闭');
  await expect(panel.getByLabel('上门工单内部备注')).toHaveValue('已约周三上门');
  await opsCtx.close();
});

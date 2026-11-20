import { expect, test, type Page } from '@playwright/test';

// 企业资料库（11 页 C03 企业资料）。任务里从企业资料中选用随旧的准备资料页一起取消，那几条测试已删。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业用接口直接建
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

let page: Page;
let enterpriseId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);

  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  const orgId = me.memberships[0]!.orgId;
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州飞宇资料库测试有限公司' } });
  enterpriseId = ((await ent.json()) as { id: string }).id;
});

test.afterAll(async () => {
  await page.close();
});

const libraryTable = () => page.getByRole('tabpanel').getByRole('table');

test('企业资料标签：上传两份资料，分类待整理、版本 V1', async () => {
  await page.goto(`/customer/enterprises/${enterpriseId}?tab=documents`);
  await expect(page.getByRole('tab', { name: '企业资料', selected: true })).toBeVisible();
  await expect(page.getByText('还没有企业资料')).toBeVisible();

  await page.getByRole('tabpanel').locator('input[type=file]').first().setInputFiles([pdf('应急人员名册.pdf'), pdf('总平面图.pdf')]);
  await expect(page.getByText('2 份文件')).toBeVisible();
  const row = libraryTable().getByRole('row').filter({ hasText: '应急人员名册.pdf' });
  await expect(row).toContainText('待整理');
  await expect(row).toContainText('V1');
});

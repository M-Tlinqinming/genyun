import { expect, test, type Page } from '@playwright/test';

// 企业资料库（11 页 C03 企业资料）。任务里「从企业资料中选择」的界面随旧的准备资料页一起取消，
// 那两条测试已删；任务选用某个版本改用接口做，只为了验证资料库传新版本时的提示。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

let page: Page;
let enterpriseId: string;
let taskId: string;

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
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  taskId = ((await task.json()) as { id: string }).id;
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

test('资料库上传新版本：任务仍用 V1 并提示', async () => {
  // 任务选用名册的 V1（原来在任务页「从企业资料中选择」里点，现在用接口）
  const docs = (await (await page.request.get(`/api/enterprises/${enterpriseId}/documents`)).json()) as {
    id: string;
    latest: { versionId: string; originalName: string };
  }[];
  const roster = docs.find((d) => d.latest.originalName === '应急人员名册.pdf')!;
  const linked = await page.request.put(`/api/tasks/${taskId}/documents`, {
    data: { selections: [{ documentId: roster.id, versionId: roster.latest.versionId }] },
  });
  expect(linked.ok()).toBe(true);
  await page.reload();

  await page.getByRole('button', { name: '应急人员名册.pdf的版本与使用记录' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.locator('input[type=file]').setInputFiles(pdf('应急人员名册（修订）.pdf'));
  await expect(drawer.getByRole('list', { name: '版本' }).getByRole('listitem')).toHaveCount(2);
  await expect(drawer.getByRole('listitem').first()).toContainText('当前版本');
  await expect(drawer.getByRole('listitem').first()).toContainText('没有任务在用');
  await page.keyboard.press('Escape');
  await expect(page.getByText('新版本已保存，任务里仍用原来的版本')).toBeVisible();
  await expect(libraryTable().getByRole('row').filter({ hasText: '应急人员名册.pdf' })).toContainText('V2');
});

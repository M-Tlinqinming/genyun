import { expect, test, type Page } from '@playwright/test';

// 第 10b 项：企业资料库（11 页 C03 企业资料、12 页 P03B 从企业资料中选用）。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

let page: Page;
let taskId: string;
let taskNumber: string;
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
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  ({ id: taskId, number: taskNumber } = (await task.json()) as { id: string; number: string });
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'upload' } });
});

test.afterAll(async () => {
  await page.close();
});

const libraryTable = () => page.getByRole('tabpanel').getByRole('table');
const taskTable = () => page.getByRole('table', { name: '本次原始资料' });

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

test('任务里从企业资料中选用两份，确认后关联到任务', async () => {
  await page.goto(`/customer/tasks/${taskId}`);
  await page.getByRole('button', { name: '从企业资料中选择' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('已选择 0 份，与当前关联一致。')).toBeVisible();
  await dialog.getByRole('checkbox', { name: '选用应急人员名册.pdf' }).check();
  await dialog.getByRole('checkbox', { name: '选用总平面图.pdf' }).check();
  await expect(dialog.getByText('已选择 2 份，确认后新增 2 份。')).toBeVisible();
  await dialog.getByRole('button', { name: '确认选用版本' }).click();
  await expect(taskTable()).toContainText('已关联 2 份原始文件');
});

test('资料库上传新版本：任务仍用 V1 并提示，使用记录写明哪个任务在用', async () => {
  await page.getByRole('button', { name: '查看企业资料' }).click();
  await expect(page.getByRole('tab', { name: '企业资料', selected: true })).toBeVisible();
  await page.getByRole('button', { name: '应急人员名册.pdf的版本与使用记录' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(`使用中：${taskNumber}`);

  await drawer.locator('input[type=file]').setInputFiles(pdf('应急人员名册（修订）.pdf'));
  await expect(drawer.getByRole('list', { name: '版本' }).getByRole('listitem')).toHaveCount(2);
  await expect(drawer.getByRole('listitem').first()).toContainText('当前版本');
  await expect(drawer.getByRole('listitem').first()).toContainText('没有任务在用');
  await page.keyboard.press('Escape');
  await expect(page.getByText('新版本已保存，任务里仍用原来的版本')).toBeVisible();
  await expect(libraryTable().getByRole('row').filter({ hasText: '应急人员名册.pdf' })).toContainText('V2');
});

test('任务里看到「有新版本」，明确改选 V2 后才更换', async () => {
  await page.getByRole('link', { name: `前往 ${taskNumber}` }).click();
  const row = taskTable().getByRole('row').filter({ hasText: '应急人员名册.pdf' });
  await expect(row).toContainText('V1');
  await expect(row).toContainText('有新版本 V2');

  await page.getByRole('button', { name: '从企业资料中选择' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('应急人员名册.pdf的版本').click();
  await page.getByTitle('V2（最新）').click();
  await expect(dialog.getByText('已选择 2 份，确认后改版本 1 份。')).toBeVisible();
  await dialog.getByRole('button', { name: '确认选用版本' }).click();
  await expect(row).toContainText('V2');
  await expect(row).not.toContainText('有新版本');
});

import { expect, test, type Page } from '@playwright/test';

// 第 10a 项：上传已有资料路线（12 页 P03 上传、P04 部分失败只重试失败项）。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

let page: Page;
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
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州飞宇上传测试有限公司' } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'upload' } });
});

test.afterAll(async () => {
  await page.close();
});

const mainInput = () => page.getByTestId('drop-zone').locator('input[type=file]');
const table = () => page.getByRole('table', { name: '本次原始资料' });

test('任务页显示资料准备阶段，一次选多份文件全部保存并关联', async () => {
  await page.goto(`/customer/tasks/${taskId}`);
  await expect(page.getByRole('heading', { name: '先准备企业已有资料' })).toBeVisible();
  await expect(page.getByRole('list', { name: '任务阶段' }).locator('[aria-current=step]')).toHaveText(/资料准备/);
  await expect(page.getByRole('button', { name: '检查资料' })).toBeDisabled();

  await mainInput().setInputFiles([pdf('企业资料清单.pdf'), pdf('应急人员名册.pdf')]);
  await expect(table()).toContainText('已关联 2 份原始文件');
  await expect(table().getByRole('row').filter({ hasText: '企业资料清单.pdf' })).toContainText('V1已保存并关联');
  await expect(page.getByRole('button', { name: '检查资料' })).toBeEnabled();
});

test('一份格式不对：其余照常保存，失败的一份重选后保存', async () => {
  const bad = { name: '疏散图.pdf', mimeType: 'application/pdf', buffer: Buffer.from('这不是 PDF') };
  await mainInput().setInputFiles([pdf('应急资源清单.pdf'), bad]);
  await expect(page.getByRole('heading', { name: '3 份文件已保存，1 份上传失败' })).toBeVisible();
  const failed = page.getByTestId('pending-row');
  await expect(failed).toContainText('失败 · 未保存');
  await expect(failed).toContainText('格式不支持');
  await expect(page.getByRole('button', { name: '先检查已保存资料' })).toBeVisible();

  await failed.locator('input[type=file]').setInputFiles(pdf('疏散图.pdf'));
  await expect(page.getByTestId('pending-row')).toHaveCount(0);
  await expect(table()).toContainText('已关联 4 份原始文件');
  await expect(page.getByRole('heading', { name: '先准备企业已有资料' })).toBeVisible();
});

test('上传时断网：只有这一份失败，网络恢复后点重试即可', async () => {
  await page.route('**/api/orgs/*/files*', (route) => route.abort('connectionreset'));
  await mainInput().setInputFiles(pdf('总平面图.pdf'));
  await expect(page.getByRole('heading', { name: '4 份文件已保存，1 份上传失败' })).toBeVisible();
  await expect(page.getByTestId('pending-row')).toContainText('上传时连接中断，请检查网络后重试');
  await page.unroute('**/api/orgs/*/files*');

  await page.getByRole('button', { name: '重试总平面图.pdf' }).click();
  await expect(table()).toContainText('已关联 5 份原始文件');
  await expect(page.getByTestId('pending-row')).toHaveCount(0);
});

test('移除只取消本任务的关联；刷新后已保存的文件还在', async () => {
  await page.getByRole('button', { name: '移除应急人员名册.pdf' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '移除' }).click();
  await expect(table()).toContainText('已关联 4 份原始文件');
  await expect(table()).not.toContainText('应急人员名册.pdf');

  await page.reload();
  await expect(table()).toContainText('已关联 4 份原始文件');
  for (const name of ['企业资料清单.pdf', '应急资源清单.pdf', '疏散图.pdf', '总平面图.pdf']) {
    await expect(table()).toContainText(name);
  }
});

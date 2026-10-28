import { expect, test, type Page } from '@playwright/test';

// 设计对齐第 1 批（设计差异清单 10-28 定为「改代码」的项）：新建企业时识别营业执照、企业详情概况与来源、
// 资料文件图标、联系耕云。只登录一次、共用同一个页面
test.describe.configure({ mode: 'serial' });

let page: Page;
let enterpriseId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
});

test.afterAll(async () => {
  await page.close();
});

test('新建企业：上传营业执照，识别出的身份信息填进表单，改过的以表单为准', async () => {
  await page.goto('/customer/enterprises/new');
  await expect(page.getByText('上传营业执照，可帮助填写下方信息')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: '营业执照.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') });
  await expect(page.getByText(/已识别 \d+ 项，已填入下方，请核对/)).toBeVisible();
  await expect(page.getByLabel('企业名称')).toHaveValue('惠阳飞宇电器有限公司');
  await expect(page.getByLabel('法定代表人')).toHaveValue('李文聪');
  // 模拟识别总给同一个信用代码，别的测试的企业可能已占用：客户核对时改一下
  await page.getByLabel('企业名称').fill('惠阳飞宇对齐测试有限公司');
  await page.getByLabel('统一社会信用代码').fill('91441300MA4ALGN001');
  await page.getByRole('button', { name: '保存企业档案' }).click();
  await expect(page).toHaveURL(/\/customer\/enterprises\/[0-9a-f-]{36}$/);
  enterpriseId = page.url().split('/').pop()!;

  await expect(page.getByRole('heading', { name: '惠阳飞宇对齐测试有限公司' })).toBeVisible();
  // 概况行：从注册地址取出区
  await expect(page.getByText('惠阳区', { exact: true })).toBeVisible();
  const basic = (await (await page.request.get(`/api/enterprises/${enterpriseId}/basic-step`)).json()) as {
    identity: { name: string };
    license: { originalName: string } | null;
    sources: Record<string, string>;
  };
  expect(basic.identity.name).toBe('惠阳飞宇对齐测试有限公司');
  expect(basic.license?.originalName).toBe('营业执照.pdf');
  expect(basic.sources.legalRepresentative).toBe('license');
  expect(basic.sources.name).toBeUndefined();
});

test('企业详情：基本信息 6 项，带来源；资料库有文件类型图标与份数', async () => {
  const facts = page.getByRole('heading', { name: '企业基本信息' }).locator('..');
  for (const label of ['统一社会信用代码', '法定代表人', '注册地址', '实际生产地址', '企业联系人', '员工人数']) {
    await expect(facts.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(facts.getByText('来自营业执照').first()).toBeVisible();
  await expect(page.getByText('1 份原件')).toBeVisible();
  await page.getByRole('tab', { name: '企业资料 1' }).click();
  await expect(page.getByRole('img', { name: 'PDF' })).toBeVisible();
});

test('实际生产地址默认带出注册地址，标「同注册地址」', async () => {
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  const taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
  await page.goto(`/customer/tasks/${taskId}/fill/1`);
  await expect(page.getByLabel('实际生产地址')).toHaveValue('惠州市惠阳区淡水街道金惠大道 18 号');
  await expect(page.getByText('同注册地址')).toBeVisible();
});

test('联系耕云：顶栏打开，显示电话和微信二维码', async () => {
  await page.goto('/customer');
  await page.getByRole('button', { name: '联系耕云' }).click();
  const dialog = page.getByRole('dialog', { name: '联系耕云' });
  await expect(dialog).toContainText('0752-5200831');
  await expect(dialog.getByRole('img', { name: '耕云微信二维码' })).toBeVisible();
});

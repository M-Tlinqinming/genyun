import { expect, test, type Page } from '@playwright/test';

// 第 5 项：创建编制任务、重复创建带到已有任务、合同到期不能新建、选择开始方式。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业用接口直接建，不依赖其他测试文件
test.describe.configure({ mode: 'serial' });

let page: Page;
let orgId: string;

async function createEnterprise(name: string): Promise<string> {
  const res = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  orgId = me.memberships[0]!.orgId;
});

test.afterAll(async () => {
  await page.close();
});

test('从企业详情创建任务，进入选择开始方式，选「按提示填写」', async () => {
  const id = await createEnterprise('惠州示例五金有限公司');
  await page.goto(`/customer/enterprises/${id}`);
  await page.getByRole('button', { name: '创建编制任务' }).click();

  await expect(page.getByRole('heading', { name: '创建编制任务' })).toBeVisible();
  await expect(page.getByLabel('所属企业')).toHaveValue('惠州示例五金有限公司');
  await expect(page.getByLabel('业务类型')).toHaveValue('生产安全事故应急预案编制');
  const year = new Date().getFullYear();
  await expect(page.getByLabel('任务名称')).toHaveValue(`${year} 年应急预案编制`);

  await page.getByLabel('任务名称').fill('');
  await page.getByRole('button', { name: '创建草稿并准备资料' }).click();
  await expect(page.getByText('请填写任务名称')).toBeVisible();
  await page.getByLabel('任务名称').fill(`${year} 年应急预案编制`);
  await page.getByRole('button', { name: '创建草稿并准备资料' }).click();

  await expect(page).toHaveURL(/\/customer\/tasks\/[0-9a-f-]{36}\/start$/);
  await expect(page.getByRole('heading', { name: '您想怎么开始？' })).toBeVisible();
  await expect(page.getByText('惠州示例五金有限公司')).toBeVisible();
  await expect(page.getByRole('region', { name: '按提示填写' })).toBeVisible();
  await expect(page.getByRole('region', { name: '上传已有资料' })).toBeVisible();

  await page.getByRole('button', { name: '开始填写' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/[0-9a-f-]{36}\/fill\/1$/);
  await expect(page.getByRole('heading', { name: '先告诉我们，您是一家什么样的企业' })).toBeVisible();
});

test('再点创建任务，被带到已有任务', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page.getByRole('heading', { name: '惠州示例五金有限公司' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续准备资料' })).toBeVisible();
  await page.getByRole('button', { name: '创建编制任务' }).click();

  await expect(page.getByText('该企业已有同类在办任务')).toBeVisible();
  await expect(page.getByText(/GY-\d{4}-\d{3} · \d{4} 年应急预案编制 · 资料准备中/)).toBeVisible();
  await expect(page.getByRole('button', { name: '创建草稿并准备资料' })).toHaveCount(0);
  await page.getByRole('button', { name: '继续已有任务' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/[0-9a-f-]{36}\/fill\/1$/);
});

test('填表期间同事已建好任务：提交时提示并带到那个任务，还没选方式就先选', async () => {
  const id = await createEnterprise('惠州示例塑胶有限公司');
  await page.goto(`/customer/enterprises/${id}/tasks/new`);
  await expect(page.getByRole('button', { name: '创建草稿并准备资料' })).toBeVisible();

  const other = await page.request.post(`/api/enterprises/${id}/tasks`, { data: { name: '同事建的任务' } });
  expect(other.ok()).toBeTruthy();

  await page.getByRole('button', { name: '创建草稿并准备资料' }).click();
  await expect(page.getByText('该企业已有同类在办任务')).toBeVisible();
  await expect(page.getByText(/GY-\d{4}-\d{3} · 同事建的任务。建议继续已有任务/)).toBeVisible();
  await page.getByRole('button', { name: '继续已有任务' }).click();
  await expect(page).toHaveURL(/\/start$/);

  await page.getByRole('button', { name: '上传资料' }).click();
  await expect(page.getByRole('heading', { name: '先准备企业已有资料' })).toBeVisible();
});

test('合同不在有效期内时不能新建任务', async () => {
  const id = await createEnterprise('惠州示例纸品有限公司');
  // 模拟合同已到期：只改机构信息的返回，后台的同一条规则另有接口测试
  await page.route(`**/api/orgs/${orgId}`, async (route) => {
    const res = await route.fetch();
    const org = await res.json();
    await route.fulfill({
      response: res,
      json: { ...org, contractStartsAt: '2024-01-01', contractEndsAt: '2025-12-31' },
    });
  });
  await page.goto(`/customer/enterprises/${id}/tasks/new`);
  await expect(page.getByText('暂时不能新建任务')).toBeVisible();
  await expect(page.getByText(/合同不在有效期内.*已交付的成果仍可下载/)).toBeVisible();
  await expect(page.getByRole('button', { name: '创建草稿并准备资料' })).toBeDisabled();
  await page.unroute(`**/api/orgs/${orgId}`);
});

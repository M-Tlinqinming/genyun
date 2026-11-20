import { expect, test, type Page } from '@playwright/test';

// 新建任务（12 页）：选所属企业、填任务名称，新建后进入准备资料；列表里没有的企业当场新建；
// 同一企业已有没办完的任务时改为继续那个任务；年度服务到期不能新建。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业用接口直接建，不依赖其他测试文件
test.describe.configure({ mode: 'serial' });

let page: Page;
let orgId: string;
// 设了 K4_SHOTS（一个目录）就顺手截几张图，和设计稿对照用
const SHOTS = process.env.K4_SHOTS;
const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

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

const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()));
const form = () => page.locator('section').filter({ hasText: '任务信息' });
const callout = () => page.getByRole('status', { name: '这家企业已有任务' });

test('从企业概览新建任务：带上这家企业，新建后进入准备资料', async () => {
  const id = await createEnterprise('惠州示例五金有限公司');
  await page.goto(`/customer/enterprises/${id}`);
  await page.getByRole('button', { name: '新建任务' }).click();

  await expect(page).toHaveURL(new RegExp(`/customer/tasks/new\\?enterpriseId=${id}$`));
  await expect(page.getByRole('navigation', { name: '位置' })).toHaveText('企业 / 惠州示例五金有限公司 / 新建任务');
  await expect(page.getByRole('heading', { name: '新建任务' })).toBeVisible();
  await expect(form()).toContainText('惠州示例五金有限公司');
  await expect(page.getByLabel('任务名称')).toHaveValue(`${year} 年应急预案编制`);
  await expect(page.getByText('新建后开始准备资料：下载资料模板，填好上传。提交给专家之前，任务可以删除。')).toBeVisible();
  await shot('u0');

  await page.getByLabel('任务名称').fill('');
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page.getByText('请填写任务名称')).toBeVisible();
  await page.getByLabel('任务名称').fill(`${year} 年应急预案编制`);
  await page.getByRole('button', { name: '新建任务' }).click();

  await expect(page).toHaveURL(/\/customer\/tasks\/[0-9a-f-]{36}\/prepare$/);
  await expect(page.getByRole('heading', { name: '下载资料模板，填好后上传' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('编制应急预案');
  await expect(page.getByRole('banner')).toContainText('惠州示例五金有限公司');
  await shot('prepare');
});

test('旧地址跳到新建任务页；这家企业已有任务在准备资料时，改为继续已有任务', async () => {
  const id = await createEnterprise('惠州示例纸品有限公司');
  const first = (await (await page.request.post(`/api/enterprises/${id}/tasks`, { data: { name: '纸品的第一个任务' } })).json()) as {
    id: string;
  };
  await page.goto(`/customer/enterprises/${id}/tasks/new`);
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/new\\?enterpriseId=${id}$`));

  await expect(callout()).toContainText('这家企业已经有一个任务在准备资料');
  await expect(callout()).toContainText('「纸品的第一个任务」还没提交。继续这个任务就行，已经传的资料都还在。');
  await expect(page.getByRole('button', { name: '新建任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回企业概览' })).toBeVisible();
  await shot('u0b');
  await page.getByRole('button', { name: '继续已有任务' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${first.id}/prepare$`));
});

test('已经提交给专家的任务：只能查看这个任务', async () => {
  const id = await createEnterprise('惠州示例玻璃有限公司');
  const fake = { id: '00000000-0000-4000-8000-000000000001', number: 'GY-2026-999', name: '玻璃的任务', status: 'submitted' };
  await page.route(`**/api/enterprises/${id}/open-task`, (route) => route.fulfill({ json: { openTask: fake } }));
  await page.goto(`/customer/tasks/new?enterpriseId=${id}`);
  await expect(callout()).toContainText('这家企业已经有一个任务在专家编制');
  await expect(callout()).toContainText('「玻璃的任务」已经提交给专家，交付以后才能新建下一个任务。');
  await expect(page.getByRole('button', { name: '查看这个任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续已有任务' })).toHaveCount(0);
  await page.unroute(`**/api/enterprises/${id}/open-task`);
});

test('从任务列表新建：没选企业有提示；搜不到的企业当场新建并自动选中；重名时选已有的那家', async () => {
  await page.goto('/customer/tasks');
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/new$/);
  await expect(page.getByRole('navigation', { name: '位置' })).toHaveText('任务 / 新建任务');

  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page.getByText('请选这次为哪家企业编制')).toBeVisible();

  // 搜不到：组织管理员可以当场新建，名称预填
  await page.getByLabel('所属企业').fill('示例电子');
  await expect(page.getByText('没有找到「示例电子」')).toBeVisible();
  await page.getByRole('button', { name: '＋ 新建企业「示例电子」' }).click();
  const dialog = page.getByRole('dialog', { name: '新建企业' });
  await expect(dialog.getByLabel('企业名称')).toHaveValue('示例电子');
  await expect(dialog.getByText('按营业执照上的全称填。其他信息在资料模板里填。')).toBeVisible();
  await dialog.getByLabel('企业名称').fill('');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog.getByText('请填企业名称')).toBeVisible();
  await dialog.getByLabel('企业名称').fill('惠州示例电子有限公司');
  await shot('s07-modal');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(form()).toContainText('惠州示例电子有限公司');
  await expect(page.getByText('请选这次为哪家企业编制')).toHaveCount(0);

  // 重名（多了空格也算）：提示后选那家已有的企业，它已有任务就改为继续已有任务
  await page.getByLabel('所属企业').fill('五金新厂');
  await page.getByRole('button', { name: '＋ 新建企业「五金新厂」' }).click();
  await dialog.getByLabel('企业名称').fill(' 惠州示例五金 有限公司 ');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog.getByText('组织里已经有这家企业了，直接在「所属企业」里选它。')).toBeVisible();
  await shot('s08-duplicate');
  await dialog.getByRole('button', { name: '选这家企业' }).click();
  await expect(dialog).toBeHidden();
  await expect(form()).toContainText('惠州示例五金有限公司');
  await expect(callout()).toContainText('这家企业已经有一个任务在准备资料');

  // 换回刚建的企业，回到表单
  await page.getByLabel('所属企业').fill('示例电子');
  await page.getByTitle('惠州示例电子有限公司').click();
  await expect(callout()).toHaveCount(0);
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/[0-9a-f-]{36}\/prepare$/);
  await expect(page.getByRole('banner')).toContainText('编制应急预案');
  await expect(page.getByRole('banner')).toContainText('惠州示例电子有限公司');
});

test('填表期间同事已建好任务：点新建时改为继续那个任务', async () => {
  const id = await createEnterprise('惠州示例塑胶有限公司');
  await page.goto(`/customer/tasks/new?enterpriseId=${id}`);
  await expect(page.getByRole('button', { name: '新建任务' })).toBeVisible();

  const other = await page.request.post(`/api/enterprises/${id}/tasks`, { data: { name: '同事建的任务' } });
  expect(other.ok()).toBeTruthy();
  const otherId = ((await other.json()) as { id: string }).id;

  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(callout()).toContainText('「同事建的任务」还没提交');
  await page.getByRole('button', { name: '继续已有任务' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${otherId}/prepare$`));
  await expect(page.getByRole('banner')).toContainText('编制应急预案');
  await expect(page.getByRole('banner')).toContainText('惠州示例塑胶有限公司');
});

test('年度服务不在有效期内时不能新建任务', async () => {
  const id = await createEnterprise('惠州示例木业有限公司');
  // 模拟合同已到期：只改组织信息的返回，后台的同一条规则另有接口测试
  await page.route(`**/api/orgs/${orgId}`, async (route) => {
    const res = await route.fetch();
    const org = await res.json();
    await route.fulfill({
      response: res,
      json: { ...org, contractStartsAt: '2024-01-01', contractEndsAt: '2025-12-31' },
    });
  });
  await page.goto(`/customer/enterprises/${id}`);
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
  await page.goto(`/customer/tasks/new?enterpriseId=${id}`);
  await expect(page.getByText('续约生效后可创建新任务；已有资料与交付记录保留。')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
  await page.unroute(`**/api/orgs/${orgId}`);
});

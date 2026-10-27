import { expect, test, type Page } from '@playwright/test';

// 第 6a 项：企业自填第 1 步。营业执照识别用模拟服务（见 playwright.config.ts 的 LICENSE_OCR）。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.7\n% 营业执照\n');

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
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州示例电器有限公司' } });
  enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
});

test.afterAll(async () => {
  await page.close();
});

async function basicInfoStatus() {
  const res = await page.request.get(`/api/tasks/${taskId}/checklist`);
  const body = (await res.json()) as { items: Record<string, { status: string } | undefined> };
  return body.items.basic_info?.status;
}

test('选了「按提示填写」的任务直接进入第 1 步', async () => {
  await page.goto(`/customer/tasks/${taskId}`);
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${taskId}/fill/1$`));
  await expect(page.getByRole('heading', { name: '先告诉我们，您是一家什么样的企业' })).toBeVisible();
  await expect(page.getByLabel('企业名称')).toHaveValue('惠州示例电器有限公司');
  // 联系人默认当前账号
  await expect(page.getByLabel(/^联系人/)).toHaveValue('林管理员');
});

test('上传营业执照后识别出的内容填进表单，标「来自营业执照」', async () => {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '营业执照.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('已识别 8 项，已填入下方，请核对')).toBeVisible();
  await expect(page.getByLabel(/^企业名称/)).toHaveValue('惠阳飞宇电器有限公司');
  await expect(page.getByLabel(/^统一社会信用代码/)).toHaveValue('91441303MA4W12345X');
  await expect(page.getByText('惠州市惠阳区市场监督管理局')).toBeVisible();
  await expect(page.getByText('来自营业执照').first()).toBeVisible();
  // 主管负责人默认同法定代表人
  await expect(page.getByLabel(/^主管负责人/)).toHaveValue('李文聪');
});

test('边填边自动保存；开始编制需要的几项填齐后「企业基本情况」变为已提供', async () => {
  await page.getByLabel('员工人数').fill('86');
  await page.getByLabel('主要产品').fill('电热水壶、电饭煲');
  await page.getByLabel('所属行业').fill('电气机械');
  await page.getByText('电气机械和器材制造业', { exact: true }).click();
  expect(await basicInfoStatus()).toBeUndefined();
  await page.getByLabel(/^联系电话/).fill('13800001234');
  await expect(page.getByText(/已自动保存 \d{2}:\d{2}/)).toBeVisible();
  await expect.poll(basicInfoStatus).toBe('provided');

  // 安全管理人员暂时不清楚：稍后补
  await page.getByRole('button', { name: '稍后补', exact: true }).click();
  await expect(page.getByText(/1 项稍后补/)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/已自动保存/);
});

test('填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/enterprises/${enterpriseId}$`));
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();

  await page.getByRole('button', { name: '继续准备资料' }).click();
  await expect(page).toHaveURL(/\/fill\/1$/);
  await expect(page.getByLabel('员工人数')).toHaveValue('86');
  await expect(page.getByLabel('主要产品')).toHaveValue('电热水壶、电饭煲');
  await expect(page.getByText('电气机械和器材制造业')).toBeVisible();
  await expect(page.getByRole('button', { name: '稍后补', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('营业执照.pdf')).toBeVisible();
});

test('别人刚改过时提示并显示最新内容，不会覆盖', async () => {
  // 同事在企业详情里改了法定代表人
  await page.request.patch(`/api/enterprises/${enterpriseId}`, { data: { legalRepresentative: '王小明' } });
  await page.getByLabel('主要产品').fill('电热水壶');
  await expect(page.getByText('资料刚被其他人修改过')).toBeVisible();
  await expect(page.getByLabel(/^法定代表人/)).toHaveValue('王小明');
  await expect(page.getByLabel('主要产品')).toHaveValue('电热水壶、电饭煲');
});

test('下一步进入第 2 步（下次做）', async () => {
  await page.getByRole('button', { name: '下一步：人员与应急组织' }).click();
  await expect(page).toHaveURL(/\/fill\/2$/);
  await expect(page.getByText('这一步正在建设中')).toBeVisible();
});

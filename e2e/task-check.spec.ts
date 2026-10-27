import { expect, test, type Page } from '@playwright/test';

// 第 11a 项：资料检查页（12 页 P05、P05B、P06），两种开始方式共用。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

let page: Page;
let orgId: string;
let uploadTask: string;

async function newTask(name: string, startMethod: 'upload' | 'self_fill') {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  const id = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${id}`, { data: { startMethod } });
  return id;
}

const setItem = (taskId: string, key: string, data: object) =>
  page.request.put(`/api/tasks/${taskId}/checklist/${key}`, { data });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  orgId = me.memberships[0]!.orgId;
  uploadTask = await newTask('惠州飞宇检查测试有限公司', 'upload');
});

test.afterAll(async () => {
  await page.close();
});

const category = (key: string) => page.getByTestId(`category-${key}`);
const drawer = () => page.getByRole('dialog');

test('上传路线：传完文件点「检查资料」，六类都待补充，不能提交', async () => {
  await page.goto(`/customer/tasks/${uploadTask}`);
  await page.getByTestId('drop-zone').locator('input[type=file]').setInputFiles([pdf('总平面图.pdf'), pdf('营业执照.pdf')]);
  await expect(page.getByRole('table', { name: '本次原始资料' })).toContainText('已关联 2 份原始文件');
  await page.getByRole('button', { name: '检查资料' }).click();

  await expect(page).toHaveURL(/view=check/);
  await expect(page.getByText(/请补充营业执照 等 \d+ 项/)).toBeVisible();
  await expect(page.getByText('6 待补充')).toBeVisible();
  await expect(category('drawings')).toContainText('总平面布置图待补充');
  await expect(page.getByRole('button', { name: '提交生成申请' })).toBeDisabled();
});

test('明细抽屉：对应已传文件、请专家电话联系；交付前的项单独列出', async () => {
  await page.getByRole('button', { name: '厂区实际图纸明细' }).click();
  await expect(drawer()).toContainText('3 项 · 2 项待补充，1 项可稍后补');

  await drawer().getByLabel('总平面布置图在哪份文件里').click();
  await page.getByTitle('总平面图.pdf · V1').click();
  await expect(page.getByTestId('done-site_plan')).toContainText('总平面图.pdf');

  await page.getByTestId('item-evacuation_plan').getByRole('button', { name: '请专家电话联系' }).click();
  await expect(page.getByTestId('item-evacuation_plan')).toContainText('待专家联系');
  await expect(page.getByTestId('item-fire_facility_plan')).toContainText('交付前补齐');
  await drawer().getByText('关闭', { exact: true }).click();

  await expect(category('drawings')).toContainText('核实中');
});

test('由我确认：直接填写实际情况并确认，记下确认人', async () => {
  await page.getByRole('button', { name: '企业基本资料明细' }).click();
  const card = page.getByTestId('item-basic_info');
  await card.getByLabel('企业基本情况实际情况').fill('联系人林小明 13600003340，员工 86 人，主要产品灯头');
  await expect(card.getByRole('button', { name: '保存确认' })).toBeDisabled();
  await card.getByRole('checkbox', { name: '我确认以上信息与企业实际情况一致' }).check();
  await card.getByRole('button', { name: '保存确认' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByTestId('done-basic_info')).toContainText('员工 86 人');
  await expect(page.getByTestId('done-basic_info')).toContainText(/已确认 · \d\d\.\d\d/);
  await drawer().getByText('关闭', { exact: true }).click();
});

test('必需资料都处理后可以提交，等专家的项写在「耕云来处理」', async () => {
  for (const key of ['business_license', 'process_flow', 'equipment', 'special_equipment', 'materials', 'emergency_groups', 'duty_phone', 'emergency_supplies']) {
    expect((await setItem(uploadTask, key, { status: 'provided' })).ok()).toBe(true);
  }
  await page.reload();
  await expect(page.getByText('必需资料已齐，其余由耕云核实')).toBeVisible();
  await expect(page.getByRole('complementary', { name: '处理分工' })).toContainText('紧急疏散示意图：专家会电话联系您');
  await expect(page.getByRole('button', { name: '提交生成申请' })).toBeEnabled();
});

test('两条路线进同一个检查页：资料状态相同，结果一致', async () => {
  const selfFillTask = await newTask('惠州飞宇自填检查测试有限公司', 'self_fill');
  const check = (await (await page.request.get(`/api/tasks/${uploadTask}/check`)).json()) as {
    items: Record<string, { status: string; callRequested: boolean; note?: string }>;
  };
  for (const [key, s] of Object.entries(check.items)) {
    if (s.status === 'provided' && !s.note) await setItem(selfFillTask, key, { status: 'provided' });
    else await setItem(selfFillTask, key, { status: s.status, callRequested: s.callRequested, note: s.note });
  }

  const statuses = async () =>
    Promise.all(
      ['basic', 'production', 'materials', 'organization', 'resources', 'drawings'].map(async (c) =>
        (await category(c).textContent())!.match(/已满足|待补充|核实中/)![0],
      ),
    );
  const fromUpload = await statuses();

  await page.goto(`/customer/tasks/${selfFillTask}`);
  await expect(page.getByText('资料来自企业自填')).toBeVisible();
  expect(await statuses()).toEqual(fromUpload);
  await page.getByRole('button', { name: '生产工艺与设备明细' }).click();
  await expect(page.getByTestId('done-equipment')).toContainText('企业自填第 3 步');
  await drawer().getByText('关闭', { exact: true }).click();

  await page.getByRole('button', { name: '继续填写' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${selfFillTask}/fill/1$`));
});

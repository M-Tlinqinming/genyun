import { expect, test, type Page } from '@playwright/test';

// 第 9 项：企业自填第 5 步「核对并提交」与预约上门弹窗。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业、前几步内容和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const START_ITEMS = [
  'business_license',
  'basic_info',
  'process_flow',
  'equipment',
  'special_equipment',
  'materials',
  'emergency_groups',
  'duty_phone',
  'emergency_supplies',
  'site_plan',
  'evacuation_plan',
];

let page: Page;
let taskId: string;
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
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州飞宇核对测试有限公司' } });
  enterpriseId = ((await ent.json()) as { id: string }).id;

  // 第 1 步：联系人、人数；安全管理人员数点了稍后补。第 3 步：油漆、稀释剂没拍标签、没写年用量
  const basic = (await (await page.request.get(`/api/enterprises/${enterpriseId}/basic-step`)).json()) as {
    version: number;
    identity: object;
  };
  const saved = await page.request.put(`/api/enterprises/${enterpriseId}/basic-step`, {
    data: {
      version: basic.version,
      identity: basic.identity,
      basic: { contactPerson: '林小明', contactPhone: '13600003340', employeeCount: 86, mainProducts: '灯头' },
      later: ['safetyManagementCount'],
    },
  });
  const version = ((await saved.json()) as { version: number }).version;
  const prod = (await (await page.request.get(`/api/enterprises/${enterpriseId}/production-step`)).json()) as {
    step: object;
  };
  await page.request.put(`/api/enterprises/${enterpriseId}/production-step`, {
    data: {
      version,
      step: {
        ...prod.step,
        materials: [
          { id: 'm1', name: '油漆', maxStorage: '200 kg', labelPhotoFileIds: [] },
          { id: 'm2', name: '稀释剂', maxStorage: '50 kg', labelPhotoFileIds: [] },
        ],
      },
    },
  });

  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
});

test.afterAll(async () => {
  await page.close();
});

test('必需资料没齐：按步骤标出缺什么，不能提交，「去补充」回到对应的一步', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/5`);
  await expect(page.getByRole('heading', { name: /还差 \d+ 项必需资料/ })).toBeVisible();
  const step1 = page.getByTestId('review-step-1');
  await expect(step1).toContainText('惠州飞宇核对测试有限公司 · 86 人 · 联系人 林小明');
  await expect(step1).toContainText('还缺：营业执照');
  await expect(page.getByTestId('review-step-4')).toContainText('还缺：应急物资及装备、总平面布置图、紧急疏散示意图');
  await expect(page.getByRole('button', { name: '提交给耕云' })).toBeDisabled();

  await step1.getByRole('button', { name: '修改企业基本信息' }).click();
  await expect(page).toHaveURL(new RegExp(`/fill/1$`));
});

test('必需资料都齐了可以提交；稍后补和专家判断分开列出，取消同意就不能提交', async () => {
  for (const key of START_ITEMS) {
    const res = await page.request.put(`/api/tasks/${taskId}/checklist/${key}`, { data: { status: 'provided' } });
    expect(res.ok()).toBe(true);
  }
  await page.goto(`/customer/tasks/${taskId}/fill/5`);
  await expect(page.getByRole('heading', { name: '核对一下，就可以交给耕云了' })).toBeVisible();
  await expect(page.getByTestId('review-step-1')).toContainText('项稍后补');

  const expert = page.getByRole('region', { name: '耕云专家判断' });
  await expect(expert).toContainText('油漆、稀释剂是否属于危化品（按包装标签）');
  const later = page.getByRole('region', { name: '稍后补' });
  await expect(later).toContainText('安全管理人员数');
  await expect(later).toContainText('油漆年用量、油漆包装标签、稀释剂年用量、稀释剂包装标签');

  const submit = page.getByRole('button', { name: '提交给耕云' });
  await expect(submit).toBeEnabled();
  await page.getByRole('checkbox').uncheck();
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(submit).toBeEnabled();
});

test('稍后补超过 5 项提示预约上门；带出联系人和待补项，提交后显示已提交', async () => {
  const banner = page.getByRole('region', { name: '预约耕云上门' });
  await expect(banner).toContainText(/有 \d+ 项要稍后补/);
  await banner.getByRole('button', { name: '预约上门' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('请耕云专家上门')).toBeVisible();
  await expect(dialog.getByLabel('联系人 *')).toHaveValue('林小明');
  await expect(dialog.getByLabel('联系电话 *')).toHaveValue('13600003340');
  const items = dialog.getByRole('list', { name: '需要帮忙整理' }).getByRole('listitem');
  await dialog.getByRole('button', { name: /还有 \d+ 项/ }).click();
  const total = await items.count();
  await dialog.getByRole('button', { name: '删去安全管理人员数' }).click();
  await expect(items).toHaveCount(total - 1);

  await dialog.getByRole('radio', { name: '工作日下午' }).click();
  await dialog.getByLabel('备注').fill('厂里没人懂图纸，希望有人来现场看一下。');
  await dialog.getByRole('button', { name: '提交' }).click();
  await expect(dialog.getByText('已收到您的上门需求')).toBeVisible();
  await expect(dialog.getByText('耕云会尽快打 13600003340 联系您。')).toBeVisible();
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(banner).toContainText('已提交上门需求');
});

test('第 4 步图纸下方、选择开始方式页也能预约上门', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/4`);
  await page.getByRole('button', { name: '预约耕云专家上门' }).click();
  await expect(page.getByRole('dialog').getByText('请耕云专家上门')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto(`/customer/tasks/${taskId}/start`);
  await page.getByRole('region', { name: '预约耕云上门' }).getByRole('button', { name: '预约上门' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('选填，也可以写在备注里')).toBeVisible();
  await expect(dialog.getByRole('list', { name: '需要帮忙整理' })).toHaveCount(0);
});

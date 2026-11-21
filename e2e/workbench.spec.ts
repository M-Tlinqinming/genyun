import { expect, test, type Page } from '@playwright/test';
import { taskView } from '../packages/shared/src/task-status';

// 客户工作台与任务列表（11 页 C01、C04；13 页 S01）：三段状态，要处理的在前，按钮直达那一步。
// 只登录一次、共用同一个页面；企业和任务用接口直接准备
test.describe.configure({ mode: 'serial' });

let page: Page;
let orgId: string;

async function newTask(name: string, startMethod?: 'upload' | 'self_fill') {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = (await (
    await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } })
  ).json()) as { id: string; number: string };
  if (startMethod) await page.request.patch(`/api/tasks/${task.id}`, { data: { startMethod } });
  return { ...task, enterpriseId };
}

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
const START_ITEMS = ['business_license', 'basic_info', 'process_flow', 'equipment', 'special_equipment', 'materials', 'emergency_groups', 'emergency_supplies', 'evacuation_plan'];

// 用接口准备一项已提交的任务（客户端按提示填写、提交入口已下线，提交接口不变；原来由 task-submit.spec 留下）
async function submittedTask(name: string) {
  const task = await newTask(name, 'upload');
  const file = await page.request.post(`/api/orgs/${orgId}/files?rule=material`, { multipart: { file: pdf('总平面图.pdf') } });
  const fileId = ((await file.json()) as { id: string }).id;
  await page.request.post(`/api/tasks/${task.id}/documents`, { data: { fileId } });
  await page.request.post(`/api/tasks/${task.id}/checklist/site_plan/files`, { data: { fileId } });
  for (const key of START_ITEMS) await page.request.put(`/api/tasks/${task.id}/checklist/${key}`, { data: { status: 'provided', note: '员工 86 人' } });
  await page.request.put(`/api/tasks/${task.id}/checklist/duty_phone`, { data: { status: 'later', callRequested: true } });
  const state = (await (await page.request.get(`/api/tasks/${task.id}/submission`)).json()) as { preview: { fingerprint: string; taskDocuments: unknown } };
  const res = await page.request.post(`/api/tasks/${task.id}/submission`, {
    data: { requestId: crypto.randomUUID(), fingerprint: state.preview.fingerprint, documents: state.preview.taskDocuments },
  });
  expect(res.ok()).toBe(true);
  return task;
}

// 北京时间今天往后 n 天，YYYY-MM-DD
function chinaDay(offset: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + offset * 86_400_000));
}

async function fakeContract(endsAt: string) {
  await page.route(`**/api/orgs/${orgId}`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), contractStartsAt: '2024-01-01', contractEndsAt: endsAt } });
  });
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

test('工作台：待我处理写清下一步，按钮直达那一步', async () => {
  const fresh = await newTask('工作台新任务有限公司');
  await page.goto('/customer');
  await expect(page.getByRole('heading', { name: '工作台', level: 1 })).toBeVisible();

  const todo = page.getByRole('region', { name: '待我处理' });
  const row = todo.getByTestId(`todo-${fresh.number}`);
  await expect(row).toContainText('准备资料');
  await expect(row).toContainText('下载资料模板，填好后上传');
  await page.screenshot({ path: 'test-results/workbench-c01.png' });

  await row.getByRole('button', { name: /^去上传/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${fresh.id}/prepare$`));
});

test('已提交的任务进「正在办理」和「专家编制」，不在待我处理里', async () => {
  const submitted = await submittedTask('工作台已提交有限公司');
  await page.goto('/customer');
  await expect(page.getByRole('region', { name: '正在办理' }).getByTestId(`card-${submitted.number}`)).toContainText('专家正在编制，不需要您操作');
  await expect(page.getByTestId(`todo-${submitted.number}`)).toHaveCount(0);

  await page.goto('/customer/tasks?tab=expert');
  await expect(page.getByRole('tab', { name: /专家编制 \d+/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('搜索企业名称或任务编号').fill(submitted.number);
  const row = page.getByTestId(`task-${submitted.number}`);
  await expect(row).toContainText('专家编制');
  await expect(row).toContainText('专家正在编制，交付后邮件通知您');
  await row.getByRole('button', { name: /^查看/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${submitted.id}(\\?|$)`));
  await expect(page.getByText('已提交，编制期间不需要您操作')).toBeVisible();
});

test('任务：默认先看待我处理，页签记在地址里；可搜索任务编号、按企业筛选', async () => {
  const task = await newTask('列表筛选测试有限公司');
  await page.goto('/customer/tasks');
  await expect(page.getByRole('tab', { name: /待我处理 \d+/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('搜索企业名称或任务编号').fill(task.number);
  await expect(page.locator('[data-testid^="task-GY-"]')).toHaveCount(1);
  await expect(page.getByTestId(`task-${task.number}`)).toContainText('下载资料模板，填好后上传');
  await page.screenshot({ path: 'test-results/workbench-c04.png' });

  // 切页签写进 ?tab=，直接打开带 ?tab= 的地址也停在那个页签
  await page.getByRole('tab', { name: /已交付 \d+/ }).click();
  await expect(page).toHaveURL(/tab=delivered/);
  await expect(page.getByTestId(`task-${task.number}`)).toHaveCount(0);
  await page.goto('/customer/tasks?tab=all');
  await expect(page.getByRole('tab', { name: /全部 \d+/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('按企业筛选').click();
  await page.getByTitle('列表筛选测试有限公司').click();
  await expect(page.locator('[data-testid^="task-GY-"]')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`enterprise=${task.enterpriseId}`));
  await page.getByTestId(`task-${task.number}`).getByRole('button', { name: /^去上传/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}/prepare$`));

  // 企业筛选记在地址里：点进任务再返回、刷新都还在
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`enterprise=${task.enterpriseId}`));
  await expect(page.locator('[data-testid^="task-GY-"]')).toHaveCount(1);
  await expect(page.getByTestId(`task-${task.number}`)).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-testid^="task-GY-"]')).toHaveCount(1);
  await expect(page.getByTestId(`task-${task.number}`)).toBeVisible();
  // 地址里的企业看不到（不存在）时当作没选
  await page.goto(`/customer/tasks?tab=all&enterprise=${crypto.randomUUID()}`);
  await expect(page.locator('[data-testid^="task-GY-"]').nth(1)).toBeVisible();
});

test('任务列表整行可点：点企业名称、键盘回车都能进任务；「查看」照旧', async () => {
  const task = await newTask('整行点击测试有限公司');
  await page.goto('/customer/tasks?tab=all');
  await page.getByPlaceholder('搜索企业名称或任务编号').fill(task.number);
  const row = page.getByTestId(`task-${task.number}`);
  await row.getByText('整行点击测试有限公司', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}/prepare$`));

  await page.goBack();
  await page.getByPlaceholder('搜索企业名称或任务编号').fill(task.number);
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}/prepare$`));
});

test('删除了的任务：说找不到这个任务，回任务列表', async () => {
  const task = await newTask('删除后打开测试有限公司');
  expect((await page.request.delete(`/api/tasks/${task.id}`)).ok()).toBe(true);
  await page.goto(`/customer/tasks/${task.id}`);
  await expect(page.getByText('找不到这个任务')).toBeVisible();
  await expect(page.getByText('可能已经删除，或者您没有查看权限。')).toBeVisible();
  await page.getByRole('link', { name: '返回任务列表' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks$/);
});

test('新建任务：从工作台进入新建任务页，在页里选企业', async () => {
  await page.goto('/customer');
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/new$/);
  await expect(page.getByRole('heading', { name: '新建任务' })).toBeVisible();
});

function fakeCredits(total: number) {
  return page.route(`**/api/orgs/${orgId}/credits`, (route) =>
    route.fulfill({
      json: { remaining: { total, gift: 0, purchase: total }, granted: 20, used: 20 - total, validUntil: chinaDay(100), awaitingTasks: [], entries: [] },
    }),
  );
}

test('组织管理员看编制次数：平时一条，剩 3 次以内提醒续约，用完换成提醒块', async () => {
  await fakeCredits(12);
  await page.goto('/customer');
  const strip = page.getByRole('region', { name: '编制次数' });
  await expect(strip).toContainText('剩余 12 次');
  await expect(strip).toContainText('共 20 次，已用 8 次');
  await expect(strip.getByRole('button', { name: '联系耕云续约' })).toHaveCount(0);
  await expect(strip.getByRole('link', { name: '查看用量' })).toHaveAttribute('href', '/customer/organization?tab=service');
  await page.unroute(`**/api/orgs/${orgId}/credits`);

  await fakeCredits(2);
  await page.goto('/customer');
  await expect(page.getByRole('region', { name: '编制次数' })).toContainText('用完后还能照常提交');
  await expect(page.getByRole('region', { name: '编制次数' }).getByRole('button', { name: '联系耕云续约' })).toBeVisible();
  await page.unroute(`**/api/orgs/${orgId}/credits`);

  await fakeCredits(0);
  await page.goto('/customer');
  await expect(page.getByRole('status', { name: '编制次数已经用完' })).toContainText('新任务可以照常新建和提交');
  await expect(page.getByRole('region', { name: '编制次数' })).toHaveCount(0);
  await page.unroute(`**/api/orgs/${orgId}/credits`);
});

test('成员：成果被锁住时提示联系组织管理员，不显示次数', async () => {
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    const me = (await res.json()) as { memberships: { role: string }[] };
    await route.fulfill({ response: res, json: { ...me, memberships: me.memberships.map((m) => ({ ...m, role: 'customer_member' })) } });
  });
  await page.route(`**/api/orgs/${orgId}/tasks`, async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as object[];
    const now = new Date();
    const locked = {
      ...rows[0],
      id: '00000000-0000-4000-8000-000000000001',
      number: 'GY-2026-901',
      status: 'submitted',
      delivery: { version: 1, publishedAt: new Date().toISOString() },
      adminNames: '陈经理',
      // 和接口一样用 taskView 算：成员看到的「次数用完、成果锁住」
      view: taskView({
        flow: 'intake',
        status: 'submitted',
        deletedAt: null,
        tableUploaded: true,
        missingCount: 0,
        submittedAt: now,
        withdrawnBefore: false,
        assignedExpertId: null,
        snapshotAt: now,
        workupStepsDone: 5,
        awaitingCustomerSince: null,
        awaitingCustomerItems: null,
        draft: 'ready',
        lastDelivery: { at: now, kind: 'first' },
        reopenedAt: null,
        chargeStatus: 'awaiting_credits',
        now,
        viewer: { side: 'customer', isCustomerAdmin: false, adminName: '陈经理' },
      }),
    };
    await route.fulfill({ response: res, json: [...rows, locked] });
  });
  await page.goto('/customer');
  const block = page.getByRole('status', { name: '成果暂时还不能下载' });
  await expect(block).toContainText('有 1 份成果已经编制好');
  await expect(block).toContainText('请联系陈经理');
  // 锁住的成果在工作台上没有任何下载入口
  await expect(page.getByRole('button', { name: /下载/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '编制次数' })).toHaveCount(0);
  await page.unroute(`**/api/orgs/${orgId}/tasks`);
  await page.unroute('**/api/auth/me');
});

test('年度服务 30 天内到期提醒；到期后不能新建任务，在办任务照常可看', async () => {
  await fakeContract(chinaDay(10));
  await page.goto('/customer');
  await expect(page.getByRole('status', { name: '年度服务提醒' })).toContainText('还有 10 天');
  await expect(page.getByRole('button', { name: '新建任务' })).toBeEnabled();
  await page.unroute(`**/api/orgs/${orgId}`);

  await fakeContract(chinaDay(-1));
  await page.goto('/customer');
  await expect(page.getByRole('status', { name: '年度服务提醒' })).toContainText('年度服务已到期');
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
  await expect(page.getByText('续约生效后可创建新任务；已有资料与交付记录保留。')).toBeVisible();
  await expect(page.getByRole('region', { name: '待我处理' })).toContainText('去上传');
  await page.screenshot({ path: 'test-results/workbench-s01.png' });
  await page.goto('/customer/tasks');
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
  await page.unroute(`**/api/orgs/${orgId}`);
});

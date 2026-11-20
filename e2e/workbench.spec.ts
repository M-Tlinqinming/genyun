import { expect, test, type Page } from '@playwright/test';

// 第 13 项：工作台与业务任务列表（11 页 C01、C04；13 页 S01）。登录先看到要处理的任务，点进去直达。
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

test('工作台：待我处理写清下一步，点按钮直达那一步', async () => {
  const fresh = await newTask('工作台新任务有限公司');
  const upload = await newTask('工作台上传路线有限公司', 'upload');
  await page.goto('/customer');
  await expect(page.getByRole('heading', { name: /(上午|下午|晚上)好，/ })).toBeVisible();

  const todo = page.getByRole('region', { name: '待我处理' });
  await expect(todo.getByTestId(`todo-${upload.number}`)).toContainText(/补充营业执照 等 \d+ 项/);
  await expect(todo.getByTestId(`todo-${fresh.number}`)).toContainText('下载资料模板，填好后上传');
  await page.screenshot({ path: 'test-results/workbench-c01.png' });

  await todo.getByTestId(`todo-${fresh.number}`).getByRole('button', { name: '开始准备' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${fresh.id}$`));
  await page.goto('/customer');
  await todo.getByTestId(`todo-${upload.number}`).getByRole('button', { name: '继续准备' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${upload.id}$`));
});

test('已提交的任务进「正在办理」与「耕云处理中」，不在待我处理里', async () => {
  const submitted = await submittedTask('工作台已提交有限公司');
  await page.goto('/customer');
  await expect(page.getByRole('region', { name: '正在办理' })).toContainText('耕云编制中');
  await expect(page.getByTestId(`todo-${submitted.number}`)).toHaveCount(0);

  await page.goto('/customer/tasks?tab=gengyun');
  await page.getByPlaceholder('搜索企业 / 任务编号').fill(submitted.number);
  const row = page.getByRole('row', { name: new RegExp(submitted.number) });
  await expect(row).toContainText('耕云编制 · 申请已提交');
  await row.getByRole('button', { name: /查看进度/ }).click();
  await expect(page).toHaveURL(/tab=records/);
  await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
});

test('任务：默认先看待我处理，可搜索任务编号、按企业筛选', async () => {
  const task = await newTask('列表筛选测试有限公司', 'self_fill');
  await page.goto('/customer/tasks');
  await expect(page.getByRole('tab', { name: /待我处理 \d+/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('搜索企业 / 任务编号').fill(task.number);
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('row', { name: new RegExp(task.number) })).toContainText('补充');
  await page.screenshot({ path: 'test-results/workbench-c04.png' });

  await page.getByPlaceholder('搜索企业 / 任务编号').fill('');
  await page.getByLabel('按企业筛选').click();
  await page.getByTitle('列表筛选测试有限公司').click();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByRole('row', { name: new RegExp(task.number) }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}$`));
});

test('新建任务：从工作台进入新建任务页，在页里选企业', async () => {
  await page.goto('/customer');
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page).toHaveURL(/\/customer\/tasks\/new$/);
  await expect(page.getByRole('heading', { name: '新建任务' })).toBeVisible();
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
  await expect(page.getByRole('region', { name: '待我处理' })).toContainText('继续准备');
  await page.screenshot({ path: 'test-results/workbench-s01.png' });
  await page.goto('/customer/tasks');
  await expect(page.getByRole('button', { name: '新建任务' })).toBeDisabled();
  await page.unroute(`**/api/orgs/${orgId}`);
});

import { expect, test, type Page } from '@playwright/test';

// 第 12 项：提交生成申请（13 页 F01–F07）。正常提交、断网后先查询不重复提交、确认后资料有变化、
// 提交后补待补项。只登录一次、共用同一个页面；企业、任务和资料用接口直接准备
test.describe.configure({ mode: 'serial' });

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

const START_ITEMS = [
  'business_license',
  'basic_info',
  'process_flow',
  'equipment',
  'special_equipment',
  'materials',
  'emergency_groups',
  'emergency_supplies',
  'evacuation_plan',
];

let page: Page;
let orgId: string;
let submittedTask: string;

async function upload(name: string) {
  const res = await page.request.post(`/api/orgs/${orgId}/files?rule=material`, { multipart: { file: pdf(name) } });
  return ((await res.json()) as { id: string }).id;
}

// 上传路线、必需资料都已处理的任务：总平面图挂文件，值班电话请专家电话联系，其余由我确认
async function readyTask(name: string, startMethod: 'upload' | 'self_fill' = 'upload') {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  const id = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${id}`, { data: { startMethod } });
  const plan = await upload('总平面图.pdf');
  await page.request.post(`/api/tasks/${id}/documents`, { data: { fileId: plan } });
  await page.request.post(`/api/tasks/${id}/checklist/site_plan/files`, { data: { fileId: plan } });
  for (const key of START_ITEMS) {
    await page.request.put(`/api/tasks/${id}/checklist/${key}`, { data: { status: 'provided', note: '员工 86 人' } });
  }
  await page.request.put(`/api/tasks/${id}/checklist/duty_phone`, { data: { status: 'later', callRequested: true } });
  return { id, enterpriseId };
}

const dialog = () => page.getByTestId('submit-dialog');
// 截图前等弹窗动画结束
const settle = () => page.waitForTimeout(500);
const submitUrl = (id: string) => `**/api/tasks/${id}/submission`;

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

test('确认框列出资料版本与您确认的事项；确认后提交，进入处理记录与待补清单', async () => {
  submittedTask = (await readyTask('惠州飞宇提交测试有限公司')).id;
  await page.goto(`/customer/tasks/${submittedTask}?view=check`);
  await page.getByRole('button', { name: '提交生成申请' }).click();

  await expect(dialog()).toContainText('惠州飞宇提交测试有限公司');
  await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('总平面图.pdf');
  await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('V1');
  await expect(dialog()).toContainText('24 小时值班电话');
  await expect(dialog()).toContainText('请专家电话联系');
  await settle();
  await page.screenshot({ path: 'test-results/submit-f02-confirm.png' });
  await page.getByRole('button', { name: '确认提交' }).click();

  await expect(page).toHaveURL(/tab=records/);
  await expect(page.getByText('申请已提交 · 当前由耕云处理')).toBeVisible();
  await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
  await expect(page.getByText('申请已提交，耕云已开始整理')).toBeVisible();
  const list = page.getByRole('region', { name: '待补清单' });
  await expect(list).toContainText('24 小时值班电话');
  await expect(list).toContainText('消防设施布置图');
  await expect(page.getByRole('region', { name: '处理记录' })).toContainText('生成申请已提交');
  await page.screenshot({ path: 'test-results/submit-f03b-submitted.png', fullPage: true });

  await page.getByRole('button', { name: '查看本次提交资料' }).click();
  await expect(page.getByRole('region', { name: '本次提交资料' })).toContainText('总平面图.pdf');
});

test('提交后补待补项：补一项少一项，已提交的项不能再改', async () => {
  await page.goto(`/customer/tasks/${submittedTask}`);
  const list = page.getByRole('region', { name: '待补清单' });
  const before = await list.getByText(/已补 0 \/ \d+/).textContent();
  await list.getByRole('button', { name: '补充化学品安全技术说明书（MSDS）' }).click();
  const card = page.getByTestId('item-msds');
  await card.getByRole('button', { name: '现在补充' }).click();
  await card.getByRole('button', { name: '没有这一项' }).click();
  await page.getByRole('dialog').getByText('关闭', { exact: true }).click();

  await expect(page.getByTestId('supplement-msds')).toContainText('已补');
  await expect(list.getByText(before!.replace('已补 0', '已补 1'))).toBeVisible();
  // 已提交的项后台拒绝修改
  const locked = await page.request.put(`/api/tasks/${submittedTask}/checklist/business_license`, {
    data: { status: 'provided', note: '改一下' },
  });
  expect(locked.status()).toBe(400);
});

test('断网：申请已到后台但回应丢失——不能直接再交，查询到已提交就算成功，只记一次', async () => {
  const { id } = await readyTask('回应丢失测试有限公司');
  await page.goto(`/customer/tasks/${id}?view=check`);
  // 请求照常送到后台，回给浏览器时断网
  await page.route(submitUrl(id), async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('internetdisconnected');
  });
  await page.getByRole('button', { name: '提交生成申请' }).click();
  await page.getByRole('button', { name: '确认提交' }).click();

  await expect(page.getByText('暂时无法确认提交结果')).toBeVisible();
  await expect(dialog()).toHaveAttribute('data-phase', 'unknown');
  await expect(page.getByRole('button', { name: '确认提交' })).toHaveCount(0);
  await settle();
  await page.screenshot({ path: 'test-results/submit-f06-unknown.png' });
  await page.unroute(submitUrl(id));
  await page.getByRole('button', { name: '查询提交结果' }).click();

  await expect(page).toHaveURL(/tab=records/);
  await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
  // 再交一次（换个编号）也只返回同一条提交记录
  const first = (await (await page.request.get(`/api/tasks/${id}/submission`)).json()) as { submission: { submittedAt: string } };
  const again = await page.request.post(`/api/tasks/${id}/submission`, {
    data: { requestId: crypto.randomUUID(), fingerprint: 'x', documents: [] },
  });
  expect(((await again.json()) as { submittedAt: string }).submittedAt).toBe(first.submission.submittedAt);
});

test('断网：请求没送到——查询确认没交上，再重试提交', async () => {
  const { id } = await readyTask('请求未送达测试有限公司');
  await page.goto(`/customer/tasks/${id}?view=check`);
  await page.route(submitUrl(id), (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.getByRole('button', { name: '提交生成申请' }).click();
  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page.getByText('暂时无法确认提交结果')).toBeVisible();

  await page.getByRole('button', { name: '查询提交结果' }).click();
  await expect(page.getByText('申请未提交，请重试')).toBeVisible();
  await expect(dialog()).toContainText('已确认本次没有提交成功');
  await settle();
  await page.screenshot({ path: 'test-results/submit-f05-failed.png' });
  await page.unroute(submitUrl(id));
  await page.getByRole('button', { name: '重试提交' }).click();
  await expect(page).toHaveURL(/tab=records/);
  await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
});

test('确认之后总平面图换了版本：这次不提交，提示重新检查', async () => {
  const { id, enterpriseId } = await readyTask('换版本测试有限公司');
  await page.goto(`/customer/tasks/${id}?view=check`);
  await page.getByRole('button', { name: '提交生成申请' }).click();
  await expect(dialog()).toHaveAttribute('data-phase', 'confirm');

  // 确认框开着时，同事在别处换了总平面图的版本
  const [doc] = (await (await page.request.get(`/api/tasks/${id}/documents`)).json()) as { documentId: string }[];
  const v2 = await upload('总平面图 2026.pdf');
  const detail = (await (
    await page.request.post(`/api/enterprises/${enterpriseId}/documents/${doc!.documentId}/versions`, { data: { fileId: v2 } })
  ).json()) as { versions: { versionId: string }[] };
  await page.request.put(`/api/tasks/${id}/documents`, {
    data: { selections: [{ documentId: doc!.documentId, versionId: detail.versions[0]!.versionId }] },
  });

  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page.getByText('本任务的资料已更新，请重新检查')).toBeVisible();
  await expect(page.getByText(/总平面图\.pdf由 V1 改为 V2/)).toBeVisible();
  await settle();
  await page.screenshot({ path: 'test-results/submit-f07-changed.png' });
  expect(((await (await page.request.get(`/api/tasks/${id}`)).json()) as { status: string }).status).toBe('preparing');

  await page.getByRole('button', { name: '重新检查资料' }).click();
  await expect(page.getByText('本任务的资料已更新，请重新检查')).toBeHidden();
  await page.getByRole('button', { name: '提交生成申请' }).click();
  await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('V2');
  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page).toHaveURL(/tab=records/);
});

test('按提示填写：第 5 步「提交给耕云」走同一个确认框', async () => {
  const { id } = await readyTask('自填提交测试有限公司', 'self_fill');
  await page.goto(`/customer/tasks/${id}/fill/5`);
  await page.getByRole('button', { name: '提交给耕云' }).click();
  await expect(dialog()).toHaveAttribute('data-phase', 'confirm');
  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page).toHaveURL(/tab=records/);
  await page.goto(`/customer/tasks/${id}/fill/5`);
  await expect(page.getByRole('button', { name: '申请已提交，查看进度' })).toBeVisible();
});

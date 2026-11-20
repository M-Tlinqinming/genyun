import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// 提交与撤回（12 页 U2c、U3、U3b、S01、S06）：提交给专家、撤回一次、再提交、专家开始核对、撞上专家开始核对、删除任务。
// 文件名排在 workbench.spec.ts 后面，全量里最后跑：留下的已提交任务不影响前面按数量断言的用例。
// 都用新建的企业（演示企业已有任务）。设 SUBMIT_SHOTS=目录 时把各个状态截图存到那里，方便和设计稿对照
test.describe.configure({ mode: 'serial' });

const API_DIR = resolve('apps/api');
const SAMPLE_DIR = join(API_DIR, '.data', 'e2e-submit-samples');
const FIRST = '耕云测试提交撤回有限公司';
const CLASH = '耕云测试撞上核对有限公司';
const GONE = '耕云测试删除任务有限公司';

/** 用 tsx 现做两份填齐的资料表格（企业名称和任务一致），写到 apps/api/.data 下（已忽略，不入库） */
function makeSheets(): Record<string, string> {
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const script = join(SAMPLE_DIR, 'make.mts');
  writeFileSync(
    script,
    `import { writeFile } from 'node:fs/promises';
import * as S from '../../src/intake/test-workbooks.ts';
const dir = ${JSON.stringify(SAMPLE_DIR)};
for (const name of ${JSON.stringify([FIRST, CLASH])}) await writeFile(dir + '/' + name + '.xlsx', await S.renamed(name));
`,
  );
  execSync(`npx tsx "${script}"`, { cwd: API_DIR, stdio: 'inherit' });
  return { [FIRST]: join(SAMPLE_DIR, `${FIRST}.xlsx`), [CLASH]: join(SAMPLE_DIR, `${CLASH}.xlsx`) };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let page: Page;
let orgId: string;
let sheets: Record<string, string>;

async function login(api: APIRequestContext, email: string) {
  const res = await api.post('/api/auth/login', { data: { email, password: 'e2e-password' } });
  expect(res.ok()).toBe(true);
}

async function newTask(name: string) {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  return ((await task.json()) as { id: string; number: string });
}

/** 传齐：资料表格、总平面布置图、一张疏散图、一张现场照片 */
async function fill(taskId: string, enterprise: string) {
  const put = async (slot: string, name: string, mimeType: string, buffer: Buffer) => {
    const res = await page.request.post(`/api/tasks/${taskId}/intake/files?slot=${slot}`, { multipart: { file: { name, mimeType, buffer } } });
    expect(res.status(), await res.text()).toBe(201);
  };
  await put('data_sheet', '资料表格.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', readFileSync(sheets[enterprise]!));
  await put('site_plan', '厂区平面布置图.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n% 总平面\n'));
  await put('evacuation_map', '一楼疏散图.png', 'image/png', PNG);
  await put('other', '现场照片.png', 'image/png', PNG);
}

/** 运营把任务分给吴工，吴工打开资料核对（专家开始核对） */
async function expertStarts(taskId: string) {
  const ops = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await login(ops, 'ops@demo.genyun.net.cn');
  const experts = (await (await ops.get(`/api/operator/tasks/${taskId}/experts`)).json()) as { id: string; name: string }[];
  const assigned = await ops.post(`/api/operator/tasks/${taskId}/assign`, {
    data: { expertId: experts.find((e) => e.name === '吴工')!.id, currentExpertId: null },
  });
  expect(assigned.status(), await assigned.text()).toBe(201);
  await ops.dispose();
  const expert = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await login(expert, 'expert2@demo.genyun.net.cn');
  const opened = await expert.get(`/api/tasks/${taskId}/workup`);
  expect(opened.status(), await opened.text()).toBe(200);
  await expert.dispose();
}

async function shot(name: string) {
  const dir = process.env.SUBMIT_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(400); // 等弹窗动画走完
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

const submitButton = () => page.getByRole('button', { name: '提交给专家' });
const confirmDialog = () => page.getByRole('dialog').filter({ hasText: '确认提交给专家？' });
const withdrawDialog = () => page.getByRole('dialog').filter({ hasText: '撤回这次提交？' });
const materials = () => page.getByRole('region', { name: '本次提交的资料' });
const progress = () => page.getByRole('region', { name: '进度' });

test.beforeAll(async ({ browser }) => {
  sheets = makeSheets();
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

test('提交、撤回一次、再提交，专家开始核对后看到「专家已经开始核对」', async () => {
  const task = await newTask(FIRST);
  await fill(task.id, FIRST);
  await page.goto(`/customer/tasks/${task.id}/prepare`);
  await expect(page.getByText('必填已齐，提交后专家开始核对')).toBeVisible();

  // 提交确认弹窗：每个文件一行、由耕云安排、提示原话
  await submitButton().click();
  const dialog = confirmDialog();
  await expect(dialog).toContainText(`下面这些资料会交给专家，用来编制${FIRST}的应急预案。`);
  const rows = dialog.getByRole('list', { name: '要交给专家的资料' }).getByRole('listitem');
  await expect(rows).toHaveText([
    /^资料表格\.xlsx\d+ 张表 · 必填已齐$/,
    '厂区平面布置图.pdf总平面布置图',
    '一楼疏散图.png紧急疏散示意图',
    '现场照片.png其他图纸与照片',
  ]);
  await expect(dialog).toContainText('由耕云安排');
  await expect(dialog).toContainText('耕云会安排合适的专家');
  await expect(dialog.getByText('选择专家')).toHaveCount(0);
  await expect(dialog).toContainText('提交后，专家开始核对之前可以撤回一次；专家开始核对后不能再改。完成后会通知您。');
  await shot('u2c');
  await dialog.getByRole('button', { name: '确认提交' }).click();

  // 已提交页（U3）
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026 年应急预案编制');
  await expect(page.getByRole('navigation', { name: '位置' })).toHaveText(`任务 / ${FIRST}`);
  await expect(page.getByText(new RegExp(`^${task.number} · \\d+ 月 \\d+ 日 \\d\\d:\\d\\d 提交$`))).toBeVisible();
  await expect(page.getByText('已提交，编制期间不需要您操作')).toBeVisible();
  await expect(progress()).toContainText(/准备资料\d+ 月 \d+ 日 \d\d:\d\d 提交 · 林管理员/);
  await expect(progress()).toContainText('已交给专家，等专家开始核对');
  await expect(progress()).toContainText('完成后会通知您，在「成果文档」下载');
  await expect(materials()).toContainText('发现填错了？专家开始核对之前可以撤回一次，改好再提交。');
  await expect(materials().getByRole('button', { name: '下载 厂区平面布置图.pdf' })).toBeVisible();
  const contact = page.getByRole('complementary', { name: '有事找客服' });
  await expect(contact.getByRole('img', { name: '耕云客服企业微信二维码' })).toBeVisible();
  await expect(contact).toContainText('工作日 9:00–18:00 · 0752-5200831');
  await shot('u3');

  // 撤回修改 → 回到准备资料页，顶部提示、底栏换成不能再撤回，文件都在
  await materials().getByRole('button', { name: '撤回修改' }).click();
  await expect(withdrawDialog()).toContainText('只能撤回这一次。下次提交后就不能再撤回了。');
  await shot('s01-withdraw');
  await withdrawDialog().getByRole('button', { name: '撤回' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}/prepare$`));
  const notice = page.getByRole('status').filter({ hasText: '已撤回，改好后再提交' });
  await expect(notice).toContainText(/今天 \d\d:\d\d 撤回。已经传的表格、图纸和照片都还在。/);
  await expect(page.getByText('这次提交后不能再撤回')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除任务' })).toBeVisible();
  await expect(page.getByText('一楼疏散图.png')).toBeVisible();
  await shot('s01-after');

  // 再提交：提示换成撤回过的那句；已提交页没有「撤回修改」
  await submitButton().click();
  await expect(confirmDialog()).toContainText('这次提交后不能再撤回。完成后会通知您。');
  await shot('u2c-again');
  await confirmDialog().getByRole('button', { name: '确认提交' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}$`));
  await expect(materials()).toContainText('已经撤回过一次，不能再撤回。发现填错了，请联系客服。');
  await expect(materials().getByRole('button', { name: '撤回修改' })).toHaveCount(0);
  await shot('u3-withdrawn-once');

  // 专家开始核对 → 刷新看到 U3b
  await expertStarts(task.id);
  await page.reload();
  await expect(progress()).toContainText('专家已经开始核对资料');
  await expect(materials()).toContainText('专家已经开始核对，不能再修改。发现填错了，请联系客服。');
  await shot('u3b');
});

test('撤回时专家刚好开始核对：不撤回，顶部说明，页面换成专家已开始核对', async () => {
  const task = await newTask(CLASH);
  await fill(task.id, CLASH);
  const submitted = await page.request.post(`/api/tasks/${task.id}/intake/submit`, { data: { requestId: crypto.randomUUID() } });
  expect(submitted.ok()).toBe(true);
  await page.goto(`/customer/tasks/${task.id}`);
  await materials().getByRole('button', { name: '撤回修改' }).click();
  await expect(withdrawDialog()).toBeVisible();

  // 客户还开着撤回弹窗，专家这时打开了资料核对
  await expertStarts(task.id);
  await withdrawDialog().getByRole('button', { name: '撤回' }).click();
  await expect(withdrawDialog()).toBeHidden();
  const alert = page.getByRole('alert').filter({ hasText: '专家已经开始核对，不能撤回了' });
  await expect(alert).toContainText('有要改的地方，请联系客服。');
  await expect(page.getByText('已提交，编制期间不需要您操作')).toHaveCount(0);
  await expect(progress()).toContainText('专家已经开始核对资料');
  await expect(materials().getByRole('button', { name: '撤回修改' })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${task.id}$`));
  await shot('s01-clash');

  // 刷新以后恢复普通的「专家已开始核对」
  await page.reload();
  await expect(progress()).toContainText('专家已经开始核对资料');
  await expect(page.getByText('已提交，编制期间不需要您操作')).toBeVisible();
});

test('删除任务：回工作台，提示「任务已删除」，任务列表里没有它', async () => {
  const task = await newTask(GONE);
  await page.goto(`/customer/tasks/${task.id}/prepare`);
  await page.getByRole('button', { name: '删除任务' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: '删除这个任务？' });
  await expect(dialog).toContainText(`${GONE}的这次任务，连同已传的表格、图纸和照片会一起删掉，删了找不回来。还没提交，不扣编制次数。`);
  await shot('s06');
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByText('任务已删除')).toBeVisible();
  await shot('s06-deleted');
  await expect(page.getByTestId(`todo-${task.number}`)).toHaveCount(0);

  await page.goto('/customer/tasks?tab=all');
  await page.getByPlaceholder('搜索企业 / 任务编号').fill(task.number);
  await expect(page.getByRole('row', { name: new RegExp(task.number) })).toHaveCount(0);
  expect((await page.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
});

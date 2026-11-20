import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// 准备资料（12 页 U1–U2e，S02–S05）：下载资料模板、传表格、读出缺的必填、传两张必填图。
// 资料表格样例用 apps/api 里的生成函数现做（不提交 xlsx 文件）。只登录一次、共用同一个页面。
// 设 INTAKE_SHOTS=目录 时把各个状态截图存到那里，方便和设计稿对照
test.describe.configure({ mode: 'serial' });

const API_DIR = resolve('apps/api');
const SAMPLE_DIR = join(API_DIR, '.data', 'e2e-intake-samples');
const MAIN = '耕云测试五金制品有限公司';
const OLD = '耕云测试旧版模板有限公司';
const BEFORE = '耕云测试改名前有限公司';
const AFTER = '耕云测试改名后有限公司';

type Samples = Record<'normal' | 'missing' | 'notTemplate' | 'other' | 'old' | 'renamed', string>;

/** 用 tsx 跑一段脚本，把几份样例写到 apps/api/.data 下（已忽略，不入库） */
function makeSamples(): Samples {
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const script = join(SAMPLE_DIR, 'make.mts');
  writeFileSync(
    script,
    `import { writeFile } from 'node:fs/promises';
import * as S from '../../src/intake/test-workbooks.ts';
const dir = ${JSON.stringify(SAMPLE_DIR)};
const out = {
  normal: ['资料表格-正常.xlsx', await S.newNormal()],
  missing: ['资料表格-缺项.xlsx', await S.newMissing()],
  notTemplate: ['别的表格.xlsx', await S.notTemplate()],
  other: ['资料表格-别家.xlsx', await S.otherEnterprise(${JSON.stringify(MAIN)})],
  old: ['资料表格-旧版.xlsx', await S.oldSample(${JSON.stringify(OLD)})],
  renamed: ['资料表格-改名.xlsx', await S.renamed(${JSON.stringify(AFTER)})],
};
for (const [name, buf] of Object.values(out)) await writeFile(dir + '/' + name, buf);
`,
  );
  execSync(`npx tsx "${script}"`, { cwd: API_DIR, stdio: 'inherit' });
  const at = (name: string) => join(SAMPLE_DIR, name);
  return {
    normal: at('资料表格-正常.xlsx'),
    missing: at('资料表格-缺项.xlsx'),
    notTemplate: at('别的表格.xlsx'),
    other: at('资料表格-别家.xlsx'),
    old: at('资料表格-旧版.xlsx'),
    renamed: at('资料表格-改名.xlsx'),
  };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

let page: Page;
let orgId: string;
let samples: Samples;
let mainTask: string;

async function newTask(name: string) {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, { data: { name: '2026 年应急预案编制' } });
  return ((await task.json()) as { id: string }).id;
}

async function shot(name: string) {
  const dir = process.env.INTAKE_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(400); // 等弹窗、浮层动画走完
  // 页头、底部操作栏是固定的，整页截图会叠在中间：先把窗口拉到整页高再截
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.screenshot({ path: join(dir, `${name}.png`) });
  await page.setViewportSize(size);
}

/** 点按钮弹出选文件，选上给定的文件 */
async function choose(button: Locator, files: Parameters<Page['setInputFiles']>[1]) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(files);
}

const UPLOAD = /(^|\s)上传$/;
const row = (name: string) => page.getByRole('group', { name, exact: true }).first();
const title = () => page.getByRole('heading', { level: 1 });
const submit = () => page.getByRole('button', { name: '提交给专家' });

test.beforeAll(async ({ browser }) => {
  samples = makeSamples();
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  orgId = me.memberships[0]!.orgId;
  mainTask = await newTask(MAIN);
});

test.afterAll(async () => {
  await page.close();
});

test('新任务：任务详情转到准备资料页，先下载资料模板；客服二维码就地弹出', async () => {
  await page.goto(`/customer/tasks/${mainTask}`);
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${mainTask}/prepare$`));
  await expect(title()).toHaveText('先下载资料模板，填好后传上来');
  await expect(page.getByRole('link', { name: /下载资料模板/ })).toHaveAttribute('href', '/api/intake/template');
  await expect(page.getByText('模板版本 2026.11 · 约 30 分钟填完')).toBeVisible();
  await expect(row('填好的资料表格')).toContainText('还没传');
  await expect(page.getByText('还差资料表格和 2 张必填图，传齐后可以提交')).toBeVisible();
  await expect(submit()).toBeDisabled();
  await expect(page.getByText(/已自动保存/)).toHaveCount(0);
  await shot('u1');

  await page.getByRole('button', { name: '查看客服二维码' }).click();
  await expect(page.getByRole('img', { name: '耕云客服企业微信二维码' })).toBeVisible();
  await shot('s05-qr');
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 300);
});

test('压缩包拒收，只能移除', async () => {
  const rar = { name: '现场照片.rar', mimeType: 'application/x-rar-compressed', buffer: Buffer.from('Rar!\x1a\x07\x00 照片') };
  await choose(row('其他图纸与照片').getByRole('button', { name: UPLOAD }), [rar]);
  const upload = page.getByRole('group', { name: '上传 现场照片.rar' });
  await expect(upload).toContainText('压缩包打不开。请解压后把里面的文件传上来。');
  await expect(upload.getByRole('button', { name: '重试' })).toHaveCount(0);
  await shot('s02');
  await upload.getByRole('button', { name: '移除' }).click();
  await expect(upload).toHaveCount(0);
});

test('不是资料模板：不读取，提示重新下载模板', async () => {
  await choose(row('填好的资料表格').getByRole('button', { name: UPLOAD }), samples.notTemplate);
  await expect(title()).toHaveText('这份文件读不了，请用资料模板重新上传');
  const alert = page.getByRole('alert').filter({ hasText: '这不是耕云的资料模板，没有读取' });
  await expect(alert).toContainText('刚才传的「别的表格.xlsx」里没有找到模板的 6 张表');
  await expect(alert.getByRole('link', { name: '重新下载模板' })).toBeVisible();
  await expect(row('填好的资料表格')).toContainText('没有读取');
  await expect(page.getByText(/已自动保存 \d\d:\d\d/)).toBeVisible();
  await shot('u1c');
});

test('缺项表：列出回表格改的项和要传的两张图，选填可以展开', async () => {
  await choose(row('填好的资料表格').getByRole('button', { name: /重新上传/ }), samples.missing);
  await expect(title()).toHaveText(/^表格已读取，还差 \d+ 项必填$/);
  await expect(page.getByRole('heading', { name: /^回表格改 \d+ 项$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '在这里直接传 2 张图' })).toBeVisible();
  await expect(page.getByRole('group', { name: '资料表格', exact: true })).toContainText('资料表格-缺项.xlsx');
  await expect(page.getByRole('group', { name: '资料表格', exact: true })).toContainText('读到 6 张表');
  await expect(page.getByText(/还差 \d+ 项必填，补齐后可以提交/)).toBeVisible();
  await expect(submit()).toBeDisabled();
  await shot('u2');

  const more = page.getByRole('button', { name: /^查看是哪 \d+ 项$/ });
  if (await more.count()) {
    await more.click();
    await expect(page.getByRole('region', { name: '选填没填的项' })).toContainText('可以不填，不影响提交');
    await shot('s05-optional');
    await page.getByRole('button', { name: '收起' }).click();
  }
});

test('传总平面布置图；疏散图先说明没有、再撤销后上传', async () => {
  const before = Number((await title().textContent())!.match(/还差 (\d+) 项/)![1]);
  await choose(row('总平面布置图').getByRole('button', { name: UPLOAD }), pdf('厂区总平面图.pdf'));
  await expect(title()).toHaveText(`表格已读取，还差 ${before - 1} 项必填`);
  await expect(page.getByRole('heading', { name: '在这里直接传 1 张图' })).toBeVisible();

  await page.getByRole('button', { name: '这张图我们没有' }).first().click();
  const dialog = page.getByRole('dialog', { name: '确认没有紧急疏散示意图？' });
  await expect(dialog).toContainText('车间墙上贴的疏散图拍照也可以');
  await shot('s04');
  await dialog.getByRole('button', { name: '确认没有' }).click();
  await expect(title()).toHaveText(`表格已读取，还差 ${before - 2} 项必填`);
  await expect(page.getByRole('group', { name: '图纸与照片', exact: true })).toContainText('已说明没有');

  await page.getByRole('button', { name: '撤销，我要上传' }).click();
  await expect(title()).toHaveText(`表格已读取，还差 ${before - 1} 项必填`);
  await choose(page.getByRole('heading', { name: '在这里直接传 1 张图' }).locator('xpath=ancestor::section[1]').getByRole('button', { name: UPLOAD }), png('疏散图.png'));
  await expect(page.getByRole('heading', { name: '在这里直接传' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '紧急疏散示意图' }).last()).toContainText('疏散图.png');
});

test('传改好的表：必填齐了，可以提交；删掉疏散图又缺一项', async () => {
  await choose(page.getByRole('button', { name: /重新上传表格/ }), samples.normal);
  await expect(title()).toHaveText('必填都齐了，可以提交');
  await expect(page.getByText('必填已齐，提交后专家开始核对')).toBeVisible();
  await expect(submit()).toBeEnabled();
  await choose(page.getByRole('button', { name: '添加' }), [png('车间照片.png'), pdf('营业执照.pdf')]);
  await expect(page.getByRole('group', { name: '图纸与照片', exact: true })).toContainText('已传 2 张');
  await shot('u2b');

  // 点了先弹确认；「再看看」不提交，留在准备资料页（提交的全过程在 workflow-submit.spec.ts）
  await submit().click();
  const confirm = page.getByRole('dialog').filter({ hasText: '确认提交给专家？' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '再看看' }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${mainTask}/prepare$`));

  await page.getByRole('group', { name: '紧急疏散示意图' }).last().getByRole('button', { name: '删除' }).click();
  await expect(title()).toHaveText('表格已读取，还差 1 项必填');
  await expect(submit()).toBeDisabled();
});

test('旧版模板：读进来，提示不用换模板重填', async () => {
  const id = await newTask(OLD);
  await page.goto(`/customer/tasks/${id}/prepare`);
  await choose(row('填好的资料表格').getByRole('button', { name: UPLOAD }), samples.old);
  const notice = page.getByRole('status').filter({ hasText: '您用的是旧版模板，不用换模板重填' });
  await expect(notice).toContainText('已按吨读入');
  await expect(notice).toContainText(/有 \d+ 处和新版对不上，列在下面第/);
  await expect(notice.getByRole('link', { name: '下载新版模板' })).toBeVisible();
  await expect(page.getByRole('group', { name: '资料表格', exact: true })).toContainText('旧版模板');
  await shot('u2e');
});

test('别家企业的表不读取，可以去那家的任务；同一家改了名就按表格改好', async () => {
  const id = await newTask(BEFORE);
  await page.goto(`/customer/tasks/${id}/prepare`);
  await choose(row('填好的资料表格').getByRole('button', { name: UPLOAD }), samples.other);
  await expect(title()).toHaveText('请确认是不是传错了企业');
  const alert = page.getByRole('alert').filter({ hasText: `这张表像是「${MAIN}」的，没有读取` });
  await expect(alert).toContainText(`这个任务是给「${BEFORE}」编制的`);
  await expect(alert.getByRole('link', { name: '去耕云测试五金制品的任务' })).toHaveAttribute(
    'href',
    `/customer/tasks/${mainTask}/prepare`,
  );
  await shot('u1d');

  await choose(row('填好的资料表格').getByRole('button', { name: /重新上传/ }), samples.renamed);
  await expect(page.getByRole('status').filter({ hasText: `表格里的企业名称是「${AFTER}」` })).toContainText(
    `原来填的是「${BEFORE}」`,
  );
  await expect(page.getByRole('banner')).toContainText(AFTER);
  await shot('u2d');
});

const START_ITEMS = ['business_license', 'basic_info', 'process_flow', 'equipment', 'special_equipment', 'materials', 'emergency_groups', 'emergency_supplies', 'evacuation_plan'];

test('已经提交的任务打开准备资料页，转回任务详情', async () => {
  // 用旧的提交接口把任务直接提交出去（不走准备资料），只看准备资料页会不会转走
  const id = await newTask('耕云测试已提交有限公司');
  await page.request.patch(`/api/tasks/${id}`, { data: { startMethod: 'upload' } });
  const file = await page.request.post(`/api/orgs/${orgId}/files?rule=material`, { multipart: { file: pdf('总平面图.pdf') } });
  const fileId = ((await file.json()) as { id: string }).id;
  await page.request.post(`/api/tasks/${id}/documents`, { data: { fileId } });
  await page.request.post(`/api/tasks/${id}/checklist/site_plan/files`, { data: { fileId } });
  for (const key of START_ITEMS) await page.request.put(`/api/tasks/${id}/checklist/${key}`, { data: { status: 'provided', note: '员工 86 人' } });
  await page.request.put(`/api/tasks/${id}/checklist/duty_phone`, { data: { status: 'later', callRequested: true } });
  const state = (await (await page.request.get(`/api/tasks/${id}/submission`)).json()) as {
    preview: { fingerprint: string; taskDocuments: unknown };
  };
  const res = await page.request.post(`/api/tasks/${id}/submission`, {
    data: { requestId: crypto.randomUUID(), fingerprint: state.preview.fingerprint, documents: state.preview.taskDocuments },
  });
  expect(res.ok()).toBe(true);

  await page.goto(`/customer/tasks/${id}/prepare`);
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${id}$`));
  await expect(page.getByText('已提交，编制期间不需要您操作')).toBeVisible();
});

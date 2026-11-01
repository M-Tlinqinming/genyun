import { expect, test, type Page } from '@playwright/test';

// M3 第 6 项：反馈受理（Paper 16 页「反馈受理」、运营概览；客户提交弹窗参考 20 页「产品与服务反馈」）。
// 客户从顶栏「意见反馈」提交（带截图）→ 运营在概览看到「待受理反馈」、侧栏角标 → 受理 → 回复并关闭 →
// 客户在站内提醒和「我的反馈」里看到结果。不依赖已发布的成果（成果文档页的入口在 task-results.spec）
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const CONTENT = `希望更容易找到整套下载 ${Date.now() % 10000}\n每次要分别点三份文档下载，不太方便。`;
const TITLE = CONTENT.split('\n')[0]!;
const REPLY = '感谢反馈。成果文档页右上角已有「下载整套 Word」，我们会把入口做得更醒目。';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function login(p: Page, email: string) {
  await p.goto('/login');
  await p.getByPlaceholder('请输入邮箱').fill(email);
  await p.getByPlaceholder('请输入密码').fill('e2e-password');
  await p.getByRole('button', { name: /登\s*录/ }).click();
}

const noHorizontalScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

let customer: Page;
let ops: Page;

test.beforeAll(async ({ browser }) => {
  customer = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  ops = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(customer, 'admin@demo.genyun.net.cn');
  await expect(customer).toHaveURL(/\/customer$/);
  await login(ops, 'ops@demo.genyun.net.cn');
  await expect(ops).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await customer.close();
  await ops.close();
});

test('客户从顶栏「意见反馈」提交，可附截图；不写意见不能提交', async () => {
  await customer.getByRole('button', { name: '意见反馈' }).click();
  const dialog = customer.getByRole('dialog', { name: '产品与服务反馈' });
  await expect(dialog).toContainText('使用过程中有哪些不便');
  await dialog.getByRole('button', { name: '提交反馈' }).click();
  await expect(dialog).toContainText('请写下您的意见');

  await dialog.getByLabel('您的意见').fill(CONTENT);
  const chooser = customer.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '添加附件' }).click();
  await (await chooser).setFiles({ name: '下载页截图.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog).toContainText('下载页截图.png');
  expect(await noHorizontalScroll(customer)).toBe(true);
  await customer.screenshot({ path: 'out/m3-6-feedback-submit.png' });
  await dialog.getByRole('button', { name: '提交反馈' }).click();

  const done = customer.getByRole('dialog');
  await expect(done).toContainText('感谢您的反馈');
  await done.getByRole('button', { name: '查看我的反馈' }).click();
  await expect(customer).toHaveURL(/\/customer\/feedback$/);
  await expect(customer.getByRole('heading', { name: '我的反馈', level: 1 })).toBeVisible();
  // 平时不在菜单里，打开时出现并高亮
  await expect(customer.getByRole('menuitem', { name: '我的反馈' })).toHaveClass(/ant-menu-item-selected/);
  const item = customer.locator('main').getByRole('listitem').filter({ hasText: TITLE });
  await expect(item).toContainText('等待耕云受理');
  await expect(item).toContainText('下载页截图.png');
});

test('运营概览：「待跟进反馈」统计、「待受理反馈」待办、侧栏角标', async () => {
  await ops.reload();
  const stats = ops.getByRole('region', { name: '运营统计' });
  await expect(stats).toContainText('待跟进反馈');
  await expect(stats).toContainText('与编制交付分开处理');
  const todos = ops.getByRole('region', { name: '今天先处理' });
  await expect(todos).toContainText('待受理反馈');
  await expect(todos).toContainText(`“${TITLE}”`);
  await expect(ops.getByRole('menuitem', { name: /反馈受理/ })).toContainText('1');
  await todos.getByRole('link', { name: '受理反馈：示例安全咨询机构' }).click();
  await expect(ops).toHaveURL(/\/operator\/feedback\?id=[0-9a-f-]{36}$/);
});

test('运营受理、改类型、回复并关闭；内部备注客户看不到', async () => {
  await expect(ops.getByRole('heading', { name: '反馈受理', level: 1 })).toBeVisible();
  const detail = ops.getByRole('region', { name: '反馈详情' });
  await expect(detail.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(detail).toContainText('林管理员 · 示例安全咨询机构');
  await expect(detail).toContainText('从顶栏「意见反馈」提交');
  await expect(detail).toContainText('下载页截图.png');
  // 没有关联任务：不能转给注安师
  await expect(detail.getByRole('button', { name: '转给注安师' })).toBeDisabled();
  expect(await noHorizontalScroll(ops)).toBe(true);
  await ops.screenshot({ path: 'out/m3-6-I08-feedback-1366.png', fullPage: true });

  await detail.getByLabel('内部备注').fill('记到下载入口优化需求');
  await detail.getByRole('button', { name: '受理，稍后回复' }).click();
  await expect(ops.getByText('已受理，客户会收到站内提醒')).toBeVisible();
  await ops.getByRole('tab', { name: /处理中/ }).click();
  await expect(detail).toContainText('处理中 · 赵运营');

  await detail.getByRole('button', { name: '回复并关闭' }).click();
  await expect(ops.getByText('请先写给客户的回复')).toBeVisible();
  await detail.getByRole('radio', { name: '平台使用' }).click();
  await detail.getByLabel('回复客户').fill(REPLY);
  await detail.getByRole('button', { name: '回复并关闭' }).click();
  await expect(ops.getByText('已回复客户并关闭')).toBeVisible();
  await ops.getByRole('tab', { name: /已关闭/ }).click();
  await expect(detail).toContainText(REPLY);
  await expect(detail.getByRole('button', { name: '回复并关闭' })).toHaveCount(0);
  await ops.screenshot({ path: 'out/m3-6-I08-feedback-closed.png', fullPage: true });
});

test('客户在站内提醒和「我的反馈」里看到处理结果', async () => {
  await customer.goto('/customer');
  await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  const notes = customer.getByRole('list', { name: '提醒列表' });
  await expect(notes).toContainText('您的反馈已处理');
  await expect(notes).toContainText(REPLY);
  await expect(notes).toContainText('耕云已受理您的反馈');
  await notes.getByText('您的反馈已处理').click();
  await expect(customer).toHaveURL(/\/customer\/feedback\?id=/);
  const item = customer.locator('main').getByRole('listitem').filter({ hasText: TITLE });
  await expect(item).toContainText('已处理');
  await expect(item).toContainText(REPLY);
  await expect(customer.locator('main')).not.toContainText('记到下载入口优化需求');
  expect(await noHorizontalScroll(customer)).toBe(true);
  await customer.screenshot({ path: 'out/m3-6-my-feedback.png', fullPage: true });
});

test('注安师打不开反馈受理', async ({ browser }) => {
  const p = await browser.newPage();
  await login(p, 'expert@demo.genyun.net.cn');
  await expect(p).toHaveURL(/\/expert/);
  await p.goto('/operator/feedback');
  await expect(p).not.toHaveURL(/\/operator\/feedback/);
  await p.close();
});

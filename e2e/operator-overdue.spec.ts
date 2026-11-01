import { expect, test, type Browser, type Page } from '@playwright/test';

// M3 第 4 项：超时兜底（Paper 16 页 I04「超时兜底」）。
// 演示数据：示例塑胶制品有限公司两周前提交、分派给吴工，客户请注安师电话联系「消防水池」「应急物资及装备」，
// 吴工第二天打过一次未接通 → 超过 2 个工作日没联系上，进运营的超时兜底。运营提醒、改派或自己先打给客户安抚。
test.describe.configure({ mode: 'serial' });

const PLASTIC = '示例塑胶制品有限公司';

async function login(page: Page, email: string, home: RegExp) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

async function as(browser: Browser, email: string, home: RegExp) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await login(p, email, home);
  return { p, close: () => ctx.close() };
}

let page: Page;
let taskId = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, 'ops@demo.genyun.net.cn', /\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

test('超时兜底列出塑胶：负责注安师吴工，客户申请电话联系后 2 个工作日未联系上', async () => {
  await page.goto('/operator/tasks');
  await page.getByRole('tab', { name: /^超时兜底 \d+$/ }).click();
  const list = page.getByRole('tabpanel', { name: '超时兜底' });
  const row = list.getByRole('button', { name: new RegExp(PLASTIC) });
  await expect(row).toContainText('负责注安师 吴工 · 客户申请电话联系后 2 个工作日未联系上');
  await expect(row).toContainText('超时');
  await expect(row).toContainText(/\d+\.\d+ 起/);
  await expect(page.getByText('只列需要运营介入的任务')).toBeVisible();
  await row.click();
  taskId = new URL(page.url()).searchParams.get('task') ?? '';
  expect(taskId).not.toBe('');
});

test('右栏写清原因、三种处理和联系记录（客户不可见）', async () => {
  const panel = page.getByRole('region', { name: '任务详情' });
  await expect(panel.getByRole('heading', { name: `${PLASTIC} · 编制应急预案` })).toBeVisible();
  await expect(panel.locator('header')).toContainText(/超时 \d+ 个工作日/);
  await expect(panel).toContainText('吴工打过 1 次电话都没接通');
  await expect(panel).toContainText('涉及 2 项');
  await expect(panel).toContainText(/客户已等待 \d+ 个工作日/);
  await expect(panel.getByRole('radio')).toHaveCount(3);
  await expect(panel.getByRole('radio', { name: /提醒吴工/ })).toHaveAttribute('aria-checked', 'true');

  const timeline = panel.getByRole('list', { name: '任务联系记录' });
  await expect(timeline).toContainText('系统 · 超过 2 个工作日未联系上，转运营兜底');
  await expect(timeline).toContainText('注安师 吴工 · 电话联系 · 未接通');
  await expect(timeline).toContainText('客户 陈志刚 · 请注安师电话联系');
  await page.screenshot({ path: 'out/m3-4-I04-overdue.png' });
  // 1366×768 下不横向滚动
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'out/m3-4-I04-overdue-1366.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('提醒吴工：吴工收到站内提醒，记在联系记录里', async ({ browser }) => {
  const panel = page.getByRole('region', { name: '任务详情' });
  await panel.getByRole('button', { name: '提醒吴工', exact: true }).click();
  await expect(page.getByText('已提醒吴工，记在联系记录里')).toBeVisible();
  await expect(panel.getByRole('list', { name: '任务联系记录' })).toContainText('运营 赵运营 · 提醒注安师');

  const wu = await as(browser, 'expert2@demo.genyun.net.cn', /\/expert$/);
  await wu.p.getByRole('button', { name: /提醒/ }).click();
  const item = wu.p.getByRole('button', { name: /运营提醒：请尽快联系客户/ }).first();
  await expect(item).toBeVisible();
  await expect(item).toContainText(PLASTIC);
  await wu.close();
});

test('写内部备注、记下已致电客户；客户和注安师都看不到', async ({ browser }) => {
  const panel = page.getByRole('region', { name: '任务详情' });
  await panel.getByRole('button', { name: '写内部备注' }).click();
  const dialog = page.getByRole('dialog', { name: '写内部备注' });
  await dialog.getByLabel('内部备注').fill('吴工本周在外地，已约客户周三上午回电');
  await dialog.getByRole('button', { name: '保存备注' }).click();
  await expect(page.getByText('内部备注已记下，客户和注安师看不到')).toBeVisible();

  await panel.getByRole('radio', { name: /我先打给客户安抚/ }).click();
  await panel.getByRole('button', { name: '记下已致电客户' }).click();
  await expect(page.getByText('已记下：运营已致电客户安抚')).toBeVisible();
  const timeline = panel.getByRole('list', { name: '任务联系记录' });
  await expect(timeline).toContainText('运营 赵运营 · 内部备注');
  await expect(timeline).toContainText('吴工本周在外地，已约客户周三上午回电');
  await expect(timeline).toContainText('运营 赵运营 · 已致电客户安抚');
  // 运营致电不算注安师联系上客户：任务仍在超时兜底
  await expect(page.getByRole('tabpanel', { name: '超时兜底' }).getByRole('button', { name: new RegExp(PLASTIC) })).toBeVisible();
  await page.screenshot({ path: 'out/m3-4-I04-actions.png' });

  for (const [email, home] of [
    ['feiyu@demo.genyun.net.cn', /\/customer/],
    ['expert2@demo.genyun.net.cn', /\/expert$/],
  ] as const) {
    const other = await as(browser, email, home);
    for (const path of [`/api/tasks/${taskId}`, `/api/tasks/${taskId}/checklist`]) {
      expect(await (await other.p.request.get(path)).text()).not.toContain('吴工本周在外地');
    }
    expect((await other.p.request.get('/api/operator/tasks/overdue')).status()).toBe(403);
    expect((await other.p.request.get(`/api/operator/tasks/${taskId}/notes`)).status()).toBe(403);
    expect((await other.p.request.post(`/api/operator/tasks/${taskId}/remind`, { data: {} })).status()).toBe(403);
    await other.close();
  }
});

test('改派用同一个弹窗，当前负责注安师不能再选', async () => {
  const panel = page.getByRole('region', { name: '任务详情' });
  await panel.getByRole('radio', { name: /改派其他注安师/ }).click();
  await panel.getByRole('button', { name: '改派其他注安师', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /改派注安师/ });
  await expect(dialog.getByRole('radio', { name: /吴工/ })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
});

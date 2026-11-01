import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// M3 第 8 项：运营概览（Paper 16 页 I01）、内部账号与权限（I06）。
// 邀请一位新注安师 → 接受 → 停用（不能登录）→ 恢复。不动演示数据里的周工、吴工
test.describe.configure({ mode: 'serial' });

const OUTBOX = join('apps', 'api', '.data', 'e2e-mail-outbox');
const EMAIL = `sun-${Date.now()}@genyun.net.cn`;
const PASSWORD = 'sungong2026';
let page: Page;

async function inviteLink(email: string): Promise<string> {
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const mail = JSON.parse(await readFile(join(OUTBOX, f), 'utf8')) as { to: string; text: string };
    if (mail.to === email) return new URL(mail.text.match(/https?:\/\/\S+\/invite\/\S+/)![0]).pathname;
  }
  throw new Error(`发件箱里没有给 ${email} 的邮件`);
}

async function login(p: Page, email: string, password = 'e2e-password') {
  await p.goto('/login');
  await p.getByPlaceholder('请输入邮箱').fill(email);
  await p.getByPlaceholder('请输入密码').fill(password);
  await p.getByRole('button', { name: /登\s*录/ }).click();
}

const noHorizontalScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(page, 'ops@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

test('运营概览：四个统计、今天先处理、年度服务、最近操作', async () => {
  await expect(page.getByRole('heading', { name: '运营概览', level: 1 })).toBeVisible();
  const stats = page.getByRole('region', { name: '运营统计' });
  for (const label of ['客户组织', '在办任务', '本月交付', '需要运营兜底']) await expect(stats).toContainText(label);
  await expect(page.getByRole('region', { name: '今天先处理' })).toBeVisible();
  await expect(page.getByRole('region', { name: '客户年度服务' })).toContainText('服务中');
  await expect(page.getByRole('region', { name: '最近操作' })).toBeVisible();
  // 界面上没有内部编码和英文动作名
  await expect(page.locator('main')).not.toContainText(/login_success|task_assign|account_/);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: 'out/m3-8-I01-overview.png', fullPage: true });
});

test('内部账号：列出运营和注安师，自己不能停用', async () => {
  await page.getByRole('menuitem', { name: /内部账号/ }).click();
  await expect(page).toHaveURL(/\/operator\/accounts$/);
  await expect(page.getByRole('heading', { name: '内部账号与权限' })).toBeVisible();
  const list = page.getByRole('region', { name: '内部成员' });
  await expect(list).toContainText('赵运营（我）');
  await expect(list).toContainText('周工');
  await expect(list).toContainText('分配给本人的任务');
  // 自己那一行没有停用按钮
  await expect(page.getByRole('button', { name: '停用赵运营的账号' })).toHaveCount(0);
  await expect(list).not.toContainText('专业人员');
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: 'out/m3-8-I06-accounts.png', fullPage: true });
});

test('邀请注安师：发邀请邮件，列表显示待接受；对方接受后以注安师进入', async ({ browser }) => {
  await page.getByRole('button', { name: '邀请内部成员' }).click();
  const dialog = page.getByRole('dialog', { name: '邀请内部成员' });
  // 已有账号的邮箱
  await dialog.getByLabel('姓名').fill('周工');
  await dialog.getByLabel('邮箱').fill('expert@demo.genyun.net.cn');
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(dialog.getByText(/已经有耕云账号/)).toBeVisible();

  await dialog.getByLabel('姓名').fill('孙工');
  await dialog.getByLabel('邮箱').fill(EMAIL);
  await page.screenshot({ path: 'out/m3-8-I06-invite.png' });
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: EMAIL });
  await expect(row).toContainText('待接受');
  await expect(row).toContainText('注安师');

  const other = await browser.newPage();
  await other.goto(await inviteLink(EMAIL));
  const info = other.locator('dl');
  await expect(info).toContainText('身份注安师');
  await expect(info).toContainText('可见范围分配给本人的任务');
  await other.getByLabel('设置密码').fill(PASSWORD);
  await other.getByRole('checkbox').check();
  await other.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(other).toHaveURL(/\/expert$/);
  await other.close();

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: EMAIL })).toContainText('正常');
});

test('停用：确认后已停用，对方不能登录；恢复后能登录', async ({ browser }) => {
  await page.getByRole('button', { name: '停用孙工的账号' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /停\s*用/ }).click();
  const row = page.getByRole('listitem').filter({ hasText: EMAIL });
  await expect(row).toContainText('已停用');
  await expect(row.getByRole('button', { name: '恢复孙工的账号' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'out/m3-8-I06-disabled.png', fullPage: true });

  const other = await browser.newPage();
  await login(other, EMAIL, PASSWORD);
  await expect(other.getByText('这个账号已停用。如需恢复，请联系耕云运营')).toBeVisible();
  await expect(other).toHaveURL(/\/login$/);

  await row.getByRole('button', { name: '恢复孙工的账号' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /恢\s*复/ }).click();
  await expect(row).toContainText('正常');
  await login(other, EMAIL, PASSWORD);
  await expect(other).toHaveURL(/\/expert$/);
  await other.close();
});

test('操作日志里有邀请、停用、恢复', async () => {
  await page.getByRole('menuitem', { name: /操作日志/ }).click();
  for (const label of ['邀请内部成员', '停用账号', '恢复账号']) {
    await expect(page.getByRole('row').filter({ hasText: label }).first()).toContainText('孙工');
  }
});

test('注安师打不开运营概览和内部账号', async ({ browser }) => {
  const other = await browser.newPage();
  await login(other, 'expert@demo.genyun.net.cn');
  await expect(other).toHaveURL(/\/expert$/);
  expect((await other.request.get('/api/operator/overview')).status()).toBe(403);
  expect((await other.request.get('/api/operator/accounts')).status()).toBe(403);
  await other.goto('/operator/accounts');
  await expect(other).not.toHaveURL(/\/operator/);
  await other.close();
});

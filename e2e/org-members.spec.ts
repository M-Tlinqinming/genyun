import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// M3 第 7 项：客户组织管理。机构管理员邀请成员 → 成员接受 → 管理员分配一家企业 → 成员只看到这一家；
// 企业分配、年度服务、组织资料三个标签能打开。只新增一位成员，不改演示数据里已有的人
test.describe.configure({ mode: 'serial' });

const OUTBOX = join('apps', 'api', '.data', 'e2e-mail-outbox');
const EMAIL = `wang-${Date.now()}@example.com`;
const PASSWORD = 'wanggong2026';
const ASSIGNED = '示例五金制品有限公司';
const HIDDEN = '示例塑胶制品有限公司';
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
  await login(page, 'feiyu@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer$/);
});

test.afterAll(async () => {
  await page.close();
});

test('成员与权限：列出自己（不能改自己），角色说明', async () => {
  await page.getByRole('menuitem', { name: /组织管理/ }).click();
  await expect(page).toHaveURL(/\/customer\/organization$/);
  await expect(page.getByRole('heading', { name: '组织管理', level: 1 })).toBeVisible();
  const list = page.getByRole('region', { name: '机构成员' });
  await expect(list).toContainText('陈志刚 · 您');
  await expect(list).toContainText('全部企业');
  await expect(page.getByRole('button', { name: '移除陈志刚' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '成员', exact: true })).toContainText('只访问分配给自己的企业');
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: 'out/m3-7-members.png', fullPage: true });
});

test('邀请成员：已有账号的邮箱被拦下；新邮箱显示待接受邀请，对方接受后加入', async ({ browser }) => {
  await page.getByRole('button', { name: '+ 邀请成员' }).click();
  const dialog = page.getByRole('dialog', { name: '邀请成员' });
  await dialog.getByLabel('姓名').fill('林管理员');
  await dialog.getByLabel('邮箱').fill('admin@demo.genyun.net.cn');
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(dialog.getByText(/已经有耕云账号/)).toBeVisible();

  await dialog.getByLabel('姓名').fill('王工');
  await dialog.getByLabel('邮箱').fill(EMAIL);
  await page.screenshot({ path: 'out/m3-7-invite.png' });
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: EMAIL });
  await expect(row).toContainText('待接受邀请');
  await expect(row).toContainText('加入后分配');

  const other = await browser.newPage();
  await other.goto(await inviteLink(EMAIL));
  await other.getByLabel('设置密码').fill(PASSWORD);
  await other.getByRole('checkbox').check();
  await other.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(other).toHaveURL(/\/customer$/);
  // 还没分配企业：企业列表为空，也没有新建企业按钮，侧栏没有组织管理
  await other.goto('/customer/enterprises');
  await expect(other.getByText('还没有分配给您的企业')).toBeVisible();
  await expect(other.getByRole('button', { name: /新建企业/ })).toHaveCount(0);
  await expect(other.getByRole('menuitem', { name: /组织管理/ })).toHaveCount(0);
  await other.close();

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: '王工' })).toContainText('已加入');
});

test('调整企业：给王工分配一家企业，王工只看到这一家', async ({ browser }) => {
  await page.getByRole('button', { name: '调整王工可访问的企业' }).click();
  const dialog = page.getByRole('dialog', { name: /调整 王工 可访问的企业/ });
  await dialog.getByRole('checkbox', { name: ASSIGNED }).check();
  await dialog.getByRole('button', { name: /保\s*存/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: '王工' })).toContainText(ASSIGNED);

  const other = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(other, EMAIL, PASSWORD);
  await expect(other).toHaveURL(/\/customer$/);
  await other.goto('/customer/enterprises');
  await expect(other.getByRole('cell', { name: ASSIGNED })).toBeVisible();
  await expect(other.getByText(HIDDEN)).toHaveCount(0);
  await expect(other.getByText('找不到某家企业？')).toBeVisible();
  expect(await noHorizontalScroll(other)).toBe(true);
  await other.screenshot({ path: 'out/m3-7-member-enterprises.png', fullPage: true });
  // 组织管理页成员打不开
  await other.goto('/customer/organization');
  await expect(other.getByText('只有机构管理员可以管理组织')).toBeVisible();
  await other.close();
});

test('企业分配、年度服务、组织资料', async () => {
  await page.getByRole('tab', { name: '企业分配' }).click();
  await expect(page).toHaveURL(/tab=enterprises/);
  const table = page.getByRole('region', { name: '企业分配' });
  await expect(table.getByRole('listitem').filter({ hasText: ASSIGNED })).toContainText('王工');
  await expect(page.getByText('分配只决定谁能看到这家企业')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: 'out/m3-7-enterprises.png', fullPage: true });

  await page.getByRole('tab', { name: '年度服务' }).click();
  await expect(page.getByRole('region', { name: '年度服务' })).toContainText('服务期');
  await expect(page.getByRole('region', { name: '服务内容' })).toContainText('本年已办理');
  await expect(page.getByText('到期后会怎样')).toBeVisible();
  await page.screenshot({ path: 'out/m3-7-service.png', fullPage: true });

  await page.getByRole('tab', { name: '组织资料' }).click();
  await expect(page.getByText('没有未保存的更改')).toBeVisible();
  await page.getByLabel('服务联系人').fill('陈志刚');
  await page.getByLabel('联系电话').fill('0752-1234567');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText('组织资料已保存')).toBeVisible();
  await page.screenshot({ path: 'out/m3-7-profile.png', fullPage: true });
});

test('移除王工：确认后不在名单里，王工不能再登录', async ({ browser }) => {
  await page.getByRole('tab', { name: /成员与权限/ }).click();
  await page.getByRole('button', { name: '移除王工' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /移\s*除/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '王工' })).toHaveCount(0);

  const other = await browser.newPage();
  await login(other, EMAIL, PASSWORD);
  await expect(other).toHaveURL(/\/login/);
  await other.close();
});

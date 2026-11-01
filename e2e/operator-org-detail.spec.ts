import { expect, request, test, type Browser, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// M3 第 2 项：运营的客户组织详情（Paper 16 页 I03），重发邀请、更换首位管理员后旧链接作废
test.describe.configure({ mode: 'serial' });

const ORG = '博罗安联安全咨询有限公司';
const stamp = Date.now();
const FIRST = `he-${stamp}@boluo-anlian.cn`;
const SECOND = `xu-${stamp}@boluo-anlian.cn`;
const OUTBOX = join('apps', 'api', '.data', 'mail-outbox');

// 发件箱里给这个邮箱的邮件，新的在前
async function links(email: string): Promise<string[]> {
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith('.json')).sort().reverse();
  const out: string[] = [];
  for (const f of files) {
    const mail = JSON.parse(await readFile(join(OUTBOX, f), 'utf8')) as { to: string; text: string };
    if (mail.to === email) out.push(new URL(mail.text.match(/https?:\/\/\S+\/invite\/\S+/)![0]).pathname);
  }
  return out;
}

// 不带运营登录状态打开邀请链接
async function openInvite(browser: Browser, path: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(path);
  return { p, close: () => ctx.close() };
}

let page: Page;
let orgId = '';

test.beforeAll(async ({ browser }) => {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'ops@demo.genyun.net.cn', password: 'e2e-password' } });
  const org = await api.post('/api/operator/organizations', {
    data: {
      name: ORG,
      region: '广东省惠州市博罗县',
      socialCreditCode: '91441322MA5XXXXXX3',
      contactName: '何经理',
      contactPhone: '139 2266 1180',
      contactEmail: FIRST,
      note: '',
    },
  });
  expect(org.ok()).toBe(true);
  orgId = (await org.json()).id;
  const file = await api.post(`/api/operator/organizations/${orgId}/contract-file`, {
    multipart: { file: { name: '博罗安联合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% 合同\n') } },
  });
  const opened = await api.post(`/api/operator/organizations/${orgId}/open`, {
    data: {
      contractNumber: 'GY-HT-2026-131',
      scopeKind: 'annual',
      scopeEnterprises: 5,
      startsAt: '2026-01-01',
      endsAt: '2027-12-31',
      contractFileId: (await file.json()).id,
      paymentReceived: true,
      adminName: '何经理',
      adminPhone: '139 2266 1180',
      adminEmail: FIRST,
    },
  });
  expect(opened.ok()).toBe(true);
  await api.dispose();

  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

const card = (name: string) => page.getByRole('region', { name });

test('从列表点「查看」进入详情：组织资料、成员、企业与任务、年度服务、开通与邀请', async () => {
  await page.getByRole('menuitem', { name: /客户组织/ }).click();
  await page.getByPlaceholder('组织名称 / 联系人 / 手机号').fill('博罗安联');
  await page.getByRole('link', { name: `查看${ORG}` }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/organizations/${orgId}$`));
  await expect(page.getByRole('heading', { level: 1, name: ORG })).toBeVisible();
  await expect(page.getByText('服务中 · 广东省惠州市博罗县 · ')).toBeVisible();
  await expect(page.getByText('0 家企业、0 名成员')).toBeVisible();

  await expect(card('组织资料')).toContainText('统一社会信用代码91441322MA5XXXXXX3');
  await expect(card('组织资料')).toContainText('主联系人何经理 · 139 **** 1180');
  await expect(card('联系人与成员')).toContainText(FIRST);
  await expect(card('联系人与成员')).toContainText('邀请中');
  await expect(card('企业与任务')).toContainText('客户还没有添加企业');
  await expect(card('年度服务')).toContainText('2026.01.01 – 2027.12.31');
  await expect(card('年度服务').getByRole('progressbar')).toBeVisible();
  const invite = card('开通与邀请');
  await expect(invite).toContainText('首位管理员何经理 · 邀请中');
  await expect(invite).toContainText('待接受邀请1 个');
  await expect(invite).toContainText('耕云只负责开通组织和邀请首位管理员');
  await expect(card('操作记录')).toContainText(`邀请 ${FIRST} 作为首位管理员加入`);
  await page.screenshot({ path: 'out/m3-2-I03-overview.png', fullPage: true });
});

test('重新发送邀请：新邮件发出，旧链接显示已作废', async ({ browser }) => {
  const [oldLink] = await links(FIRST);
  await card('开通与邀请').getByRole('button', { name: '重新发送邀请' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '重新发送' }).click();
  await expect(page.getByText(`邀请已发到 ${FIRST}，旧链接已作废`)).toBeVisible();
  await expect.poll(async () => (await links(FIRST)).length).toBeGreaterThan(1);
  const [newLink] = await links(FIRST);
  expect(newLink).not.toBe(oldLink);

  const old = await openInvite(browser, oldLink!);
  await expect(old.p.getByRole('heading', { name: '邀请已作废' })).toBeVisible();
  await old.close();
  const fresh = await openInvite(browser, newLink!);
  await expect(fresh.p.getByRole('heading', { name: `加入${ORG}` })).toBeVisible();
  await fresh.close();
});

test('更换首位管理员：填错时说明怎么改；发出后旧链接作废，新管理员接受后不能再更换', async ({ browser }) => {
  const [previous] = await links(FIRST);
  await card('开通与邀请').getByRole('button', { name: '更换管理员' }).click();
  const dialog = page.getByRole('dialog', { name: '更换首位管理员' });
  await dialog.getByLabel('邮箱').fill('xu-at-boluo');
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(dialog).toContainText('请填写首位管理员姓名');
  await expect(dialog).toContainText('请填写正确的邮箱');
  await page.screenshot({ path: 'out/m3-2-I03-replace-errors.png' });
  await dialog.getByLabel('姓名').fill('徐主任');
  await dialog.getByLabel('手机号').fill('138 2266 5521');
  await dialog.getByLabel('邮箱').fill(SECOND);
  await dialog.getByRole('button', { name: '发送邀请' }).click();
  await expect(page.getByText(`邀请已发到 ${SECOND}，旧链接已作废`)).toBeVisible();
  await expect(card('开通与邀请')).toContainText('首位管理员徐主任 · 邀请中');

  const old = await openInvite(browser, previous!);
  await expect(old.p.getByRole('heading', { name: '邀请已作废' })).toBeVisible();
  await old.close();

  // 徐主任接受邀请
  await expect.poll(async () => (await links(SECOND)).length).toBe(1);
  const [link] = await links(SECOND);
  const accept = await openInvite(browser, link!);
  await accept.p.getByLabel('设置密码').fill('boluo2026xu');
  await accept.p.getByRole('checkbox').check();
  await accept.p.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(accept.p).toHaveURL(/\/customer$/);
  await accept.close();

  await page.reload();
  await expect(card('开通与邀请')).toContainText(/首位管理员徐主任 · \d\d\.\d\d 已接受/);
  await expect(card('开通与邀请').getByRole('button', { name: '更换管理员' })).toHaveCount(0);
  await expect(card('联系人与成员')).toContainText('徐主任');
  await expect(card('联系人与成员')).toContainText('管理员');
  await expect(card('联系人与成员')).not.toContainText(FIRST);
  await expect(card('操作记录')).toContainText('徐主任接受邀请，成为管理员');
  await page.screenshot({ path: 'out/m3-2-I03-accepted.png', fullPage: true });
});

test('其他页签：开通与邀请里列出每封邀请的状态', async () => {
  await page.getByRole('tab', { name: '开通与邀请' }).click();
  const history = card('邀请记录');
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(history.getByRole('listitem').filter({ hasText: SECOND })).toContainText('已接受');
  await expect(history.getByRole('listitem').filter({ hasText: FIRST })).toHaveCount(2);
  await expect(history.getByRole('listitem').filter({ hasText: FIRST }).first()).toContainText('已作废');
  await page.getByRole('tab', { name: '年度服务' }).click();
  await expect(card('合同')).toContainText('合同编号GY-HT-2026-131');
  await expect(card('合同')).toContainText('服务范围年度服务 · 5 家企业');
  await expect(card('合同').getByRole('button', { name: '博罗安联合同.pdf' })).toBeVisible();
  await page.getByRole('tab', { name: '操作记录' }).click();
  await expect(card('操作记录')).toContainText('登记客户组织');
  await expect(card('操作记录')).toContainText('组织开通，合同有效期生效');
});

test('链接里的组织不存在时说明怎么回去', async () => {
  await page.goto('/operator/organizations/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('找不到这个客户组织')).toBeVisible();
  await page.getByRole('link', { name: '回到客户组织' }).click();
  await expect(page.getByRole('heading', { name: '客户组织' })).toBeVisible();
});

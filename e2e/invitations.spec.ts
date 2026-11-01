import { expect, request, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// M3 第 2 项：首位管理员从邀请邮件进入（Paper 10 页 A02 接受邀请，含过期、已使用、找不到）
const ORG = '东江安评技术服务有限公司';
const EMAIL = `li-${Date.now()}@dongjiang-anping.cn`;
// 模拟发信把邮件写进后端的发件箱目录（后端在 apps/api 下运行）
const OUTBOX = join('apps', 'api', '.data', 'mail-outbox');

async function inviteLink(email: string): Promise<string> {
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const mail = JSON.parse(await readFile(join(OUTBOX, f), 'utf8')) as { to: string; text: string };
    if (mail.to === email) return new URL(mail.text.match(/https?:\/\/\S+\/invite\/\S+/)![0]).pathname;
  }
  throw new Error(`发件箱里没有给 ${email} 的邮件`);
}

let link = '';

test.beforeAll(async () => {
  // 运营登记并开通一家组织，首位管理员是李经理
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'ops@demo.genyun.net.cn', password: 'e2e-password' } });
  const org = await api.post('/api/operator/organizations', {
    data: {
      name: ORG,
      region: '广东省惠州市',
      socialCreditCode: '91441300MA5XXXXXX7',
      contactName: '李经理',
      contactPhone: '137 2254 8890',
      contactEmail: EMAIL,
      note: '',
    },
  });
  expect(org.ok()).toBe(true);
  const { id } = await org.json();
  const file = await api.post(`/api/operator/organizations/${id}/contract-file`, {
    multipart: { file: { name: '东江安评合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% 合同\n') } },
  });
  expect(file.ok()).toBe(true);
  const opened = await api.post(`/api/operator/organizations/${id}/open`, {
    data: {
      contractNumber: 'GY-HT-2026-118',
      scopeKind: 'annual',
      scopeEnterprises: 3,
      startsAt: '2026-01-01',
      endsAt: '2027-12-31',
      contractFileId: (await file.json()).id,
      paymentReceived: true,
      adminName: '李经理',
      adminPhone: '137 2254 8890',
      adminEmail: EMAIL,
    },
  });
  expect(opened.ok()).toBe(true);
  await api.dispose();
  link = await inviteLink(EMAIL);
});

test('首位管理员设姓名和密码后直接进入客户工作台；同一链接再点显示「邀请已使用」', async ({ page }) => {
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `加入${ORG}` })).toBeVisible();
  await expect(page.getByText('耕云运营邀请您加入耕云工作空间。')).toBeVisible();
  const info = page.locator('dl');
  await expect(info).toContainText('身份机构管理员');
  await expect(info).toContainText('可见企业全部企业');
  await expect(info).toContainText(/邀请有效期至 \d\d\.\d\d \d\d:\d\d/);
  await expect(page.getByLabel('邮箱')).toHaveValue(EMAIL);
  // 只读而不是禁用：文字看得清
  await expect(page.getByLabel('邮箱')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('邮箱')).toHaveCSS('color', 'rgb(89, 97, 112)');
  await expect(page.getByLabel('姓名')).toHaveValue('李经理');

  // 还没填密码：三条规则都没打勾
  const rules = page.getByRole('list', { name: '密码要求' });
  await expect(rules).not.toContainText('✓');

  // 没同意协议、密码不合规：不能提交，说明怎么改
  await page.getByLabel('设置密码').fill('abc');
  await expect(rules).toContainText('至少 8 位');
  await expect(rules).not.toContainText('✓ 至少 8 位');
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(page.getByText('密码至少 8 位', { exact: true })).toBeVisible();
  await expect(page.getByText('请先阅读并同意服务协议和隐私政策')).toBeVisible();
  await page.screenshot({ path: 'out/m3-2-A02-errors.png' });

  await page.getByLabel('设置密码').fill('dongjiang2026');
  await expect(rules).toContainText('✓ 至少 8 位');
  await expect(rules).toContainText('✓ 含字母和数字');
  await expect(rules).toContainText('✓ 不与邮箱相同');
  await page.getByRole('checkbox').check();
  // 改对后错误提示要消失（等淡出动画结束再截图）
  await expect(page.getByText('密码至少 8 位', { exact: true })).toHaveCount(0);
  await expect(page.getByText('请先阅读并同意服务协议和隐私政策')).toHaveCount(0);
  await page.screenshot({ path: 'out/m3-2-A02-valid.png' });
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(page).toHaveURL(/\/customer$/);

  // 本人还登录着时再点链接：已使用，直接进工作台
  await page.goto(link);
  await expect(page.getByRole('heading', { name: '邀请已使用' })).toBeVisible();
  await page.getByRole('link', { name: '进入工作台' }).click();
  await expect(page).toHaveURL(/\/customer$/);

  // 退出后用设好的密码能登录；再点同一链接显示已使用
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: '邀请已使用' })).toBeVisible();
  await expect(page.getByText(`请用 ${EMAIL} 登录`)).toBeVisible();
  await expect(page.getByRole('button', { name: '接受邀请并进入' })).toHaveCount(0);
  await page.screenshot({ path: 'out/m3-2-A02-used.png' });
  await page.getByRole('link', { name: '去登录' }).click();
  await page.getByPlaceholder('请输入邮箱').fill(EMAIL);
  await page.getByPlaceholder('请输入密码').fill('dongjiang2026');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
});

test('链接不完整时说明怎么办', async ({ page }) => {
  await page.goto('/invite/not-a-real-invitation-token-000000');
  await expect(page.getByRole('heading', { name: '找不到这封邀请' })).toBeVisible();
  await expect(page.getByText('请检查链接是否完整复制')).toBeVisible();
  await expect(page.getByText(/致电耕云 0752-5200831/)).toBeVisible();
});

test('服务出错时说业务话、主按钮是重新加载；提交时出错也不显示英文', async ({ page }) => {
  const token = 'broken-invitation-token-for-e2e-0001';
  await page.route(`**/api/invitations/${token}`, (route) =>
    route.fulfill({ status: 500, json: { statusCode: 500, message: 'Internal server error' } }),
  );
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: '暂时打不开这封邀请' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(page.getByText('Internal server error')).toHaveCount(0);

  // 能打开，但提交时服务出错 / 断网
  await page.unroute(`**/api/invitations/${token}`);
  await page.route(`**/api/invitations/${token}`, (route) =>
    route.fulfill({
      json: {
        state: 'valid',
        orgName: ORG,
        inviterName: '耕云运营',
        role: 'customer_admin',
        email: 'err@example.cn',
        name: '错经理',
        expiresAt: '2099-10-27T02:20:00.000Z',
      },
    }),
  );
  await page.route(`**/api/invitations/${token}/accept`, (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' }),
  );
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.getByLabel('设置密码').fill('genyun2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(page.getByText('耕云服务暂时出了问题，请稍后再试。着急的话请致电耕云 0752-5200831')).toBeVisible();
  await page.unroute(`**/api/invitations/${token}/accept`);
  await page.route(`**/api/invitations/${token}/accept`, (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(page.getByText(/网络连不上耕云/)).toBeVisible();
  await expect(page.getByText('Failed to fetch')).toHaveCount(0);
});

test('已登录其他账号时打开邀请：提示接受后会换账号', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  const token = 'other-account-invitation-token-0001';
  await page.route(`**/api/invitations/${token}`, (route) =>
    route.fulfill({
      json: {
        state: 'valid',
        orgName: ORG,
        inviterName: '耕云运营',
        role: 'customer_admin',
        email: 'new-admin@example.cn',
        name: '新经理',
        expiresAt: '2099-10-27T02:20:00.000Z',
      },
    }),
  );
  await page.goto(`/invite/${token}`);
  await expect(page.getByText(/当前登录 .+（admin@demo\.genyun\.net\.cn），接受后改用 new-admin@example\.cn 登录/)).toBeVisible();
});

test('邀请过期：可以请邀请人重新发送，不能注册', async ({ page }) => {
  // 过期要等 7 天，这里换掉接口返回的状态；「请邀请人重新发送」的后台逻辑由接口测试覆盖
  const token = 'expired-invitation-token-for-e2e-0001';
  await page.route(`**/api/invitations/${token}`, (route) =>
    route.fulfill({
      json: {
        state: 'expired',
        orgName: ORG,
        inviterName: '耕云运营',
        role: 'customer_admin',
        email: 'wang@example.cn',
        name: '王经理',
        expiresAt: '2026-10-27T02:20:00.000Z',
      },
    }),
  );
  await page.route(`**/api/invitations/${token}/request-resend`, (route) => route.fulfill({ json: { inviterName: '耕云运营' } }));
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: '邀请链接已过期' })).toBeVisible();
  await expect(page.getByText('这封邀请已于 10.27 10:20 失效')).toBeVisible();
  await expect(page.locator('dl')).toContainText('受邀邮箱wang@example.cn');
  await expect(page.getByLabel('设置密码')).toHaveCount(0);
  await page.screenshot({ path: 'out/m3-2-A02-expired.png' });
  await page.getByRole('button', { name: '请耕云运营重新发送' }).click();
  await expect(page.getByText('已通知耕云运营。重新发送后，新邀请会发到 wang@example.cn')).toBeVisible();
  await expect(page.getByRole('link', { name: '已有账号，去登录' })).toBeVisible();
});

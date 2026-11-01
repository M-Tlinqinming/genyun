import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// 用吴工（expert2@）测：别的测试文件很少用他；改过的密码、姓名在最后改回去
const EMAIL = 'expert2@demo.genyun.net.cn';
const PASSWORD = 'e2e-password';
const OUTBOX = join(__dirname, '..', 'apps', 'api', '.data', 'e2e-mail-outbox');

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

// 模拟发信写成文件：取 since 之后发给这个邮箱的最新一封里的 6 位验证码
async function latestCode(to: string, since: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = await readdir(OUTBOX).catch(() => [] as string[]);
    const mails: { at: number; text: string }[] = [];
    for (const f of files) {
      const path = join(OUTBOX, f);
      if ((await stat(path)).mtimeMs < since) continue;
      const mail = JSON.parse(await readFile(path, 'utf8')) as { to: string; text: string; at: string };
      if (mail.to === to) mails.push({ at: Date.parse(mail.at), text: mail.text });
    }
    const last = mails.sort((a, b) => b.at - a.at)[0];
    const code = last?.text.match(/验证码是：(\d{6})/)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`发件箱里没有发给 ${to} 的验证码`);
}

async function fillCode(page: Page, code: string) {
  await page.getByRole('textbox').first().click();
  await page.keyboard.type(code);
}

test('忘记密码：邮箱验证码重设后直接登录，旧密码失效，验证码用过即作废', async ({ page, browser }) => {
  // 另一台设备先登录着，重设后应被退出
  const other = await browser.newPage();
  await login(other, EMAIL);
  await expect(other).toHaveURL(/\/expert$/);

  await page.goto('/login');
  await page.getByRole('link', { name: '忘记密码' }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await expect(page.getByRole('heading', { name: '重设密码' })).toBeVisible();

  const since = Date.now() - 1000;
  await page.getByLabel('登录邮箱').fill(EMAIL);
  await page.getByRole('button', { name: '发送验证码' }).click();
  // 不说邮箱是否注册
  await expect(page.getByText('如果 ex****@demo.genyun.net.cn 是耕云账号，验证码已发到这个邮箱，10 分钟内有效。')).toBeVisible();
  await expect(page.getByText(/\d+ 秒后可重新发送/)).toBeVisible();
  const code = await latestCode(EMAIL, since);

  // 先输错一次
  const wrong = code === '000000' ? '111111' : '000000';
  await fillCode(page, wrong);
  await page.getByPlaceholder('至少 8 位，含字母和数字').fill('newpass123');
  await page.getByPlaceholder('再次输入新密码').fill('newpass123');
  await page.getByRole('button', { name: '重设并登录' }).click();
  await expect(page.getByText('验证码不正确或已失效，请检查或重新获取')).toBeVisible();

  // 清空后输入正确的验证码
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await page.getByRole('textbox').first().click();
  await page.keyboard.type(code);
  await page.getByRole('button', { name: '重设并登录' }).click();
  await expect(page).toHaveURL(/\/expert$/);

  // 另一台设备被退出
  await other.reload();
  await expect(other).toHaveURL(/\/login$/);

  // 旧密码不能用
  await login(other, EMAIL);
  await expect(other.getByText('邮箱或密码不正确')).toBeVisible();

  // 同一个验证码不能再用
  const reuse = await page.request.post('/api/auth/recover/reset', { data: { email: EMAIL, code, password: 'another123' } });
  expect(reuse.status()).toBe(400);

  // 改回原密码，别的测试文件还要用
  const back = await page.request.post('/api/account/password', { data: { currentPassword: 'newpass123', newPassword: PASSWORD } });
  expect(back.status()).toBe(204);
  await other.close();
});

test('未注册的邮箱：提示和已注册时一样', async ({ page }) => {
  await page.goto('/recover');
  await page.getByLabel('登录邮箱').fill('nobody@example.com');
  await page.getByRole('button', { name: '发送验证码' }).click();
  await expect(page.getByText('如果 no****@example.com 是耕云账号，验证码已发到这个邮箱，10 分钟内有效。')).toBeVisible();
});

test('个人账户：从头像菜单进入，改姓名、改密码、退出其他设备', async ({ page, browser }) => {
  await login(page, EMAIL);
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('button', { name: /吴工/ }).click();
  await page.getByRole('menuitem', { name: '个人账户' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: '个人账户', level: 1 })).toBeVisible();
  const profile = page.getByRole('region', { name: '基本资料' });
  await expect(profile.getByText(EMAIL)).toBeVisible();
  await expect(profile.getByText('专业人员')).toBeVisible();
  await expect(page.getByText('身份由机构管理员调整')).toBeVisible();
  // 手机号不在个人账户里
  await expect(page.getByText('手机号')).toHaveCount(0);

  // 改姓名
  await page.getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('姓名').fill('吴工程师');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('姓名已更新')).toBeVisible();
  await expect(profile.getByText('吴工程师')).toBeVisible();

  // 再开一台设备：显示「还有 N 处登录中」（前面的测试也留着登录），退出其他设备后变成只有这台
  const other = await browser.newPage();
  await login(other, EMAIL);
  await expect(other).toHaveURL(/\/expert$/);
  await page.reload();
  await expect(page.getByText(/^除这台设备外，还有 \d+ 处登录中$/)).toBeVisible();
  await page.getByRole('button', { name: '退出其他设备' }).click();
  await expect(page.getByText('只有这台设备登录中')).toBeVisible();
  await other.reload();
  await expect(other).toHaveURL(/\/login$/);

  // 改密码：当前密码错时提示
  await page.getByRole('button', { name: '修改密码' }).click();
  const dialog = page.getByRole('dialog', { name: '修改密码' });
  await dialog.getByLabel('当前密码').fill('wrong-pass1');
  await dialog.getByLabel('新密码').fill('changed123');
  await dialog.getByLabel('再次输入').fill('changed123');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog.getByText('当前密码不正确')).toBeVisible();
  await dialog.getByLabel('当前密码').fill(PASSWORD);
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('密码已修改，其他设备上的登录已退出')).toBeVisible();
  await expect(page.getByText(/^上次修改 \d{4}\.\d{2}\.\d{2}$/)).toBeVisible();

  // 这台设备仍登录；新密码能登录
  await page.reload();
  await expect(page).toHaveURL(/\/account$/);
  await login(other, EMAIL, 'changed123');
  await expect(other).toHaveURL(/\/expert$/);

  // 改回原样
  expect((await page.request.post('/api/account/password', { data: { currentPassword: 'changed123', newPassword: PASSWORD } })).status()).toBe(204);
  expect((await page.request.patch('/api/account', { data: { name: '吴工' } })).status()).toBe(200);
  await other.close();
});

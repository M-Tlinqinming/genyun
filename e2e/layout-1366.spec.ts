import { expect, request, test, type Locator, type Page } from '@playwright/test';

// 1366×768 小屏（14 页 E18-08）：专业整理三栏不能把企业事实挤到看不全；其他工作台不出现横向滚动条
test.use({ viewport: { width: 1366, height: 768 } });

const shot = (name: string) => `out/layout-1366-${process.env.SHOT_TAG ?? 'now'}-${name}.png`;

async function login(page: Page, email: string, home: RegExp) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

// 文字完整显示：没有被省略号截断
const notTruncated = (el: Locator) => el.evaluate((n) => n.scrollWidth <= n.clientWidth);
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeAll(async () => {
  // 飞宇补传 3 份原件，右栏页签放不下时要收进「+N」
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } });
  const me = await (await api.get('/api/auth/me')).json();
  const orgId = me.memberships[0].orgId as string;
  const tasks = (await (await api.get(`/api/orgs/${orgId}/tasks`)).json()) as { id: string; enterpriseName: string }[];
  const task = tasks.find((t) => t.enterpriseName === '惠阳飞宇电器有限公司')!;
  for (const name of ['应急物资台账（2026 年第三季度）.pdf', '应急队伍名单.pdf', '应急演练记录.pdf']) {
    const file = await api.post(`/api/orgs/${orgId}/files`, {
      multipart: { file: { name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7
% ${name}
`) } },
    });
    expect(file.ok()).toBe(true);
    const { id: fileId } = await file.json();
    expect((await api.post(`/api/tasks/${task.id}/checklist/emergency_supplies/files`, { data: { fileId } })).ok()).toBe(true);
  }
  await api.dispose();
});

test('专业整理在 1366 下企业名称和统一社会信用代码完整显示', async ({ page }) => {
  await login(page, 'expert@demo.genyun.net.cn', /\/expert$/);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: shot('expert-task-center') });

  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  // 前面的测试文件可能已经生成过草稿，页面默认看生成进度；切回专业整理
  await page.goto(`${new URL(page.url()).pathname}?view=workup`);
  const name = page.locator('[data-fact="companyName"]').getByTitle('惠阳飞宇电器有限公司');
  const code = page.locator('[data-fact="socialCreditCode"]').getByTitle('91441300726483224B');
  await expect(name).toBeVisible();
  await expect(code).toBeVisible();
  await page.screenshot({ path: shot('expert-workup') });
  expect(await notTruncated(name)).toBe(true);
  expect(await notTruncated(code)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);

  // 原件对照收窄到 272：只放 2 个页签，其余收进「+N」，「+N」完整可见、能点开
  const originals = page.getByRole('complementary', { name: '原件对照' });
  await expect(originals.getByRole('tab')).toHaveCount(2);
  const more = originals.getByRole('button', { name: /^\+\d+$/ });
  await expect(more).toBeVisible();
  const box = (await more.boundingBox())!;
  const panel = (await originals.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(await notTruncated(more)).toBe(true);
  await more.hover();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem').first().click();
  await expect(originals.getByRole('tab', { selected: true })).toBeVisible();
  await page.screenshot({ path: shot('expert-workup-originals') });
});

test('客户工作台和运营客户组织在 1366 下不出现横向滚动条', async ({ browser }) => {
  const customer = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(customer, 'admin@demo.genyun.net.cn', /\/customer$/);
  await expect(customer.getByRole('heading').first()).toBeVisible();
  expect(await noHorizontalScroll(customer)).toBe(true);
  await customer.screenshot({ path: shot('customer-workbench') });
  await customer.close();

  const ops = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(ops, 'ops@demo.genyun.net.cn', /\/operator$/);
  await ops.getByRole('menuitem', { name: /客户组织/ }).click();
  await expect(ops.getByRole('row', { name: /飞宇演示客户/ })).toBeVisible();
  expect(await noHorizontalScroll(ops)).toBe(true);
  // 年度服务的日期区间不换行：1366 下行高和 1440 一样（换成两行会到 96）
  const feiyu = ops.getByRole('row', { name: /飞宇演示客户/ });
  const narrow = (await feiyu.boundingBox())!.height;
  expect(narrow).toBeLessThan(90);
  await ops.screenshot({ path: shot('operator-orgs') });
  await ops.setViewportSize({ width: 1440, height: 900 });
  expect((await feiyu.boundingBox())!.height).toBe(narrow);
  await ops.screenshot({ path: shot('operator-orgs-1440') });
  await ops.close();
});

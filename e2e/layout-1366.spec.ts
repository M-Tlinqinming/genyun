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
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  // 前面的测试文件可能已经生成过草稿，页面默认看生成进度；切到资料核对第 1 步
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=1`);
  await expect(page.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  const name = page.getByLabel('企业名称', { exact: true });
  const code = page.getByLabel('统一社会信用代码', { exact: true });
  await expect(name).toHaveValue('惠阳飞宇电器有限公司');
  await expect(code).toHaveValue('91441300726483224B');
  await page.screenshot({ path: shot('expert-workup') });
  expect(await notTruncated(name)).toBe(true);
  expect(await notTruncated(code)).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);

  // 资料核对第 3、4、5 步：不出现横向滚动条
  const path = new URL(page.url()).pathname;
  for (const [q, heading, file] of [
    ['step=3', '核对场所、设备与物料', 'expert-workup-step3'],
    ['step=3&page=2', '核对工艺流程', 'expert-workup-step3-page2'],
    ['step=4', '核对应急资源与图纸', 'expert-workup-step4'],
    ['step=5', '补上只有您能定的专业项', 'expert-workup-step5'],
    ['step=5&page=2', /^(还差 \d+ 项必填资料，暂时不能生成|核对无误，就可以生成初稿)$/, 'expert-workup-step5-page2'],
  ] as const) {
    await page.goto(`${path}?view=workup&${q}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: shot(file) });
  }
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

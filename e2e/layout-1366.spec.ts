import { expect, test, type Locator, type Page } from '@playwright/test';

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
  await ops.screenshot({ path: shot('operator-orgs') });
  await ops.close();
});

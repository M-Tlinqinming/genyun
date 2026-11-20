import { expect, test, type Page } from '@playwright/test';

// M3 第 5 项：知识库。运营维护属地应急机构（工艺模板、节假日页签已取消）；其他身份进不来。
// 只核实一个机构，不改内容，免得影响后面按文件顺序跑的生成用例
test.describe.configure({ mode: 'serial' });

let page: Page;

async function login(p: Page, email: string) {
  await p.goto('/login');
  await p.getByPlaceholder('请输入邮箱').fill(email);
  await p.getByPlaceholder('请输入密码').fill('e2e-password');
  await p.getByRole('button', { name: /登\s*录/ }).click();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await login(page, 'ops@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

// 截图前等弹窗关掉、提示消失
const settle = async (p: Page) => {
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(p.locator('.ant-message-notice')).toHaveCount(0, { timeout: 10_000 });
};

const noHorizontalScroll = async (p: Page) =>
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

test('属地应急机构：按区县看到初始录入的机构，未核实的标出来', async () => {
  await page.getByRole('menuitem', { name: /知识库/ }).click();
  await expect(page).toHaveURL(/\/operator\/knowledge$/);
  await expect(page.getByRole('heading', { name: '知识库 · 属地应急机构' })).toBeVisible();
  const tree = page.getByRole('navigation', { name: '行政区' });
  await expect(tree).toContainText('广东省');
  await expect(tree).toContainText('惠州市');
  await tree.getByRole('button', { name: /惠阳区/ }).click();
  const table = page.getByRole('region', { name: '惠阳区的机构' });
  await expect(table).toContainText('惠州市惠阳区应急管理局');
  await expect(table).toContainText('待核实');
  await expect(page.getByRole('note')).toContainText('还没核实过');
  // 界面上不出现英文类别编码
  await expect(page.locator('main')).not.toContainText('emergency');
  await noHorizontalScroll(page);
  await settle(page);
  await page.screenshot({ path: 'out/m3-5-knowledge-agencies.png' });

  await table.getByRole('tab', { name: '消防' }).click();
  await expect(table.getByRole('listitem')).toHaveCount(1);
  await table.getByRole('tab', { name: '全部' }).click();
});

test('核实一个机构：不改内容直接核实，状态变为有效', async () => {
  const table = page.getByRole('region', { name: '惠阳区的机构' });
  await table.getByRole('button', { name: '核实惠阳区消防救援大队' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('请对照官方公布的信息核对');
  await dialog.getByRole('button', { name: '核实无误' }).click();
  await expect(page.getByText('已记为核实')).toBeVisible();
  const row = table.getByRole('listitem').filter({ hasText: '惠阳区消防救援大队' });
  await expect(row).toContainText('有效');
  await expect(row).toContainText('赵运营');
});

test('工艺模板、节假日页签已取消：旧链接打开属地应急机构', async () => {
  for (const tab of ['templates', 'holidays']) {
    await page.goto(`/operator/knowledge?tab=${tab}`);
    await expect(page.getByRole('heading', { name: '知识库 · 属地应急机构' })).toBeVisible();
  }
  await expect(page.getByRole('tab', { name: /工艺模板|节假日/ })).toHaveCount(0);
});

test('维护操作记进操作日志', async () => {
  await page.goto('/operator/audit-logs');
  await expect(page.getByRole('row').filter({ hasText: '维护属地应急机构' }).first()).toContainText('核实机构：惠阳区 · 惠阳区消防救援大队');
});

test('专家进不来：接口 403，菜单里也没有知识库', async ({ browser }) => {
  const other = await browser.newPage();
  await login(other, 'expert@demo.genyun.net.cn');
  await expect(other).not.toHaveURL(/\/login/);
  await expect(other.getByRole('menuitem', { name: /知识库/ })).toHaveCount(0);
  const res = await other.request.get('/api/operator/knowledge/agencies');
  expect(res.status()).toBe(403);
  await other.close();
});

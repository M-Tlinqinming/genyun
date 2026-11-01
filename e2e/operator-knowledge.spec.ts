import { expect, test, type Page } from '@playwright/test';

// M3 第 5 项：知识库。运营维护属地应急机构、工艺模板、节假日；客户选模板时看到已发布的；其他身份进不来。
// 只改本文件新增的数据（新增的模板、2027 年的一天），不动已有机构，免得影响后面按文件顺序跑的生成用例
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

test('工艺模板：新增草稿、录入工序、发布第 1 版', async () => {
  await page.getByRole('tab', { name: /工艺模板/ }).click();
  await expect(page).toHaveURL(/tab=templates/);
  await expect(page.getByRole('heading', { name: '知识库 · 工艺模板' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '工艺模板' })).toContainText('五金冲压');
  await noHorizontalScroll(page);
  await settle(page);
  await page.screenshot({ path: 'out/m3-5-knowledge-templates.png' });

  await page.getByRole('button', { name: '新增模板' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('模板名称').fill('PCB 线路板');
  await dialog.getByLabel('所属行业').fill('电子');
  await dialog.getByRole('button', { name: /新\s*增/ }).click();
  await expect(page.getByText('已新增草稿')).toBeVisible();
  const editor = page.getByRole('region', { name: '编辑「PCB 线路板」' });
  await expect(editor).toContainText('草稿');

  await editor.getByRole('button', { name: '+ 添加工序' }).click();
  await editor.getByLabel('第 1 道工序名称').fill('开料');
  await editor.getByLabel('第 1 道工序的常见设备').fill('开料机');
  await editor.getByLabel('第 1 道工序的常见设备').press('Enter');
  await editor.getByRole('button', { name: '发布第 1 版' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /发\s*布/ }).click();
  await expect(page.getByText('「PCB 线路板」第 1 版已发布')).toBeVisible();
  await expect(page.getByRole('region', { name: '编辑「PCB 线路板」' })).toContainText('已发布 · 第 1 版');
  await settle(page);
  await page.screenshot({ path: 'out/m3-5-knowledge-template-editor.png' });
});

test('节假日：补上 2027 年元旦', async () => {
  await page.getByRole('tab', { name: /节假日/ }).click();
  await expect(page.getByRole('heading', { name: '知识库 · 节假日' })).toBeVisible();
  await page.getByRole('navigation', { name: '年份' }).getByRole('button', { name: /2027 年/ }).click();
  await expect(page.getByRole('region', { name: '2027 年节假日' })).toContainText('还没有录入');
  await page.getByRole('button', { name: '新增日期' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('日期').fill('2027-01-01');
  await dialog.getByLabel('节日名称').fill('元旦');
  await dialog.getByRole('button', { name: /保\s*存/ }).click();
  const list = page.getByRole('region', { name: '2027 年节假日' });
  await expect(list).toContainText('2027-01-01');
  await expect(list).toContainText('1 天放假');
  await noHorizontalScroll(page);
  await settle(page);
  await page.screenshot({ path: 'out/m3-5-knowledge-holidays.png' });
});

test('维护操作记进操作日志', async () => {
  await page.goto('/operator/audit-logs');
  await expect(page.getByRole('row').filter({ hasText: '维护工艺模板' }).first()).toContainText('发布工艺模板：PCB 线路板（第 1 版）');
  await expect(page.getByRole('row').filter({ hasText: '维护属地应急机构' }).first()).toContainText('核实机构：惠阳区 · 惠阳区消防救援大队');
  await expect(page.getByRole('row').filter({ hasText: '维护节假日' }).first()).toContainText('2027-01-01');
});

test('注安师进不来：接口 403，菜单里也没有知识库', async ({ browser }) => {
  const other = await browser.newPage();
  await login(other, 'expert@demo.genyun.net.cn');
  await expect(other).not.toHaveURL(/\/login/);
  await expect(other.getByRole('menuitem', { name: /知识库/ })).toHaveCount(0);
  const res = await other.request.get('/api/operator/knowledge/agencies');
  expect(res.status()).toBe(403);
  await other.close();
});

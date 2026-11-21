import { expect, test, type Page } from '@playwright/test';

// 缺项清单与「等客户补资料」（13 页 E2-5b、S02、S04，K11）。
// 演示数据：示例家具制造的资料表格任务已复制过缺项清单、标着等客户补资料（没传疏散图）；
// 示例包装材料的资料表格任务前四步已核对完，停在第 5 步。两个任务都分派给周工，别的测试文件不用
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  // 单独跑这个文件时页面还没编译过，登录要多等一会
  await expect(page).toHaveURL(/\/expert$/, { timeout: 15_000 });
}

test('任务中心「查看缺项」打开抽屉，去对应那一步补；向导每一步顶上标着等客户补资料', async ({ page }) => {
  await login(page);
  const row = page.getByRole('row', { name: /示例家具制造有限公司/ });
  await expect(row).toContainText('等客户补资料');
  await row.getByRole('button', { name: '查看缺项' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/示例家具制造有限公司 · 缺 \d+ 项/);
  await expect(drawer).toContainText(/已等 \d+ 天/);
  const items = drawer.getByRole('list', { name: '缺项' });
  await expect(items).toContainText('紧急疏散');
  await expect(items).toContainText('必备，没有不能生成');
  await expect(drawer.getByRole('button', { name: '再复制一次清单' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/acceptance/k11-missing-drawer.png' });

  // 去第 4 步：直接打开任务的那一步，顶上标着等客户补资料
  await items.getByRole('listitem').filter({ hasText: '紧急疏散' }).getByRole('button', { name: '去第 4 步' }).click();
  await expect(page).toHaveURL(/view=workup&step=4/);
  await expect(page.getByRole('heading', { name: '核对应急资源与图纸' })).toBeVisible();
  await expect(page.getByRole('note', { name: '等客户补资料' })).toContainText('已标成「等客户补资料」');
  await page.screenshot({ path: 'test-results/acceptance/k11-awaiting-banner.png', fullPage: true });
});

test('第 5 步：复制缺项清单写进剪贴板，任务标为等客户补资料；第 2 页能再看清单', async ({ page }) => {
  await login(page);
  await page.getByRole('row', { name: /示例包装材料有限公司/ }).click();
  // 前四步已核对完：接着第 5 步第 1 页
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '预案编号' })).toHaveValue(/^[A-Z]{2}\d{4}$/);
  await page.getByLabel('应急经费（每年）').fill('5');
  await page.getByLabel('经费牵头部门').fill('行政部');
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-page1.png', fullPage: true });
  await page.getByRole('button', { name: '下一页：核对并生成' }).click();
  await expect(page).toHaveURL(/step=5&page=2/);
  await expect(page.getByRole('region', { name: '专业项' })).toContainText('应急经费 5 万元/年，行政部牵头');

  const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/workup/missing-list') && r.ok());
  await page.getByRole('button', { name: '复制缺项清单' }).click();
  await expect(page.getByText(/已复制 \d+ 项缺项，粘贴发给客服就行/)).toBeVisible();
  await recorded;
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('【示例包装材料 · 编制应急预案还缺的资料】');
  expect(text).toContain('周工');
  await expect(page.getByRole('note', { name: '等客户补资料' })).toBeVisible();
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-page2-copied.png', fullPage: true });

  // 第 2 页能再看清单
  await page.getByRole('button', { name: /^查看缺项清单（/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/示例包装材料有限公司 · 缺 \d+ 项/);
  await expect(drawer).toContainText('等客户补资料');
  await page.keyboard.press('Escape');

  // 任务中心：显示等客户补资料，按钮换成「查看缺项」
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  const row = page.getByRole('row', { name: /示例包装材料有限公司/ });
  await expect(row).toContainText('等客户补资料');
  await expect(row.getByRole('button', { name: '查看缺项' })).toBeVisible();
});

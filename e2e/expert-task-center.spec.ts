import { expect, request, test, type Browser, type Page } from '@playwright/test';

// 专家任务中心（13 页任务中心、已暂停接单）。演示数据：飞宇任务（旧流程）分派给周工（expert@），
// 五金的任务已提交、待运营分派。分派、改派后的越权见 operator-task-center.spec
const ZHOU = 'expert@demo.genyun.net.cn';
const OPS = 'ops@demo.genyun.net.cn';
const FEIYU = '惠阳飞宇电器有限公司';
const HARDWARE = '示例五金制品有限公司';

async function login(page: Page, email: string, home = /\/expert$/) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

// 用运营账号查到五金任务的编号
async function hardwareTaskId(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { email: OPS, password: 'e2e-password' } });
  expect(res.ok()).toBe(true);
  const tasks = (await (await page.request.get('/api/operator/tasks')).json()) as { id: string; enterpriseName: string }[];
  const id = tasks.find((t) => t.enterpriseName === HARDWARE)!.id;
  await page.request.post('/api/auth/logout');
  return id;
}

test('周工进任务中心：标题、四格统计，旧流程的飞宇任务只读、点「查看」进任务', async ({ page }) => {
  await login(page, ZHOU);
  await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible();
  await expect(page.getByText('分给您的任务都在这里。要您动手的排在前面。')).toBeVisible();
  await expect(page.getByText('接单中', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: '接单' })).toBeChecked();

  const stats = page.getByRole('group', { name: '按阶段筛选' });
  for (const label of ['待核对资料', '编制中', '等客户补资料', '本月已交付']) {
    await expect(stats.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }

  const row = page.getByRole('row', { name: new RegExp(FEIYU) });
  await expect(row).toContainText('飞宇演示客户');
  await expect(row).toContainText('这个任务按原来的方式办理，现在只能查看');
  await expect(page.getByText(HARDWARE)).toHaveCount(0);
  await expect(page.getByText(/^在办 \d+ 个 · 要您动手的排在前面 · 已交付的在「全部任务」里$/)).toBeVisible();

  await row.getByRole('button', { name: /查\s*看/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+$/);
  // 还没生成过草稿：打开资料核对向导
  await expect(page.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  await expect(page.getByTitle(FEIYU)).toBeVisible();
});

test('搜不到时显示空状态，「清空搜索和筛选」恢复列表', async ({ page }) => {
  await login(page, ZHOU);
  await page.getByPlaceholder('搜索企业名称或任务编号').fill('GY-2099');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(FEIYU) })).toHaveCount(0);
  await page.getByRole('button', { name: '清空搜索和筛选' }).click();
  await expect(page.getByPlaceholder('搜索企业名称或任务编号')).toHaveValue('');
  await expect(page.getByRole('row', { name: new RegExp(FEIYU) })).toBeVisible();

  // 点「本月已交付」切到全部任务；周工本月没有交付过
  await page.getByRole('group', { name: '按阶段筛选' }).getByRole('button', { name: /本月已交付/ }).click();
  await expect(page.getByRole('tab', { name: /全部任务/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  await page.getByRole('button', { name: '清空搜索和筛选' }).click();
  await expect(page.getByRole('row', { name: new RegExp(FEIYU) })).toBeVisible();
});

async function opsPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await login(p, OPS, /\/operator$/);
  return { p, close: () => ctx.close() };
}

// 暂停用例单独放：无论成败（含超时中止、页面已关）都用新的请求上下文重新登录周工，恢复接单，免得带坏后面的用例
test.describe('暂停接单', () => {
  test.afterEach(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    try {
      expect((await api.post('/api/auth/login', { data: { email: ZHOU, password: 'e2e-password' } })).ok()).toBe(true);
      expect((await api.put('/api/expert/accepting', { data: { acceptingOrders: true } })).ok()).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('暂停接单：提示条出现，运营分配时周工置灰；恢复后提示条消失', async ({ page, browser }) => {
    const hardware = await hardwareTaskId(page);
    await login(page, ZHOU);
    const toggle = page.getByRole('switch', { name: '接单' });
    await toggle.click();
    const banner = page.getByRole('status').filter({ hasText: '已暂停接单' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('客户在专家列表里选不到您，耕云也不再给您派新任务。');
    await expect(banner).toContainText(/手上这 \d+ 个任务照常进行，不受影响。/);
    await expect(page.getByText('已暂停接单', { exact: true }).first()).toBeVisible();
    await expect(toggle).not.toBeChecked();
    // 刷新后仍是暂停
    await page.reload();
    await expect(page.getByRole('switch', { name: '接单' })).not.toBeChecked();

    const ops = await opsPage(browser);
    try {
      await ops.p.goto(`/operator/tasks?task=${hardware}`);
      const panel = ops.p.getByRole('region', { name: '任务详情' });
      await panel.getByRole('button', { name: '分配专家' }).click();
      const dialog = ops.p.getByRole('dialog', { name: /分配专家/ });
      const zhou = dialog.getByRole('radio', { name: /周工/ });
      await expect(zhou).toBeDisabled();
      await expect(dialog.getByText('已暂停接单，不能分配')).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /吴工/ })).toBeEnabled();
      await dialog.getByRole('button', { name: /取\s*消/ }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await ops.close();
    }

    await page.getByRole('status').getByRole('button', { name: /恢复接单/ }).click();
    await expect(page.getByRole('status').filter({ hasText: '已暂停接单' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: '接单' })).toBeChecked();
    await expect(page.getByText('接单中', { exact: true })).toBeVisible();
  });
});

test('越权：周工打不开没分派给他的任务', async ({ page }) => {
  const hardware = await hardwareTaskId(page);
  await login(page, ZHOU);
  await page.goto(`/expert/tasks/${hardware}`);
  await expect(page.getByText('找不到该任务')).toBeVisible();
  await expect(page.getByText(HARDWARE)).toHaveCount(0);
});

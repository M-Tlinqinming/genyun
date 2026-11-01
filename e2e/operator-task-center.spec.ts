import { expect, test, type Browser, type Page } from '@playwright/test';

// M3 第 3 项：运营在任务中心分派、改派负责专家（Paper 16 页 I04「待分派」、分配专业人员弹窗）。
// 演示数据：飞宇任务已分派给周工；示例五金制品有限公司的任务已提交、待分派。
// 这个文件排在所有 expert-* 测试之后跑，周工收到的提醒不影响那些测试
test.describe.configure({ mode: 'serial' });

const HARDWARE = '示例五金制品有限公司';

async function login(page: Page, email: string, home: RegExp) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

async function asExpert(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await login(p, email, /\/expert$/);
  return { p, close: () => ctx.close() };
}

let page: Page;
let hardwareTask = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page, 'ops@demo.genyun.net.cn', /\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

test('待分派里有已提交、没有负责专家的任务；分派给周工后进入周工的任务中心', async ({ browser }) => {
  await page.getByRole('menuitem', { name: /任务中心/ }).click();
  await expect(page).toHaveURL(/\/operator\/tasks/);
  // 前面的测试（m1-acceptance 等）也提交过任务，待分派不止一条
  const tab = page.getByRole('tab', { name: /^待分派 \d+$/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const before = Number((await tab.textContent())!.replace(/\D/g, ''));

  const list = page.getByRole('tabpanel', { name: '待分派' });
  const row = list.getByRole('button', { name: new RegExp(HARDWARE) });
  await expect(row).toContainText('编制应急预案 · 新提交 · 未分派专家');
  // 飞宇已有负责专家，不在待分派里
  await expect(list.getByText('惠阳飞宇电器有限公司')).toHaveCount(0);
  await row.click();

  const panel = page.getByRole('region', { name: '任务详情' });
  await expect(panel.getByRole('heading', { name: `${HARDWARE} · 编制应急预案` })).toBeVisible();
  await expect(panel).toContainText('还没有负责专家');
  await page.screenshot({ path: 'out/m3-3-I04-unassigned.png' });
  hardwareTask = new URL(page.url()).searchParams.get('task') ?? '';
  expect(hardwareTask).not.toBe('');

  await panel.getByRole('button', { name: '分配专业人员' }).click();
  const dialog = page.getByRole('dialog', { name: /分配专业人员/ });
  // 还没选人时不能提交
  await expect(dialog.getByRole('button', { name: /^分\s*配$/ })).toBeDisabled();
  // 周工手上已有飞宇演示客户的另一家企业
  await expect(dialog.getByRole('radio', { name: /周工/ })).toBeVisible();
  await expect(dialog.getByText('在办 1 个 · 正在处理该客户的另外 1 家企业')).toBeVisible();
  await expect(dialog.getByText('在办 0 个')).toBeVisible();
  await dialog.getByRole('radio', { name: /周工/ }).check();
  await dialog.getByLabel('给专业人员的说明（选填）').fill('客户比较急，希望 11 月中交付');
  await page.screenshot({ path: 'out/m3-3-I04-assign-dialog.png' });
  await dialog.getByRole('button', { name: '分配给周工' }).click();
  await expect(page.getByText('已分配给周工，已通知对方')).toBeVisible();
  await expect(dialog).toBeHidden();

  // 离开待分派，在全部任务里显示负责专家
  await expect(page.getByRole('tab', { name: `待分派 ${before - 1}` })).toBeVisible();
  await expect(list.getByText(HARDWARE)).toHaveCount(0);
  await page.getByRole('tab', { name: '全部任务' }).click();
  await expect(page.getByRole('tabpanel', { name: '全部任务' }).getByRole('button', { name: new RegExp(HARDWARE) })).toContainText(
    '负责专家 周工',
  );

  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  await expect(zhou.p.getByRole('row', { name: new RegExp(HARDWARE) })).toBeVisible();
  await zhou.p.getByRole('button', { name: /提醒/ }).click();
  await expect(zhou.p.getByText('分配给你的新任务')).toBeVisible();
  await expect(zhou.p.getByText(/运营说明：客户比较急，希望 11 月中交付/)).toBeVisible();
  await zhou.close();
});

test('改派给吴工：吴工看到任务，周工再也打不开', async ({ browser }) => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  const panel = page.getByRole('region', { name: '任务详情' });
  await expect(panel).toContainText('联系记录 0 条');
  await panel.getByRole('button', { name: '改派其他专家' }).click();
  const dialog = page.getByRole('dialog', { name: /改派负责专家/ });
  // 当前负责专家不能再选
  await expect(dialog.getByRole('radio', { name: /周工/ })).toBeDisabled();
  await expect(dialog.getByText('当前负责专家')).toBeVisible();
  await expect(dialog).toContainText('周工不再能打开这个任务');
  await dialog.getByRole('radio', { name: /吴工/ }).check();
  await dialog.getByRole('button', { name: '改派给吴工' }).click();
  await expect(page.getByText('已改派给吴工，已通知对方')).toBeVisible();
  await expect(panel).toContainText('负责专家 吴工');
  await page.screenshot({ path: 'out/m3-3-I04-reassigned.png' });

  const wu = await asExpert(browser, 'expert2@demo.genyun.net.cn');
  await wu.p.getByRole('row', { name: new RegExp(HARDWARE) }).click();
  await expect(wu.p).toHaveURL(new RegExp(`/expert/tasks/${hardwareTask}$`));
  await expect(wu.p.getByRole('heading', { name: HARDWARE })).toBeVisible();
  await wu.close();

  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  await expect(zhou.p.getByRole('row', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();
  await expect(zhou.p.getByText(HARDWARE)).toHaveCount(0);
  await zhou.p.goto(`/expert/tasks/${hardwareTask}`);
  await expect(zhou.p.getByText('找不到该任务')).toBeVisible();
  await zhou.close();
});

test('从客户组织详情点任务编号，直接打开这个任务', async () => {
  await page.goto('/operator/organizations');
  await page.getByRole('row', { name: /飞宇演示客户/ }).getByRole('link', { name: '查看' }).click();
  // 演示数据里五金的任务编号是当年第 2 个
  await page.getByRole('link', { name: /^GY-\d{4}-002$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/tasks\\?task=${hardwareTask}$`));
  await expect(page.getByRole('tab', { name: '全部任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '任务详情' })).toContainText('负责专家 吴工');
});

test('全部任务可以按企业、任务编号、客户组织搜索', async () => {
  await page.goto('/operator/tasks');
  await page.getByRole('tab', { name: '全部任务' }).click();
  await page.getByPlaceholder('企业 / 任务编号 / 客户组织').fill('不存在的企业');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  await page.getByPlaceholder('企业 / 任务编号 / 客户组织').fill('飞宇');
  const list = page.getByRole('tabpanel', { name: '全部任务' });
  await expect(list.getByRole('button', { name: /惠阳飞宇电器有限公司/ })).toContainText('负责专家 周工');
  await page.screenshot({ path: 'out/m3-3-I04-all.png' });
});

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

// M3 第 3 项：运营在任务中心分派、改派负责注安师（Paper 16 页 I04「待分派」、分配注安师弹窗）。
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

// 弹窗的出现动画播完再截图
async function settled(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(dialog.page().locator('.ant-modal')).not.toHaveClass(/ant-zoom/);
}

// 提醒正文最多显示 3 行：这段文字真的落在可见的几行里，而不是被截掉
async function expectTextShown(body: Locator, text: string) {
  const shown = await body.evaluate((el, t) => {
    const node = el.firstChild;
    const start = node?.textContent?.indexOf(t) ?? -1;
    if (!node || start < 0) return false;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + t.length);
    const box = el.getBoundingClientRect();
    return Array.from(range.getClientRects()).every((r) => r.bottom <= box.bottom + 1);
  }, text);
  expect(shown, `「${text}」应在提醒正文的可见行内`).toBe(true);
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

test('待分派里有已提交、没有负责注安师的任务；分派给周工后进入周工的任务中心', async ({ browser }) => {
  await page.getByRole('menuitem', { name: /任务中心/ }).click();
  await expect(page).toHaveURL(/\/operator\/tasks/);
  // 前面的测试（m1-acceptance 等）也提交过任务，待分派不止一条
  const tab = page.getByRole('tab', { name: /^待分派 \d+$/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const before = Number((await tab.textContent())!.replace(/\D/g, ''));
  await expect(page.getByText('只列需要运营介入的任务')).toBeVisible();

  const list = page.getByRole('tabpanel', { name: '待分派' });
  const row = list.getByRole('button', { name: new RegExp(HARDWARE) });
  await expect(row).toContainText('编制应急预案 · 新提交 · 未分派注安师');
  // 演示数据里飞宇已有负责注安师，不在待分派里。enterprises.spec 在另一个客户组织（示例安全咨询机构）
  // 也建了同名企业、前面的测试会提交它的任务，所以按客户组织区分
  await expect(
    list.getByRole('button', { name: /惠阳飞宇电器有限公司/ }).filter({ hasText: '飞宇演示客户' }),
  ).toHaveCount(0);
  await row.click();

  const panel = page.getByRole('region', { name: '任务详情' });
  await expect(panel.getByRole('heading', { name: `${HARDWARE} · 编制应急预案` })).toBeVisible();
  await expect(panel).toContainText('还没有负责注安师');
  await expect(panel).toContainText('任务进入注安师的任务中心');
  await page.screenshot({ path: 'out/m3-3-I04-unassigned.png' });
  hardwareTask = new URL(page.url()).searchParams.get('task') ?? '';
  expect(hardwareTask).not.toBe('');

  await panel.getByRole('button', { name: '分配注安师' }).click();
  const dialog = page.getByRole('dialog', { name: /分配注安师/ });
  // 还没选人时不能提交
  await expect(dialog.getByRole('button', { name: /^分\s*配$/ })).toBeDisabled();
  // 周工手上已有飞宇演示客户的另一家企业（飞宇）
  await expect(dialog.getByRole('radio', { name: /周工/ })).toBeVisible();
  await expect(dialog.getByText('在办 1 个 · 正在处理该客户的另外 1 家企业')).toBeVisible();
  // 第一次分派不问改派理由
  await expect(dialog.getByText(/改派理由/)).toHaveCount(0);
  await dialog.getByRole('radio', { name: /周工/ }).check();
  await dialog.getByLabel('给注安师的说明（选填）').fill('客户比较急，希望 11 月中交付');
  await settled(dialog);
  await page.screenshot({ path: 'out/m3-3-I04-assign-dialog.png' });
  await dialog.getByRole('button', { name: '分配给周工' }).click();
  await expect(page.getByText('已分配给周工，已通知对方')).toBeVisible();
  await expect(dialog).toBeHidden();

  // 离开待分派，在全部任务里显示负责注安师
  await expect(page.getByRole('tab', { name: `待分派 ${before - 1}` })).toBeVisible();
  await expect(list.getByText(HARDWARE)).toHaveCount(0);
  await page.getByRole('tab', { name: '全部任务' }).click();
  // 列表底部那句说明只在「待分派」下
  await expect(page.getByText('只列需要运营介入的任务')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '全部任务' }).getByRole('button', { name: new RegExp(HARDWARE) })).toContainText(
    '负责注安师 周工',
  );

  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  await expect(zhou.p.getByRole('row', { name: new RegExp(HARDWARE) })).toBeVisible();
  await zhou.p.getByRole('button', { name: /提醒/ }).click();
  const item = zhou.p.getByRole('button', { name: /分配给你的新任务/ }).first();
  await expect(item).toBeVisible();
  // 运营说明在正文第一句，3 行以内一定看得见
  await expectTextShown(item.locator('[data-role="notification-body"]'), '运营说明：客户比较急，希望 11 月中交付');
  await zhou.close();
});

test('改派给吴工：可选理由告诉周工；吴工看到任务，周工打开旧链接看到已改派给谁', async ({ browser }) => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  const panel = page.getByRole('region', { name: '任务详情' });
  await expect(panel).toContainText('联系记录 0 条');
  await panel.getByRole('button', { name: '改派注安师' }).click();
  const dialog = page.getByRole('dialog', { name: /改派注安师/ });
  // 当前负责注安师不能再选
  await expect(dialog.getByRole('radio', { name: /周工/ })).toBeDisabled();
  await expect(dialog.getByText('当前负责注安师')).toBeVisible();
  await expect(dialog).toContainText('周工不再能打开这个任务');
  await expect(dialog).toContainText('不另外通知客户');
  await dialog.getByRole('radio', { name: /吴工/ }).check();
  await dialog.getByRole('button', { name: '请假' }).click();
  await expect(dialog.getByRole('button', { name: '请假' })).toHaveAttribute('aria-pressed', 'true');
  await settled(dialog);
  await page.screenshot({ path: 'out/m3-3-I04-reassign-dialog.png' });
  await dialog.getByRole('button', { name: '改派给吴工' }).click();
  await expect(page.getByText('已改派给吴工，已通知对方')).toBeVisible();
  await expect(panel).toContainText('负责注安师 吴工');
  await page.screenshot({ path: 'out/m3-3-I04-reassigned.png' });

  const wu = await asExpert(browser, 'expert2@demo.genyun.net.cn');
  await wu.p.getByRole('row', { name: new RegExp(HARDWARE) }).click();
  await expect(wu.p).toHaveURL(new RegExp(`/expert/tasks/${hardwareTask}$`));
  await expect(wu.p.getByRole('heading', { name: HARDWARE })).toBeVisible();
  await wu.close();

  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  await expect(zhou.p.getByRole('row', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();
  await expect(zhou.p.getByRole('row', { name: new RegExp(HARDWARE) })).toHaveCount(0);
  await zhou.p.getByRole('button', { name: /提醒/ }).click();
  const moved = zhou.p.getByRole('button', { name: /任务已改派/ }).first();
  await expectTextShown(moved.locator('[data-role="notification-body"]'), '改派理由：请假');
  await moved.click();
  await expect(zhou.p).toHaveURL(new RegExp(`/expert/tasks/${hardwareTask}$`));
  await expect(zhou.p.getByText('这个任务已改派给吴工')).toBeVisible();
  await zhou.close();
});

test('从客户组织详情点任务编号，直接打开这个任务', async () => {
  await page.goto('/operator/organizations');
  await page.getByRole('row', { name: /飞宇演示客户/ }).getByRole('link', { name: '查看' }).click();
  // 演示数据里五金的任务编号是当年第 2 个
  await page.getByRole('link', { name: /^GY-\d{4}-002$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/tasks\\?task=${hardwareTask}$`));
  await expect(page.getByRole('tab', { name: '全部任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '任务详情' })).toContainText('负责注安师 吴工');
});

test('全部任务可以按企业、任务编号、客户组织搜索', async () => {
  await page.goto('/operator/tasks');
  await page.getByRole('tab', { name: '全部任务' }).click();
  await page.getByPlaceholder('企业 / 任务编号 / 客户组织').fill('不存在的企业');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  // 列表空了，右栏只留一句说明
  await expect(page.getByRole('region', { name: '任务详情' })).toHaveCount(0);
  await expect(page.getByText('选中任务后，在这里查看情况、分派或改派注安师。')).toBeVisible();
  await page.getByPlaceholder('企业 / 任务编号 / 客户组织').fill('飞宇');
  const list = page.getByRole('tabpanel', { name: '全部任务' });
  // 同名企业在两个客户组织都有（见第一个用例），按客户组织取演示数据里的那家
  await expect(
    list.getByRole('button', { name: /惠阳飞宇电器有限公司/ }).filter({ hasText: '飞宇演示客户' }),
  ).toContainText('负责注安师 周工');
  await page.screenshot({ path: 'out/m3-3-I04-all.png' });
});

test('关掉弹窗焦点回到按钮；弹窗开着时别的运营已改派：提交后关掉弹窗并说明', async () => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  const panel = page.getByRole('region', { name: '任务详情' });
  const trigger = panel.getByRole('button', { name: '改派注安师' });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: /改派注安师/ });
  await settled(dialog);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  dialog = page.getByRole('dialog', { name: /改派注安师/ });
  await dialog.getByRole('radio', { name: /周工/ }).check();
  // 另一位运营在这期间把任务改派给了周工
  const experts = (await (await page.request.get(`/api/operator/tasks/${hardwareTask}/experts`)).json()) as { id: string; name: string }[];
  const id = (name: string) => experts.find((e) => e.name === name)!.id;
  const res = await page.request.post(`/api/operator/tasks/${hardwareTask}/assign`, {
    data: { expertId: id('周工'), currentExpertId: id('吴工') },
  });
  expect(res.status()).toBe(201);

  await dialog.getByRole('button', { name: '改派给周工' }).click();
  await expect(page.getByText(/^已被其他运营处理：/)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(panel).toContainText('负责注安师 周工');
});

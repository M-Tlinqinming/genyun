import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

// 运营任务中心（Paper 16 页 I04 任务中心、I04b 任务抽屉、分配专家弹窗）：四格统计筛选、表格、抽屉、分配和改派。
// 演示数据：飞宇任务已分配给周工；示例五金制品有限公司的任务已提交、客户没选专家。
// 别的测试文件（以及别的演示数据）也会提交任务、加任务，所以各状态的个数不写死：跟接口比，或者看增减。
// 这个文件排在所有 expert-* 测试之后跑，周工收到的提醒不影响那些测试
test.describe.configure({ mode: 'serial' });

const HARDWARE = '示例五金制品有限公司';
// 资料表格任务，周工已列出缺项、标着等客户补资料（expert-workup-missing 只看不改）
const AWAITING = '示例家具制造有限公司';
const FEIYU_ORG = '飞宇演示客户';

type Group = 'to_assign' | 'awaiting' | 'working' | 'preparing' | 'delivered';
type ApiTask = { id: string; number: string; enterpriseName: string; orgId: string; orgName: string; group: Group };

const LABELS: Record<Exclude<Group, 'delivered'>, string> = {
  to_assign: '待分配专家',
  awaiting: '等客户补资料',
  working: '专家处理中',
  preparing: '资料准备',
};

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

// 弹窗的出现动画播完
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

const apiTasks = async () => (await (await page.request.get('/api/operator/tasks')).json()) as ApiTask[];
const table = () => page.getByRole('table', { name: '任务列表' });
// 表格里的任务行（不含表头）
const rows = () => table().locator('[role="row"][data-task]');
// 任务抽屉：读屏名是抽屉标题（企业名称等），这里按里面的「联系记录」认
const drawer = () => page.getByRole('dialog').filter({ has: page.getByRole('region', { name: '联系记录' }) });
const stat = (label: string) => page.getByRole('group', { name: '按阶段筛选' }).getByRole('button', { name: new RegExp(`^${label}`) });
const statValue = async (label: string) => Number((await stat(label).locator('.gy-tabular').textContent())!.trim());

test.beforeAll(async ({ browser }) => {
  // 缺项清单那段要读剪贴板
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await login(page, 'ops@demo.genyun.net.cn', /\/operator$/);
  hardwareTask = (await apiTasks()).find((t) => t.enterpriseName === HARDWARE && t.orgName === FEIYU_ORG)!.id;
});

test.afterAll(async () => {
  await page.close();
});

test('四格统计和接口一致，点一格筛选、再点取消；已交付默认不显示', async () => {
  await page.getByRole('menuitem', { name: /任务中心/ }).click();
  await expect(page).toHaveURL(/\/operator\/tasks/);
  await expect(page.getByRole('heading', { name: '任务中心', level: 1 })).toBeVisible();
  const all = await apiTasks();
  const count = (g: Group) => all.filter((t) => t.group === g).length;
  for (const [g, label] of Object.entries(LABELS)) expect(await statValue(label)).toBe(count(g as Group));

  // 没筛选时：已交付的不在表里
  const open = all.length - count('delivered');
  await expect(rows()).toHaveCount(open);
  await expect(page.getByText(new RegExp(`^在办 ${open} 个 · 要您处理的排在前面`))).toBeVisible();

  // 点「待分配专家」：只剩这一组，按钮按下
  await stat('待分配专家').click();
  await expect(stat('待分配专家')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows()).toHaveCount(count('to_assign'));
  await expect(rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG })).toContainText('还没分配');
  // 再点一次取消
  await stat('待分配专家').click();
  await expect(stat('待分配专家')).toHaveAttribute('aria-pressed', 'false');
  await expect(rows()).toHaveCount(open);

  // 显示已交付 / 收起已交付
  const delivered = count('delivered');
  if (delivered > 0) {
    await page.getByRole('button', { name: '显示已交付' }).click();
    await expect(rows()).toHaveCount(all.length);
    await expect(page.getByText(`在办 ${open} 个 · 已交付 ${delivered} 个`)).toBeVisible();
    await page.getByRole('button', { name: '收起已交付' }).click();
    await expect(rows()).toHaveCount(open);
  } else {
    await expect(page.getByRole('button', { name: '显示已交付' })).toHaveCount(0);
  }
});

test('分配给周工：抽屉里写着等了多久，弹窗选人；任务进入周工的任务中心，周工收到运营说明', async ({ browser }) => {
  await page.goto('/operator/tasks');
  const before = await statValue('待分配专家');
  await rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG }).click();
  await expect(page).toHaveURL(new RegExp(`task=${hardwareTask}`));
  await expect(drawer()).toContainText(HARDWARE);
  await expect(drawer()).toContainText('还没分配专家');
  await expect(drawer()).toContainText(/已等(不到 1| \d+) 天/);
  await expect(drawer()).toContainText('提交，客户没选专家');
  await expect(drawer()).toContainText('客户提交时没有选专家，由您指定。');

  await drawer().getByRole('button', { name: '分配专家' }).click();
  const dialog = page.getByRole('dialog', { name: /^分配专家/ });
  await settled(dialog);
  // 还没选人时不能提交
  await expect(dialog.getByRole('button', { name: /^分\s*配$/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /^周工 在办 \d+ 个 · 擅长/ })).toBeEnabled();
  await expect(dialog.getByRole('radio', { name: /^吴工 在办 \d+ 个 · 擅长/ })).toBeEnabled();
  // 第一次分配不问改派理由
  await expect(dialog.getByText(/改派理由/)).toHaveCount(0);
  await expect(dialog).toContainText('客户提交时没有选专家，由耕云指定。');
  await dialog.getByRole('radio', { name: /周工/ }).check();
  await dialog.getByLabel('给专家的说明（选填）').fill('客户比较急，希望 11 月中交付');
  await dialog.getByRole('button', { name: '分配给周工' }).click();
  await expect(page.getByText('已分配给周工，已通知对方')).toBeVisible();
  await expect(dialog).toBeHidden();

  // 离开「待分配专家」，表里写着负责专家
  await expect.poll(() => statValue('待分配专家')).toBe(before - 1);
  await expect(drawer()).toContainText('负责专家 周工');
  await drawer().getByRole('button', { name: '关闭' }).first().click();
  await expect(page).not.toHaveURL(/task=/);
  const row = rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG });
  await expect(row).toContainText('周工');
  await expect(row.getByRole('button', { name: '改派' })).toBeVisible();

  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  await expect(zhou.p.getByRole('row', { name: new RegExp(HARDWARE) })).toBeVisible();
  await zhou.p.getByRole('button', { name: /提醒/ }).click();
  const item = zhou.p.getByRole('button', { name: /分配给你的新任务/ }).first();
  await expect(item).toBeVisible();
  // 运营说明在正文第一句，3 行以内一定看得见
  await expectTextShown(item.locator('[data-role="notification-body"]'), '运营说明：客户比较急，希望 11 月中交付');
  await zhou.close();
});

test('抽屉里写联系记录：只有运营看得到，记下后出现在列表里', async () => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  const notes = drawer().getByRole('region', { name: '联系记录' });
  await expect(notes).toContainText('客户不可见');
  const save = notes.getByRole('button', { name: /记\s*下/ });
  await expect(save).toBeDisabled();
  await notes.getByLabel('写一条联系记录').fill('客户答应周五前把消防验收意见书发过来');
  await save.click();
  await expect(page.getByText('已记下，客户看不到')).toBeVisible();
  await expect(notes.getByRole('listitem').filter({ hasText: '客户答应周五前把消防验收意见书发过来' })).toContainText('赵运营');
  await expect(notes.getByLabel('写一条联系记录')).toHaveValue('');
});

test('等客户补资料：抽屉里逐项列出缺项，补上的划掉；复制的是还没补上的项；联系记录里有专家列清单那条', async ({ browser }) => {
  const taskId = (await apiTasks()).find((t) => t.enterpriseName === AWAITING)!.id;
  // 周工用接口重新复制一次清单，再代客户补上「技术管理人员人数」
  const zhou = await asExpert(browser, 'expert@demo.genyun.net.cn');
  const workup = async () => (await (await zhou.p.request.get(`/api/tasks/${taskId}/workup`)).json()) as { version: number };
  expect((await zhou.p.request.post(`/api/tasks/${taskId}/workup/missing-list`, { data: { version: (await workup()).version } })).ok()).toBe(true);
  const filled = await zhou.p.request.put(`/api/tasks/${taskId}/workup/facts`, {
    data: { version: (await workup()).version, key: 'technicalManagementCount', value: 6, source: 'customer' },
  });
  expect(filled.ok()).toBe(true);
  await zhou.close();

  await page.goto(`/operator/tasks?task=${taskId}`);
  await expect(drawer()).toContainText(AWAITING);
  await expect(drawer()).toContainText(/周工 \d+ 月 \d+ 日 \d{2}:\d{2} 列出缺项/);
  const block = drawer().getByRole('region', { name: '缺项清单' });
  const items = block.getByRole('list', { name: '缺项' });
  await expect(items.getByRole('listitem').first()).toBeVisible();
  const openCount = await items.locator('[role="listitem"]:not([data-filled])').count();
  await expect(block.getByRole('heading')).toHaveText(`还缺 ${openCount} 项`);
  const evacuation = items.getByRole('listitem').filter({ hasText: '紧急疏散示意图' });
  await expect(evacuation).toContainText('必备');
  await expect(evacuation).toContainText('没有这一项不能生成。');
  const done = items.locator('[data-filled="true"]');
  await expect(done).toHaveCount(1);
  await expect(done).toContainText('技术人员数');
  await expect(done).toContainText(/\d+ 月 \d+ 日已补上/);
  await expect(done).not.toContainText('必备');
  await expect(done.getByText('技术人员数')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(block).toContainText('清单由专家列出，这里只能看和复制。复制后粘贴到企业微信发给客户。');
  await block.screenshot({ path: 'test-results/acceptance/k17-operator-missing-list.png' });

  await block.getByRole('button', { name: '复制缺项清单' }).click();
  await expect(page.getByText(`已复制 ${openCount} 项缺项，粘贴到企业微信发给客户`)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  // Windows 的剪贴板读回来是 \r\n
  expect(text.split(/\r?\n/)[0]).toMatch(/^【.+ · 编制应急预案还缺的资料】$/);
  expect(text).toContain('专家 周工');
  expect(text).toContain('紧急疏散示意图');
  expect(text).not.toContain('技术管理人员人数');

  const notes = drawer().getByRole('region', { name: '联系记录' });
  await expect(notes.getByRole('listitem').first()).toContainText('复制了缺项清单，任务标为「等客户补资料」。');
  await expect(notes.getByRole('listitem').first()).toContainText('周工');
  await notes.screenshot({ path: 'test-results/acceptance/k17-operator-notes.png' });
});

test('改派给吴工：可选理由告诉周工；吴工看到任务，周工打开旧链接看到已改派给谁', async ({ browser }) => {
  await page.goto('/operator/tasks');
  await rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG }).getByRole('button', { name: '改派' }).click();
  const dialog = page.getByRole('dialog', { name: /^改派专家/ });
  await settled(dialog);
  // 当前负责专家不能再选
  await expect(dialog.getByRole('radio', { name: /^周工/ })).toBeDisabled();
  await expect(dialog.getByText('现在负责')).toBeVisible();
  await expect(dialog).toContainText('周工不再能打开这个任务');
  await expect(dialog).toContainText('不另外通知客户');
  await dialog.getByRole('radio', { name: /吴工/ }).check();
  await dialog.getByRole('button', { name: '请假' }).click();
  await expect(dialog.getByRole('button', { name: '请假' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '改派给吴工' }).click();
  await expect(page.getByText('已改派给吴工，已通知对方')).toBeVisible();
  await expect(rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG })).toContainText('吴工');

  const wu = await asExpert(browser, 'expert2@demo.genyun.net.cn');
  await wu.p.getByRole('row', { name: new RegExp(HARDWARE) }).click();
  await expect(wu.p).toHaveURL(new RegExp(`/expert/tasks/${hardwareTask}$`));
  // 吴工打开即进资料核对向导，顶栏写着企业名称
  await expect(wu.p.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  await expect(wu.p.getByTitle(HARDWARE)).toBeVisible();
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

test('从客户组织详情点任务编号，直接打开这个任务的抽屉', async () => {
  await page.goto('/operator/organizations');
  await page.getByRole('row', { name: new RegExp(FEIYU_ORG) }).getByRole('link', { name: '查看' }).click();
  const number = (await apiTasks()).find((t) => t.id === hardwareTask)!.number;
  await page.getByRole('link', { name: number, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/tasks\\?task=${hardwareTask}$`));
  await expect(drawer()).toContainText('负责专家 吴工');
});

test('搜索企业名称或任务编号、按客户组织筛选；组织详情带来的 ?org= 直接筛好', async () => {
  await page.goto('/operator/tasks');
  const search = page.getByPlaceholder('搜索企业名称或任务编号');
  await search.fill('不存在的企业');
  await expect(page.getByText('没有符合条件的任务')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(search).toHaveValue('');

  const all = await apiTasks();
  const number = all.find((t) => t.id === hardwareTask)!.number;
  await search.fill(number);
  await expect(rows()).toHaveCount(1);
  await expect(rows().first()).toContainText(HARDWARE);
  await search.fill('');

  // 按客户组织筛：只剩飞宇演示客户的任务（已交付的默认不显示）
  const feiyu = all.filter((t) => t.orgName === FEIYU_ORG);
  const feiyuOpen = feiyu.filter((t) => t.group !== 'delivered').length;
  // 下拉可以搜索：输入组织名后回车选中
  await page.getByRole('combobox', { name: '客户组织' }).click();
  await page.getByRole('combobox', { name: '客户组织' }).fill(FEIYU_ORG);
  await page.keyboard.press('Enter');
  await expect(rows()).toHaveCount(feiyuOpen);
  for (const r of await rows().all()) await expect(r).toContainText(FEIYU_ORG);

  // ?org= 带来的筛选
  await page.goto(`/operator/tasks?org=${feiyu[0]!.orgId}`);
  await expect(page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '客户组织' }) })).toContainText(FEIYU_ORG);
  await expect(rows()).toHaveCount(feiyuOpen);
});

test('关掉弹窗焦点回到按钮；弹窗开着时别的运营已改派：提交后关掉弹窗并说明', async () => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  const trigger = drawer().getByRole('button', { name: '改派专家' });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: /^改派专家/ });
  await settled(dialog);
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  dialog = page.getByRole('dialog', { name: /^改派专家/ });
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
  await expect(drawer()).toContainText('负责专家 周工');
});

test('别的原因被拒（如专家刚暂停接单）：弹窗留着、写出服务端的原因，可以改选别人', async () => {
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  await drawer().getByRole('button', { name: '改派专家' }).click();
  const dialog = page.getByRole('dialog', { name: /^改派专家/ });
  await settled(dialog);
  await page.route(`**/api/operator/tasks/${hardwareTask}/assign`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 409, message: '吴工已暂停接单，不能分配', code: 'expert_paused' }),
    }),
  );
  try {
    await dialog.getByRole('radio', { name: /^吴工 / }).check();
    await dialog.getByRole('button', { name: '改派给吴工' }).click();
    await expect(dialog.getByText('吴工已暂停接单，不能分配')).toBeVisible();
    await expect(page.getByText(/^已被其他运营处理：/)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    // 选择还在，确认按钮还能再点（或改选别人）
    await expect(dialog.getByRole('radio', { name: /^吴工 / })).toBeChecked();
    await expect(dialog.getByRole('button', { name: '改派给吴工' })).toBeEnabled();
  } finally {
    await page.unroute(`**/api/operator/tasks/${hardwareTask}/assign`);
  }
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(dialog).toBeHidden();
});

test('抽屉里的客户手机号遮住中间四位，不显示完整号码', async () => {
  const detail = (await (await page.request.get(`/api/operator/tasks/${hardwareTask}`)).json()) as { contactPhone: string | null };
  await page.goto(`/operator/tasks?task=${hardwareTask}`);
  await expect(drawer()).toBeVisible();
  if (!detail.contactPhone) {
    await expect(drawer().getByText('这家组织没有登记主联系人手机号')).toBeVisible();
    return;
  }
  const phone = detail.contactPhone;
  const masked = `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
  await expect(drawer()).toContainText(masked);
  await expect(drawer()).not.toContainText(phone);
  await expect(drawer().getByRole('button', { name: '复制手机号' })).toBeVisible();
});

test('打不开的任务（?task= 不存在）也能用右上角关掉抽屉', async () => {
  await page.goto('/operator/tasks?task=00000000-0000-4000-8000-000000000000');
  const panel = page.getByRole('dialog', { name: /^任务/ });
  // 加载中就有关闭按钮
  await expect(panel.getByRole('button', { name: '关闭' })).toBeVisible();
  // 接口找不到会先重试几次才报错
  await expect(panel.getByText('这个任务没有打开')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByText('这个任务没有打开')).toBeHidden();
  await expect(page).toHaveURL(/\/operator\/tasks$/);
});

test('键盘：Tab 到任务行，回车或空格打开抽屉', async () => {
  await page.goto('/operator/tasks');
  const row = rows().filter({ hasText: HARDWARE }).filter({ hasText: FEIYU_ORG });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer()).toContainText(HARDWARE);
  await drawer().getByRole('button', { name: '关闭' }).first().click();
  await expect(drawer()).toBeHidden();
  await row.focus();
  await page.keyboard.press(' ');
  await expect(drawer()).toContainText(HARDWARE);
  await drawer().getByRole('button', { name: '关闭' }).first().click();
});

test('没筛选、在办的都没了：写「没有在办的任务」并给「显示已交付」', async () => {
  // 只给已交付的任务（这批测试的数据里不一定有，就拿一条真任务改成已交付）
  const all = await apiTasks();
  const real = all.filter((t) => t.group === 'delivered');
  const delivered = real.length > 0 ? real : [{ ...all[0]!, group: 'delivered' as const }];
  await page.route('**/api/operator/tasks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delivered) }),
  );
  try {
    await page.goto('/operator/tasks');
    await expect(page.getByText('没有在办的任务')).toBeVisible();
    await page.getByRole('button', { name: '显示已交付' }).first().click();
    await expect(rows()).toHaveCount(delivered.length);
  } finally {
    await page.unroute('**/api/operator/tasks');
  }
});

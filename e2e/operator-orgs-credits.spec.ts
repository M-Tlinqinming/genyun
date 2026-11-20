import { expect, request, test, type Page } from '@playwright/test';

// K16 客户组织与次数：开通时登记次数 → 列表剩余次数 → 详情两张卡片 → 调整次数 → 次数记录 → 登记续约 → 赠送活动统计。
// 文件名排在 operator-organizations.spec 后面，免得多出来的组织弄坏那边的数量断言
test.describe.configure({ mode: 'serial' });

const ORG = '惠东安和安全咨询有限公司';
const CAMPAIGN = '秋季回馈活动';
const stamp = Date.now();
const EMAIL = `chen-${stamp}@huidong-anhe.cn`;

let page: Page;

test.beforeAll(async ({ browser }) => {
  // 用接口登记、开通（不传合同原件）：合同购买 5 次、赠送 2 次，合同到今年年底
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'ops@demo.genyun.net.cn', password: 'e2e-password' } });
  const org = await api.post('/api/operator/organizations', {
    data: {
      name: ORG,
      region: { province: '广东省', city: '惠州市', district: '惠东县' },
      socialCreditCode: '91441323MA5XXXXXX8',
      contactName: '陈经理',
      contactPhone: '139 2266 7781',
      contactEmail: EMAIL,
      note: '',
    },
  });
  expect(org.ok()).toBe(true);
  const { id } = await org.json();
  const opened = await api.post(`/api/operator/organizations/${id}/open`, {
    data: {
      contractNumber: 'GY-HT-2026-161',
      purchasedCredits: 5,
      giftCredits: 2,
      giftCampaign: CAMPAIGN,
      startsAt: '2026-01-01',
      endsAt: '2026-12-31',
      paymentReceived: true,
      adminName: '陈经理',
      adminPhone: '139 2266 7781',
      adminEmail: EMAIL,
    },
  });
  expect(opened.ok()).toBe(true);
  await api.dispose();

  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

const card = (name: string) => page.getByRole('region', { name, exact: true });
const option = (title: string) => page.locator(`.ant-select-dropdown:visible .ant-select-item-option[title="${title}"]`);

test('列表：剩余次数列显示「N 次 / 共 M 次」', async () => {
  await page.getByRole('menuitem', { name: /客户组织/ }).click();
  await page.getByPlaceholder('组织名称 / 联系人 / 手机号').fill('惠东安和');
  const row = page.getByRole('row').filter({ hasText: ORG });
  await expect(row).toContainText('7 次共 7 次');
  await expect(row).toContainText('广东省惠州市');
  await row.getByRole('link', { name: `查看${ORG}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: ORG })).toBeVisible();
});

test('详情：年度服务和编制次数两张卡片', async () => {
  await expect(card('年度服务')).toContainText('2026.01.01 – 2026.12.31');
  await expect(card('编制次数')).toContainText('剩余 7 次');
  await expect(card('编制次数')).toContainText('剩余里：赠送 2 次，购买 5 次 · 共 7 次，已用 0 次');
  await expect(card('编制次数')).toContainText('交付才算 1 次 · 先扣赠送再扣购买');
  await page.screenshot({ path: 'out/k16-detail-overview.png', fullPage: true });
});

test('调整次数：预览、减超时先拦、加赠送成功', async () => {
  await card('编制次数').getByRole('button', { name: '调整次数' }).click();
  const dialog = page.getByRole('dialog', { name: /^调整次数/ });
  await expect(dialog).toContainText(`${ORG} · 现在剩余 7 次（赠送 2 次，购买 5 次）`);
  const confirm = dialog.getByRole('button', { name: '确认调整' });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /加购次数/ })).toHaveAttribute('aria-checked', 'true');

  // 加购 3 次的预览
  await dialog.getByLabel('加还是减、几次').fill('3');
  await expect(dialog).toContainText('确认后：剩余 7 次 → 10 次（购买 5 次 → 8 次）');
  await expect(dialog).toContainText('马上生效，加的次数跟合同一起到期（2026.12.31）');
  await page.screenshot({ path: 'out/k16-adjust-increase.png' });

  // 减 10 次超过购买余额：先拦下
  await dialog.getByRole('combobox', { name: '加还是减' }).click();
  await option('减少').click();
  await dialog.getByLabel('加还是减、几次').fill('10');
  await expect(dialog.getByRole('alert')).toHaveText('这份合同的购买次数只剩 5 次，最多减 5 次');
  await dialog.getByLabel('原因').fill('核对合同');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('加还是减、几次').fill('2');
  await expect(dialog).toContainText('确认后：剩余 7 次 → 5 次（购买 5 次 → 3 次）');
  await expect(dialog).toContainText('马上生效，不会影响已经交付、已经放开的成果。');
  await page.screenshot({ path: 'out/k16-adjust-decrease.png' });

  // 改成耕云赠送加 3 次，写活动名称
  await dialog.getByRole('combobox', { name: '加还是减' }).click();
  await option('增加').click();
  await dialog.getByRole('radio', { name: /耕云赠送/ }).click();
  await dialog.getByLabel('加还是减、几次').fill('3');
  await dialog.getByLabel('活动名称（赠送时填）').fill(CAMPAIGN);
  await dialog.getByLabel('原因').fill('秋季活动加送');
  await expect(dialog).toContainText('确认后：剩余 7 次 → 10 次（赠送 2 次 → 5 次）');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('已调整')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(card('编制次数')).toContainText('剩余 10 次');
  await expect(card('编制次数')).toContainText('剩余里：赠送 5 次，购买 5 次 · 共 10 次，已用 0 次');
});

test('次数记录：多了一行赠送，按类型筛选', async () => {
  await card('编制次数').getByRole('button', { name: '次数记录' }).click();
  const dialog = page.getByRole('dialog', { name: /^次数记录/ });
  await expect(dialog.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  // 开通时的合同购买、赠送各一行，加上刚才的赠送
  await expect(dialog.getByRole('row')).toHaveCount(4);
  await dialog.getByRole('tab', { name: /耕云赠送/ }).click();
  const rows = dialog.getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: '秋季活动加送' })).toContainText(`活动：${CAMPAIGN}`);
  await expect(rows.filter({ hasText: '秋季活动加送' })).toContainText('+ 3');
  await page.screenshot({ path: 'out/k16-records.png' });
  await dialog.getByRole('button', { name: '关闭' }).first().click();
  await expect(dialog).toBeHidden();
});

test('登记续约：默认接着现在的合同，成功后年度服务的到期日变了', async () => {
  await card('年度服务').getByRole('button', { name: '登记续约' }).click();
  const dialog = page.getByRole('dialog', { name: /^登记续约/ });
  await expect(dialog).toContainText(`${ORG} · 现在的合同到 2026.12.31`);
  await expect(page.getByPlaceholder('开始日')).toHaveValue('2027.01.01');
  await expect(page.getByPlaceholder('到期日')).toHaveValue('2027.12.31');
  await expect(dialog).toContainText('新合同要接着现在的合同，到期日要晚于 2026.12.31。');
  const submit = dialog.getByRole('button', { name: '登记续约' });
  await expect(submit).toBeDisabled();
  await expect(dialog).toContainText('还差：合同编号、合同购买次数、合同款已到账');
  await dialog.getByLabel('合同编号').fill('GY-HT-2027-161');
  await dialog.getByLabel('合同购买次数').fill('20');
  await dialog.getByLabel('合同款已到账').check();
  await page.screenshot({ path: 'out/k16-renewal.png' });
  await submit.click();
  await expect(page.getByText('续约已登记')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(card('年度服务')).toContainText('2026.01.01 – 2027.12.31');
  await expect(card('操作记录')).toContainText('登记续约，合同到 2027.12.31');

  await page.getByRole('tab', { name: '年度服务' }).click();
  await expect(card('合同 GY-HT-2027-161')).toContainText('未开始');
  await expect(card('合同 GY-HT-2027-161')).toContainText('合同原件没有上传');
  await expect(card('合同 GY-HT-2026-161')).toContainText('生效中');
  await page.screenshot({ path: 'out/k16-detail-service.png', fullPage: true });
});

test('赠送活动统计：看到这次的活动，点「次数记录」回到这家组织', async () => {
  await page.goto('/operator/organizations');
  await page.getByRole('link', { name: '赠送活动统计' }).click();
  await expect(page.getByRole('heading', { name: '赠送活动统计' })).toBeVisible();
  const section = page.getByRole('region', { name: '赠送活动' });
  await expect(section).toContainText(CAMPAIGN);
  await expect(section).toContainText('没写活动名称的赠送');
  await expect(section.getByRole('combobox', { name: '年份' })).toBeVisible();
  await page.screenshot({ path: 'out/k16-gift-campaigns.png', fullPage: true });
  await section.getByRole('link', { name: `${ORG}的次数记录` }).click();
  await expect(page).toHaveURL(/\/operator\/organizations\/[^/]+\?records=1$/);
  await expect(page.getByRole('dialog', { name: /^次数记录/ })).toBeVisible();
});

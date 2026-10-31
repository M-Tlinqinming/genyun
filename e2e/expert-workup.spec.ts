import { expect, request, test, type Page } from '@playwright/test';

// 演示数据：飞宇任务分派给周工；飞宇自填资料里故意没填技术人员数
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
}

async function openFeiyu(page: Page) {
  await login(page, 'expert@demo.genyun.net.cn');
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
}

const row = (page: Page, key: string) => page.locator(`[data-fact="${key}"]`);

test.beforeAll(async () => {
  // 客户提交后补传一份待补资料（应急物资台账），专家在原件对照里能看到
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } });
  const me = await (await api.get('/api/auth/me')).json();
  const orgId = me.memberships[0].orgId as string;
  const tasks = (await (await api.get(`/api/orgs/${orgId}/tasks`)).json()) as { id: string; enterpriseName: string }[];
  const task = tasks.find((t) => t.enterpriseName === '惠阳飞宇电器有限公司')!;
  const file = await api.post(`/api/orgs/${orgId}/files`, {
    multipart: { file: { name: '应急物资台账.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% 应急物资台账\n') } },
  });
  expect(file.ok()).toBe(true);
  const { id: fileId } = await file.json();
  const linked = await api.post(`/api/tasks/${task.id}/checklist/emergency_supplies/files`, { data: { fileId } });
  expect(linked.ok()).toBe(true);
  await api.dispose();
});

test('周工对照原件补齐企业事实，退出再进内容还在', async ({ page }) => {
  await openFeiyu(page);

  // 来源标签：执照识别带出的、按规则带出的、知识库调取的
  await expect(row(page, 'socialCreditCode')).toContainText('91441300726483224B');
  await expect(row(page, 'socialCreditCode')).toContainText('客户原件 · 营业执照');
  await expect(row(page, 'contactPerson')).toContainText('系统推导 · 当前账号');
  await expect(row(page, 'agency.emergencyBureau')).toContainText('仲恺高新区应急管理局');

  // 只缺技术人员数：生产设备与物料的 6 项判断（含新增的乙炔）由 expert-workup-production 判定完，适用范围的 2 个开关由 expert-workup-scope 确认完，
  // 两张图由 expert-workup-visuals 采用
  await expect(page.getByText('整理中 · 必需项 22 / 23')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 1 项：技术人员数');

  // 原件对照：客户补传的台账（expert-workup-visuals-drawings 还补传了一份消防设施布置图，切到台账）
  const originals = page.getByRole('complementary', { name: '原件对照' });
  await originals.getByRole('tab', { name: /应急物资台账/ }).click();
  await expect(originals.getByRole('tab', { name: /应急物资台账/ })).toHaveAttribute('aria-selected', 'true');
  await expect(originals.locator('iframe')).toHaveAttribute('src', /d=inline/);

  // 下一个缺失项 → 直接填写，记下对照的原件
  await page.getByRole('button', { name: '下一个缺失项' }).click();
  const missing = row(page, 'technicalManagementCount');
  await expect(missing).toContainText('用于企业概况章节');
  await missing.getByRole('button', { name: '直接填写' }).click();
  await expect(missing).toContainText(/对照原件：应急物资台账/);
  await missing.getByLabel('技术人员数').fill('8');
  await missing.getByRole('button', { name: /保\s*存/ }).click();

  await expect(missing).toContainText('8 人');
  await expect(missing).toContainText('专家整理');
  await expect(page.getByText('整理中 · 必需项 23 / 23')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('专业整理的必需项已齐');
  await expect(page.getByRole('status')).toContainText(/已自动保存 \d\d:\d\d/);

  // 改已有的值：值班电话
  await row(page, 'dutyPhone').hover();
  await row(page, 'dutyPhone').getByRole('button', { name: '修改值班电话' }).click();
  await row(page, 'dutyPhone').getByLabel('值班电话').fill('0752-3324000');
  await row(page, 'dutyPhone').getByLabel('值班电话').press('Enter');
  await expect(row(page, 'dutyPhone')).toContainText('0752-3324000');

  // 退出再进
  await page.getByRole('link', { name: '任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(row(page, 'technicalManagementCount')).toContainText('8 人');
  await expect(row(page, 'dutyPhone')).toContainText('0752-3324000');
  await expect(row(page, 'dutyPhone')).toContainText('专家整理');
});

test('只看缺失项、跳到小节、编制小组不能改', async ({ page }) => {
  await openFeiyu(page);
  await page.getByRole('navigation', { name: '整理模块' }).getByRole('button', { name: /专家判断/ }).click();
  await expect(row(page, 'shortName')).toBeInViewport();

  await expect(row(page, 'compilation.leader')).toContainText('李文聪 · 计划、评审、签署颁布');
  await row(page, 'compilation.leader').hover();
  await expect(row(page, 'compilation.leader').getByRole('button')).toHaveCount(0);

  await page.getByRole('switch', { name: '只看缺失项' }).click();
  await expect(row(page, 'companyName')).toHaveCount(0);
  // 企业简称已在 expert-workup-contact 里采用，用一直空着的成立日期
  await expect(row(page, 'establishedDate')).toBeVisible();
});

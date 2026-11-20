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
  // 默认打开资料核对向导；这几块还在原来的整理页
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=workup-old`);
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
  // 工艺流程图由 expert-workup-visuals 采用（组织体系图随资料生成，不用采用）
  await expect(page.getByText('整理中 · 必需项 21 / 22')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 1 项：技术人员数');

  // 原件对照：客户补传的台账（expert-workup-visuals-drawings 还补传了一份消防设施布置图，切到台账）
  const originals = page.getByRole('complementary', { name: '原件对照' });
  await originals.getByRole('tab', { name: /应急物资台账/ }).click();
  await expect(originals.getByRole('tab', { name: /应急物资台账/ })).toHaveAttribute('aria-selected', 'true');
  await expect(originals.locator('iframe')).toHaveAttribute('src', /d=inline/);

  // 下一个缺失项：企业基本信息里的缺项回到资料核对第 1 步填
  await page.getByRole('button', { name: '下一个缺失项' }).click();
  await expect(page).toHaveURL(/view=workup&step=1/);
  await expect(page.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  const basicSaved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/workup/steps/basic') && r.ok());
  await page.getByLabel('技术管理人员').fill('8');
  await basicSaved;

  // 第 2 步改已有的值：值班电话
  await page.getByRole('button', { name: '下一步：人员与应急组织' }).click();
  await expect(page.getByRole('heading', { name: '核对应急指挥部和各小组' })).toBeVisible();
  const orgSaved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/workup/steps/organization') && r.ok());
  await page.getByRole('textbox', { name: '24 小时值班电话' }).fill('0752-3324000');
  await orgSaved;
  await expect(page.getByRole('status')).toContainText(/已自动保存 \d\d:\d\d/);

  // 退出再进：原来的整理页也看得到这两项
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=workup-old`);
  await expect(row(page, 'technicalManagementCount')).toContainText('8 人');
  await expect(row(page, 'dutyPhone')).toContainText('0752-3324000');
  await expect(page.getByText('整理中 · 必需项 22 / 22')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('资料核对的必需项已齐');
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

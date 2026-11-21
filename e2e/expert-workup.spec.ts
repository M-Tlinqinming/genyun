import { expect, request, test, type Page } from '@playwright/test';

// 演示数据：飞宇任务分派给周工；飞宇自填资料里故意没填技术人员数
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
}

// 打开第 5 步第 2 页「核对并生成」
async function openFeiyu(page: Page) {
  await login(page, 'expert@demo.genyun.net.cn');
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=5&page=2`);
}

const summary = (page: Page) => page.getByRole('region', { name: '四步摘要' });

test.beforeAll(async () => {
  // 客户提交后补传一份待补资料（应急物资台账）
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

test('周工从「下一个缺失项」回第 1 步补齐技术人员数，退出再进可以生成', async ({ page }) => {
  await openFeiyu(page);

  // 只缺技术人员数：生产设备与物料的判断（含新增的乙炔）由 expert-workup-production 在第 3、4 步判定完，适用范围由 expert-workup-scope 确认完
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('还差 1 项必填资料，暂时不能生成');
  await expect(summary(page).locator('[data-step="1"]')).toContainText('还缺：技术人员数');
  await expect(page.getByRole('region', { name: '专业项' })).toContainText('适用范围');
  await expect(page.getByRole('button', { name: '确认资料并生成初稿' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-page2-blocked.png', fullPage: true });

  // 下一个缺失项：回资料核对第 1 步填
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

  // 退出再进：两项都在，第 5 步第 2 页可以生成
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=1`);
  await expect(page.getByLabel('技术管理人员')).toHaveValue('8');
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=5&page=2`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('核对无误，就可以生成初稿');
  await expect(summary(page).locator('[data-step="1"]')).not.toContainText('还缺：');
  await expect(page.getByRole('region', { name: '页面操作' })).toContainText('第 5 步，共 5 步（第 2 页）· 必填资料已齐');
  await expect(page.getByRole('button', { name: '确认资料并生成初稿' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/acceptance/k11-step5-page2-ready.png', fullPage: true });

  // 上一页回专业项
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
  await expect(page.getByRole('region', { name: '页面操作' })).toContainText('第 5 步，共 5 步（第 1 页）');
});

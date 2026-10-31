import { expect, request, test, type Page } from '@playwright/test';
import { LANDSCAPE, PORTRAIT, testPdf } from '../apps/api/src/generation/drawings/test-pdf';

// 图件 · 客户图纸（M2 第 10c 项）：客户补传的多页 PDF 消防设施布置图，专家勾选放进附件 7 的页。
// 演示数据里总平面图、疏散图已随申请提交（样例文件没有实物），消防设施布置图是「以后补」，客户还能补传。
// 文件名排在 expert-workup-visuals 之前（「-」排在「.」前面）；不影响必需项。
// generation.spec 生成时附件 7 用这里选的页
async function customerUploadsFirePlan() {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } });
  const me = await (await api.get('/api/auth/me')).json();
  const orgId = me.memberships[0].orgId as string;
  const tasks = (await (await api.get(`/api/orgs/${orgId}/tasks`)).json()) as { id: string; enterpriseName: string }[];
  const task = tasks.find((t) => t.enterpriseName === '惠阳飞宇电器有限公司')!;
  // 第 1 页是设计说明一类的竖页，第 2、3 页是图
  const file = await api.post(`/api/orgs/${orgId}/files`, {
    multipart: { file: { name: '消防设施布置图.pdf', mimeType: 'application/pdf', buffer: testPdf([PORTRAIT, LANDSCAPE, LANDSCAPE]) } },
  });
  expect(file.ok()).toBe(true);
  const { id: fileId } = await file.json();
  const linked = await api.post(`/api/tasks/${task.id}/checklist/fire_facility_plan/files`, { data: { fileId } });
  expect(linked.ok(), await linked.text()).toBe(true);
  await api.dispose();
}

async function openFigures(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  await page.getByRole('button', { name: /^图件/ }).click();
  await expect(page.getByRole('region', { name: '图件' })).toBeVisible();
}

const card = (page: Page) => page.getByRole('article', { name: '客户图纸' });
const plan = (page: Page) => card(page).getByRole('region', { name: '消防设施布置图.pdf' });
const thumb = (page: Page, n: number) => plan(page).getByRole('img', { name: `第 ${n} 页`, exact: true });

test('多页消防设施布置图：默认第 1 页；专家改成第 2、3 页，退出再进还在', async ({ page }) => {
  await customerUploadsFirePlan();
  await openFigures(page);

  await expect(plan(page)).toContainText('消防设施布置图');
  await expect(plan(page)).toContainText('共 3 页 · 已选 1 页（默认）');
  await expect(card(page)).toContainText('总平面布置图、紧急疏散示意图：客户没有上传');
  // 三页缩略图都转出来了
  for (const n of [1, 2, 3]) {
    await expect(thumb(page, n)).toHaveJSProperty('complete', true, { timeout: 60_000 });
    expect(await thumb(page, n).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByText('转换中…')).toHaveCount(0);

  // 放大看第 2 页
  await plan(page).getByRole('button', { name: '放大第 2 页' }).click();
  const zoomed = page.getByRole('dialog').getByRole('img', { name: '消防设施布置图.pdf第 2 页' });
  await expect(zoomed).toHaveJSProperty('complete', true, { timeout: 60_000 });
  await page.keyboard.press('Escape');

  await plan(page).getByRole('checkbox', { name: '第 2 页' }).check();
  await expect(plan(page)).toContainText('已选 2 页');
  await plan(page).getByRole('checkbox', { name: '第 3 页' }).check();
  await plan(page).getByRole('checkbox', { name: '第 1 页' }).uncheck();
  await expect(plan(page)).toContainText('共 3 页 · 已选 2 页');
  await expect(plan(page)).not.toContainText('（默认）');
  await page.waitForTimeout(300);
  // 与 Paper 实现对照用
  await card(page).screenshot({ path: 'test-results/acceptance/m2-10c-客户图纸.png' });

  // 全不选会提示；再选回来
  await plan(page).getByRole('button', { name: '全不选' }).click();
  await expect(plan(page)).toContainText('这份图纸一页都不放进附件 7');
  await plan(page).getByRole('checkbox', { name: '第 2 页' }).check();
  await plan(page).getByRole('checkbox', { name: '第 3 页' }).check();

  await page.reload();
  await page.getByRole('button', { name: /^图件/ }).click();
  await expect(plan(page)).toContainText('共 3 页 · 已选 2 页');
  await expect(plan(page).getByRole('checkbox', { name: '第 1 页' })).not.toBeChecked();
  await expect(plan(page).getByRole('checkbox', { name: '第 3 页' })).toBeChecked();
});

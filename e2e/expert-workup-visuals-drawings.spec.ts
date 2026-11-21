import { expect, request, test, type Page } from '@playwright/test';
import { LANDSCAPE, PORTRAIT, testPdf } from '../apps/api/src/generation/drawings/test-pdf';

// 客户图纸选页（M2 第 10c 项，K11 搬到资料核对第 4 步）：客户补传的多页 PDF 消防设施布置图，专家勾选放进附件 7 的页。
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

async function openDrawings(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  // 图纸选页在资料核对第 4 步的「厂区图纸」卡里
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=4`);
  await expect(page.getByRole('heading', { name: '核对应急资源与图纸' })).toBeVisible();
}

const tile = (page: Page) => page.getByRole('group', { name: '消防设施布置图' });
const dialog = (page: Page) => page.getByRole('dialog', { name: '消防设施布置图.pdf · 选页' });
const pages = (page: Page) => dialog(page).getByRole('list', { name: '消防设施布置图.pdf的页' });
const thumb = (page: Page, n: number) => pages(page).getByRole('img', { name: `第 ${n} 页`, exact: true });

test('多页消防设施布置图：默认第 1 页；专家在第 4 步选页改成第 2、3 页，退出再进还在', async ({ page }) => {
  await customerUploadsFirePlan();
  await openDrawings(page);

  // 第一次读页数要先起转换线程（本机忙时 3–6 秒），放宽等待
  await expect(tile(page)).toContainText('消防设施布置图.pdf');
  await expect(tile(page)).toContainText('共 3 页 · 放进附件 1 页', { timeout: 30_000 });
  await tile(page).getByRole('button', { name: '选页' }).click();
  // 三页缩略图都转出来了
  for (const n of [1, 2, 3]) {
    await expect(thumb(page, n)).toHaveJSProperty('complete', true, { timeout: 60_000 });
    expect(await thumb(page, n).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(dialog(page).getByText('转换中…')).toHaveCount(0);

  // 放大看第 2 页
  await dialog(page).getByRole('button', { name: '放大第 2 页' }).click();
  const zoomed = page.getByRole('dialog', { name: '消防设施布置图.pdf · 第 2 页' }).getByRole('img', { name: '消防设施布置图.pdf第 2 页' });
  await expect(zoomed).toHaveJSProperty('complete', true, { timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '消防设施布置图.pdf · 第 2 页' })).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();

  // 全不选会提示；再选第 2、3 页
  await dialog(page).getByRole('button', { name: '全不选' }).click();
  await expect(dialog(page)).toContainText('一页都不放进附件 7');
  await dialog(page).getByRole('checkbox', { name: '第 2 页' }).check();
  await dialog(page).getByRole('checkbox', { name: '第 3 页' }).check();
  await expect(dialog(page)).toContainText('放进附件 7 共 2 页');
  await dialog(page).screenshot({ path: 'test-results/acceptance/k11-drawing-pages.png' });
  await dialog(page).getByRole('button', { name: '保存' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(tile(page)).toContainText('共 3 页 · 放进附件 2 页');

  await page.reload();
  await expect(tile(page)).toContainText('共 3 页 · 放进附件 2 页', { timeout: 30_000 });
  await tile(page).getByRole('button', { name: '选页' }).click();
  await expect(dialog(page).getByRole('checkbox', { name: '第 1 页' })).not.toBeChecked();
  await expect(dialog(page).getByRole('checkbox', { name: '第 3 页' })).toBeChecked();
});

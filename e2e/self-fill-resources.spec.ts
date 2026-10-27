import { expect, test, type Page } from '@playwright/test';

// 第 8 项：企业自填第 4 步（应急物资、急救药箱、消防水池、厂区建筑、MSDS、图纸、相邻企业）。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业、前几步内容和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PDF = Buffer.from('%PDF-1.7\n% MSDS\n');

let page: Page;
let taskId: string;
let enterpriseId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);

  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  const orgId = me.memberships[0]!.orgId;
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州飞宇资源测试有限公司' } });
  enterpriseId = ((await ent.json()) as { id: string }).id;

  // 第 2 步填了总指挥（选保管人用），第 3 步勾了场所、填了物料
  const org = (await (await page.request.get(`/api/enterprises/${enterpriseId}/organization-step`)).json()) as {
    version: number;
    step: object;
  };
  const commander = { id: 'p-zhao', name: '赵建国', phone: '13500007786' };
  const saved = await page.request.put(`/api/enterprises/${enterpriseId}/organization-step`, {
    data: { version: org.version, step: { ...org.step, commander } },
  });
  const version = ((await saved.json()) as { version: number }).version;
  const prod = (await (await page.request.get(`/api/enterprises/${enterpriseId}/production-step`)).json()) as {
    step: object;
  };
  await page.request.put(`/api/enterprises/${enterpriseId}/production-step`, {
    data: {
      version,
      step: {
        ...prod.step,
        sites: ['workshop', 'warehouse', 'power_room', 'dormitory'],
        materials: [
          { id: 'm1', name: '油漆', labelPhotoFileIds: [] },
          { id: 'm2', kind: 'cylinder', name: '氧气', labelPhotoFileIds: [] },
          { id: 'm3', name: '钢板', labelPhotoFileIds: [] },
        ],
      },
    },
  });

  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
});

test.afterAll(async () => {
  await page.close();
});

async function itemStatus(key: string) {
  const res = await page.request.get(`/api/tasks/${taskId}/checklist`);
  const body = (await res.json()) as { items: Record<string, { status: string; fileIds: string[] } | undefined> };
  return body.items[key]?.status;
}

const answer = (question: string, label: string) =>
  page.getByRole('radiogroup', { name: question }).getByText(label, { exact: true }).click();

test('第 4 步：常见物资已勾上，配电房相关的排在前面，建筑按场所列出', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/4`);
  await expect(page.getByRole('heading', { name: '出了事，手边有什么可以用' })).toBeVisible();
  await expect(page.getByTestId('supply-row')).toHaveCount(4);
  for (const name of ['二氧化碳灭火器', '绝缘手套', '绝缘靴']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '展开其余 11 项' })).toBeVisible();
  await expect(page.getByLabel('第 1 栋建筑名称')).toHaveValue('生产车间');
  await expect(page.getByLabel('第 3 栋建筑名称')).toHaveValue('员工宿舍');
  await expect(page.getByText('缺总平面图、疏散图')).toBeVisible();
});

test('填灭火器数量即「应急物资及装备」已提供；加一项物资，选统一保管人', async () => {
  expect(await itemStatus('emergency_supplies')).toBeUndefined();
  await page.getByLabel('手提式干粉灭火器数量').fill('50');
  await page.getByLabel('手提式干粉灭火器位置').fill('厂区各处');
  await expect.poll(() => itemStatus('emergency_supplies')).toBe('provided');

  await page.getByRole('button', { name: '二氧化碳灭火器', exact: true }).click();
  await expect(page.getByTestId('supply-row')).toHaveCount(5);
  await page.getByLabel('二氧化碳灭火器数量').fill('4');
  await page.getByLabel('取消勾选应急照明灯').click();
  await expect(page.getByTestId('supply-row')).toHaveCount(4);

  await page.getByLabel('统一保管人').click();
  await page.getByText('赵建国 · 13500007786').click();
  await expect(page.getByText('已勾 4 项物资')).toBeVisible();
});

test('急救药箱按常规配置、消防水池容积稍后补，两项都为已提供', async () => {
  await answer('厂里有急救药箱吗？', '有');
  await expect(page.getByText(/纱布绷带 2 卷 · 医用棉签 2 包/)).toBeVisible();
  await expect.poll(() => itemStatus('first_aid_kit')).toBe('provided');

  await answer('有消防水池吗？', '有');
  await page.getByTestId('fire-pool').getByRole('spinbutton').first().fill('1');
  await page.getByTestId('fire-pool').getByRole('button', { name: '稍后补' }).click();
  await expect.poll(() => itemStatus('fire_pool')).toBe('provided');
});

test('建筑填面积后合计并回填第 1 步，「建（构）筑物一览」为已提供', async () => {
  await page.getByLabel('第 1 栋建筑层数').fill('3');
  await page.getByLabel('第 1 栋建筑面积').fill('20079.92');
  await page.getByLabel('第 2 栋建筑面积').fill('1864.05');
  await page.getByLabel('第 2 栋建筑名称').click();
  await expect(page.getByTestId('building-total')).toContainText('合计 21943.97 m²');
  await expect.poll(() => itemStatus('buildings')).toBe('provided');
  const basic = (await (await page.request.get(`/api/enterprises/${enterpriseId}/basic-step`)).json()) as {
    totalBuildingAreaM2: number;
  };
  expect(basic.totalBuildingAreaM2).toBe(21943.97);
});

test('MSDS 按第 3 步物料列出：油漆向供应商要并上传，氧气由耕云补全', async () => {
  const rows = page.getByTestId('msds-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('混合物 · 需供应商提供');
  await expect(rows.nth(1)).toContainText('纯物质 · 耕云资料库补全，无需上传');
  await expect(rows.nth(2)).toContainText('一般原料 · 不需要');
  await rows.nth(0).locator('input[type=file]').setInputFiles({ name: '油漆MSDS.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('油漆MSDS.pdf')).toBeVisible();
  await expect.poll(() => itemStatus('msds')).toBe('provided');
});

test('图纸：总平面图、疏散图上传后为已提供；上传框接受图片，手机可直接拍照', async () => {
  const sitePlan = page.getByTestId('drawing-site_plan').locator('input[type=file]');
  await expect(sitePlan).toHaveAttribute('accept', /\.jpg/);
  await sitePlan.setInputFiles({ name: '总平面图.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('drawing-site_plan')).toContainText('总平面图.png');
  await page
    .getByTestId('drawing-evacuation_plan')
    .locator('input[type=file]')
    .setInputFiles([
      { name: '一楼疏散图.png', mimeType: 'image/png', buffer: PNG },
      { name: '二楼疏散图.png', mimeType: 'image/png', buffer: PNG },
    ]);
  await expect(page.getByTestId('drawing-evacuation_plan')).toContainText('二楼疏散图.png');
  await expect.poll(() => itemStatus('site_plan')).toBe('provided');
  await expect.poll(() => itemStatus('evacuation_plan')).toBe('provided');
  await expect(page.getByText(/缺.*图/)).toHaveCount(0);
  expect(await itemStatus('fire_facility_plan')).toBeUndefined();
});

test('相邻企业：选「没有相邻企业」即「外部应急队伍与资源」已提供', async () => {
  await page.getByRole('button', { name: '没有相邻企业' }).click();
  await expect.poll(() => itemStatus('external_resources')).toBe('provided');
  await expect(page.getByText('已自动保存')).toBeVisible();
});

test('填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(/\/customer\/enterprises\//);
  await page.goto(`/customer/tasks/${taskId}/fill/4`);
  await expect(page.getByLabel('手提式干粉灭火器数量')).toHaveValue('50');
  await expect(page.getByLabel('二氧化碳灭火器数量')).toHaveValue('4');
  await expect(page.getByText('赵建国 · 13500007786')).toBeVisible();
  await expect(page.getByLabel('第 1 栋建筑面积')).toHaveValue('20079.92');
  await expect(page.getByTestId('fire-pool').getByRole('button', { name: '已标稍后补' })).toBeVisible();
  await expect(page.getByText('油漆MSDS.pdf')).toBeVisible();
  await expect(page.getByTestId('drawing-site_plan')).toContainText('总平面图.png');
  await expect(page.getByRole('button', { name: '没有相邻企业' })).toHaveAttribute('aria-pressed', 'true');
});

test('第 1 步显示总建筑面积；上一步回到工艺流程，下一步进入核对', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/1`);
  await expect(page.getByLabel('总建筑面积')).toHaveValue('21943.97');
  await page.goto(`/customer/tasks/${taskId}/fill/4`);
  await page.getByRole('button', { name: '上一步' }).click();
  await expect(page).toHaveURL(new RegExp(`/fill/3\\?page=process$`));
  await page.goto(`/customer/tasks/${taskId}/fill/4`);
  await page.getByRole('button', { name: '下一步：核对并提交' }).click();
  await expect(page).toHaveURL(/\/fill\/5$/);
});

import { expect, test, type Page } from '@playwright/test';

// 第 11b 项：检查明细的专用卡片（12 页 P05C、P05D）：特种设备、相邻企业、包装标签与说明书、图纸、业务问题。
// 回答写进企业资料（与自填同一份），资料项状态由后台同步。只登录一次、共用同一个页面
test.describe.configure({ mode: 'serial' });

const png = { name: '标签.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex') };

let page: Page;
let orgId: string;
let taskId: string;
let enterpriseId: string;

async function newTask(name: string, startMethod: 'upload' | 'self_fill') {
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name } });
  const eid = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${eid}/tasks`, { data: { name: '2026 年应急预案编制' } });
  const id = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${id}`, { data: { startMethod } });
  return { id, enterpriseId: eid };
}

async function item(key: string) {
  const body = (await (await page.request.get(`/api/tasks/${taskId}/check`)).json()) as {
    items: Record<string, { status: string } | undefined>;
  };
  return body.items[key]?.status;
}

async function production() {
  return (await (await page.request.get(`/api/enterprises/${enterpriseId}/production-step`)).json()) as {
    saved: boolean;
    step: { sites: string[]; leasesPremises?: boolean; specialEquipment: Record<string, { answer?: string }> };
  };
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  orgId = me.memberships[0]!.orgId;
  ({ id: taskId, enterpriseId } = await newTask('惠州飞宇专用抽屉测试有限公司', 'upload'));
});

test.afterAll(async () => {
  await page.close();
});

const drawer = () => page.getByRole('dialog');
const closeDrawer = () => drawer().getByText('关闭', { exact: true }).click();

test('特种设备：上传路线在抽屉里逐项回答，写进企业资料，资料项与自填一样变为已提供', async () => {
  await page.goto(`/customer/tasks/${taskId}?view=check`);
  await page.getByRole('button', { name: '生产工艺与设备明细' }).click();
  const card = page.getByTestId('special-equipment');
  await expect(card).toContainText('还差 4 项回答');

  await card.getByRole('radiogroup', { name: /压力容器有没有/ }).getByText('有', { exact: true }).click();
  for (const name of [/锅炉.*有没有/, /压力管道.*有没有/, /储罐.*有没有/]) {
    await card.getByRole('radiogroup', { name }).getByText('没有', { exact: true }).click();
  }
  await expect(card).toContainText('都已回答');
  await card.getByRole('button', { name: '保存回答' }).click();

  await expect.poll(() => item('special_equipment')).toBe('provided');
  const p = await production();
  expect(p.step.specialEquipment.pressureVessels!.answer).toBe('yes');
  expect(p.step.specialEquipment.boilers!.answer).toBe('no');
  // 上传路线没填过第 3 步，自填页预选的场所不会被当成客户的回答保存
  expect(p.step.sites).toEqual([]);
  await expect(card).toContainText('已满足');
  await closeDrawer();
});

test('相邻企业：添加一家，「外部应急队伍与资源」已满足', async () => {
  await page.getByRole('button', { name: '应急组织与联系人明细' }).click();
  const card = page.getByTestId('neighbors');
  await card.getByLabel('相邻企业名称').fill('惠州宏达塑胶有限公司');
  await card.getByLabel('相邻企业联系方式').fill('门卫 0752-3300000');
  await card.getByRole('button', { name: '添加' }).click();
  await expect(card).toContainText('惠州宏达塑胶有限公司 · 门卫 0752-3300000');
  await expect.poll(() => item('external_resources')).toBe('provided');
  await closeDrawer();
});

test('业务问题：右栏回答是否出租厂房、道路运输，答完不再显示', async () => {
  const box = page.getByRole('region', { name: '业务问题' });
  await expect(box).toContainText('还需回答 2 个业务问题');
  await box.getByRole('button', { name: '是' }).first().click();
  await expect(box).toContainText('还需回答 1 个业务问题');
  await box.getByRole('button', { name: '否' }).click();
  await expect(box).toBeHidden();
  expect((await production()).step.leasesPremises).toBe(true);
});

test('图纸：必需的图纸说明怎么准备，实在没有可以预约上门绘制', async () => {
  await page.getByRole('button', { name: '厂区实际图纸明细' }).click();
  const evac = page.getByTestId('item-evacuation_plan');
  await expect(evac).toContainText('车间墙上张贴的疏散图拍照即可');
  await expect(evac.getByRole('button', { name: '稍后补（不影响提交）' })).toHaveCount(0);
  await evac.getByRole('button', { name: '预约耕云上门' }).click();
  await expect(page.getByText('请耕云专家上门')).toBeVisible();
});

test('包装标签：自填路线列出的物料逐行处理，拍了标签就记在企业资料里', async () => {
  const self = await newTask('惠州飞宇标签测试有限公司', 'self_fill');
  const prod = (await (await page.request.get(`/api/enterprises/${self.enterpriseId}/production-step`)).json()) as {
    version: number;
    step: object;
  };
  await page.request.put(`/api/enterprises/${self.enterpriseId}/production-step`, {
    data: {
      version: prod.version,
      step: {
        ...prod.step,
        materials: [
          { id: 'm1', name: '油漆', labelPhotoFileIds: [] },
          { id: 'm2', name: '氧气', labelPhotoFileIds: [] },
          { id: 'm3', name: '钢板', labelPhotoFileIds: [] },
        ],
      },
    },
  });

  await page.goto(`/customer/tasks/${self.id}`);
  await page.getByRole('button', { name: '原辅料与安全资料明细' }).click();
  const card = page.getByTestId('msds');
  await expect(card).toContainText('纯物质 · 耕云资料库补全，无需上传');
  await expect(card).toContainText('一般原料 · 不需要');
  await expect(card).toContainText('待拍包装标签');

  await card.getByRole('button', { name: '拍油漆包装标签' }).locator('..').locator('input[type=file]').setInputFiles(png);
  await expect(card).toContainText('✓ 标签已拍');
});

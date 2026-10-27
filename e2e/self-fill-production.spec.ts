import { expect, test, type Page } from '@playwright/test';

// 第 7a 项：企业自填第 3 步第 1 页（场所、特种设备、设备与原辅材料）。飞宇样例填完这一页。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const XLSX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('..[Content_Types].xml..xl/workbook.xml'),
]);

let page: Page;
let taskId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);

  const me = (await (await page.request.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  const orgId = me.memberships[0]!.orgId;
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠阳飞宇电器有限公司' } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  // 第 1 步已填经营范围（含喷涂，用于预选场所）
  await page.request.put(`/api/enterprises/${enterpriseId}/basic-step`, {
    data: {
      version: 1,
      identity: { name: '惠阳飞宇电器有限公司' },
      basic: { businessScope: '灯头、电线、电器开关、灯具的设计、制造、喷涂加工与销售' },
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
  return body.items[key];
}

const site = (name: string) => page.getByRole('button', { name, exact: true });
const special = (key: string) => page.getByTestId(`special-${key}`);

test('第 3 步预选常见场所和经营范围里的喷涂，可增减', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/3`);
  await expect(page.getByRole('heading', { name: '您的工厂里有哪些场所和东西' })).toBeVisible();
  await expect(page.getByText('已根据经营范围预选了「喷涂」，请确认。')).toBeVisible();
  for (const name of ['生产车间', '喷涂', '仓库', '配电房']) await expect(site(name)).toHaveAttribute('aria-pressed', 'true');
  await expect(site('空压机房')).toHaveAttribute('aria-pressed', 'false');

  await site('空压机房').click();
  await site('喷涂').click();
  await page.getByRole('button', { name: '+ 其他' }).click();
  await page.getByPlaceholder('场所名称，回车添加').fill('压铸车间');
  await page.keyboard.press('Enter');
  await expect(page.getByText('压铸车间', { exact: true })).toBeVisible();
  await expect(page.getByText('已选 5 个场所')).toBeVisible();
});

test('填设备：有名称和数量即「生产设备设施」已提供；填进空压机自动预选压力容器「有」', async () => {
  await page.getByLabel('第 1 台设备名称').fill('熔炉');
  await page.getByLabel('第 1 台设备使用部门或地点').fill('压铸车间');
  expect(await itemStatus('equipment')).toBeUndefined();
  await page.getByLabel('第 1 台设备数量').fill('4 台');
  await expect.poll(async () => (await itemStatus('equipment'))?.status).toBe('provided');

  await page.getByRole('button', { name: '+ 添加设备' }).click();
  await page.getByLabel('第 2 台设备名称').fill('空压机');
  await page.getByLabel('第 2 台设备数量').fill('1 台');
  await expect(special('pressureVessels').getByRole('radio', { name: '有', exact: true })).toBeChecked();
  await expect(page.getByText('设备表里有空压机，已预选「有」；只有空压机储气罐的可不填参数')).toBeVisible();
});

test('特种设备四类都答完，「特种设备与储存设施」才有结论；PV 值自动计算', async () => {
  await special('pressureVessels').getByRole('button', { name: /填写参数/ }).click();
  await special('pressureVessels').getByPlaceholder('如压缩空气').fill('压缩空气');
  const [pressure, volume] = await special('pressureVessels').locator('input[role=spinbutton]').all();
  await pressure!.fill('0.84');
  await volume!.fill('1.25');
  await expect(page.getByTestId('pv-value')).toContainText('1.05');

  await special('boilers').getByText('没有', { exact: true }).click();
  await special('pressurePipelines').getByText('没有', { exact: true }).click();
  expect(await itemStatus('special_equipment')).toBeUndefined();
  await special('storageTanks').getByText('没有', { exact: true }).click();
  await expect.poll(async () => (await itemStatus('special_equipment'))?.status).toBe('provided');
  await expect(page.getByText('1 类特种设备')).toBeVisible();
});

test('填原辅材料：氧气由耕云补全，酒精要拍包装标签', async () => {
  await page.getByLabel('第 1 种物料名称').fill('锌锭');
  await page.getByLabel('第 1 种物料年用量').fill('8 t');
  await expect(page.getByText('一般原料 · 不需要')).toBeVisible();
  await page.getByLabel('第 1 种物料最大存放量').fill('0.3 t');
  await expect.poll(async () => (await itemStatus('materials'))?.status).toBe('provided');

  await page.getByRole('button', { name: '+ 添加气瓶' }).click();
  await page.getByLabel('第 2 种物料名称').fill('氧气');
  await page.getByLabel('第 2 种物料气瓶规格').fill('40L');
  await expect(page.getByText('纯物质 · 耕云补全')).toBeVisible();

  await page.getByRole('button', { name: '+ 添加物料' }).click();
  await page.getByLabel('第 3 种物料名称').fill('酒精');
  await page.getByLabel('第 3 种物料最大存放量').fill('0.05 t');
  await expect(page.getByText('1 张包装标签待拍')).toBeVisible();
  await page
    .getByTestId('material-row')
    .nth(2)
    .locator('input[type=file]')
    .setInputFiles({ name: '酒精标签.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('已拍包装标签')).toBeVisible();
  await expect(page.getByText('包装标签待拍')).toHaveCount(0);
});

test('回答最后两个问题', async () => {
  for (const q of ['有没有把厂房出租给其他企业？', '有自己的车辆运输货物吗？']) {
    await page.getByRole('radiogroup', { name: q }).getByText('否', { exact: true }).click();
  }
  await expect(page.getByText('已自动保存')).toBeVisible();
});

test('上传设备台账：挂到「生产设备设施」上，可以移除', async () => {
  await page.getByRole('button', { name: '上传台账' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '设备台账' }).click();
  await (await chooser).setFiles({ name: '设备台账.xlsx', mimeType: 'application/octet-stream', buffer: XLSX });
  await expect(page.getByText('设备台账.xlsx')).toBeVisible();
  await expect.poll(async () => (await itemStatus('equipment'))?.fileIds.length).toBe(1);
});

test('填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(/\/customer\/enterprises\//);
  await page.goto(`/customer/tasks/${taskId}/fill/3`);
  await expect(page.getByLabel('第 2 台设备名称')).toHaveValue('空压机');
  await expect(page.getByLabel('第 2 种物料气瓶规格')).toHaveValue('40L');
  await expect(page.getByText('压铸车间', { exact: true })).toBeVisible();
  await expect(special('storageTanks').getByRole('radio', { name: '没有' })).toBeChecked();
  await expect(page.getByText('已拍包装标签')).toBeVisible();
  await expect(page.getByText('设备台账.xlsx')).toBeVisible();
  await expect(page.getByTestId('pv-value')).toContainText('1.05');
});

test('下一页进入工艺流程，上一页回到这里', async () => {
  await page.getByRole('button', { name: '下一页：工艺流程' }).click();
  await expect(page).toHaveURL(new RegExp(`/fill/3\\?page=process$`));
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByRole('heading', { name: '您的工厂里有哪些场所和东西' })).toBeVisible();
});

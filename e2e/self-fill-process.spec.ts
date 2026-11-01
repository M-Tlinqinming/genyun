import { expect, test, type Page } from '@playwright/test';

// 第 7b 项：企业自填第 3 步第 2 页（工艺流程）。选模板后改工序，流程图跟着变，「生产工艺流程」变为已提供。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

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
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州锂源电池有限公司' } });
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  await page.request.put(`/api/enterprises/${enterpriseId}/basic-step`, {
    data: {
      version: 1,
      identity: { name: '惠州锂源电池有限公司' },
      basic: { businessScope: '锂离子电池组装、电池组件销售' },
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

const template = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const stepChips = () => page.getByTestId('process-step');
const chartRows = () => page.getByTestId('process-chart-row');

test('打开工艺流程页：按经营范围推荐锂电池模板，流程图还是空的', async () => {
  await page.goto(`/customer/tasks/${taskId}/fill/3?page=process`);
  await expect(page.getByRole('heading', { name: '您的产品是怎么做出来的' })).toBeVisible();
  await expect(template('锂电池组装（电芯封装）')).toContainText('推荐');
  await expect(template('SMT 电子装配')).not.toContainText('推荐');
  await expect(page.getByText('选模板或添加工序后，这里自动画出流程图')).toBeVisible();
  expect(await itemStatus('process_flow')).toBeUndefined();
});

test('选模板：工序和流程图一起出来，「生产工艺流程」变为已提供', async () => {
  await template('锂电池组装（电芯封装）').click();
  await expect(template('锂电池组装（电芯封装）')).toHaveAttribute('aria-pressed', 'true');
  await expect(stepChips()).toHaveCount(10);
  // 每行 5 道，第 2 行从右往左：最左边是最后一道
  await expect(chartRows()).toHaveCount(2);
  await expect(chartRows().nth(0)).toHaveText('喷码裁切打印电芯检测电芯包装');
  await expect(chartRows().nth(1)).toHaveText('装盘装箱外观检测成品检测装热缩套管电焊插头线');
  await expect(page.getByText('工艺流程已有 10 道工序，来自行业模板')).toBeVisible();
  await expect.poll(async () => (await itemStatus('process_flow'))?.status).toBe('provided');
});

test('工序用到的设备不在设备表里时提示，可一键加到设备表', async () => {
  const note = page.getByRole('note');
  await expect(note).toContainText('喷码机、裁切机、打印机、检测柜、点焊机、热风枪尚未在设备表中');
  await note.getByRole('button', { name: '加到设备表' }).click();
  await expect(note).toContainText('「喷码」已关联设备表中的喷码机');
  await expect(note).not.toContainText('尚未在设备表中');
});

test('按实际情况改工序：删除、改名、添加、拖动调整先后，流程图跟着变', async () => {
  await page.getByRole('button', { name: '删除工序打印' }).click();
  await page.getByRole('button', { name: '喷码', exact: true }).click();
  await page.getByLabel('第 1 道工序名称').fill('激光喷码');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '+ 添加工序' }).click();
  await page.getByLabel('第 10 道工序名称').fill('老化测试');
  await page.keyboard.press('Enter');
  await expect(stepChips()).toHaveCount(10);

  // 把「老化测试」拖到「成品检测」前面
  await stepChips().filter({ hasText: '老化测试' }).dragTo(stepChips().filter({ hasText: '成品检测' }));
  await expect(stepChips().nth(6)).toContainText('老化测试');
  await expect(stepChips().nth(7)).toContainText('成品检测');

  await expect(chartRows().nth(0)).toHaveText('激光喷码裁切电芯检测电芯包装电焊插头线');
  await expect(chartRows().nth(1)).toHaveText('装盘装箱外观检测成品检测老化测试装热缩套管');
});

test('换模板前先确认，取消就不动', async () => {
  await template('SMT 电子装配').click();
  await expect(page.getByText('现在的 10 道工序会被替换。')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(template('锂电池组装（电芯封装）')).toHaveAttribute('aria-pressed', 'true');
  await expect(stepChips().first()).toContainText('激光喷码');
});

test('放大预览流程图', async () => {
  await page.getByRole('button', { name: '放大预览' }).click();
  const dialog = page.getByRole('dialog', { name: '生产工艺流程图' });
  await expect(dialog.getByTestId('process-chart-row').first()).toContainText('激光喷码');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
});

test('填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(/\/customer\/enterprises\//);
  await page.goto(`/customer/tasks/${taskId}/fill/3?page=process`);
  await expect(stepChips()).toHaveCount(10);
  await expect(stepChips().nth(6)).toContainText('老化测试');
  await expect(chartRows().nth(0)).toHaveText('激光喷码裁切电芯检测电芯包装电焊插头线');
});

test('都不像：写一句话拆成工序；拍照上传已有流程图挂到「生产工艺流程」上', async () => {
  await page.getByRole('button', { name: '写一句话描述' }).click();
  await page.getByLabel('一句话描述生产过程').fill('熔融、压铸、攻牙→喷砂，组装、包装出货');
  await page.getByRole('button', { name: '按这句话生成工序' }).click();
  await page.getByRole('button', { name: '替换' }).click();
  await expect(stepChips()).toHaveCount(6);
  await expect(chartRows().nth(0)).toHaveText('熔融压铸攻牙喷砂组装');
  await expect(chartRows().nth(1)).toHaveText('包装出货');
  await expect(page.getByText('工艺流程已有 6 道工序，来自一句话描述')).toBeVisible();
  await expect(template('锂电池组装（电芯封装）')).toHaveAttribute('aria-pressed', 'false');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '拍照上传已有流程图' }).click();
  await (await chooser).setFiles({ name: '车间流程图.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('已有流程图：车间流程图.png')).toBeVisible();
  await expect.poll(async () => (await itemStatus('process_flow'))?.fileIds.length).toBe(1);
});

test('下一步进入第 4 步，第 4 步的上一步回到工艺流程，上一页回到第 1 页', async () => {
  await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  await expect(page).toHaveURL(new RegExp(`/fill/4$`));
  await page.getByRole('button', { name: '上一步' }).click();
  await expect(page.getByRole('heading', { name: '您的产品是怎么做出来的' })).toBeVisible();
  await expect(page.getByLabel('一句话描述生产过程')).toHaveValue('熔融、压铸、攻牙→喷砂，组装、包装出货');
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByRole('heading', { name: '您的工厂里有哪些场所和东西' })).toBeVisible();
});

test('行业模板加载失败：提示可重试，一句话描述、上传照片照常可用', async () => {
  let fail = true;
  await page.route('**/api/process-templates', (route) => (fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
  await page.goto(`/customer/tasks/${taskId}/fill/3?page=process`);
  const alert = page.getByRole('alert').filter({ hasText: '行业模板暂时没加载出来' });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('一句话描述生产过程')).toHaveValue('熔融、压铸、攻牙→喷砂，组装、包装出货');
  await expect(page.getByRole('button', { name: '拍照上传已有流程图' })).toBeEnabled();
  await expect(stepChips()).toHaveCount(6);

  fail = false;
  await alert.getByRole('button', { name: '重新加载' }).click();
  await expect(alert).toHaveCount(0);
  await expect(template('锂电池组装（电芯封装）')).toBeVisible();
  await page.unroute('**/api/process-templates');
});

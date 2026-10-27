import { expect, test, type Page } from '@playwright/test';

// 第 6a 项：企业自填第 1 步。营业执照识别用模拟服务（见 playwright.config.ts 的 LICENSE_OCR）。
// 只登录一次、共用同一个页面（后台每分钟限 10 次登录）；企业和任务用接口直接建
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.7\n% 营业执照\n');

let page: Page;
let enterpriseId: string;
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
  const ent = await page.request.post(`/api/orgs/${orgId}/enterprises`, { data: { name: '惠州示例电器有限公司' } });
  enterpriseId = ((await ent.json()) as { id: string }).id;
  const task = await page.request.post(`/api/enterprises/${enterpriseId}/tasks`, {
    data: { name: '2026 年应急预案编制' },
  });
  taskId = ((await task.json()) as { id: string }).id;
  await page.request.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
});

test.afterAll(async () => {
  await page.close();
});

async function basicInfoStatus() {
  const res = await page.request.get(`/api/tasks/${taskId}/checklist`);
  const body = (await res.json()) as { items: Record<string, { status: string } | undefined> };
  return body.items.basic_info?.status;
}

test('选了「按提示填写」的任务：任务页显示资料检查，点「继续填写」进入第 1 步', async () => {
  await page.goto(`/customer/tasks/${taskId}`);
  await expect(page.getByText('资料来自企业自填')).toBeVisible();
  await page.getByRole('button', { name: '继续填写' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/tasks/${taskId}/fill/1$`));
  await expect(page.getByRole('heading', { name: '先告诉我们，您是一家什么样的企业' })).toBeVisible();
  await expect(page.getByLabel('企业名称')).toHaveValue('惠州示例电器有限公司');
  // 联系人默认当前账号
  await expect(page.getByLabel(/^联系人/)).toHaveValue('林管理员');
});

test('上传营业执照后识别出的内容填进表单，标「来自营业执照」', async () => {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '营业执照.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('已识别 8 项，已填入下方，请核对')).toBeVisible();
  await expect(page.getByLabel(/^企业名称/)).toHaveValue('惠阳飞宇电器有限公司');
  await expect(page.getByLabel(/^统一社会信用代码/)).toHaveValue('91441303MA4W12345X');
  await expect(page.getByText('惠州市惠阳区市场监督管理局')).toBeVisible();
  await expect(page.getByText('来自营业执照').first()).toBeVisible();
  // 主管负责人默认同法定代表人
  await expect(page.getByLabel(/^主管负责人/)).toHaveValue('李文聪');
});

test('边填边自动保存；开始编制需要的几项填齐后「企业基本情况」变为已提供', async () => {
  await page.getByLabel('员工人数').fill('86');
  await page.getByLabel('主要产品').fill('电热水壶、电饭煲');
  await page.getByLabel('所属行业').fill('电气机械');
  await page.getByText('电气机械和器材制造业', { exact: true }).click();
  expect(await basicInfoStatus()).toBeUndefined();
  await page.getByLabel(/^联系电话/).fill('13800001234');
  await expect(page.getByText(/已自动保存 \d{2}:\d{2}/)).toBeVisible();
  await expect.poll(basicInfoStatus).toBe('provided');

  // 安全管理人员暂时不清楚：稍后补
  await page.getByRole('button', { name: '稍后补', exact: true }).click();
  await expect(page.getByText(/1 项稍后补/)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/已自动保存/);
});

test('填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/enterprises/${enterpriseId}$`));
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();

  await page.getByRole('button', { name: '继续准备资料' }).click();
  await page.getByRole('button', { name: '继续填写' }).click();
  await expect(page).toHaveURL(/\/fill\/1$/);
  await expect(page.getByLabel('员工人数')).toHaveValue('86');
  await expect(page.getByLabel('主要产品')).toHaveValue('电热水壶、电饭煲');
  await expect(page.getByText('电气机械和器材制造业')).toBeVisible();
  await expect(page.getByRole('button', { name: '稍后补', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('营业执照.pdf')).toBeVisible();
});

test('别人刚改过时提示并显示最新内容，不会覆盖', async () => {
  // 同事在企业详情里改了法定代表人
  await page.request.patch(`/api/enterprises/${enterpriseId}`, { data: { legalRepresentative: '王小明' } });
  await page.getByLabel('主要产品').fill('电热水壶');
  await expect(page.getByText('资料刚被其他人修改过')).toBeVisible();
  await expect(page.getByLabel(/^法定代表人/)).toHaveValue('王小明');
  await expect(page.getByLabel('主要产品')).toHaveValue('电热水壶、电饭煲');
});

async function itemStatus(key: string) {
  const res = await page.request.get(`/api/tasks/${taskId}/checklist`);
  const body = (await res.json()) as { items: Record<string, { status: string } | undefined> };
  return body.items[key]?.status;
}

const chart = () => page.getByRole('region', { name: '应急救援组织体系图' });
const chartGroups = () => chart().getByRole('listitem');
// 「总指挥姓名」也包含在「副总指挥姓名」里，要精确匹配
const commander = (field: string) => page.getByLabel(`总指挥${field}`, { exact: true });

// 第 6b 项：第 2 步，用飞宇样例填写
test('下一步进入第 2 步：按 86 人预设 3 个小组，体系图已画出', async () => {
  await page.getByRole('button', { name: '下一步：人员与应急组织' }).click();
  await expect(page).toHaveURL(/\/fill\/2$/);
  await expect(page.getByRole('heading', { name: '出了事，谁来指挥、谁去处置' })).toBeVisible();
  await expect(page.getByText('已按 86 人的规模预设 3 个小组')).toBeVisible();
  await expect(page.getByText('建议 3–4 组')).toBeVisible();
  await expect(chartGroups()).toHaveText(['抢险救灾组', '综合保障组', '通讯联络组']);
  await expect(chart().getByText('副总指挥', { exact: true })).toHaveCount(0);
});

test('填总指挥及手机后两项资料变为已提供，值班电话默认同总指挥', async () => {
  await commander('姓名').fill('李文聪');
  await commander('职位').fill('总经理');
  expect(await itemStatus('emergency_groups')).toBeUndefined();
  await commander('手机').fill('13800000001');
  await expect(page.getByLabel('24 小时值班电话')).toHaveAttribute('placeholder', '13800000001');
  await expect(page.getByText('同总指挥')).toBeVisible();
  await expect.poll(() => itemStatus('emergency_groups')).toBe('provided');
  await expect.poll(() => itemStatus('duty_phone')).toBe('provided');
});

test('填副总指挥、组长和组员，体系图和编制小组跟着变', async () => {
  await page.getByLabel('副总指挥姓名').fill('陈志刚');
  await page.getByLabel('副总指挥职位').fill('副总经理');
  await expect(chart().getByText('副总指挥', { exact: true })).toBeVisible();

  await page.getByLabel('抢险救灾组组长姓名').fill('刘海涛');
  await page.getByLabel('抢险救灾组组长手机').fill('13800000010');
  // 组员从已填人员中选（总指挥兼任）
  await page.getByRole('button', { name: '+ 添加组员（可从已填人员中选）' }).click();
  await page.getByRole('menuitem', { name: '李文聪 · 总经理' }).click();
  await expect(page.getByLabel('抢险救灾组组员 1 姓名')).toHaveValue('李文聪');

  // 综合保障组还没填组长：收起时提示可稍后补
  await expect(page.getByRole('region', { name: '综合保障组' }).getByText('组长待填 · 可稍后补')).toBeVisible();
  await expect(page.getByText('3 个小组，2 位组长可稍后补')).toBeVisible();

  // 加一个医疗救护组：体系图按规定顺序插在中间
  await page.getByRole('button', { name: '+ 医疗救护组' }).click();
  await expect(chartGroups()).toHaveText(['抢险救灾组', '医疗救护组', '综合保障组', '通讯联络组']);

  const team = page.getByRole('table', { name: '应急预案编制小组' });
  await expect(team.getByRole('row')).toHaveCount(1 + 3);
  await expect(team.getByText('重点编写风险评估与现场处置')).toBeVisible();
});

test('去掉副总指挥、删掉小组后体系图自动调整', async () => {
  await page.getByRole('button', { name: '移除副总指挥' }).click();
  await expect(chart().getByText('副总指挥', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '删除这个小组' }).last().click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(chartGroups()).toHaveText(['抢险救灾组', '综合保障组', '通讯联络组']);
  await expect(page.getByRole('status')).toHaveText(/已自动保存/);
});

test('第 2 步填一半退出，回来内容还在', async () => {
  await page.getByRole('button', { name: '保存并退出' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/enterprises/${enterpriseId}$`));
  await page.goto(`/customer/tasks/${taskId}/fill/2`);
  await expect(commander('姓名')).toHaveValue('李文聪');
  await expect(page.getByLabel('抢险救灾组组长姓名')).toHaveValue('刘海涛');
  await expect(chartGroups()).toHaveText(['抢险救灾组', '综合保障组', '通讯联络组']);});

test('也可以上传花名册，由专家整理', async () => {
  await page.getByText('上传花名册', { exact: true }).first().click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '应急通讯录.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('应急通讯录.pdf')).toBeVisible();
  await expect(page.getByText('已上传 1 份花名册')).toBeVisible();

  // 切回逐项填写，之前填的还在
  await page.getByText('逐项填写', { exact: true }).click();
  await expect(commander('姓名')).toHaveValue('李文聪');
  await page.getByRole('button', { name: '下一步：生产情况' }).click();
  await expect(page).toHaveURL(/\/fill\/3$/);
});

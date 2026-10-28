import { expect, test, type Page } from '@playwright/test';

// 第 14 项：M1 整体验收。用飞宇样例把两条路线从头走到提交，全程在页面上操作（不借接口填资料）。
// 途中按 Paper 画板截图，放在 test-results/acceptance/ 里与设计稿并排对比。
// 只登录一次、共用同一个页面（后台每分钟限登录次数）
test.describe.configure({ mode: 'serial' });

const PDF = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
const PNG = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
});

let page: Page;
const selfFill = { enterpriseId: '', taskId: '' };
const upload = { enterpriseId: '', taskId: '' };

// 截图：等弹窗、抽屉动画结束再拍
async function shot(name: string, fullPage = false) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/acceptance/${name}.png`, fullPage });
}

const drawer = () => page.getByRole('dialog');

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  // 营业执照模拟识别总是给同一个信用代码；验收完换掉，免得后面的测试建档时撞上
  if (selfFill.enterpriseId) {
    await page.request.patch(`/api/enterprises/${selfFill.enterpriseId}`, { data: { socialCreditCode: '91441300ACCEPT0001' } });
  }
  await page.close();
});

test('登录后进入工作台', async () => {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByRole('heading', { name: /(上午|下午|晚上)好，林管理员/ })).toBeVisible();
});

test.describe('按提示填写：飞宇样例从建档填到提交', () => {
  test('新建企业、创建编制任务、选「按提示填写」', async () => {
    await page.getByRole('menuitem', { name: '企业' }).click();
    await page.getByRole('button', { name: '新建企业' }).first().click();
    await page.getByLabel('企业名称').fill('惠阳飞宇电器有限公司');
    await shot('c02-p01-new-enterprise');
    await page.getByRole('button', { name: '保存企业档案' }).click();
    await expect(page).toHaveURL(/\/customer\/enterprises\/[0-9a-f-]{36}$/);
    selfFill.enterpriseId = page.url().split('/').pop()!;
    await shot('c03-enterprise-detail');

    await page.getByRole('button', { name: '创建编制任务' }).click();
    await expect(page.getByLabel('所属企业')).toHaveValue('惠阳飞宇电器有限公司');
    await shot('p02-create-task');
    await page.getByRole('button', { name: '创建草稿并准备资料' }).click();
    await expect(page.getByRole('heading', { name: '您想怎么开始？' })).toBeVisible();
    selfFill.taskId = page.url().split('/').at(-2)!;
    await shot('s00-start-method');
    await page.getByRole('button', { name: '开始填写' }).click();
    await expect(page).toHaveURL(/\/fill\/1$/);
  });

  test('第 1 步：上传营业执照自动识别，补齐人数、产品、行业和电话', async () => {
    await page.locator('input[type=file]').setInputFiles(PDF('营业执照.pdf'));
    await expect(page.getByText(/已识别 \d+ 项，已填入下方，请核对/)).toBeVisible();
    await expect(page.getByLabel(/^统一社会信用代码/)).toHaveValue('91441303MA4W12345X');
    await page.getByLabel('员工人数').fill('86');
    await page.getByLabel('主要产品').fill('电热水壶、电饭煲');
    await page.getByLabel('所属行业').fill('电气机械');
    await page.getByText('电气机械和器材制造业', { exact: true }).click();
    await page.getByLabel(/^联系电话/).fill('13600003340');
    await expect(page.getByText(/已自动保存 \d{2}:\d{2}/)).toBeVisible();
    await shot('s01-basic', true);
    await page.getByRole('button', { name: '下一步：人员与应急组织' }).click();
  });

  test('第 2 步：总指挥及手机、值班电话，体系图自动画出', async () => {
    await expect(page.getByRole('heading', { name: '出了事，谁来指挥、谁去处置' })).toBeVisible();
    await page.getByLabel('总指挥姓名', { exact: true }).fill('李文聪');
    await page.getByLabel('总指挥职位', { exact: true }).fill('总经理');
    await page.getByLabel('总指挥手机', { exact: true }).fill('13800000001');
    await page.getByLabel('24 小时值班电话').fill('0752-3324567');
    await expect(page.getByRole('region', { name: '应急救援组织体系图' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText(/已自动保存/)).toBeVisible();
    await shot('s02-organization', true);
    await page.getByRole('button', { name: '下一步：生产情况' }).click();
  });

  test('第 3 步第 1 页：设备、特种设备四类、原辅材料、两个业务问题', async () => {
    await expect(page.getByRole('heading', { name: '您的工厂里有哪些场所和东西' })).toBeVisible();
    await page.getByLabel('第 1 台设备名称').fill('冲压机');
    await page.getByLabel('第 1 台设备数量').fill('6 台');
    for (const key of ['pressureVessels', 'boilers', 'pressurePipelines', 'storageTanks']) {
      await page.getByTestId(`special-${key}`).getByText('没有', { exact: true }).click();
    }
    await page.getByLabel('第 1 种物料名称').fill('塑料粒子');
    await page.getByLabel('第 1 种物料年用量').fill('30 t');
    await page.getByLabel('第 1 种物料最大存放量').fill('2 t');
    for (const q of ['有没有把厂房出租给其他企业？', '有自己的车辆运输货物吗？']) {
      await page.getByRole('radiogroup', { name: q }).getByText('否', { exact: true }).click();
    }
    await expect(page.getByText('已自动保存')).toBeVisible();
    await shot('s03a-production', true);
    await page.getByRole('button', { name: '下一页：工艺流程' }).click();
  });

  test('第 3 步第 2 页：选行业模板，流程图跟着画出', async () => {
    await expect(page.getByRole('heading', { name: '您的产品是怎么做出来的' })).toBeVisible();
    await page.getByRole('button', { name: /^五金冲压/ }).click();
    await expect(page.getByTestId('process-chart-row').first()).toBeVisible();
    await expect(page.getByText(/工艺流程已有 \d+ 道工序，来自行业模板/)).toBeVisible();
    await shot('s03b-process', true);
    await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  });

  test('第 4 步：灭火器数量、总平面图与疏散图', async () => {
    await expect(page.getByRole('heading', { name: '出了事，手边有什么可以用' })).toBeVisible();
    await page.getByLabel('手提式干粉灭火器数量').fill('50');
    await page.getByTestId('drawing-site_plan').locator('input[type=file]').setInputFiles(PNG('总平面图.png'));
    await expect(page.getByTestId('drawing-site_plan')).toContainText('总平面图.png');
    await page.getByTestId('drawing-evacuation_plan').locator('input[type=file]').setInputFiles(PNG('疏散图.png'));
    await expect(page.getByTestId('drawing-evacuation_plan')).toContainText('疏散图.png');
    await expect(page.getByText(/缺.*图/)).toHaveCount(0);
    await shot('s04-resources', true);
    await page.getByRole('button', { name: '下一步：核对并提交' }).click();
  });

  test('第 5 步核对，确认资料版本后提交', async () => {
    await expect(page.getByText('核对一下，就可以交给耕云了')).toBeVisible();
    await shot('s05-review', true);
    await page.getByRole('button', { name: '提交给耕云' }).click();
    await expect(page.getByTestId('submit-dialog')).toHaveAttribute('data-phase', 'confirm');
    await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('总平面图.png');
    await expect(page.getByTestId('submit-dialog')).toContainText('是否出租厂房');
    await shot('f02-confirm-self-fill');
    await page.getByRole('button', { name: '确认提交' }).click();

    await expect(page).toHaveURL(new RegExp(`/customer/tasks/${selfFill.taskId}\\?tab=records$`));
    await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '待补清单' })).toBeVisible();
    await shot('f03b-submitted-self-fill', true);
  });
});

test.describe('上传已有资料：传文件、逐项检查后提交', () => {
  const category = (label: string) => page.getByRole('button', { name: `${label}明细` });
  const close = () => drawer().getByText('关闭', { exact: true }).click();

  async function pickFile(label: string, file: string) {
    await drawer().getByLabel(`${label}在哪份文件里`).click();
    await page.getByTitle(`${file} · V1`).click();
  }

  async function confirmFact(key: string, label: string, text: string) {
    const card = page.getByTestId(`item-${key}`);
    await card.getByLabel(`${label}实际情况`).fill(text);
    await card.getByRole('checkbox', { name: '我确认以上信息与企业实际情况一致' }).check();
    await card.getByRole('button', { name: '保存确认' }).click();
    await expect(card).toBeHidden();
  }

  test('新建企业、创建任务、选「上传已有资料」', async () => {
    await page.goto('/customer/enterprises/new');
    await page.getByLabel('企业名称').fill('惠州飞宇上传验收有限公司');
    await page.getByRole('button', { name: '保存企业档案' }).click();
    await expect(page).toHaveURL(/\/customer\/enterprises\/[0-9a-f-]{36}$/);
    upload.enterpriseId = page.url().split('/').pop()!;
    await page.getByRole('button', { name: '创建编制任务' }).click();
    await page.getByRole('button', { name: '创建草稿并准备资料' }).click();
    await expect(page.getByRole('heading', { name: '您想怎么开始？' })).toBeVisible();
    upload.taskId = page.url().split('/').at(-2)!;
    await page.getByRole('button', { name: '上传资料' }).click();
    await expect(page.getByRole('heading', { name: '先准备企业已有资料' })).toBeVisible();
  });

  test('一次上传企业已有的 5 份资料', async () => {
    await page
      .getByTestId('drop-zone')
      .locator('input[type=file]')
      .setInputFiles(['营业执照.pdf', '企业资料清单.pdf', '应急人员名册.pdf', '总平面图.pdf', '疏散图.pdf'].map(PDF));
    await expect(page.getByRole('table', { name: '本次原始资料' })).toContainText('已关联 5 份原始文件');
    await shot('p03-upload', true);
    await page.getByRole('button', { name: '检查资料' }).click();
    await expect(page.getByText('6 待补充')).toBeVisible();
    await shot('p05-check', true);
  });

  test('企业基本资料：营业执照在哪份文件里，基本情况由我确认', async () => {
    await category('企业基本资料').click();
    await pickFile('营业执照', '营业执照.pdf');
    await expect(page.getByTestId('done-business_license')).toContainText('营业执照.pdf');
    await shot('p05b-drawer');
    await confirmFact('basic_info', '企业基本情况', '联系人林小明 13600003340，员工 86 人，主要产品电热水壶、电饭煲');
    await close();
  });

  test('生产工艺与设备：工艺、设备由我确认；特种设备四类先答有没有', async () => {
    await category('生产工艺与设备').click();
    await confirmFact('process_flow', '生产工艺流程', '下料 → 冲压 → 焊接 → 组装 → 检验 → 包装');
    await confirmFact('equipment', '生产设备设施', '冲压机 6 台、点焊机 4 台、装配线 2 条');
    const card = page.getByTestId('special-equipment');
    for (const name of [/压力容器有没有/, /锅炉.*有没有/, /压力管道.*有没有/, /储罐.*有没有/]) {
      await card.getByRole('radiogroup', { name }).getByText('没有', { exact: true }).click();
    }
    await shot('p05c-special-equipment');
    await card.getByRole('button', { name: '保存回答' }).click();
    await expect(card).toContainText('已满足');
    await close();
  });

  test('原辅料、应急组织、应急资源：由我确认或对应已传文件', async () => {
    await category('原辅料与安全资料').click();
    await confirmFact('materials', '原辅材料贮存量', '塑料粒子最大存放 2 t，钢板 5 t');
    await close();

    await category('应急组织与联系人').click();
    await pickFile('各应急小组成员', '应急人员名册.pdf');
    await expect(page.getByTestId('done-emergency_groups')).toContainText('应急人员名册.pdf');
    await confirmFact('duty_phone', '24 小时值班电话', '13800000001（总指挥李文聪）');
    await close();

    await category('应急资源与设施').click();
    await confirmFact('emergency_supplies', '应急物资及装备', '手提式干粉灭火器 50 具，消防栓 12 个');
    await close();
  });

  test('图纸对应已传文件后可以提交；确认版本后提交', async () => {
    await category('厂区实际图纸').click();
    await pickFile('总平面布置图', '总平面图.pdf');
    await pickFile('紧急疏散示意图', '疏散图.pdf');
    await expect(page.getByTestId('done-evacuation_plan')).toContainText('疏散图.pdf');
    await close();

    await expect(page.getByText('必需资料已齐，可以提交')).toBeVisible();
    await shot('p06-ready', true);
    await page.getByRole('button', { name: '提交生成申请' }).click();
    await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('应急人员名册.pdf');
    await shot('f02-confirm-upload');
    await page.getByRole('button', { name: '确认提交' }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/tasks/${upload.taskId}\\?tab=records$`));
    await expect(page.getByText('申请已提交，耕云已开始整理')).toBeVisible();
    await shot('f03b-submitted-upload', true);
    await page.getByRole('tab', { name: '资料与检查' }).click();
    await expect(page.getByRole('region', { name: '本次提交资料' })).toContainText('疏散图.pdf');
  });
});

test('回到工作台与业务任务：两个任务都在耕云处理中，不在待我处理', async () => {
  await page.getByRole('menuitem', { name: '工作台' }).click();
  await expect(page.getByRole('region', { name: '正在办理' })).toContainText(/惠阳飞宇电器有限公司|惠州飞宇上传验收有限公司/);
  await shot('c01-workbench', true);

  await page.getByRole('menuitem', { name: '业务任务' }).click();
  await page.getByRole('tab', { name: /耕云处理中/ }).click();
  for (const name of ['惠阳飞宇电器有限公司', '惠州飞宇上传验收有限公司']) {
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('耕云编制 · 申请已提交');
  }
  await shot('c04-task-list', true);
  await page.getByRole('tab', { name: /待我处理/ }).click();
  await expect(page.getByRole('row', { name: /惠州飞宇上传验收有限公司/ })).toHaveCount(0);
});

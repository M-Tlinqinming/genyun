import { expect, test, type Page } from '@playwright/test';

// 资料核对向导（13 页 E2）：第 1 步企业基本信息、第 2 步人员与应急组织；第 3、4 步见 expert-workup-production；第 5 步见 expert-workup、expert-workup-risk、expert-workup-scope。
// 文件名排在 expert-workup-visuals 之后、expert-workup 之前：这里不动必需项（技术人员数留给 expert-workup 补）
async function openWizard(page: Page, step?: number) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  if (step) await page.goto(`${new URL(page.url()).pathname}?view=workup&step=${step}`);
}

const footer = (page: Page) => page.getByRole('region', { name: '页面操作' });
// 等这一步整步保存的请求回来（防抖 800 ms）
const stepSaved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'PUT' && /\/workup\/steps\/(basic|organization)$/.test(r.url()) && r.ok());
// 等「某个小组的组员里有没有这个人」的那次保存回来（之前改电话的保存可能还在路上，不能随便等一个）
const membersOf = (body: unknown): string[] => {
  if (Array.isArray(body)) return body.flatMap(membersOf);
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  const here = Array.isArray(o.members) ? (o.members as { name?: string }[]).map((m) => m.name ?? '') : [];
  return [...here, ...Object.values(o).flatMap(membersOf)];
};
const memberSaved = (page: Page, name: string, present: boolean) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' &&
      r.url().endsWith('/workup/steps/organization') &&
      r.ok() &&
      membersOf(r.request().postDataJSON()).includes(name) === present,
  );

test('还没生成过草稿时默认打开资料核对，停在第一个没走完的步骤；第 1 步改了自动保存，格式不对的先不存', async ({ page }) => {
  await openWizard(page);
  // expert-workup-production 已经走到第 4 步的「下一步」，默认打开第 5 步
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=1`);
  await expect(page.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  await expect(footer(page)).toContainText(/第 1 步，共 5 步 · 客户已填 \d+ 项，\d+ 项未填；还有 1 项待您补充或留空/);
  // 铺满窗口，盖住工作台的侧栏
  await expect(page.getByRole('link', { name: '任务中心' })).not.toBeInViewport();

  // 先留空：不算待补；再取消
  const tech = page.getByLabel('技术管理人员');
  await expect(tech).toHaveValue('');
  // 只有技术人员数没填，留空勾选框也只有这一个
  const blank = page.getByText('先留空，文稿标「待补充」');
  await expect(blank).toHaveCount(1);
  await blank.click();
  await expect(footer(page)).not.toContainText('待您补充或留空');
  await blank.click();
  await expect(footer(page)).toContainText('还有 1 项待您补充或留空');

  // 选填的邮政编码：格式不对标红、不保存；改对后保存，刷新还在
  await page.getByRole('button', { name: /其他工商与经营信息/ }).click();
  const postal = page.getByLabel('邮政编码');
  await postal.fill('5160');
  await postal.blur();
  await expect(page.getByText('邮政编码应为 6 位数字')).toBeVisible();
  const saving = stepSaved(page);
  await postal.fill('516006');
  await expect(page.getByText('邮政编码应为 6 位数字')).toHaveCount(0);
  await saving;
  await expect(page.getByRole('status')).toContainText(/已自动保存 \d\d:\d\d/);
  await page.reload();
  await page.getByRole('button', { name: /其他工商与经营信息/ }).click();
  await expect(page.getByLabel('邮政编码')).toHaveValue('516006');
  await expect(page.getByRole('complementary', { name: '参考' })).toContainText('这一步用在哪里');
  await page.screenshot({ path: 'test-results/acceptance/k10-step1.png', fullPage: true });

  // 改了某一项，来源标签变「您已修改」；改回客户填的，标签也回到客户的
  const contact = page.getByLabel('联系人', { exact: true });
  const contactField = page.locator('[data-field="联系人"]');
  const was = await contact.inputValue();
  await expect(contactField).toContainText('客户填写');
  const editing = stepSaved(page);
  await contact.fill(`${was}（核）`);
  await editing;
  await expect(contactField).toContainText('您已修改');
  await expect(contactField).not.toContainText('客户填写');
  const reverting = stepSaved(page);
  await contact.fill(was);
  await reverting;
  await expect(contactField).toContainText('客户填写');
});

test('第 2 步：手机号校验、从已填人员添加组员、至少 3 个小组、组织体系图实时生成', async ({ page }) => {
  await openWizard(page, 2);
  await expect(page.getByRole('heading', { name: '核对应急指挥部和各小组' })).toBeVisible();
  await expect(footer(page)).toContainText('第 2 步，共 5 步 · 3 个小组');
  // 顶部小结：客户填了几位指挥、几个小组、几名成员（老流程没附通讯录，不写那半句）
  await expect(page.getByLabel('客户填写小结')).toHaveText(/^客户填了 \d+ 位指挥、3 个小组、\d+ 名成员。$/);
  await expect(page.getByRole('group', { name: '综合保障组' })).toContainText('组长 张丽华 · 组员 1 人');

  // 手机号少一位：提示差几位，不存这个人的改动；改回原号码
  const phone = page.getByLabel('总指挥手机');
  const original = await phone.inputValue();
  await phone.fill(original.slice(0, -1));
  await phone.blur();
  await expect(page.getByText('手机号是 11 位，少了 1 位')).toBeVisible();
  await page.screenshot({ path: 'test-results/acceptance/k10-s06-4-field-error.png', fullPage: true });
  await phone.fill(original);
  await expect(page.getByText('手机号是 11 位，少了 1 位')).toHaveCount(0);

  // 只有 3 个小组：删除按钮不可用
  const rescue = page.getByRole('group', { name: '抢险救灾组' });
  await expect(rescue.getByRole('button', { name: '删除抢险救灾组' })).toBeDisabled();

  // 从已填人员中选：把副总指挥陈志刚加进通讯联络组
  const comms = page.getByRole('group', { name: '通讯联络组' });
  await comms.getByRole('button', { name: /^通讯联络组/ }).click();
  await comms.getByRole('button', { name: /添加组员/ }).click();
  const dialog = page.getByRole('dialog', { name: '给「通讯联络组」添加组员' });
  await dialog.getByLabel('搜姓名或岗位').fill('陈志刚');
  await dialog.getByRole('listitem').filter({ hasText: '陈志刚' }).click();
  await page.screenshot({ path: 'test-results/acceptance/k10-s06-1-pick.png' });
  const adding = memberSaved(page, '陈志刚', true);
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(comms.getByLabel('通讯联络组组员 陈志刚姓名')).toHaveValue('陈志刚');
  await adding;
  await page.screenshot({ path: 'test-results/acceptance/k10-step2.png', fullPage: true });

  // 组织体系图按这一步实时画；排版设置收在「想调排版才调」里
  const chart = page.getByRole('complementary', { name: '参考' }).getByRole('img', { name: /组织体系图：应急指挥部下设/ });
  await expect(chart).toHaveAttribute('alt', /通讯联络组/);
  await expect(page.getByRole('complementary', { name: '参考' })).toContainText('想调排版才调');
  await expect(page.getByRole('radiogroup', { name: '应急办公室' })).toBeVisible();

  // 刷新还在；再移出，恢复原样
  await page.reload();
  const again = page.getByRole('group', { name: '通讯联络组' });
  await again.getByRole('button', { name: /^通讯联络组/ }).click();
  await expect(again.getByLabel('通讯联络组组员 陈志刚姓名')).toHaveValue('陈志刚');
  const removing = memberSaved(page, '陈志刚', false);
  await again.getByRole('button', { name: '移出这名组员' }).last().click();
  await expect(again.getByLabel('通讯联络组组员 陈志刚姓名')).toHaveCount(0);
  await removing;
});

test('第 2 步：加一个预设小组再删掉；「新填一个人」；组里已有组长时不能再选组长', async ({ page }) => {
  await openWizard(page, 2);
  // 飞宇用酒精、天那水（危险化学品），按规模建议 5 组：现在 3 组，标签是「按规模建议 5 组」，不拦；
  // 补上两个预设组后变「按规模 5 组」，再删回 3 组
  const groupsCard = page.getByRole('region', { name: '应急小组', exact: true });
  await expect(groupsCard).toContainText('按规模建议 5 组');
  let adding = stepSaved(page);
  await page.getByRole('button', { name: '+ 警戒疏散组' }).click();
  await adding;
  adding = stepSaved(page);
  await page.getByRole('button', { name: '+ 医疗救护组' }).click();
  await adding;
  const guard = page.getByRole('group', { name: '警戒疏散组' });
  const medical = page.getByRole('group', { name: '医疗救护组' });
  await expect(medical).toBeVisible();
  await expect(footer(page)).toContainText('5 个小组');
  await expect(groupsCard).toContainText('按规模 5 组');
  await expect(groupsCard).not.toContainText('按规模建议');
  for (const [box, name] of [[medical, '医疗救护组'], [guard, '警戒疏散组']] as const) {
    const deleting = stepSaved(page);
    await box.getByRole('button', { name: `删除${name}` }).click();
    await deleting;
    await expect(box).toHaveCount(0);
  }
  await expect(footer(page)).toContainText('3 个小组');
  await expect(groupsCard).toContainText('按规模建议 5 组');

  // 新填一个人：手机号不以 1 开头报错；组里已有组长，职务只能选组员
  const comms = page.getByRole('group', { name: '通讯联络组' });
  await comms.getByRole('button', { name: /^通讯联络组/ }).click();
  await comms.getByRole('button', { name: /添加组员/ }).click();
  const dialog = page.getByRole('dialog', { name: '给「通讯联络组」添加组员' });
  await dialog.getByText('新填一个人', { exact: true }).click();
  await dialog.getByLabel('姓名').fill('测试组员');
  await dialog.getByLabel('手机').fill('23800000009');
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog.getByText('手机号要以 1 开头')).toBeVisible();
  await page.screenshot({ path: 'test-results/acceptance/k10-s06-6-new-person.png' });
  await dialog.getByLabel('手机').fill('13800000009');
  await dialog.getByLabel('在组里的职务').click();
  await expect(page.locator('.ant-select-item-option').filter({ hasText: '组员' })).toHaveCount(1);
  await expect(page.locator('.ant-select-item-option').filter({ hasText: '组长' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const saving = memberSaved(page, '测试组员', true);
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(comms.getByLabel('通讯联络组组员 测试组员姓名')).toHaveValue('测试组员');
  await expect(comms.getByLabel('通讯联络组组员 测试组员手机')).toHaveValue('13800000009');
  await saving;
  const removing = memberSaved(page, '测试组员', false);
  await comms.getByRole('button', { name: '移出这名组员' }).last().click();
  await removing;

  // 1366×768 下第 2 步不横向滚动；各组收起
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '核对应急指挥部和各小组' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/acceptance/k10-step2-1366.png' });
});

test('第 2 步：断网时标红并提示没保存上，重试后补存', async ({ page }) => {
  await openWizard(page, 2);
  const position = page.getByLabel('总指挥公司职位');
  const was = await position.inputValue();

  // 拦下保存请求，模拟断网
  await page.route('**/workup/steps/organization', (route) => route.abort('internetdisconnected'));
  await position.fill(`${was}兼`);
  await expect(page.getByRole('status')).toContainText('没保存上，网络断了');
  const banner = page.getByRole('alert').filter({ hasText: '以后的改动还没保存' });
  await expect(banner).toBeVisible();

  // 网络恢复，点「重试」补存
  await page.unroute('**/workup/steps/organization');
  const retrying = stepSaved(page);
  await banner.getByRole('button', { name: /重\s*试/ }).click();
  await retrying;
  await expect(page.getByRole('status')).toContainText(/已自动保存 \d\d:\d\d/);
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('总指挥公司职位')).toHaveValue(`${was}兼`);
  const reverting = stepSaved(page);
  await page.getByLabel('总指挥公司职位').fill(was);
  await reverting;
});

test('第 3、4、5 步一路翻页：第 5 步先补专业项，再核对并生成', async ({ page }) => {
  await openWizard(page, 2);
  await page.getByRole('button', { name: '下一步：生产情况' }).click();
  await expect(page).toHaveURL(/view=workup&step=3/);
  await expect(page.getByRole('heading', { name: '核对场所、设备与物料' })).toBeVisible();
  await page.getByRole('button', { name: '下一页：工艺流程' }).click();
  await expect(page.getByRole('heading', { name: '核对工艺流程' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  await expect(page.getByRole('heading', { name: '核对应急资源与图纸' })).toBeVisible();
  await page.getByRole('button', { name: '上一步' }).click();
  await expect(page.getByRole('heading', { name: '核对工艺流程' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  await page.getByRole('button', { name: '下一步：核对并生成' }).click();

  // 第 5 步第 1 页：专业项，预案编号按字号拼音首字母 + 年份预填
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
  await expect(footer(page)).toContainText('第 5 步，共 5 步（第 1 页）');
  await expect(page.getByRole('textbox', { name: '预案编号' })).toHaveValue(/^FY\d{4}$/);
  await page.getByRole('button', { name: '下一页：核对并生成' }).click();
  await expect(page).toHaveURL(/step=5&page=2/);
  await expect(page.getByRole('region', { name: '四步摘要' })).toBeVisible();
  // 还缺必填资料时底栏写还差几项，齐了写「第 5 步，共 5 步」
  await expect(footer(page)).toContainText(/第 5 步，共 5 步|还差 \d+ 项必填资料/);
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();

  // 退出再进：接着上次走到的第 5 步
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '补上只有您能定的专业项' })).toBeVisible();
});

test('新流程任务：来源标「客户表格」，右栏有「客户原表」卡片，可下载 Excel、查看图纸与照片；走完第 2 步任务中心显示「资料核对 2 / 5 步」', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /示例电子科技有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '核对企业基本信息' })).toBeVisible();
  await expect(page.getByLabel('来源图例')).toContainText('客户表格');

  const side = page.getByRole('complementary', { name: '参考' });
  await expect(side).toContainText('客户原表');
  await expect(side).toContainText('电子科技-企业资料填报.xlsx');
  await expect(side).toContainText('图纸与照片 3 份');
  const download = page.waitForEvent('download');
  await side.getByRole('button', { name: '下载 Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await side.getByRole('button', { name: '查看' }).click();
  const list = page.getByRole('list', { name: '图纸与照片' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list).toContainText('总平面布置图.png');
  await page.screenshot({ path: 'test-results/acceptance/k10-intake-step1.png', fullPage: true });
  await page.keyboard.press('Escape');

  // 第 2 步也有这张卡片，对应的工作表是「应急组织」；新流程没有通讯录
  await page.goto(`${new URL(page.url()).pathname}?view=workup&step=2`);
  await expect(page.getByRole('heading', { name: '核对应急指挥部和各小组' })).toBeVisible();
  await expect(side).toContainText('客户原表');
  await expect(side).toContainText('应急组织');
  await expect(page.getByLabel('客户填写小结')).toHaveText(/^客户表格填了 \d+ 位指挥、\d+ 个小组、\d+ 名成员。$/);
  await page.screenshot({ path: 'test-results/acceptance/k10-intake-step2.png', fullPage: true });

  // 走完第 2 步回任务中心：显示做到第几步
  await page.getByRole('button', { name: '下一步：生产情况' }).click();
  await expect(page).toHaveURL(/view=workup&step=3/);
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await expect(page.getByRole('row', { name: /示例电子科技有限公司/ })).toContainText('资料核对 2 / 5 步');
});

import { expect, test, type Page } from '@playwright/test';

// 资料核对向导（13 页 E2）：第 1 步企业基本信息、第 2 步人员与应急组织；第 3–5 步先用原来的整理页。
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

test('第 1 步：还没生成过草稿时默认打开；改了自动保存，格式不对的先不存', async ({ page }) => {
  await openWizard(page);
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
});

test('第 2 步：手机号校验、从已填人员添加组员、至少 3 个小组、组织体系图实时生成', async ({ page }) => {
  await openWizard(page, 2);
  await expect(page.getByRole('heading', { name: '核对应急指挥部和各小组' })).toBeVisible();
  await expect(footer(page)).toContainText('第 2 步，共 5 步 · 3 个小组');

  // 手机号少一位：提示差几位，不存这个人的改动；改回原号码
  const phone = page.getByLabel('总指挥手机');
  const original = await phone.inputValue();
  await phone.fill(original.slice(0, -1));
  await phone.blur();
  await expect(page.getByText('手机号是 11 位，少了 1 位')).toBeVisible();
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
  const adding = stepSaved(page);
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
  const removing = stepSaved(page);
  await again.getByRole('button', { name: '移出这名组员' }).last().click();
  await expect(again.getByLabel('通讯联络组组员 陈志刚姓名')).toHaveCount(0);
  await removing;
});

test('第 3–5 步先用原来的整理页；第 5 步去确认并生成', async ({ page }) => {
  await openWizard(page, 2);
  await page.getByRole('button', { name: '下一步：生产情况' }).click();
  await expect(page).toHaveURL(/view=workup&step=3/);
  await expect(page.getByRole('heading', { name: '生产情况' })).toBeVisible();
  await page.getByRole('link', { name: '打开原来的整理页' }).click();
  await expect(page).toHaveURL(/view=workup-old&module=equipment/);
  await expect(page.getByText('资料核对第 3–5 步正在换新样式，这里是原来的整理页')).toBeVisible();
  await page.getByRole('link', { name: '回到资料核对' }).click();
  await expect(page.getByRole('heading', { name: '生产情况' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  await page.getByRole('button', { name: '下一步：核对并生成' }).click();
  await expect(footer(page)).toContainText('第 5 步，共 5 步');
  await expect(page.getByRole('button', { name: '去确认并生成' })).toBeVisible();

  // 退出再进：接着上次走到的下一步
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '核对并生成' })).toBeVisible();
});

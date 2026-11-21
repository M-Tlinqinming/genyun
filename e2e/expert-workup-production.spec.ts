import { expect, test, type Page } from '@playwright/test';

// 资料核对第 3、4 步（13 页 E2-3a、E2-3b、E2-4，K11）。
// 演示数据：飞宇第 3 步有 8 台设备、5 种物料；压力管道答「拍照给耕云看」，厂房耐火等级留给专家。
// 本文件排在 expert-workup-contact 之后、expert-workup-scope 之前：判定完 4 项并新增乙炔；适用范围的开关在 expert-workup-scope 确认
async function openFeiyu(page: Page, step?: number) {
  const m = page.url().match(/\/expert\/tasks\/[0-9a-f-]+/);
  if (m) {
    // 已在任务里：直接换视图，不再登录
    await page.goto(`${m[0]}?view=${step ? `workup&step=${step}` : 'workup-old'}`);
    return;
  }
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]+/);
  await page.goto(`${new URL(page.url()).pathname}?view=${step ? `workup&step=${step}` : 'workup-old'}`);
}

const footer = (page: Page) => page.getByRole('region', { name: '页面操作' });
// 第 3、4 步整步保存（防抖 800 ms）；判定另走一条
const stepSaved = (page: Page, step: 'production' | 'resources') =>
  page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith(`/workup/steps/${step}`) && r.ok());
const judged = (page: Page) => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/workup/production') && r.ok());

// 只在这个选择框自己的弹层里找选项（按 aria-controls 找）：上一个下拉还在收起动画里时，页面上会同时有两份可见的弹层
async function choose(page: Page, label: string, option: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  const listId = await box.getAttribute('aria-controls');
  if (!listId) throw new Error(`${label} 没有 aria-controls`);
  const dropdown = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id="${listId}"]`) });
  await dropdown.getByTitle(option, { exact: true }).click();
}

test('第 3 步：补设备、判定危化品和特种设备、加返工；第 4 步：耐火等级', async ({ page }) => {
  // 两步十几处改动，每处都等保存回来
  test.setTimeout(90_000);
  await openFeiyu(page);
  await expect(page.getByText('整理中 · 必需项 11 / 22')).toBeVisible();

  await openFeiyu(page, 3);
  await expect(page.getByRole('heading', { name: '核对场所、设备与物料' })).toBeVisible();
  await expect(footer(page)).toContainText('第 3 步，共 5 步（第 1 页）');

  // 设备：补一台客户漏填的叉车
  const equipment = page.getByRole('table', { name: '设备' });
  await expect(equipment.getByLabel('设备名称').first()).toHaveValue('熔炉');
  await page.getByRole('button', { name: '+ 添加设备' }).click();
  const saved = stepSaved(page, 'production');
  await equipment.getByLabel('设备名称').last().fill('电动叉车');
  await equipment.getByLabel('数量').last().fill('1 台');
  await saved;

  // 危化品：酒精是，陶瓷灯头不是
  let j = judged(page);
  await choose(page, '酒精是否危化品', '是危化品');
  await j;
  j = judged(page);
  await choose(page, '陶瓷灯头是否危化品', '不是危化品');
  await j;

  // 新增乙炔，判定为危化品
  await page.getByRole('button', { name: '+ 添加物料' }).click();
  const added = stepSaved(page, 'production');
  await page.getByRole('table', { name: '原辅材料' }).getByLabel('物料名称').last().fill('乙炔');
  await added;
  j = judged(page);
  await choose(page, '乙炔是否危化品', '是危化品');
  await j;

  // 特种设备：压力管道没有；压力容器有，对照铭牌补参数
  const pipes = page.getByRole('group', { name: '压力管道' });
  j = judged(page);
  await pipes.getByText('没有', { exact: true }).click();
  await j;
  const vessels = page.getByRole('group', { name: '压力容器' });
  await vessels.getByText('有', { exact: true }).click();
  j = judged(page);
  await vessels.getByLabel('最高工作压力').fill('0.84');
  await vessels.getByLabel('容积').fill('1.25');
  await j;
  await page.screenshot({ path: 'test-results/acceptance/k11-step3-page1.png', fullPage: true });

  // 第 2 页：工艺流程，加一条返工，流程图自动画
  await page.getByRole('button', { name: '下一页：工艺流程' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole('heading', { name: '核对工艺流程' })).toBeVisible();
  const steps = page.getByRole('list', { name: '工序' }).getByRole('textbox');
  const n = await steps.count();
  expect(n).toBeGreaterThan(2);
  const first = await steps.first().inputValue();
  const last = await steps.last().inputValue();
  await page.getByRole('button', { name: '+ 添加返工 / 回用' }).click();
  await choose(page, '从哪道工序', last);
  await choose(page, '回到哪道工序', first);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  const branch = `返工：${last} → ${first}`;
  await expect(page.getByText(branch)).toBeVisible();
  await page.screenshot({ path: 'test-results/acceptance/k11-step3-page2.png', fullPage: true });

  // 第 4 步：厂房耐火等级
  await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();
  await expect(page.getByRole('heading', { name: '核对应急资源与图纸' })).toBeVisible();
  j = judged(page);
  await choose(page, '1 号生产厂房耐火等级', '二级');
  await j;

  // 都判定完：剩企业事实的技术人员数、适用范围里靠名称推断的 4 个开关（工艺流程图按排版自动画，不用采用）
  await openFeiyu(page);
  await expect(page.getByText('整理中 · 必需项 16 / 21')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 5 项：技术人员数 · 适用范围（4 个开关待确认）');

  // 退出再进，判断、新加的行和支路都还在
  await openFeiyu(page, 3);
  await expect(page.locator('.ant-select').filter({ has: page.getByLabel('酒精是否危化品') })).toContainText('是危化品');
  await expect(page.getByRole('table', { name: '设备' }).getByLabel('设备名称').last()).toHaveValue('电动叉车');
  await page.getByRole('button', { name: '下一页：工艺流程' }).click();
  await expect(page.getByText(branch)).toBeVisible();
});

test('第 4 步：代客户上传疏散图、填外部联系方式和四邻', async ({ page }) => {
  await openFeiyu(page, 4);
  await expect(page.getByRole('heading', { name: '核对应急资源与图纸' })).toBeVisible();

  // 疏散图：客户没传，代客户上传
  const evac = page.getByRole('group', { name: '紧急疏散示意图' });
  await expect(evac).toContainText('客户没传这张图');
  const chooser = page.waitForEvent('filechooser');
  await evac.getByRole('button', { name: '代客户上传' }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await (await chooser).setFiles({ name: '车间疏散图.png', mimeType: 'image/png', buffer: png });
  await expect(evac).toContainText('车间疏散图.png');
  await expect(evac).toContainText('您代传');

  // 外部联系方式：修改 → 填派出所、专职消防队附近没有
  const contacts = page.getByRole('table', { name: '外部应急联系方式' });
  await page.getByRole('button', { name: '修改', exact: true }).first().click();
  await page.getByLabel('派出所名称').fill('陈江派出所');
  await page.getByLabel('派出所电话').fill('0752-333');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('号码位数不对').first()).toBeVisible();
  await page.getByLabel('派出所电话').fill('0752-3333333');
  await page.getByText('附近没有', { exact: true }).click();
  const saved = stepSaved(page, 'resources');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await saved;
  await expect(contacts).toContainText('陈江派出所');
  await expect(contacts).toContainText('0752-3333333');
  await expect(contacts).toContainText('附近没有专职消防队，预案里不写这一行');

  // 四邻
  const quarters = stepSaved(page, 'resources');
  await page.getByLabel('东邻').fill('空地');
  await page.getByLabel('北邻').fill('和畅五路');
  await quarters;
  await expect(footer(page)).toContainText('第 4 步，共 5 步');
  await page.screenshot({ path: 'test-results/acceptance/k11-step4.png', fullPage: true });

  // 退出再进都还在
  await page.reload();
  await expect(page.getByRole('group', { name: '紧急疏散示意图' })).toContainText('车间疏散图.png');
  await expect(page.getByLabel('东邻')).toHaveValue('空地');
  await expect(page.getByRole('table', { name: '外部应急联系方式' })).toContainText('陈江派出所');

  // 第 5 步先用原来的过渡页
  await page.getByRole('button', { name: '下一步：核对并生成' }).click();
  await expect(footer(page)).toContainText('第 5 步，共 5 步');
});

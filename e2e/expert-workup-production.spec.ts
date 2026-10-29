import { expect, test, type Page } from '@playwright/test';

// 演示数据：飞宇第 3 步有 8 台设备、5 种物料；压力管道答「拍照给耕云看」，厂房耐火等级留给专家。
// 本文件排在 expert-workup-contact 之后、expert-workup 之前：判定完 4 项并新增乙炔，后者的必需项计数按 17 项算
async function openFeiyu(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
}

const lists = (page: Page) => page.getByRole('list', { name: '生产设备与物料清单' });
const row = (page: Page, key: string) => page.locator(`[data-row="${key}"]`);
const impact = (page: Page) => page.getByLabel('本表影响的适用范围开关');

test('周工判定危化品、特种设备与耐火等级，补设备和物料', async ({ page }) => {
  await openFeiyu(page);
  await expect(page.getByText('整理中 · 必需项 11 / 16')).toBeVisible();
  // 「下一个缺失项」：企业事实的技术人员数之后，跳到原辅材料里第一项待确认的判断
  await page.getByRole('button', { name: '下一个缺失项' }).click();
  await expect(page.locator('[data-fact="technicalManagementCount"]')).toBeVisible();
  await page.getByRole('button', { name: '下一个缺失项' }).click();
  await expect(page.getByRole('region', { name: '原辅材料' })).toBeVisible();
  await expect(row(page, 'material:m3')).toBeInViewport();

  await page.getByRole('button', { name: /生产设备与物料/ }).click();
  await expect(page.getByRole('button', { name: /生产设备与物料.*4 待确认/ })).toBeVisible();

  // 设备清单：补一台客户漏填的叉车
  const equipment = page.getByRole('region', { name: '设备清单' });
  await expect(equipment).toContainText('锌压铸机');
  await equipment.getByRole('button', { name: '新增一行' }).click();
  await equipment.getByLabel('名称').fill('电动叉车');
  await equipment.getByLabel('数量').fill('1 台');
  await equipment.getByRole('button', { name: '保存' }).click();
  await expect(equipment).toContainText('电动叉车');
  await expect(equipment.getByText('专家整理').first()).toBeVisible();

  // 原辅材料：酒精按系统建议判定为危化品，陶瓷灯头不是
  await lists(page).getByRole('listitem').filter({ hasText: '原辅材料' }).click();
  const materials = page.getByRole('region', { name: '原辅材料' });
  await expect(row(page, 'material:m5')).toContainText('名称含「酒精」，属于易燃液体，建议判定为危化品');
  await expect(impact(page)).toContainText('开 · 使用酒精、天那水、汽油等可燃液体');
  await row(page, 'material:m5').getByRole('button', { name: '采纳' }).click();
  await expect(row(page, 'material:m5').getByText('是', { exact: true })).toBeVisible();
  await expect(row(page, 'material:m3')).toContainText('名称不在危化品名单里');
  await row(page, 'material:m3').getByRole('button', { name: '不是危化品' }).click();
  await expect(row(page, 'material:m3').getByText('否', { exact: true })).toBeVisible();

  // 新增乙炔：判定为危化品后，可燃气体开关建议打开
  await materials.getByRole('button', { name: '新增一行' }).click();
  await materials.getByLabel('名称').fill('乙炔');
  await materials.getByLabel('最大储量').fill('4 瓶');
  await materials.getByRole('button', { name: '保存' }).click();
  const acetylene = materials.locator('[data-row^="material:x"]');
  await expect(acetylene).toContainText('名称含「乙炔」，属于易燃气体');
  await acetylene.getByRole('button', { name: '采纳' }).click();
  await expect(impact(page)).toContainText('开 · 使用天然气、液化气、乙炔等可燃气体');

  // 特种设备：压力管道判定为无（不用写理由）；压力容器对照铭牌补参数，PV 值系统算
  await lists(page).getByRole('listitem').filter({ hasText: '特种设备' }).click();
  await expect(row(page, 'special:pressurePipelines')).toContainText('有空压机与储气罐，可能有压缩空气主管');
  await expect(impact(page)).toContainText('开 · 有压力管道');
  await row(page, 'special:pressurePipelines').getByRole('button', { name: '判定为无' }).click();
  await expect(row(page, 'special:pressurePipelines')).toContainText('拍照给耕云看 → 无');
  await expect(impact(page)).toContainText('关 · 有压力管道');

  await row(page, 'special:pressureVessels').hover();
  await row(page, 'special:pressureVessels').getByRole('button', { name: '补压力容器参数' }).click();
  await page.getByLabel('最高工作压力').fill('0.84');
  await page.getByLabel('容积').fill('1.25');
  await page.getByRole('button', { name: '判定为有' }).click();
  await expect(row(page, 'special:pressureVessels')).toContainText('PV 1.05 MPa·m³（系统计算）');

  // 建构筑物：厂房耐火等级
  await lists(page).getByRole('listitem').filter({ hasText: '建构筑物' }).click();
  await page.getByLabel('1 号生产厂房耐火等级').click();
  await page.getByTitle('二级').click();
  await expect(row(page, 'building:b1').getByText('专家整理')).toBeVisible();

  // 都判定完：模块打勾，只剩企业事实的技术人员数
  await expect(page.getByRole('button', { name: /生产设备与物料\s*✓/ })).toBeVisible();
  await expect(page.getByText('整理中 · 必需项 16 / 17')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 1 项：技术人员数');

  // 退出再进，判断都还在
  await page.reload();
  await page.getByRole('button', { name: /生产设备与物料/ }).click();
  await lists(page).getByRole('listitem').filter({ hasText: '原辅材料' }).click();
  await expect(row(page, 'material:m5').getByText('是', { exact: true })).toBeVisible();
});

test('客户已填的急救药箱清单、工艺流程只读显示', async ({ page }) => {
  await openFeiyu(page);
  await page.getByRole('button', { name: /生产设备与物料/ }).click();
  await lists(page).getByRole('listitem').filter({ hasText: '急救药箱' }).click();
  // 飞宇的药箱清单客户已填
  await expect(page.getByRole('region', { name: '急救药箱' })).toContainText('急救箱（综合配置）');
  await expect(page.getByRole('region', { name: '急救药箱' })).not.toContainText('请客户补充');
  // 工艺流程只读，工序来自客户
  await lists(page).getByRole('listitem').filter({ hasText: '工艺流程' }).click();
  await expect(page.getByRole('list', { name: '工序' })).toContainText('压铸');
});

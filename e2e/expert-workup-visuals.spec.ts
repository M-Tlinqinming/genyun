import { expect, test, type Page } from '@playwright/test';

// 图件（14 页 E18-00F）：组织体系图与工艺流程图预览、微调、采用。
// 本文件排在 expert-workup-scope 之后、expert-workup 之前（文件名按字母排序）：那时只剩技术人员数和两张待采用的图，这里把两张图采用完
async function openFigures(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  await page.getByRole('button', { name: /^图件/ }).click();
  await expect(page.getByRole('region', { name: '图件' })).toBeVisible();
}

const orgCard = (page: Page) => page.getByRole('article', { name: '应急救援组织体系图' });
const flowCard = (page: Page) => page.getByRole('article', { name: '生产工艺流程图' });
const option = (card: ReturnType<typeof orgCard>, setting: string, text: string) =>
  card.locator(`[data-setting="${setting}"] label`).filter({ hasText: new RegExp(`^${text}$`) });
// 预览图的内容（SVG 写在图片地址里）
const drawn = async (card: ReturnType<typeof orgCard>) =>
  decodeURIComponent((await card.getByRole('img').getAttribute('src')) ?? '');

test('周工微调两张图后采用；采用后再改画法回到待采用；退出再进还在', async ({ page }) => {
  await openFigures(page);
  await expect(page.getByText('整理中 · 必需项 20 / 23')).toBeVisible();
  await expect(page.getByRole('button', { name: /^图件\s*待采用 2/ })).toBeVisible();
  await expect(orgCard(page)).toContainText('待采用');
  await expect(flowCard(page)).toContainText('10 道 · 由客户的一句话描述拆出');

  // 组织体系图：显示应急办公室，把通讯联络组拖到最前
  expect(await drawn(orgCard(page))).not.toContain('应急办公室');
  await option(orgCard(page), '应急办公室', '显示').click();
  await expect.poll(() => drawn(orgCard(page))).toContain('应急办公室');
  await orgCard(page).getByRole('button', { name: '拖动调整' }).click();
  const order = orgCard(page).getByRole('list', { name: '小组顺序' });
  await order.getByText('通讯联络组').dragTo(order.getByText('抢险救灾组'));
  await expect(order.getByRole('listitem').first()).toContainText('通讯联络组');
  await expect(orgCard(page)).toContainText('专家调整过');
  await orgCard(page).getByRole('button', { name: '采用此图' }).click();
  await expect(orgCard(page)).toContainText(/已采用 · 周工 \d+\.\d+/);

  // 工艺流程图：每行 4 道，加一条品质检测不合格回到抛光的返工
  await option(flowCard(page), '每行工序数', '4').click();
  await flowCard(page).getByRole('button', { name: '+ 添加返工 / 回用' }).click();
  // 输入工序名称后回车选中（两个下拉框接连打开时，点选项会碰上前一个的收起动画）
  await flowCard(page).getByLabel('从哪道工序').fill('品质检测');
  await flowCard(page).getByLabel('从哪道工序').press('Enter');
  await flowCard(page).getByLabel('回到哪道工序').fill('抛光');
  await flowCard(page).getByLabel('回到哪道工序').press('Enter');
  await flowCard(page).getByRole('button', { name: '添加', exact: true }).click();
  await expect(flowCard(page).getByRole('list', { name: '支路' })).toContainText('品质检测 → 抛光 · 返工');
  await expect.poll(() => drawn(flowCard(page))).toContain('返工');

  // 只剩一张没采用：顶部按钮直接采用它
  await page.getByRole('button', { name: '采用生产工艺流程图' }).click();
  await expect(flowCard(page)).toContainText(/已采用 · 周工/);
  await expect(page.getByRole('button', { name: /^图件\s*✓/ })).toBeVisible();
  await expect(page.getByText('整理中 · 必需项 22 / 23')).toBeVisible();
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('还差 1 项：技术人员数');
  // 与 Paper E18-00F 并排对比用
  await page.screenshot({ path: 'test-results/acceptance/m2-9-图件.png' });

  // 采用后改画法：回到待采用，必需项少一项；重新采用
  await option(flowCard(page), '每行工序数', '3').click();
  await expect(flowCard(page)).toContainText('图有变化，待重新采用');
  await expect(page.getByText('整理中 · 必需项 21 / 23')).toBeVisible();
  await flowCard(page).getByRole('button', { name: '采用此图' }).click();
  await expect(page.getByText('整理中 · 必需项 22 / 23')).toBeVisible();

  // 退出再进，画法和采用都还在
  await page.reload();
  await page.getByRole('button', { name: /^图件/ }).click();
  await expect(flowCard(page).getByRole('list', { name: '支路' })).toContainText('品质检测 → 抛光 · 返工');
  await expect(option(flowCard(page), '每行工序数', '3')).toHaveClass(/checked/);
  await expect(orgCard(page)).toContainText('已采用');
  expect(await drawn(orgCard(page))).toContain('应急办公室');

  // 人员回企业事实改
  await orgCard(page).getByRole('button', { name: '去企业事实修改' }).click();
  await expect(page.getByRole('button', { name: /^企业事实/ })).toHaveAttribute('aria-current', 'true');
});

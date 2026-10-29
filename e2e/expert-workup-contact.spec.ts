import { expect, test, type Page } from '@playwright/test';

// M2 第 5 项：联系客户的两种方式各走一遍。演示数据：飞宇任务分派给周工，客户请专家电话联系「应急物资及装备」「消防水池」。
// 文件名排在 expert-task-center 之后、expert-workup 之前：这里不动「技术人员数」，后面的整理测试照旧补它
async function login(page: Page, email: string, home: RegExp) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

async function openFeiyu(page: Page) {
  await login(page, 'expert@demo.genyun.net.cn', /\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
}

test('我打电话问：已问清后请求联系的两项变为已补，记入处理记录', async ({ page }) => {
  await openFeiyu(page);
  await expect(page.getByText('客户请专家电话联系 2 项')).toBeVisible();

  await page.getByRole('button', { name: '联系客户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // 有客户请求电话联系的项，默认「我打电话问」，带出缺失的企业事实和这两项
  await expect(dialog.getByRole('radio', { name: '我打电话问' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: /李文聪 · 总指挥/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: '不问技术人员数' }).click();
  await expect(dialog.getByRole('button', { name: '保存并回填' })).toBeDisabled();

  await dialog.getByLabel('回答：应急物资及装备').fill('灭火器 40 具、急救箱 3 个，存放在 1 号仓库');
  await dialog.getByLabel('回答：消防水池').fill('厂区东侧 200 m³ 消防水池一座');
  await dialog.getByRole('button', { name: '保存并回填' }).click();
  await expect(page.getByText('已保存，回答已回填')).toBeVisible();
  await expect(page.getByText('客户请专家电话联系 2 项')).toHaveCount(0);

  await page.getByRole('button', { name: /处理记录/ }).click();
  const records = page.getByRole('list', { name: '联系记录' });
  await expect(records).toContainText('我打电话问');
  await expect(records).toContainText('已问清');
  await expect(records).toContainText('答：厂区东侧 200 m³ 消防水池一座');
});

test('请客户在任务里补充：客户在待补清单回答，专家收到提醒后采用', async ({ page, browser }) => {
  await openFeiyu(page);
  await page.getByRole('button', { name: '联系客户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: '请客户在任务里补充' }).click();
  await dialog.getByRole('button', { name: '不问技术人员数' }).click();
  await dialog.getByRole('combobox', { name: '添加要问的企业事实' }).fill('企业简称');
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('问题：企业简称')).toHaveValue('请提供企业简称。');
  await dialog.getByRole('button', { name: '发给客户' }).click();
  await expect(page.getByText('已发给客户，客户回答后会提醒您')).toBeVisible();

  // 客户：铃铛有一条提醒，点开进任务回答
  const customer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(customer, 'feiyu@demo.genyun.net.cn', /\/customer/);
  await customer.getByRole('button', { name: /提醒，1 条未读/ }).click();
  await customer.getByRole('button', { name: /周工请您补充 1 项/ }).click();
  const request = customer.getByRole('region', { name: '专家想向您确认' });
  await expect(request).toContainText('专家想向您确认 1 项');
  await expect(request.getByRole('button', { name: '提交回答' })).toBeDisabled();
  await request.getByLabel('回答：企业简称').fill('飞宇电器');
  await request.getByRole('button', { name: '提交回答' }).click();
  await expect(customer.getByRole('region', { name: '已回答的补充请求' })).toContainText('飞宇电器');
  await customer.close();

  // 专家：收到客户回答的提醒，在企业事实里看到回答，点「采用」确认后保存
  await page.reload();
  await page.getByRole('button', { name: /提醒，1 条未读/ }).click();
  await page.getByRole('button', { name: /惠阳飞宇电器有限公司回答了补充请求/ }).click();
  const answer = page.locator('[data-fact="shortName"]').getByTestId('customer-answer');
  await expect(answer).toContainText('客户已回答：飞宇电器');
  await answer.getByRole('button', { name: '采用' }).click();
  const row = page.locator('[data-fact="shortName"]');
  await expect(row.getByLabel('企业简称')).toHaveValue('飞宇电器');
  await expect(row).toContainText('记为「客户确认 · 任务内补充」');
  await row.getByRole('button', { name: '保存' }).click();
  await expect(row).toContainText('客户确认 · 任务内补充');
  await expect(row.getByTestId('customer-answer')).toHaveCount(0);
});

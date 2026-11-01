import { expect, test, type Page } from '@playwright/test';

// M2 第 13 项「发起事实补件」（15 页 R00a、R00b、R00c）：飞宇换了应急联系人，走完一整轮。
// 专家发起 → 客户在任务页上传新名册并确认 → 专家收到提醒、写下本轮采用的值并明确采用 → 提示重新生成三份草稿。
// 整轮走完、不留进行中的一轮，排在后面的用例不受影响
async function login(page: Page, email: string, home: RegExp) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
}

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });

test('飞宇换了应急联系人：专家发起补件，客户回应，专家核实并采用后提示重新生成', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page, 'expert@demo.genyun.net.cn', /\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();

  // 发起：选联系人和联系电话，标题和说明按所选事实拼好
  await page.getByRole('button', { name: '发起事实补件' }).click();
  const dialog = page.getByRole('dialog', { name: '发起事实补件' });
  const facts = dialog.getByRole('combobox', { name: '要核对的企业事实' });
  await facts.fill('联系电话');
  await page.keyboard.press('Enter');
  await facts.fill('联系人');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('textbox', { name: '标题' })).toHaveValue('请确认联系电话、联系人');
  await dialog.getByRole('textbox', { name: '标题' }).fill('请确认应急联系人和电话');
  await dialog.getByRole('button', { name: '发给客户' }).click();
  await expect(page.getByText('已发起，客户会在任务页看到')).toBeVisible();
  await expect(page).toHaveURL(/view=supplement/);
  await expect(page.getByRole('status')).toHaveText('等待客户回应');
  // 客户回应前，本轮拟采用一栏不能填
  await expect(page.getByRole('region', { name: '核对本轮事实变化' })).toContainText('等客户回应后填写');

  // 客户：提醒点进任务页，上传新名册、写说明、勾选确认后提交
  const customer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(customer, 'feiyu@demo.genyun.net.cn', /\/customer/);
  await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  await customer.getByRole('button', { name: /周工请您确认企业事实/ }).first().click();
  await expect(customer.getByRole('region', { name: '请确认企业事实' })).toContainText('请确认应急联系人和电话');
  const card = customer.getByRole('region', { name: '本次需要您提供' });
  await expect(card).toContainText('需要确认：联系电话、联系人');
  await card.getByRole('button', { name: '提交本轮补充' }).click();
  await expect(card.getByRole('alert')).toHaveText('请上传文件或写补充说明');
  await card.locator('input[type=file]').setInputFiles(pdf('应急人员名册.pdf'));
  await expect(card).toContainText('应急人员名册.pdf');
  await card.getByRole('textbox').fill('新名册已生效，王某接替李某，电话 139 0000 3102');
  await card.getByRole('button', { name: '提交本轮补充' }).click();
  await expect(card.getByRole('alert')).toHaveText('请勾选确认');
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: '提交本轮补充' }).click();
  await expect(customer.getByRole('region', { name: '已提交的事实补件' })).toContainText('等待耕云核实');
  await customer.close();

  // 专家：收到提醒，点进来核实；不勾选确认不能采用
  await page.reload();
  await page.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  await page.getByRole('button', { name: /惠阳飞宇电器有限公司回应了事实补件/ }).click();
  await expect(page.getByRole('status')).toHaveText('补件待核实');
  const status = page.getByRole('region', { name: '本轮补件状态' });
  await expect(status).toContainText('新名册已生效，王某接替李某');
  await expect(status).toContainText('当前任务仍采用原资料');
  await expect(page.getByRole('complementary', { name: '原件与本轮客户回应' })).toContainText('应急人员名册.pdf');

  const table = page.getByRole('region', { name: '核对本轮事实变化' });
  await table.getByLabel('联系人本轮采用').fill('王某');
  await table.getByLabel('联系电话本轮采用').fill('139 0000 3102');
  await table.getByLabel('联系人核实依据').fill('新名册第 1 页');
  await page.getByRole('button', { name: '确认事实并采用到本任务' }).click();
  await expect(page.getByRole('alert')).toHaveText('请勾选确认');
  await page.getByRole('checkbox', { name: /已核对原件与客户确认/ }).check();
  await page.getByRole('button', { name: '确认事实并采用到本任务' }).click();
  await expect(page.getByText('已采用到本任务')).toBeVisible();

  // 采用后：等待重新生成，本轮已采用的值和依据留在表里
  await expect(page.getByRole('status')).toHaveText('等待重新生成');
  await expect(status).toContainText('本次资料已更新，原文稿尚未更新');
  await expect(table).toContainText('王某');
  await expect(table).toContainText('新名册第 1 页');
  await page.getByRole('button', { name: '重新生成三份草稿' }).click();
  await expect(page).toHaveURL(/view=confirm/);

  // 整理页里联系人已经是采用后的值
  await page.goto(page.url().replace(/\?.*$/, '?view=workup'));
  await expect(page.locator('[data-fact="contactPerson"]')).toContainText('王某');
});

import { expect, test, type Page } from '@playwright/test';

// M3 第 1 项：运营登记并开通客户组织（Paper 16 页 I02 客户组织、开通与邀请弹窗）
test.describe.configure({ mode: 'serial' });

const pdf = { name: '华东安评-年度服务合同-盖章版.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% 合同\n') };
const ORG = '华东安评服务有限公司';

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/operator$/);
});

test.afterAll(async () => {
  await page.close();
});

const row = (name: string) => page.getByRole('row').filter({ hasText: name });

test('列表：演示组织为服务中', async () => {
  await page.getByRole('menuitem', { name: /客户组织/ }).click();
  await expect(page.getByRole('heading', { name: '客户组织' })).toBeVisible();
  await expect(row('示例安全咨询机构')).toContainText('服务中');
  await expect(row('示例安全咨询机构')).toContainText('2026.01.01 – 2027.12.31');
  // 飞宇：三家企业（飞宇、五金、塑胶）、一个管理员
  await expect(row('飞宇演示客户')).toContainText('3 / 1');
  await page.screenshot({ path: 'out/m3-1-I02-list.png', fullPage: true });
});

test('登记：新组织进入待开通', async () => {
  await page.getByRole('button', { name: '登记客户组织' }).click();
  const dialog = page.getByRole('dialog', { name: '登记客户组织' });
  await dialog.getByRole('button', { name: '登记' }).click();
  await expect(dialog).toContainText('请填写组织名称');
  // 出错提示和下一个字段的标题之间至少留 8px
  await expect(dialog.getByText('请填写所在地区')).toBeVisible();
  const explain = await dialog.getByText('请填写组织名称').boundingBox();
  const nextLabel = await dialog.locator('label', { hasText: '所在地区' }).boundingBox();
  expect(nextLabel!.y - (explain!.y + explain!.height)).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: 'out/m3-1-register-errors.png' });

  await dialog.getByLabel('组织名称').fill(ORG);
  await dialog.getByLabel('所在地区').fill('上海市闵行区');
  await dialog.getByLabel('统一社会信用代码').fill('91310112MA1XXXXXX3');
  await dialog.getByLabel('主联系人').fill('孙经理');
  await dialog.getByLabel('手机号').fill('136 2254 1234');
  await dialog.getByLabel('邮箱').fill('sun@huadong-anping.cn');
  await page.screenshot({ path: 'out/m3-1-register.png' });
  await dialog.getByRole('button', { name: '登记' }).click();
  await expect(dialog).toBeHidden();

  await expect(row(ORG)).toContainText('待开通');
  await expect(row(ORG)).toContainText('136 **** 1234');
  await page.getByRole('tab', { name: /待开通/ }).click();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByRole('tab', { name: /全部/ }).click();
});

test('开通：缺合同原件或到账时不能开通，填齐后变为服务中', async () => {
  await row(ORG).getByRole('button', { name: `开通${ORG}` }).click();
  const dialog = page.getByRole('dialog', { name: /开通客户组织/ });
  await expect(dialog).toContainText('上海市闵行区 · 91310112MA1XXXXXX3');
  // 首位管理员默认带出主联系人
  await expect(dialog.getByLabel('姓名')).toHaveValue('孙经理');
  await expect(dialog.getByLabel('邮箱')).toHaveValue('sun@huadong-anping.cn');
  // 知识库还没有上海的属地机构：提醒但不拦
  await expect(dialog).toContainText('知识库还没有上海市闵行区的属地机构');

  const openButton = dialog.getByRole('button', { name: '开通并发送邀请' });
  await expect(openButton).toBeDisabled();
  await expect(dialog).toContainText('还差：合同编号、服务范围、已签合同原件、合同款已到账、合同有效期');

  await dialog.getByLabel('合同编号').fill('GY-HT-2026-018');
  await dialog.getByLabel('年度服务包含几家企业').fill('5');
  await dialog.getByLabel('选择已签合同原件').setInputFiles(pdf);
  await expect(dialog).toContainText(pdf.name);
  await dialog.getByLabel('合同有效期').click();
  await page.getByPlaceholder('开始日').fill('2026.11.01');
  await page.getByPlaceholder('到期日').fill('2027.10.31');
  await page.getByPlaceholder('到期日').press('Enter');
  await expect(dialog).toContainText('还差：合同款已到账');
  await expect(openButton).toBeDisabled();

  await dialog.getByLabel('合同款已到账').check();
  await expect(openButton).toBeEnabled();
  await page.screenshot({ path: 'out/m3-1-open-dialog.png' });
  await openButton.click();

  await expect(page.getByText('已开通，邀请已发到 sun@huadong-anping.cn')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(row(ORG)).toContainText('服务中');
  await expect(row(ORG)).toContainText('2026.11.01 – 2027.10.31');
  await expect(row(ORG)).toContainText('0 / 0');
  await page.screenshot({ path: 'out/m3-1-I02-after-open.png', fullPage: true });

  // 小屏不出现横向滚动条
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'out/m3-1-I02-1366.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('模拟发件箱：邀请邮件在这里，能看全文、能复制链接', async () => {
  await page.goto('/operator/mail-outbox');
  await expect(page.getByRole('heading', { name: '模拟发件箱' })).toBeVisible();
  // 侧栏这时出现「模拟发件箱」并高亮，不高亮「运营概览」
  await expect(page.getByRole('menuitem', { name: '模拟发件箱' })).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('menuitem', { name: '运营概览' })).not.toHaveClass(/ant-menu-item-selected/);
  const mail = page.getByRole('row').filter({ hasText: 'sun@huadong-anping.cn' }).first();
  await expect(mail).toContainText('邀请');
  await expect(mail).toContainText('耕云运营邀请您加入「华东安评服务有限公司」');
  await expect(mail.getByText('复制链接')).toBeVisible();
  // 点开看纯文本：称呼、链接、有效期、落款
  await mail.click();
  await page.getByText('纯文本').click();
  await expect(page.getByText('孙经理，您好：')).toBeVisible();
  await expect(page.getByRole('link', { name: /\/invite\// })).toBeVisible();
  await expect(page.getByText(/链接有效期至 \d{4} 年 \d{1,2} 月 \d{1,2} 日 \d{2}:\d{2}（北京时间），只能使用一次/)).toBeVisible();
  await page.getByText('邮件样式').click();
  const frame = page.frameLocator('iframe[title*="邮件样式"]');
  await expect(frame.getByRole('link', { name: '接受邀请' })).toBeVisible();
  await expect(frame.getByText('耕云 · 0752-5200831')).toBeVisible();
  // 预览框高度跟着内容走：框里不用再滚动
  const fits = await page.locator('iframe[title*="邮件样式"]').evaluate((f: HTMLIFrameElement) => {
    const d = f.contentDocument!.documentElement;
    return d.scrollHeight <= f.clientHeight + 2;
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: 'out/m4-4-mail-outbox.png', fullPage: true });
});

test('客户账号进不了运营的客户组织接口和模拟发件箱', async ({ browser }) => {
  const customer = await browser.newPage();
  await customer.goto('/login');
  await customer.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await customer.getByPlaceholder('请输入密码').fill('e2e-password');
  await customer.getByRole('button', { name: /登\s*录/ }).click();
  await expect(customer).toHaveURL(/\/customer$/);
  expect((await customer.request.get('/api/operator/organizations')).status()).toBe(403);
  expect((await customer.request.get('/api/dev/outbox')).status()).toBe(403);
  await customer.close();
});

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

// 客户成果文档（11 页 C06；15 页 R05 交付详情）。在线阅读和版本记录已取消，客户只看得到最新一次交付。
// 文件名排在 task-publish.spec 之后：飞宇已交付。客户能看到、下载三份 Word 与整套压缩包；
// 别家客户（演示里的另一个客户组织）拿不到
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    // 1366 下没有横向滚动
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/acceptance/m2-16-${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test.setTimeout(180_000);

test('客户在成果文档里看到已交付的成果，下载三份 Word 和整套', async ({ page, browser }) => {
  await login(page, 'feiyu@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer/);

  // 工作台「最近交付」写明已交付（不显示 V1、V2），点进去就是交付详情
  const recent = page.getByRole('region', { name: '最近交付' });
  await expect(recent).toContainText(/(交付|更新)，三份 Word 可下载/);
  await expect(recent).not.toContainText(/V\d/);
  await recent.getByRole('button', { name: /^查看成果 惠阳飞宇/ }).first().click();
  await expect(page).toHaveURL(/\/customer\/documents\/[0-9a-f-]{36}$/);
  const taskId = page.url().split('/').pop()!;

  // 成果文档列表（C06）
  await page.getByRole('menuitem', { name: '成果文档' }).click();
  await expect(page).toHaveURL(/\/customer\/documents$/);
  const card = page.getByRole('region', { name: /惠阳飞宇电器有限公司 GY-\d{4}-\d{3}/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('已交付');
  await expect(card).not.toContainText(/V\d/);
  for (const name of ['应急预案', '风险评估报告', '应急资源调查报告']) await expect(card.getByText(`惠阳飞宇电器有限公司${name}.docx`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/1[3-9]\d{9}/);
  await shots(page, 'documents');

  // 搜索：任务编号、文档名都能找到；找不到时提示
  const search = page.getByRole('textbox', { name: '搜索成果' });
  await search.fill('风险评估');
  await expect(card).toBeVisible();
  await search.fill('不存在的企业');
  await expect(page.getByText('没有符合条件的成果')).toBeVisible();
  await search.fill('');

  // 单份下载（列表里的「下载」）
  const one = page.waitForEvent('download');
  await card.getByRole('button', { name: '下载 惠阳飞宇电器有限公司应急预案.docx' }).click();
  const word = await one;
  expect(word.suggestedFilename()).toBe('惠阳飞宇电器有限公司应急预案.docx');
  const wordZip = await JSZip.loadAsync(await readFile((await word.path())!));
  expect(wordZip.file('word/document.xml')).not.toBeNull();

  // 交付详情（R05）：整套下载是一个压缩包，里面正好三份 Word
  await card.getByRole('button', { name: '查看交付详情' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/documents/${taskId}$`));
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司 · 编制成果' })).toBeVisible();
  await expect(page.getByRole('region', { name: '交付文件' })).toContainText(/已交付|已更新/);
  await expect(page.locator('main')).not.toContainText(/V\d/);
  await shots(page, 'delivery');
  const bundle = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载整套 Word' }).click();
  const zipFile = await bundle;
  // 压缩包名写企业名和交付日期（北京时间），不写版本号
  const publishedAt: string = (await (await page.request.get(`/api/tasks/${taskId}/deliveries`)).json()).versions[0].publishedAt;
  const day = new Date(publishedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  expect(zipFile.suggestedFilename()).toBe(`惠阳飞宇电器有限公司编制成果（${day}）.zip`);
  const zip = await JSZip.loadAsync(await readFile((await zipFile.path())!));
  expect(Object.keys(zip.files).sort()).toEqual(
    ['惠阳飞宇电器有限公司应急预案.docx', '惠阳飞宇电器有限公司应急资源调查报告.docx', '惠阳飞宇电器有限公司风险评估报告.docx'].sort(),
  );

  // 反馈入口：提交给耕云受理（带上这个任务和交付时间），不显示专家电话
  await page.getByRole('button', { name: '联系客服', exact: true }).click();
  const feedback = page.getByRole('dialog', { name: '反馈文稿问题' });
  await expect(feedback).toContainText('惠阳飞宇电器有限公司 · ');
  await expect(feedback).toContainText(/\d{4}\.\d{2}\.\d{2}.*已交付/);
  await expect(feedback).not.toContainText(/1[3-9]\d[ -]?\d{4}[ -]?\d{4}/);
  await feedback.getByLabel('您的意见').fill('应急预案第 3 页值班电话写错了');
  await feedback.getByRole('button', { name: '提交反馈' }).click();
  await expect(page.getByRole('dialog')).toContainText('感谢您的反馈');
  await page.getByRole('dialog').getByRole('button', { name: '返回原页面' }).click();
  // 反馈不影响成果：交付详情照常可下载
  await expect(page.getByRole('button', { name: '下载整套 Word' })).toBeEnabled();

  // 任务「已交付」写明成果已交付（不显示版本号）
  await page.goto('/customer/tasks?tab=delivered');
  const row = page.locator('[data-testid^="task-GY-"]').filter({ hasText: '惠阳飞宇电器有限公司' }).first();
  await expect(row).toContainText(/成果已(交付|更新)，三份 Word 可以下载/);

  // 旧地址（在线阅读、旧的填写向导）收藏过的：跳到现在对应的页面，不进登录页
  await page.goto(`/customer/documents/${taskId}/read/plan`);
  await expect(page).toHaveURL(new RegExp(`/customer/documents/${taskId}$`));
  for (const old of ['start', 'fill/2']) {
    await page.goto(`/customer/tasks/${taskId}/${old}`);
    await expect(page).toHaveURL(new RegExp(`/customer/tasks/${taskId}$`));
  }

  // 别家客户组织的人拿不到：详情、整套一律 404（在线阅读的 PDF 地址已取消，也是 404），直接打开页面显示找不到
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, 'admin@demo.genyun.net.cn');
  await expect(other).toHaveURL(/\/customer/);
  for (const path of ['', '/1/bundle', '/1/plan/pdf']) expect((await other.request.get(`/api/tasks/${taskId}/deliveries${path}`)).status()).toBe(404);
  await other.goto(`/customer/documents/${taskId}`);
  await expect(other.getByText('找不到这份成果')).toBeVisible();
  await ctx.close();
});

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

// 客户成果文档（11 页 C06；15 页 R05 交付详情、R06 在线阅读）。
// 文件名排在 task-publish.spec 之后：飞宇已发布交付 V1。客户能看到、在线阅读、下载三份 Word 与整套压缩包；
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

test('客户在成果文档里看到交付 V1，在线阅读，下载三份 Word 和整套', async ({ page, browser }) => {
  await login(page, 'feiyu@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/customer/);

  // 工作台「最近交付」写明交付版本，点进去就是交付详情
  const recent = page.getByRole('region', { name: '最近交付' });
  await expect(recent).toContainText('交付 V1');
  await recent.getByRole('button', { name: /查看编制成果/ }).click();
  await expect(page).toHaveURL(/\/customer\/documents\/[0-9a-f-]{36}$/);
  const taskId = page.url().split('/').pop()!;

  // 成果文档列表（C06）
  await page.getByRole('menuitem', { name: '成果文档' }).click();
  await expect(page).toHaveURL(/\/customer\/documents$/);
  const card = page.getByRole('region', { name: /惠阳飞宇电器有限公司 V1/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('V1 · 最新');
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
  await expect(page.getByText('三份文档已交付 · V1 当前版本')).toBeVisible();
  await expect(page.getByText('V1 是本任务首次交付，当前暂无旧交付版本。')).toBeVisible();
  await shots(page, 'delivery');
  const bundle = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载整套 Word' }).click();
  const zipFile = await bundle;
  expect(zipFile.suggestedFilename()).toBe('惠阳飞宇电器有限公司编制成果（交付 V1）.zip');
  const zip = await JSZip.loadAsync(await readFile((await zipFile.path())!));
  expect(Object.keys(zip.files).sort()).toEqual(
    ['惠阳飞宇电器有限公司应急预案.docx', '惠阳飞宇电器有限公司应急资源调查报告.docx', '惠阳飞宇电器有限公司风险评估报告.docx'].sort(),
  );

  // 反馈入口：联系耕云，不显示注安师电话
  await page.getByRole('button', { name: '反馈文稿问题' }).click();
  await expect(page.getByRole('dialog', { name: '反馈文稿问题' })).toContainText('0752-5200831');
  await page.keyboard.press('Escape');

  // 在线阅读（R06）：发布时那一版的版式，可翻页
  await page.getByRole('link', { name: '在线阅读 惠阳飞宇电器有限公司应急预案.docx' }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/documents/${taskId}/read/plan\\?v=1`));
  await expect(page.getByRole('heading', { name: '应急预案 · V1' })).toBeVisible();
  await expect(page.getByText(/\/ \d+ 页/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: '第 1 页' })).toBeVisible();
  await page.waitForTimeout(500);
  await shots(page, 'reader');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载此 Word' }).click();
  expect((await download).suggestedFilename()).toBe('惠阳飞宇电器有限公司应急预案.docx');
  await page.getByRole('link', { name: /返回惠阳飞宇电器有限公司的编制成果/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/documents/${taskId}$`));

  // 业务任务「已交付」写明交付版本，点进去是交付详情；任务页「成果版本」列出 V1
  await page.goto('/customer/tasks?tab=delivered');
  const row = page.getByRole('row', { name: /惠阳飞宇电器有限公司/ });
  await expect(row).toContainText('已发布交付 V1，可查看和下载');
  await page.goto(`/customer/tasks/${taskId}?tab=versions`);
  await expect(page.getByText('交付 V1')).toBeVisible();

  // 别家客户组织的人拿不到：详情、整套、在线阅读一律 404，直接打开页面显示找不到
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, 'admin@demo.genyun.net.cn');
  await expect(other).toHaveURL(/\/customer/);
  for (const path of ['', '/1/bundle', '/1/plan/pdf']) expect((await other.request.get(`/api/tasks/${taskId}/deliveries${path}`)).status()).toBe(404);
  await other.goto(`/customer/documents/${taskId}`);
  await expect(other.getByText('找不到这份成果')).toBeVisible();
  await ctx.close();
});

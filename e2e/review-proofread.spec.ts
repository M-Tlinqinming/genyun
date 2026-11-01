import { expect, test, type Page } from '@playwright/test';

// Word 校对与审核结论（14 页 E18-05、E18-06）。
// 文件名排在 review-editing.spec 之后：飞宇的三份草稿已生成，应急预案已有一节修订。
// 测试环境的当前稿 PDF 用假的转换（几页英文），只看逐页显示、翻页和缩放能用。
async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  await page.getByRole('button', { name: '进入正文编辑' }).click();
  await expect(page.getByRole('textbox', { name: '本节正文' })).toBeVisible();
}

const docTab = (page: Page, name: string) => page.getByRole('tablist', { name: '三份文档' }).getByRole('tab', { name: new RegExp(name) });
const checkBar = (page: Page) => page.getByRole('region', { name: '核对本份' });

/** 两种宽度各截一张：1366×768 和 1440 */
async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/acceptance/m2-12-${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/** 在 Word 预览里核对当前这一份 */
async function checkThis(page: Page, button: RegExp) {
  await expect(page.getByText(/第 \d 页 \/ 4/)).toBeVisible({ timeout: 30_000 });
  const confirm = checkBar(page).getByRole('button', { name: button });
  await expect(confirm).toBeDisabled();
  await checkBar(page).getByRole('checkbox').check();
  await confirm.click();
}

/** 回到正文改一节并保存 */
async function editAndSave(page: Page, text: string) {
  await page.getByRole('tab', { name: '正文', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '本节正文' });
  await expect(editor).toBeVisible();
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.getByLabel('修订说明').fill('核对时发现措辞要改');
  await page.getByRole('button', { name: '保存本节修订' }).click();
  await expect(page.getByRole('region', { name: '保存本节' })).toContainText('修订已保存');
}

test.setTimeout(300_000);

test('逐份看 Word 版式并核对；改正文后该份回到待核对；三份核对完确认审核结论，再改就失效', async ({ page }) => {
  await login(page);
  await expect(page.getByText('人工核对 0 / 3', { exact: true })).toBeVisible();

  // E18-05：Word 预览逐页显示当前稿，翻页、缩放
  await page.getByRole('tab', { name: 'Word 预览' }).click();
  await expect(page).toHaveURL(/tab=preview/);
  await expect(page.getByText(/第 1 页 \/ 4/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: '第 1 页' }).locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第 2 页 / 4')).toBeVisible();
  const percent = page.getByRole('toolbar', { name: '页面工具' }).getByText(/^\d+%$/);
  const before = await percent.textContent();
  await page.getByRole('button', { name: '放大' }).click();
  await expect(percent).not.toHaveText(before!);
  await page.getByRole('button', { name: '适合宽度' }).click();
  await expect(percent).toHaveText(before!);
  await expect(page.getByRole('complementary', { name: '本份核对提示' })).toContainText('保存后，本份核对确认将失效');
  await expect(checkBar(page)).toContainText('确认后记为 1 / 3，并打开风险评估报告。');
  await shots(page, 'preview');

  // 核对应急预案，自动打开风险评估报告
  await checkThis(page, /确认本份并核对下一份/);
  await expect(page).toHaveURL(/doc=risk/);
  await expect(page).toHaveURL(/tab=preview/);
  await expect(docTab(page, '应急预案')).toContainText('已核对');
  await expect(page.getByText('人工核对 1 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '正在人工核对' })).toBeVisible();

  // 验收：核对完一份后改正文，该份回到待核对
  await docTab(page, '应急预案').click();
  await expect(checkBar(page)).toContainText('本份已核对');
  await editAndSave(page, '（核对后补充）');
  await expect(docTab(page, '应急预案')).toContainText('需重新核对');
  await expect(page.getByText('人工核对 0 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '保存本节' })).toContainText('本份需重新核对');
  await page.getByRole('button', { name: '查看 Word 并核对' }).click();
  // 改过正文：按新稿重新排版后再核对
  await expect(checkBar(page)).toContainText('本份在核对后又保存了修订');

  // 三份逐份核对，最后一份核对完进审核结论
  await checkThis(page, /确认本份并核对下一份/);
  await expect(page).toHaveURL(/doc=risk/);
  await checkThis(page, /确认本份并核对下一份/);
  await expect(page).toHaveURL(/doc=resource/);
  await expect(checkBar(page)).toContainText('确认后记为 3 / 3，接着确认审核结论。');
  await checkThis(page, /确认本份，去确认审核结论/);

  // E18-06：三份都核对过，确认审核结论
  await expect(page).toHaveURL(/view=review/);
  await expect(page.getByRole('heading', { name: '三份文稿已核对，确认本次审核结论' })).toBeVisible();
  await expect(page.getByText('人工核对 3 / 3 · 核对记录均对应当前保存稿。')).toBeVisible();
  const records = page.getByRole('region', { name: '三份文稿的核对记录' });
  await expect(records.getByRole('row')).toHaveCount(4);
  await expect(records.getByRole('row', { name: /应急预案/ })).toContainText('✓ 周工');
  const approve = page.getByRole('button', { name: '确认审核通过，进入发布' });
  await expect(approve).toBeDisabled();
  await expect(page.getByLabel('审核结论', { exact: true })).toHaveValue(/企业名称、联系人等关键信息一致/);
  await page.getByRole('checkbox', { name: /确认以上结论对应当前保存稿/ }).check();
  await shots(page, 'conclusion');
  await approve.click();
  await expect(page.getByRole('heading', { name: '本次审核已通过' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '审核已通过' }).first()).toBeVisible();
  await shots(page, 'passed');

  // 审核后再改一份：结论失效，要重新核对那一份
  await records.getByRole('button', { name: '查看文稿' }).nth(1).click();
  await expect(page).toHaveURL(/doc=risk/);
  await editAndSave(page, '（审核后又改）');
  await expect(docTab(page, '风险评估报告')).toContainText('需重新核对');
  await page.goto(page.url().replace(/\?.*$/, '?view=review'));
  await expect(page.getByRole('heading', { name: '还有文稿没有核对' })).toBeVisible();
  await expect(page.getByText(/审核结论已失效：风险评估报告在审核后又保存了修订/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认审核通过，进入发布' })).toBeDisabled();
});

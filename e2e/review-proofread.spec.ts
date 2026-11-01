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

/** 回到正文改一节并保存；passed = 审核已通过，保存前要确认结论失效 */
async function editAndSave(page: Page, text: string, passed = false) {
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '正文', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '本节正文' });
  await expect(editor).toBeVisible();
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.getByLabel('修订说明').fill('核对时发现措辞要改');
  await page.getByRole('button', { name: '保存本节修订' }).click();
  if (passed) {
    const lapse = page.getByRole('dialog', { name: '保存后审核结论将失效' });
    await expect(lapse).toContainText('本次审核已通过。保存修订后，需要重新核对并确认审核结论。');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/acceptance/m2-12-lapse-confirm-1440.png' });
    // 先取消：没有保存，还在编辑
    await lapse.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('region', { name: '保存本节' })).not.toContainText('修订已保存');
    await page.getByRole('button', { name: '保存本节修订' }).click();
    await page.getByRole('dialog', { name: '保存后审核结论将失效' }).getByRole('button', { name: '仍然保存' }).click();
  }
  await expect(page.getByRole('region', { name: '保存本节' })).toContainText('修订已保存');
}

test.setTimeout(300_000);

test('逐份看 Word 版式并核对；改正文后该份回到待核对；三份核对完确认审核结论，再改就失效', async ({ page }) => {
  await login(page);
  await expect(page.getByText('人工核对 0 / 3', { exact: true })).toBeVisible();
  // 三份文档页签：左右方向键切换
  await docTab(page, '应急预案').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/doc=risk/);
  await expect(docTab(page, '风险评估报告')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/doc=plan/);
  await expect(page.getByRole('tabpanel', { name: /应急预案/ })).toHaveCount(1);

  // Word 预览的几种状态（转换中、转换失败、不能显示）：模拟后台的回答截图
  for (const [status, name, text] of [
    ['converting', 'converting', '通常需要一分钟左右'],
    ['failed', 'convert-failed', '也可以先下载校对稿，在 Word 里核对'],
    ['unavailable', 'unavailable', '暂时不能在页面里显示 Word 版式'],
  ] as const) {
    await page.route('**/api/tasks/*/drafts/plan/preview', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status, version: 1, error: status === 'failed' ? '当前稿转换没有成功' : null }) }),
    );
    await page.goto(page.url().replace(/\?.*$/, '?view=edit&doc=plan&tab=preview'));
    await expect(page.getByRole('region', { name: 'Word 预览' })).toContainText(text);
    await expect(page.getByRole('region', { name: 'Word 预览' })).not.toContainText('这台服务器');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/acceptance/m2-12-${name}-1440.png` });
    await page.unrouteAll();
  }
  await page.goto(page.url().replace(/\?.*$/, '?view=edit&doc=plan'));
  await expect(page.getByRole('textbox', { name: '本节正文' })).toBeVisible();

  // E18-05：Word 预览逐页显示当前稿，翻页、缩放
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: 'Word 预览', exact: true }).click();
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
  // 自动打开下一份后焦点在页面标题上
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(docTab(page, '应急预案')).toContainText('已核对');
  await expect(page.getByText('人工核对 1 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '正在人工核对' })).toBeVisible();

  // 验收：核对完一份后改正文，该份回到待核对
  await docTab(page, '应急预案').click();
  await expect(checkBar(page)).toContainText('本份已核对');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-checked-1440.png' });
  await editAndSave(page, '（核对后补充）');
  await expect(docTab(page, '应急预案')).toContainText('需重新核对');
  await expect(page.getByText('人工核对 0 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '保存本节' })).toContainText('本份需重新核对');
  await page.getByRole('button', { name: '查看 Word 并核对' }).click();
  // 改过正文：按新稿重新排版后再核对；底栏三行时预览区不被盖住，和底栏隔 24
  await expect(checkBar(page)).toContainText('本份在核对后又保存了修订');
  await expect(page.getByText(/第 \d 页 \/ 4/)).toBeVisible({ timeout: 30_000 });
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const preview = await page.getByRole('region', { name: 'Word 预览' }).boundingBox();
    const bar = await checkBar(page).boundingBox();
    expect(bar!.y - (preview!.y + preview!.height)).toBeGreaterThanOrEqual(23);
    await page.screenshot({ path: `test-results/acceptance/m2-12-stale-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

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
  await expect(page.getByRole('heading', { name: '三份文稿已核对，确认本次审核结论' })).toBeFocused();
  await expect(page.getByText('人工核对 3 / 3 · 核对记录均对应当前保存稿。')).toBeVisible();
  const records = page.getByRole('region', { name: '三份文稿的核对记录' });
  await expect(records.getByRole('row')).toHaveCount(4);
  await expect(records.getByRole('row', { name: /应急预案/ })).toContainText('✓ 周工');
  const approve = page.getByRole('button', { name: '确认审核通过，进入发布' });
  await expect(approve).toBeDisabled();
  await expect(page.getByLabel('审核结论', { exact: true })).toHaveValue(/企业名称、联系人等关键信息一致/);
  await page.getByRole('checkbox', { name: /确认以上结论对应当前保存稿/ }).check();
  await shots(page, 'conclusion');
  // 结论空着提交：报错，焦点回到结论输入框
  const noteBox = page.getByLabel('审核结论', { exact: true });
  const defaultNote = await noteBox.inputValue();
  await noteBox.fill('');
  await approve.click();
  await expect(page.getByRole('alert').filter({ hasText: '请填写审核结论' })).toBeVisible();
  await expect(noteBox).toBeFocused();
  await noteBox.fill(defaultNote);
  await approve.click();
  await expect(page.getByRole('heading', { name: '本次审核已通过' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '审核已通过' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '本次审核已通过' })).toBeFocused();
  await shots(page, 'passed');

  // 审核通过后：Word 预览底栏写「审核已通过」，按钮是「查看审核结论」
  await records.getByRole('button', { name: '查看文稿' }).nth(1).click();
  await expect(page).toHaveURL(/doc=risk/);
  await expect(checkBar(page)).toContainText('审核已通过');
  await expect(checkBar(page).getByRole('button', { name: '查看审核结论' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-passed-preview-1440.png' });
  // 正文页：状态标签绿色「审核已通过」，编辑区上方提示保存后要重新核对
  await page.getByRole('group', { name: '查看方式' }).getByRole('button', { name: '正文', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '审核已通过' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('本次审核已通过，保存修订后需重新核对并确认审核结论');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-passed-edit-1440.png' });

  // 审核后再改一份：先确认结论失效，再保存；要重新核对那一份
  await editAndSave(page, '（审核后又改）', true);
  await expect(docTab(page, '风险评估报告')).toContainText('需重新核对');
  await page.goto(page.url().replace(/\?.*$/, '?view=review'));
  await expect(page.getByRole('heading', { name: '还有文稿没有核对' })).toBeVisible();
  await expect(page.getByText(/审核结论已失效：风险评估报告在审核后又保存了修订/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认审核通过，进入发布' })).toBeDisabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-lapsed-1440.png' });
});

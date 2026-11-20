import { expect, test, type Page } from '@playwright/test';

// 核对定稿 · Word 预览、逐份核对、审核结论（14 页 E18-05、E18-06、E18-06b、E18-09、E18-12）。
// 文件名排在 review-editing.spec 之后：飞宇的三份草稿已生成，应急预案已改过几节。
// 测试环境的 Word 预览用假的转换（几页英文），只看逐页显示和缩放能用。
async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
}

const docTab = (page: Page, name: string) => page.getByRole('tablist', { name: '三份文稿' }).getByRole('tab', { name: new RegExp(name) });
const article = (page: Page) => page.getByRole('article', { name: '正文' });
const checkButton = (page: Page) => page.getByRole('button', { name: '这一份核对完成' });
const preview = (page: Page) => page.getByRole('region', { name: 'Word 预览' });

/** 两种宽度各截一张：1366×768 和 1440 */
async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/acceptance/m2-12-${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/** 正文里改第一节并保存；passed = 审核结论已写好，保存前要确认结论要重写 */
async function editAndSave(page: Page, text: string, passed = false) {
  await article(page).getByRole('button', { name: /^修改这一节 / }).first().click();
  const editor = page.getByRole('textbox', { name: '本节正文' });
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.getByRole('button', { name: '保存这一节' }).click();
  if (passed) {
    const lapse = page.getByRole('dialog', { name: '保存后审核结论要重写' });
    await expect(lapse).toContainText('保存后这一份要重新核对，审核结论也要重写');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/acceptance/m2-12-lapse-confirm-1440.png' });
    // 先不保存：还在编辑
    await lapse.getByRole('button', { name: '先不保存' }).click();
    await expect(editor).toBeVisible();
    await page.getByRole('button', { name: '保存这一节' }).click();
    await page.getByRole('dialog', { name: '保存后审核结论要重写' }).getByRole('button', { name: '仍然保存' }).click();
  }
  await expect(page.getByText(/^已保存 · /)).toBeVisible();
}

test.setTimeout(300_000);

test('看 Word 预览；逐份核对、自动打开下一份；核对后再改要重新核对；三份核对完写审核结论，定稿并交付', async ({ page }) => {
  await login(page);
  const base = page.url().replace(/\?.*$/, '');
  await page.goto(`${base}?view=edit&doc=plan`);
  await expect(page.getByText('已核对 0 / 3', { exact: true })).toBeVisible();
  // 三份文稿页签：左右方向键切换
  await docTab(page, '应急预案').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/doc=risk/);
  await expect(docTab(page, '风险评估报告')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/doc=plan/);

  // Word 预览的几种状态（排版中、没排出来、不能显示）：模拟后台的回答截图
  for (const [status, name, text] of [
    ['converting', 'converting', '正在按'],
    ['failed', 'convert-failed', 'Word 预览没排出来'],
    ['unavailable', 'unavailable', '下载 Word'],
  ] as const) {
    await page.route('**/api/tasks/*/drafts/plan/preview', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status, version: 1, error: status === 'failed' ? '没有转换成功' : null }) }),
    );
    await page.goto(`${base}?view=edit&doc=plan&tab=preview`);
    await expect(preview(page)).toContainText(text);
    if (status === 'failed') {
      // 没排出来可以切回正文
      await expect(preview(page).getByRole('button', { name: '切回正文' })).toBeVisible();
      await expect(preview(page).getByRole('button', { name: '重新排版' })).toBeVisible();
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/acceptance/m2-12-${name}-1440.png` });
    await page.unrouteAll();
  }

  // E18-05：Word 预览逐页显示、缩放；只看版式，核对不用等它
  await page.goto(`${base}?view=edit&doc=plan`);
  await expect(article(page)).toBeVisible();
  await page.getByRole('radiogroup', { name: '正文或 Word 预览' }).getByRole('radio', { name: 'Word 预览' }).click();
  await expect(page).toHaveURL(/tab=preview/);
  await expect(preview(page)).toContainText(/第 1 页，共 4 页 · 按/, { timeout: 30_000 });
  const percent = page.getByRole('toolbar', { name: '页面工具' }).getByText(/^\d+%$/);
  // 适合宽度的比例要等页面排好（滚动条出现后会再算一次）
  let before = 0;
  await expect(async () => {
    const a = await percent.textContent();
    await page.waitForTimeout(300);
    expect(await percent.textContent()).toBe(a);
    before = parseInt(a!, 10);
  }).toPass();
  await page.getByRole('button', { name: '放大' }).click();
  await expect.poll(async () => parseInt((await percent.textContent())!, 10)).toBeGreaterThan(before);
  await shots(page, 'preview');
  await page.getByRole('radiogroup', { name: '正文或 Word 预览' }).getByRole('radio', { name: '正文' }).click();
  await expect(page).not.toHaveURL(/tab=preview/);

  // 核对应急预案，自动打开风险评估报告
  await checkButton(page).click();
  await expect(page).toHaveURL(/doc=risk/);
  await expect(docTab(page, '应急预案')).toContainText('已核对');
  await expect(page.getByText('已核对 1 / 3', { exact: true })).toBeVisible();

  // 核对完一份后再改，回到「改过，待重新核对」
  await docTab(page, '应急预案').click();
  await expect(page.getByRole('button', { name: '已核对' })).toBeDisabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-checked-1440.png' });
  await editAndSave(page, '（核对后补充）');
  await expect(docTab(page, '应急预案')).toContainText('改过，待重新核对');
  await expect(page.getByText('已核对 0 / 3', { exact: true })).toBeVisible();
  await shots(page, 'stale');

  // 三份逐份核对：每份核对完自动打开下一份没核对的，最后进审核结论
  await checkButton(page).click();
  await expect(page).toHaveURL(/doc=risk/);
  await checkButton(page).click();
  await expect(page).toHaveURL(/doc=resource/);
  await checkButton(page).click();
  await expect(page).toHaveURL(/tab=conclusion/);

  // E18-06：三份都核对过，写审核结论
  await expect(page.getByRole('heading', { name: '三份都已核对，写下审核结论' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /审核结论/ })).toContainText('待填写');
  const table = page.getByRole('table', { name: '三份文稿' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('row', { name: /应急预案/ })).toContainText('已核对');
  const noteBox = page.getByRole('textbox', { name: '审核结论' });
  await expect(noteBox).toHaveValue('');
  await shots(page, 'conclusion');
  // E18-06b：没写就点，报错，光标回到结论框
  await page.getByRole('button', { name: '定稿并交付' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请写下审核结论' })).toBeVisible();
  await expect(noteBox).toBeFocused();
  await shots(page, 'conclusion-error');
  await noteBox.fill('三份文稿已逐章核对，组织机构、联系人和物资数量与资料一致。');
  await page.getByRole('button', { name: '定稿并交付' }).click();
  await expect(page).toHaveURL(/view=publish/);
  await expect(page.getByRole('heading', { name: '审核已通过，等待交付' })).toBeVisible();

  // 交付前再改一份：先确认结论要重写，再保存；这一份要重新核对，审核结论页签收起
  await page.goto(`${base}?view=edit&doc=risk`);
  await expect(page.getByRole('tab', { name: /审核结论/ })).toContainText('已填写');
  await editAndSave(page, '（写完结论后又改）', true);
  await expect(docTab(page, '风险评估报告')).toContainText('改过，待重新核对');
  await expect(page.getByRole('tab', { name: /审核结论/ })).toHaveCount(0);
  // 旧网址 ?view=review 也打开核对定稿页
  await page.goto(`${base}?view=review`);
  await expect(page.getByRole('tablist', { name: '三份文稿' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-12-lapsed-1440.png' });
});

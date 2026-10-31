import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// 审核与修订 · 正文编辑（14 页 E18-03、E18-04、E18-07、E18-08）。
// 文件名排在 generation.spec 之后（generation_xxx 会排到它前面）：那时飞宇的三份草稿已生成。
async function openEditing(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  await page.getByRole('button', { name: '进入正文编辑' }).click();
  await expect(page).toHaveURL(/view=edit/);
  await expect(page.getByRole('navigation', { name: '章节目录' })).toBeVisible();
  await expect(editor(page)).toBeVisible();
}

const editor = (page: Page) => page.getByRole('textbox', { name: '本节正文' });
const footer = (page: Page) => page.getByRole('region', { name: '保存本节' });

interface Outline {
  id: string;
  children: Outline[];
}

async function firstSection(page: Page) {
  const taskId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
  const doc = (await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/edit`)).json()) as { outline: Outline[]; batchId: string };
  let n = doc.outline[0]!;
  while (n.children.length) n = n.children[0]!;
  return { taskId, sectionId: n.id, batchId: doc.batchId, outline: doc.outline };
}

/** 找一节带锁定表格的（截图用） */
async function sectionWithTable(page: Page, taskId: string, outline: Outline[]): Promise<string | null> {
  const ids: string[] = [];
  const walk = (list: Outline[]) => list.forEach((n) => (n.children.length ? walk(n.children) : ids.push(n.id)));
  walk(outline);
  for (const id of ids) {
    const s = (await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/sections/${id}`)).json()) as { locked: { kind: string }[] };
    if (s.locked.some((l) => l.kind === 'table')) return id;
  }
  return null;
}

/** 两种宽度各截一张：1366×768 和 1440 */
async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/acceptance/m2-11-${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test.setTimeout(300_000);

test('改一节、写修订说明保存；离开前提醒；别人刚保存过要先对照；保存失败可重试', async ({ page }) => {
  await openEditing(page);
  await expect(page.getByRole('status').filter({ hasText: '待人工核对' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /应急预案/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('人工核对 0 / 3')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-11-open.png' });

  // E18-03：改了就是未保存；没写修订说明不能保存
  await typeAtEnd(page, '（专家补充：按现场核实）');
  await expect(page.getByText('● 未保存')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '修订未保存' })).toBeVisible();
  await expect(footer(page)).toContainText('有未保存修订 · 保存成功后才能进行全文核对');
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请写修订说明' })).toBeVisible();
  await page.getByLabel('修订说明').fill('按现场核实补充说明');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-11-unsaved.png' });

  // E18-04：保存后显示保存时间，目录标出已改，修订说明只读显示
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  await expect(page.getByText(/✓ 已保存 \d\d\.\d\d \d\d:\d\d/)).toBeVisible();
  await expect(footer(page)).toContainText('修订已保存 · 人工核对仍为 0 / 3');
  await expect(page.getByRole('status').filter({ hasText: '已保存 · 待人工核对' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '章节目录' }).getByLabel('已修订')).toHaveCount(1);
  await expect(page.getByLabel('本节修订说明')).toContainText('修订说明：按现场核实补充说明');
  await page.screenshot({ path: 'test-results/acceptance/m2-11-saved.png' });

  // 当前稿 Word 带上了修订
  const { taskId, sectionId, batchId, outline } = await firstSection(page);
  const word = await JSZip.loadAsync(await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/word`)).body());
  expect(await word.file('word/document.xml')!.async('string')).toContain('专家补充：按现场核实');

  // 刷新后还在：内容是保存后的
  await page.reload();
  await expect(editor(page)).toContainText('专家补充：按现场核实');

  // E18-07 离开前保存：切换文档时提醒；继续编辑留在本页，不保存就离开丢掉输入
  await typeAtEnd(page, '再改一处');
  await page.getByRole('tab', { name: /风险评估报告/ }).click();
  const leave = page.getByRole('dialog', { name: '离开前保存修改？' });
  await expect(leave).toContainText('不保存就离开，本次输入会丢弃；已保存稿不变');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-11-leave.png' });
  // 没写修订说明就点「保存并离开」：留在本页，光标到修订说明
  await leave.getByRole('button', { name: '保存并离开' }).click();
  await expect(page.getByLabel('修订说明')).toBeFocused();
  await expect(page).not.toHaveURL(/doc=risk/);
  await page.getByRole('tab', { name: /风险评估报告/ }).click();
  await page.getByRole('dialog', { name: '离开前保存修改？' }).getByRole('button', { name: '继续编辑' }).click();
  await expect(page).not.toHaveURL(/doc=risk/);
  await expect(editor(page)).toContainText('再改一处');
  await page.getByRole('tab', { name: /风险评估报告/ }).click();
  await page.getByRole('dialog', { name: '离开前保存修改？' }).getByRole('button', { name: '不保存并离开' }).click();
  await expect(page).toHaveURL(/doc=risk/);
  await expect(page.getByRole('tab', { name: /风险评估报告/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /应急预案/ }).click();
  await expect(editor(page)).toContainText('专家补充：按现场核实');
  await expect(editor(page)).not.toContainText('再改一处');

  // 保存失败（连接中断）：输入保留；重试前先查这次保存，再重试同一次
  await typeAtEnd(page, '断网时的修改');
  await page.getByLabel('修订说明').fill('断网测试');
  await page.route('**/api/tasks/*/drafts/plan/sections/*', (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  );
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  // 失败提示就在底栏里（同一块），修订说明不被盖住；只有「重试保存」是主按钮
  const failed = page.getByRole('alert', { name: '保存本节' });
  await expect(failed).toContainText('修订未保存成功');
  await expect(failed).toContainText('连接中断');
  await expect(failed.getByRole('button', { name: '保存本节修订' })).toHaveCount(0);
  await expect(editor(page)).toContainText('断网时的修改');
  await page.unrouteAll();
  await failed.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByText(/✓ 已保存/)).toBeVisible();
  await expect(failed).toBeHidden();

  // 服务出错、其实已经存上了，之后又改了：重试先查到已存上，再以它为基准存新内容，新打的字不会丢
  await typeAtEnd(page, '回包丢了的修改');
  await page.getByLabel('修订说明').fill('回包丢失测试');
  await page.route('**/api/tasks/*/drafts/plan/sections/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fetch();
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
  });
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  await expect(failed).toContainText('服务暂时出错');
  await expect(page.getByLabel('修订说明')).toBeInViewport();
  await shots(page, 'failed');
  await page.unrouteAll();
  await typeAtEnd(page, '失败后又补的字');
  await failed.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByText(/✓ 已保存/)).toBeVisible();
  const afterRetry = await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/sections/${sectionId}`)).json();
  expect(JSON.stringify(afterRetry.blocks)).toContain('失败后又补的字');

  // 别人刚保存过：保存时要先对照，保留输入并打开最新稿
  const latest = await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/sections/${sectionId}`)).json();
  const other = await page.request.put(`/api/tasks/${taskId}/drafts/plan/sections/${sectionId}`, {
    data: {
      saveId: crypto.randomUUID(),
      batchId,
      baseRev: latest.rev,
      blocks: [{ type: 'paragraph', text: ['另一处保存的最新内容。'] }, ...latest.blocks.filter((b: { type: string }) => b.type === 'locked')],
      note: '另一次保存',
    },
  });
  expect(other.ok()).toBe(true);
  await typeAtEnd(page, '我的未保存输入');
  await page.getByLabel('修订说明').fill('冲突测试');
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  const conflict = page.getByRole('dialog', { name: '当前稿件已被更新，请先对照变更' });
  await expect(conflict.getByRole('region', { name: '最新保存稿' })).toContainText('另一处保存的最新内容。');
  await expect(conflict.getByRole('region', { name: '你的未保存内容' })).toContainText('我的未保存输入');
  await expect(conflict.getByLabel('与最新稿不同').first()).toBeVisible();
  await shots(page, 'conflict');
  await conflict.getByRole('button', { name: '保留输入并打开最新稿' }).click();
  await expect(editor(page)).toContainText('另一处保存的最新内容。');
  await expect(page.getByRole('complementary', { name: '企业资料依据' })).toContainText('我的未保存输入');
  // 修订说明留着；待合并也算没保存：不显示「已保存」，离开要提醒
  await expect(page.getByLabel('修订说明')).toHaveValue('冲突测试');
  await expect(page.getByRole('status').filter({ hasText: '你的修改待合并' })).toBeVisible();
  await expect(page.getByText(/✓ 已保存/)).toHaveCount(0);
  await page.getByRole('tab', { name: /风险评估报告/ }).click();
  await page.getByRole('dialog', { name: '离开前保存修改？' }).getByRole('button', { name: '继续编辑' }).click();
  // 手动收起要先确认
  await page.getByRole('complementary', { name: '企业资料依据' }).getByRole('button', { name: '收起' }).click();
  const collapse = page.getByRole('dialog', { name: '收起你的未保存内容？' });
  await collapse.getByRole('button', { name: '先不收起' }).click();
  await expect(page.getByRole('complementary', { name: '企业资料依据' })).toContainText('我的未保存输入');
  // 合并进正文保存后，右栏自动收起
  await typeAtEnd(page, '我的未保存输入');
  await footer(page).getByRole('button', { name: '保存本节修订' }).click();
  await expect(page.getByText(/✓ 已保存/)).toBeVisible();
  await expect(page.getByRole('complementary', { name: '企业资料依据' })).not.toContainText('我的未保存输入');

  // 锁定的表格：只读显示内容，可收起，能去专业整理修改
  const tableSection = await sectionWithTable(page, taskId, outline);
  if (tableSection) {
    await page.goto(`/expert/tasks/${taskId}?view=edit&doc=plan&section=${tableSection}`);
    const lockedTable = editor(page).getByRole('table').first();
    await expect(lockedTable).toBeVisible();
    await expect(editor(page).getByRole('link', { name: '去专业整理修改' }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: '章节目录' }).locator('[aria-current="true"]')).toBeInViewport();
    await shots(page, 'locked');
    await editor(page).getByRole('button', { name: '收起表格' }).first().click();
    await expect(lockedTable).toBeHidden();
  }

  // 1366×768：底栏在一屏内，没有横向滚动
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  await expect(footer(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/acceptance/m2-11-1366.png' });
});

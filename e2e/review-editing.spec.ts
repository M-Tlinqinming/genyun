import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// 核对定稿 · 正文（14 页 E18-03、E18-04、E18-07、E18-08、E18-11、E18-13、E18-15）。
// 文件名排在 generation.spec 之后（generation_xxx 会排到它前面）：那时飞宇的三份草稿已生成。
async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
}

const editor = (page: Page) => page.getByRole('textbox', { name: '本节正文' });
const article = (page: Page) => page.getByRole('article', { name: '正文' });
const docTab = (page: Page, name: string) => page.getByRole('tablist', { name: '三份文稿' }).getByRole('tab', { name: new RegExp(name) });
const saveButton = (page: Page) => page.getByRole('button', { name: '保存这一节' });
const editButtons = (page: Page) => article(page).getByRole('button', { name: /^修改这一节 / });

/** 点开正文里第一个「修改这一节」，返回那一节的标题和编号 */
async function startEdit(page: Page) {
  const button = editButtons(page).first();
  const title = (await button.getAttribute('aria-label'))!.replace(/^修改这一节 /, '');
  const id = await article(page).getByRole('region', { name: title, exact: true }).getAttribute('data-section');
  await button.click();
  await expect(editor(page)).toBeVisible();
  return { title, id: id! };
}

async function typeAtEnd(page: Page, text: string) {
  await editor(page).locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

/** 两种宽度各截一张：1366×768 和 1440 */
async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    // 没有横向滚动
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/acceptance/m2-11-${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test.setTimeout(300_000);

test('按章读正文，改一节不写说明也能保存；离开前三个选择；保存失败可重试；别人刚保存过要先对照；处理记录；接着上次的地方', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '进入正文编辑' }).click();
  await expect(page).toHaveURL(/view=edit/);
  await expect(page.getByRole('navigation', { name: '章节' })).toBeVisible();
  await expect(editButtons(page).first()).toBeVisible();
  await expect(docTab(page, '应急预案')).toHaveAttribute('aria-selected', 'true');
  await expect(docTab(page, '应急预案')).toContainText('待核对');
  await expect(page.getByText('已核对 0 / 3')).toBeVisible();
  // 界面不出现旧说法
  await expect(page.locator('body')).not.toContainText(/修订|人工核对|校对稿|专业整理|当前稿|发布/);
  await shots(page, 'open');

  // E18-03：点「修改这一节」，改了就是没保存；修改说明选填，不写也能保存
  const first = await startEdit(page);
  await expect(page.getByRole('toolbar', { name: '正文格式' })).toContainText(`正在修改 ${first.title}`);
  await typeAtEnd(page, '（专家补充：按现场核实）');
  await expect(page.getByText(/还没保存$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '这一份核对完成' })).toBeDisabled();
  await expect(page.getByText(/^先保存正在修改的 .+再点「这一份核对完成」$/)).toBeVisible();
  await shots(page, 'unsaved');
  await saveButton(page).click();
  await expect(page.getByText(/^已保存 · /)).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(article(page).getByText(/^您已修改 · /)).toBeVisible();
  await expect(article(page)).toContainText('专家补充：按现场核实');
  await shots(page, 'saved');

  // 下载的 Word 带上了刚才的修改
  const taskId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
  const word = await JSZip.loadAsync(await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/word`)).body());
  expect(await word.file('word/document.xml')!.async('string')).toContain('专家补充：按现场核实');

  // E18-07 离开前：三个按钮
  await startEdit(page);
  await typeAtEnd(page, '再改一处');
  await docTab(page, '风险评估报告').click();
  const leave = page.getByRole('alertdialog', { name: /改的内容还没保存$/ });
  await expect(leave).toContainText('您要去「风险评估报告」');
  await shots(page, 'leave');
  // 留在这一节：输入还在
  await leave.getByRole('button', { name: /^留在 / }).click();
  await expect(page).not.toHaveURL(/doc=risk/);
  await expect(editor(page)).toContainText('再改一处');
  // 不保存，直接离开：丢掉输入
  await docTab(page, '风险评估报告').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '不保存，直接离开' }).click();
  await expect(page).toHaveURL(/doc=risk/);
  await expect(docTab(page, '风险评估报告')).toHaveAttribute('aria-selected', 'true');
  await docTab(page, '应急预案').click();
  await expect(article(page)).toContainText('专家补充：按现场核实');
  await expect(article(page)).not.toContainText('再改一处');
  // 保存并离开：存上再走
  await startEdit(page);
  await typeAtEnd(page, '离开前存上');
  await docTab(page, '风险评估报告').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存并离开' }).click();
  await expect(page).toHaveURL(/doc=risk/);
  await docTab(page, '应急预案').click();
  await expect(article(page)).toContainText('离开前存上');

  // 保存失败（连接中断）：输入留在框里，「重新保存」后存上
  await startEdit(page);
  await typeAtEnd(page, '断网时的修改');
  await page.getByLabel('修改说明').fill('断网测试');
  await page.route('**/api/tasks/*/drafts/plan/sections/*', (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  );
  await saveButton(page).click();
  const failed = article(page).getByRole('alert');
  await expect(failed).toContainText('网络断了，没保存上');
  await expect(page.getByText(/^没保存上 · /)).toBeVisible();
  await expect(editor(page)).toContainText('断网时的修改');
  await shots(page, 'failed');
  await page.unrouteAll();
  await failed.getByRole('button', { name: '重新保存' }).click();
  await expect(page.getByText(/^已保存 · /)).toBeVisible();
  await expect(article(page)).toContainText('断网时的修改');

  // 别人刚保存过：保存时先对照，留着我的输入、打开最新的
  const latest = await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/sections/${first.id}`)).json();
  const doc = await (await page.request.get(`/api/tasks/${taskId}/drafts/plan/edit`)).json();
  const other = await page.request.put(`/api/tasks/${taskId}/drafts/plan/sections/${first.id}`, {
    data: {
      saveId: crypto.randomUUID(),
      batchId: doc.batchId,
      baseRev: latest.rev,
      blocks: [{ type: 'paragraph', text: ['另一处保存的最新内容。'] }, ...latest.blocks.filter((b: { type: string }) => b.type === 'locked')],
      note: '',
    },
  });
  expect(other.ok()).toBe(true);
  await startEdit(page);
  await typeAtEnd(page, '我的未保存输入');
  await saveButton(page).click();
  const conflict = page.getByRole('dialog', { name: '这一节刚被别人保存过，请先对照' });
  await expect(conflict.getByRole('region', { name: '最新保存的内容' })).toContainText('另一处保存的最新内容。');
  await expect(conflict.getByRole('region', { name: '您没保存的内容' })).toContainText('我的未保存输入');
  await shots(page, 'conflict');
  await conflict.getByRole('button', { name: '留着我的输入，打开最新的' }).click();
  await expect(editor(page)).toContainText('另一处保存的最新内容。');
  await expect(article(page).getByLabel('您没保存的内容')).toContainText('我的未保存输入');
  // 合并进编辑框保存后，下面的那块自动收起
  await typeAtEnd(page, '我的未保存输入');
  await saveButton(page).click();
  await expect(page.getByText(/^已保存 · /)).toBeVisible();
  await expect(article(page).getByLabel('您没保存的内容')).toHaveCount(0);

  // E18-15：右栏点一条待补充，正文滚到那一处并闪一下
  const items = page.getByRole('list', { name: '待补充清单' }).getByRole('button');
  if ((await items.count()) && !((await items.first().textContent()) ?? '').includes('已处理')) {
    await items.first().click();
    await expect(article(page).locator('.gy-pending-flash')).toBeInViewport();
    await shots(page, 'pending');
  }

  // E18-13：处理记录，按天分组，新的在前
  await page.getByRole('button', { name: '处理记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '处理记录' });
  await expect(history.getByRole('region', { name: '今天' })).toContainText('保存「应急预案 · ');
  await expect(history).toContainText('断网测试');
  await shots(page, 'history');
  await history.getByRole('button', { name: '关闭处理记录' }).click();
  await expect(history).toHaveCount(0);

  // E18-11：从任务进来，接着上次保存的地方打开
  await page.goto(`/expert/tasks/${taskId}?view=edit`);
  const resume = page.getByRole('status').filter({ hasText: '已接着上次的地方打开' });
  await expect(resume).toContainText('您核对到「应急预案 · ');
  await expect(page).toHaveURL(/section=/);
  await shots(page, 'resume');
  await resume.getByRole('button', { name: '知道了' }).click();
  await expect(resume).toHaveCount(0);

  // 1366×768：底栏在一屏内
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole('button', { name: '这一份核对完成' })).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 运营只读：没有「修改这一节」，也不能核对
  const ops = await page.context().browser()!.newPage();
  await ops.goto('/login');
  await ops.getByPlaceholder('请输入邮箱').fill('ops@demo.genyun.net.cn');
  await ops.getByPlaceholder('请输入密码').fill('e2e-password');
  await ops.getByRole('button', { name: /登\s*录/ }).click();
  await expect(ops).toHaveURL(/\/operator$/);
  await ops.goto(`/operator/tasks/${taskId}?doc=plan`);
  await expect(ops.getByText('只有负责这个任务的专家可以修改和核对；可以下载 Word 查看。')).toBeVisible();
  await expect(article(ops)).toBeVisible();
  await expect(editButtons(ops)).toHaveCount(0);
  await expect(ops.getByRole('button', { name: '这一份核对完成' })).toHaveCount(0);
  await shots(ops, 'operator');
  await ops.close();
});

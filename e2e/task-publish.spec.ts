import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 定稿并交付（15 页 R10 交付确认、R11 已交付页、R12 重新打开、R13 重新打开后的核对定稿、R14 再次交付）。
// 文件名排在 review-regenerate.spec 之后：飞宇已重新生成了一批草稿，还没有核对。
// 交付不确定的两种情况都要走到：请求没到后台（查询后可以放心重新交付）、到了后台但回复丢了（查询得到已交付，不会再交付一次）。
// 这个文件跑完，飞宇那个任务停在已交付（第 2 次），只扣过 1 次；后面的 task-results*、workbench 靠这个
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

// 模拟发信把邮件写进后端的发件箱目录（后端在 apps/api 下运行）
const OUTBOX = join('apps', 'api', '.data', 'e2e-mail-outbox');
async function outboxFiles(): Promise<string[]> {
  try {
    return (await readdir(OUTBOX)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}
async function mailsSince(before: string[], kind: string) {
  const seen = new Set(before);
  const mails: { to: string; kind: string; subject: string; text: string }[] = [];
  for (const f of await outboxFiles()) {
    if (seen.has(f)) continue;
    const mail = JSON.parse(await readFile(join(OUTBOX, f), 'utf8'));
    if (mail.kind === kind) mails.push(mail);
  }
  return mails;
}

async function shot(page: Page, name: string, sizes: (readonly [number, number])[] = [[1440, 900]]) {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    // 1366 下没有横向滚动
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/acceptance/k13-${name}-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

// 三份逐份核对，停在审核结论页签
async function checkAll(page: Page, base: string) {
  await page.goto(`${base}?view=edit&doc=plan`);
  const check = page.getByRole('button', { name: '这一份核对完成' });
  await check.click();
  await expect(page).toHaveURL(/doc=risk/);
  await check.click();
  await expect(page).toHaveURL(/doc=resource/);
  await check.click();
  await expect(page).toHaveURL(/tab=conclusion/);
}

test.setTimeout(300_000);

test('首次交付：结果不确定时先查询，再点不会出第二次交付；已交付页只读；重新打开后再次交付；客户看到已更新', async ({ page, browser }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page).toHaveURL(/\/expert\/tasks\/[0-9a-f-]{36}/);
  const base = page.url().replace(/\?.*$/, '');
  const taskId = base.split('/').pop()!;
  const outboxBefore = await outboxFiles();

  // 三份逐份核对、写审核结论，点「定稿并交付」原地弹出交付确认（R10）
  await checkAll(page, base);
  const conclusion = page.getByRole('textbox', { name: '审核结论' });
  await conclusion.fill('三份文稿已逐章核对，与资料一致。');
  await page.getByRole('button', { name: '定稿并交付' }).click();
  const confirm = page.getByRole('alertdialog', { name: '确认定稿并交付？' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('登录就能下载三份 Word');
  await expect(confirm.getByRole('textbox')).toHaveCount(0);
  await shot(page, 'r10-confirm');
  // 再看看：关掉弹窗，什么都没交付
  await confirm.getByRole('button', { name: /再看看/ }).click();
  await expect(confirm).toBeHidden();
  expect((await (await page.request.get(`/api/tasks/${taskId}/publication`)).json()).deliveries).toHaveLength(0);

  // 第一次：请求没到后台（断网）。结果没确认，只能查询；查到后台没收到，可以放心重新交付
  await page.route(`**/api/tasks/${taskId}/publication`, (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback(),
  );
  await page.getByRole('button', { name: '定稿并交付' }).click();
  await page.getByRole('alertdialog', { name: '确认定稿并交付？' }).getByRole('button', { name: '确认交付' }).click();
  const unknown = page.getByRole('alert').filter({ hasText: '还没确认交付成功没有' });
  await expect(unknown).toBeVisible();
  await expect(page.getByRole('button', { name: '定稿并交付' })).toBeDisabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('button', { name: '查询交付结果' }).click();
  await expect(page.getByText('后台没有收到这次交付')).toBeVisible();
  await expect(unknown).toBeHidden();
  expect((await (await page.request.get(`/api/tasks/${taskId}/publication`)).json()).deliveries).toHaveLength(0);

  // 第二次：请求到了后台、交付成功，但回复丢了（超时）。查询得到已交付，自动去已交付页
  let posted = 0;
  await page.route(`**/api/tasks/${taskId}/publication`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted++;
    await route.fetch();
    await route.abort('timedout');
  });
  await page.getByRole('button', { name: '定稿并交付' }).click();
  await page.getByRole('alertdialog', { name: '确认定稿并交付？' }).getByRole('button', { name: '确认交付' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '还没确认交付成功没有' })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(posted).toBe(1);
  await page.getByRole('button', { name: '查询交付结果' }).click();

  // 已交付页（R11）
  await expect(page.getByRole('heading', { name: '已交付给客户', level: 1 })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/V\d/);
  const files = page.getByRole('region', { name: '交付的文稿' });
  for (const name of ['应急预案', '风险评估报告', '应急资源调查报告']) await expect(files).toContainText(`惠阳飞宇电器有限公司${name}.docx`);
  await expect(page.getByRole('region', { name: '交付信息' })).toContainText('三份文稿已逐章核对，与资料一致。');
  await shot(page, 'r11-delivered', [
    [1366, 768],
    [1440, 900],
  ]);
  // 刷新以后仍停在已交付页
  await page.goto(base);
  await expect(page.getByRole('heading', { name: '已交付给客户', level: 1 })).toBeVisible();

  // 只有一次交付；同一次交付再发也只返回第 1 次，换一次交付被拒绝
  const view = await (await page.request.get(`/api/tasks/${taskId}/publication`)).json();
  expect(view.deliveries).toHaveLength(1);
  expect(view.deliveries[0].version).toBe(1);
  const versions = Object.fromEntries(view.docs.map((d: { kind: string; version: number }) => [d.kind, d.version]));
  const replay = await page.request.post(`/api/tasks/${taskId}/publication`, { data: { publishId: view.attempt.publishId, batchId: view.batchId, versions } });
  expect((await replay.json()).attempt.version).toBe(1);
  const another = await page.request.post(`/api/tasks/${taskId}/publication`, { data: { publishId: crypto.randomUUID(), batchId: view.batchId, versions } });
  expect(another.status()).toBe(409);
  expect((await (await page.request.get(`/api/tasks/${taskId}/publication`)).json()).deliveries).toHaveLength(1);
  // 资料核对、生成初稿的写操作被拦下
  const facts = await page.request.put(`/api/tasks/${taskId}/workup/facts`, { data: {} });
  expect(facts.status()).toBe(409);
  expect((await facts.json()).message).toBe('这个任务已交付。要修改，请先点「重新打开」');

  // 看正文：只读，提示回已交付页重新打开
  await files.getByRole('button', { name: '看正文 应急预案' }).click();
  await expect(page).toHaveURL(/view=edit/);
  await expect(page.getByRole('article', { name: '正文' }).getByRole('button', { name: /^修改这一节 / })).toHaveCount(0);
  await expect(page.getByText('已交付，正文不能再修改。要修改，请回到已交付页点「重新打开」。')).toBeVisible();
  await shot(page, 'readonly');
  await page.getByRole('button', { name: '回到已交付页' }).click();
  await expect(page.getByRole('heading', { name: '已交付给客户', level: 1 })).toBeVisible();

  // 客户：站内提醒，点开看到已交付的成果
  const ctx = await browser.newContext();
  const customer = await ctx.newPage();
  await login(customer, 'feiyu@demo.genyun.net.cn');
  await expect(customer).toHaveURL(/\/customer/);
  await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  const note = customer.getByRole('button', { name: /惠阳飞宇电器有限公司的成果已交付/ });
  await expect(note).toBeVisible();
  await expect(note).not.toContainText(/1[3-9]\d{9}/);
  await note.click();
  // 提醒直接打开成果文档里这项任务的交付详情
  await expect(customer).toHaveURL(new RegExp(`/customer/documents/${taskId}`));
  await expect(customer.getByRole('region', { name: '交付文件' })).toContainText('已交付');

  // 重新打开（R12）
  await page.getByRole('button', { name: '重新打开' }).click();
  const reopen = page.getByRole('alertdialog', { name: '重新打开这个任务？' });
  await expect(reopen).toContainText('在您再次交付之前，客户仍能下载现在这一版。');
  await shot(page, 'r12-reopen');
  await reopen.getByRole('button', { name: '重新打开' }).click();
  // 进核对定稿：灰条、三份待核对（R13）
  await expect(page).toHaveURL(/view=edit/);
  await expect(page.getByText(/交付后重新打开 · 客户现在仍能下载 \d{1,2} 月 \d{1,2} 日交付的那一版/)).toBeVisible();
  await expect(page.getByRole('button', { name: '这一份核对完成' })).toBeVisible();
  await shot(page, 'r13-reopened');
  // 资料核对的写操作放行了
  expect((await page.request.put(`/api/tasks/${taskId}/workup/facts`, { data: {} })).status()).not.toBe(409);

  // 重新核对；结论框里是原来那句；再次交付（R14），填「这次更新了什么」
  await checkAll(page, base);
  await expect(conclusion).toHaveValue('三份文稿已逐章核对，与资料一致。');
  await page.getByRole('button', { name: '定稿并交付' }).click();
  const again = page.getByRole('alertdialog', { name: '确认再次交付？' });
  await expect(again).toContainText(/\d{1,2} 月 \d{1,2} 日交付的那一版不再提供下载/);
  await again.getByRole('textbox', { name: /这次更新了什么/ }).fill('值班电话、通讯联络组组员');
  await shot(page, 'r14-again');
  await again.getByRole('button', { name: '确认交付' }).click();
  await expect(page.getByRole('heading', { name: '已交付给客户', level: 1 })).toBeVisible();
  const after = await (await page.request.get(`/api/tasks/${taskId}/publication`)).json();
  expect(after.delivered.version).toBe(2);

  // 客户：任务里显示「已更新」和那一行更新说明
  await customer.reload();
  await expect(customer.getByRole('region', { name: '交付文件' })).toContainText('已更新');
  await expect(customer.getByText(/\d{1,2} 月 \d{1,2} 日更新：值班电话、通讯联络组组员/)).toBeVisible();
  await customer.waitForTimeout(300);
  await customer.screenshot({ path: 'test-results/acceptance/k13-customer-updated.png' });
  await ctx.close();

  // 模拟发件箱：邮件一、邮件二每人各一封
  const one = await mailsSince(outboxBefore, 'delivery_done');
  const two = await mailsSince(outboxBefore, 'delivery_updated');
  expect(one.length).toBeGreaterThan(0);
  expect(new Set(one.map((m) => m.to)).size).toBe(one.length);
  expect(two.map((m) => m.to).sort()).toEqual(one.map((m) => m.to).sort());
  expect(one[0]!.subject).toBe('【耕云】惠阳飞宇电器有限公司的应急预案已编制完成，请登录下载');
  expect(two[0]!.subject).toBe('【耕云】惠阳飞宇电器有限公司的应急预案已更新，请登录下载');
  expect(two[0]!.text).toMatch(/\d{1,2} 月 \d{1,2} 日更新：值班电话、通讯联络组组员/);
});

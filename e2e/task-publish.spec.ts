import { expect, test, type Page } from '@playwright/test';

// 成果发布（15 页 R03 确认发布、R04 结果暂未确认、R04a 正在发布、R04b 发布失败）。
// 文件名排在 supplement.spec 之后：飞宇已按补件后的新事实重新生成了一批草稿，还没有核对。
// 发布不确定的两种情况都要走到：请求没到后台（查询后可以放心重新发布）、到了后台但回复丢了（查询得到已发布 V1，不会再发一次）
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
}

const checkBar = (page: Page) => page.getByRole('region', { name: '核对本份' });

async function shots(page: Page, name: string) {
  for (const [w, h] of [
    [1366, 768],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    // 1366 下没有横向滚动
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/acceptance/m2-15-${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function checkThis(page: Page, button: RegExp) {
  await expect(page.getByText(/第 \d 页 \/ 4/)).toBeVisible({ timeout: 30_000 });
  await checkBar(page).getByRole('checkbox').check();
  await checkBar(page).getByRole('button', { name: button }).click();
}

test.setTimeout(300_000);

test('审核通过后发布形成交付 V1；结果不确定时先查询，再点不会出第二个版本；客户看到已交付', async ({ page, browser }) => {
  await login(page, 'expert@demo.genyun.net.cn');
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  const base = page.url().replace(/\?.*$/, '');
  const taskId = base.split('/').pop()!;

  // 三份逐份核对、确认审核结论
  await page.goto(`${base}?view=edit&doc=plan&tab=preview`);
  await checkThis(page, /确认本份并核对下一份/);
  await expect(page).toHaveURL(/doc=risk/);
  await checkThis(page, /确认本份并核对下一份/);
  await expect(page).toHaveURL(/doc=resource/);
  await checkThis(page, /确认本份，去确认审核结论/);
  await expect(page).toHaveURL(/view=review/);
  await page.getByRole('checkbox', { name: /确认以上结论对应当前保存稿/ }).check();
  await page.getByRole('button', { name: '确认审核通过，进入发布' }).click();
  await expect(page.getByRole('heading', { name: '本次审核已通过' })).toBeVisible();

  // 进入发布（R03）
  await page.getByRole('button', { name: '进入发布', exact: true }).click();
  await expect(page).toHaveURL(/view=publish/);
  await expect(page.getByRole('heading', { name: '审核已通过，等待发布' })).toBeVisible();
  await expect(page.getByText('本次将首次发布为交付 V1')).toBeVisible();
  const files = page.getByRole('region', { name: '本次待发布文件' });
  await expect(files.getByRole('row')).toHaveCount(4);
  await expect(files).toContainText('惠阳飞宇电器有限公司应急预案.docx');
  await expect(page.getByText('当前客户还不能下载本次稿件')).toBeVisible();
  await shots(page, 'confirm');

  // R04a 正在发布、R04b 发布失败：模拟后台的回答截图
  for (const [status, name, heading, error] of [
    ['publishing', 'publishing', '正在发布三份文稿', null],
    ['failed', 'failed', '本次发布失败', '三份 Word 没能全部存好，本次没有形成交付。三份保存稿与审核结论仍有效，可以重新发布'],
  ] as const) {
    await page.route(`**/api/tasks/${taskId}/publication`, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.attempt = { publishId: crypto.randomUUID(), status, version: 1, error, byName: '周工', startedAt: new Date().toISOString(), publishedAt: null };
      if (status === 'publishing') json.canPublish = false;
      await route.fulfill({ response: res, json });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    if (status === 'failed') await expect(page.getByRole('button', { name: '重试发布三份 Word' })).toBeEnabled();
    await shots(page, name);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: '审核已通过，等待发布' })).toBeVisible();

  // 第一次：请求没到后台（断网）。结果暂未确认，只能查询；查到后台没收到，可以放心重新发布
  await page.route(`**/api/tasks/${taskId}/publication`, (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback(),
  );
  await page.getByRole('button', { name: '发布三份 Word' }).click();
  await expect(page.getByRole('heading', { name: '发布结果暂未确认' })).toBeVisible();
  await expect(page.getByText('连接中断，尚未收到发布结果')).toBeVisible();
  await expect(page.getByRole('button', { name: '发布三份 Word' })).toHaveCount(0);
  await shots(page, 'unknown');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('button', { name: '查询本次发布结果' }).click();
  await expect(page.getByText('后台没有收到这次发布')).toBeVisible();
  await expect(page.getByRole('heading', { name: '审核已通过，等待发布' })).toBeVisible();
  expect((await (await page.request.get(`/api/tasks/${taskId}/publication`)).json()).deliveries).toHaveLength(0);

  // 第二次：请求到了后台、发布成功，但回复丢了（超时）。查询得到已发布 V1
  let posted = 0;
  await page.route(`**/api/tasks/${taskId}/publication`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted++;
    await route.fetch();
    await route.abort('timedout');
  });
  await page.getByRole('button', { name: '发布三份 Word' }).click();
  await expect(page.getByRole('heading', { name: '发布结果暂未确认' })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  expect(posted).toBe(1);
  // 刷新页面也还记着这一次：显示后台的结果
  await page.getByRole('button', { name: '查询本次发布结果' }).click();
  await expect(page.getByRole('heading', { name: '已发布为交付 V1', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '本次发布内容' })).toContainText('惠阳飞宇电器有限公司应急资源调查报告.docx');
  await shots(page, 'done');

  // 只有一个交付版本；同一次发布再发一次也只返回 V1，换一次发布被拒绝
  const view = await (await page.request.get(`/api/tasks/${taskId}/publication`)).json();
  expect(view.deliveries).toHaveLength(1);
  expect(view.deliveries[0].version).toBe(1);
  const versions = Object.fromEntries(view.docs.map((d: { kind: string; version: number }) => [d.kind, d.version]));
  const replay = await page.request.post(`/api/tasks/${taskId}/publication`, { data: { publishId: view.attempt.publishId, batchId: view.batchId, versions } });
  expect((await replay.json()).attempt.version).toBe(1);
  const another = await page.request.post(`/api/tasks/${taskId}/publication`, { data: { publishId: crypto.randomUUID(), batchId: view.batchId, versions } });
  expect(another.status()).toBe(409);
  expect((await (await page.request.get(`/api/tasks/${taskId}/publication`)).json()).deliveries).toHaveLength(1);

  // 发布后正文只读
  await page.goto(`${base}?view=edit&doc=plan`);
  await expect(page.getByRole('status').filter({ hasText: '已发布为交付 V1 · 只读' })).toBeVisible();
  await expect(page.getByText('这批文稿已发布为交付 V1，正文不能再修改')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-15-readonly-1440.png' });

  // 客户：站内提醒，点开看到已交付的成果
  const ctx = await browser.newContext();
  const customer = await ctx.newPage();
  await login(customer, 'feiyu@demo.genyun.net.cn');
  await expect(customer).toHaveURL(/\/customer/);
  await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
  const note = customer.getByRole('button', { name: /惠阳飞宇电器有限公司的成果已交付/ });
  await expect(note).toBeVisible();
  await expect(note).not.toContainText(/1[3-9]\d{9}/);
  await customer.waitForTimeout(300);
  await customer.screenshot({ path: 'test-results/acceptance/m2-15-customer-notice.png' });
  await note.click();
  // 提醒直接打开成果文档里这项任务的交付详情
  await expect(customer).toHaveURL(new RegExp(`/customer/documents/${taskId}`));
  await expect(customer.getByText('三份文档已交付 · V1 当前版本')).toBeVisible();
  await customer.waitForTimeout(300);
  await customer.screenshot({ path: 'test-results/acceptance/m2-15-customer-delivered.png' });
  await ctx.close();
});

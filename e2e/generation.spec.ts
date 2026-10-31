import { expect, request, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// 确认采用资料并生成三份草稿（14 页 E18-01、E18-02、E18-02b）。
// 文件名排在 expert-workup.spec 之后：那时飞宇的专业整理必需项已齐（23 / 23）。
// 测试服务器设了 DRAFT_FAIL_ONCE=risk：风险评估报告第一次生成会失败
async function openFeiyu(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('expert@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
}

// 客户在任务里再补传一份文件（模拟专家看确认页时客户刚好上传）
async function customerUploads(name: string) {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.post('/api/auth/login', { data: { email: 'feiyu@demo.genyun.net.cn', password: 'e2e-password' } });
  const me = await (await api.get('/api/auth/me')).json();
  const orgId = me.memberships[0].orgId as string;
  const tasks = (await (await api.get(`/api/orgs/${orgId}/tasks`)).json()) as { id: string; enterpriseName: string }[];
  const task = tasks.find((t) => t.enterpriseName === '惠阳飞宇电器有限公司')!;
  const file = await api.post(`/api/orgs/${orgId}/files`, {
    multipart: { file: { name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) } },
  });
  expect(file.ok()).toBe(true);
  const { id: fileId } = await file.json();
  const linked = await api.post(`/api/tasks/${task.id}/checklist/emergency_supplies/files`, { data: { fileId } });
  expect(linked.ok()).toBe(true);
  await api.dispose();
}

const materials = (page: Page) => page.getByRole('region', { name: '本次采用的资料' });
const draft = (page: Page, name: string) => page.getByRole('list', { name: '三份草稿' }).getByRole('listitem', { name });

test.setTimeout(600_000);

test('确认采用资料：资料又变了留在本页标出；生成时一份失败，只重试这一份', async ({ page }) => {
  await openFeiyu(page);
  await expect(page.getByRole('region', { name: '整理进度' })).toContainText('专业整理的必需项已齐');
  await page.getByRole('button', { name: '完成整理，去核对' }).click();

  // E18-01：客户提交的文件与自填的各步；整理开始后补传的台账标出来
  await expect(page.getByRole('heading', { name: '确认本次编制使用的资料' })).toBeVisible();
  await expect(page).toHaveURL(/view=confirm/);
  await expect(page.getByText('整理完成 · 待采用')).toBeVisible();
  await expect(materials(page).getByRole('listitem', { name: '企业基本信息' })).toContainText('客户自填 · 第 1 步');
  await expect(materials(page).getByRole('listitem', { name: '企业基本信息' })).toContainText('✓ 与整理时一致');
  const ledger = materials(page).getByRole('listitem', { name: '应急物资台账.pdf' });
  await expect(ledger).toContainText('整理开始后客户上传');
  await expect(ledger).toContainText('发起事实补件');
  const outline = page.getByRole('complementary', { name: '将生成的内容' });
  await expect(outline).toContainText('✓ 必需项 23 / 23 已整理');
  await expect(outline).toContainText(/危险源\s*\d+ 项/);
  await expect(outline).toContainText('已采用 2 张');
  // 客户图纸：expert-workup-visuals-drawings 里专家选了消防设施布置图第 2、3 页
  await expect(outline).toContainText('附件 7 放 2 页');
  await expect(page.getByRole('button', { name: '确认采用并生成三份草稿' })).toBeEnabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/acceptance/m2-10b-confirm.png', fullPage: true });

  // 专家在看这页时客户又补传了一份：确认不生成，留在本页把这一行标出来
  await customerUploads('应急物资补充清单.pdf');
  await page.getByRole('button', { name: '确认采用并生成三份草稿' }).click();
  await expect(page.getByText('客户刚更新了资料')).toBeVisible();
  await expect(page.getByRole('heading', { name: '确认本次编制使用的资料' })).toBeVisible();
  const added = materials(page).getByRole('listitem', { name: '应急物资补充清单.pdf' });
  await expect(added).toContainText('刚有变化');
  await expect(added).toContainText('整理开始后客户上传');

  // 看过后再确认：开始生成，三份各自进度
  await page.getByRole('button', { name: '确认采用并生成三份草稿' }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByRole('list', { name: '三份草稿' })).toBeVisible();

  // E18-02b：风险评估报告失败，另外两份照常生成
  await expect(page.getByRole('heading', { name: '2 份已生成，1 份需要重试' })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('生成部分失败')).toBeVisible();
  await expect(draft(page, '应急预案')).toContainText('✓ 已生成');
  await expect(draft(page, '应急资源调查报告')).toContainText('✓ 已生成');
  await expect(draft(page, '风险评估报告')).toContainText('生成失败');
  await expect(draft(page, '风险评估报告')).toContainText('模拟连接中断　·　可重试');
  await expect(page.getByRole('alert').filter({ hasText: '风险评估报告生成中断' })).toBeVisible();
  await page.screenshot({ path: 'test-results/acceptance/m2-10b-failed.png', fullPage: true });

  // 刷新页面还在进度页，不会重复生成
  await page.reload();
  await expect(page.getByRole('heading', { name: '2 份已生成，1 份需要重试' })).toBeVisible();

  // 只重试这一份
  const planBefore = await draft(page, '应急预案').innerText();
  await page.getByRole('button', { name: '重试风险评估报告' }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('草稿已生成', { exact: true })).toBeVisible();
  await expect(draft(page, '风险评估报告')).toContainText('✓ 已生成');
  expect(await draft(page, '应急预案').innerText()).toBe(planBefore);
  await expect(draft(page, '应急预案').getByRole('button', { name: '下载 Word' })).toBeVisible();
  // 附件 7 放了消防设施布置图选的两页：五张系统画的图 + 两页客户图纸
  const taskId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
  const progress = await (await page.request.get(`/api/tasks/${taskId}/generation`)).json();
  const planFile = progress.current.drafts.find((d: { kind: string }) => d.kind === 'plan').wordFileId as string;
  const { url } = await (await page.request.get(`/api/files/${planFile}/download-url`)).json();
  const word = await JSZip.loadAsync(await (await page.request.get(url)).body());
  expect(Object.keys(word.files).filter((n) => n.startsWith('word/media/'))).toHaveLength(7);
  expect(await word.file('word/document.xml')!.async('string')).toContain('消防设施布置图（2）');
  await page.screenshot({ path: 'test-results/acceptance/m2-10b-done.png', fullPage: true });

  // 生成过以后从任务中心进来直接看进度；可以回到专业整理
  await page.getByRole('button', { name: '返回任务中心' }).click();
  await expect(page).toHaveURL(/\/expert$/);
  await page.getByRole('row', { name: /惠阳飞宇电器有限公司/ }).click();
  await expect(page.getByRole('heading', { name: '三份草稿已生成' })).toBeVisible();
  await page.getByRole('button', { name: '查看专业整理' }).click();
  await expect(page.getByRole('navigation', { name: '整理模块' })).toBeVisible();
});

test('生成过以后再进确认页：提示确认后会替换上一批', async ({ page }) => {
  await openFeiyu(page);
  await page.goto(page.url().replace(/\?.*$/, '') + '?view=confirm');
  await expect(page.getByRole('heading', { name: '确认本次编制使用的资料' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '将生成的内容' })).toContainText('已经生成过一批草稿');
});

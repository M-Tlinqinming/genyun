import { expect, request, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { feiyuBasicInfo } from '../packages/shared/src/fixtures/feiyu';
import { feiyuProfile } from '../packages/shared/src/fixtures/feiyu-profile';

// 整体验收（M2 第 17 项，覆盖 M1–M4 主流程）。两条测试，各自都能单独跑：
// A：运营登记并开通新组织、登记合同 → 首位机构管理员从邀请邮件设密码进入 → 新建企业、按提示填完五步 → 提交。
// B：用飞宇样例从运营分派走到客户下载三份 Word：注安师接单、电话联系、专业整理、事实补件（客户补交、注安师采用）→
//    生成 → 审阅编辑 → 校对 → 发布 → 客户下载并检查三份 Word → 客户就这次交付提交反馈 → 运营受理并回复关闭 → 客户看到回复。
// B 不碰演示账号和演示数据里的飞宇任务（别的测试文件按顺序接着用它们）：运营先开通一家本测试专用的客户组织，
// 它的首位管理员按飞宇样例建企业、提交、下载、提反馈，提醒和反馈都只落在这个新账号上。
// 客户提交后由运营分派给吴工（周工的任务列表别的测试要按企业名点「惠阳飞宇电器有限公司」，不能多出一行）。
// 走完任务即已交付、反馈已关闭，不再计入在办任务和待受理反馈。
// 注意：A 会留下一个待分派任务，而且企业名是飞宇——测试环境的营业执照识别固定返回飞宇的执照，会把客户起的名字换掉。
// 所以其他测试不要按绝对数量断言「待分派」，按企业名找飞宇时还要按客户组织过滤（operator-task-center 已这样做）。
// 组织名、信用代码、合同编号都带时间后缀，同一个库里重复跑也不撞。
// 文件名特意排在 generation.spec 之后：测试服务器让风险评估报告第一次生成失败一次（DRAFT_FAIL_ONCE），那次要留给 generation.spec；
// 单独跑本文件时遇到这次失败就重试。
// 页面截图放 out/m2-acceptance/screens/（与 Paper 画板并排对照用），客户下载的三份 Word 放 out/m2-acceptance/。
const OUT = 'out/m2-acceptance';
const COMPANY = feiyuBasicInfo.companyName;
/** 时间后缀：7 位数字，拼进信用代码后仍是 18 位 */
const stamp = () => String(Date.now()).slice(-7);
const DOCS = ['应急预案', '风险评估报告', '应急资源调查报告'] as const;
// 界面和交付文档里都不能出现的内部编码
const INTERNAL_CODE = /(?<![A-Za-z0-9])(E[1-6]|S1|R1|SP\d{2}|P\d{1,2})(?![A-Za-z0-9])/;

async function signIn(browser: Browser, email: string, home: RegExp) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill(email);
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(home);
  return { ctx, page };
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/screens/${name}.png`, fullPage });
}

/** 客户按飞宇样例填好自填各步、处理好资料清单（和演示数据的飞宇一样：技术人员数没填，两项请专家电话联系，压力管道拍照给耕云看） */
async function prepareFeiyu(customer: Page, creditCode: string) {
  const api = customer.request;
  const me = (await (await api.get('/api/auth/me')).json()) as { memberships: { orgId: string }[] };
  const orgId = me.memberships[0]!.orgId;
  const ent = await api.post(`/api/orgs/${orgId}/enterprises`, {
    data: {
      name: COMPANY,
      socialCreditCode: creditCode,
      registeredAddress: feiyuBasicInfo.registeredAddress?.detail,
      legalRepresentative: feiyuBasicInfo.legalRepresentative,
    },
  });
  expect(ent.ok(), await ent.text()).toBe(true);
  const enterpriseId = ((await ent.json()) as { id: string }).id;
  const base = `/api/enterprises/${enterpriseId}`;
  const ok = async (res: Awaited<ReturnType<typeof api.put>>) => {
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { version: number }).version;
  };

  const { technicalManagementCount: _, ...basic } = feiyuProfile.basicStep!.basic;
  const current = (await (await api.get(`${base}/basic-step`)).json()) as { version: number; identity: Record<string, unknown> };
  let version = await ok(
    await api.put(`${base}/basic-step`, {
      data: {
        version: current.version,
        identity: current.identity,
        basic,
        later: feiyuProfile.basicStep!.later,
        sources: feiyuProfile.basicStep!.sources,
      },
    }),
  );
  version = await ok(await api.put(`${base}/organization-step`, { data: { version, step: feiyuProfile.organizationStep!.step } }));
  version = await ok(await api.put(`${base}/production-step`, { data: { version, step: feiyuProfile.productionStep!.step } }));
  await ok(await api.put(`${base}/resources-step`, { data: { version, step: feiyuProfile.resourcesStep!.step } }));

  const task = await api.post(`${base}/tasks`, { data: { name: '2026 年应急预案编制' } });
  expect(task.ok(), await task.text()).toBe(true);
  const taskId = ((await task.json()) as { id: string }).id;
  const method = await api.patch(`/api/tasks/${taskId}`, { data: { startMethod: 'self_fill' } });
  expect(method.ok(), await method.text()).toBe(true);

  const provided = [
    'business_license',
    'basic_info',
    'buildings',
    'process_flow',
    'equipment',
    'materials',
    'emergency_groups',
    'duty_phone',
    'external_resources',
    'first_aid_kit',
    'site_plan',
    'evacuation_plan',
  ];
  const items: Record<string, { status: string; callRequested?: boolean }> = {
    ...Object.fromEntries(provided.map((k) => [k, { status: 'provided' }])),
    msds: { status: 'later' },
    fire_facility_plan: { status: 'later' },
    special_equipment: { status: 'photo_for_expert' },
    emergency_supplies: { status: 'later', callRequested: true },
    fire_pool: { status: 'later', callRequested: true },
  };
  for (const [key, data] of Object.entries(items)) {
    const res = await api.put(`/api/tasks/${taskId}/checklist/${key}`, { data });
    expect(res.ok(), `${key}: ${await res.text()}`).toBe(true);
  }
  const number = ((await (await api.get(`/api/tasks/${taskId}`)).json()) as { number: string }).number;
  expect(number).toMatch(/^GY-\d{4}-\d{3,}$/);
  return { taskId, number };
}

/** Word 里的正文文字（只取 w:t，不看排版属性） */
async function wordText(zip: JSZip) {
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let text = '';
  for (const name of parts) {
    const xml = await zip.file(name)!.async('string');
    text += [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  }
  return text;
}

// 模拟发信把邮件写进后端的发件箱目录（后端在 apps/api 下运行），取法同 invitations.spec
const OUTBOX = join('apps', 'api', '.data', 'e2e-mail-outbox');
async function inviteLink(email: string): Promise<string> {
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const mail = JSON.parse(await readFile(join(OUTBOX, f), 'utf8')) as { to: string; text: string };
    if (mail.to === email) return new URL(mail.text.match(/https?:\/\/\S+\/invite\/\S+/)![0]).pathname;
  }
  throw new Error(`发件箱里没有给 ${email} 的邮件`);
}

/** 运营通过接口登记并开通一家客户组织（界面操作在 A 里走过），首位管理员从邀请链接设密码进入，返回已登录的页面 */
async function openOrgWithAdmin(browser: Browser, org: string, admin: string, email: string) {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await api.post('/api/auth/login', { data: { email: 'ops@demo.genyun.net.cn', password: 'e2e-password' } });
    const created = await api.post('/api/operator/organizations', {
      data: {
        name: org,
        region: '广东省惠州市',
        socialCreditCode: `91441300MA7${stamp()}`,
        contactName: admin,
        contactPhone: '137 0000 3217',
        contactEmail: email,
        note: '',
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    const file = await api.post(`/api/operator/organizations/${id}/contract-file`, {
      multipart: { file: { name: '年度服务合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% 合同\n') } },
    });
    expect(file.ok(), await file.text()).toBe(true);
    const opened = await api.post(`/api/operator/organizations/${id}/open`, {
      data: {
        contractNumber: `GY-HT-2026-B${stamp()}`,
        scopeKind: 'annual',
        scopeEnterprises: 3,
        startsAt: '2026-01-01',
        endsAt: '2027-12-31',
        contractFileId: ((await file.json()) as { id: string }).id,
        paymentReceived: true,
        adminName: admin,
        adminPhone: '137 0000 3217',
        adminEmail: email,
      },
    });
    expect(opened.ok(), await opened.text()).toBe(true);
  } finally {
    await api.dispose();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(await inviteLink(email));
  await page.getByLabel('设置密码').fill(`feiyu${stamp()}b`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await expect(page).toHaveURL(/\/customer$/);
  return { ctx, page };
}

const PDF = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
const PNG = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
});

test.setTimeout(900_000);
// 点不到的按钮早点报错，别等到整条测试超时才知道卡在哪
test.use({ actionTimeout: 20_000 });

test('A 新客户：运营开通组织并登记合同 → 首位管理员接受邀请 → 新建企业、按提示填写 → 提交', async ({ browser }) => {
  await mkdir(`${OUT}/screens`, { recursive: true });
  const SUFFIX = stamp();
  const ORG = `惠州验收${SUFFIX}安全咨询有限公司`;
  const EMAIL = `he-${Date.now()}@huizhou-yanshou.cn`;
  const ENTERPRISE = `惠州验收${SUFFIX}电器有限公司`;
  const { ctx: opsCtx, page: ops } = await signIn(browser, 'ops@demo.genyun.net.cn', /\/operator$/);
  const customerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    // ── 运营：登记客户组织 ──
    await ops.getByRole('menuitem', { name: /客户组织/ }).click();
    await ops.getByRole('button', { name: '登记客户组织' }).click();
    const register = ops.getByRole('dialog', { name: '登记客户组织' });
    await register.getByLabel('组织名称').fill(ORG);
    await register.getByLabel('所在地区').fill('广东省惠州市');
    await register.getByLabel('统一社会信用代码').fill(`91441300MA5${SUFFIX}`);
    await register.getByLabel('主联系人').fill('何经理');
    await register.getByLabel('手机号').fill('137 0000 2217');
    await register.getByLabel('邮箱').fill(EMAIL);
    await shot(ops, 'I02-登记组织');
    await register.getByRole('button', { name: '登记' }).click();
    await expect(register).toBeHidden();
    const orgRow = ops.getByRole('row').filter({ hasText: ORG });
    await expect(orgRow).toContainText('待开通');

    // ── 运营：登记合同、确认到账后开通，邀请首位管理员 ──
    await orgRow.getByRole('button', { name: `开通${ORG}` }).click();
    const open = ops.getByRole('dialog', { name: /开通客户组织/ });
    await expect(open.getByLabel('姓名')).toHaveValue('何经理');
    await expect(open.getByLabel('邮箱')).toHaveValue(EMAIL);
    await open.getByLabel('合同编号').fill(`GY-HT-2026-A${SUFFIX}`);
    await open.getByLabel('年度服务包含几家企业').fill('3');
    await open.getByLabel('选择已签合同原件').setInputFiles(PDF('惠州验收-年度服务合同-盖章版.pdf'));
    await expect(open).toContainText('惠州验收-年度服务合同-盖章版.pdf');
    await open.getByLabel('合同有效期').click();
    await ops.getByPlaceholder('开始日').fill('2026.11.01');
    await ops.getByPlaceholder('到期日').fill('2027.10.31');
    await ops.getByPlaceholder('到期日').press('Enter');
    await open.getByLabel('合同款已到账').check();
    await shot(ops, 'I02-开通与邀请');
    await open.getByRole('button', { name: '开通并发送邀请' }).click();
    await expect(ops.getByText(`已开通，邀请已发到 ${EMAIL}`)).toBeVisible();
    await expect(orgRow).toContainText('服务中');
    await expect(orgRow).toContainText('2026.11.01 – 2027.10.31');

    // ── 首位管理员：从邀请邮件进入，设密码后进入客户工作台 ──
    const page = await customerCtx.newPage();
    await page.goto(await inviteLink(EMAIL));
    await expect(page.getByRole('heading', { name: `加入${ORG}` })).toBeVisible();
    await expect(page.getByLabel('邮箱')).toHaveValue(EMAIL);
    await page.getByLabel('设置密码').fill(`yanshou${Date.now() % 10000}a`);
    await page.getByRole('checkbox').check();
    await shot(page, 'A02-接受邀请');
    await page.getByRole('button', { name: '接受邀请并进入' }).click();
    await expect(page).toHaveURL(/\/customer$/);
    await expect(page.getByRole('heading', { name: /(上午|下午|晚上)好，何经理/ })).toBeVisible();
    await shot(page, 'C01-新客户工作台');

    // ── 客户：新建企业、创建编制任务、选「按提示填写」（与 M1 整体验收同一套步骤） ──
    await page.getByRole('menuitem', { name: '企业' }).click();
    await page.getByRole('button', { name: '新建企业' }).first().click();
    await page.getByLabel('企业名称').fill(ENTERPRISE);
    await page.getByRole('button', { name: '保存企业档案' }).click();
    await expect(page).toHaveURL(/\/customer\/enterprises\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: '创建编制任务' }).click();
    await page.getByRole('button', { name: '创建草稿并准备资料' }).click();
    await expect(page.getByRole('heading', { name: '您想怎么开始？' })).toBeVisible();
    const taskId = page.url().split('/').at(-2)!;
    await page.getByRole('button', { name: '开始填写' }).click();
    await expect(page).toHaveURL(/\/fill\/1$/);

    // 第 1 步：营业执照（测试环境用模拟识别）、人数、产品、行业、电话
    await page.locator('input[type=file]').setInputFiles(PDF('营业执照.pdf'));
    await expect(page.getByText(/已识别 \d+ 项，已填入下方，请核对/)).toBeVisible();
    await page.getByLabel('员工人数').fill('86');
    await page.getByLabel('主要产品').fill('电热水壶、电饭煲');
    await page.getByLabel('所属行业').fill('电气机械');
    await page.getByText('电气机械和器材制造业', { exact: true }).click();
    await page.getByLabel(/^联系电话/).fill('13700002217');
    await expect(page.getByText(/已自动保存 \d{2}:\d{2}/)).toBeVisible();
    await page.getByRole('button', { name: '下一步：人员与应急组织' }).click();

    // 第 2 步：总指挥、值班电话
    await expect(page.getByRole('heading', { name: '出了事，谁来指挥、谁去处置' })).toBeVisible();
    await page.getByLabel('总指挥姓名', { exact: true }).fill('何建华');
    await page.getByLabel('总指挥职位', { exact: true }).fill('总经理');
    await page.getByLabel('总指挥手机', { exact: true }).fill('13800002217');
    await page.getByLabel('24 小时值班电话').fill('0752-3322170');
    await expect(page.getByText(/已自动保存/)).toBeVisible();
    await page.getByRole('button', { name: '下一步：生产情况' }).click();

    // 第 3 步第 1 页：设备、特种设备四类、原辅材料、两个业务问题
    await expect(page.getByRole('heading', { name: '您的工厂里有哪些场所和东西' })).toBeVisible();
    await page.getByLabel('第 1 台设备名称').fill('冲压机');
    await page.getByLabel('第 1 台设备数量').fill('6 台');
    for (const key of ['pressureVessels', 'boilers', 'pressurePipelines', 'storageTanks']) {
      await page.getByTestId(`special-${key}`).getByText('没有', { exact: true }).click();
    }
    await page.getByLabel('第 1 种物料名称').fill('塑料粒子');
    await page.getByLabel('第 1 种物料年用量').fill('30 t');
    await page.getByLabel('第 1 种物料最大存放量').fill('2 t');
    for (const q of ['有没有把厂房出租给其他企业？', '有自己的车辆运输货物吗？']) {
      await page.getByRole('radiogroup', { name: q }).getByText('否', { exact: true }).click();
    }
    await expect(page.getByText('已自动保存')).toBeVisible();
    await page.getByRole('button', { name: '下一页：工艺流程' }).click();

    // 第 3 步第 2 页：行业模板
    await expect(page.getByRole('heading', { name: '您的产品是怎么做出来的' })).toBeVisible();
    await page.getByRole('button', { name: /^五金冲压/ }).click();
    await expect(page.getByTestId('process-chart-row').first()).toBeVisible();
    await page.getByRole('button', { name: '下一步：应急资源与图纸' }).click();

    // 第 4 步：灭火器、总平面图与疏散图
    await expect(page.getByRole('heading', { name: '出了事，手边有什么可以用' })).toBeVisible();
    await page.getByLabel('手提式干粉灭火器数量').fill('50');
    await page.getByTestId('drawing-site_plan').locator('input[type=file]').setInputFiles(PNG('总平面图.png'));
    await expect(page.getByTestId('drawing-site_plan')).toContainText('总平面图.png');
    await page.getByTestId('drawing-evacuation_plan').locator('input[type=file]').setInputFiles(PNG('疏散图.png'));
    await expect(page.getByTestId('drawing-evacuation_plan')).toContainText('疏散图.png');
    await page.getByRole('button', { name: '下一步：核对并提交' }).click();

    // 第 5 步：核对、确认资料版本后提交
    await expect(page.getByText('核对一下，就可以交给耕云了')).toBeVisible();
    await shot(page, 'S05-核对提交', true);
    await page.getByRole('button', { name: '提交给耕云' }).click();
    await expect(page.getByRole('list', { name: '本次资料版本' })).toContainText('总平面图.png');
    await page.getByRole('button', { name: '确认提交' }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/tasks/${taskId}\\?tab=records$`));
    await expect(page.getByText('资料已提交', { exact: true })).toBeVisible();
    await shot(page, 'F03-已提交', true);

    // ── 运营：这个任务进了待分派 ──
    await ops.goto(`/operator/tasks?task=${taskId}`);
    const detail = ops.getByRole('region', { name: '任务详情' });
    // 测试环境的营业执照识别固定返回飞宇的执照，企业名称会被识别结果填成飞宇；这里按客户组织认任务
    await expect(detail.getByRole('heading', { name: /编制应急预案$/ })).toBeVisible();
    await expect(detail.getByRole('link', { name: ORG })).toBeVisible();
    await expect(detail).toContainText('还没有负责注安师');
    await expect(ops.locator('main')).not.toContainText(INTERNAL_CODE);
  } finally {
    await customerCtx.close();
    await opsCtx.close();
  }
});

test('B 飞宇全程：运营分派 → 注安师接单、联系、整理、补件 → 生成、审阅、校对、发布 → 客户下载三份 Word → 反馈与回复', async ({ browser }) => {
  await mkdir(`${OUT}/screens`, { recursive: true });
  const contexts: BrowserContext[] = [];
  const as = async (email: string, home: RegExp) => {
    const s = await signIn(browser, email, home);
    contexts.push(s.ctx);
    return s.page;
  };

  try {
    // ── 本测试专用的客户组织：运营开通，首位管理员接受邀请（和其他测试不共享账号，提醒和反馈只落在这里） ──
    const SUFFIX = stamp();
    const CUSTOMER_ORG = `飞宇验收${SUFFIX}客户`;
    const customerSession = await openOrgWithAdmin(browser, CUSTOMER_ORG, '陈验收', `chen-${Date.now()}@feiyu-yanshou.cn`);
    contexts.push(customerSession.ctx);
    const customer = customerSession.page;

    // ── 客户：按飞宇样例填好各步后，在第 5 步核对并提交 ──
    const { taskId, number } = await prepareFeiyu(customer, `91441300MA6${SUFFIX}`);
    await customer.goto(`/customer/tasks/${taskId}/fill/5`);
    await expect(customer.getByRole('heading', { name: '核对一下，就可以交给耕云了' })).toBeVisible();
    await customer.getByRole('button', { name: '提交给耕云' }).click();
    await customer.getByRole('button', { name: '确认提交' }).click();
    await expect(customer).toHaveURL(new RegExp(`/customer/tasks/${taskId}\\?tab=records$`));

    // ── 运营：待分派里找到这个任务，分派给吴工 ──
    const ops = await as('ops@demo.genyun.net.cn', /\/operator$/);
    await ops.goto(`/operator/tasks?task=${taskId}`);
    const detail = ops.getByRole('region', { name: '任务详情' });
    await expect(detail.getByRole('heading', { name: `${COMPANY} · 编制应急预案` })).toBeVisible();
    await expect(detail).toContainText('还没有负责注安师');
    await detail.getByRole('button', { name: '分配注安师' }).click();
    const assign = ops.getByRole('dialog', { name: /分配注安师/ });
    await assign.getByRole('radio', { name: /吴工/ }).check();
    await assign.getByLabel('给注安师的说明（选填）').fill('M2 整体验收：飞宇全程');
    await shot(ops, 'I04-分派');
    await assign.getByRole('button', { name: '分配给吴工' }).click();
    await expect(ops.getByText('已分配给吴工，已通知对方')).toBeVisible();
    await expect(detail).toContainText('负责注安师 吴工');

    // ── 注安师吴工：任务中心看到新任务，进入（接单） ──
    const expert = await as('expert2@demo.genyun.net.cn', /\/expert$/);
    const row = expert.getByRole('row', { name: new RegExp(COMPANY) }).filter({ hasText: number });
    await expect(row).toContainText(CUSTOMER_ORG);
    await expect(row).toContainText('电话联系客户问清 2 项');
    await shot(expert, 'I04-注安师任务中心');
    await row.click();
    await expect(expert).toHaveURL(new RegExp(`/expert/tasks/${taskId}$`));
    await expect(expert.getByRole('heading', { name: COMPANY })).toBeVisible();
    await expect(expert.getByText('客户请专家电话联系 2 项')).toBeVisible();

    // 电话联系客户：问清两项，记下联系记录
    await expert.getByRole('button', { name: '联系客户', exact: true }).click();
    const contact = expert.getByRole('dialog');
    await expect(contact.getByRole('radio', { name: '我打电话问' })).toHaveAttribute('aria-checked', 'true');
    await contact.getByRole('button', { name: '不问技术人员数' }).click();
    await contact.getByLabel('回答：应急物资及装备').fill('干粉灭火器 30 具、二氧化碳灭火器 4 具、急救箱 2 箱，存放在 1 号仓库');
    await contact.getByLabel('回答：消防水池').fill('厂区东侧 200 m³ 消防水池一座');
    await shot(expert, 'E18-00E-电话联系');
    await contact.getByRole('button', { name: '保存并回填' }).click();
    await expect(expert.getByText('已保存，回答已回填')).toBeVisible();
    await expect(expert.getByText('客户请专家电话联系 2 项')).toHaveCount(0);
    await expert.getByRole('button', { name: /处理记录/ }).click();
    await expect(expert.getByRole('list', { name: '联系记录' })).toContainText('已问清');
    await expert.keyboard.press('Escape');
    await expect(expert.getByRole('list', { name: '联系记录' })).toBeHidden();

    // 专业整理 · 企业事实：补技术人员数
    await expert.getByRole('button', { name: /^企业事实/ }).click();
    await shot(expert, 'E18-00A-企业事实');
    const fact = (key: string) => expert.locator(`[data-fact="${key}"]`);
    await fact('technicalManagementCount').scrollIntoViewIfNeeded();
    await fact('technicalManagementCount').getByRole('button', { name: '直接填写' }).click();
    await fact('technicalManagementCount').getByLabel('技术人员数').fill('8');
    await fact('technicalManagementCount').getByRole('button', { name: /保\s*存/ }).click();
    await expect(fact('technicalManagementCount')).toContainText('8 人');

    // 专业整理 · 生产设备与物料：判定危化品、特种设备、耐火等级，补一种物料
    const prow = (key: string) => expert.locator(`[data-row="${key}"]`);
    const lists = expert.getByRole('list', { name: '生产设备与物料清单' });
    await expert.getByRole('button', { name: /生产设备与物料/ }).click();
    await lists.getByRole('listitem').filter({ hasText: '原辅材料' }).click();
    const materials = expert.getByRole('region', { name: '原辅材料' });
    await prow('material:m5').getByRole('button', { name: '采纳' }).click();
    await expect(prow('material:m5').getByText('是', { exact: true })).toBeVisible();
    await prow('material:m3').getByRole('button', { name: '不是危化品' }).click();
    await expect(prow('material:m3').getByText('否', { exact: true })).toBeVisible();
    await materials.getByRole('button', { name: '新增一行' }).click();
    await materials.getByLabel('名称').fill('乙炔');
    await materials.getByLabel('最大储量').fill('4 瓶');
    await materials.getByRole('button', { name: '保存' }).click();
    await materials.locator('[data-row^="material:x"]').getByRole('button', { name: '采纳' }).click();
    await shot(expert, 'E18-00B-原辅材料');

    await lists.getByRole('listitem').filter({ hasText: '特种设备' }).click();
    await prow('special:pressurePipelines').getByRole('button', { name: '判定为无' }).click();
    await expect(prow('special:pressurePipelines')).toContainText('拍照给耕云看 → 无');
    await prow('special:pressureVessels').hover();
    await prow('special:pressureVessels').getByRole('button', { name: '补压力容器参数' }).click();
    await expert.getByLabel('最高工作压力').fill('0.84');
    await expert.getByLabel('容积').fill('1.25');
    await expert.getByRole('button', { name: '判定为有' }).click();
    await expect(prow('special:pressureVessels')).toContainText('PV 1.05 MPa·m³（系统计算）');
    await shot(expert, 'E18-00B2-特种设备');

    await lists.getByRole('listitem').filter({ hasText: '建构筑物' }).click();
    await expert.getByLabel('1 号生产厂房耐火等级').click();
    await expert.getByTitle('二级').click();
    await expect(expert.getByRole('button', { name: /生产设备与物料\s*✓/ })).toBeVisible();

    // 专业整理 · 危险源辨识：按推荐候选取值，改一项后果
    await expert.getByRole('button', { name: /^危险源辨识/ }).click();
    const risks = expert.getByRole('region', { name: '危险源辨识' });
    await expect(risks).toContainText('火灾');
    await expect(risks).toContainText('可燃气体爆炸');
    const fire = expert.locator('[data-row="risk:SP01"]');
    await fire.getByLabel('可能造成的后果').click();
    await expert.getByTitle('40　灾难，数人死亡').click();
    await expect(fire).toContainText('240');
    await expect(fire).toContainText('专家');
    await shot(expert, 'E18-00C-危险源辨识');

    // 专业整理 · 适用范围：确认四个待确认的开关
    await expert.getByRole('button', { name: /^适用范围/ }).click();
    const scope = expert.getByRole('region', { name: '适用范围' });
    const sw = (key: string) => expert.locator(`[data-row="scope:${key}"]`);
    await expect(scope).toContainText('待确认 4 项');
    await sw('dustProcess').getByRole('button', { name: '关闭' }).click();
    await sw('meltingProcess').getByRole('button', { name: '开启' }).click();
    await sw('waterHazard').getByRole('button', { name: '开启' }).click();
    await expect(scope).not.toContainText('待确认');
    await expect(expert.getByRole('button', { name: /^适用范围\s*✓/ })).toBeVisible();
    await shot(expert, 'E18-00D-适用范围');

    // 专业整理 · 图件：两张图采用
    await expert.getByRole('button', { name: /^图件/ }).click();
    const orgCard = expert.getByRole('article', { name: '应急救援组织体系图' });
    const flowCard = expert.getByRole('article', { name: '生产工艺流程图' });
    await orgCard.getByRole('button', { name: '采用此图' }).click();
    await expect(orgCard).toContainText(/已采用 · 吴工/);
    await flowCard.getByRole('button', { name: '采用此图' }).click();
    await expect(flowCard).toContainText(/已采用 · 吴工/);
    await expect(expert.getByRole('button', { name: /^图件\s*✓/ })).toBeVisible();
    await expect(expert.getByRole('region', { name: '整理进度' })).toContainText('专业整理的必需项已齐');
    await shot(expert, 'E18-00F-图件');

    // ── 事实补件：飞宇换了应急联系人。注安师发起 → 客户在任务页补交新名册 → 注安师核实后采用 ──
    await expert.getByRole('button', { name: '发起事实补件' }).click();
    const sup = expert.getByRole('dialog', { name: '发起事实补件' });
    const facts = sup.getByRole('combobox', { name: '要核对的企业事实' });
    await facts.fill('联系电话');
    await expert.keyboard.press('Enter');
    await expect(expert.locator('.ant-select-dropdown:visible')).toHaveCount(0);
    await facts.fill('联系人');
    await expert.keyboard.press('Enter');
    await expect(expert.locator('.ant-select-dropdown:visible')).toHaveCount(0);
    await sup.getByRole('textbox', { name: '标题' }).fill('请确认应急联系人和电话');
    await sup.getByRole('button', { name: '发给客户' }).click();
    await expect(expert.getByText('已发起，客户会在任务页看到')).toBeVisible();
    await expect(expert.getByRole('status')).toHaveText('等待客户回应');

    await customer.goto('/customer');
    await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
    await customer.getByRole('button', { name: /吴工请您确认企业事实/ }).first().click();
    await expect(customer.getByRole('region', { name: '请确认企业事实' })).toContainText('请确认应急联系人和电话');
    const card = customer.getByRole('region', { name: '本次需要您提供' });
    await card.locator('input[type=file]').setInputFiles({
      name: '应急人员名册（新）.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n% roster\n'),
    });
    await expect(card).toContainText('应急人员名册（新）.pdf');
    await card.getByRole('textbox').fill('新名册已生效，王海明接替林小明任联系人，电话 139 0000 3102');
    await card.getByRole('checkbox').check();
    await shot(customer, 'R00a-客户补交');
    await card.getByRole('button', { name: '提交本轮补充' }).click();
    await expect(customer.getByRole('region', { name: '已提交的事实补件' })).toContainText('等待注安师核实');

    await expert.goto(`/expert/tasks/${taskId}?view=supplement`);
    await expect(expert.getByRole('status')).toHaveText('补件待核实');
    const table = expert.getByRole('region', { name: '核对本轮事实变化' });
    await table.getByLabel('联系人本轮采用').fill('王海明');
    await table.getByLabel('联系电话本轮采用').fill('139 0000 3102');
    await table.getByLabel('联系人核实依据').fill('新名册第 1 页');
    await expert.getByRole('checkbox', { name: /已核对原件与客户确认/ }).check();
    await shot(expert, 'R00b-注安师核实', true);
    await expert.getByRole('button', { name: '确认事实并采用到本任务' }).click();
    await expect(expert.getByText('已采用到本任务')).toBeVisible();
    await expert.goto(`/expert/tasks/${taskId}?view=workup`);
    await expect(fact('contactPerson')).toContainText('王海明');

    // ── 生成：确认采用资料，生成三份草稿（测试环境第一次生成风险评估报告会模拟失败，遇到就重试这一份） ──
    await expert.getByRole('button', { name: '完成整理，去核对' }).click();
    await expect(expert.getByRole('heading', { name: '确认本次编制使用的资料' })).toBeVisible();
    await shot(expert, 'E18-01-确认采用资料', true);
    await expert.getByRole('button', { name: '确认采用并生成三份草稿' }).click();
    await expect(expert).not.toHaveURL(/view=/, { timeout: 60_000 });
    const done = expert.getByRole('heading', { name: '三份草稿已生成' });
    const retry = expert.getByRole('button', { name: '重试风险评估报告' });
    await expect(done.or(retry)).toBeVisible({ timeout: 300_000 });
    if (await retry.isVisible()) {
      await retry.click();
      await expect(done).toBeVisible({ timeout: 300_000 });
    }
    await shot(expert, 'E18-02-生成完成', true);

    // ── 审阅编辑：改一节，写修订说明保存 ──
    await expert.getByRole('button', { name: '进入正文编辑' }).click();
    const editor = expert.getByRole('textbox', { name: '本节正文' });
    await expect(editor).toBeVisible();
    await editor.locator('p').first().click();
    await expert.keyboard.press('End');
    await expert.keyboard.type('（经现场核实）');
    await expert.getByLabel('修订说明').fill('按现场核实补充');
    await expert.getByRole('region', { name: '保存本节' }).getByRole('button', { name: '保存本节修订' }).click();
    await expect(expert.getByRole('region', { name: '保存本节' })).toContainText('修订已保存');
    await shot(expert, 'E18-04-正文编辑');

    // ── 校对：三份逐份看 Word 版式并核对，确认审核结论 ──
    const checkBar = expert.getByRole('region', { name: '核对本份' });
    const checkThis = async (button: RegExp) => {
      await expect(expert.getByText(/第 \d+ 页 \/ \d+/)).toBeVisible({ timeout: 60_000 });
      await checkBar.getByRole('checkbox').check();
      await checkBar.getByRole('button', { name: button }).click();
    };
    await expert.goto(`/expert/tasks/${taskId}?view=edit&doc=plan&tab=preview`);
    await expect(expert.getByText(/第 \d+ 页 \/ \d+/)).toBeVisible({ timeout: 60_000 });
    await shot(expert, 'E18-05-Word校对');
    await checkThis(/确认本份并核对下一份/);
    await expect(expert).toHaveURL(/doc=risk/);
    await checkThis(/确认本份并核对下一份/);
    await expect(expert).toHaveURL(/doc=resource/);
    await checkThis(/确认本份，去确认审核结论/);
    await expect(expert).toHaveURL(/view=review/);
    await expert.getByRole('checkbox', { name: /确认以上结论对应当前保存稿/ }).check();
    await shot(expert, 'E18-06-审核结论', true);
    await expert.getByRole('button', { name: '确认审核通过，进入发布' }).click();
    await expect(expert.getByRole('heading', { name: '本次审核已通过' })).toBeVisible();

    // ── 发布：形成交付 V1 ──
    await expert.getByRole('button', { name: '进入发布', exact: true }).click();
    await expect(expert.getByRole('heading', { name: '审核已通过，等待发布' })).toBeVisible();
    await expect(expert.getByText('本次将首次发布为交付 V1')).toBeVisible();
    await shot(expert, 'R03-确认发布', true);
    await expert.getByRole('button', { name: '发布三份 Word' }).click();
    await expect(expert.getByRole('heading', { name: '已发布为交付 V1', level: 1 })).toBeVisible({ timeout: 120_000 });
    await shot(expert, 'R04-已发布', true);

    // ── 客户：站内提醒 → 成果文档，下载三份 Word ──
    await customer.goto('/customer');
    await customer.getByRole('button', { name: /提醒，\d+ 条未读/ }).click();
    await customer.getByRole('button', { name: new RegExp(`${COMPANY}的成果已交付`) }).first().click();
    await expect(customer).toHaveURL(new RegExp(`/customer/documents/${taskId}`));
    await expect(customer.getByText('三份文档已交付 · V1 当前版本')).toBeVisible();
    await shot(customer, 'R05-交付详情', true);

    await customer.getByRole('menuitem', { name: '成果文档' }).click();
    const result = customer.getByRole('region', { name: `${COMPANY} V1` });
    await expect(result).toContainText('V1 · 最新');
    await shot(customer, 'C06-成果文档', true);
    for (const doc of DOCS) {
      const name = `${COMPANY}${doc}.docx`;
      const download = customer.waitForEvent('download');
      await result.getByRole('button', { name: `下载 ${name}` }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(name);
      const path = `${OUT}/${name}`;
      await file.saveAs(path);

      // 能打开；有企业名；文件属性写明 AI 辅助起草、注册安全工程师审核；正文没有内部编码
      const zip = await JSZip.loadAsync(await readFile(path));
      const text = await wordText(zip);
      expect(text, `${doc}应有企业名`).toContain(COMPANY);
      expect(text.length, `${doc}正文不应为空`).toBeGreaterThan(2000);
      const core = await zip.file('docProps/core.xml')!.async('string');
      expect(core, `${doc}的文件属性`).toContain('AI 辅助起草、注册安全工程师审核（审核人：吴工）');
      expect(text.match(INTERNAL_CODE)?.[0] ?? null, `${doc}正文出现内部编码`).toBeNull();
      // 事实补件采用的新应急联系人进了三份交付稿
      expect(text, `${doc}应有补件采用的联系人`).toContain('王海明');
      // 审阅时改的那一句进了应急预案
      if (doc === '应急预案') expect(text, '应急预案应有审阅时的修订').toContain('（经现场核实）');
    }
    await expect(customer.locator('main')).not.toContainText(INTERNAL_CODE);

    // ── 反馈：客户就这次交付提交一条意见 → 运营受理、回复并关闭 → 客户在「我的反馈」看到回复 ──
    const TITLE = `应急预案值班电话请再核对一下 ${Date.now() % 10000}`;
    const REPLY = '已转注安师核对，值班电话以贵司确认的 0752-3324567 为准，如需更正可在 3 天内免费修订。';
    await customer.goto(`/customer/documents/${taskId}`);
    await customer.getByRole('button', { name: '反馈文稿问题' }).click();
    const feedback = customer.getByRole('dialog', { name: '反馈文稿问题' });
    await expect(feedback).toContainText('交付 V1');
    await feedback.getByLabel('您的意见').fill(`${TITLE}\n第 3 页的值班电话和我们登记的不一致。`);
    await shot(customer, 'R05-反馈文稿问题');
    await feedback.getByRole('button', { name: '提交反馈' }).click();
    await expect(customer.getByRole('dialog')).toContainText('感谢您的反馈');
    await customer.getByRole('dialog').getByRole('button', { name: '返回原页面' }).click();

    await ops.goto('/operator/feedback');
    await expect(ops.getByRole('heading', { name: '反馈受理', level: 1 })).toBeVisible();
    await ops.getByRole('button', { name: new RegExp(TITLE) }).click();
    const fb = ops.getByRole('region', { name: '反馈详情' });
    await expect(fb.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(fb).toContainText(`陈验收 · ${CUSTOMER_ORG}`);
    await fb.getByRole('button', { name: '受理，稍后回复' }).click();
    await expect(ops.getByText('已受理，客户会收到站内提醒')).toBeVisible();
    await ops.getByRole('tab', { name: /处理中/ }).click();
    await expect(fb).toContainText('处理中 · 赵运营');
    await fb.getByLabel('回复客户').fill(REPLY);
    await shot(ops, 'I08-反馈受理', true);
    await fb.getByRole('button', { name: '回复并关闭' }).click();
    await expect(ops.getByText('已回复客户并关闭')).toBeVisible();

    await customer.goto('/customer/feedback');
    const mine = customer.locator('main').getByRole('listitem').filter({ hasText: TITLE });
    await expect(mine).toContainText('已处理');
    await expect(mine).toContainText(REPLY);
    await shot(customer, 'C-我的反馈', true);
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});

// 预览环境的演示数据（只用虚构数据）。可以反复运行：已有的一律跳过、只补没有的，
// 不改已有账号的密码，不删、不覆盖任何数据（测试人员在预览环境里录的数据都保留）。
// 各项按业务上不会变的标识先查后插：账号按邮箱、组织按名称、企业按信用代码（没有代码的按名称）、
// 编制任务按企业（这家企业已有应急预案任务就不再建）、合同按组织（已登记过合同就不再登记）。
import { createHash, randomUUID } from 'node:crypto';
import { type ChecklistItemKey, type ChecklistState, chinaToday, formatTaskNumber } from '@genyun/shared';
import { feiyuBasicInfo, feiyuChecklist } from '@genyun/shared/fixtures/feiyu';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  checklistItems,
  enterprises,
  files,
  memberships,
  organizationContracts,
  organizations,
  taskNumberCounters,
  taskSubmissions,
  tasks,
  users,
} from '../db/schema.ts';
import type { FileStorage } from '../files/storage.ts';

export const DEMO_EMAILS = {
  agencyAdmin: 'admin@demo.genyun.net.cn',
  expert: 'expert@demo.genyun.net.cn',
  operator: 'ops@demo.genyun.net.cn',
  feiyu: 'feiyu@demo.genyun.net.cn',
  expert2: 'expert2@demo.genyun.net.cn',
} as const;

export const DEMO_ORGS = { internal: '耕云', agency: '示例安全咨询机构', feiyu: '飞宇演示客户' } as const;
export const DEMO_OTHER_ENTERPRISE = '示例五金制品有限公司';

export interface DemoSeedOptions {
  // 只给新建的账号用；已有账号的密码不动
  passwordHash: string;
  // 演示合同原件（虚构的一页 PDF）存放处
  storage: FileStorage;
  now?: Date;
}

export interface DemoSeedReport {
  created: string[];
  skipped: string[];
}

// 两家演示客户组织都按已开通处理
const CONTRACT = { contractStartsAt: '2026-01-01', contractEndsAt: '2027-12-31' };
const ACTIVATED_AT = new Date('2026-01-01T00:00:00+08:00');

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function seedDemo(db: Database, opts: DemoSeedOptions): Promise<DemoSeedReport> {
  const report: DemoSeedReport = { created: [], skipped: [] };
  const now = opts.now ?? new Date();

  // 组织：按名称找；已有的只补空着的资料（地区、联系人、合同有效期、开通时间），填过的不改
  const internalId = await ensureOrg(db, report, { name: DEMO_ORGS.internal, kind: 'internal' });
  const agencyId = await ensureOrg(db, report, {
    name: DEMO_ORGS.agency,
    kind: 'customer',
    fill: { region: '广东省惠州市', contactName: '林管理员', contactPhone: '138 0000 6201', ...CONTRACT, activatedAt: ACTIVATED_AT },
  });
  // 飞宇单独一个客户组织：专家处理用的演示任务放这里，不影响上面机构的演示与测试数据
  const feiyuOrgId = await ensureOrg(db, report, {
    name: DEMO_ORGS.feiyu,
    kind: 'customer',
    fill: { region: '广东省惠州市', contactName: '陈志刚', contactPhone: '139 0000 3388', ...CONTRACT, activatedAt: ACTIVATED_AT },
  });

  const people = [
    { email: DEMO_EMAILS.agencyAdmin, name: '林管理员', orgId: agencyId, role: 'customer_admin' as const },
    { email: DEMO_EMAILS.expert, name: '周工', orgId: internalId, role: 'expert' as const },
    { email: DEMO_EMAILS.operator, name: '赵运营', orgId: internalId, role: 'operator' as const },
    { email: DEMO_EMAILS.feiyu, name: '陈志刚', orgId: feiyuOrgId, role: 'customer_admin' as const },
    { email: DEMO_EMAILS.expert2, name: '吴工', orgId: internalId, role: 'expert' as const },
  ];
  const uid: Record<string, string> = {};
  for (const p of people) uid[p.email] = await ensureUser(db, report, p, opts.passwordHash);

  // 合同登记：运营在组织详情里能看到合同编号、服务范围和合同原件
  const operator = uid[DEMO_EMAILS.operator]!;
  await ensureContract(db, opts.storage, report, { orgId: agencyId, number: 'GY-DEMO-2026-01', scopeEnterprises: 10, by: operator, now });
  await ensureContract(db, opts.storage, report, { orgId: feiyuOrgId, number: 'GY-DEMO-2026-02', scopeEnterprises: 2, by: operator, now });

  // 飞宇自填的企业资料（各步都填了，可以直接提交、专业整理、生成）；
  // 技术人员数故意不填，演示专家整理时补齐缺失项（浏览器测试也按这一项走）
  const customer = uid[DEMO_EMAILS.feiyu]!;
  const { technicalManagementCount: _, ...feiyuBasic } = feiyuProfile.basicStep!.basic;
  const feiyuId = await ensureEnterprise(db, report, {
    orgId: feiyuOrgId,
    name: feiyuBasicInfo.companyName,
    socialCreditCode: feiyuBasicInfo.socialCreditCode!,
    registeredAddress: feiyuBasicInfo.registeredAddress?.detail ?? null,
    legalRepresentative: feiyuBasicInfo.legalRepresentative ?? null,
    profile: { ...feiyuProfile, basicStep: { ...feiyuProfile.basicStep!, basic: feiyuBasic } },
    createdBy: customer,
  });
  const otherId = await ensureEnterprise(db, report, { orgId: feiyuOrgId, name: DEMO_OTHER_ENTERPRISE, createdBy: customer });

  // 已提交的两个任务：飞宇分派给周工，另一家分派给吴工（验证专家互相看不到）。
  // 飞宇的资料：样例里已备齐的照旧，另有两项请专家电话联系、一项拍照给耕云看
  const submittedAt = new Date(now.getTime() - 2 * 3_600_000);
  const feiyuItems: ChecklistState = {
    ...feiyuChecklist,
    emergency_supplies: { status: 'later', fileIds: [], callRequested: true },
    fire_pool: { status: 'later', fileIds: [], callRequested: true },
    special_equipment: { status: 'photo_for_expert', fileIds: [], callRequested: false },
  };
  await ensureSubmittedTask(db, report, {
    label: `${feiyuBasicInfo.companyName}（周工）`,
    orgId: feiyuOrgId,
    enterpriseId: feiyuId,
    expertId: uid[DEMO_EMAILS.expert]!,
    customerId: customer,
    items: feiyuItems,
    submittedAt,
  });
  await ensureSubmittedTask(db, report, {
    label: `${DEMO_OTHER_ENTERPRISE}（吴工）`,
    orgId: feiyuOrgId,
    enterpriseId: otherId,
    expertId: uid[DEMO_EMAILS.expert2]!,
    customerId: customer,
    items: { fire_pool: { status: 'later', fileIds: [], callRequested: true } },
    submittedAt,
  });
  return report;
}

type OrgFill = Partial<Pick<typeof organizations.$inferInsert, 'region' | 'contactName' | 'contactPhone' | 'contractStartsAt' | 'contractEndsAt' | 'activatedAt'>>;

async function ensureOrg(db: Database, report: DemoSeedReport, spec: { name: string; kind: 'internal' | 'customer'; fill?: OrgFill }) {
  const fill = spec.fill ?? {};
  const [found] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.name, spec.name), eq(organizations.kind, spec.kind)))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  if (!found) {
    const [created] = await db.insert(organizations).values({ name: spec.name, kind: spec.kind, ...fill }).returning({ id: organizations.id });
    report.created.push(`组织「${spec.name}」`);
    return created!.id;
  }
  const patch: OrgFill = {};
  for (const [key, value] of Object.entries(fill) as [keyof OrgFill, never][]) {
    if (found[key] === null) patch[key] = value;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(organizations).set(patch).where(eq(organizations.id, found.id));
    report.created.push(`组织「${spec.name}」补上空着的资料`);
  } else {
    report.skipped.push(`组织「${spec.name}」`);
  }
  return found.id;
}

async function ensureUser(
  db: Database,
  report: DemoSeedReport,
  p: { email: string; name: string; orgId: string; role: (typeof memberships.$inferInsert)['role'] },
  passwordHash: string,
) {
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.email)).limit(1);
  if (found) {
    // 账号已有：密码、姓名都不动；只有一个组织都不在时（不会出现，以防万一）才补上成员关系
    const [member] = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, found.id)).limit(1);
    if (!member) {
      await db.insert(memberships).values({ userId: found.id, orgId: p.orgId, role: p.role });
      report.created.push(`账号 ${p.email} 补上所在组织`);
    } else {
      report.skipped.push(`账号 ${p.email}`);
    }
    return found.id;
  }
  const id = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning({ id: users.id });
    await tx.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
    return u!.id;
  });
  report.created.push(`账号 ${p.email}`);
  return id;
}

async function ensureContract(
  db: Database,
  storage: FileStorage,
  report: DemoSeedReport,
  c: { orgId: string; number: string; scopeEnterprises: number; by: string; now: Date },
) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, c.orgId)).limit(1);
  const [existing] = await db.select({ id: organizationContracts.id }).from(organizationContracts).where(eq(organizationContracts.orgId, c.orgId)).limit(1);
  if (existing) {
    report.skipped.push(`「${org!.name}」的合同登记`);
    return;
  }
  const fileId = randomUUID();
  const key = `${c.orgId}/${fileId}`;
  const pdf = demoContractPdf(c.number);
  await storage.put(key, pdf, 'application/pdf');
  await db.transaction(async (tx) => {
    await tx.insert(files).values({
      id: fileId,
      orgId: c.orgId,
      kind: 'contract',
      originalName: `${org!.name}-年度服务合同（演示）.pdf`,
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      storageKey: key,
      uploadedBy: c.by,
    });
    await tx.insert(organizationContracts).values({
      orgId: c.orgId,
      number: c.number,
      scopeKind: 'annual',
      scopeEnterprises: c.scopeEnterprises,
      startsAt: org!.contractStartsAt ?? CONTRACT.contractStartsAt,
      endsAt: org!.contractEndsAt ?? CONTRACT.contractEndsAt,
      fileId,
      paymentConfirmedBy: c.by,
      paymentConfirmedAt: c.now,
    });
  });
  report.created.push(`「${org!.name}」的合同登记 ${c.number}`);
}

async function ensureEnterprise(
  db: Database,
  report: DemoSeedReport,
  e: Omit<typeof enterprises.$inferInsert, 'id'> & { orgId: string; name: string },
) {
  // 有信用代码的按代码找（同一组织里代码唯一），没有的按名称找；已有的资料一律不改
  const key = e.socialCreditCode ? eq(enterprises.socialCreditCode, e.socialCreditCode) : eq(enterprises.name, e.name);
  const [found] = await db
    .select({ id: enterprises.id })
    .from(enterprises)
    .where(and(eq(enterprises.orgId, e.orgId), key))
    .orderBy(asc(enterprises.createdAt))
    .limit(1);
  if (found) {
    report.skipped.push(`企业「${e.name}」`);
    return found.id;
  }
  const [created] = await db.insert(enterprises).values(e).returning({ id: enterprises.id });
  report.created.push(`企业「${e.name}」`);
  return created!.id;
}

async function ensureSubmittedTask(
  db: Database,
  report: DemoSeedReport,
  t: { label: string; orgId: string; enterpriseId: string; expertId: string; customerId: string; items: ChecklistState; submittedAt: Date },
) {
  // 这家企业已有应急预案任务（不管进行到哪一步、有没有结束）就不再建，免得把测试人员的进度弄乱
  const [found] = await db
    .select({ number: tasks.number })
    .from(tasks)
    .where(and(eq(tasks.enterpriseId, t.enterpriseId), eq(tasks.businessType, 'emergency_plan')))
    .limit(1);
  if (found) {
    report.skipped.push(`任务 ${found.number} ${t.label}`);
    return;
  }
  const number = await db.transaction(async (tx) => {
    const { year, number } = await nextTaskNumber(tx);
    const [task] = await tx
      .insert(tasks)
      .values({
        orgId: t.orgId,
        enterpriseId: t.enterpriseId,
        number,
        businessType: 'emergency_plan',
        name: `${year} 年生产安全事故应急预案编制`,
        startMethod: 'self_fill',
        status: 'submitted',
        submittedAt: t.submittedAt,
        createdAt: t.submittedAt,
        updatedAt: t.submittedAt,
        assignedExpertId: t.expertId,
        createdBy: t.customerId,
      })
      .returning({ id: tasks.id });
    const entries = Object.entries(t.items) as [ChecklistItemKey, NonNullable<ChecklistState[ChecklistItemKey]>][];
    await tx.insert(checklistItems).values(
      entries.map(([itemKey, s]) => ({
        taskId: task!.id,
        itemKey,
        status: s.status,
        callRequested: s.callRequested,
        confirmedBy: t.customerId,
        confirmedAt: t.submittedAt,
        updatedBy: t.customerId,
        updatedAt: new Date(t.submittedAt.getTime() - 600_000),
      })),
    );
    await tx.insert(taskSubmissions).values({
      taskId: task!.id,
      requestId: randomUUID(),
      submittedBy: t.customerId,
      submittedAt: t.submittedAt,
      documents: [],
      items: t.items,
      answers: [],
      pendingKeys: entries.filter(([, s]) => s.status === 'later').map(([k]) => k),
    });
    return number;
  });
  report.created.push(`任务 ${number} ${t.label}`);
}

// 和客户新建任务用同一个按年流水的计数，不会和预览环境里已有的任务撞号
async function nextTaskNumber(tx: Tx) {
  const year = Number(chinaToday().slice(0, 4));
  const [counter] = await tx
    .insert(taskNumberCounters)
    .values({ year, last: 1 })
    .onConflictDoUpdate({ target: taskNumberCounters.year, set: { last: sql`${taskNumberCounters.last} + 1` } })
    .returning({ last: taskNumberCounters.last });
  return { year, number: formatTaskNumber(year, counter!.last) };
}

// 一页的演示合同原件（虚构，只有英文字样，不依赖中文字体）
export function demoContractPdf(number: string): Buffer {
  const text = `DEMO CONTRACT ${number} - fictional sample for the preview environment`;
  const stream = `BT /F1 14 Tf 72 760 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

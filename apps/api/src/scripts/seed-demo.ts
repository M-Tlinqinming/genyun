// 预览环境的演示账号（只用虚构数据）。正式环境不要运行。
import { type ChecklistItemKey, type ChecklistState, chinaToday, formatTaskNumber } from '@genyun/shared';
import { feiyuBasicInfo, feiyuChecklist } from '@genyun/shared/fixtures/feiyu';
import { feiyuProfile } from '@genyun/shared/fixtures/feiyu-profile';
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase } from '../db/client.ts';
import {
  checklistItems,
  enterprises,
  memberships,
  organizations,
  taskNumberCounters,
  taskSubmissions,
  tasks,
  users,
} from '../db/schema.ts';

if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEMO_SEED) {
  throw new Error('拒绝在正式环境写入演示账号');
}

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('请用 DEMO_PASSWORD 环境变量指定演示密码');

const { db, close } = await openDatabase(process.env.DATABASE_URL ?? '.data/dev-db');
const passwordHash = await hashPassword(password);

// 两家都按已开通处理（M3 运营开通前的演示数据）
const contract = { contractStartsAt: '2026-01-01', contractEndsAt: '2027-12-31', activatedAt: new Date('2026-01-01T00:00:00+08:00') };
const [internal] = await db.insert(organizations).values({ name: '耕云', kind: 'internal' }).returning();
const [agency] = await db.insert(organizations).values({ name: '示例安全咨询机构', kind: 'customer', region: '广东省惠州市', contactName: '林管理员', contactPhone: '138 0000 6201', ...contract }).returning();
// 飞宇单独一个客户组织：专家处理（M2）用的演示任务放这里，不影响上面机构的演示与测试数据
const [feiyuOrg] = await db.insert(organizations).values({ name: '飞宇演示客户', kind: 'customer', region: '广东省惠州市', contactName: '陈志刚', contactPhone: '139 0000 3388', ...contract }).returning();

const people = [
  { email: 'admin@demo.genyun.net.cn', name: '林管理员', orgId: agency!.id, role: 'customer_admin' as const },
  { email: 'expert@demo.genyun.net.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
  { email: 'ops@demo.genyun.net.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
  { email: 'feiyu@demo.genyun.net.cn', name: '陈志刚', orgId: feiyuOrg!.id, role: 'customer_admin' as const },
  { email: 'expert2@demo.genyun.net.cn', name: '吴工', orgId: internal!.id, role: 'expert' as const },
];
const uid: Record<string, string> = {};
for (const p of people) {
  const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
  await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
  uid[p.email] = u!.id;
}
console.log(`已创建 ${people.length} 个演示账号：${people.map((p) => p.email).join('、')}`);

// 飞宇任务预置为已分派给周工，便于直接演示专家端；另一家（五金）待运营在任务中心分派
const customer = uid['feiyu@demo.genyun.net.cn']!;
// 飞宇自填的企业资料（专业整理用）；技术人员数故意不填，演示专家整理时补齐缺失项
const { technicalManagementCount: _, ...feiyuBasic } = feiyuProfile.basicStep!.basic;
const [feiyu, other] = await db
  .insert(enterprises)
  .values([
    {
      orgId: feiyuOrg!.id,
      name: feiyuBasicInfo.companyName,
      socialCreditCode: feiyuBasicInfo.socialCreditCode,
      registeredAddress: feiyuBasicInfo.registeredAddress?.detail ?? null,
      legalRepresentative: feiyuBasicInfo.legalRepresentative,
      profile: { ...feiyuProfile, basicStep: { ...feiyuProfile.basicStep!, basic: feiyuBasic } },
      createdBy: customer,
    },
    { orgId: feiyuOrg!.id, name: '示例五金制品有限公司', createdBy: customer },
  ])
  .returning();

const year = Number(chinaToday().slice(0, 4));
const now = Date.now();
const submittedAt = new Date(now - 2 * 3_600_000);
const [feiyuTask, otherTask] = await db
  .insert(tasks)
  .values(
    [
      { enterpriseId: feiyu!.id, expert: 'expert@demo.genyun.net.cn' },
      { enterpriseId: other!.id, expert: null },
    ].map((t, i) => ({
      orgId: feiyuOrg!.id,
      enterpriseId: t.enterpriseId,
      number: formatTaskNumber(year, i + 1),
      businessType: 'emergency_plan' as const,
      name: `${year} 年生产安全事故应急预案编制`,
      startMethod: 'self_fill' as const,
      status: 'submitted' as const,
      submittedAt,
      createdAt: submittedAt,
      updatedAt: submittedAt,
      assignedExpertId: t.expert ? uid[t.expert]! : null,
      createdBy: customer,
    })),
  )
  .returning();
await db.insert(taskNumberCounters).values({ year, last: 2 });

// 飞宇的资料：样例里已备齐的照旧，另有两项请专家电话联系、一项拍照给耕云看
const items: ChecklistState = {
  ...feiyuChecklist,
  emergency_supplies: { status: 'later', fileIds: [], callRequested: true },
  fire_pool: { status: 'later', fileIds: [], callRequested: true },
  special_equipment: { status: 'photo_for_expert', fileIds: [], callRequested: false },
};
const pendingKeys = (Object.keys(items) as ChecklistItemKey[]).filter((k) => items[k]!.status === 'later');
for (const [taskId, state] of [
  [feiyuTask!.id, items],
  [otherTask!.id, { fire_pool: { status: 'later', fileIds: [], callRequested: true } } as ChecklistState],
] as const) {
  await db.insert(checklistItems).values(
    Object.entries(state).map(([itemKey, s]) => ({
      taskId,
      itemKey,
      status: s!.status,
      callRequested: s!.callRequested,
      confirmedBy: customer,
      confirmedAt: submittedAt,
      updatedBy: customer,
      updatedAt: new Date(submittedAt.getTime() - 600_000),
    })),
  );
  await db.insert(taskSubmissions).values({
    taskId,
    requestId: crypto.randomUUID(),
    submittedBy: customer,
    submittedAt,
    documents: [],
    items: state,
    answers: [],
    pendingKeys: taskId === feiyuTask!.id ? pendingKeys : ['fire_pool'],
  });
}
console.log(`已创建演示任务：${feiyuTask!.number}（飞宇，周工）、${otherTask!.number}（五金，待运营分派）`);
await close();

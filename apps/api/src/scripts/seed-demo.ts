// 预览环境的演示账号（只用虚构数据）。正式环境不要运行。
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase } from '../db/client.ts';
import { memberships, organizations, users } from '../db/schema.ts';

if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEMO_SEED) {
  throw new Error('拒绝在正式环境写入演示账号');
}

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('请用 DEMO_PASSWORD 环境变量指定演示密码');

const { db, close } = await openDatabase(process.env.DATABASE_URL ?? '.data/dev-db');
const passwordHash = await hashPassword(password);

const [internal] = await db.insert(organizations).values({ name: '耕云', kind: 'internal' }).returning();
const [agency] = await db
  .insert(organizations)
  .values({ name: '示例安全咨询机构', kind: 'customer', contractStartsAt: '2026-01-01', contractEndsAt: '2027-12-31' })
  .returning();

const people = [
  { email: 'admin@demo.genyun.net.cn', name: '林管理员', orgId: agency!.id, role: 'customer_admin' as const },
  { email: 'expert@demo.genyun.net.cn', name: '周工', orgId: internal!.id, role: 'expert' as const },
  { email: 'ops@demo.genyun.net.cn', name: '赵运营', orgId: internal!.id, role: 'operator' as const },
];
for (const p of people) {
  const [u] = await db.insert(users).values({ email: p.email, name: p.name, passwordHash }).returning();
  await db.insert(memberships).values({ userId: u!.id, orgId: p.orgId, role: p.role });
}
console.log(`已创建 ${people.length} 个演示账号：${people.map((p) => p.email).join('、')}`);
await close();

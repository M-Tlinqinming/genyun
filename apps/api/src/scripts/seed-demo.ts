// 预览环境写入演示数据（只用虚构数据）。正式环境不要运行。
// 可以反复运行：已有的账号、组织、企业、任务都跳过，只补没有的；不改已有账号的密码，不删任何数据。
import { hashPassword } from '../auth/auth.service.ts';
import { openDatabase } from '../db/client.ts';
import { defaultStorage } from '../files/storage.ts';
import { seedDemo } from './demo-seed.ts';

if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEMO_SEED) {
  throw new Error('拒绝在正式环境写入演示账号');
}

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('请用 DEMO_PASSWORD 环境变量指定演示密码');

const { db, close } = await openDatabase(process.env.DATABASE_URL ?? '.data/dev-db');
try {
  const report = await seedDemo(db, { passwordHash: await hashPassword(password), storage: defaultStorage() });
  console.log(report.created.length ? `新写入 ${report.created.length} 项：\n  ${report.created.join('\n  ')}` : '没有要新写入的');
  if (report.skipped.length) console.log(`已有、跳过 ${report.skipped.length} 项：\n  ${report.skipped.join('\n  ')}`);
} finally {
  await close();
}

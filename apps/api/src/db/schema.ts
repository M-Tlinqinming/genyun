import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// 组织分两类：客户组织（中小企业 / 安全服务机构）、耕云内部（运营与专业人员所在的组织）
export const orgKind = pgEnum('org_kind', ['customer', 'internal']);
export const role = pgEnum('role', ['customer_admin', 'customer_member', 'expert', 'operator']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: orgKind('kind').notNull(),
  // 安全服务机构的年度服务到期日；按次付费的组织为空
  serviceEndsAt: timestamp('service_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: role('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

// 只存会话令牌的哈希，数据库泄露也拿不到可用的令牌
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

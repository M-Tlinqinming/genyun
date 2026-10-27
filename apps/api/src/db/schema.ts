import { CALL_TIMES, ITEM_STATUSES, ON_SITE_STATUSES, type CallTime, type EnterpriseProfile } from '@genyun/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 组织分两类：客户组织（中小企业 / 安全服务机构）、耕云内部（运营与专业人员所在的组织）
export const orgKind = pgEnum('org_kind', ['customer', 'internal']);
export const role = pgEnum('role', ['customer_admin', 'customer_member', 'expert', 'operator']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: orgKind('kind').notNull(),
  // 合同有效期（北京时间日期，起止日都算在内）；有效期内才能新建任务。运营开通时登记，未登记为空
  contractStartsAt: date('contract_starts_at', { mode: 'string' }),
  contractEndsAt: date('contract_ends_at', { mode: 'string' }),
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

// 企业档案。一个客户组织（尤其是安全服务机构）可以管理多家企业
export const enterprises = pgTable(
  'enterprises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    socialCreditCode: text('social_credit_code'),
    registeredAddress: text('registered_address'),
    legalRepresentative: text('legal_representative'),
    // 企业自填的资料（第 1 步其余字段等），按步骤分块存；下一年度的任务直接复用
    profile: jsonb('profile').$type<EnterpriseProfile>().notNull().default({}),
    // 每次保存加 1；保存时带上读到的版本，别人已改过就拒绝，避免互相覆盖
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 同一组织里不能有两家统一社会信用代码相同的企业；没填代码的不限制
  (t) => [
    uniqueIndex('enterprises_org_credit_code_unique')
      .on(t.orgId, t.socialCreditCode)
      .where(sql`${t.socialCreditCode} is not null`),
  ],
);

export const businessType = pgEnum('business_type', ['emergency_plan']);
export const taskStatus = pgEnum('task_status', ['preparing', 'submitted']);
export const startMethod = pgEnum('start_method', ['self_fill', 'upload']);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 冗余存所属组织，权限查询不必再连企业表；创建时取自企业，之后不变
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    number: text('number').notNull().unique(),
    businessType: businessType('business_type').notNull(),
    name: text('name').notNull(),
    // 还没选开始方式时为空
    startMethod: startMethod('start_method'),
    status: taskStatus('status').notNull().default('preparing'),
    // 负责专家，运营分派前为空
    assignedExpertId: uuid('assigned_expert_id').references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // 交付完成或关闭的时间；为空表示任务还没结束
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  // 同一家企业同一种业务只能有一个没结束的任务
  (t) => [
    uniqueIndex('tasks_one_open_per_enterprise')
      .on(t.enterpriseId, t.businessType)
      .where(sql`${t.closedAt} is null`),
  ],
);

// 任务编号按年流水，全平台共用一个计数
export const taskNumberCounters = pgTable('task_number_counters', {
  year: integer('year').primaryKey(),
  last: integer('last').notNull(),
});

export const itemStatus = pgEnum('item_status', ITEM_STATUSES);
export const expertResult = pgEnum('expert_result', ['pending', 'yes', 'no']);

// 资料清单 19 项的状态，每个任务每项一行；客户还没回答的项没有这一行
export const checklistItems = pgTable(
  'checklist_items',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    status: itemStatus('status').notNull(),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // 客户点了「请专家电话联系」
    callRequested: boolean('call_requested').notNull().default(false),
    // 「由我确认」时直接填写的实际情况
    note: text('note'),
    // 状态由企业自填内容自动得出；自填内容清空时只撤回这种，客户在检查页手动处理的不动
    synced: boolean('synced').notNull().default(false),
    expertResult: expertResult('expert_result'),
    expertJudgedBy: uuid('expert_judged_by').references(() => users.id),
    expertJudgedAt: timestamp('expert_judged_at', { withTimezone: true }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.itemKey] })],
);

// customer_material = 客户上传的资料，本组织与相关人员可见；contract = 已签合同原件，仅运营可见（M3）
export const fileKind = pgEnum('file_kind', ['customer_material', 'contract']);

// 上传的文件。内容在文件存储里（本机磁盘 / 对象存储），这里只存登记信息
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  kind: fileKind('kind').notNull(),
  // 客户看到的原文件名；存储路径只用系统生成的 ID
  originalName: text('original_name').notNull(),
  // 按文件内容判断出的类型，不信任浏览器给的类型
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 资料项关联的文件。移除关联不删除文件本身（企业原件保留）
export const checklistItemFiles = pgTable(
  'checklist_item_files',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    linkedBy: uuid('linked_by')
      .notNull()
      .references(() => users.id),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.itemKey, t.fileId] })],
);

export const onSiteStatus = pgEnum('on_site_status', ON_SITE_STATUSES);
export const callTime = pgEnum('call_time', Object.keys(CALL_TIMES) as [CallTime, ...CallTime[]]);

// 上门工单：客户请耕云专家上门整理资料。独立于编制任务（关联任务可空），运营在 M3 处理；
// 报价、排期、现场交接全部线下
export const onSiteRequests = pgTable('on_site_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  enterpriseId: uuid('enterprise_id')
    .notNull()
    .references(() => enterprises.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  contactName: text('contact_name').notNull(),
  contactPhone: text('contact_phone').notNull(),
  callTime: callTime('call_time'),
  // 需要帮忙整理的内容，默认带出待补的项
  helpItems: jsonb('help_items').$type<string[]>().notNull().default([]),
  note: text('note'),
  status: onSiteStatus('status').notNull().default('new'),
  // 运营内部备注，客户看不到（M3）
  internalNote: text('internal_note'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 企业资料库：企业名下的原始资料，同一份资料可以有多个版本（Paper 11 页 C03 企业资料、12 页 P03）。
// 两种开始方式上传的文件都进这里，下一年度的任务可以直接选用
export const enterpriseDocuments = pgTable('enterprise_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  enterpriseId: uuid('enterprise_id')
    .notNull()
    .references(() => enterprises.id, { onDelete: 'cascade' }),
  // 显示名，默认取第一版的文件名
  name: text('name').notNull(),
  // 资料清单的分类（CATEGORIES 的 key）；为空表示待整理，以后由专家或自动归类补上
  category: text('category'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseDocumentVersions = pgTable(
  'enterprise_document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => enterpriseDocuments.id, { onDelete: 'cascade' }),
    // 1、2、3…，界面显示为 V1、V2
    version: integer('version').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('enterprise_document_versions_number').on(t.documentId, t.version),
    // 同一个文件只登记一次
    uniqueIndex('enterprise_document_versions_file').on(t.fileId),
  ],
);

// 任务用的是资料库里哪一份资料的哪个版本；上传新版本不会自动替换，已提交的任务保留原版本
export const taskDocuments = pgTable(
  'task_documents',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => enterpriseDocuments.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => enterpriseDocumentVersions.id, { onDelete: 'cascade' }),
    linkedBy: uuid('linked_by')
      .notNull()
      .references(() => users.id),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.documentId] })],
);

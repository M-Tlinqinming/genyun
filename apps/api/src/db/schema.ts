import {
  CALL_TIMES,
  DRAFT_KIND_KEYS,
  DRAFT_STATUSES,
  ITEM_STATUSES,
  ON_SITE_STATUSES,
  type CallTime,
  type ChecklistItemKey,
  type ChecklistState,
  type ContactQuestion,
  type ContactTarget,
  type DraftKind,
  type EditBlock,
  type EnterpriseProfile,
  type LockedMaterial,
  type PlanInput,
  type PublishStatus,
  type SectionEdit,
  type SubmittedAnswer,
  type SubmittedDocument,
  type SupplementFact,
  type SupplementStatus,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { sql } from 'drizzle-orm';
import type { SlotNote } from '../generation/ai/slots.ts';
import {
  boolean,
  date,
  index,
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
  // 以下为运营登记的客户组织资料（M3）；内部组织和 M3 之前建的演示组织为空
  region: text('region'),
  socialCreditCode: text('social_credit_code'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  note: text('note'),
  registeredBy: uuid('registered_by'),
  // 运营开通的时间；为空 = 登记了还没开通（列表里的「待开通」）
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  activatedBy: uuid('activated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // 本人最近一次改密码或重设密码的时间；邀请、运营建号时为空
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A03 账号恢复验证码：只存哈希（argon2），10 分钟有效，错 5 次或用过一次即作废。
// 同一账号重新发送时，旧的未用验证码一并作废。
export const passwordRecoveryCodes = pgTable(
  'password_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    // 用过、错满次数或被新验证码替换时填上
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_recovery_codes_user').on(t.userId)],
);

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
    // 负责注安师，运营分派前为空
    assignedExpertId: uuid('assigned_expert_id').references(() => users.id),
    // 现在这位负责注安师接手的时间；改派后「客户请电话联系」的期限从这里重新算
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
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

// 提交生成申请的记录（13 页 F02、F03）：谁在什么时候提交、用了哪些资料的哪个版本、当时各项的处理情况。
// 一个任务提交一次；requestId 由页面生成，同一次提交重发（如断网后）只记一次
export const taskSubmissions = pgTable('task_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .unique()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull().unique(),
  submittedBy: uuid('submitted_by')
    .notNull()
    .references(() => users.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  documents: jsonb('documents').$type<SubmittedDocument[]>().notNull(),
  items: jsonb('items').$type<ChecklistState>().notNull(),
  // 由客户自己确认的事项（直接填写、没有、业务问题），确认框里显示的就是这些
  answers: jsonb('answers').$type<SubmittedAnswer[]>().notNull(),
  // 提交时还没给的项：提交后仍可以补，其余已处理的项锁定
  pendingKeys: jsonb('pending_keys').$type<ChecklistItemKey[]>().notNull(),
});

// 专业整理（14 页 E18-00A）：每个任务一份。负责专家第一次打开任务时复制企业资料作快照，
// 之后客户再改企业资料不影响这里（变化走事实补件）；专家的修改只记在 data 里，标为专家整理
export const taskWorkups = pgTable('task_workups', {
  taskId: uuid('task_id')
    .primaryKey()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').$type<WorkupSnapshot>().notNull(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  data: jsonb('data').$type<WorkupData>().notNull().default({ overrides: {} }),
  // 每次保存加 1；保存时带上读到的版本，别人已改过就拒绝，避免互相覆盖
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contactMethod = pgEnum('contact_method', ['request', 'phone']);
export const contactResult = pgEnum('contact_result', ['clarified', 'later', 'unreachable']);

// 联系记录（14 页 E18-00E）：负责专家每联系客户一次记一条。任务内补充请求进客户待补清单，客户回答后记下回答；
// 电话记下拨打对象、结果和回答。客户只看到发给他的问题，看不到电话记录
export const taskContacts = pgTable(
  'task_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    method: contactMethod('method').notNull(),
    questions: jsonb('questions').$type<ContactQuestion[]>().notNull(),
    // 电话才有
    target: jsonb('target').$type<ContactTarget>(),
    result: contactResult('result'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // 任务内补充：客户回答的人和时间；为空表示还在等客户回答
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [index('task_contacts_task').on(t.taskId, t.createdAt)],
);

// 事实补件（M2 第 13 项，15 页 R00a–R00c）：每轮一行。专家发起时记下要核对的事实和本任务原来用的值；
// 客户回应记文件和说明；专家明确采用时写下本轮采用的值，同时改专业整理里的企业事实。
// 「仍需客户补充」把这一轮标为 returned，另起下一轮
export const factSupplements = pgTable(
  'fact_supplements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    status: text('status').$type<SupplementStatus>().notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    itemKey: text('item_key').$type<ChecklistItemKey>(),
    needsFile: boolean('needs_file').notNull(),
    facts: jsonb('facts').$type<SupplementFact[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    responseFileIds: jsonb('response_file_ids').$type<string[]>(),
    responseNote: text('response_note'),
    respondedBy: uuid('responded_by').references(() => users.id),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    adoptedBy: uuid('adopted_by').references(() => users.id),
    adoptedAt: timestamp('adopted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('fact_supplements_round').on(t.taskId, t.round)],
);

// 运营在任务上的记录（16 页 I04 超时兜底）：内部备注、提醒注安师、改派、已致电客户安抚。只在运营端显示，客户、注安师都看不到
export const operatorNoteKind = pgEnum('operator_note_kind', ['note', 'remind_expert', 'reassign', 'called_customer']);
export const taskOperatorNotes = pgTable(
  'task_operator_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: operatorNoteKind('kind').notNull(),
    // 备注正文；提醒注安师、致电客户时是附带的话（可空）；改派时是「周工 → 吴工 · 理由」
    body: text('body').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_operator_notes_task').on(t.taskId, t.createdAt)],
);

// 站内提醒（顶栏铃铛）：业务提醒只在站内，不发邮件、短信（2026-10-28 Martin 确认）
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // 点开去哪个页面
    link: text('link').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
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

// customer_material = 客户上传的资料，本组织与相关人员可见；contract = 已签合同原件，仅运营可见（M3）；
// draft = 系统生成的草稿（Word、PDF），只有负责专家和运营看得到，发布前客户看不到；
// delivery = 发布时定下的三份交付 Word（M2 第 15 项），本组织客户、负责专家和运营能看
export const fileKind = pgEnum('file_kind', ['customer_material', 'contract', 'draft', 'delivery']);

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
  // 运营标记「已转交公司」「关闭工单」的时间（M3 第 4 项）；重新打开时清空
  handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
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

export const draftKind = pgEnum('draft_kind', DRAFT_KIND_KEYS as [DraftKind, ...DraftKind[]]);
export const draftStatus = pgEnum('draft_status', DRAFT_STATUSES);

// 确认采用资料并生成（14 页 E18-01）：专家每确认一次记一批。生成用的输入在确认时拼好存下，
// 之后整理再改也不影响这一批；重试失败的份用同一份输入
export const generationBatches = pgTable(
  'generation_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    workupVersion: integer('workup_version').notNull(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
    input: jsonb('input').$type<PlanInput>().notNull(),
    materials: jsonb('materials').$type<LockedMaterial[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generation_batches_task').on(t.taskId, t.createdAt)],
);

// 一批里的三份草稿，各自排队、各自记进度
export const generatedDrafts = pgTable(
  'generated_drafts',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    status: draftStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    wordFileId: uuid('word_file_id').references(() => files.id),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    // 生成时的文档结构（JSON，图片以 base64 存），正文编辑在它上面按节修订；第 11 项之前生成的没有
    documentFileId: uuid('document_file_id').references(() => files.id),
    error: text('error'),
    // 每个空位、每段用的是 AI 还是系统的内容，给专家核对
    notes: jsonb('notes').$type<SlotNote[]>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.kind] })],
);

// 正文编辑（M2 第 11 项）：一批里每份草稿一行，存专家改过的各节（节编号 → 修订后的内容）。
// version 是整份的修订次数，任何一节保存都加 1；每节另记 rev，两人同时改同一节时后保存的被拒绝
export const draftEdits = pgTable(
  'draft_edits',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    sections: jsonb('sections').$type<Record<string, SectionEdit>>().notNull().default({}),
    version: integer('version').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.kind] })],
);

// 每次保存一节记一条修订：改前、改后、修订说明。save_id 由页面每次保存生成，
// 同一次保存重试（结果不确定时）不会记两条；第 14 项新旧稿对照用这些记录
export const draftRevisions = pgTable(
  'draft_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saveId: uuid('save_id').notNull().unique(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    sectionId: text('section_id').notNull(),
    sectionTitle: text('section_title').notNull(),
    note: text('note').notNull(),
    before: jsonb('before').$type<EditBlock[]>().notNull(),
    after: jsonb('after').$type<EditBlock[]>().notNull(),
    // 这次修改采用了「帮我改写这段」的 AI 文字时，记下提示词版本；没用 AI 为 null
    aiPromptVersion: text('ai_prompt_version'),
    // 保存后这一节的 rev 和整份的 version
    rev: integer('rev').notNull(),
    version: integer('version').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('draft_revisions_draft').on(t.batchId, t.kind, t.createdAt)],
);

// Word 校对（M2 第 12 项，14 页 E18-05）：专家核对完一份记一行，记下核对时这份的 version（draft_edits.version，
// 没改过为 0）。之后这份再保存修订，version 变了，这条核对就失效，要重新核对
export const draftChecks = pgTable(
  'draft_checks',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    version: integer('version').notNull(),
    checkedBy: uuid('checked_by')
      .notNull()
      .references(() => users.id),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.kind] })],
);

// 当前稿的 PDF（校对页逐页显示）：改过正文后按新的 version 重新转一次，只留最近一份。
// 没改过的直接用生成时转好的 PDF（generated_drafts.pdf_file_id）
export const draftPreviews = pgTable(
  'draft_previews',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    version: integer('version').notNull(),
    // converting = 正在转；done = 转好了（file_id）；failed = 转换失败（error）
    status: text('status').$type<'converting' | 'done' | 'failed'>().notNull(),
    fileId: uuid('file_id').references(() => files.id),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.kind] })],
);

// 审核结论（14 页 E18-06）：三份都核对完后专家确认审核通过，记下当时三份的 version。
// 之后任何一份再保存修订，结论就失效（要重新核对那一份、重新确认结论）
export const draftReviews = pgTable('draft_reviews', {
  batchId: uuid('batch_id')
    .primaryKey()
    .references(() => generationBatches.id, { onDelete: 'cascade' }),
  note: text('note').notNull(),
  versions: jsonb('versions').$type<Record<DraftKind, number>>().notNull(),
  reviewedBy: uuid('reviewed_by')
    .notNull()
    .references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
});

// 客户图纸转成的图片（M2 第 10c 项，附件 7 与图件页缩略图）：每份文件记一次页数，每页只转一次，
// 存高清图和缩略图。图片只放在文件存储里（路径同样是「组织 ID/随机 ID」），不登记成文件，
// 只经任务接口给负责专家看、生成时取用
export const drawingSources = pgTable('drawing_sources', {
  fileId: uuid('file_id')
    .primaryKey()
    .references(() => files.id, { onDelete: 'cascade' }),
  // 转不出来（文件损坏、加密）时为 null，原因记在 error
  pageCount: integer('page_count'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const drawingPages = pgTable(
  'drawing_pages',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    fullKey: text('full_key').notNull(),
    // png（PDF 线条图）或 jpg（照片）
    fullType: text('full_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    thumbKey: text('thumb_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.page] })],
);

// 合同登记（M3）：每次开通、续期各一行；组织表上的合同有效期取最新一行，其他地方的判断不用改。
// 合同原件只存文件 ID（kind = contract，仅运营可见）。系统不记金额，「合同款已到账」只记谁在何时确认
export const serviceScopeKind = pgEnum('service_scope_kind', ['single', 'annual']);
export const organizationContracts = pgTable('organization_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  scopeKind: serviceScopeKind('scope_kind').notNull(),
  // 年度服务包含几家企业；编制 1 家时为空
  scopeEnterprises: integer('scope_enterprises'),
  startsAt: date('starts_at', { mode: 'string' }).notNull(),
  endsAt: date('ends_at', { mode: 'string' }).notNull(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id),
  paymentConfirmedBy: uuid('payment_confirmed_by')
    .notNull()
    .references(() => users.id),
  paymentConfirmedAt: timestamp('payment_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 邀请（M3）：开通时邀请首位管理员；以后客户管理员邀请成员也用这张表。
// 链接里的令牌只存哈希；接受、撤销后链接失效
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: role('role').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('organization_invitations_org').on(t.orgId)],
);

// 成果发布（M2 第 15 项，15 页 R03–R04b）：负责注安师每点一次「发布」记一行，publish_id 由页面生成，
// 同一次发布重发（超时、断网后）只记一次。成功时把三份当前稿定稿存成文件（delivery_files），形成交付版本：
// 同一任务第一次是 V1，以后再发布是 V2、V3。失败的不占版本（重试时用同一个版本号）。
// 同一批草稿只能形成一个交付版本；同一任务同一时间只有一次发布在进行
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publishId: uuid('publish_id').notNull().unique(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => generationBatches.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // publishing = 正在发布；done = 已形成交付版本；failed = 没有形成交付（error 写原因）
    status: text('status').$type<PublishStatus>().notNull(),
    error: text('error'),
    // 发布时的审核结论和三份修订次数（draft_edits.version），交付版本对应的就是这一份
    reviewedBy: uuid('reviewed_by')
      .notNull()
      .references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    versions: jsonb('versions').$type<Record<DraftKind, number>>().notNull(),
    publishedBy: uuid('published_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('deliveries_task_version').on(t.taskId, t.version).where(sql`${t.status} = 'done'`),
    uniqueIndex('deliveries_one_publishing').on(t.taskId).where(sql`${t.status} = 'publishing'`),
    uniqueIndex('deliveries_batch_once').on(t.batchId).where(sql`${t.status} <> 'failed'`),
  ],
);

// 交付版本里的三份 Word（定稿文件，kind = delivery）
export const deliveryFiles = pgTable(
  'delivery_files',
  {
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    kind: draftKind('kind').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.kind] })],
);

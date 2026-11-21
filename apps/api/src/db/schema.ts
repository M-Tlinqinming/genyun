import {
  CALL_TIMES,
  CHARGE_STATUSES,
  CREDIT_ENTRY_TYPES,
  CREDIT_POOLS,
  DRAFT_KIND_KEYS,
  EXPERT_AVATARS,
  EXPERT_REVIEW_STATUSES,
  INTAKE_FILE_SLOTS,
  INTAKE_UPLOADER_SIDES,
  DRAFT_STATUSES,
  ITEM_STATUSES,
  ON_SITE_STATUSES,
  type AgencyCategory,
  type AuditAction,
  type HolidayKind,
  type IntakeParseResult,
  type IntakeRequiredCheck,
  type IntakeSubmissionSnapshot,
  type IntakeWarning,
  type CallTime,
  type ChecklistItemKey,
  type ChecklistState,
  type ContactQuestion,
  type ContactTarget,
  type DraftKind,
  type EditBlock,
  type EnterpriseProfile,
  type ExpertCertificate,
  type FeedbackCategory,
  type FeedbackSource,
  type FeedbackStatus,
  type LockedMaterial,
  type PlanInput,
  type PublishStatus,
  type SectionEdit,
  type SubmittedAnswer,
  type SubmittedDocument,
  type SupplementFact,
  type SupplementStatus,
  type TemplateContent,
  type TemplateStep,
  type WorkupData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { sql } from 'drizzle-orm';
import type { SlotNote } from '../generation/ai/slots.ts';
import {
  boolean,
  check,
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
  // 所在地区按省、市、区县三级登记（K16）；region 照旧存全称给还在读文字的地方用。区县可以为空，老数据三列都空
  regionProvince: text('region_province'),
  regionCity: text('region_city'),
  regionDistrict: text('region_district'),
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
  // 运营停用账号的时间（M3 第 8 项）：停用后不能登录、已有会话全部退出、不出现在分派名单；为空 = 正常
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  // 为什么停用（M3 第 7 项）：operator = 运营在内部账号里停用；removed_by_customer = 被机构管理员移出组织、不在任何组织里。
  // 客户再次邀请只能恢复 removed_by_customer 的账号；运营停用的必须由运营恢复
  disabledReason: text('disabled_reason').$type<'operator' | 'removed_by_customer'>(),
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
    // 机构管理员最近一次调整这家企业负责成员的时间（11 页 C08「企业分配」最近调整）；没调整过为空
    membersChangedAt: timestamp('members_changed_at', { withTimezone: true }),
  },
  // 同一组织里不能有两家统一社会信用代码相同的企业；没填代码的不限制
  (t) => [
    uniqueIndex('enterprises_org_credit_code_unique')
      .on(t.orgId, t.socialCreditCode)
      .where(sql`${t.socialCreditCode} is not null`),
  ],
);

// 企业分配（M3 第 7 项，11 页 C08）：机构管理员把企业分给成员。成员（customer_member）只能看到、处理分配给自己的企业；
// 机构管理员始终看到全部企业，分给管理员只表示「负责成员」。移除成员或企业时一并删除
export const enterpriseAssignments = pgTable(
  'enterprise_assignments',
  {
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 冗余存所属组织：移除成员时按组织删
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.enterpriseId, t.userId] }), index('enterprise_assignments_user').on(t.userId)],
);

export const businessType = pgEnum('business_type', ['emergency_plan']);
export const taskStatus = pgEnum('task_status', ['preparing', 'submitted']);
export const startMethod = pgEnum('start_method', ['self_fill', 'upload']);
// 扣次状态：未扣、已扣、等次数（首次交付时次数不够，成果先锁住，续约或加购后按任务先后放开）
export const chargeStatus = pgEnum('charge_status', CHARGE_STATUSES);

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
    // 现在这位负责专家接手的时间；改派后「客户请电话联系」的期限从这里重新算
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // 交付完成或关闭的时间；为空表示任务还没结束。
    // 交付后「重新打开」不清空它：重新打开的任务仍算已结束（不挡同一企业新建任务），
    // 只要 reopened_at 晚于最近一次成功交付，就是「重新打开 · 待交付」
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // 最近一次交付后重新打开的时间（15 页 R12）；再次交付后不清空，比最近交付时间早就说明已经再交付过
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    // 等客户补资料：专家复制缺项清单时写入（13 页 E1、16 页 I04），客服去联系客户；
    // 专家替客户传了资料后清空。awaiting_customer_items 是清单里列了几项（「缺 3 项」）
    awaitingCustomerSince: timestamp('awaiting_customer_since', { withTimezone: true }),
    awaitingCustomerItems: integer('awaiting_customer_items'),
    // 扣次状态，见次数台账（credit_entries）；只有首次交付扣 1 次
    chargeStatus: chargeStatus('charge_status').notNull().default('not_charged'),
    // 删除任务（只能在提交前删）：只做标记，三端都不再显示；记录保留
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  // 同一家企业同一种业务只能有一个没结束、没删除的任务
  (t) => [
    uniqueIndex('tasks_one_open_per_enterprise')
      .on(t.enterpriseId, t.businessType)
      .where(sql`${t.closedAt} is null and ${t.deletedAt} is null`),
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

// ---------- 新流程「准备资料」（12 页 U1–U3b，DEV-PLAN K3–K6） ----------

// 上传位置：资料表格、总平面布置图、紧急疏散示意图、其他图纸与照片
export const intakeFileSlot = pgEnum('intake_file_slot', INTAKE_FILE_SLOTS);
// 谁传的：客户自己，或专家替客户传
export const intakeUploaderSide = pgEnum('intake_uploader_side', INTAKE_UPLOADER_SIDES);

// 准备资料：每个任务一行。有这一行就说明任务走新流程（下载模板 → 上传资料表格 → 提交给专家），
// 新建任务时创建（K4）；旧任务没有这一行，按旧流程只读显示。
// 存的是当前这份资料表格读出来的结果、必填核查结果和上传后的提示，每次重新上传表格都整体覆盖
export const taskIntakes = pgTable('task_intakes', {
  taskId: uuid('task_id')
    .primaryKey()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  // 当前这份资料表格；还没上传为空。它和下面的 parse_result、required_check 是一组，
  // 表示「当前这份资料表格和它的读取结果」。task_intake_files 是上传记录（也存总平面图、疏散图、其他图纸照片）；
  // 上传时两处在同一事务里写，读当前表格以这里为准
  dataSheetFileId: uuid('data_sheet_file_id').references(() => files.id),
  // 表格里读到的模板版本（「填写说明」B2），读不到为空
  templateVersion: text('template_version'),
  // 读表结果：企业身份 + 档案，与专家整理快照同形；可带每项读自哪个格子
  parseResult: jsonb('parse_result').$type<IntakeParseResult>(),
  // 必填核查：缺哪几项（工作表、行、格子、字段、给客户看的原话）
  requiredCheck: jsonb('required_check').$type<IntakeRequiredCheck>(),
  // 上传后的提示：不是耕云模板、像是同组织另一家企业的表、旧版模板、企业名称已按表格改好
  warnings: jsonb('warnings').$type<IntakeWarning[]>().notNull().default([]),
  // 客户说明「紧急疏散示意图这张图我们没有」；客户可以撤销
  noEvacuationMap: boolean('no_evacuation_map').notNull().default(false),
  // 客户选的专家；为空 = 由耕云安排。撤回再提交保留原来选的专家
  preferredExpertId: uuid('preferred_expert_id').references(() => users.id),
  // 最近一次是谁传的资料：客户自己，还是专家替客户传
  lastUploadedSide: intakeUploaderSide('last_uploaded_side'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

// 资料文件记录：每传一次记一行，文件本身在 files 表（kind = customer_material）。
// 移除、换掉时只写 removed_at，不删行；同一任务同一时间只有一份当前的资料表格
export const taskIntakeFiles = pgTable(
  'task_intake_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    slot: intakeFileSlot('slot').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    // 专家替客户传的（客服拿到客户的资料后由专家代传）
    uploadedByExpert: boolean('uploaded_by_expert').notNull().default(false),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('task_intake_files_task').on(t.taskId),
    uniqueIndex('task_intake_files_one_data_sheet')
      .on(t.taskId)
      .where(sql`${t.slot} = 'data_sheet' and ${t.removedAt} is null`),
  ],
);

// 提交与撤回（12 页 U2c、U3、U3b、S01）：每提交一次记一行，requestId 由页面生成，重发只记一次。
// 不动旧流程的 task_submissions。
// 撤回规则（K6 实现）：
// - 只能在专家点开任务开始核对（task_workups.snapshot_at 写入）之前撤回，而且只能撤回一次；
// - 撤回后任务回到「准备资料」，清空 tasks.submitted_at；已分配的专家和已传的资料都保留；
// - 撤回后再提交，这次提交就不能再撤回了。
// 所以一个任务最多一条「没撤回」的提交、最多一条「已撤回」的提交
export const taskIntakeSubmissions = pgTable(
  'task_intake_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull().unique(),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnBy: uuid('withdrawn_by').references(() => users.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // 这次交给专家的文件清单和读表结果
    snapshot: jsonb('snapshot').$type<IntakeSubmissionSnapshot>().notNull(),
  },
  (t) => [
    uniqueIndex('task_intake_submissions_one_active').on(t.taskId).where(sql`${t.withdrawnAt} is null`),
    uniqueIndex('task_intake_submissions_one_withdrawn').on(t.taskId).where(sql`${t.withdrawnAt} is not null`),
  ],
);

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

// 运营在任务上的记录（16 页 I04 超时兜底）：内部备注、提醒专家、改派、已致电客户安抚。只在运营端显示，客户、专家都看不到
export const operatorNoteKind = pgEnum('operator_note_kind', ['note', 'remind_expert', 'reassign', 'called_customer']);
export const taskOperatorNotes = pgTable(
  'task_operator_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: operatorNoteKind('kind').notNull(),
    // 备注正文；提醒专家、致电客户时是附带的话（可空）；改派时是「周工 → 吴工 · 理由」
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
    // 同一件事只提醒一次（例如合同到期提醒按「组织 + 到期日」）；为空的不去重
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    index('notifications_user').on(t.userId, t.createdAt),
    uniqueIndex('notifications_user_dedupe').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
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

// customer_material = 客户上传的资料，本组织与相关人员可见；contract = 已签合同原件，仅运营可见（M3）；
// draft = 系统生成的草稿（Word、PDF），只有负责专家和运营看得到，发布前客户看不到；
// delivery = 发布时定下的三份交付 Word（M2 第 15 项），本组织客户、负责专家和运营能看；
// expert_certificate = 专家的资质证书照片，只给耕云审核看
export const fileKind = pgEnum('file_kind', ['customer_material', 'contract', 'draft', 'delivery', 'expert_certificate']);

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
    // 转出来的 PDF 有几页（核对时转 PDF 就数一次）；数不出来、以前转的为空
    pages: integer('pages'),
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
// 合同原件只存文件 ID（kind = contract，仅运营可见）。系统不记金额，「合同款已到账」只记谁在何时确认。
// 新的开通、续约弹窗（16 页）不再选服务范围，合同原件改为选填，所以这两列可以为空；
// 合同买了几次、送了几次记在次数台账（credit_entries）里
export const serviceScopeKind = pgEnum('service_scope_kind', ['single', 'annual']);
export const organizationContracts = pgTable('organization_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  scopeKind: serviceScopeKind('scope_kind'),
  // 年度服务包含几家企业；编制 1 家时为空
  scopeEnterprises: integer('scope_enterprises'),
  startsAt: date('starts_at', { mode: 'string' }).notNull(),
  endsAt: date('ends_at', { mode: 'string' }).notNull(),
  fileId: uuid('file_id').references(() => files.id),
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
  (t) => [
    index('organization_invitations_org').on(t.orgId),
    // 同一组织同一邮箱只能有一封未接受、未作废的邀请：并发重发时只有一次能成功（M3 第 8 项）
    uniqueIndex('organization_invitations_open_email')
      .on(t.orgId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

// 操作日志（M4 第 5 项，等保要求）：登录成功和失败、退出、改密码、找回重设、分派改派、发布。
// 只插入，不修改、不删除。操作人删号后保留记录（actor_id 置空，actor_email 留下当时的邮箱）
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    ip: text('ip'),
    action: text('action').$type<AuditAction>().notNull(),
    target: text('target'),
  },
  (t) => [index('audit_logs_at').on(t.at), index('audit_logs_action_at').on(t.action, t.at)],
);

// 成果发布（M2 第 15 项，15 页 R03–R04b）：负责专家每点一次「发布」记一行，publish_id 由页面生成，
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
    // 再次交付时专家填的「这次更新了什么」（选填，最多 40 字，接口里校验）；交付邮件里带这一行
    updateNote: text('update_note'),
  },
  // 同一批草稿原来用唯一索引限定只能交付一次；交付后可以重新打开、用同一批草稿再次交付，
  // 改由发布时在事务里检查：同一批已有没失败的交付、且之后任务没重新打开过，就拒绝
  (t) => [
    uniqueIndex('deliveries_task_version').on(t.taskId, t.version).where(sql`${t.status} = 'done'`),
    uniqueIndex('deliveries_one_publishing').on(t.taskId).where(sql`${t.status} = 'publishing'`),
    index('deliveries_batch').on(t.batchId),
    check('deliveries_update_note_length', sql`char_length(${t.updateNote}) <= 40`),
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

// 交付后重新打开的记录（15 页 R12）：一次交付只能重新打开一次（delivery_id 唯一），两个窗口同时点只有一个成功。
// 重新打开后任务回到核对定稿，核对和审核结论作废；再次交付后形成新的交付版本
export const taskReopens = pgTable(
  'task_reopens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id')
      .notNull()
      .unique()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_reopens_task').on(t.taskId)],
);

// ---------- 编制次数（11 页 C01·S02、16 页 I02 / I03，DEV-PLAN K14 / K16） ----------

export const creditEntryType = pgEnum('credit_entry_type', CREDIT_ENTRY_TYPES);
export const creditPool = pgEnum('credit_pool', CREDIT_POOLS);

// 次数台账：每次加、减各记一行，只插入不修改。delta 加为正、减为负。
// 合同购买、赠送在开通和续约时登记；加购、赠送、补偿由运营「调整次数」登记（可加可减，原因必填）；
// 交付扣减在专家首次交付时自动记 -1，重新打开后再次交付、撤回都不再记。
// 剩余次数（K14 实现）= 交付当天有效的合同下各行之和；扣的时候先扣赠送的，再扣购买的，
// pool 记这一次扣的是哪一池。次数不够时不记扣减，任务的扣次状态改为「等次数」
export const creditEntries = pgTable(
  'credit_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: creditEntryType('type').notNull(),
    delta: integer('delta').notNull(),
    // 赠送时的活动名称（「开通赠送」「老客户续约活动」）
    campaign: text('campaign'),
    // 每一行都挂在合同上：赠送、加购、补偿跟这份合同一起到期；交付扣减记交付当天有效的那份合同
    contractId: uuid('contract_id')
      .notNull()
      .references(() => organizationContracts.id),
    // 交付扣减：哪个任务、哪一次交付
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    // 记进哪一池：赠送、补偿 → 赠送池；合同购买、加购 → 购买池；交付扣减按实际扣的那一池（先赠送后购买）。
    // 类型和池的对应写在共享代码 CREDIT_ENTRY_POOL 里，数据库不按类型约束
    pool: creditPool('pool').notNull(),
    reason: text('reason'),
    // 登记人；交付扣减是交付的专家
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_entries_org').on(t.orgId, t.createdAt),
    // 一个任务最多扣一次
    uniqueIndex('credit_entries_one_deduction_per_task')
      .on(t.taskId)
      .where(sql`${t.type} = 'delivery_deduction'`),
    // 不记 0 次；交付扣减每次就是 -1
    check('credit_entries_delta_nonzero', sql`${t.delta} <> 0`),
    check('credit_entries_deduction_one', sql`${t.type} <> 'delivery_deduction' or ${t.delta} = -1`),
  ],
);

// ---------- 专家资料（13 页 E3「我的资料」，客户在 12 页 S09 / S10 选专家时看到卡片） ----------

export const expertAvatar = pgEnum('expert_avatar', EXPERT_AVATARS);
export const expertReviewStatus = pgEnum('expert_review_status', EXPERT_REVIEW_STATUSES);

// 每位专家一行。还没有这一行的专家按「接单中」算（老专家不用先填资料）。
// 没有资料行的专家点「暂停接单」时建一行，只写 accepting_orders，其他字段留空。
// 审核状态为空 = 耕云内部建的专家账号、没走入驻审核：按可派算，客户选不到。
// 头像从 8 个系统头像里选，不上传照片。改资质证书要重新审核，其他改动保存后直接生效
export const expertProfiles = pgTable('expert_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  avatar: expertAvatar('avatar'),
  // 客户看到的称呼，如「周工」「李老师」；只为暂停接单建的行留空
  displayName: text('display_name'),
  yearsOfExperience: integer('years_of_experience'),
  // 擅长行业，和企业行业共用一套分类（行业代码）
  industries: jsonb('industries').$type<string[]>().notNull().default([]),
  // 一句话介绍（最多 50 字）、简介（最多 500 字），长度在接口里校验
  intro: text('intro'),
  bio: text('bio'),
  // 只给耕云审核看：真实姓名和资质证书（名称、证书号、有效期、照片）
  realName: text('real_name'),
  certificates: jsonb('certificates').$type<ExpertCertificate[]>().notNull().default([]),
  // 最早到期的那本证书的有效期，到期自动下架用
  certificateExpiresOn: date('certificate_expires_on', { mode: 'string' }),
  // 入驻审核：自己注册的专家一注册就记待审核；为空 = 耕云内部建的账号，没走入驻审核
  reviewStatus: expertReviewStatus('review_status'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  // 接单中；暂停接单的专家不出现在客户可选列表里
  acceptingOrders: boolean('accepting_orders').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- 知识库（M3 第 5 项，16 页 I07 / I07B）：只有运营维护，改动只影响之后生成的文档 ----------

// 属地应急机构所在的区县：地址里出现 aliases 任一个词就算这个区县；plan 是区县级上级预案名称。
// 迁移 0025 把原来写死在 packages/shared/src/plan/agencies.ts 的惠州数据原样写进来，sort_order 保持原来的顺序（先认的区县在前）
export const agencyRegions = pgTable(
  'agency_regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    province: text('province').notNull(),
    city: text('city').notNull(),
    name: text('name').notNull(),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    plan: text('plan'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agency_regions_name').on(t.province, t.city, t.name)],
);

// 区县下的机构：应急管理局（emergency）、镇街应急办（street，area 是地址里认的镇街名）、消防救援大队（fire）。
// 停用的不再用于生成；同一区县同一类别的应急管理局、消防大队只用排在最前、没停用的一个
export const localAgencies = pgTable(
  'local_agencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => agencyRegions.id, { onDelete: 'cascade' }),
    category: text('category').$type<AgencyCategory>().notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    area: text('area'),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    plan: text('plan'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('local_agencies_region').on(t.regionId)],
);

// 节假日与调休：一天一行。数据库里一行都没有时工作日计算用内置的 2026 年表（packages/shared/src/workdays.ts）
export const holidays = pgTable('holidays', {
  date: date('date').primaryKey(),
  kind: text('kind').$type<HolidayKind>().notNull(),
  name: text('name').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 工艺模板：已发布的内容（label、keywords、steps）客户选用；draft 是还没发布的修改。
// version 是已发布的版本号（0 = 从未发布）；停用后客户看不到，已选用的企业不受影响
export const processTemplates = pgTable('process_templates', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  industry: text('industry'),
  keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
  steps: jsonb('steps').$type<TemplateStep[]>().notNull().default([]),
  draft: jsonb('draft').$type<TemplateContent>(),
  version: integer('version').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- 反馈受理（M3 第 6 项，16 页「反馈受理」）：客户对平台或成果的意见，独立于编制交付 ----------

// 客户提交的反馈。可关联任务和交付版本（从成果文档页提交时），附件是客户上传的文件 ID。
// 运营受理（processing）、写回复并关闭（closed）；不改任务状态、不触发重新生成、不改已交付版本。
// internal_note 只有运营看得到；reply 关闭时发给客户
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    deliveryVersion: integer('delivery_version'),
    source: text('source').$type<FeedbackSource>().notNull(),
    category: text('category').$type<FeedbackCategory>().notNull(),
    content: text('content').notNull(),
    fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
    status: text('status').$type<FeedbackStatus>().notNull().default('new'),
    reply: text('reply'),
    internalNote: text('internal_note'),
    // 受理的运营（第一次受理或转给专家时记下）
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    // 转给了哪位专家（站内提醒）
    forwardedTo: uuid('forwarded_to').references(() => users.id, { onDelete: 'set null' }),
    forwardedAt: timestamp('forwarded_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feedback_status_created').on(t.status, t.createdAt), index('feedback_org_created').on(t.orgId, t.createdAt)],
);

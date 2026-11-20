// 编制次数（K14；11 页 C01·S02、U4b、U4c，15 页第 3、4、5 封邮件，16 页「次数用完」「调整次数」「次数记录」）。
// 余额、扣哪一池这些算法是 packages/shared/src/credits.ts 的纯函数，这里只负责读写台账、锁、提醒和发信：
// - 首次交付扣 1 次（publish.service.ts 在交付的事务里调 chargeDelivery）；扣不到时成果先锁住（awaiting_credits）。
// - 加购、补次数、新合同生效后，按任务生成的先后放开锁住的成果（releaseLocked），每份算 1 次。
// - 次数快用完、用完时给组织管理员铃铛（checkReminders）；成果锁住、放开时发邮件。
// 扣次数和放开之前先锁组织那一行，两次交付同时到、只剩 1 次时只有一个扣得到。
import {
  CREDIT_ENTRY_POOL,
  CREDIT_ENTRY_TYPE_LABELS,
  CREDIT_ENTRY_TYPES,
  chinaToday,
  creditLockReason,
  creditSummary,
  formatAdminNames,
  giftCampaignTotals,
  isCreditContractActive,
  pickDeduction,
  contractPoolBalance,
  type CreditAdjust,
  type CreditContract,
  type CreditEntryType,
  type CreditLedgerRow,
  type CreditLockReason,
  type CreditPool,
  type OperatorOrgCredits,
  type OrgCredits,
  type OrgCreditsBrief,
} from '@genyun/shared';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  creditEntries,
  deliveries,
  enterprises,
  memberships,
  organizationContracts,
  organizations,
  taskIntakeSubmissions,
  tasks,
  taskSubmissions,
  users,
} from '../db/schema.ts';
import { appLink, MAILER, type Mailer, type MailMessage } from '../mail/mailer.ts';
import { creditsLockedAdminMail, creditsLockedSubmitterMail, deliveryReleasedMail } from '../mail/templates.ts';
import { enterpriseCustomerIds, NotificationsService, orgNoticePrefix } from '../notifications/notifications.service.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Q = Pick<Database, 'select' | 'insert' | 'update'>;

// 每小时扫一次有锁住成果的组织：接住「新合同到了开始日期才生效」
const RELEASE_SCAN_MS = 60 * 60 * 1000;

const SERVICE_LINK = '/customer/organization?tab=service';
const documentsLink = (taskId: string) => `/customer/documents/${taskId}`;

// 事务提交后才做的事（发信、检查提醒）；出错只记日志
export type AfterCommit = () => Promise<void>;

export interface ChargeTask {
  id: string;
  orgId: string;
  enterpriseId: string;
  enterpriseName: string;
}

interface Person {
  id: string;
  name: string;
  email: string;
}

// 本组织在职、没停用的组织管理员，最早建号的在前（成员关系表没有加入时间，按账号创建时间）
export async function orgAdmins(db: Pick<Database, 'select'>, orgId: string): Promise<Person[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'customer_admin'), isNull(users.disabledAt)))
    .orderBy(asc(users.createdAt), asc(users.name));
}

// 管理员名字（锁住提示、第 4 封邮件用）：用「、」连起来，没有时写「组织管理员」
export async function orgAdminNames(db: Pick<Database, 'select'>, orgId: string): Promise<string> {
  return formatAdminNames((await orgAdmins(db, orgId)).map((a) => a.name));
}

interface Ledger {
  contracts: (CreditContract & { number: string })[];
  entries: CreditLedgerRow[];
}

async function loadLedgers(db: Pick<Database, 'select'>, orgIds: string[]): Promise<Map<string, Ledger>> {
  const map = new Map<string, Ledger>(orgIds.map((id) => [id, { contracts: [], entries: [] }]));
  if (orgIds.length === 0) return map;
  const contracts = await db
    .select({
      id: organizationContracts.id,
      orgId: organizationContracts.orgId,
      number: organizationContracts.number,
      startsAt: organizationContracts.startsAt,
      endsAt: organizationContracts.endsAt,
    })
    .from(organizationContracts)
    .where(inArray(organizationContracts.orgId, orgIds));
  for (const c of contracts) map.get(c.orgId)?.contracts.push(c);
  const entries = await db
    .select({
      orgId: creditEntries.orgId,
      contractId: creditEntries.contractId,
      type: creditEntries.type,
      pool: creditEntries.pool,
      delta: creditEntries.delta,
      campaign: creditEntries.campaign,
    })
    .from(creditEntries)
    .where(inArray(creditEntries.orgId, orgIds));
  for (const e of entries) map.get(e.orgId)?.entries.push(e);
  return map;
}

export async function loadLedger(db: Pick<Database, 'select'>, orgId: string): Promise<Ledger> {
  return (await loadLedgers(db, [orgId])).get(orgId)!;
}

// 锁住时客户看到的原因：按查看时的情况算（当天没有有效合同是 expired，否则是 credits）
export async function lockReasonOf(db: Pick<Database, 'select'>, orgId: string): Promise<CreditLockReason> {
  return creditLockReason((await loadLedger(db, orgId)).contracts);
}

// 成果锁住时页面上要显示的：原因和管理员名字
export async function lockInfo(db: Pick<Database, 'select'>, orgId: string): Promise<{ reason: CreditLockReason; adminNames: string }> {
  return { reason: await lockReasonOf(db, orgId), adminNames: await orgAdminNames(db, orgId) };
}

/**
 * 下载锁：任务等次数时，客户角色（组织管理员、成员）一律 403；专家、运营不受影响。
 * 交付文件单份下载（/files/:id/download-url）和整套下载都调这里
 */
export async function assertDeliveryDownloadable(
  db: Pick<Database, 'select'>,
  user: SessionUser,
  task: { orgId: string; chargeStatus: string | null },
): Promise<void> {
  if (task.chargeStatus !== 'awaiting_credits') return;
  const role = user.memberships.find((m) => m.orgId === task.orgId)?.role;
  if (role === 'customer_admin') {
    throw new ForbiddenException(
      (await lockReasonOf(db, task.orgId)) === 'expired' ? '年度服务已到期，续约后就能下载' : '编制次数已经用完，续约后就能下载',
    );
  }
  if (role === 'customer_member') throw new ForbiddenException('需要组织管理员处理后才能下载');
}

// 几个组织的汇总加「等次数」的成果份数（运营列表、概览用）
export async function creditBriefs(db: Pick<Database, 'select'>, orgIds: string[]): Promise<Map<string, OrgCreditsBrief>> {
  const ledgers = await loadLedgers(db, orgIds);
  const waiting = orgIds.length
    ? await db
        .select({ orgId: tasks.orgId })
        .from(tasks)
        .where(and(inArray(tasks.orgId, orgIds), eq(tasks.chargeStatus, 'awaiting_credits'), isNull(tasks.deletedAt)))
    : [];
  const today = chinaToday();
  const out = new Map<string, OrgCreditsBrief>();
  for (const id of orgIds) {
    const l = ledgers.get(id)!;
    out.set(id, { ...creditSummary(l.contracts, l.entries, today), awaiting: waiting.filter((w) => w.orgId === id).length });
  }
  return out;
}

async function lockOrg(tx: Pick<Database, 'select'>, orgId: string) {
  await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).for('update');
}

// 能看到这家企业的客户账号，分成组织管理员和其余的人
async function enterpriseRecipients(q: Pick<Database, 'select'>, task: { orgId: string; enterpriseId: string }) {
  const ids = await enterpriseCustomerIds(q, task);
  if (ids.length === 0) return { admins: [] as string[], members: [] as string[] };
  const adminRows = await q
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, task.orgId), eq(memberships.role, 'customer_admin'), inArray(memberships.userId, ids)));
  const admins = new Set(adminRows.map((r) => r.userId));
  return { admins: ids.filter((id) => admins.has(id)), members: ids.filter((id) => !admins.has(id)) };
}

@Injectable()
export class CreditsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditsService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), RELEASE_SCAN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // 每小时：有锁住成果的组织各跑一次放开（新合同到了开始日才生效时靠它放开）
  async scan(): Promise<number> {
    try {
      const rows = await this.db
        .selectDistinct({ orgId: tasks.orgId })
        .from(tasks)
        .where(and(eq(tasks.chargeStatus, 'awaiting_credits'), isNull(tasks.deletedAt)));
      let released = 0;
      for (const r of rows) released += await this.releaseLocked(r.orgId, 'renewal');
      return released;
    } catch (err) {
      this.logger.warn(`扫描锁住的成果失败：${errorText(err)}`);
      return 0;
    }
  }

  async run(after: AfterCommit[]): Promise<void> {
    for (const fn of after) {
      try {
        await fn();
      } catch (err) {
        this.logger.warn(`次数的后续动作失败：${errorText(err)}`);
      }
    }
  }

  /**
   * 首次交付扣 1 次，在交付的事务里调。扣到了：任务记为已扣；扣不到：任务记为等次数，成果先锁住，
   * 并在同一个事务里写锁住铃铛。返回是否扣到，以及事务提交后要做的事（扣到了检查提醒；锁住了发第 3、4 封）。
   */
  async chargeDelivery(
    tx: Tx,
    task: ChargeTask,
    delivery: { id: string; publishedBy: string },
  ): Promise<{ charged: boolean; after: AfterCommit[] }> {
    await lockOrg(tx, task.orgId);
    const ledger = await loadLedger(tx, task.orgId);
    const pick = pickDeduction(ledger.contracts, ledger.entries);
    if (pick.ok) {
      await tx.insert(creditEntries).values({
        orgId: task.orgId,
        type: 'delivery_deduction',
        delta: -1,
        contractId: pick.contractId,
        pool: pick.pool,
        taskId: task.id,
        deliveryId: delivery.id,
        createdBy: delivery.publishedBy,
      });
      await tx.update(tasks).set({ chargeStatus: 'charged' }).where(eq(tasks.id, task.id));
      return { charged: true, after: [() => this.checkReminders(task.orgId)] };
    }
    await tx.update(tasks).set({ chargeStatus: 'awaiting_credits' }).where(eq(tasks.id, task.id));
    await this.lockedBells(tx, task, pick.reason);
    return { charged: false, after: [() => this.sendLockedMails(task.id, pick.reason)] };
  }

  /**
   * 放开锁住的成果（续约、加购、补次数以后）：按任务生成的先后逐个扣，扣不到就停。
   * trigger = renewal（续约生效、每小时扫描）或 credits（运营调整次数）。返回放开了几份。
   * K16 登记续约以后调 releaseLocked(orgId, 'renewal')。
   */
  async releaseLocked(orgId: string, trigger: 'credits' | 'renewal'): Promise<number> {
    const released: string[] = [];
    const releasedAt = new Date();
    await this.db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const waiting = await tx
        .select({ id: tasks.id, orgId: tasks.orgId, enterpriseId: tasks.enterpriseId, enterpriseName: enterprises.name })
        .from(tasks)
        .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
        .where(and(eq(tasks.orgId, orgId), eq(tasks.chargeStatus, 'awaiting_credits'), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.createdAt), asc(tasks.number));
      if (waiting.length === 0) return;
      const ledger = await loadLedger(tx, orgId);
      for (const task of waiting) {
        const pick = pickDeduction(ledger.contracts, ledger.entries);
        if (!pick.ok) break;
        const [first] = await tx
          .select({ id: deliveries.id, publishedBy: deliveries.publishedBy })
          .from(deliveries)
          .where(and(eq(deliveries.taskId, task.id), eq(deliveries.status, 'done')))
          .orderBy(asc(deliveries.version))
          .limit(1);
        if (!first) continue;
        await tx.insert(creditEntries).values({
          orgId,
          type: 'delivery_deduction',
          delta: -1,
          contractId: pick.contractId,
          pool: pick.pool,
          taskId: task.id,
          deliveryId: first.id,
          createdBy: first.publishedBy,
        });
        ledger.entries.push({ contractId: pick.contractId, type: 'delivery_deduction', pool: pick.pool, delta: -1 });
        await tx.update(tasks).set({ chargeStatus: 'charged', updatedAt: releasedAt }).where(eq(tasks.id, task.id));
        await this.releasedBells(tx, task, trigger);
        released.push(task.id);
      }
    });
    await this.run([
      ...released.map((taskId) => () => this.sendReleasedMail(taskId, releasedAt)),
      () => this.checkReminders(orgId),
    ]);
    return released.length;
  }

  /**
   * 次数提醒（组织管理员的铃铛）：剩 1–3 次时降到 3、2、1 各一次；用完一次。
   * 去重键带上有效期至和共几次，加次数或续约以后重新算。没有有效合同时不提（到期另有提醒）。
   */
  async checkReminders(orgId: string): Promise<void> {
    const ledger = await loadLedger(this.db, orgId);
    const s = creditSummary(ledger.contracts, ledger.entries);
    if (s.validUntil === null) return;
    const n = s.remaining.total;
    if (n > 3 || n < 0) return;
    const admins = (await orgAdmins(this.db, orgId)).map((a) => a.id);
    const prefix = orgNoticePrefix(orgId);
    if (n === 0) {
      await this.notifications.notifyOnce(admins, {
        title: '编制次数已经用完',
        body: '新任务照常新建和提交，新编制好的成果要等续约后才能下载。请联系耕云续约。',
        link: SERVICE_LINK,
        dedupeKey: `${prefix}credits-out:${s.validUntil}:${s.granted}`,
      });
      return;
    }
    await this.notifications.notifyOnce(admins, {
      title: `编制次数还剩 ${n} 次`,
      body: '用完后新成果要等续约才能下载。可以提前联系耕云。',
      link: SERVICE_LINK,
      dedupeKey: `${prefix}credits-low:${s.validUntil}:${s.granted}:${n}`,
    });
  }

  // 运营调整次数（16 页「调整次数」）：挂在当天有效、到期最晚的合同上；没有有效合同挂最早一份还没开始的
  async adjust(orgId: string, input: CreditAdjust, operatorId: string): Promise<{ contractNumber: string }> {
    return this.db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const ledger = await loadLedger(tx, orgId);
      const today = chinaToday();
      const active = ledger.contracts.filter((c) => isCreditContractActive(c, today)).sort((a, b) => b.endsAt.localeCompare(a.endsAt));
      const upcoming = ledger.contracts.filter((c) => c.startsAt > today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const target = active[0] ?? upcoming[0];
      if (!target) throw new ConflictException('这个组织没有有效合同，请先登记续约');
      const pool: CreditPool = CREDIT_ENTRY_POOL[input.type];
      if (input.delta < 0) {
        const left = contractPoolBalance(ledger.entries, target.id, pool);
        if (left + input.delta < 0) {
          const name = pool === 'gift' ? '赠送' : '购买';
          throw new ConflictException(
            left > 0 ? `这份合同的${name}次数只剩 ${left} 次，最多减 ${left} 次` : `这份合同的${name}次数已经是 0 次，不能再减`,
          );
        }
      }
      await tx.insert(creditEntries).values({
        orgId,
        type: input.type,
        delta: input.delta,
        campaign: input.type === 'gift' ? input.campaign : null,
        contractId: target.id,
        pool,
        reason: input.reason,
        createdBy: operatorId,
      });
      return { contractNumber: target.number };
    });
  }

  // 组织管理员看自己组织的次数：汇总加等次数的成果（任务编号、企业名称），按任务生成先后
  async orgView(orgId: string): Promise<OrgCredits> {
    const ledger = await loadLedger(this.db, orgId);
    const awaitingTasks = await this.db
      .select({ taskId: tasks.id, taskNumber: tasks.number, enterpriseName: enterprises.name })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .where(and(eq(tasks.orgId, orgId), eq(tasks.chargeStatus, 'awaiting_credits'), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.createdAt), asc(tasks.number));
    return { ...creditSummary(ledger.contracts, ledger.entries), awaitingTasks };
  }

  // 运营看一个组织的次数（16 页「次数记录」）
  async operatorView(orgId: string): Promise<OperatorOrgCredits> {
    const brief = (await creditBriefs(this.db, [orgId])).get(orgId)!;
    const rows = await this.db
      .select({
        id: creditEntries.id,
        type: creditEntries.type,
        delta: creditEntries.delta,
        pool: creditEntries.pool,
        campaign: creditEntries.campaign,
        reason: creditEntries.reason,
        taskNumber: tasks.number,
        enterpriseName: enterprises.name,
        contractNumber: organizationContracts.number,
        createdByName: users.name,
        createdAt: creditEntries.createdAt,
      })
      .from(creditEntries)
      .innerJoin(organizationContracts, eq(organizationContracts.id, creditEntries.contractId))
      .leftJoin(tasks, eq(tasks.id, creditEntries.taskId))
      .leftJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .leftJoin(users, eq(users.id, creditEntries.createdBy))
      .where(eq(creditEntries.orgId, orgId))
      .orderBy(desc(creditEntries.createdAt), desc(creditEntries.id));
    const typeCounts = Object.fromEntries(CREDIT_ENTRY_TYPES.map((t) => [t, 0])) as Record<CreditEntryType, number>;
    for (const r of rows) typeCounts[r.type] += 1;
    return {
      ...brief,
      entries: rows.map((r) => ({
        ...r,
        typeLabel: CREDIT_ENTRY_TYPE_LABELS[r.type],
        taskNumber: r.type === 'delivery_deduction' ? r.taskNumber : null,
        enterpriseName: r.type === 'delivery_deduction' ? r.enterpriseName : null,
        createdAt: r.createdAt.toISOString(),
      })),
      typeCounts,
      giftCampaigns: giftCampaignTotals(rows),
    };
  }

  // ---------- 铃铛 ----------

  private async lockedBells(tx: Tx, task: ChargeTask, reason: CreditLockReason) {
    const { admins, members } = await enterpriseRecipients(tx, task);
    const link = documentsLink(task.id);
    await this.notifications.notifyOnce(
      admins,
      {
        taskId: task.id,
        title: `${task.enterpriseName}的成果已编制好，等续约后下载`,
        body:
          reason === 'expired'
            ? '贵组织的年度服务已到期。续约后自动放开，算 1 次。'
            : '贵组织的编制次数已经用完。续约后自动放开，算 1 次。',
        link,
        dedupeKey: `${orgNoticePrefix(task.orgId)}credits-locked:${task.id}`,
      },
      tx,
    );
    if (members.length > 0) {
      await this.notifications.notify(
        members,
        {
          taskId: task.id,
          title: `${task.enterpriseName}的成果已编制好，暂时还不能下载`,
          body: `需要贵组织管理员处理，请联系${await orgAdminNames(tx, task.orgId)}。`,
          link,
        },
        tx,
      );
    }
  }

  private async releasedBells(tx: Tx, task: ChargeTask, trigger: 'credits' | 'renewal') {
    const { admins, members } = await enterpriseRecipients(tx, task);
    const title = `${task.enterpriseName}的成果可以下载了`;
    const link = documentsLink(task.id);
    await this.notifications.notifyOnce(
      admins,
      {
        taskId: task.id,
        title,
        body: trigger === 'renewal' ? '续约已生效，这份成果已放开，算 1 次。' : '次数已到账，这份成果已放开，算 1 次。',
        link,
        dedupeKey: `${orgNoticePrefix(task.orgId)}credits-released:${task.id}`,
      },
      tx,
    );
    await this.notifications.notify(members, { taskId: task.id, title, body: '三份文档已放开，点开就能下载。', link }, tx);
  }

  // ---------- 邮件（事务提交后发；失败只记日志） ----------

  private async mailTask(taskId: string) {
    const [task] = await this.db
      .select({
        id: tasks.id,
        orgId: tasks.orgId,
        name: tasks.name,
        number: tasks.number,
        createdBy: tasks.createdBy,
        enterpriseName: enterprises.name,
      })
      .from(tasks)
      .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
      .where(eq(tasks.id, taskId));
    if (!task) return null;
    const [first] = await this.db
      .select({ at: deliveries.publishedAt })
      .from(deliveries)
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'done')))
      .orderBy(asc(deliveries.version))
      .limit(1);
    return {
      ...task,
      base: {
        enterpriseName: task.enterpriseName,
        taskName: task.name,
        taskNumber: task.number,
        link: appLink(documentsLink(task.id)),
        deliveredAt: first?.at ?? new Date(),
      },
    };
  }

  /**
   * 这个任务的提交人：最新一条没撤回的资料提交 → 旧的提交生成申请 → 建任务的人。
   * 已经不在本组织（被移除、停用）就不算。
   */
  private async submitter(task: { id: string; orgId: string; createdBy: string }): Promise<Person | null> {
    const [intake] = await this.db
      .select({ by: taskIntakeSubmissions.submittedBy })
      .from(taskIntakeSubmissions)
      .where(and(eq(taskIntakeSubmissions.taskId, task.id), isNull(taskIntakeSubmissions.withdrawnAt)))
      .orderBy(desc(taskIntakeSubmissions.submittedAt))
      .limit(1);
    const [old] = intake
      ? []
      : await this.db.select({ by: taskSubmissions.submittedBy }).from(taskSubmissions).where(eq(taskSubmissions.taskId, task.id)).limit(1);
    const userId = intake?.by ?? old?.by ?? task.createdBy;
    const [person] = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(
        and(
          eq(users.id, userId),
          isNull(users.disabledAt),
          eq(memberships.orgId, task.orgId),
          inArray(memberships.role, ['customer_admin', 'customer_member']),
        ),
      )
      .limit(1);
    return person ?? null;
  }

  // 第 3 封给全部在职管理员；第 4 封给提交人（他本身是管理员时只收第 3 封）
  async sendLockedMails(taskId: string, reason: CreditLockReason): Promise<void> {
    const task = await this.mailTask(taskId);
    if (!task) return;
    const admins = await orgAdmins(this.db, task.orgId);
    const mails: MailMessage[] = admins.map((a) => creditsLockedAdminMail({ ...task.base, to: a.email, name: a.name, reason }));
    const who = await this.submitter(task);
    if (who && !admins.some((a) => a.id === who.id)) {
      mails.push(
        creditsLockedSubmitterMail({ ...task.base, to: who.email, name: who.name, adminNames: formatAdminNames(admins.map((a) => a.name)) }),
      );
    }
    await this.sendAll(mails);
  }

  // 第 5 封：提交人和组织管理员，同一个人只发一封
  async sendReleasedMail(taskId: string, releasedAt: Date): Promise<void> {
    const task = await this.mailTask(taskId);
    if (!task) return;
    const people = await orgAdmins(this.db, task.orgId);
    const who = await this.submitter(task);
    if (who && !people.some((p) => p.id === who.id)) people.unshift(who);
    await this.sendAll(people.map((p) => deliveryReleasedMail({ ...task.base, to: p.email, name: p.name, releasedAt })));
  }

  private async sendAll(mails: MailMessage[]) {
    for (const m of mails) {
      try {
        await this.mailer.send(m);
      } catch (err) {
        this.logger.warn(`发信失败（${m.kind}）：${errorText(err)}`);
      }
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

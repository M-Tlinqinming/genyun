import {
  chinaToday,
  feedbackTitle,
  contractState,
  INTERNAL_ROLE_LABELS,
  invitationState,
  ROLES,
  activitySentence,
  activityTaskNumber,
  renewalRow,
  sortRenewalRows,
  type ActorIdentity,
  type AuditAction,
  type OperatorOverview,
  type OverviewTodo,
} from '@genyun/shared';
import { Controller, ForbiddenException, Get, Inject } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNull, min, notInArray, or, sql } from 'drizzle-orm';
import { canViewOperatorOverview } from '../auth/access.ts';
import { creditBriefs } from '../credits/credits.service.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  auditLogs,
  deliveries,
  enterprises,
  feedback,
  memberships,
  organizationInvitations,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';
import { withOperatorTaskState } from '../tasks/operator-tasks.controller.ts';

// 「最近操作」只放业务动作；登录、退出、改密码在操作日志页里看
const ACCOUNT_ACTIONS: AuditAction[] = ['login_success', 'login_failure', 'logout', 'password_change', 'password_reset'];
const DAY_MS = 86_400_000;
// 邀请过期超过 14 天就不再放进「今天先处理」（还在客户组织详情、内部账号里能看到）
const EXPIRED_TODO_DAYS = 14;

// 运营概览（Paper 16 页 I01）：四个统计、今天先处理、续约与次数、最近操作。全部按真实数据算，
// 复用客户组织（待开通）、邀请、任务中心（任务状态和分组）、成果交付、操作日志。
// 只有运营；客户、专家一律 403。侧栏「客户组织」「任务中心」的角标也用这里的数
@Controller('operator/overview')
export class OperatorOverviewController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async get(@CurrentUser() user: SessionUser): Promise<OperatorOverview> {
    if (!canViewOperatorOverview(user)) throw new ForbiddenException('只有耕云运营可以查看运营概览');
    const now = new Date();
    const today = chinaToday(now);

    const [orgRows, taskRows, invitations, delivered, recent, feedbackRows] = await Promise.all([
      this.db
        .select({
          id: organizations.id,
          name: organizations.name,
          createdAt: organizations.createdAt,
          activatedAt: organizations.activatedAt,
          contractStartsAt: organizations.contractStartsAt,
          contractEndsAt: organizations.contractEndsAt,
          // 子查询里写全表名（见 operator-orgs.controller.ts 的说明）
          registeredByName: sql<string | null>`(select u.name from users u where u.id = "organizations"."registered_by")`,
        })
        .from(organizations)
        .where(eq(organizations.kind, 'customer')),
      // 在办任务按任务中心的分组算（taskView 运营那一侧），数字和任务中心的统计格对得上
      this.db
        .select({ id: tasks.id, status: tasks.status, assignedExpertId: tasks.assignedExpertId, closedAt: tasks.closedAt })
        .from(tasks)
        .innerJoin(organizations, eq(organizations.id, tasks.orgId))
        .where(and(eq(organizations.kind, 'customer'), isNull(tasks.deletedAt)))
        .then((rows) => withOperatorTaskState(this.db, rows, now)),
      this.db
        .select({
          id: organizationInvitations.id,
          orgId: organizationInvitations.orgId,
          orgName: organizations.name,
          orgKind: organizations.kind,
          role: organizationInvitations.role,
          email: organizationInvitations.email,
          name: organizationInvitations.name,
          createdAt: organizationInvitations.createdAt,
          expiresAt: organizationInvitations.expiresAt,
          acceptedAt: organizationInvitations.acceptedAt,
          revokedAt: organizationInvitations.revokedAt,
          invitedBy: organizationInvitations.invitedBy,
        })
        .from(organizationInvitations)
        .innerJoin(organizations, eq(organizations.id, organizationInvitations.orgId))
        .where(
          and(
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
            gt(organizationInvitations.expiresAt, new Date(now.getTime() - EXPIRED_TODO_DAYS * DAY_MS)),
            // 耕云运营发出的（开通首位管理员、内部成员）和客户管理员发出的（邀请组织成员）都看
            or(
              inArray(
                organizationInvitations.invitedBy,
                this.db
                  .select({ id: memberships.userId })
                  .from(memberships)
                  .innerJoin(organizations, eq(organizations.id, memberships.orgId))
                  .where(and(eq(memberships.role, 'operator'), eq(organizations.kind, 'internal'))),
              ),
              inArray(
                organizationInvitations.invitedBy,
                this.db.select({ id: memberships.userId }).from(memberships).where(eq(memberships.role, 'customer_admin')),
              ),
            ),
          ),
        )
        .orderBy(desc(organizationInvitations.createdAt)),
      // 本月（北京时间）交付成功的：同一任务本月交付、更新了两次只算一次
      this.db
        .selectDistinct({ taskId: deliveries.taskId })
        .from(deliveries)
        .where(and(eq(deliveries.status, 'done'), gte(deliveries.publishedAt, new Date(`${today.slice(0, 7)}-01T00:00:00+08:00`)))),
      this.db
        .select({
          id: auditLogs.id,
          at: auditLogs.at,
          action: auditLogs.action,
          target: auditLogs.target,
          actorId: users.id,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(notInArray(auditLogs.action, ACCOUNT_ACTIONS))
        .orderBy(desc(auditLogs.at), desc(auditLogs.id))
        .limit(5),
      // 反馈受理：待受理、处理中（已关闭的不算）
      this.db
        .select({
          id: feedback.id,
          status: feedback.status,
          content: feedback.content,
          createdAt: feedback.createdAt,
          deliveryVersion: feedback.deliveryVersion,
          orgName: organizations.name,
          enterpriseName: enterprises.name,
          taskNumber: tasks.number,
        })
        .from(feedback)
        .innerJoin(organizations, eq(organizations.id, feedback.orgId))
        .leftJoin(enterprises, eq(enterprises.id, feedback.enterpriseId))
        .leftJoin(tasks, eq(tasks.id, feedback.taskId))
        .where(inArray(feedback.status, ['new', 'processing'])),
    ]);

    const orgs = orgRows.map((o) => {
      const contract = contractState(o, today);
      const state = !o.activatedAt ? 'pending' : contract.state === 'expired' ? 'expired' : 'active';
      return { ...o, state } as const;
    });
    const openTasks = taskRows.filter((t) => t.group !== 'delivered');

    // 发邀请的人、最近操作的人在哪个组织、什么角色：分出运营发的邀请，和最近操作里的身份
    const actorIds = [...new Set([...invitations.map((i) => i.invitedBy), ...recent.map((r) => r.actorId)])].filter(
      (x): x is string => !!x,
    );
    const roles = actorIds.length
      ? await this.db
          .select({ userId: memberships.userId, role: memberships.role, kind: organizations.kind })
          .from(memberships)
          .innerJoin(organizations, eq(organizations.id, memberships.orgId))
          .where(inArray(memberships.userId, actorIds))
      : [];
    const hasInternalRole = (userId: string | null, role: 'operator' | 'expert') =>
      roles.some((r) => r.userId === userId && r.kind === 'internal' && r.role === role);
    const identityOf = (userId: string | null): ActorIdentity => {
      if (!userId) return 'deleted';
      if (hasInternalRole(userId, 'operator')) return 'operator';
      if (hasInternalRole(userId, 'expert')) return 'expert';
      return 'customer';
    };

    // 编制次数：开通了的组织才算
    const credits = await creditBriefs(
      this.db,
      orgs.filter((o) => o.activatedAt).map((o) => o.id),
    );
    // 有锁住成果的组织：最早一份锁住成果的交付时间（这份成果首次交付的时间）
    const lockedOrgs = [...credits].filter(([, c]) => c.awaiting > 0).map(([id]) => id);
    const lockedSince = lockedOrgs.length
      ? await this.db
          .select({ orgId: tasks.orgId, at: min(deliveries.publishedAt) })
          .from(tasks)
          .innerJoin(deliveries, and(eq(deliveries.taskId, tasks.id), eq(deliveries.status, 'done')))
          .where(and(inArray(tasks.orgId, lockedOrgs), eq(tasks.chargeStatus, 'awaiting_credits'), isNull(tasks.deletedAt)))
          .groupBy(tasks.orgId)
      : [];
    const todos: OverviewTodo[] = [];

    for (const o of orgs.filter((x) => x.state === 'pending')) {
      todos.push({
        kind: 'org_pending',
        id: o.id,
        title: o.name,
        subtitle: o.registeredByName ? `客户组织 · ${o.registeredByName}登记` : '客户组织',
        note: '核对合同后开通，系统自动邀请管理员',
        since: o.createdAt.toISOString(),
        action: '开通与邀请',
        link: `/operator/organizations?open=${o.id}`,
      });
    }
    // 邀请未接受（运营发出的、客户管理员发出的都看，过期 14 天内）：同一组织同一邮箱只看最新一封；
    // 当天刚发的不算待办（对方可能还没看邮件）
    const seen = new Set<string>();
    for (const inv of invitations) {
      const key = `${inv.orgId}/${inv.email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const state = invitationState(inv, now);
      if (state !== 'valid' && state !== 'expired') continue;
      if (state === 'valid' && now.getTime() - inv.createdAt.getTime() < DAY_MS) continue;
      const internal = inv.orgKind === 'internal';
      const role = internal && (inv.role === 'expert' || inv.role === 'operator') ? INTERNAL_ROLE_LABELS[inv.role] : ROLES[inv.role].label;
      const byCustomer = !internal && !hasInternalRole(inv.invitedBy, 'operator');
      const note = byCustomer
        ? state === 'expired'
          ? '由客户管理员发出，已过期，可提醒客户管理员重发'
          : '由客户管理员发出，可提醒对方或协助重发'
        : state === 'expired'
          ? '邀请已过期，请重新发送'
          : '邀请已发出，对方还没有设置密码加入';
      todos.push({
        kind: 'invitation',
        id: inv.id,
        title: inv.email,
        subtitle: `${internal ? '耕云内部' : inv.orgName} · ${role}`,
        note,
        since: inv.createdAt.toISOString(),
        action: internal ? '查看内部账号' : '查看组织',
        link: internal ? '/operator/accounts' : `/operator/organizations/${inv.orgId}`,
      });
    }
    // 待受理反馈（处理中的不放进今天先处理，在反馈受理页里跟进）
    for (const f of feedbackRows.filter((x) => x.status === 'new')) {
      const subtitle = f.taskNumber ? `${f.taskNumber}${f.deliveryVersion ? ' · 已交付' : ''}` : f.orgName;
      todos.push({
        kind: 'feedback',
        id: f.id,
        title: f.enterpriseName ?? f.orgName,
        subtitle,
        note: `“${feedbackTitle(f.content)}”${f.deliveryVersion ? '，不影响已交付成果' : ''}`,
        since: f.createdAt.toISOString(),
        action: '受理反馈',
        link: `/operator/feedback?id=${f.id}`,
      });
    }
    // 次数用完（画板没画，运营要用）：有锁住成果的客户组织，每家一条
    for (const o of orgs) {
      const c = credits.get(o.id);
      if (!c || c.awaiting === 0) continue;
      const at = lockedSince.find((x) => x.orgId === o.id)?.at;
      todos.push({
        kind: 'credits_out',
        id: o.id,
        title: o.name,
        subtitle: `客户组织 · 剩余 ${c.remaining.total} 次`,
        note: `有 ${c.awaiting} 份成果已编制好，等次数到账后放开；客户加购或续约后在这里登记`,
        since: (at ? new Date(at) : now).toISOString(),
        action: '调整次数',
        link: `/operator/organizations/${o.id}?adjust=1`,
      });
    }
    // 等得最久的在前
    todos.sort((a, b) => a.since.localeCompare(b.since));

    // 续约与次数：标黄的在前；已到期超过 30 天的不放（在客户组织列表里看）
    const renewals = sortRenewalRows(
      orgs.map((o) =>
        renewalRow(
          {
            id: o.id,
            name: o.name,
            state: o.state,
            contractStartsAt: o.contractStartsAt,
            contractEndsAt: o.contractEndsAt,
            createdAt: o.createdAt,
          },
          credits.get(o.id) ?? null,
          today,
        ),
      ),
    );

    // 最近操作的一句话：任务类的用企业名（按对象里的任务编号查）
    const numbers = [...new Set(recent.map((r) => activityTaskNumber(r.action, r.target)))].filter((x): x is string => !!x);
    const enterpriseRows = numbers.length
      ? await this.db
          .select({ number: tasks.number, name: enterprises.name })
          .from(tasks)
          .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
          .where(inArray(tasks.number, numbers))
      : [];
    const enterpriseOf = new Map(enterpriseRows.map((t) => [t.number, t.name]));

    return {
      orgs: {
        total: orgs.length,
        active: orgs.filter((o) => o.state === 'active').length,
        pending: orgs.filter((o) => o.state === 'pending').length,
        expired: orgs.filter((o) => o.state === 'expired').length,
      },
      tasks: {
        open: openTasks.length,
        toAssign: openTasks.filter((t) => t.group === 'to_assign').length,
        awaiting: openTasks.filter((t) => t.group === 'awaiting').length,
      },
      deliveries: { thisMonth: delivered.length },
      feedback: {
        new: feedbackRows.filter((f) => f.status === 'new').length,
        processing: feedbackRows.filter((f) => f.status === 'processing').length,
      },
      todos,
      renewals,
      recent: recent.map((r) => {
        const number = activityTaskNumber(r.action, r.target);
        return {
          id: r.id,
          at: r.at.toISOString(),
          action: r.action,
          target: r.target,
          actorName: r.actorName,
          actorIdentity: identityOf(r.actorId),
          sentence: activitySentence(r.action, r.target, { enterpriseName: number ? enterpriseOf.get(number) : null }),
        };
      }),
    };
  }
}

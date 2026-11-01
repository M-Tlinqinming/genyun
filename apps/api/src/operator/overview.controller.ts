import {
  chinaToday,
  contractState,
  INTERNAL_ROLE_LABELS,
  invitationState,
  needsAssignment,
  ROLES,
  type AuditAction,
  type OperatorOverview,
  type OverviewService,
  type OverviewTodo,
} from '@genyun/shared';
import { Controller, ForbiddenException, Get, Inject } from '@nestjs/common';
import { and, desc, eq, gte, isNull, notInArray, sql } from 'drizzle-orm';
import { canViewOperatorOverview } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  auditLogs,
  deliveries,
  enterprises,
  onSiteRequests,
  organizationInvitations,
  organizations,
  tasks,
  users,
} from '../db/schema.ts';
import { listOverdueTasks } from '../tasks/operator-tasks.controller.ts';

// 「最近操作」只放业务动作；登录、退出、改密码在操作日志页里看
const ACCOUNT_ACTIONS: AuditAction[] = ['login_success', 'login_failure', 'logout', 'password_change', 'password_reset'];
const DAY_MS = 86_400_000;

// 运营概览（Paper 16 页 I01）：四个统计、今天先处理、客户年度服务、最近操作。全部按真实数据算，
// 复用客户组织（待开通）、邀请、任务中心（待分派、超时兜底、上门工单）、成果发布、操作日志。
// 只有运营；客户、注安师一律 403。侧栏「客户组织」「任务中心」的角标也用这里的数
@Controller('operator/overview')
export class OperatorOverviewController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async get(@CurrentUser() user: SessionUser): Promise<OperatorOverview> {
    if (!canViewOperatorOverview(user)) throw new ForbiddenException('只有耕云运营可以查看运营概览');
    const now = new Date();
    const today = chinaToday(now);

    const [orgRows, taskRows, overdue, orders, invitations, delivered, recent] = await Promise.all([
      this.db
        .select({
          id: organizations.id,
          name: organizations.name,
          createdAt: organizations.createdAt,
          activatedAt: organizations.activatedAt,
          contractStartsAt: organizations.contractStartsAt,
          contractEndsAt: organizations.contractEndsAt,
          registeredByName: sql<string | null>`(select u.name from users u where u.id = "organizations"."registered_by")`,
          // 子查询里写全表名（见 operator-orgs.controller.ts 的说明）
          enterprises: sql<number>`(select count(*)::int from enterprises e where e.org_id = "organizations"."id")`,
        })
        .from(organizations)
        .where(eq(organizations.kind, 'customer')),
      this.db
        .select({
          id: tasks.id,
          number: tasks.number,
          status: tasks.status,
          assignedExpertId: tasks.assignedExpertId,
          closedAt: tasks.closedAt,
          submittedAt: tasks.submittedAt,
          enterpriseName: enterprises.name,
          orgName: organizations.name,
        })
        .from(tasks)
        .innerJoin(enterprises, eq(enterprises.id, tasks.enterpriseId))
        .innerJoin(organizations, eq(organizations.id, tasks.orgId))
        .where(and(eq(organizations.kind, 'customer'), isNull(tasks.closedAt))),
      listOverdueTasks(this.db, now),
      this.db
        .select({
          id: onSiteRequests.id,
          createdAt: onSiteRequests.createdAt,
          helpItems: onSiteRequests.helpItems,
          enterpriseName: enterprises.name,
          orgName: organizations.name,
        })
        .from(onSiteRequests)
        .innerJoin(enterprises, eq(enterprises.id, onSiteRequests.enterpriseId))
        .innerJoin(organizations, eq(organizations.id, onSiteRequests.orgId))
        .where(eq(onSiteRequests.status, 'new')),
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
        })
        .from(organizationInvitations)
        .innerJoin(organizations, eq(organizations.id, organizationInvitations.orgId))
        .where(and(isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt)))
        .orderBy(desc(organizationInvitations.createdAt)),
      // 本月（北京时间）发布成功的交付：同一任务本月发了 V1、V2 只算一次
      this.db
        .selectDistinct({ taskId: deliveries.taskId })
        .from(deliveries)
        .where(and(eq(deliveries.status, 'done'), gte(deliveries.publishedAt, new Date(`${today.slice(0, 7)}-01T00:00:00+08:00`)))),
      this.db
        .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, target: auditLogs.target, actorName: users.name })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(notInArray(auditLogs.action, ACCOUNT_ACTIONS))
        .orderBy(desc(auditLogs.at), desc(auditLogs.id))
        .limit(5),
    ]);

    const orgs = orgRows.map((o) => {
      const contract = contractState(o, today);
      const state = !o.activatedAt ? 'pending' : contract.state === 'expired' ? 'expired' : 'active';
      return { ...o, state, daysLeft: contract.daysLeft } as const;
    });
    const unassigned = taskRows.filter(needsAssignment);
    const todos: OverviewTodo[] = [];

    for (const o of orgs.filter((x) => x.state === 'pending')) {
      todos.push({
        kind: 'org_pending',
        id: o.id,
        title: o.name,
        subtitle: o.registeredByName ? `客户组织 · ${o.registeredByName}登记` : '客户组织',
        note: '核对合同与年度服务后，开通并邀请首位管理员',
        since: o.createdAt.toISOString(),
        action: '开通与邀请',
        link: `/operator/organizations?open=${o.id}`,
      });
    }
    // 邀请未接受：同一组织同一邮箱只看最新一封；当天刚发的不算待办（对方可能还没看邮件）
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
      todos.push({
        kind: 'invitation',
        id: inv.id,
        title: inv.email,
        subtitle: `${internal ? '耕云内部' : inv.orgName} · ${role}`,
        note: state === 'expired' ? '邀请已过期，请重新发送' : '邀请已发出，对方还没有设置密码加入',
        since: inv.createdAt.toISOString(),
        action: internal ? '查看内部账号' : '查看组织',
        link: internal ? '/operator/accounts' : `/operator/organizations/${inv.orgId}`,
      });
    }
    for (const t of unassigned) {
      todos.push({
        kind: 'unassigned',
        id: t.id,
        title: t.enterpriseName,
        subtitle: `${t.number} · ${t.orgName}`,
        note: '资料已提交，还没有负责注安师',
        since: (t.submittedAt ?? now).toISOString(),
        action: '分派注安师',
        link: `/operator/tasks?task=${t.id}`,
      });
    }
    for (const t of overdue) {
      todos.push({
        kind: 'overdue',
        id: t.id,
        title: t.enterpriseName,
        subtitle: `${t.number} · 负责注安师 ${t.assignedExpertName ?? '—'}`,
        note: `客户请注安师电话联系，已等 ${t.waitedDays} 个工作日；${t.reason}`,
        since: t.request.requestedAt.toISOString(),
        action: '处理超时',
        link: `/operator/tasks?tab=overdue&task=${t.id}`,
      });
    }
    for (const o of orders) {
      todos.push({
        kind: 'on_site',
        id: o.id,
        title: o.enterpriseName,
        subtitle: `上门工单 · ${o.orgName}`,
        note: o.helpItems.length > 0 ? `客户需要帮忙整理 ${o.helpItems.length} 项资料，请联系客户安排` : '客户预约上门，请联系客户安排',
        since: o.createdAt.toISOString(),
        action: '处理工单',
        link: `/operator/tasks?tab=onsite&order=${o.id}`,
      });
    }
    // 等得最久的在前
    todos.sort((a, b) => a.since.localeCompare(b.since));

    // 客户年度服务：服务中的按到期日先后，待开通的排在后面；已到期的不放（在客户组织列表里看）
    const services: OverviewService[] = orgs
      .filter((o) => o.state !== 'expired')
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'active' ? -1 : 1;
        return (a.contractEndsAt ?? '9999').localeCompare(b.contractEndsAt ?? '9999');
      })
      .slice(0, 5)
      .map((o) => ({
        orgId: o.id,
        name: o.name,
        startsAt: o.contractStartsAt,
        endsAt: o.contractEndsAt,
        enterprises: o.enterprises,
        state: o.state as 'pending' | 'active',
        daysLeft: o.state === 'active' && o.daysLeft !== null ? Math.round(o.daysLeft) : null,
      }));

    return {
      orgs: {
        total: orgs.length,
        active: orgs.filter((o) => o.state === 'active').length,
        pending: orgs.filter((o) => o.state === 'pending').length,
        expired: orgs.filter((o) => o.state === 'expired').length,
      },
      tasks: {
        open: taskRows.length,
        preparing: taskRows.filter((t) => t.status === 'preparing').length,
        unassigned: unassigned.length,
        drafting: taskRows.filter((t) => t.status === 'submitted' && t.assignedExpertId).length,
      },
      deliveries: { thisMonth: delivered.length },
      followUps: { overdue: overdue.length, onSiteNew: orders.length },
      todos,
      services,
      recent: recent.map((r) => ({ ...r, at: r.at.toISOString() })),
    };
  }
}

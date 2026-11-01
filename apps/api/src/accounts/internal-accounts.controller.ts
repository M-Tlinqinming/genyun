import {
  INTERNAL_ROLE_LABELS,
  INTERNAL_ROLES,
  internalInviteSchema,
  internalRoleSchema,
  invitationState,
  type InternalAccount,
  type InternalAccountsView,
  type InternalInvitation,
  type InternalRole,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canManageInternalAccounts } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { auditLogs, memberships, organizationInvitations, organizations, sessions, tasks, users } from '../db/schema.ts';
import { MAILER, type Mailer } from '../mail/mailer.ts';
import { createInvitation, EMAIL_HAS_ACCOUNT } from '../orgs/invitations.ts';

const NOT_FOUND = '找不到这个内部账号';
const LAST_OPERATOR = '这是最后一位能登录的运营管理员，停用或改成注安师后就没人能管理客户组织和内部账号了。请先邀请或恢复另一位运营管理员';
const RESENT_JUST_NOW = '这封邀请刚刚已经重新发送过了，请刷新页面查看最新的一封';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Outcome = { busy: number } | 'last_operator' | 'unchanged' | 'ok';

const isInternalRole = (r: string): r is InternalRole => (INTERNAL_ROLES as readonly string[]).includes(r);

// 内部账号与权限（Paper 16 页 I06）：耕云员工（运营管理员、注安师）的账号列表、邮件邀请、停用 / 恢复、改角色。
// 只有运营；客户、注安师一律 403。不能停用自己、不能改自己的角色（免得把自己锁在外面）。
// 停用：不能登录、已有会话全部退出、不出现在分派名单（operator-tasks.controller.ts 的 assignableExpert）
@Controller('operator/accounts')
export class InternalAccountsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<InternalAccountsView> {
    this.guard(user);
    const orgId = await this.internalOrg(user);
    const people = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, disabledAt: users.disabledAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(users.createdAt);
    const ids = people.map((p) => p.id);
    const [logins, open] = ids.length
      ? await Promise.all([
          this.db
            .select({ id: auditLogs.actorId, at: max(auditLogs.at) })
            .from(auditLogs)
            .where(and(eq(auditLogs.action, 'login_success'), inArray(auditLogs.actorId, ids)))
            .groupBy(auditLogs.actorId),
          this.db
            .select({ id: tasks.assignedExpertId, n: count() })
            .from(tasks)
            .where(and(inArray(tasks.assignedExpertId, ids), isNull(tasks.closedAt)))
            .groupBy(tasks.assignedExpertId),
        ])
      : [[], []];
    const accounts: InternalAccount[] = people
      .filter((p) => isInternalRole(p.role))
      .map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role as InternalRole,
        disabledAt: p.disabledAt?.toISOString() ?? null,
        lastLoginAt: logins.find((l) => l.id === p.id)?.at?.toISOString() ?? null,
        openTasks: open.find((o) => o.id === p.id)?.n ?? 0,
        self: p.id === user.id,
      }));
    return { accounts, invitations: await this.pendingInvitations(orgId) };
  }

  // 邀请内部成员：发邀请邮件（7 天有效），对方设好密码后以所选角色进入耕云内部工作台。
  // 同一邮箱还有没接受的邀请时，旧链接作废，以这一封为准
  @Post('invitations')
  @HttpCode(200)
  async invite(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: Request) {
    this.guard(user);
    const parsed = internalInviteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查填写的内容');
    const { name, email, role } = parsed.data;
    const orgId = await this.internalOrg(user);
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException({ statusCode: 409, message: EMAIL_HAS_ACCOUNT, field: 'email' });
    const result = await this.send(user, orgId, { name, email, role }, false);
    await this.audit.record({
      action: 'account_invite',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${name}（${email}）· ${INTERNAL_ROLE_LABELS[role]}`,
    });
    return result;
  }

  // 重新发送：旧链接作废，按原来的姓名、邮箱、角色再发一封
  @Post('invitations/:id/resend')
  @HttpCode(200)
  async resend(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    const orgId = await this.internalOrg(user);
    const [inv] = await this.db
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.id, id), eq(organizationInvitations.orgId, orgId)))
      .limit(1);
    if (!inv || !isInternalRole(inv.role)) throw new NotFoundException('找不到这封邀请');
    const state = invitationState(inv);
    if (state === 'accepted') throw new ConflictException('对方已经接受邀请，不用再发');
    if (state === 'revoked') throw new ConflictException('这封邀请已作废，请刷新页面查看最新的一封');
    // 对方可能已经通过别的途径有了耕云账号，再发一封也接受不了
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1);
    if (existing) throw new ConflictException(EMAIL_HAS_ACCOUNT);
    const result = await this.send(user, orgId, { name: inv.name, email: inv.email, role: inv.role }, true);
    await this.audit.record({
      action: 'account_invite',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${inv.name}（${inv.email}）· ${INTERNAL_ROLE_LABELS[inv.role]} · 重新发送`,
    });
    return result;
  }

  // 停用：注安师手上还有没结束的任务时不能停用，先在任务中心改派（不然客户的任务没人管）
  @Post(':id/disable')
  @HttpCode(200)
  async disable(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    if (id === user.id) throw new ConflictException('不能停用自己的账号');
    const orgId = await this.internalOrg(user);
    const target = await this.load(orgId, id);
    if (target.disabledAt) throw new ConflictException(`${target.name}的账号已经停用了`);
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      // 锁住账号这一行，和分派排队：停用时不会有新任务刚好分到这个人
      await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');
      if (target.role === 'operator' && !(await this.operatorRemains(tx, orgId, id))) return 'last_operator';
      const [busy] = await tx
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.assignedExpertId, id), isNull(tasks.closedAt)));
      if ((busy?.n ?? 0) > 0) return { busy: busy!.n };
      const [changed] = await tx
        .update(users)
        .set({ disabledAt: new Date(), disabledReason: 'operator' })
        .where(and(eq(users.id, id), isNull(users.disabledAt)))
        .returning({ id: users.id });
      if (!changed) return 'unchanged';
      // 已登录的地方全部退出
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return 'ok';
    });
    if (outcome === 'last_operator') throw new ConflictException(LAST_OPERATOR);
    if (outcome === 'unchanged') throw new ConflictException(`${target.name}的账号已经停用了`);
    if (typeof outcome === 'object') {
      throw new ConflictException(`${target.name}还有 ${outcome.busy} 个在办任务，请先在任务中心改派给其他注安师，再停用`);
    }
    await this.audit.record({
      action: 'account_disable',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${target.name}（${target.email}）· ${INTERNAL_ROLE_LABELS[target.role]}`,
    });
    return this.list(user);
  }

  // 恢复：可以重新登录（密码不变），注安师重新出现在分派名单
  @Post(':id/enable')
  @HttpCode(200)
  async enable(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    const orgId = await this.internalOrg(user);
    const target = await this.load(orgId, id);
    if (!target.disabledAt) throw new ConflictException(`${target.name}的账号没有停用`);
    const [changed] = await this.db
      .update(users)
      .set({ disabledAt: null, disabledReason: null })
      .where(and(eq(users.id, id), isNotNull(users.disabledAt)))
      .returning({ id: users.id });
    // 别人刚恢复过：不重复记日志
    if (!changed) throw new ConflictException(`${target.name}的账号没有停用`);
    await this.audit.record({
      action: 'account_enable',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${target.name}（${target.email}）· ${INTERNAL_ROLE_LABELS[target.role]}`,
    });
    return this.list(user);
  }

  // 改角色（注安师 ↔ 运营管理员）。注安师手上还有任务时不能改成运营，先改派
  @Put(':id/role')
  async changeRole(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    this.guard(user);
    if (id === user.id) throw new ConflictException('不能修改自己的角色');
    const parsed = internalRoleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择角色');
    const { role } = parsed.data;
    const orgId = await this.internalOrg(user);
    const target = await this.load(orgId, id);
    if (target.role === role) throw new ConflictException(`${target.name}已经是${INTERNAL_ROLE_LABELS[role]}`);
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');
      if (target.role === 'operator' && !(await this.operatorRemains(tx, orgId, id))) return 'last_operator';
      const [open] = await tx
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.assignedExpertId, id), isNull(tasks.closedAt)));
      if ((open?.n ?? 0) > 0) return { busy: open!.n };
      const [changed] = await tx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.userId, id), eq(memberships.orgId, orgId), eq(memberships.role, target.role)))
        .returning({ userId: memberships.userId });
      return changed ? 'ok' : 'unchanged';
    });
    if (outcome === 'last_operator') throw new ConflictException(LAST_OPERATOR);
    if (outcome === 'unchanged') throw new ConflictException(`${target.name}的角色刚刚被改过了，请刷新页面查看`);
    if (typeof outcome === 'object') {
      throw new ConflictException(`${target.name}还有 ${outcome.busy} 个在办任务，请先在任务中心改派给其他注安师，再改角色`);
    }
    await this.audit.record({
      action: 'account_role_change',
      actorId: user.id,
      actorEmail: user.email,
      ip: clientIp(req),
      target: `${target.name}（${target.email}）· ${INTERNAL_ROLE_LABELS[target.role]} → ${INTERNAL_ROLE_LABELS[role]}`,
    });
    return this.list(user);
  }

  private guard(user: SessionUser) {
    if (!canManageInternalAccounts(user)) throw new ForbiddenException('只有耕云运营可以管理内部账号');
  }

  // 运营所在的耕云内部组织
  private async internalOrg(user: SessionUser): Promise<string> {
    const [org] = await this.db
      .select({ id: organizations.id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'operator'), eq(organizations.kind, 'internal')))
      .limit(1);
    if (!org) throw new ForbiddenException('只有耕云运营可以管理内部账号');
    return org.id;
  }

  // 停用或降级一位运营之前：锁住内部组织所有运营的成员行和账号行（两位运营互相停用时排队），
  // 确认除了这位以外至少还有一位没停用的运营
  private async operatorRemains(tx: Tx, orgId: string, exceptId: string): Promise<boolean> {
    const ops = await tx
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'operator')))
      .orderBy(users.id)
      .for('update');
    return ops.some((o) => o.id !== exceptId && !o.disabledAt);
  }

  private async load(orgId: string, id: string) {
    const [row] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, disabledAt: users.disabledAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, id)))
      .limit(1);
    if (!row || !isInternalRole(row.role)) throw new NotFoundException(NOT_FOUND);
    return { ...row, role: row.role as InternalRole };
  }

  private async send(user: SessionUser, orgId: string, who: { name: string; email: string; role: InternalRole }, resend: boolean) {
    const [org] = await this.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const { mail, expiresAt } = await this.db.transaction(async (tx) => {
      // 同一邮箱没接受的旧邀请作废，只认最新一封
      await tx
        .update(organizationInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.orgId, orgId),
            eq(organizationInvitations.email, who.email),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        );
      return createInvitation(tx, {
        orgId,
        orgName: org!.name,
        role: who.role,
        email: who.email,
        name: who.name,
        phone: null,
        invitedBy: user.id,
        inviterName: user.name,
        resend,
      });
    }).catch((err: unknown) => {
      // 两位运营同时重发同一封：后到的一方撞「同一邮箱只有一封未接受的邀请」，提示刷新
      if (isUniqueViolation(err, 'organization_invitations_open_email')) throw new ConflictException(RESENT_JUST_NOW);
      throw err;
    });
    // 事务提交后再发信：邀请没记下来就不发
    await this.mailer.send(mail);
    return { email: who.email, expiresAt: expiresAt.toISOString(), simulated: Boolean(this.mailer.simulated) };
  }

  private async pendingInvitations(orgId: string): Promise<InternalInvitation[]> {
    const rows = await this.db
      .select({
        id: organizationInvitations.id,
        name: organizationInvitations.name,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        createdAt: organizationInvitations.createdAt,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        revokedAt: organizationInvitations.revokedAt,
        invitedByName: users.name,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.invitedBy))
      .where(
        and(
          eq(organizationInvitations.orgId, orgId),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      )
      .orderBy(desc(organizationInvitations.createdAt));
    const seen = new Set<string>();
    return rows.flatMap((r) => {
      if (seen.has(r.email) || !isInternalRole(r.role)) return [];
      seen.add(r.email);
      const state = invitationState(r);
      if (state !== 'valid' && state !== 'expired') return [];
      return [
        {
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role as InternalRole,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          invitedByName: r.invitedByName,
          state,
        },
      ];
    });
  }
}

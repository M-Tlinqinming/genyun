import {
  CUSTOMER_ROLE_LABELS,
  CUSTOMER_ROLES,
  chinaToday,
  contractState,
  enterpriseMembersSchema,
  invitationState,
  memberEnterprisesSchema,
  memberInviteSchema,
  memberRoleSchema,
  orgProfileSchema,
  type CustomerRole,
  type MemberInviteResult,
  type OrgManagementView,
  type OrgMemberInvitation,
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
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canManageOrgMembers, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  enterpriseAssignments,
  enterprises,
  memberships,
  organizationContracts,
  organizationInvitations,
  organizations,
  sessions,
  tasks,
  users,
} from '../db/schema.ts';
import { MAILER, type Mailer } from '../mail/mailer.ts';
import { createInvitation, EMAIL_HAS_ACCOUNT } from './invitations.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const NO_MEMBER = '找不到这位成员';
const LAST_ADMIN = '组织里至少要保留一位机构管理员。请先把另一位成员设为机构管理员';
const RESENT_JUST_NOW = '这封邀请刚刚已经重新发送过了，请刷新页面查看最新的一封';
const isCustomerRole = (r: string): r is CustomerRole => (CUSTOMER_ROLES as readonly string[]).includes(r);

// 客户组织管理（M3 第 7 项，Paper 11 页「组织管理」）：机构管理员管理成员（邀请、重新发送、撤销、移除、改角色）、
// 把企业分配给成员、维护组织联系人、查看年度服务。只有本组织机构管理员；成员、运营 403，别家组织 404。
// 不能移除自己、不能改自己的角色；组织里至少保留一位机构管理员（加锁判断，两位管理员互相降级时排队）。
// 成员只能看到分配给自己的企业（access.ts 的 enterpriseScope）；改动后下一次请求就生效
@Controller('orgs/:orgId/management')
export class OrgMembersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  async view(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<OrgManagementView> {
    this.guard(user, orgId);
    const [org] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        contactName: organizations.contactName,
        contactPhone: organizations.contactPhone,
        contactEmail: organizations.contactEmail,
        contractStartsAt: organizations.contractStartsAt,
        contractEndsAt: organizations.contractEndsAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) throw new NotFoundException('找不到该组织');

    const people = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, [...CUSTOMER_ROLES])))
      // 管理员在前，再按加入先后
      .orderBy(asc(memberships.role), asc(users.createdAt));
    const assigned = await this.db
      .select({ userId: enterpriseAssignments.userId, enterpriseId: enterpriseAssignments.enterpriseId })
      .from(enterpriseAssignments)
      .where(eq(enterpriseAssignments.orgId, orgId))
      .orderBy(asc(enterpriseAssignments.assignedAt));
    const ents = await this.db
      .select({ id: enterprises.id, name: enterprises.name, membersChangedAt: enterprises.membersChangedAt })
      .from(enterprises)
      .where(eq(enterprises.orgId, orgId))
      .orderBy(asc(enterprises.createdAt));

    const { state, daysLeft } = contractState(org, chinaToday());
    const [contract] = await this.db
      .select({ scopeKind: organizationContracts.scopeKind, scopeEnterprises: organizationContracts.scopeEnterprises })
      .from(organizationContracts)
      .where(eq(organizationContracts.orgId, orgId))
      .orderBy(desc(organizationContracts.createdAt))
      .limit(1);
    // 本服务期内建的任务：办理过几家企业、已交付几个、办理中几个
    const inPeriod = and(eq(tasks.orgId, orgId), org.contractStartsAt ? gte(tasks.createdAt, new Date(`${org.contractStartsAt}T00:00:00+08:00`)) : undefined);
    const [stats] = await this.db.select({ enterprises: countDistinct(tasks.enterpriseId), all: count() }).from(tasks).where(inPeriod);
    const [delivered] = await this.db.select({ n: count() }).from(tasks).where(and(inPeriod, isNotNull(tasks.closedAt)));

    return {
      org: { id: org.id, name: org.name, contactName: org.contactName, contactPhone: org.contactPhone, contactEmail: org.contactEmail },
      members: people.flatMap((p) =>
        isCustomerRole(p.role)
          ? [
              {
                id: p.id,
                name: p.name,
                email: p.email,
                role: p.role,
                self: p.id === user.id,
                enterpriseIds: assigned.filter((a) => a.userId === p.id).map((a) => a.enterpriseId),
              },
            ]
          : [],
      ),
      invitations: await this.pendingInvitations(orgId),
      enterprises: ents.map((e) => ({
        id: e.id,
        name: e.name,
        memberIds: assigned.filter((a) => a.enterpriseId === e.id).map((a) => a.userId),
        membersChangedAt: e.membersChangedAt?.toISOString() ?? null,
      })),
      service: {
        startsAt: org.contractStartsAt,
        endsAt: org.contractEndsAt,
        state,
        daysLeft,
        scopeKind: contract?.scopeKind ?? null,
        scopeEnterprises: contract?.scopeEnterprises ?? null,
        enterprises: stats?.enterprises ?? 0,
        delivered: delivered?.n ?? 0,
        inProgress: (stats?.all ?? 0) - (delivered?.n ?? 0),
      },
    };
  }

  // 组织资料：服务联系人、联系电话、联系邮箱（机构名称由耕云登记，不能改）
  @Put('profile')
  async updateProfile(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown, @Req() req: Request) {
    this.guard(user, orgId);
    const parsed = orgProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查填写的内容');
    await this.db.update(organizations).set(parsed.data).where(eq(organizations.id, orgId));
    await this.record(user, req, 'org_profile_update', `${this.orgName(user, orgId)} · 服务联系人 ${parsed.data.contactName}`);
    return this.view(user, orgId);
  }

  // 邀请成员或机构管理员：发邀请邮件（7 天有效），对方设好密码后加入本组织。
  // 同一邮箱还有没接受的邀请时，旧链接作废，以这一封为准
  @Post('invitations')
  @HttpCode(200)
  async invite(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown, @Req() req: Request) {
    this.guard(user, orgId);
    const parsed = memberInviteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查填写的内容');
    const { name, email, role } = parsed.data;
    if (await this.hasAccount(email)) throw new ConflictException({ statusCode: 409, message: EMAIL_HAS_ACCOUNT, field: 'email' });
    const result = await this.send(user, orgId, { name, email, role }, false);
    await this.record(user, req, 'member_invite', `${name}（${email}）· ${CUSTOMER_ROLE_LABELS[role]}`);
    return result;
  }

  // 重新发送：旧链接作废，按原来的姓名、邮箱、角色再发一封
  @Post('invitations/:id/resend')
  @HttpCode(200)
  async resend(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    const inv = await this.invitation(orgId, id);
    if (await this.hasAccount(inv.email)) throw new ConflictException(EMAIL_HAS_ACCOUNT);
    const result = await this.send(user, orgId, { name: inv.name, email: inv.email, role: inv.role }, true);
    await this.record(user, req, 'member_invite', `${inv.name}（${inv.email}）· ${CUSTOMER_ROLE_LABELS[inv.role]} · 重新发送`);
    return result;
  }

  // 撤销邀请：链接立即失效
  @Post('invitations/:id/revoke')
  @HttpCode(200)
  async revoke(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    const inv = await this.invitation(orgId, id);
    const [revoked] = await this.db
      .update(organizationInvitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(organizationInvitations.id, id), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt)))
      .returning({ id: organizationInvitations.id });
    if (!revoked) throw new ConflictException('这封邀请刚刚已被接受或撤销，请刷新页面查看');
    await this.record(user, req, 'member_invite_revoke', `${inv.name}（${inv.email}）· ${CUSTOMER_ROLE_LABELS[inv.role]}`);
    return this.view(user, orgId);
  }

  // 移除成员：不能移除自己；至少保留一位机构管理员。移除后不能再进入本组织，已登录的地方退出；
  // 上传的资料、操作记录都保留。以后再邀请同一邮箱，接受时恢复原账号
  @Post('members/:userId/remove')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    if (userId === user.id) throw new ConflictException('不能移除自己。需要退出组织请联系另一位机构管理员');
    const target = await this.member(orgId, userId);
    const outcome = await this.db.transaction(async (tx) => {
      if (!(await this.adminRemains(tx, orgId, userId))) return 'last_admin' as const;
      const [gone] = await tx
        .delete(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
        .returning({ userId: memberships.userId });
      if (!gone) return 'gone' as const;
      const ents = await tx
        .delete(enterpriseAssignments)
        .where(and(eq(enterpriseAssignments.orgId, orgId), eq(enterpriseAssignments.userId, userId)))
        .returning({ enterpriseId: enterpriseAssignments.enterpriseId });
      if (ents.length) await tx.update(enterprises).set({ membersChangedAt: new Date() }).where(inArray(enterprises.id, ents.map((e) => e.enterpriseId)));
      // 不在任何组织里了：账号停用、已登录的地方全部退出
      const [other] = await tx.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
      if (!other) {
        await tx.update(users).set({ disabledAt: new Date() }).where(eq(users.id, userId));
        await tx.delete(sessions).where(eq(sessions.userId, userId));
      }
      return 'ok' as const;
    });
    if (outcome === 'last_admin') throw new ConflictException(LAST_ADMIN);
    if (outcome === 'gone') throw new ConflictException(`${target.name}刚刚已被移除，请刷新页面查看`);
    await this.record(user, req, 'member_remove', `${target.name}（${target.email}）· ${CUSTOMER_ROLE_LABELS[target.role]}`);
    return this.view(user, orgId);
  }

  // 改角色（成员 ↔ 机构管理员）：不能改自己的；降级时至少保留一位机构管理员
  @Put('members/:userId/role')
  async changeRole(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    if (userId === user.id) throw new ConflictException('不能修改自己的角色');
    const parsed = memberRoleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择角色');
    const { role } = parsed.data;
    const target = await this.member(orgId, userId);
    if (target.role === role) throw new ConflictException(`${target.name}已经是${CUSTOMER_ROLE_LABELS[role]}`);
    const outcome = await this.db.transaction(async (tx) => {
      if (target.role === 'customer_admin' && !(await this.adminRemains(tx, orgId, userId))) return 'last_admin' as const;
      const [changed] = await tx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.role, target.role)))
        .returning({ userId: memberships.userId });
      return changed ? ('ok' as const) : ('unchanged' as const);
    });
    if (outcome === 'last_admin') throw new ConflictException(LAST_ADMIN);
    if (outcome === 'unchanged') throw new ConflictException(`${target.name}的角色刚刚被改过了，请刷新页面查看`);
    await this.record(
      user,
      req,
      'member_role_change',
      `${target.name}（${target.email}）· ${CUSTOMER_ROLE_LABELS[target.role]} → ${CUSTOMER_ROLE_LABELS[role]}`,
    );
    return this.view(user, orgId);
  }

  // 调整某位成员能访问的企业（整组替换）
  @Put('members/:userId/enterprises')
  async setMemberEnterprises(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    const parsed = memberEnterprisesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择企业');
    const ids = [...new Set(parsed.data.enterpriseIds)];
    const target = await this.member(orgId, userId);
    const ents = await this.enterprisesOf(orgId, ids);
    const changed = await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(enterpriseAssignments)
        .where(
          and(
            eq(enterpriseAssignments.orgId, orgId),
            eq(enterpriseAssignments.userId, userId),
            ids.length ? notInArray(enterpriseAssignments.enterpriseId, ids) : undefined,
          ),
        )
        .returning({ enterpriseId: enterpriseAssignments.enterpriseId });
      const added = ids.length
        ? await tx
            .insert(enterpriseAssignments)
            .values(ids.map((enterpriseId) => ({ enterpriseId, userId, orgId, assignedBy: user.id })))
            .onConflictDoNothing()
            .returning({ enterpriseId: enterpriseAssignments.enterpriseId })
        : [];
      const touched = [...removed, ...added].map((r) => r.enterpriseId);
      if (touched.length) await tx.update(enterprises).set({ membersChangedAt: new Date() }).where(inArray(enterprises.id, touched));
      return touched.length;
    });
    if (changed) {
      const names = ents.map((e) => e.name).join('、') || '无';
      await this.record(user, req, 'enterprise_assign', `${target.name}（${target.email}）· 可访问企业：${names}`);
    }
    return this.view(user, orgId);
  }

  // 调整某家企业的负责成员（整组替换）
  @Put('enterprises/:enterpriseId/members')
  async setEnterpriseMembers(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('enterpriseId', ParseUUIDPipe) enterpriseId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.guard(user, orgId);
    const parsed = enterpriseMembersSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择成员');
    const ids = [...new Set(parsed.data.userIds)];
    const [ent] = await this.enterprisesOf(orgId, [enterpriseId]);
    const people = ids.length
      ? await this.db
          .select({ id: users.id, name: users.name })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids), inArray(memberships.role, [...CUSTOMER_ROLES])))
      : [];
    if (people.length !== ids.length) throw new NotFoundException(NO_MEMBER);
    const changed = await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(enterpriseAssignments)
        .where(and(eq(enterpriseAssignments.enterpriseId, enterpriseId), ids.length ? notInArray(enterpriseAssignments.userId, ids) : undefined))
        .returning({ userId: enterpriseAssignments.userId });
      const added = ids.length
        ? await tx
            .insert(enterpriseAssignments)
            .values(ids.map((userId) => ({ enterpriseId, userId, orgId, assignedBy: user.id })))
            .onConflictDoNothing()
            .returning({ userId: enterpriseAssignments.userId })
        : [];
      const n = removed.length + added.length;
      if (n) await tx.update(enterprises).set({ membersChangedAt: new Date() }).where(eq(enterprises.id, enterpriseId));
      return n;
    });
    if (changed) {
      const names = ids.map((id) => people.find((p) => p.id === id)!.name).join('、') || '无';
      await this.record(user, req, 'enterprise_assign', `${ent!.name} · 负责成员：${names}`);
    }
    return this.view(user, orgId);
  }

  // ---- 内部 ----

  // 别家组织（或不存在）一律 404；本组织成员、运营 403
  private guard(user: SessionUser, orgId: string) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    if (!canManageOrgMembers(user, orgId)) throw new ForbiddenException('只有机构管理员可以管理组织');
  }

  private orgName(user: SessionUser, orgId: string) {
    return user.memberships.find((m) => m.orgId === orgId)?.orgName ?? '';
  }

  private record(user: SessionUser, req: Request, action: Parameters<AuditService['record']>[0]['action'], target: string) {
    return this.audit.record({ action, actorId: user.id, actorEmail: user.email, ip: clientIp(req), target });
  }

  // 邮箱已有耕云账号：不能再邀请。例外是被移除的旧账号（已停用、不在任何组织），可以重新邀请，接受时恢复
  private async hasAccount(email: string): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id, disabledAt: users.disabledAt }).from(users).where(eq(users.email, email)).limit(1);
    if (!row) return false;
    if (!row.disabledAt) return true;
    const [member] = await this.db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, row.id)).limit(1);
    return Boolean(member);
  }

  private async member(orgId: string, userId: string) {
    const [row] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);
    if (!row || !isCustomerRole(row.role)) throw new NotFoundException(NO_MEMBER);
    return { ...row, role: row.role };
  }

  private async enterprisesOf(orgId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: enterprises.id, name: enterprises.name })
      .from(enterprises)
      .where(and(eq(enterprises.orgId, orgId), inArray(enterprises.id, ids)))
      .orderBy(asc(enterprises.createdAt));
    if (rows.length !== ids.length) throw new NotFoundException('找不到该企业');
    return rows;
  }

  private async invitation(orgId: string, id: string) {
    const [inv] = await this.db
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.id, id), eq(organizationInvitations.orgId, orgId)))
      .limit(1);
    if (!inv || !isCustomerRole(inv.role)) throw new NotFoundException('找不到这封邀请');
    const state = invitationState(inv);
    if (state === 'accepted') throw new ConflictException('对方已经接受邀请了');
    if (state === 'revoked') throw new ConflictException('这封邀请已作废，请刷新页面查看最新的一封');
    return { ...inv, role: inv.role };
  }

  // 降级或移除一位机构管理员之前：锁住本组织所有管理员的成员行（两位管理员互相降级时排队），
  // 确认除了这位以外还有别的管理员。移除成员（不是管理员）时也走这里，结果恒为真
  private async adminRemains(tx: Tx, orgId: string, exceptId: string): Promise<boolean> {
    const admins = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'customer_admin')))
      .orderBy(memberships.userId)
      .for('update');
    if (!admins.some((a) => a.userId === exceptId)) return true;
    return admins.some((a) => a.userId !== exceptId);
  }

  private async send(user: SessionUser, orgId: string, who: { name: string; email: string; role: CustomerRole }, resend: boolean): Promise<MemberInviteResult> {
    const { mail, expiresAt } = await this.db
      .transaction(async (tx) => {
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
          orgName: this.orgName(user, orgId),
          role: who.role,
          email: who.email,
          name: who.name,
          phone: null,
          invitedBy: user.id,
          inviterName: user.name,
          resend,
        });
      })
      .catch((err: unknown) => {
        // 两位管理员同时重发同一封：后到的一方撞「同一邮箱只有一封未接受的邀请」，提示刷新
        if (isUniqueViolation(err, 'organization_invitations_open_email')) throw new ConflictException(RESENT_JUST_NOW);
        throw err;
      });
    // 事务提交后再发信：邀请没记下来就不发
    await this.mailer.send(mail);
    return { email: who.email, expiresAt: expiresAt.toISOString(), simulated: Boolean(this.mailer.simulated) };
  }

  // 没接受的邀请（有效或已过期），同一邮箱只列最新一封
  private async pendingInvitations(orgId: string): Promise<OrgMemberInvitation[]> {
    const rows = await this.db
      .select()
      .from(organizationInvitations)
      .where(and(eq(organizationInvitations.orgId, orgId), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt)))
      .orderBy(desc(organizationInvitations.createdAt));
    const seen = new Set<string>();
    return rows.flatMap((r) => {
      if (seen.has(r.email) || !isCustomerRole(r.role)) return [];
      seen.add(r.email);
      const state = invitationState(r);
      if (state !== 'valid' && state !== 'expired') return [];
      return [{ id: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), state }];
    });
  }
}

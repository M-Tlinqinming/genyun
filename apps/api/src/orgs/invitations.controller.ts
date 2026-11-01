import { acceptInvitationSchema, invitationState, passwordProblem, type InvitationState } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import { setSessionCookie } from '../auth/auth.controller.ts';
import { AuthService, hashPassword, type SessionUser } from '../auth/auth.service.ts';
import { Public } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { memberships, notifications, organizationInvitations, organizations, users } from '../db/schema.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { hashInvitationToken } from './invitations.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const HAS_ACCOUNT = '这个邮箱已经有耕云账号。请先登录，再联系邀请人';
const NOT_FOUND = '邀请链接不完整或已失效。请从邀请邮件里重新打开，或联系邀请人重新发送';

// 链接不能用时的说明（与 Paper 10 页「链接已过期」及注释里的其他状态一致）
const UNUSABLE: Record<Exclude<InvitationState, 'valid'>, string> = {
  accepted: '这封邀请已使用。请直接登录',
  revoked: '这封邀请已作废。耕云可能已重新发送，请打开最新一封',
  expired: '这封邀请已过期，请联系邀请人重新发送',
};

// 接受邀请（Paper 10 页 A02）：不用登录，凭邮件里的链接（令牌只存哈希）
@Controller('invitations')
export class InvitationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Get(':token')
  async show(@Param('token') token: string) {
    const inv = await this.find(token);
    return {
      state: invitationState(inv),
      orgName: inv.orgName,
      inviterName: await this.inviterName(inv),
      role: inv.role,
      email: inv.email,
      name: inv.name,
      expiresAt: inv.expiresAt,
    };
  }

  @Public()
  @Post(':token/accept')
  @HttpCode(200)
  async accept(
    @Param('token') token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const inv = await this.find(token);
    const state = invitationState(inv);
    if (state !== 'valid') throw new ConflictException({ statusCode: 409, message: UNUSABLE[state], state });

    const parsed = acceptInvitationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    const problem = passwordProblem(parsed.data.password, inv.email);
    if (problem) throw new BadRequestException(problem);

    // 只给新邮箱开账号；已有账号、还在某个组织里的人不能再接受邀请。
    // 例外：被机构管理员移除（账号已停用、不在任何组织）的账号（M3 第 7 项），重新接受邀请时恢复这个账号，上传记录仍归他
    const [existing] = await this.db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.email, inv.email))
      .limit(1);
    if (existing) {
      const [member] = await this.db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, existing.id)).limit(1);
      if (member || !existing.disabledAt) throw new ConflictException(HAS_ACCOUNT);
    }

    const passwordHash = await hashPassword(parsed.data.password);
    // 首位管理员邀请由运营发；机构管理员自己邀请的管理员（第 7 项）不受「已有管理员」限制
    const firstAdmin = inv.role === 'customer_admin' && (await this.byOperator(inv.invitedBy));
    const userId = await this.db.transaction(async (tx) => {
      if (firstAdmin) {
        // 锁住组织这一行，和运营更换首位管理员排队；已经有管理员时不再接受第二封首位管理员邀请
        await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, inv.orgId)).for('update');
        const [admin] = await tx
          .select({ id: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.orgId, inv.orgId), eq(memberships.role, 'customer_admin')))
          .limit(1);
        if (admin) throw new ConflictException('这个组织已经有机构管理员了。请直接登录，或联系机构管理员');
      }
      // 并发接受、刚被撤销或刚过期时只有一次能成功
      const [claimed] = await tx
        .update(organizationInvitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.id, inv.id),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
            gt(organizationInvitations.expiresAt, new Date()),
          ),
        )
        .returning({ id: organizationInvitations.id });
      if (!claimed) throw new ConflictException('这封邀请刚刚失效了，请刷新页面查看');
      const user = existing
        ? await this.reactivate(tx, existing.id, parsed.data.name, passwordHash)
        : (
            await tx
              .insert(users)
              .values({ email: inv.email, name: parsed.data.name, passwordHash })
              .returning({ id: users.id })
              // 同一邮箱同时接受两家组织的邀请：后到的一方撞唯一约束，返回 409 而不是 500
              .catch((err: unknown) => {
                if (isUniqueViolation(err, 'users_email_unique')) throw new ConflictException(HAS_ACCOUNT);
                throw err;
              })
          )[0];
      await tx
        .insert(memberships)
        .values({ userId: user!.id, orgId: inv.orgId, role: inv.role })
        .catch((err: unknown) => {
          if (isUniqueViolation(err, 'memberships_user_id_org_id_pk')) throw new ConflictException(HAS_ACCOUNT);
          throw err;
        });
      await tx.update(organizationInvitations).set({ acceptedBy: user!.id }).where(eq(organizationInvitations.id, inv.id));
      return user!.id;
    });

    const session = await this.auth.startSession(userId);
    setSessionCookie(res, session.token);
    return session.user;
  }

  // 恢复被移除的账号：锁住这一行，再确认仍不在任何组织里（同时接受两封邀请时只有一次成功）
  private async reactivate(tx: Tx, userId: string, name: string, passwordHash: string) {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [member] = await tx.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
    if (member) throw new ConflictException(HAS_ACCOUNT);
    const [user] = await tx
      .update(users)
      .set({ name, passwordHash, disabledAt: null })
      .where(and(eq(users.id, userId), isNotNull(users.disabledAt)))
      .returning({ id: users.id });
    if (!user) throw new ConflictException(HAS_ACCOUNT);
    return user;
  }

  // 链接过期后「请邀请人重新发送」：只给邀请人发一条站内提醒，不自动生成新链接（Paper 10 页注释）
  @Public()
  @Post(':token/request-resend')
  @HttpCode(200)
  async requestResend(@Param('token') token: string) {
    const inv = await this.find(token);
    const state = invitationState(inv);
    if (state !== 'expired') {
      const message =
        state === 'valid' ? '这封邀请还在有效期内，可以直接接受' : UNUSABLE[state];
      throw new ConflictException({ statusCode: 409, message, state });
    }
    const title = '邀请过期，请重新发送';
    // 正文带上这封邀请的到期时间：重发后新邀请再过期，还能再提醒一次
    const expired = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(inv.expiresAt);
    const body = `${inv.orgName}：发给 ${inv.email} 的邀请已于 ${expired} 过期，对方请您重新发送。`;
    // 内部成员（注安师、运营）的邀请在「内部账号」里重发
    const internal = inv.role === 'expert' || inv.role === 'operator';
    const link = internal
      ? '/operator/accounts'
      : (await this.byOperator(inv.invitedBy))
        ? `/operator/organizations/${inv.orgId}`
        : '/customer/organization';
    // 同一封邀请只提醒一次
    const [already] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, inv.invitedBy), eq(notifications.title, title), eq(notifications.body, body)))
      .limit(1);
    if (!already) await this.notifications.notify([inv.invitedBy], { title, body, link });
    return { inviterName: await this.inviterName(inv) };
  }

  // 运营发的邀请：提醒进组织详情，对客户显示「耕云运营」（和邀请邮件一致）；
  // 机构管理员发的（第 7 项）：提醒进组织管理，显示管理员姓名
  private async byOperator(userId: string): Promise<boolean> {
    const [m] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'operator')))
      .limit(1);
    return Boolean(m);
  }

  private async inviterName(inv: { invitedBy: string; inviterName: string }): Promise<string> {
    return (await this.byOperator(inv.invitedBy)) ? '耕云运营' : inv.inviterName;
  }

  private async find(token: string) {
    if (token.length < 20 || token.length > 100) throw new NotFoundException(NOT_FOUND);
    const [inv] = await this.db
      .select({
        id: organizationInvitations.id,
        orgId: organizationInvitations.orgId,
        orgName: organizations.name,
        role: organizationInvitations.role,
        email: organizationInvitations.email,
        name: organizationInvitations.name,
        expiresAt: organizationInvitations.expiresAt,
        acceptedAt: organizationInvitations.acceptedAt,
        revokedAt: organizationInvitations.revokedAt,
        invitedBy: organizationInvitations.invitedBy,
        inviterName: users.name,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.orgId))
      .innerJoin(users, eq(users.id, organizationInvitations.invitedBy))
      .where(eq(organizationInvitations.tokenHash, hashInvitationToken(token)))
      .limit(1);
    if (!inv) throw new NotFoundException(NOT_FOUND);
    return inv;
  }
}

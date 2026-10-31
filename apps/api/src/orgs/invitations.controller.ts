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
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import { setSessionCookie } from '../auth/auth.controller.ts';
import { AuthService, hashPassword, type SessionUser } from '../auth/auth.service.ts';
import { Public } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { memberships, organizationInvitations, organizations, users } from '../db/schema.ts';
import { hashInvitationToken } from './invitations.ts';

const NOT_FOUND = '邀请链接不完整或已失效。请从邀请邮件里重新打开，或联系邀请人重新发送';

// 链接不能用时的说明（与 Paper 10 页「链接已过期」及注释里的其他状态一致）
const UNUSABLE: Record<Exclude<InvitationState, 'valid'>, string> = {
  accepted: '这封邀请已使用。请直接登录',
  revoked: '这封邀请已作废，请联系机构管理员或耕云重新发送',
  expired: '这封邀请已过期，请联系邀请人重新发送',
};

// 接受邀请（Paper 10 页 A02）：不用登录，凭邮件里的链接（令牌只存哈希）
@Controller('invitations')
export class InvitationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Public()
  @Get(':token')
  async show(@Param('token') token: string) {
    const inv = await this.find(token);
    return {
      state: invitationState(inv),
      orgName: inv.orgName,
      inviterName: inv.inviterName,
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

    // 这一期只给新邮箱开账号；已有账号的人加入另一个组织留给客户组织管理（第 7 项）
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1);
    if (existing) throw new ConflictException('这个邮箱已经有耕云账号。请先登录，再联系邀请人');

    const passwordHash = await hashPassword(parsed.data.password);
    const userId = await this.db.transaction(async (tx) => {
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
      const [user] = await tx
        .insert(users)
        .values({ email: inv.email, name: parsed.data.name, passwordHash })
        .returning({ id: users.id });
      await tx.insert(memberships).values({ userId: user!.id, orgId: inv.orgId, role: inv.role });
      await tx.update(organizationInvitations).set({ acceptedBy: user!.id }).where(eq(organizationInvitations.id, inv.id));
      return user!.id;
    });

    const session = await this.auth.startSession(userId);
    setSessionCookie(res, session.token);
    return session.user;
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

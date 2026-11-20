import type { OrgCredits } from '@genyun/shared';
import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { canViewOrganization, isCustomerAdminOf } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { CreditsService } from '../credits/credits.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { organizations } from '../db/schema.ts';

@Controller('orgs')
export class OrgsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CreditsService) private readonly credits: CreditsService,
  ) {}

  @Get(':orgId')
  async get(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    // 无权访问与不存在返回同样的结果，不暴露别家组织是否存在
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    const [org] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        contractStartsAt: organizations.contractStartsAt,
        contractEndsAt: organizations.contractEndsAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) throw new NotFoundException('找不到该组织');
    return org;
  }

  // 组织管理员查自己组织的次数（K7 工作台用）：汇总和等次数的成果。成员、专家、运营 403，别家 404
  @Get(':orgId/credits')
  async creditsView(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<OrgCredits> {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    if (!isCustomerAdminOf(user, orgId)) throw new ForbiddenException('只有组织管理员可以查看编制次数');
    return this.credits.orgView(orgId);
  }
}

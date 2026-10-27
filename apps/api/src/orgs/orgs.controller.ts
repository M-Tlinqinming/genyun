import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { organizations } from '../db/schema.ts';

@Controller('orgs')
export class OrgsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
}

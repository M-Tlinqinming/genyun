import type { GiftCampaignStats } from '@genyun/shared';
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { canManageOrganizations } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { CreditsService } from './credits.service.ts';

// 赠送活动统计（16 页「赠送活动统计」）：只有耕云运营能看，按年份筛，默认今年
@Controller('operator/credits')
export class GiftCampaignsController {
  constructor(@Inject(CreditsService) private readonly credits: CreditsService) {}

  @Get('gift-campaigns')
  async giftCampaigns(@CurrentUser() user: SessionUser, @Query('year') year?: string): Promise<GiftCampaignStats> {
    if (!canManageOrganizations(user)) throw new ForbiddenException('只有耕云运营可以查看赠送活动统计');
    let y: number | undefined;
    if (year !== undefined && year !== '') {
      y = Number(year);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('年份不对');
    }
    return this.credits.giftCampaignStats(y);
  }
}

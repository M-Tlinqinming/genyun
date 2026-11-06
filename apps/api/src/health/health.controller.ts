import { Controller, ForbiddenException, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { canViewOperatorOverview } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser, Public } from '../auth/session.guard.ts';
import { HEALTH_PROBES, type HealthProbes, type HealthReport, type HealthStatus, runHealthChecks } from './health.ts';

// /api/health：容器健康检查（Dockerfile HEALTHCHECK）、部署脚本、CI 冒烟都用它。
// 总状态 down 时返回 503，其余 200（degraded 时服务还能用）。
// 不登录只返回总状态；数据库、Redis、磁盘各项只给运营看（/api/health/details，决定 19）。
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbes) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: HealthStatus }> {
    const report = await this.run(res);
    return { status: report.status };
  }

  @Get('details')
  async details(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    if (!canViewOperatorOverview(user)) throw new ForbiddenException('只有运营能查看各项检查结果');
    return this.run(res);
  }

  private async run(res: Response): Promise<HealthReport> {
    const report = await runHealthChecks(this.probes);
    res.status(report.status === 'down' ? 503 : 200);
    res.setHeader('Cache-Control', 'no-store');
    return report;
  }
}

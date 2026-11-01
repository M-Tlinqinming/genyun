import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/session.guard.ts';
import { HEALTH_PROBES, type HealthProbes, type HealthReport, runHealthChecks } from './health.ts';

// /api/health：容器健康检查（Dockerfile HEALTHCHECK）、部署脚本、CI 冒烟都用它。
// 总状态 down 时返回 503，其余 200（degraded 时服务还能用）
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbes) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await runHealthChecks(this.probes);
    res.status(report.status === 'down' ? 503 : 200);
    res.setHeader('Cache-Control', 'no-store');
    return report;
  }
}

import {
  AUDIT_PAGE_SIZE,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogPage,
  auditQuerySchema,
} from '@genyun/shared';
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable, Query } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { isOperator } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { auditLogs, users } from '../db/schema.ts';

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  target?: string | null;
}

// 记操作日志。记录失败不影响业务本身（登录照常成功），只在服务日志里报一行，不带邮箱等内容
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(e: AuditEvent): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        action: e.action,
        actorId: e.actorId ?? null,
        actorEmail: e.actorEmail ?? null,
        ip: e.ip ?? null,
        target: e.target ?? null,
      });
    } catch (err) {
      console.error(`操作日志写入失败（${e.action}）：${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}

// 请求方的 IP：app.ts 设了 trust proxy 1（前面只有 Caddy 一层），req.ip 是 Caddy 转来的真实地址
export function clientIp(req: Request): string | null {
  return (req.ip ?? '').replace(/^::ffff:/, '') || null;
}

// 运营查看操作日志：只读，新的在前，每页 50 条，可按动作筛选。客户、专业人员 403
@Controller('operator/audit-logs')
export class AuditLogsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query() query: unknown): Promise<AuditLogPage> {
    if (!isOperator(user)) throw new ForbiddenException('只有耕云运营可以查看操作日志');
    const parsed = auditQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('筛选条件不正确');
    const { page, action } = parsed.data;
    const where = action ? eq(auditLogs.action, action) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: auditLogs.id,
          at: auditLogs.at,
          actorName: users.name,
          actorEmail: auditLogs.actorEmail,
          ip: auditLogs.ip,
          action: auditLogs.action,
          target: auditLogs.target,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.at), desc(auditLogs.id))
        .limit(AUDIT_PAGE_SIZE)
        .offset((page - 1) * AUDIT_PAGE_SIZE),
      this.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    const entries: AuditLogEntry[] = rows.map((r) => ({ ...r, at: r.at.toISOString() }));
    return { entries, total: total?.n ?? 0, page, pageSize: AUDIT_PAGE_SIZE };
  }
}

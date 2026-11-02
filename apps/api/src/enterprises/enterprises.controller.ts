import { enterpriseInputSchema, enterpriseUpdateSchema } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { canCreateEnterprise, canEditEnterpriseData, canViewEnterprise, canViewOrganization, enterpriseScope } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { enterpriseAssignments, enterprises, users } from '../db/schema.ts';

const NOT_FOUND = '找不到该企业';
const DUPLICATE_CODE = '本组织已有使用该统一社会信用代码的企业';

const columns = {
  id: enterprises.id,
  orgId: enterprises.orgId,
  name: enterprises.name,
  socialCreditCode: enterprises.socialCreditCode,
  registeredAddress: enterprises.registeredAddress,
  legalRepresentative: enterprises.legalRepresentative,
  createdAt: enterprises.createdAt,
  updatedAt: enterprises.updatedAt,
};

@Controller()
export class EnterprisesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('orgs/:orgId/enterprises')
  async list(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    // 成员只列出分配给自己的企业
    const scope = enterpriseScope(user, orgId);
    if (Array.isArray(scope) && scope.length === 0) return [];
    const rows = await this.db
      .select(columns)
      .from(enterprises)
      .where(and(eq(enterprises.orgId, orgId), Array.isArray(scope) ? inArray(enterprises.id, scope) : undefined))
      .orderBy(asc(enterprises.createdAt));
    // 负责成员（企业列表「负责成员」列）
    const assigned = rows.length
      ? await this.db
          .select({ enterpriseId: enterpriseAssignments.enterpriseId, id: users.id, name: users.name })
          .from(enterpriseAssignments)
          .innerJoin(users, eq(users.id, enterpriseAssignments.userId))
          .where(inArray(enterpriseAssignments.enterpriseId, rows.map((r) => r.id)))
          .orderBy(asc(enterpriseAssignments.assignedAt))
      : [];
    return rows.map((r) => ({
      ...r,
      members: assigned.filter((a) => a.enterpriseId === r.id).map(({ id, name }) => ({ id, name })),
    }));
  }

  @Post('orgs/:orgId/enterprises')
  async create(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    if (!canCreateEnterprise(user, orgId)) throw new ForbiddenException('新建企业请联系机构管理员');
    const parsed = enterpriseInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    try {
      const [created] = await this.db
        .insert(enterprises)
        .values({ ...parsed.data, orgId, createdBy: user.id })
        .returning(columns);
      return created;
    } catch (err) {
      if (isUniqueViolation(err, 'enterprises_org_credit_code_unique')) throw new ConflictException(DUPLICATE_CODE);
      throw err;
    }
  }

  @Get('enterprises/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.load(user, id);
  }

  @Patch('enterprises/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const found = await this.load(user, id);
    if (!canEditEnterpriseData(user, { orgId: found.orgId, enterpriseId: found.id })) throw new ForbiddenException('企业档案由客户自己维护');
    const parsed = enterpriseUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
    try {
      const [updated] = await this.db
        .update(enterprises)
        // 与自填第 1 步共用版本号，别人在填写页里看到的旧内容不会覆盖这次修改
        .set({ ...parsed.data, version: sql`${enterprises.version} + 1`, updatedAt: new Date() })
        .where(eq(enterprises.id, id))
        .returning(columns);
      return updated;
    } catch (err) {
      if (isUniqueViolation(err, 'enterprises_org_credit_code_unique')) throw new ConflictException(DUPLICATE_CODE);
      throw err;
    }
  }

  // 无权访问与不存在返回同样的结果，不暴露别家企业是否存在
  private async load(user: SessionUser, id: string) {
    const [found] = await this.db.select(columns).from(enterprises).where(eq(enterprises.id, id)).limit(1);
    if (!found || !canViewEnterprise(user, { orgId: found.orgId, enterpriseId: found.id })) throw new NotFoundException(NOT_FOUND);
    return found;
  }
}

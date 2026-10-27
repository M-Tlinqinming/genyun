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
import { asc, eq, sql } from 'drizzle-orm';
import { canEditOrganizationData, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { enterprises } from '../db/schema.ts';

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
    return this.db.select(columns).from(enterprises).where(eq(enterprises.orgId, orgId)).orderBy(asc(enterprises.createdAt));
  }

  @Post('orgs/:orgId/enterprises')
  async create(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: unknown) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    if (!canEditOrganizationData(user, orgId)) throw new ForbiddenException('企业档案由客户自己建立');
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
    if (!canEditOrganizationData(user, found.orgId)) throw new ForbiddenException('企业档案由客户自己维护');
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
    if (!found || !canViewOrganization(user, found.orgId)) throw new NotFoundException(NOT_FOUND);
    return found;
  }
}

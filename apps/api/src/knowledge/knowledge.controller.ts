import {
  AGENCY_CATEGORY_LABELS,
  agencyInputSchema,
  agencyRegionInputSchema,
  type KnowledgeAgenciesView,
  type ProcessTemplate,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { eq, max } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService, clientIp } from '../audit/audit.ts';
import { canManageKnowledge } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { agencyRegions, localAgencies } from '../db/schema.ts';
import { KnowledgeService } from './knowledge.service.ts';

const FORBIDDEN = '只有耕云运营可以维护知识库';
const REGION_NOT_FOUND = '找不到这个区县';
const AGENCY_NOT_FOUND = '找不到这个机构';

const parse = <T>(schema: z.ZodType<T>, body: unknown, fallback: string): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? fallback);
  return parsed.data;
};

// 知识库（Paper 16 页「知识库 · 属地应急机构」）。工艺模板、节假日的维护已取消，表和数据保留。
// 只有运营能看、能改；客户、专家 403。每次修改记操作日志。
// 改动只影响之后的生成：已生成的草稿、已交付的成果都不动
@Controller('operator/knowledge')
export class KnowledgeController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- 属地应急机构 ----------

  @Get('agencies')
  async agencies(@CurrentUser() user: SessionUser): Promise<KnowledgeAgenciesView> {
    this.guard(user);
    return { regions: await this.knowledge.regions() };
  }

  @Post('regions')
  @HttpCode(200)
  async addRegion(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: Request): Promise<KnowledgeAgenciesView> {
    this.guard(user);
    const input = parse(agencyRegionInputSchema, body, '请检查区县信息');
    const [{ last } = { last: null }] = await this.db.select({ last: max(agencyRegions.sortOrder) }).from(agencyRegions);
    try {
      await this.db.insert(agencyRegions).values({ ...input, plan: input.plan ?? null, sortOrder: (last ?? -1) + 1 });
    } catch (err) {
      if (isUniqueViolation(err, 'agency_regions_name')) throw new ConflictException(`${input.city}${input.name}已经在知识库里了`);
      throw err;
    }
    await this.log(user, req, 'knowledge_agency_change', `新增区县：${input.province}${input.city}${input.name}`);
    return this.agencies(user);
  }

  @Put('regions/:id')
  async updateRegion(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<KnowledgeAgenciesView> {
    this.guard(user);
    const input = parse(agencyRegionInputSchema, body, '请检查区县信息');
    let updated: { id: string }[];
    try {
      updated = await this.db
        .update(agencyRegions)
        .set({ ...input, plan: input.plan ?? null, updatedAt: new Date() })
        .where(eq(agencyRegions.id, id))
        .returning({ id: agencyRegions.id });
    } catch (err) {
      if (isUniqueViolation(err, 'agency_regions_name')) throw new ConflictException(`${input.city}${input.name}已经在知识库里了`);
      throw err;
    }
    if (updated.length === 0) throw new NotFoundException(REGION_NOT_FOUND);
    await this.log(user, req, 'knowledge_agency_change', `修改区县：${input.city}${input.name}`);
    return this.agencies(user);
  }

  @Post('agencies')
  @HttpCode(200)
  async addAgency(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: Request): Promise<KnowledgeAgenciesView> {
    this.guard(user);
    const input = parse(agencyInputSchema, body, '请检查机构信息');
    const region = await this.region(input.regionId);
    const [{ last } = { last: null }] = await this.db
      .select({ last: max(localAgencies.sortOrder) })
      .from(localAgencies)
      .where(eq(localAgencies.regionId, region.id));
    const now = new Date();
    await this.db.insert(localAgencies).values({
      ...this.agencyColumns(input),
      regionId: region.id,
      sortOrder: (last ?? -1) + 1,
      verifiedAt: now,
      verifiedBy: user.id,
    });
    await this.log(user, req, 'knowledge_agency_change', `新增机构：${region.name} · ${input.name}（${AGENCY_CATEGORY_LABELS[input.category]}）`);
    return this.agencies(user);
  }

  // 修改即视为运营核实过这条信息
  @Put('agencies/:id')
  async updateAgency(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<KnowledgeAgenciesView> {
    this.guard(user);
    const input = parse(agencyInputSchema, body, '请检查机构信息');
    const region = await this.region(input.regionId);
    const now = new Date();
    const updated = await this.db
      .update(localAgencies)
      .set({ ...this.agencyColumns(input), regionId: region.id, verifiedAt: now, verifiedBy: user.id, updatedAt: now })
      .where(eq(localAgencies.id, id))
      .returning({ id: localAgencies.id });
    if (updated.length === 0) throw new NotFoundException(AGENCY_NOT_FOUND);
    await this.log(user, req, 'knowledge_agency_change', `修改机构：${region.name} · ${input.name}`);
    return this.agencies(user);
  }

  // 核实：电话、名称没变，只记一下谁在什么时候核对过
  @Post('agencies/:id/verify')
  @HttpCode(200)
  async verifyAgency(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    const now = new Date();
    const name = await this.touchAgency(id, { verifiedAt: now, verifiedBy: user.id });
    await this.log(user, req, 'knowledge_agency_change', `核实机构：${name}`);
    return this.agencies(user);
  }

  // 停用：之后的生成不再用这个机构（同区县同类别有别的就用别的，没有就不写）
  @Post('agencies/:id/disable')
  @HttpCode(200)
  async disableAgency(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    const name = await this.touchAgency(id, { disabledAt: new Date() });
    await this.log(user, req, 'knowledge_agency_change', `停用机构：${name}`);
    return this.agencies(user);
  }

  @Post('agencies/:id/enable')
  @HttpCode(200)
  async enableAgency(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    this.guard(user);
    const name = await this.touchAgency(id, { disabledAt: null });
    await this.log(user, req, 'knowledge_agency_change', `恢复机构：${name}`);
    return this.agencies(user);
  }

  // ---------- 内部 ----------

  private guard(user: SessionUser) {
    if (!canManageKnowledge(user)) throw new ForbiddenException(FORBIDDEN);
  }

  private async region(id: string) {
    const [row] = await this.db.select().from(agencyRegions).where(eq(agencyRegions.id, id));
    if (!row) throw new NotFoundException(REGION_NOT_FOUND);
    return row;
  }

  private agencyColumns(input: z.infer<typeof agencyInputSchema>) {
    const street = input.category === 'street';
    return {
      category: input.category,
      name: input.name,
      phone: input.phone ?? null,
      // 镇街范围、别的叫法、镇街预案只对镇街应急办有意义
      area: street ? (input.area ?? null) : null,
      aliases: street ? input.aliases : [],
      plan: street ? (input.plan ?? null) : null,
      note: input.note ?? null,
    };
  }

  // 改一条机构的状态，返回「区县 · 机构名」用于日志
  private async touchAgency(id: string, set: Partial<typeof localAgencies.$inferInsert>): Promise<string> {
    const [row] = await this.db
      .select({ name: localAgencies.name, region: agencyRegions.name })
      .from(localAgencies)
      .innerJoin(agencyRegions, eq(agencyRegions.id, localAgencies.regionId))
      .where(eq(localAgencies.id, id));
    if (!row) throw new NotFoundException(AGENCY_NOT_FOUND);
    await this.db
      .update(localAgencies)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(localAgencies.id, id));
    return `${row.region} · ${row.name}`;
  }

  private log(user: SessionUser, req: Request, action: 'knowledge_agency_change', target: string) {
    return this.audit.record({ action, actorId: user.id, actorEmail: user.email, ip: clientIp(req), target });
  }
}

// 客户选工艺模板（生产情况 · 工艺流程）：登录即可读，只有已发布、没停用的
@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}

  @Get()
  async list(): Promise<{ templates: ProcessTemplate[] }> {
    return { templates: await this.knowledge.publishedTemplates() };
  }
}

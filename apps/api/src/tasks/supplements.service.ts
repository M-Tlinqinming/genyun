// 事实补件（M2 第 13 项，15 页 R00a、R00b、R00c）。负责专家发起，客户在任务里回应，
// 专家对照原件写下本轮采用的值并明确采用，才改本任务的企业事实；之后按新事实重新生成三份草稿（生成接口不变）。
import {
  factDefOf,
  supplementAdoptError,
  supplementAdoptSchema,
  supplementCreateSchema,
  supplementOpen,
  supplementResponseError,
  supplementResponseSchema,
  supplementReturnSchema,
  workupFacts,
  type CustomerSupplement,
  type FactSupplement,
  type SupplementFact,
} from '@genyun/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEditOrganizationData } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  enterpriseDocuments,
  enterpriseDocumentVersions,
  factSupplements,
  files,
  generationBatches,
  memberships,
  tasks,
  users,
} from '../db/schema.ts';
import { DocumentsService } from '../documents/documents.service.ts';
import { NotificationsService } from '../notifications/notifications.service.ts';
import { TasksService } from './tasks.service.ts';
import { WorkupService } from './workup.service.ts';

const responder = alias(users, 'responder');
const adopter = alias(users, 'adopter');
const NOT_FOUND = '找不到这一轮事实补件';

@Injectable()
export class SupplementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WorkupService) private readonly workup: WorkupService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ---- 专家 ----

  // 各轮补件，最近的在前；负责专家与运营可以看
  async list(user: SessionUser, taskId: string): Promise<FactSupplement[]> {
    const task = await this.workup.task(user, taskId);
    return this.rounds(task.id);
  }

  async create(user: SessionUser, taskId: string, body: unknown) {
    const task = await this.workup.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以发起事实补件');
    const parsed = supplementCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const input = parsed.data;
    if (input.needsFile && !input.itemKey) throw new BadRequestException('请选择要客户提供哪一项资料');

    const { snapshot, data } = await this.workup.rowOf(task);
    const all = workupFacts(snapshot, data);
    const facts: SupplementFact[] = [];
    for (const key of new Set(input.factKeys)) {
      const f = all.find((x) => x.key === key);
      if (!f) throw new BadRequestException('没有这一项企业事实');
      if (f.readonly) throw new BadRequestException(`${f.label}由系统按规则生成，不能补件`);
      facts.push({ key: f.key, label: f.label, kind: f.kind, before: f.value ?? null });
    }

    await this.db.transaction(async (tx) => {
      const existing = await tx.select({ status: factSupplements.status }).from(factSupplements).where(eq(factSupplements.taskId, task.id));
      if (existing.some(supplementOpen)) throw new ConflictException('上一轮补件还没有完成，请先处理那一轮');
      const [top] = await tx.select({ n: max(factSupplements.round) }).from(factSupplements).where(eq(factSupplements.taskId, task.id));
      await tx.insert(factSupplements).values({
        taskId: task.id,
        round: (top?.n ?? 0) + 1,
        status: 'awaiting_customer',
        title: input.title,
        message: input.message,
        itemKey: input.itemKey,
        needsFile: input.needsFile,
        facts,
        createdBy: user.id,
      });
    });
    await this.notifyCustomer(user, task, input.title);
    return this.rounds(task.id);
  }

  // R00b「确认事实并采用到本任务」：写下每项本轮采用的值，改专业整理里的企业事实（来源：客户确认 · 事实补件）
  async adopt(user: SessionUser, taskId: string, supplementId: string, body: unknown) {
    const task = await this.workup.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以采用补件');
    const row = await this.row(task.id, supplementId);
    if (row.status !== 'awaiting_expert') {
      throw new ConflictException(row.status === 'adopted' ? '这一轮已经采用过了' : '客户还没有回应这一轮补件');
    }
    const parsed = supplementAdoptSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { snapshot } = await this.workup.rowOf(task);
    const error = supplementAdoptError(row.facts, parsed.data, (key) => factDefOf(snapshot, key));
    if (error) throw new BadRequestException(error);

    const facts: SupplementFact[] = row.facts.map((f) => {
      const a = parsed.data.facts.find((x) => x.key === f.key)!;
      return { ...f, after: a.value, ...(a.basis ? { basis: a.basis } : {}) };
    });
    // 先占住这一轮（两个窗口同时点只有一个成功），再改企业事实
    const [claimed] = await this.db
      .update(factSupplements)
      .set({ status: 'adopted', facts, adoptedBy: user.id, adoptedAt: new Date() })
      .where(and(eq(factSupplements.id, row.id), eq(factSupplements.status, 'awaiting_expert')))
      .returning({ id: factSupplements.id });
    if (!claimed) throw new ConflictException('这一轮已经采用过了');
    await this.workup.applySupplement(
      user,
      task,
      row.id,
      facts.map((f) => ({ key: f.key, value: f.after! })),
    );
    await this.db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return this.rounds(task.id);
  }

  // R00b「仍需客户补充」：这一轮标为 returned，另起下一轮（同样的事实与资料项，专家写新的说明）
  async returnToCustomer(user: SessionUser, taskId: string, supplementId: string, body: unknown) {
    const task = await this.workup.task(user, taskId);
    if (task.assignedExpertId !== user.id) throw new ForbiddenException('只有负责专家可以发起事实补件');
    const row = await this.row(task.id, supplementId);
    if (row.status !== 'awaiting_expert') throw new ConflictException('只有客户已回应、还没采用的一轮可以请客户再补充');
    const parsed = supplementReturnSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');

    await this.db.transaction(async (tx) => {
      const [done] = await tx
        .update(factSupplements)
        .set({ status: 'returned' })
        .where(and(eq(factSupplements.id, row.id), eq(factSupplements.status, 'awaiting_expert')))
        .returning({ id: factSupplements.id });
      if (!done) throw new ConflictException('这一轮刚被处理过，请刷新后再看');
      await tx.insert(factSupplements).values({
        taskId: task.id,
        round: row.round + 1,
        status: 'awaiting_customer',
        title: row.title,
        message: parsed.data.message,
        itemKey: row.itemKey,
        needsFile: row.needsFile,
        facts: row.facts.map(({ key, label, kind, before }) => ({ key, label, kind, before })),
        createdBy: user.id,
      });
    });
    await this.notifyCustomer(user, task, row.title);
    return this.rounds(task.id);
  }

  // ---- 客户 ----

  async customerList(user: SessionUser, taskId: string): Promise<CustomerSupplement[]> {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new NotFoundException('找不到该任务');
    return (await this.rounds(task.id)).map((s) => ({
      id: s.id,
      round: s.round,
      status: s.status,
      title: s.title,
      message: s.message,
      itemKey: s.itemKey,
      needsFile: s.needsFile,
      createdAt: s.createdAt,
      createdByName: s.createdByName,
      response: s.response,
      files: s.files,
      adoptedAt: s.adoptedAt,
      labels: s.facts.map((f) => f.label),
    }));
  }

  // R00a「提交本轮补充」：文件进企业资料库并关联到任务（专家原件对照能看到）；企业事实要等专家明确采用才改
  async respond(user: SessionUser, taskId: string, supplementId: string, body: unknown) {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new NotFoundException('找不到该任务');
    const row = await this.row(task.id, supplementId);
    if (row.status !== 'awaiting_customer') throw new ConflictException('这一轮补件已经提交过了');
    const parsed = supplementResponseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const error = supplementResponseError(row, parsed.data);
    if (error) throw new BadRequestException(error);

    const fileIds = [...new Set(parsed.data.fileIds)];
    for (const fileId of fileIds) await this.documents.addToTask(user, task.id, fileId);
    const [saved] = await this.db
      .update(factSupplements)
      .set({
        status: 'awaiting_expert',
        responseFileIds: fileIds,
        responseNote: parsed.data.note || null,
        respondedBy: user.id,
        respondedAt: new Date(),
      })
      .where(and(eq(factSupplements.id, row.id), eq(factSupplements.status, 'awaiting_customer')))
      .returning({ id: factSupplements.id });
    if (!saved) throw new ConflictException('这一轮补件已经提交过了');

    if (task.assignedExpertId) {
      await this.notifications.notify([task.assignedExpertId], {
        taskId: task.id,
        title: `${task.enterpriseName}回应了事实补件`,
        body: row.title,
        link: `/expert/tasks/${task.id}?view=supplement`,
      });
    }
    await this.db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return this.customerList(user, task.id);
  }

  // ---- 内部 ----

  private async row(taskId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(factSupplements)
      .where(and(eq(factSupplements.id, id), eq(factSupplements.taskId, taskId)))
      .limit(1);
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async rounds(taskId: string): Promise<FactSupplement[]> {
    const rows = await this.db
      .select({
        s: factSupplements,
        createdByName: users.name,
        respondedByName: responder.name,
        adoptedByName: adopter.name,
      })
      .from(factSupplements)
      .innerJoin(users, eq(users.id, factSupplements.createdBy))
      .leftJoin(responder, eq(responder.id, factSupplements.respondedBy))
      .leftJoin(adopter, eq(adopter.id, factSupplements.adoptedBy))
      .where(eq(factSupplements.taskId, taskId))
      .orderBy(desc(factSupplements.round));
    if (rows.length === 0) return [];

    const fileIds = [...new Set(rows.flatMap((r) => r.s.responseFileIds ?? []))];
    const named = fileIds.length
      ? await this.db
          .select({ id: files.id, name: files.originalName, docName: enterpriseDocuments.name, version: enterpriseDocumentVersions.version })
          .from(files)
          .leftJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.fileId, files.id))
          .leftJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
          .where(inArray(files.id, fileIds))
      : [];
    // 采用以后有没有重新生成过：最近一批草稿是不是在采用之后确认的
    const [latest] = await this.db
      .select({ createdAt: generationBatches.createdAt })
      .from(generationBatches)
      .where(eq(generationBatches.taskId, taskId))
      .orderBy(desc(generationBatches.createdAt))
      .limit(1);

    return rows.map(({ s, createdByName, respondedByName, adoptedByName }) => ({
      id: s.id,
      round: s.round,
      status: s.status,
      title: s.title,
      message: s.message,
      itemKey: s.itemKey,
      needsFile: s.needsFile,
      facts: s.facts,
      createdAt: s.createdAt.toISOString(),
      createdByName,
      response: s.respondedAt
        ? { fileIds: s.responseFileIds ?? [], note: s.responseNote, at: s.respondedAt.toISOString(), byName: respondedByName ?? '' }
        : null,
      files: (s.responseFileIds ?? []).map((id) => {
        const f = named.find((n) => n.id === id);
        return { id, name: f?.docName ?? f?.name ?? '文件', version: f?.version ?? null };
      }),
      adoptedAt: s.adoptedAt?.toISOString() ?? null,
      adoptedByName: adoptedByName ?? null,
      regenerated: s.adoptedAt !== null && latest !== undefined && latest.createdAt > s.adoptedAt,
    }));
  }

  private async notifyCustomer(user: SessionUser, task: { id: string; orgId: string; enterpriseId: string }, title: string) {
    const customers = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, task.orgId), inArray(memberships.role, ['customer_admin', 'customer_member'])));
    await this.notifications.notify(
      customers.map((c) => c.userId),
      { taskId: task.id, title: `${user.name}请您确认企业事实`, body: title, link: `/customer/tasks/${task.id}` },
    );
    await this.db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
  }
}

@Controller('tasks/:id')
export class SupplementsController {
  constructor(@Inject(SupplementsService) private readonly service: SupplementsService) {}

  @Get('supplements')
  list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.list(user, id);
  }

  @Post('supplements')
  create(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.create(user, id, body);
  }

  @Post('supplements/:sid/adopt')
  adopt(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() body: unknown,
  ) {
    return this.service.adopt(user, id, sid, body);
  }

  @Post('supplements/:sid/return')
  returnToCustomer(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() body: unknown,
  ) {
    return this.service.returnToCustomer(user, id, sid, body);
  }

  @Get('supplement-requests')
  customerList(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.customerList(user, id);
  }

  @Post('supplement-requests/:sid/response')
  respond(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() body: unknown,
  ) {
    return this.service.respond(user, id, sid, body);
  }
}

// 正文编辑（M2 第 11 项，14 页 E18-03、E18-04、E18-07、E18-08）：负责专家按节修改最近一批生成的草稿。
// 修订盖在生成时存下的文档结构上，存在 draft_edits；每次保存一节记一条修订（draft_revisions）。
// 两人同时改同一节时后保存的被拒绝并带回最新保存稿；同一次保存重试（结果不确定时）不重复记。
import {
  applyEdits,
  DRAFT_KIND_KEYS,
  DRAFT_KINDS,
  editableOf,
  editBlocksError,
  findSection,
  outlineOf,
  rewriteRequestSchema,
  sameBlocks,
  sectionSaveSchema,
  type DeliveryDocument,
  type DraftKind,
  type EditBlock,
  type EditDocumentView,
  type LockedPreview,
  type PlanInput,
  type RewriteResult,
  type SectionEdit,
  type SectionView,
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
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { canEditTaskWork, canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { draftEdits, draftRevisions, files, generatedDrafts, generationBatches, tasks, users } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import type { ParagraphPolisher } from '../generation/ai/drafter.ts';
import { polishParagraph } from '../generation/ai/polish.ts';
import { riskFacts } from '../generation/ai/risk.ts';
import { parseDocument } from '../generation/document-json.ts';
import { renderWord, type DeliveryMeta } from '../generation/word/render.ts';
import { batchLock, throwIfLocked } from './delivery-lock.ts';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { THUMB_SIDE } from '../generation/drawings/renderer.ts';

export const EDIT_DRAFTER = Symbol('EDIT_DRAFTER');

const NOT_FOUND = '找不到该任务';
const STALE = '本节已被更新：其他人刚保存了新的版本，直接保存会覆盖。请对照最新保存稿后再保存';
const REGENERATED = '草稿已重新生成，请刷新后再改';

type Draft = {
  task: { id: string; assignedExpertId: string | null };
  batch: typeof generationBatches.$inferSelect;
  kind: DraftKind;
  notes: EditDocumentView['notes'];
  doc: DeliveryDocument;
};

@Injectable()
export class EditingService {
  // 文档结构几 MB（含图片），解析一次留着用；只留最近几份
  private readonly cache = new Map<string, DeliveryDocument>();
  private readonly thumbs = new Map<string, Buffer>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(EDIT_DRAFTER) private readonly drafter: ParagraphPolisher | null,
  ) {}

  async document(user: SessionUser, taskId: string, kind: string): Promise<EditDocumentView> {
    const d = await this.draft(user, taskId, kind);
    const [edits, lock] = await Promise.all([this.edits(d.batch.id, d.kind), batchLock(this.db, d.batch.id)]);
    return {
      batchId: d.batch.id,
      kind: d.kind,
      version: edits?.version ?? 0,
      outline: outlineOf(d.doc, edits?.sections ?? {}),
      // 发布以后（和正在发布时）正文只读
      editable: canEditTaskWork(user, d.task) && !lock,
      published: lock?.status === 'done' ? { version: lock.version, at: lock.publishedAt! } : null,
      rewrite: this.drafter !== null,
      notes: d.notes,
    };
  }

  async section(user: SessionUser, taskId: string, kind: string, sectionId: string): Promise<SectionView> {
    const d = await this.draft(user, taskId, kind);
    const edits = await this.edits(d.batch.id, d.kind);
    return this.sectionView(d, sectionId, edits?.sections[sectionId]);
  }

  async save(user: SessionUser, taskId: string, kind: string, sectionId: string, body: unknown): Promise<SectionView & { version: number }> {
    const d = await this.draft(user, taskId, kind);
    if (!canEditTaskWork(user, d.task)) throw new ForbiddenException('只有负责这个任务的注安师可以修改正文');
    const parsed = sectionSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { saveId, batchId, baseRev, blocks, note, aiPromptVersion } = parsed.data;
    // 打开页面以后重新生成过：不能把旧稿上的修改写进新生成的稿
    this.sameBatch(d, batchId);
    const found = findSection(d.doc, sectionId);
    if (!found) throw new NotFoundException('找不到这一节');

    // 同一次保存的重试：已经记过就直接返回那一次的结果；saveId 不能拿到另一节去用
    const replay = await this.replayed(d, saveId);
    if (replay) {
      if (replay.id !== sectionId) throw new ConflictException({ statusCode: 409, message: '这次保存属于另一节，请刷新后重试', reason: 'other_section' });
      return replay;
    }

    const error = editBlocksError(found.section.blocks, blocks);
    if (error) throw new BadRequestException(error);
    // 锁定块的名称按原文重新给，不用页面传来的
    const original = editableOf(found.section.blocks);
    const clean: EditBlock[] = blocks.map((b) => (b.type === 'locked' ? original[b.index]! : b));

    try {
      const version = await this.db.transaction(async (tx) => {
        await tx.insert(draftEdits).values({ batchId: d.batch.id, kind: d.kind }).onConflictDoNothing();
        // 锁住这一行，两人同时保存时排队
        const [row] = await tx
          .select()
          .from(draftEdits)
          .where(and(eq(draftEdits.batchId, d.batch.id), eq(draftEdits.kind, d.kind)))
          .for('update');
        // 已发布（或正在发布）的这批文稿不能再改：放在锁住修订记录之后查，和发布时的最后核对不会交错
        throwIfLocked(await batchLock(tx, d.batch.id));
        const current = row!.sections[sectionId];
        const rev = current?.rev ?? 0;
        if (rev !== baseRev) {
          throw new ConflictException({ statusCode: 409, message: STALE, reason: 'stale', latest: this.sectionView(d, sectionId, current) });
        }
        if (sameBlocks(current?.blocks ?? original, clean)) throw new BadRequestException('本节没有修改，不用保存');
        const entry: SectionEdit = { blocks: clean, rev: rev + 1, note, by: user.id, byName: user.name, at: new Date().toISOString() };
        const version = row!.version + 1;
        await tx
          .update(draftEdits)
          .set({ sections: sql`${draftEdits.sections} || ${JSON.stringify({ [sectionId]: entry })}::jsonb`, version, updatedBy: user.id, updatedAt: new Date() })
          .where(and(eq(draftEdits.batchId, d.batch.id), eq(draftEdits.kind, d.kind)));
        await tx.insert(draftRevisions).values({
          saveId,
          batchId: d.batch.id,
          kind: d.kind,
          sectionId,
          sectionTitle: found.section.title,
          note,
          aiPromptVersion: aiPromptVersion ?? null,
          before: current?.blocks ?? original,
          after: clean,
          rev: entry.rev,
          version,
          createdBy: user.id,
        });
        return version;
      });
      const edits = await this.edits(d.batch.id, d.kind);
      return { ...this.sectionView(d, sectionId, edits?.sections[sectionId]), version };
    } catch (err) {
      // 同一次保存的两个请求同时到：后到的那个按已保存返回
      if (isUniqueViolation(err, 'draft_revisions_save_id_unique')) {
        const again = await this.replayed(d, saveId);
        if (again && again.id === sectionId) return again;
      }
      throw err;
    }
  }

  // 保存结果不确定（断网、超时）时页面先查这一次保存有没有记上，再决定要不要重试
  async saveStatus(
    user: SessionUser,
    taskId: string,
    kind: string,
    saveId: string,
    batchId: string | undefined,
  ): Promise<{ saved: false } | { saved: true; section: SectionView & { version: number } }> {
    const d = await this.draft(user, taskId, kind);
    this.sameBatch(d, batchId);
    const replay = await this.replayed(d, saveId);
    return replay ? { saved: true, section: replay } : { saved: false };
  }

  async rewrite(user: SessionUser, taskId: string, kind: string, sectionId: string, body: unknown): Promise<RewriteResult> {
    const d = await this.draft(user, taskId, kind);
    if (!canEditTaskWork(user, d.task)) throw new ForbiddenException('只有负责这个任务的注安师可以使用 AI 改写');
    throwIfLocked(await batchLock(this.db, d.batch.id));
    const parsed = rewriteRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const found = findSection(d.doc, sectionId);
    if (!found) throw new NotFoundException('找不到这一节');
    const input = d.batch.input;
    return polishParagraph(
      this.drafter,
      {
        plan: `${DRAFT_KINDS[d.kind]} · ${found.path[0]}`,
        section: found.section.title,
        companyName: input.basic.companyName,
        shortName: input.expert.facts?.shortName,
        people: peopleOf(input),
        facts: riskFacts(input),
      },
      parsed.data.text,
    );
  }

  // 当前稿的 Word：生成时的结构盖上各节修订（第 12 项起再转 PDF、记核对）
  async word(user: SessionUser, taskId: string, kind: string): Promise<{ name: string; data: Buffer }> {
    const d = await this.draft(user, taskId, kind);
    const edits = await this.edits(d.batch.id, d.kind);
    const blocks = Object.fromEntries(Object.entries(edits?.sections ?? {}).map(([id, e]) => [id, e.blocks]));
    const data = await renderWord(applyEdits(d.doc, blocks));
    return { name: `${d.batch.input.basic.companyName}${DRAFT_KINDS[d.kind]}（修订稿）.docx`, data };
  }

  // 发布时的定稿：这批草稿的结构盖上各节修订，文件属性写上 AI 标识和审核人。权限由发布服务先查
  async deliveryWord(batch: typeof generationBatches.$inferSelect, kind: DraftKind, meta: DeliveryMeta): Promise<{ name: string; data: Buffer }> {
    const { doc } = await this.load(batch.id, kind);
    const edits = await this.edits(batch.id, kind);
    const blocks = Object.fromEntries(Object.entries(edits?.sections ?? {}).map(([id, e]) => [id, e.blocks]));
    const data = await renderWord(applyEdits(doc, blocks), meta);
    return { name: `${batch.input.basic.companyName}${DRAFT_KINDS[kind]}.docx`, data };
  }

  // 锁定的图的缩略图（编辑区只读显示）；同一张图只缩一次
  async figure(user: SessionUser, taskId: string, kind: string, sectionId: string, index: number): Promise<Buffer> {
    const d = await this.draft(user, taskId, kind);
    const block = findSection(d.doc, sectionId)?.section.blocks[index];
    if (!block || block.type !== 'figure') throw new NotFoundException('找不到这张图');
    const key = `${d.batch.id}/${d.kind}/${sectionId}/${index}`;
    let data = this.thumbs.get(key);
    if (!data) {
      data = await thumbnail(block.png);
      this.thumbs.set(key, data);
      if (this.thumbs.size > 200) this.thumbs.delete(this.thumbs.keys().next().value!);
    }
    return data;
  }

  // 那一次保存记下的内容和修订次数（不是这一节现在的样子：之后可能又有人保存过）
  private async replayed(d: Draft, saveId: string): Promise<(SectionView & { version: number }) | null> {
    const [rev] = await this.db
      .select({
        sectionId: draftRevisions.sectionId,
        after: draftRevisions.after,
        rev: draftRevisions.rev,
        version: draftRevisions.version,
        note: draftRevisions.note,
        at: draftRevisions.createdAt,
        byName: users.name,
      })
      .from(draftRevisions)
      .innerJoin(users, eq(users.id, draftRevisions.createdBy))
      .where(and(eq(draftRevisions.saveId, saveId), eq(draftRevisions.batchId, d.batch.id), eq(draftRevisions.kind, d.kind)))
      .limit(1);
    if (!rev) return null;
    const found = findSection(d.doc, rev.sectionId);
    if (!found) return null;
    return {
      id: rev.sectionId,
      title: found.section.title,
      path: found.path,
      blocks: rev.after,
      rev: rev.rev,
      saved: { note: rev.note, byName: rev.byName, at: rev.at.toISOString() },
      locked: lockedPreviews(found.section.blocks, figureBase(d, rev.sectionId)),
      version: rev.version,
    };
  }

  private sameBatch(d: Draft, batchId: string | undefined) {
    if (batchId !== undefined && batchId !== d.batch.id) {
      throw new ConflictException({ statusCode: 409, message: REGENERATED, reason: 'regenerated' });
    }
  }

  private sectionView(d: Draft, sectionId: string, edit: SectionEdit | undefined): SectionView {
    const found = findSection(d.doc, sectionId);
    if (!found) throw new NotFoundException('找不到这一节');
    return {
      id: sectionId,
      title: found.section.title,
      path: found.path,
      blocks: edit?.blocks ?? editableOf(found.section.blocks),
      rev: edit?.rev ?? 0,
      saved: edit ? { note: edit.note, byName: edit.byName, at: edit.at } : null,
      locked: lockedPreviews(found.section.blocks, figureBase(d, sectionId)),
    };
  }

  private async edits(batchId: string, kind: DraftKind) {
    const [row] = await this.db
      .select()
      .from(draftEdits)
      .where(and(eq(draftEdits.batchId, batchId), eq(draftEdits.kind, kind)))
      .limit(1);
    return row;
  }

  // 最近一批里这一份草稿；负责专家和运营能看，其他人一律当作不存在
  private async draft(user: SessionUser, taskId: string, kind: string): Promise<Draft> {
    const [task] = await this.db
      .select({ id: tasks.id, assignedExpertId: tasks.assignedExpertId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task || !canViewTaskWork(user, task)) throw new NotFoundException(NOT_FOUND);
    if (!DRAFT_KIND_KEYS.includes(kind as DraftKind)) throw new NotFoundException('找不到这份文档');
    const k = kind as DraftKind;
    const [batch] = await this.db
      .select()
      .from(generationBatches)
      .where(eq(generationBatches.taskId, task.id))
      .orderBy(desc(generationBatches.createdAt))
      .limit(1);
    if (!batch) throw new BadRequestException('还没有生成草稿，请先确认采用资料并生成');
    return { task, batch, ...(await this.load(batch.id, k)) };
  }

  // 这批草稿里一份的文档结构（生成时存下的 JSON）
  private async load(batchId: string, k: DraftKind): Promise<Pick<Draft, 'kind' | 'notes' | 'doc'>> {
    const [row] = await this.db
      .select({ status: generatedDrafts.status, notes: generatedDrafts.notes, storageKey: files.storageKey, fileId: files.id })
      .from(generatedDrafts)
      .leftJoin(files, eq(files.id, generatedDrafts.documentFileId))
      .where(and(eq(generatedDrafts.batchId, batchId), eq(generatedDrafts.kind, k)))
      .limit(1);
    if (!row || row.status !== 'done') throw new BadRequestException(`${DRAFT_KINDS[k]}还没有生成完，生成完才能编辑正文`);
    if (!row.storageKey || !row.fileId) {
      throw new BadRequestException(`这份${DRAFT_KINDS[k]}是在正文编辑上线前生成的，请回到专业整理重新确认生成后再编辑`);
    }
    let doc = this.cache.get(row.fileId);
    if (!doc) {
      doc = parseDocument(await this.storage.read(row.storageKey));
      this.cache.set(row.fileId, doc);
      if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    }
    const notes = (row.notes ?? []).map((n) => ({ plan: n.plan, label: n.label, source: n.source, note: n.note }));
    return { kind: k, notes, doc };
  }
}

// 图的缩略图地址：页面单独加载，不放进节的内容里（保存、冲突、重试查询的回应都只带地址）。
// 带上批次，重新生成后地址就变
function figureBase(d: Draft, sectionId: string) {
  return { base: `/api/tasks/${d.task.id}/drafts/${d.kind}/sections/${encodeURIComponent(sectionId)}/figures`, batch: d.batch.id };
}

// 锁定的表格和图的只读内容：表格给表头和各行，图给缩略图地址
function lockedPreviews(blocks: DeliveryDocument['sections'][number]['blocks'], fig: { base: string; batch: string }): LockedPreview[] {
  return blocks.flatMap((b, index): LockedPreview[] => {
    if (b.type === 'table') return [{ index, kind: 'table', header: b.header, rows: b.rows }];
    if (b.type === 'figure') return [{ index, kind: 'figure', src: `${fig.base}/${index}?b=${fig.batch}` }];
    return [];
  });
}

// 长边缩到 480 的 JPEG（同图纸缩略图）；比原图还小的不放大
async function thumbnail(png: Uint8Array): Promise<Buffer> {
  const image = await loadImage(Buffer.from(png));
  const ratio = Math.min(1, THUMB_SIDE / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * ratio));
  const h = Math.max(1, Math.round(image.height * ratio));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  return canvas.encode('jpeg', 80);
}

// 资料里的人名，发给 AI 前遮掉：法定代表人、资料联系人、主要负责人，应急组织里的总指挥、副总指挥、
// 各组组长和成员，编制小组成员。小组名称（「通讯联络组」等）不是人名，不遮
export function peopleOf(input: PlanInput): string[] {
  const b = input.basic;
  const o = input.organization;
  const names = [
    b.legalRepresentative,
    b.contactPerson,
    b.responsiblePerson,
    o.commander?.name,
    ...o.deputies.map((p) => p.name),
    ...o.groups.flatMap((g) => [g.leader?.name, ...g.members.map((m) => m.name)]),
    o.compilationTeam?.leader?.name,
    ...(o.compilationTeam?.members ?? []).map((m) => m.name),
  ];
  return [...new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))];
}

@Controller('tasks/:id/drafts/:kind')
export class EditingController {
  constructor(@Inject(EditingService) private readonly service: EditingService) {}

  @Get('edit')
  document(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) {
    return this.service.document(user, id, kind);
  }

  @Get('sections/:sectionId')
  section(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Param('sectionId') sectionId: string) {
    return this.service.section(user, id, kind, sectionId);
  }

  @Put('sections/:sectionId')
  save(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
  ) {
    return this.service.save(user, id, kind, sectionId, body);
  }

  @Post('sections/:sectionId/rewrite')
  rewrite(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
  ) {
    return this.service.rewrite(user, id, kind, sectionId, body);
  }

  @Get('saves/:saveId')
  saveStatus(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('saveId', ParseUUIDPipe) saveId: string,
    @Query('batch') batch?: string,
  ) {
    return this.service.saveStatus(user, id, kind, saveId, batch || undefined);
  }

  @Get('sections/:sectionId/figures/:index')
  async figure(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('sectionId') sectionId: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    const data = await this.service.figure(user, id, kind, sectionId, index);
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(data);
  }

  @Get('word')
  async word(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Res() res: Response) {
    const { name, data } = await this.service.word(user, id, kind);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(data);
  }
}

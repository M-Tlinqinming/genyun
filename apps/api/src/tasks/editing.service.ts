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
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { canEditTaskWork, canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { draftEdits, draftRevisions, files, generatedDrafts, generationBatches, tasks } from '../db/schema.ts';
import { FILE_STORAGE, type FileStorage } from '../files/storage.ts';
import type { ParagraphPolisher } from '../generation/ai/drafter.ts';
import { polishParagraph } from '../generation/ai/polish.ts';
import { riskFacts } from '../generation/ai/risk.ts';
import { parseDocument } from '../generation/document-json.ts';
import { renderWord } from '../generation/word/render.ts';

export const EDIT_DRAFTER = Symbol('EDIT_DRAFTER');

const NOT_FOUND = '找不到该任务';
const STALE = '本节已被更新：其他人刚保存了新的版本，直接保存会覆盖。请对照最新保存稿后再保存';

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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(EDIT_DRAFTER) private readonly drafter: ParagraphPolisher | null,
  ) {}

  async document(user: SessionUser, taskId: string, kind: string): Promise<EditDocumentView> {
    const d = await this.draft(user, taskId, kind);
    const edits = await this.edits(d.batch.id, d.kind);
    return {
      batchId: d.batch.id,
      kind: d.kind,
      version: edits?.version ?? 0,
      outline: outlineOf(d.doc, edits?.sections ?? {}),
      editable: canEditTaskWork(user, d.task),
      rewrite: this.drafter !== null,
      notes: d.notes,
    };
  }

  async section(user: SessionUser, taskId: string, kind: string, sectionId: string): Promise<SectionView> {
    const d = await this.draft(user, taskId, kind);
    const edits = await this.edits(d.batch.id, d.kind);
    return this.sectionView(d.doc, sectionId, edits?.sections[sectionId]);
  }

  async save(user: SessionUser, taskId: string, kind: string, sectionId: string, body: unknown): Promise<SectionView & { version: number }> {
    const d = await this.draft(user, taskId, kind);
    if (!canEditTaskWork(user, d.task)) throw new ForbiddenException('只有负责专家可以修改正文');
    const parsed = sectionSaveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '内容不正确');
    const { saveId, baseRev, blocks, note } = parsed.data;
    const found = findSection(d.doc, sectionId);
    if (!found) throw new NotFoundException('找不到这一节');

    // 同一次保存的重试：已经记过就直接返回结果
    const replay = await this.replayed(d, saveId);
    if (replay) return replay;

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
        const current = row!.sections[sectionId];
        const rev = current?.rev ?? 0;
        if (rev !== baseRev) {
          throw new ConflictException({ statusCode: 409, message: STALE, reason: 'stale', latest: this.sectionView(d.doc, sectionId, current) });
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
          before: current?.blocks ?? original,
          after: clean,
          rev: entry.rev,
          version,
          createdBy: user.id,
        });
        return version;
      });
      const edits = await this.edits(d.batch.id, d.kind);
      return { ...this.sectionView(d.doc, sectionId, edits?.sections[sectionId]), version };
    } catch (err) {
      // 同一次保存的两个请求同时到：后到的那个按已保存返回
      if (isUniqueViolation(err, 'draft_revisions_save_id_unique')) {
        const again = await this.replayed(d, saveId);
        if (again) return again;
      }
      throw err;
    }
  }

  // 保存结果不确定（断网、超时）时页面先查这一次保存有没有记上，再决定要不要重试
  async saveStatus(user: SessionUser, taskId: string, kind: string, saveId: string): Promise<{ saved: false } | { saved: true; section: SectionView }> {
    const d = await this.draft(user, taskId, kind);
    const replay = await this.replayed(d, saveId);
    return replay ? { saved: true, section: replay } : { saved: false };
  }

  async rewrite(user: SessionUser, taskId: string, kind: string, sectionId: string, body: unknown): Promise<RewriteResult> {
    const d = await this.draft(user, taskId, kind);
    if (!canEditTaskWork(user, d.task)) throw new ForbiddenException('只有负责专家可以使用 AI 改写');
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
        people: namesIn(input.organization),
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

  private async replayed(d: Draft, saveId: string): Promise<(SectionView & { version: number }) | null> {
    const [rev] = await this.db
      .select({ sectionId: draftRevisions.sectionId })
      .from(draftRevisions)
      .where(and(eq(draftRevisions.saveId, saveId), eq(draftRevisions.batchId, d.batch.id), eq(draftRevisions.kind, d.kind)))
      .limit(1);
    if (!rev) return null;
    const edits = await this.edits(d.batch.id, d.kind);
    return { ...this.sectionView(d.doc, rev.sectionId, edits?.sections[rev.sectionId]), version: edits?.version ?? 0 };
  }

  private sectionView(doc: DeliveryDocument, sectionId: string, edit: SectionEdit | undefined): SectionView {
    const found = findSection(doc, sectionId);
    if (!found) throw new NotFoundException('找不到这一节');
    return {
      id: sectionId,
      title: found.section.title,
      path: found.path,
      blocks: edit?.blocks ?? editableOf(found.section.blocks),
      rev: edit?.rev ?? 0,
      saved: edit ? { note: edit.note, byName: edit.byName, at: edit.at } : null,
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
    const [row] = await this.db
      .select({ status: generatedDrafts.status, notes: generatedDrafts.notes, storageKey: files.storageKey, fileId: files.id })
      .from(generatedDrafts)
      .leftJoin(files, eq(files.id, generatedDrafts.documentFileId))
      .where(and(eq(generatedDrafts.batchId, batch.id), eq(generatedDrafts.kind, k)))
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
    return { task, batch, kind: k, notes, doc };
  }
}

// 组织机构里的人名（总指挥、副总指挥、各小组成员……），发给 AI 前遮掉
function namesIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => namesIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'name' && typeof v === 'string' && v.trim()) out.push(v.trim());
      else namesIn(v, out);
    }
  }
  return out;
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
  saveStatus(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Param('saveId', ParseUUIDPipe) saveId: string) {
    return this.service.saveStatus(user, id, kind, saveId);
  }

  @Get('word')
  async word(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Res() res: Response) {
    const { name, data } = await this.service.word(user, id, kind);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(data);
  }
}

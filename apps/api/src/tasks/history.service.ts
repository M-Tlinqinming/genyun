// 处理记录（14 页 E18-13）：这个任务里谁在什么时候做了什么。不另建表，从现有的表拼出来，新的在前。
// 每个来源一个小函数；以后资料核对每一步确认、代客户上传、重新打开这些事加在这里。
// 只记改内容的操作；打开、切页签、看预览不记。核对、审核结论每份只留最后一次，所以只能记最后一次。
import { DRAFT_KIND_KEYS, DRAFT_KINDS, pendingCount, type DraftKind, type HistoryEntry } from '@genyun/shared';
import { Controller, Get, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { canViewTaskWork } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import {
  deliveries,
  draftChecks,
  draftEdits,
  draftReviews,
  draftRevisions,
  generatedDrafts,
  generationBatches,
  taskIntakeSubmissions,
  tasks,
  taskSubmissions,
  users,
} from '../db/schema.ts';
import { EditingService } from './editing.service.ts';

type Entry = Omit<HistoryEntry, 'at'> & { at: Date };
type Batch = { id: string; createdAt: Date; byName: string };

const entry = (at: Date, who: string | null, what: string, extra: string | null = null, check = false): Entry => ({ at, who, what, extra, check });

@Injectable()
export class HistoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EditingService) private readonly editing: EditingService,
  ) {}

  async list(user: SessionUser, taskId: string): Promise<HistoryEntry[]> {
    const [task] = await this.db.select({ id: tasks.id, assignedExpertId: tasks.assignedExpertId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task || !canViewTaskWork(user, task)) throw new NotFoundException('找不到该任务');
    const batches = await this.db
      .select({ id: generationBatches.id, createdAt: generationBatches.createdAt, byName: users.name })
      .from(generationBatches)
      .innerJoin(users, eq(users.id, generationBatches.createdBy))
      .where(eq(generationBatches.taskId, taskId))
      .orderBy(asc(generationBatches.createdAt));
    const ids = batches.map((b) => b.id);
    const parts = await Promise.all([
      this.submissions(taskId),
      this.generations(batches),
      ids.length ? this.drafts(batches) : [],
      ids.length ? this.saves(ids) : [],
      ids.length ? this.checks(ids) : [],
      ids.length ? this.reviews(ids) : [],
      this.deliveries(taskId),
    ]);
    // 新的在前；同一时刻按来源顺序倒过来（后发生的事排前面）
    const all = parts.flat().map((e, i) => ({ e, i }));
    all.sort((a, b) => b.e.at.getTime() - a.e.at.getTime() || b.i - a.i);
    return all.map(({ e }) => ({ ...e, at: e.at.toISOString() }));
  }

  /** 客户提交资料：新流程上传 Excel 模板；旧任务按清单提交 */
  private async submissions(taskId: string): Promise<Entry[]> {
    const [intake, old] = await Promise.all([
      this.db
        .select({ at: taskIntakeSubmissions.submittedAt, name: users.name })
        .from(taskIntakeSubmissions)
        .innerJoin(users, eq(users.id, taskIntakeSubmissions.submittedBy))
        .where(eq(taskIntakeSubmissions.taskId, taskId)),
      this.db
        .select({ at: taskSubmissions.submittedAt, name: users.name })
        .from(taskSubmissions)
        .innerJoin(users, eq(users.id, taskSubmissions.submittedBy))
        .where(eq(taskSubmissions.taskId, taskId)),
    ]);
    return [
      ...intake.map((r) => entry(r.at, null, '客户提交资料', `${r.name}上传 Excel 模板`)),
      ...old.map((r) => entry(r.at, null, '客户提交资料', `${r.name}提交`)),
    ];
  }

  /** 专家确认资料开始生成；同一任务第二次起是重新生成 */
  private generations(batches: Batch[]): Entry[] {
    return batches.map((b, i) => entry(b.createdAt, b.byName, i === 0 ? '确认资料，开始生成' : '重新生成'));
  }

  /** 三份都生成完、某一份生成失败 */
  private async drafts(batches: Batch[]): Promise<Entry[]> {
    const rows = await this.db
      .select({ batchId: generatedDrafts.batchId, kind: generatedDrafts.kind, status: generatedDrafts.status, finishedAt: generatedDrafts.finishedAt })
      .from(generatedDrafts)
      .where(inArray(generatedDrafts.batchId, batches.map((b) => b.id)));
    return batches.flatMap((b): Entry[] => {
      const mine = rows.filter((r) => r.batchId === b.id);
      const failed = mine.filter((r) => r.status === 'failed').map((r) => entry(r.finishedAt ?? b.createdAt, null, `「${DRAFT_KINDS[r.kind]}」生成失败`));
      const done = mine.filter((r) => r.status === 'done' && r.finishedAt);
      if (done.length < DRAFT_KIND_KEYS.length) return failed;
      const at = new Date(Math.max(...done.map((r) => r.finishedAt!.getTime())));
      const minutes = Math.max(1, Math.round((at.getTime() - b.createdAt.getTime()) / 60_000));
      return [...failed, entry(at, null, '三份初稿生成完成', `用时 ${minutes} 分钟`)];
    });
  }

  /** 每次保存一节 */
  private async saves(batchIds: string[]): Promise<Entry[]> {
    const rows = await this.db
      .select({ at: draftRevisions.createdAt, kind: draftRevisions.kind, title: draftRevisions.sectionTitle, note: draftRevisions.note, name: users.name })
      .from(draftRevisions)
      .innerJoin(users, eq(users.id, draftRevisions.createdBy))
      .where(inArray(draftRevisions.batchId, batchIds));
    return rows.map((r) => entry(r.at, r.name, `保存「${DRAFT_KINDS[r.kind]} · ${r.title}」`, r.note.trim() || null));
  }

  /** 每一份核对完成（每份只留最后一次）：还有效时写待补充情况，核对后又改过写要重新核对 */
  private async checks(batchIds: string[]): Promise<Entry[]> {
    const rows = await this.db
      .select({
        batchId: draftChecks.batchId,
        kind: draftChecks.kind,
        version: draftChecks.version,
        at: draftChecks.checkedAt,
        name: users.name,
        current: draftEdits.version,
      })
      .from(draftChecks)
      .innerJoin(users, eq(users.id, draftChecks.checkedBy))
      .leftJoin(draftEdits, and(eq(draftEdits.batchId, draftChecks.batchId), eq(draftEdits.kind, draftChecks.kind)))
      .where(inArray(draftChecks.batchId, batchIds));
    // 待补充要把整份文稿盖上修改再数，较慢：同一批同一份只算一次
    const notes = new Map<string, Promise<string | null>>();
    const noteOf = (batchId: string, kind: DraftKind) => {
      const key = `${batchId}/${kind}`;
      let p = notes.get(key);
      if (!p) {
        p = this.pendingNote(batchId, kind);
        notes.set(key, p);
      }
      return p;
    };
    return Promise.all(
      rows.map(async (r) => {
        const what = `核对完成「${DRAFT_KINDS[r.kind]}」`;
        if ((r.current ?? 0) !== r.version) return entry(r.at, r.name, what, '之后又改过，要重新核对', true);
        return entry(r.at, r.name, what, await noteOf(r.batchId, r.kind), true);
      }),
    );
  }

  private async pendingNote(batchId: string, kind: DraftKind): Promise<string | null> {
    try {
      const n = pendingCount(await this.editing.batchPending(batchId, kind));
      return n === 0 ? '待补充全部处理' : `${n} 处待补充留空`;
    } catch {
      // 正文编辑上线前生成的稿没有文档结构，数不出来
      return null;
    }
  }

  /** 写审核结论（只留最后一次） */
  private async reviews(batchIds: string[]): Promise<Entry[]> {
    const rows = await this.db
      .select({ at: draftReviews.reviewedAt, note: draftReviews.note, name: users.name })
      .from(draftReviews)
      .innerJoin(users, eq(users.id, draftReviews.reviewedBy))
      .where(inArray(draftReviews.batchId, batchIds));
    return rows.map((r) => entry(r.at, r.name, '写审核结论', r.note.trim().slice(0, 40) || null));
  }

  /** 定稿并交付（只取成功的） */
  private async deliveries(taskId: string): Promise<Entry[]> {
    const rows = await this.db
      .select({ at: deliveries.publishedAt, updated: deliveries.updatedAt, name: users.name })
      .from(deliveries)
      .innerJoin(users, eq(users.id, deliveries.publishedBy))
      .where(and(eq(deliveries.taskId, taskId), eq(deliveries.status, 'done')));
    return rows.map((r) => entry(r.at ?? r.updated, r.name, '定稿并交付'));
  }
}

@Controller('tasks/:id')
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly service: HistoryService) {}

  @Get('history')
  list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.list(user, id);
  }
}

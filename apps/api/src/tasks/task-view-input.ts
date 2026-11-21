// 从数据库拼三端状态函数 taskView 的输入（packages/shared/src/task-status.ts）。
// 专家任务中心先用，运营任务中心、客户任务列表之后也用这一个：按表各查一次，不逐个任务查。
import { workupStepsDone, type TaskDraftState, type TaskViewInput } from '@genyun/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  deliveries,
  draftEdits,
  generatedDrafts,
  generationBatches,
  taskIntakeFiles,
  taskIntakes,
  taskIntakeSubmissions,
  tasks,
  taskWorkups,
} from '../db/schema.ts';

/** taskView 的输入去掉 now、viewer，另加分配时间和「最近更新」 */
export type TaskViewFacts = Omit<TaskViewInput, 'now' | 'viewer'> & {
  /** 现在这位负责专家接手的时间 */
  assignedAt: Date | null;
  /** 最近更新：任务、资料核对、最新一批生成、改稿、资料上传里最晚的时间 */
  activityAt: Date;
  /** 客户最近一次动资料：上传、移除资料表格或图纸，撤回提交；都没有为 null */
  materialChangedAt: Date | null;
};

const latest = (dates: readonly (Date | null | undefined)[]): Date | null => {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d;
  return best;
};

export async function loadTaskViewInputs(db: Database, taskIds: readonly string[]): Promise<Map<string, TaskViewFacts>> {
  const result = new Map<string, TaskViewFacts>();
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return result;

  const [taskRows, intakes, submissions, workups, batches, deliveryRows, files] = await Promise.all([
    db
      .select({
        id: tasks.id,
        status: tasks.status,
        deletedAt: tasks.deletedAt,
        submittedAt: tasks.submittedAt,
        assignedExpertId: tasks.assignedExpertId,
        assignedAt: tasks.assignedAt,
        awaitingCustomerSince: tasks.awaitingCustomerSince,
        awaitingCustomerItems: tasks.awaitingCustomerItems,
        reopenedAt: tasks.reopenedAt,
        chargeStatus: tasks.chargeStatus,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(inArray(tasks.id, ids)),
    db
      .select({ taskId: taskIntakes.taskId, dataSheetFileId: taskIntakes.dataSheetFileId, requiredCheck: taskIntakes.requiredCheck })
      .from(taskIntakes)
      .where(inArray(taskIntakes.taskId, ids)),
    db
      .select({
        taskId: taskIntakeSubmissions.taskId,
        submittedAt: taskIntakeSubmissions.submittedAt,
        withdrawnAt: taskIntakeSubmissions.withdrawnAt,
      })
      .from(taskIntakeSubmissions)
      .where(inArray(taskIntakeSubmissions.taskId, ids)),
    db
      .select({ taskId: taskWorkups.taskId, snapshotAt: taskWorkups.snapshotAt, data: taskWorkups.data, updatedAt: taskWorkups.updatedAt })
      .from(taskWorkups)
      .where(inArray(taskWorkups.taskId, ids)),
    db
      .select({ id: generationBatches.id, taskId: generationBatches.taskId, createdAt: generationBatches.createdAt })
      .from(generationBatches)
      .where(inArray(generationBatches.taskId, ids)),
    db
      .select({ taskId: deliveries.taskId, publishedAt: deliveries.publishedAt })
      .from(deliveries)
      .where(and(inArray(deliveries.taskId, ids), eq(deliveries.status, 'done'))),
    db
      .select({ taskId: taskIntakeFiles.taskId, slot: taskIntakeFiles.slot, uploadedAt: taskIntakeFiles.uploadedAt, removedAt: taskIntakeFiles.removedAt })
      .from(taskIntakeFiles)
      .where(inArray(taskIntakeFiles.taskId, ids)),
  ]);

  // 每个任务最新一批生成（按创建时间）
  const latestBatch = new Map<string, { id: string; createdAt: Date }>();
  for (const b of batches) {
    const cur = latestBatch.get(b.taskId);
    if (!cur || b.createdAt.getTime() > cur.createdAt.getTime()) latestBatch.set(b.taskId, b);
  }
  const batchIds = [...latestBatch.values()].map((b) => b.id);
  const [drafts, edits] =
    batchIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ batchId: generatedDrafts.batchId, status: generatedDrafts.status, finishedAt: generatedDrafts.finishedAt })
            .from(generatedDrafts)
            .where(inArray(generatedDrafts.batchId, batchIds)),
          db
            .select({ batchId: draftEdits.batchId, updatedAt: draftEdits.updatedAt })
            .from(draftEdits)
            .where(inArray(draftEdits.batchId, batchIds)),
        ]);

  const group = <T extends Record<K, string>, K extends string>(rows: readonly T[], key: K) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r[key]);
      if (list) list.push(r);
      else m.set(r[key], [r]);
    }
    return m;
  };
  const intakeOf = new Map(intakes.map((i) => [i.taskId, i]));
  const workupOf = new Map(workups.map((w) => [w.taskId, w]));
  const submissionsOf = group(submissions, 'taskId');
  const deliveriesOf = group(deliveryRows, 'taskId');
  const filesOf = group(files, 'taskId');
  const draftsOf = group(drafts, 'batchId');
  const editsOf = group(edits, 'batchId');

  for (const t of taskRows) {
    const intake = intakeOf.get(t.id);
    const workup = workupOf.get(t.id);
    const subs = submissionsOf.get(t.id) ?? [];
    const activeSubmission = subs.find((s) => !s.withdrawnAt);

    const batch = latestBatch.get(t.id);
    const batchDrafts = batch ? (draftsOf.get(batch.id) ?? []) : [];
    let draft: TaskDraftState = 'none';
    if (batch) {
      if (batchDrafts.some((d) => d.status === 'queued' || d.status === 'running')) draft = 'generating';
      else if (batchDrafts.some((d) => d.status === 'failed')) draft = 'failed';
      else draft = 'ready';
    }

    const done = (deliveriesOf.get(t.id) ?? []).filter((d) => d.publishedAt);
    const lastAt = latest(done.map((d) => d.publishedAt));
    const lastDelivery = lastAt ? { at: lastAt, kind: done.length > 1 ? ('update' as const) : ('first' as const) } : null;

    const liveFiles = (filesOf.get(t.id) ?? []).filter((f) => !f.removedAt);
    const table = liveFiles.filter((f) => f.slot === 'data_sheet').length;

    result.set(t.id, {
      flow: intake ? 'intake' : 'legacy',
      status: t.status,
      deletedAt: t.deletedAt,
      tableUploaded: !!intake?.dataSheetFileId,
      missingCount: intake?.requiredCheck?.missing.length ?? 0,
      submittedAt: activeSubmission?.submittedAt ?? t.submittedAt,
      withdrawnBefore: subs.some((s) => !!s.withdrawnAt),
      assignedExpertId: t.assignedExpertId,
      snapshotAt: workup?.snapshotAt ?? null,
      workupStepsDone: workupStepsDone(workup?.data),
      awaitingCustomerSince: t.awaitingCustomerSince,
      awaitingCustomerItems: t.awaitingCustomerItems,
      draft,
      lastDelivery,
      reopenedAt: t.reopenedAt,
      chargeStatus: t.chargeStatus,
      fileCounts: { table, others: liveFiles.length - table },
      assignedAt: t.assignedAt,
      activityAt:
        latest([
          t.updatedAt,
          workup?.updatedAt,
          batch?.createdAt,
          ...batchDrafts.map((d) => d.finishedAt),
          ...(batch ? (editsOf.get(batch.id) ?? []) : []).map((e) => e.updatedAt),
          ...(filesOf.get(t.id) ?? []).map((f) => f.uploadedAt),
        ]) ?? t.updatedAt,
      materialChangedAt: latest([
        ...(filesOf.get(t.id) ?? []).flatMap((f) => [f.uploadedAt, f.removedAt]),
        ...subs.map((s) => s.withdrawnAt),
      ]),
    });
  }
  return result;
}

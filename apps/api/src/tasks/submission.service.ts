import {
  type DocumentVersionRef,
  type SubmitRequest,
  type SubmittedAnswer,
  type SubmittedDocument,
  CHECKLIST_ITEMS,
  describeDocumentChanges,
  pendingAfterSubmit,
  submissionFingerprint,
} from '@genyun/shared';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { canEditOrganizationData } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  files,
  taskDocuments,
  taskSubmissions,
  tasks,
  users,
} from '../db/schema.ts';
import { type TaskView, TasksService } from './tasks.service.ts';

// 提交生成申请（13 页 F01–F08）。提交前的确认框与「查询提交结果」读同一个接口：
// 已提交就返回提交记录，没提交就返回确认框要显示的资料版本与确认事项
@Injectable()
export class SubmissionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  async get(user: SessionUser, taskId: string) {
    const task = await this.tasks.load(user, taskId);
    const submitted = await this.find(taskId);
    if (submitted) return { submitted: true as const, submission: submitted };
    const current = await this.current(task);
    return {
      submitted: false as const,
      preview: {
        documents: current.documents,
        taskDocuments: current.taskDocuments.map(({ documentId, versionId }) => ({ documentId, versionId })),
        answers: current.answers,
        canSubmit: current.check.canSubmit,
        pendingCount: current.pendingKeys.length,
        fingerprint: current.fingerprint,
      },
    };
  }

  async submit(user: SessionUser, taskId: string, input: SubmitRequest) {
    const task = await this.tasks.load(user, taskId);
    if (!canEditOrganizationData(user, task.orgId)) throw new ForbiddenException('申请由客户提交');
    // 同一次提交重发（如断网后），或别人已经交了：都按已提交处理，不会再交一次
    const existing = await this.find(taskId);
    if (existing) return existing;
    if (task.startMethod === null) throw new BadRequestException('请先选择开始方式');

    const current = await this.current(task);
    if (!current.check.canSubmit) {
      throw new BadRequestException(`还有必需资料没处理：${current.check.blocking.map((b) => b.label).join('、')}`);
    }
    if (input.fingerprint !== current.fingerprint) {
      throw new ConflictException({
        statusCode: 409,
        code: 'materials_changed',
        message: '本任务的资料已更新，请重新检查',
        changes: await this.changesSince(input.documents, current.taskDocuments),
      });
    }

    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const [moved] = await tx
          .update(tasks)
          .set({ status: 'submitted', submittedAt: now, updatedAt: now })
          .where(and(eq(tasks.id, taskId), eq(tasks.status, 'preparing')))
          .returning({ id: tasks.id });
        // 同时到达的另一次请求已经提交
        if (!moved) return;
        await tx.insert(taskSubmissions).values({
          taskId,
          requestId: input.requestId,
          submittedBy: user.id,
          submittedAt: now,
          documents: current.documents,
          items: current.items,
          answers: current.answers,
          pendingKeys: current.pendingKeys,
        });
      });
    } catch (err) {
      if (
        !isUniqueViolation(err, 'task_submissions_request_id_unique') &&
        !isUniqueViolation(err, 'task_submissions_task_id_unique')
      ) {
        throw err;
      }
    }
    const saved = await this.find(taskId);
    if (!saved) throw new ConflictException('这次没有提交成功，请重试');
    return saved;
  }

  private async find(taskId: string) {
    const [row] = await this.db
      .select({
        submittedAt: taskSubmissions.submittedAt,
        submittedByName: users.name,
        documents: taskSubmissions.documents,
        items: taskSubmissions.items,
        answers: taskSubmissions.answers,
        pendingKeys: taskSubmissions.pendingKeys,
      })
      .from(taskSubmissions)
      .innerJoin(users, eq(users.id, taskSubmissions.submittedBy))
      .where(eq(taskSubmissions.taskId, taskId))
      .limit(1);
    return row;
  }

  // 现在的资料：任务选用的资料版本、各项挂的文件、由客户确认的事项
  private async current(task: TaskView) {
    const { items, check } = await this.tasks.checklistResult(task.id);

    const taskDocs = await this.db
      .select({
        documentId: taskDocuments.documentId,
        versionId: taskDocuments.versionId,
        fileId: enterpriseDocumentVersions.fileId,
        name: enterpriseDocuments.name,
        version: enterpriseDocumentVersions.version,
      })
      .from(taskDocuments)
      .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, taskDocuments.documentId))
      .innerJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.id, taskDocuments.versionId))
      .where(eq(taskDocuments.taskId, task.id))
      .orderBy(asc(taskDocuments.linkedAt));

    // 自填路线的文件只挂在资料项上；资料库里有的带上版本
    const listed = new Set(taskDocs.map((d) => d.fileId));
    const itemFileIds = [...new Set(Object.values(items).flatMap((s) => s?.fileIds ?? []))].filter((f) => !listed.has(f));
    const itemFiles = itemFileIds.length
      ? await this.db
          .select({ fileId: files.id, original: files.originalName, name: enterpriseDocuments.name, version: enterpriseDocumentVersions.version })
          .from(files)
          .leftJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.fileId, files.id))
          .leftJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
          .where(inArray(files.id, itemFileIds))
      : [];
    const documents: SubmittedDocument[] = [
      ...taskDocs.map((d) => ({ fileId: d.fileId, name: d.name, version: d.version })),
      ...itemFiles.map((f) => ({ fileId: f.fileId, name: f.name ?? f.original, version: f.version })),
    ];

    const answers: SubmittedAnswer[] = [];
    for (const def of CHECKLIST_ITEMS) {
      const s = items[def.key];
      if (!s) continue;
      if (s.callRequested) answers.push({ label: def.label, answer: '请专家电话联系' });
      else if (s.status === 'none') answers.push({ label: def.label, answer: '没有' });
      else if (s.status === 'provided' && s.note) answers.push({ label: def.label, answer: s.note });
    }
    const [ent] = await this.db
      .select({ profile: enterprises.profile })
      .from(enterprises)
      .where(eq(enterprises.id, task.enterpriseId))
      .limit(1);
    const production = ent?.profile.productionStep?.step;
    const yesNo = (v: boolean | undefined) => (v === undefined ? null : v ? '是' : '否');
    for (const [label, value] of [
      ['是否出租厂房', yesNo(production?.leasesPremises)],
      ['是否有道路运输', yesNo(production?.ownVehicles)],
    ] as const) {
      if (value) answers.push({ label, answer: value });
    }

    return {
      items,
      check,
      taskDocuments: taskDocs,
      documents,
      answers,
      pendingKeys: pendingAfterSubmit(items),
      fingerprint: submissionFingerprint(taskDocs, items),
    };
  }

  private async changesSince(confirmed: DocumentVersionRef[], current: (DocumentVersionRef & { name: string; version: number })[]) {
    const ids = confirmed.map((d) => d.versionId);
    const old = ids.length
      ? await this.db
          .select({ id: enterpriseDocumentVersions.id, version: enterpriseDocumentVersions.version })
          .from(enterpriseDocumentVersions)
          .where(inArray(enterpriseDocumentVersions.id, ids))
      : [];
    const versions = new Map(old.map((v) => [v.id, v.version]));
    const changes = describeDocumentChanges(confirmed, current, (id) => versions.get(id));
    return changes.length > 0 ? changes : ['有资料项的处理情况有变化'];
  }
}

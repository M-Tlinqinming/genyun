import { NotFoundException } from '@nestjs/common';
import { profileFileIdsOf } from '@genyun/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { canViewFile, needsFileEnterprises } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import type { Database } from '../db/client.ts';
import {
  checklistItemFiles,
  deliveries,
  deliveryFiles,
  enterpriseDocuments,
  enterpriseDocumentVersions,
  enterprises,
  factSupplements,
  files,
  tasks,
} from '../db/schema.ts';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// 文件挂在哪些企业上（M3 第 7 项）：资料项、企业资料库、补件回复、交付、企业档案（执照、照片、台账、图纸）里引用的。
// 只在判断成员能不能看、能不能引用时用；机构管理员、运营不需要查
export async function linkedEnterpriseIds(db: Database | Tx, orgId: string, fileIds: string[]): Promise<Map<string, string[]>> {
  if (fileIds.length === 0) return new Map();
  const out = new Map<string, Set<string>>(fileIds.map((id) => [id, new Set()]));
  const add = (rows: { fileId: string; enterpriseId: string }[]) => rows.forEach((r) => out.get(r.fileId)?.add(r.enterpriseId));
  add(
    await db
      .select({ fileId: checklistItemFiles.fileId, enterpriseId: tasks.enterpriseId })
      .from(checklistItemFiles)
      .innerJoin(tasks, eq(tasks.id, checklistItemFiles.taskId))
      .where(inArray(checklistItemFiles.fileId, fileIds)),
  );
  add(
    await db
      .select({ fileId: enterpriseDocumentVersions.fileId, enterpriseId: enterpriseDocuments.enterpriseId })
      .from(enterpriseDocumentVersions)
      .innerJoin(enterpriseDocuments, eq(enterpriseDocuments.id, enterpriseDocumentVersions.documentId))
      .where(inArray(enterpriseDocumentVersions.fileId, fileIds)),
  );
  add(
    await db
      .select({ fileId: deliveryFiles.fileId, enterpriseId: tasks.enterpriseId })
      .from(deliveryFiles)
      .innerJoin(deliveries, eq(deliveries.id, deliveryFiles.deliveryId))
      .innerJoin(tasks, eq(tasks.id, deliveries.taskId))
      .where(inArray(deliveryFiles.fileId, fileIds)),
  );
  const idArray = sql`array[${sql.join(
    fileIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  // 补件回复：response_file_ids 是文件 ID 数组，?| 判断含有其中任意一个
  const supplements = await db
    .select({ enterpriseId: tasks.enterpriseId, fileIds: factSupplements.responseFileIds })
    .from(factSupplements)
    .innerJoin(tasks, eq(tasks.id, factSupplements.taskId))
    .where(and(eq(tasks.orgId, orgId), sql`${factSupplements.responseFileIds} ?| ${idArray}`));
  for (const r of supplements) {
    for (const fileId of (r.fileIds as string[] | null) ?? []) out.get(fileId)?.add(r.enterpriseId);
  }
  // 企业档案：按字段取出引用的文件（profileFileIdsOf），不在整段内容里搜文本——
  // 不然成员在可见企业的地址、说明里写上别家企业的文件 ID，就能把那个文件「挂」过来。
  // 一个组织的企业不多（几十家），一次取出本组织的档案在内存里比对
  const profiles = await db
    .select({ enterpriseId: enterprises.id, profile: enterprises.profile })
    .from(enterprises)
    .where(eq(enterprises.orgId, orgId));
  for (const r of profiles) {
    for (const fileId of profileFileIdsOf(r.profile)) out.get(fileId)?.add(r.enterpriseId);
  }
  return new Map([...out].map(([id, set]) => [id, [...set]]));
}

// 引用文件（挂到资料项、企业资料、档案）前检查：成员只能引用自己上传的、或已挂在分配给自己的企业上的文件，
// 不能拿别家企业的文件 ID 挂到自己的企业上来查看。不满足的当作不存在
export async function assertFilesUsable(db: Database | Tx, user: SessionUser, orgId: string, fileIds: string[]): Promise<void> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0 || !needsFileEnterprises(user, orgId)) return;
  const rows = await db
    .select({ id: files.id, orgId: files.orgId, kind: files.kind, uploadedBy: files.uploadedBy })
    .from(files)
    .where(and(inArray(files.id, ids), eq(files.orgId, orgId)));
  const linked = await linkedEnterpriseIds(db, orgId, ids);
  for (const id of ids) {
    const f = rows.find((r) => r.id === id);
    if (!f || !canViewFile(user, f, { usedInMyAssignedTask: false, linkedEnterpriseIds: linked.get(id) ?? [] })) {
      throw new NotFoundException('找不到该文件');
    }
  }
}

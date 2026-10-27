import { fileRejectionReason, FILE_TYPES, detectFileType, UPLOAD_RULES, type UploadRule } from '@genyun/shared';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { canEditOrganizationData, canViewFile, canViewOrganization } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser, Public } from '../auth/session.guard.ts';
import { DATABASE, type Database } from '../db/client.ts';
import { checklistItemFiles, enterpriseDocumentVersions, files, taskDocuments, tasks } from '../db/schema.ts';
import { DOWNLOAD_TTL_SECONDS, FILE_STORAGE, type FileStorage, LocalDiskStorage } from './storage.ts';

const NOT_FOUND = '找不到该文件';

const columns = {
  id: files.id,
  orgId: files.orgId,
  kind: files.kind,
  originalName: files.originalName,
  contentType: files.contentType,
  sizeBytes: files.sizeBytes,
  createdAt: files.createdAt,
};

// 只接收一个文件，放在内存里校验后再写入存储
function receiveOne(req: Request, res: Response, maxBytes: number): Promise<Express.Multer.File | undefined> {
  const upload = multer({
    storage: multer.memoryStorage(),
    // 浏览器按 UTF-8 发送中文文件名
    defParamCharset: 'utf8',
    limits: { fileSize: maxBytes, files: 1 },
  }).single('file');
  return new Promise((ok, fail) => upload(req, res, (err: unknown) => (err ? fail(err) : ok(req.file))));
}

// 中文文件名按 RFC 5987 写入下载头，旧浏览器退回到 ASCII 名称
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller()
export class FilesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // 客户上传资料；rule 决定接受的格式（资料 / 仅图片与 PDF）。合同原件的上传入口在 M3
  @Post('orgs/:orgId/files')
  async upload(
    @CurrentUser() user: SessionUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('rule') ruleParam: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!canViewOrganization(user, orgId)) throw new NotFoundException('找不到该组织');
    if (!canEditOrganizationData(user, orgId)) throw new ForbiddenException('资料由客户自己上传');
    const rule = (ruleParam ?? 'material') as UploadRule;
    if (rule !== 'material' && rule !== 'image_or_pdf') throw new BadRequestException('不支持的上传类型');
    const { maxBytes } = UPLOAD_RULES[rule];

    let file: Express.Multer.File | undefined;
    try {
      file = await receiveOne(req, res, maxBytes);
    } catch (err) {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        throw new BadRequestException(`文件超过单个文件 ${maxBytes / 1024 / 1024} MB 限制。请压缩后重新选择`);
      }
      if (err instanceof MulterError) throw new BadRequestException('请一次上传一个文件');
      throw err;
    }
    if (!file) throw new BadRequestException('请选择要上传的文件');

    const name = file.originalname.trim().slice(0, 200) || '未命名文件';
    const reason = fileRejectionReason(rule, name, file.buffer);
    if (reason) throw new BadRequestException(reason);
    const type = detectFileType(file.buffer)!;

    const id = randomUUID();
    const storageKey = `${orgId}/${id}`;
    const contentType = FILE_TYPES[type].mime;
    await this.storage.put(storageKey, file.buffer, contentType);
    const [created] = await this.db
      .insert(files)
      .values({
        id,
        orgId,
        kind: 'customer_material',
        originalName: name,
        contentType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        storageKey,
        uploadedBy: user.id,
      })
      .returning(columns);
    return created;
  }

  // 要放在 files/:id 之前，否则会被当作文件 ID 匹配。
  // 本机存储的下载地址：不需要登录，凭链接里的签名和有效期下载（对象存储环境不经过这里）
  @Public()
  @Get('files/blob')
  async blob(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const signed = this.storage instanceof LocalDiskStorage ? this.storage.verify(query) : null;
    if (!signed) throw new ForbiddenException('下载链接无效或已过期，请回到页面重新下载');
    const data = await (this.storage as LocalDiskStorage).read(signed.key);
    res.set({
      'Content-Type': signed.contentType,
      'Content-Disposition': contentDisposition(signed.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  }

  @Get('files/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const { storageKey: _, ...file } = await this.load(user, id);
    return file;
  }

  @Get('files/:id/download-url')
  async downloadUrl(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.load(user, id);
    const url = await this.storage.downloadUrl(file.storageKey, {
      filename: file.originalName,
      contentType: file.contentType,
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString() };
  }

  // 无权访问与不存在返回同样的结果，不暴露别家文件是否存在
  private async load(user: SessionUser, id: string) {
    const [file] = await this.db
      .select({ ...columns, storageKey: files.storageKey })
      .from(files)
      .where(eq(files.id, id))
      .limit(1);
    if (!file) throw new NotFoundException(NOT_FOUND);
    if (!canViewFile(user, file, await this.usedInAssignedTask(user, id))) throw new NotFoundException(NOT_FOUND);
    return file;
  }

  private async usedInAssignedTask(user: SessionUser, fileId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ taskId: checklistItemFiles.taskId })
      .from(checklistItemFiles)
      .innerJoin(tasks, eq(tasks.id, checklistItemFiles.taskId))
      .where(and(eq(checklistItemFiles.fileId, fileId), eq(tasks.assignedExpertId, user.id)))
      .limit(1);
    if (row) return true;
    // 任务关联的企业原始资料
    const [doc] = await this.db
      .select({ taskId: taskDocuments.taskId })
      .from(taskDocuments)
      .innerJoin(enterpriseDocumentVersions, eq(enterpriseDocumentVersions.id, taskDocuments.versionId))
      .innerJoin(tasks, eq(tasks.id, taskDocuments.taskId))
      .where(and(eq(enterpriseDocumentVersions.fileId, fileId), eq(tasks.assignedExpertId, user.id)))
      .limit(1);
    return doc !== undefined;
  }
}

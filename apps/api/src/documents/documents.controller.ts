import { checklistFileLinkSchema, taskDocumentSelectionSchema } from '@genyun/shared';
import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { DocumentsService } from './documents.service.ts';

// 任务关联的企业原始资料（12 页 P03、P04）
@Controller('tasks/:id/documents')
export class TaskDocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.listForTask(user, id);
  }

  @Post()
  add(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = checklistFileLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择文件');
    return this.documents.addToTask(user, id, parsed.data.fileId);
  }

  // 从企业资料中选用并确认版本（12 页 P03B）
  @Put()
  select(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = taskDocumentSelectionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查所选资料');
    return this.documents.selectForTask(user, id, parsed.data);
  }

  @Delete(':documentId')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.removeFromTask(user, id, documentId);
  }
}

function fileIdOf(body: unknown): string {
  const parsed = checklistFileLinkSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请选择文件');
  return parsed.data.fileId;
}

// 企业资料库（11 页 C03 企业资料）
@Controller('enterprises/:id/documents')
export class EnterpriseDocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.listForEnterprise(user, id);
  }

  @Post()
  upload(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.documents.upload(user, id, fileIdOf(body));
  }

  @Get(':documentId')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.detail(user, id, documentId);
  }

  @Post(':documentId/versions')
  addVersion(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.addVersion(user, id, documentId, fileIdOf(body));
  }
}

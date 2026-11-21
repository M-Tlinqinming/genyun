import { INTAKE_FILE_SLOTS, type IntakeFileSlot } from '@genyun/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { contentDisposition, receiveOne } from '../files/files.controller.ts';
import { IntakeService, intakeMaxBytes } from './intake.service.ts';
import { TEMPLATE_DOWNLOAD_NAME, TEMPLATE_PATH } from './template.ts';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const noEvacuationSchema = z.object({ value: z.boolean() });
const submitSchema = z.object({ requestId: z.string().uuid() });

@Controller()
export class IntakeController {
  constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

  // 资料模板：登录用户都能下，文件原样给
  @Get('intake/template')
  async template(@Res() res: Response) {
    const data = await readFile(TEMPLATE_PATH);
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': contentDisposition(TEMPLATE_DOWNLOAD_NAME),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  }

  @Get('tasks/:taskId/intake')
  get(@CurrentUser() user: SessionUser, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.intake.get(user, taskId);
  }

  // 一次一个文件；slot 决定放在哪一格、接受什么格式
  @Post('tasks/:taskId/intake/files')
  async upload(
    @CurrentUser() user: SessionUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query('slot') slotParam: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(INTAKE_FILE_SLOTS as readonly string[]).includes(slotParam ?? '')) throw new BadRequestException('不支持的上传位置');
    const slot = slotParam as IntakeFileSlot;
    // 先查权限再收文件，看不了、不能改的不读请求体
    await this.intake.assertWritable(user, taskId);
    const maxBytes = intakeMaxBytes(slot);
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
    return this.intake.upload(user, taskId, slot, file);
  }

  @Delete('tasks/:taskId/intake/files/:id')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.remove(user, taskId, id);
  }

  @Put('tasks/:taskId/intake/no-evacuation-map')
  noEvacuationMap(@CurrentUser() user: SessionUser, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: unknown) {
    const parsed = noEvacuationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('请检查输入');
    return this.intake.setNoEvacuationMap(user, taskId, parsed.data.value);
  }

  // 提交给专家：requestId 由页面每次打开确认弹窗生成，重发只记一次
  @Post('tasks/:taskId/intake/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: SessionUser, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: unknown) {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('请检查输入');
    return this.intake.submit(user, taskId, parsed.data.requestId);
  }

  // 撤回提交：专家开始核对之前、只能一次
  @Post('tasks/:taskId/intake/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: SessionUser, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.intake.withdraw(user, taskId);
  }

  // 删除任务：只有新流程、还没提交给专家的
  @Delete('tasks/:taskId')
  @HttpCode(204)
  async deleteTask(@CurrentUser() user: SessionUser, @Param('taskId', ParseUUIDPipe) taskId: string) {
    await this.intake.deleteTask(user, taskId);
  }
}

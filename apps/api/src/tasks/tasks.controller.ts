import { checklistItemUpdateSchema, taskCreateSchema, taskUpdateSchema } from '@genyun/shared';
import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { TasksService } from './tasks.service.ts';

type Schema<T> = {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
};

function parse<T>(schema: Schema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '请检查输入');
  return parsed.data;
}

@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get('orgs/:orgId/tasks')
  list(@CurrentUser() user: SessionUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.tasks.listForOrg(user, orgId);
  }

  @Post('enterprises/:enterpriseId/tasks')
  create(
    @CurrentUser() user: SessionUser,
    @Param('enterpriseId', ParseUUIDPipe) enterpriseId: string,
    @Body() body: unknown,
  ) {
    return this.tasks.create(user, enterpriseId, parse(taskCreateSchema, body));
  }

  @Get('tasks/:id')
  get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.load(user, id);
  }

  @Patch('tasks/:id')
  update(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.update(user, id, parse(taskUpdateSchema, body));
  }

  @Get('tasks/:id/checklist')
  checklist(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.checklist(user, id);
  }

  @Put('tasks/:id/checklist/:itemKey')
  updateItem(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemKey') itemKey: string,
    @Body() body: unknown,
  ) {
    return this.tasks.updateChecklistItem(user, id, itemKey, parse(checklistItemUpdateSchema, body));
  }
}

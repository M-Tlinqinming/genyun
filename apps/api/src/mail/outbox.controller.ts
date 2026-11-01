import { Controller, ForbiddenException, Get, Inject, NotFoundException } from '@nestjs/common';
import { isOperator } from '../auth/access.ts';
import type { SessionUser } from '../auth/auth.service.ts';
import { CurrentUser } from '../auth/session.guard.ts';
import { MAILER, type Mailer, SimulatedMailer } from './mailer.ts';

// 模拟发件箱：预览环境里拿邀请链接、验证码用。只有运营能看；
// 只在 MAIL_DRIVER=mock 时注册这个接口（app.ts），正式环境根本没有这个地址，返回 404。
@Controller('dev/outbox')
export class OutboxController {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    if (!isOperator(user)) throw new ForbiddenException('只有耕云运营可以查看模拟发件箱');
    // 注册了接口但发信方式不是模拟发信（测试里换了发信实现）时，也当作没有
    if (!(this.mailer instanceof SimulatedMailer)) throw new NotFoundException();
    return { mails: await this.mailer.list() };
  }
}

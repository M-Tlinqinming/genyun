import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { AccountController, AccountService } from './auth/account.ts';
import { AuthController } from './auth/auth.controller.ts';
import { AuthService } from './auth/auth.service.ts';
import { RecoveryService } from './auth/recovery.service.ts';
import { Public, SessionGuard } from './auth/session.guard.ts';
import { DATABASE, type Database } from './db/client.ts';
import { EnterpriseDocumentsController, TaskDocumentsController } from './documents/documents.controller.ts';
import { DocumentsService } from './documents/documents.service.ts';
import { EnterprisesController } from './enterprises/enterprises.controller.ts';
import { EnterpriseProfileController } from './enterprises/profile.controller.ts';
import { FilesController } from './files/files.controller.ts';
import { defaultDrafter, type ParagraphPolisher } from './generation/ai/drafter.ts';
import { defaultRenderer, DRAFT_RENDERER, type DraftRenderer } from './generation/drafts.ts';
import { defaultQueue, DRAFT_QUEUE, type DraftQueue } from './generation/queue.ts';
import { defaultStorage, FILE_STORAGE, type FileStorage } from './files/storage.ts';
import { LicenseReader, LicenseRecognitionController } from './license/license-reader.ts';
import { defaultRecognizer, LICENSE_RECOGNIZER, type LicenseRecognizer } from './license/recognizer.ts';
import { NotificationsController, NotificationsService } from './notifications/notifications.service.ts';
import { defaultMailer, MAIL_OUTBOX, MAILER, type Mailer, outboxEnabled } from './mail/mailer.ts';
import { OutboxController } from './mail/outbox.controller.ts';
import { InvitationsController } from './orgs/invitations.controller.ts';
import { OperatorOrgsController } from './orgs/operator-orgs.controller.ts';
import { OperatorTasksController } from './tasks/operator-tasks.controller.ts';
import { OrgsController } from './orgs/orgs.controller.ts';
import { ContactsController, ContactsService } from './tasks/contacts.service.ts';
import { DRAWING_RENDERER, DrawingsController, DrawingsService } from './tasks/drawings.service.ts';
import { DrawingRenderer } from './generation/drawings/renderer.ts';
import { ExpertTasksController, ExpertTasksService } from './tasks/expert-tasks.service.ts';
import { EDIT_DRAFTER, EditingController, EditingService } from './tasks/editing.service.ts';
import { ReviewController, ReviewService } from './tasks/review.service.ts';
import { defaultPdfConverter, PDF_CONVERTER, type PdfConverter } from './generation/word/preview-pdf.ts';
import { GenerationController, GenerationService } from './tasks/generation.service.ts';
import { SubmissionService } from './tasks/submission.service.ts';
import { TasksController } from './tasks/tasks.controller.ts';
import { TasksService } from './tasks/tasks.service.ts';
import { WorkupController, WorkupService } from './tasks/workup.service.ts';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return { ok: true };
  }
}

export interface AppOptions {
  loginLimitPerMinute?: number;
  // 找回密码按 IP 限流（10 分钟内的次数）；测试里调大或调小
  recoverySendLimitPer10Min?: number;
  recoveryResetLimitPer10Min?: number;
  // 文件存储；不传时按环境变量使用本机磁盘
  storage?: FileStorage;
  // 营业执照识别；不传时按环境变量 LICENSE_OCR 选用，null 表示未配置
  recognizer?: LicenseRecognizer | null;
  // 草稿生成队列；不传时有 REDIS_URL 用 BullMQ，否则用进程内队列
  queue?: DraftQueue;
  // 生成一份草稿的 Word、PDF；测试换成假的模拟失败
  renderer?: DraftRenderer;
  // 客户图纸转图片（工作线程）；测试可以传超时更短的
  drawingRenderer?: DrawingRenderer;
  // 正文编辑「帮我改写这段」用的 AI；不传时按环境变量 AI_DRAFTER，null 表示不开启
  drafter?: ParagraphPolisher | null;
  // Word 校对页把当前稿转 PDF；不传时按环境变量（LibreOffice），null 表示没装转换工具
  pdf?: PdfConverter | null;
  // 发邮件；不传时按环境变量 MAIL_DRIVER 选用（mail/mailer.ts）
  mailer?: Mailer;
  // 是否开放「模拟发件箱」接口；不传时只在 MAIL_DRIVER=mock 时开放，其他情况没有这个地址（404）
  mailOutbox?: boolean;
}

export async function createApp(db: Database, options: AppOptions = {}): Promise<INestApplication> {
  const mailOutbox = options.mailOutbox ?? outboxEnabled();
  @Module({
    controllers: [
      HealthController,
      AuthController,
      AccountController,
      OrgsController,
      OperatorOrgsController,
      OperatorTasksController,
      InvitationsController,
      EnterprisesController,
      EnterpriseProfileController,
      TasksController,
      ExpertTasksController,
      WorkupController,
      GenerationController,
      EditingController,
      ReviewController,
      DrawingsController,
      ContactsController,
      NotificationsController,
      TaskDocumentsController,
      EnterpriseDocumentsController,
      FilesController,
      LicenseRecognitionController,
      ...(mailOutbox ? [OutboxController] : []),
    ],
    providers: [
      { provide: DATABASE, useValue: db },
      { provide: FILE_STORAGE, useValue: options.storage ?? defaultStorage() },
      {
        provide: LICENSE_RECOGNIZER,
        useValue: options.recognizer === undefined ? defaultRecognizer() : options.recognizer,
      },
      { provide: DRAFT_QUEUE, useFactory: () => options.queue ?? defaultQueue() },
      { provide: DRAFT_RENDERER, useFactory: () => options.renderer ?? defaultRenderer() },
      { provide: EDIT_DRAFTER, useFactory: () => (options.drafter === undefined ? defaultDrafter() : options.drafter) },
      { provide: PDF_CONVERTER, useFactory: () => (options.pdf === undefined ? defaultPdfConverter() : options.pdf) },
      { provide: MAILER, useFactory: () => options.mailer ?? defaultMailer() },
      { provide: MAIL_OUTBOX, useValue: mailOutbox },
      { provide: DRAWING_RENDERER, useFactory: () => options.drawingRenderer ?? new DrawingRenderer() },
      AuthService,
      RecoveryService,
      AccountService,
      GenerationService,
      EditingService,
      ReviewService,
      DrawingsService,
      TasksService,
      ExpertTasksService,
      WorkupService,
      ContactsService,
      NotificationsService,
      LicenseReader,
      SubmissionService,
      DocumentsService,
      { provide: APP_GUARD, useClass: SessionGuard },
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // 部署在反向代理后面时，用真实客户端 IP 做登录限流
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // 同一 IP 每分钟最多尝试登录的次数
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 60_000,
      limit: options.loginLimitPerMinute ?? 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { statusCode: 429, message: '尝试次数过多，请一分钟后再试' },
    }),
  );
  // 找回密码按 IP 限流（按邮箱的限流在 RecoveryService 里）：同一 IP 10 分钟内最多发验证码、提交重设各若干次
  for (const [path, limit] of [
    ['/api/auth/recover/send', options.recoverySendLimitPer10Min ?? 10],
    ['/api/auth/recover/reset', options.recoveryResetLimitPer10Min ?? 20],
  ] as const) {
    app.use(
      path,
      rateLimit({
        windowMs: 10 * 60_000,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { statusCode: 429, message: '尝试次数过多，请 10 分钟后再试' },
      }),
    );
  }
  // 接受邀请（设置密码）也限流，与登录相同
  app.use(
    '/api/invitations',
    rateLimit({
      windowMs: 60_000,
      limit: options.loginLimitPerMinute ?? 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => req.method !== 'POST',
      message: { statusCode: 429, message: '尝试次数过多，请一分钟后再试' },
    }),
  );
  return app;
}

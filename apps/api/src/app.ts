import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { AuthController } from './auth/auth.controller.ts';
import { AuthService } from './auth/auth.service.ts';
import { Public, SessionGuard } from './auth/session.guard.ts';
import { DATABASE, type Database } from './db/client.ts';
import { EnterpriseDocumentsController, TaskDocumentsController } from './documents/documents.controller.ts';
import { DocumentsService } from './documents/documents.service.ts';
import { EnterprisesController } from './enterprises/enterprises.controller.ts';
import { EnterpriseProfileController } from './enterprises/profile.controller.ts';
import { FilesController } from './files/files.controller.ts';
import { defaultStorage, FILE_STORAGE, type FileStorage } from './files/storage.ts';
import { LicenseReader, LicenseRecognitionController } from './license/license-reader.ts';
import { defaultRecognizer, LICENSE_RECOGNIZER, type LicenseRecognizer } from './license/recognizer.ts';
import { OrgsController } from './orgs/orgs.controller.ts';
import { ExpertTasksController, ExpertTasksService } from './tasks/expert-tasks.service.ts';
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
  // 文件存储；不传时按环境变量使用本机磁盘
  storage?: FileStorage;
  // 营业执照识别；不传时按环境变量 LICENSE_OCR 选用，null 表示未配置
  recognizer?: LicenseRecognizer | null;
}

export async function createApp(db: Database, options: AppOptions = {}): Promise<INestApplication> {
  @Module({
    controllers: [
      HealthController,
      AuthController,
      OrgsController,
      EnterprisesController,
      EnterpriseProfileController,
      TasksController,
      ExpertTasksController,
      WorkupController,
      TaskDocumentsController,
      EnterpriseDocumentsController,
      FilesController,
      LicenseRecognitionController,
    ],
    providers: [
      { provide: DATABASE, useValue: db },
      { provide: FILE_STORAGE, useValue: options.storage ?? defaultStorage() },
      {
        provide: LICENSE_RECOGNIZER,
        useValue: options.recognizer === undefined ? defaultRecognizer() : options.recognizer,
      },
      AuthService,
      TasksService,
      ExpertTasksService,
      WorkupService,
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
  return app;
}

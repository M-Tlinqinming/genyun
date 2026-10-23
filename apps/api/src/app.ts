import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { AuthController } from './auth/auth.controller.ts';
import { AuthService } from './auth/auth.service.ts';
import { Public, SessionGuard } from './auth/session.guard.ts';
import { DATABASE, type Database } from './db/client.ts';
import { OrgsController } from './orgs/orgs.controller.ts';

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
}

export async function createApp(db: Database, options: AppOptions = {}): Promise<INestApplication> {
  @Module({
    controllers: [HealthController, AuthController, OrgsController],
    providers: [
      { provide: DATABASE, useValue: db },
      AuthService,
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

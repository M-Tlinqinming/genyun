import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type SessionUser } from './auth.service.ts';

export const SESSION_COOKIE = 'gy_session';

const PUBLIC_KEY = 'genyun:public';
// 默认所有接口都要登录；只有显式标记 @Public() 的才不用
export const Public = () => SetMetadata(PUBLIC_KEY, true);

type AuthedRequest = Request & { user?: SessionUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const user = token ? await this.auth.userForToken(token) : null;
    if (!user) throw new UnauthorizedException('请先登录');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): SessionUser => {
  const user = context.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException('请先登录');
  return user;
});

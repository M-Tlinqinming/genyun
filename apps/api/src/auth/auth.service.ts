import { hash, verify } from '@node-rs/argon2';
import type { LoginInput, Role } from '@genyun/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DATABASE, type Database } from '../db/client.ts';
import { memberships, organizations, sessions, users } from '../db/schema.ts';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// 账号不存在时也做一次同样耗时的校验，避免通过响应时间判断邮箱是否已注册
const DUMMY_HASH = hash('genyun-dummy-password');

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // 停用的账号：密码对了才告诉对方「已停用」（密码不对时和其他错误一样，不暴露账号状态）
  async login(input: LoginInput): Promise<{ token: string; user: SessionUser } | 'disabled' | null> {
    const email = input.email.trim().toLowerCase();
    const [found] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const ok = await verify(found?.passwordHash ?? (await DUMMY_HASH), input.password);
    if (!found || !ok) return null;
    if (found.disabledAt) return 'disabled';
    return this.startSession(found.id);
  }

  // 登录成功、接受邀请设好密码、重设密码后都从这里开会话
  async startSession(userId: string): Promise<{ token: string; user: SessionUser }> {
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return { token, user: await this.loadUser(userId) };
  }

  async userForToken(token: string): Promise<SessionUser | null> {
    const [row] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      // 停用时会删掉会话；这里再按账号状态挡一次，停用那一刻正在进行的请求之后也进不来
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
      .limit(1);
    return row ? this.loadUser(row.userId) : null;
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async loadUser(userId: string): Promise<SessionUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error(`user ${userId} not found`);
    const rows = await this.db
      .select({ orgId: memberships.orgId, orgName: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(organizations.name);
    return { id: user.id, email: user.email, name: user.name, memberships: rows };
  }
}

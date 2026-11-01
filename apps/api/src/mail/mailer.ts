import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AliyunMailer, aliyunConfigFromEnv } from './aliyun.ts';

// 发邮件只用于邀请和验证码（CLAUDE.md：不接短信；业务提醒只做站内提醒，不发邮件）。
// 两种发信方式，按环境变量 MAIL_DRIVER 选用：
// - mock（本机、测试、预览环境）：不真的发出，写进发件箱目录，运营在「模拟发件箱」页面查看；
// - aliyun（正式环境）：阿里云邮件推送，凭据见 aliyun.ts。
// 正式环境（NODE_ENV=production）没设 MAIL_DRIVER、值不认识、或 aliyun 凭据没配齐，一律启动报错，
// 免得以为邮件发出去了其实没有；本机和测试没配凭据时退回模拟发信。
// 邮件内容用 templates.ts 生成。

export type MailKind = 'invitation' | 'recovery_code' | 'password_reset';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // 哪一种邮件；只用于日志和发件箱里区分
  kind?: MailKind;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  // 模拟发信：邮件没有真的发出，开通成功的提示里说明
  readonly simulated?: boolean;
}

export const MAILER = Symbol('MAILER');
// 「模拟发件箱」是否开放（boolean）：开通成功的提示里只在开放时才说「可在模拟发件箱查看」
export const MAIL_OUTBOX = Symbol('MAIL_OUTBOX');

// 日志里的收件人只留前两位：ex****@demo.genyun.net.cn
export function maskAddress(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}****@${domain}`;
}

export interface OutboxMail extends MailMessage {
  id: string;
  at: string;
}

// 模拟发信：不真的发出，把邮件写成文件放进 MAIL_OUTBOX_DIR（默认 .data/mail-outbox）。
// 服务日志只打收件人（打码）和主题，不打正文：正文里有验证码和链接。
export class SimulatedMailer implements Mailer {
  readonly simulated = true;
  private lastMs = 0;
  constructor(private readonly dir = process.env.MAIL_OUTBOX_DIR || '.data/mail-outbox') {}

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // 同一毫秒发两封时往后错开 1 毫秒，保证按文件名排序不乱
    this.lastMs = Math.max(Date.now(), this.lastMs + 1);
    const at = new Date(this.lastMs).toISOString();
    // 文件名以时间开头，按名字排序就是按时间排序
    const id = `${at.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    await writeFile(join(this.dir, `${id}.json`), JSON.stringify({ ...message, at }, null, 2), 'utf8');
    console.log(`【模拟发信】给 ${maskAddress(message.to)}：${message.subject}（在「模拟发件箱」查看）`);
  }

  // 最近发出的邮件，新的在前
  async list(limit = 100): Promise<OutboxMail[]> {
    const files = (await readdir(this.dir).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);
    const mails: OutboxMail[] = [];
    for (const f of files) {
      try {
        const m = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Omit<OutboxMail, 'id'>;
        mails.push({ id: f.slice(0, -'.json'.length), to: m.to, subject: m.subject, text: m.text, html: m.html, kind: m.kind, at: m.at });
      } catch {
        // 写到一半或被手动改坏的文件跳过
      }
    }
    return mails;
  }
}

// 测试用：记下发出的邮件
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

// 失败重试一次；两次的失败都记日志。日志只有邮件种类、打码的收件人和错误说明，没有正文（验证码、链接）
export class RetryingMailer implements Mailer {
  constructor(
    private readonly inner: Mailer,
    private readonly delayMs = 2000,
  ) {}

  get simulated() {
    return this.inner.simulated;
  }

  async send(message: MailMessage): Promise<void> {
    const label = `${message.kind ?? 'mail'} → ${maskAddress(message.to)}`;
    try {
      await this.inner.send(message);
      return;
    } catch (err) {
      console.warn(`发信失败，${this.delayMs / 1000} 秒后重试一次（${label}）：${errorText(err)}`);
    }
    await new Promise((r) => setTimeout(r, this.delayMs));
    try {
      await this.inner.send(message);
      console.warn(`重试发信成功（${label}）`);
    } catch (err) {
      console.error(`重试后仍发信失败（${label}）：${errorText(err)}`);
      throw err;
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}

const ALIYUN_KEYS = 'ALIYUN_DM_ACCESS_KEY_ID、ALIYUN_DM_ACCESS_KEY_SECRET、ALIYUN_DM_ACCOUNT_NAME';

// MAIL_DRIVER：mock 或 aliyun。不设时本机和测试按 mock；正式环境不设算作未配置（defaultMailer 会报错）
export function mailDriver(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAIL_DRIVER || (env.NODE_ENV === 'production' ? '' : 'mock');
}

// 「模拟发件箱」只在 MAIL_DRIVER=mock 时开放；其他情况（包括本机 aliyun 但凭据没配齐而退回模拟发信）一律不开放
export function outboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return mailDriver(env) === 'mock';
}

export function defaultMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const production = env.NODE_ENV === 'production';
  const driver = mailDriver(env);
  if (driver === 'mock') return new SimulatedMailer(env.MAIL_OUTBOX_DIR || '.data/mail-outbox');
  if (driver === 'aliyun') {
    const config = aliyunConfigFromEnv(env);
    if (config) return new RetryingMailer(new AliyunMailer(config));
    if (production) throw new Error(`MAIL_DRIVER=aliyun，但阿里云邮件推送的凭据没配齐（${ALIYUN_KEYS}）`);
    console.warn(`MAIL_DRIVER=aliyun，但阿里云邮件推送的凭据没配齐（${ALIYUN_KEYS}），本机先模拟发信`);
    return new SimulatedMailer(env.MAIL_OUTBOX_DIR || '.data/mail-outbox');
  }
  if (!driver) {
    throw new Error('正式环境没有配置发信方式：请设 MAIL_DRIVER=aliyun 并配好阿里云凭据；预览环境设 MAIL_DRIVER=mock（模拟发信）');
  }
  throw new Error(`不认识的 MAIL_DRIVER=${driver}，只支持 mock 和 aliyun`);
}

// 邮件里的链接指向前端页面；APP_ORIGIN 是用户访问的网址（如 https://preview.gengyun.net.cn）
export function appLink(path: string): string {
  const origin = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}${path}`;
}

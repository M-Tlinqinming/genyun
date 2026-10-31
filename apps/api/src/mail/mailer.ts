import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 发邮件只用于邀请和验证码（CLAUDE.md：不接短信；业务提醒只做站内提醒，不发邮件）。
// 现在只有模拟发信；M4 接阿里云邮件推送时新写一个实现，按 MAIL_MODE 选用。

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  // 模拟发信：邮件没有真的发出，开通成功的提示里说明
  readonly simulated?: boolean;
}

export const MAILER = Symbol('MAILER');

// 模拟发信：不真的发出，把邮件写成文件放进 MAIL_OUTBOX_DIR（默认 .data/mail-outbox），并在服务日志里打一行。
// 本机、浏览器测试和预览环境用；预览环境要拿邀请链接时看服务日志。
export class SimulatedMailer implements Mailer {
  readonly simulated = true;
  constructor(private readonly dir = process.env.MAIL_OUTBOX_DIR || '.data/mail-outbox') {}

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const at = new Date().toISOString();
    const name = `${at.replace(/[:.]/g, '-')}-${message.to.replace(/[^a-z0-9@.-]/gi, '_')}.json`;
    await writeFile(join(this.dir, name), JSON.stringify({ ...message, at }, null, 2), 'utf8');
    console.log(`【模拟发信】给 ${message.to}：${message.subject}\n${message.text}`);
  }
}

// 测试用：记下发出的邮件
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export function defaultMailer(): Mailer {
  if (process.env.NODE_ENV === 'production') {
    console.warn('还没有接真实的邮件服务，邀请邮件只写进服务日志（M4 接阿里云邮件推送）');
  }
  return new SimulatedMailer();
}

// 邮件里的链接指向前端页面；APP_ORIGIN 是用户访问的网址（如 https://preview.gengyun.net.cn）
export function appLink(path: string): string {
  const origin = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}${path}`;
}

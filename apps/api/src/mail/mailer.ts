import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 发邮件只用于邀请和验证码（CLAUDE.md：不接短信；业务提醒只做站内提醒，不发邮件）。
// 现在只有模拟发信；M4 接阿里云邮件推送时新写一个实现，按 MAIL_DRIVER 选用。

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

// 模拟发信：不真的发出，把邮件写成文件放进 MAIL_OUTBOX_DIR（默认 .data/mail-outbox）。
// 本机和测试在服务日志里打出全文；正式环境（预览）只记收件人和标题，邀请链接要到服务器的发件箱目录里查，
// 避免日志里出现能直接注册的链接
export class SimulatedMailer implements Mailer {
  readonly simulated = true;
  constructor(private readonly dir = process.env.MAIL_OUTBOX_DIR || '.data/mail-outbox') {}

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const at = new Date().toISOString();
    const name = `${at.replace(/[:.]/g, '-')}-${message.to.replace(/[^a-z0-9@.-]/gi, '_')}.json`;
    await writeFile(join(this.dir, name), JSON.stringify({ ...message, at }, null, 2), 'utf8');
    if (process.env.NODE_ENV === 'production') {
      console.log(`【模拟发信】给 ${message.to}：${message.subject}（正文见发件箱 ${name}）`);
    } else {
      console.log(`【模拟发信】给 ${message.to}：${message.subject}\n${message.text}`);
    }
  }
}

// 测试用：记下发出的邮件
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

// MAIL_DRIVER：mock = 模拟发信。正式环境必须显式设置（预览环境设 mock），
// 没设就启动失败，免得以为邀请发出去了其实没有
export function defaultMailer(): Mailer {
  const driver = process.env.MAIL_DRIVER || (process.env.NODE_ENV === 'production' ? '' : 'mock');
  if (driver === 'mock') return new SimulatedMailer();
  if (!driver) {
    throw new Error('正式环境没有配置发信方式：预览环境请设 MAIL_DRIVER=mock（模拟发信），接阿里云邮件推送后改为对应的值');
  }
  throw new Error(`不认识的 MAIL_DRIVER=${driver}，目前只支持 mock`);
}

// 邮件里的链接指向前端页面；APP_ORIGIN 是用户访问的网址（如 https://preview.gengyun.net.cn）
export function appLink(path: string): string {
  const origin = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}${path}`;
}

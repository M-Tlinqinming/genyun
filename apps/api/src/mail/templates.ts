import type { MailMessage } from './mailer.ts';

// 系统邮件只有三种：邀请、找回密码的验证码、密码已重设的通知（业务提醒只做站内，不发邮件）。
// 每封都有纯文本和 HTML 两版：统一的品牌页眉、称呼、正文、有效期说明和落款「耕云 · 0752-5200831」。
// 主题里不放验证码和链接（主题会出现在服务日志和收件箱列表里）。

export const MAIL_SIGNATURE = '耕云 · 0752-5200831';

const COLOR = { brand: '#245BDB', text: '#18243B', secondary: '#596170', line: '#E8EAEE', bg: '#F5F6F8' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// 「2026 年 11 月 1 日 09:30」（北京时间）
export function formatBeijingTime(at: Date): string {
  const t = new Date(at.getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()} 年 ${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日 ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

// 正文的一块：普通段落、按钮链接、大号验证码、灰色小字
type Block =
  | { p: string }
  | { button: string; href: string }
  | { code: string }
  | { note: string };

interface Letter {
  to: string;
  kind: MailMessage['kind'];
  subject: string;
  greeting: string;
  blocks: Block[];
}

function toText(l: Letter): string {
  const lines = [l.greeting, ''];
  for (const b of l.blocks) {
    if ('p' in b) lines.push(b.p, '');
    else if ('button' in b) lines.push(`${b.button}：`, b.href, '');
    else if ('code' in b) lines.push(`验证码：${b.code}`, '');
    else lines.push(b.note, '');
  }
  lines.push('——', MAIL_SIGNATURE);
  return lines.join('\n');
}

function toHtml(l: Letter): string {
  const font = `font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif`;
  const body = l.blocks
    .map((b) => {
      if ('p' in b) return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${COLOR.text}">${escapeHtml(b.p)}</p>`;
      if ('button' in b) {
        const href = escapeHtml(b.href);
        return (
          `<p style="margin:8px 0 16px"><a href="${href}" style="display:inline-block;padding:10px 24px;background:${COLOR.brand};color:#FFFFFF;border-radius:6px;font-size:15px;text-decoration:none">${escapeHtml(b.button)}</a></p>` +
          `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${COLOR.secondary}">按钮打不开时，复制下面的地址到浏览器：<br><a href="${href}" style="color:${COLOR.brand};word-break:break-all">${href}</a></p>`
        );
      }
      if ('code' in b) {
        return `<p style="margin:8px 0 16px;font-size:30px;line-height:40px;letter-spacing:8px;font-weight:600;color:${COLOR.text}">${escapeHtml(b.code)}</p>`;
      }
      return `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${COLOR.secondary}">${escapeHtml(b.note)}</p>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(l.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${COLOR.bg};${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid ${COLOR.line};border-radius:8px">
<tr><td style="padding:20px 32px;border-bottom:3px solid ${COLOR.brand}"><span style="font-size:20px;font-weight:600;letter-spacing:4px;color:${COLOR.brand}">耕云</span><span style="margin-left:12px;font-size:13px;color:${COLOR.secondary}">生产安全事故应急预案编制</span></td></tr>
<tr><td style="padding:28px 32px 12px">
<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${COLOR.text}">${escapeHtml(l.greeting)}</p>
${body}
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid ${COLOR.line};font-size:13px;color:${COLOR.secondary}">${escapeHtml(MAIL_SIGNATURE)}</td></tr>
</table>
</body></html>`;
}

function letter(l: Letter): MailMessage {
  return { to: l.to, kind: l.kind, subject: l.subject, text: toText(l), html: toHtml(l) };
}

export interface InvitationMailInput {
  to: string;
  name: string;
  inviterName: string;
  orgName: string;
  // 「机构管理员」或「成员」
  roleLabel: string;
  link: string;
  expiresAt: Date;
  // 重新发送或更换管理员后发的新邀请：写明以最新一封为准
  resend?: boolean;
}

export function invitationMail(i: InvitationMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'invitation',
    subject: `${i.inviterName}邀请您加入「${i.orgName}」`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.inviterName}邀请您以${i.roleLabel}身份加入耕云工作空间「${i.orgName}」。点下面的按钮设置登录密码，之后就可以开始使用。` },
      { button: '接受邀请', href: i.link },
      { note: `链接有效期至 ${formatBeijingTime(i.expiresAt)}（北京时间），只能使用一次。` },
      ...(i.resend ? [{ note: '这是重新发送的邀请，之前的邀请链接已作废，请以最新一封为准。' }] : []),
      { note: '不认识这个机构？忽略这封邮件即可，链接过期后会自动失效。' },
    ],
  });
}

export interface RecoveryCodeMailInput {
  to: string;
  name: string;
  code: string;
  validMinutes: number;
}

export function recoveryCodeMail(i: RecoveryCodeMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'recovery_code',
    subject: '重设耕云登录密码的验证码',
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: '您正在重设耕云的登录密码。请在重设密码页面输入下面的验证码：' },
      { code: i.code },
      { note: `验证码 ${i.validMinutes} 分钟内有效，只能使用一次。如果不是您本人操作，请忽略这封邮件，您的密码不会改变。` },
    ],
  });
}

export interface PasswordResetMailInput {
  to: string;
  name: string;
  at: Date;
}

export function passwordResetMail(i: PasswordResetMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'password_reset',
    subject: '您的耕云登录密码已重设',
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `您的耕云登录密码已于 ${formatBeijingTime(i.at)}（北京时间）重设，其他设备上的登录都已退出。` },
      { note: '如果不是您本人操作，请立即致电耕云 0752-5200831。' },
    ],
  });
}

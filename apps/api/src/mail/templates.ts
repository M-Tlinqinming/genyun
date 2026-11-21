import type { MailMessage } from './mailer.ts';

// 系统邮件：邀请、找回密码的验证码、密码已重设的通知，以及成果交付相关的五封（首次交付、已更新、次数用完成果先锁住、续约后放开）。
// 其他业务提醒只做站内，不发邮件。
// 每封都有纯文本和 HTML 两版：统一的品牌页眉、称呼、正文、有效期说明和落款「耕云 · 0752-5200831」。
// 主题里不放验证码和链接（主题会出现在服务日志和收件箱列表里）。

export const MAIL_SIGNATURE = '耕云 · 0752-5200831';

const COLOR = { brand: '#245BDB', text: '#18243B', secondary: '#596170', line: '#E8EAEE', bg: '#F5F6F8' };
// 只在交付邮件里用的颜色（15 页邮件画板）：信息行底色、行名、白底按钮的边框、信尾小字
const MAIL_COLOR = { panel: '#F8F9FB', label: '#697386', buttonLine: '#D0D5DD', footnote: '#8A93A3' };

// 交付邮件里的日期：北京时间「2026.11.18」
export function formatBeijingDate(at: Date): string {
  const t = new Date(at.getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// 「2026 年 11 月 1 日 09:30」（北京时间）
export function formatBeijingTime(at: Date): string {
  const t = new Date(at.getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()} 年 ${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日 ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

// 正文的一块：普通段落、按钮链接、大号验证码、灰色小字，
// 以及交付邮件用的：一组「名称 · 内容」行、带小标题的说明块、信尾（自动发出 + 这封信的收件原因）。
// 按钮可以写成白底（outline），也可以在旁边带一句小字（hint）
type Block =
  | { p: string }
  | { button: string; href: string; hint?: string; outline?: boolean }
  | { code: string }
  | { note: string }
  | { rows: { label: string; value: string }[] }
  | { section: string; text: string }
  | { footer: string };

export const MAIL_AUTO_NOTE = '这是系统自动发出的邮件，请不要直接回复。';

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
    else if ('button' in b) lines.push(`${b.button}：`, b.href, ...(b.hint ? [b.hint] : []), '');
    else if ('code' in b) lines.push(`验证码：${b.code}`, '');
    else if ('rows' in b) lines.push(...b.rows.map((r) => `${r.label}：${r.value}`), '');
    else if ('section' in b) lines.push(b.section, b.text, '');
    else if ('footer' in b) lines.push(MAIL_AUTO_NOTE, b.footer, '');
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
      if ('button' in b && (b.hint || b.outline)) {
        const href = escapeHtml(b.href);
        const style = b.outline
          ? `background:#FFFFFF;color:${COLOR.text};border:1px solid ${MAIL_COLOR.buttonLine}`
          : `background:${COLOR.brand};color:#FFFFFF;border:1px solid ${COLOR.brand}`;
        return (
          `<p style="margin:8px 0 16px"><a href="${href}" style="display:inline-block;padding:8px 24px;${style};border-radius:6px;font-size:14px;line-height:22px;font-weight:500;text-decoration:none">${escapeHtml(b.button)}</a>` +
          (b.hint ? `<span style="margin-left:16px;font-size:12px;line-height:18px;color:${MAIL_COLOR.footnote}">${escapeHtml(b.hint)}</span>` : '') +
          `</p>` +
          `<p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${MAIL_COLOR.footnote}">按钮打不开时，复制下面的地址到浏览器：<br><a href="${href}" style="color:${COLOR.brand};word-break:break-all">${href}</a></p>`
        );
      }
      if ('rows' in b) {
        const rows = b.rows
          .map(
            (r) =>
              `<tr><td style="width:56px;padding:4px 12px 4px 0;vertical-align:top;font-size:13px;line-height:20px;color:${MAIL_COLOR.label};white-space:nowrap">${escapeHtml(r.label)}</td>` +
              `<td style="padding:4px 0;font-size:13px;line-height:20px;color:${COLOR.text}">${escapeHtml(r.value)}</td></tr>`,
          )
          .join('');
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${MAIL_COLOR.panel};border-radius:6px"><tr><td style="padding:12px 20px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
      }
      if ('section' in b) {
        return (
          `<p style="margin:0 0 4px;font-size:14px;line-height:22px;font-weight:600;color:${COLOR.text}">${escapeHtml(b.section)}</p>` +
          `<p style="margin:0 0 16px;font-size:13px;line-height:22px;color:${COLOR.secondary}">${escapeHtml(b.text)}</p>`
        );
      }
      if ('footer' in b) {
        return `<p style="margin:8px 0 0;padding-top:16px;border-top:1px solid ${COLOR.line};font-size:12px;line-height:18px;color:${MAIL_COLOR.footnote}">${escapeHtml(MAIL_AUTO_NOTE)}<br>${escapeHtml(b.footer)}</p>`;
      }
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
  // 「组织管理员」或「成员」
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
      { note: '不认识这个组织？忽略这封邮件即可，链接过期后会自动失效。' },
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

// ---------- 成果交付相关的邮件（15 页邮件画板第 1–5 封） ----------

// 「文档」行写死三份
export const DELIVERY_DOCS_LINE = '应急预案、风险评估报告、应急资源调查报告，共三份 Word';

export interface DeliveryMailTask {
  enterpriseName: string;
  taskName: string;
  taskNumber: string;
  // 成果页链接（appLink('/customer/documents/{taskId}')）
  link: string;
  // 专家编制完成（首次交付）的时间
  deliveredAt: Date;
}

function taskRows(t: DeliveryMailTask, status: string): Block {
  return {
    rows: [
      { label: '企业', value: t.enterpriseName },
      { label: '任务', value: `${t.taskName} · ${t.taskNumber}` },
      { label: '状态', value: status },
      { label: '文档', value: DELIVERY_DOCS_LINE },
    ],
  };
}

export interface CreditsLockedMailInput extends DeliveryMailTask {
  to: string;
  name: string;
  // credits = 次数用完；expired = 年度服务已到期
  reason: 'credits' | 'expired';
}

// 第 3 封：次数用完（或年度服务到期），成果先锁住，发给组织全部在职管理员
export function creditsLockedAdminMail(i: CreditsLockedMailInput): MailMessage {
  const why = i.reason === 'expired' ? '贵组织的年度服务已到期' : '贵组织的编制次数已经用完';
  return letter({
    to: i.to,
    kind: 'credits_locked_admin',
    subject: `【耕云】${i.enterpriseName}的应急预案已编制完成，${i.reason === 'expired' ? '续约后可以下载' : '补充次数后可以下载'}`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.enterpriseName}的应急预案已经编制完成。${why}，这份成果先锁住，暂时不能下载。` },
      taskRows(i, `${formatBeijingDate(i.deliveredAt)} 编制完成，还没放开下载`),
      { button: '登录查看', href: i.link, outline: true },
      { section: '续约请联系耕云客服', text: '续约后这份成果会自动放开下载，并算 1 次，不用重新提交资料。已经交付过的成果不受影响，照常下载。' },
      { footer: '您收到这封邮件，是因为您是贵组织的管理员。' },
    ],
  });
}

export interface CreditsLockedSubmitterMailInput extends DeliveryMailTask {
  to: string;
  name: string;
  adminNames: string;
}

// 第 4 封：成果先锁住，发给提交人（不是管理员时才发）；不提次数和续约，只告诉他找谁
export function creditsLockedSubmitterMail(i: CreditsLockedSubmitterMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'credits_locked_submitter',
    subject: `【耕云】${i.enterpriseName}的应急预案已编制完成，请联系贵组织管理员`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.enterpriseName}的应急预案已经编制完成，暂时还不能下载，需要贵组织管理员处理。` },
      taskRows(i, `${formatBeijingDate(i.deliveredAt)} 编制完成，还没放开下载`),
      { button: '登录查看', href: i.link, outline: true },
      {
        section: `贵组织的管理员是${i.adminNames}`,
        text: `请联系${i.adminNames}。处理好后会自动放开下载，不用重新提交资料。联系不上的话，也可以直接找耕云客服。`,
      },
      { footer: '您收到这封邮件，是因为您提交了这个任务。' },
    ],
  });
}

export interface DeliveryReleasedMailInput extends DeliveryMailTask {
  to: string;
  name: string;
  releasedAt: Date;
}

// 第 5 封：续约或加购后成果放开下载，发给提交人和组织管理员（同一个人只发一封）；不提次数和续约
export function deliveryReleasedMail(i: DeliveryReleasedMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'delivery_released',
    subject: `【耕云】${i.enterpriseName}的应急预案现在可以下载了`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.enterpriseName}的应急预案现在可以下载了。三份文档已经放开，登录后就能下载，不用重新提交资料。` },
      taskRows(i, `${formatBeijingDate(i.deliveredAt)} 编制完成，${formatBeijingDate(i.releasedAt)} 起可以下载`),
      { button: '登录下载', href: i.link, hint: '登录后直接打开这个任务的成果文档' },
      { note: '邮件里不带附件，文档请登录耕云后下载。对内容有疑问，请联系耕云客服。' },
      { footer: '您收到这封邮件，是因为您提交了这个任务，或者是贵组织的管理员。' },
    ],
  });
}

// 「这次更新」那一行：「11 月 27 日更新：值班电话、通讯联络组组员」（北京时间）
export function updateNoteLine(at: Date, note: string): string {
  const t = new Date(at.getTime() + 8 * 3_600_000);
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日更新：${note}`;
}

const DELIVERY_FOOTER = '您收到这封邮件，是因为您提交了这个任务，或者是贵组织的管理员。';

export interface DeliveryDoneMailInput extends DeliveryMailTask {
  to: string;
  name: string;
}

// 第 1 封：首次交付，发给提交人和组织管理员（同一个人只发一封）
export function deliveryDoneMail(i: DeliveryDoneMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'delivery_done',
    subject: `【耕云】${i.enterpriseName}的应急预案已编制完成，请登录下载`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.enterpriseName}的应急预案已经编制完成，并由专家审核交付。三份文档现在可以下载。` },
      {
        rows: [
          { label: '企业', value: i.enterpriseName },
          { label: '任务', value: `${i.taskName} · ${i.taskNumber}` },
          { label: '交付时间', value: formatBeijingDate(i.deliveredAt) },
          { label: '文档', value: DELIVERY_DOCS_LINE },
        ],
      },
      { button: '登录下载', href: i.link, hint: '登录后直接打开这个任务的成果文档' },
      { note: '邮件里不带附件，文档请登录耕云后下载。对内容有疑问，请联系耕云客服。' },
      { footer: DELIVERY_FOOTER },
    ],
  });
}

export interface DeliveryUpdatedMailInput extends DeliveryMailTask {
  to: string;
  name: string;
  // 这次再交付的时间
  updatedAt: Date;
  // 专家填的「这次更新了什么」；没填为 null，不带那一行
  updateNote: string | null;
}

// 第 2 封：重新打开后再次交付（已更新），收件人同第 1 封
export function deliveryUpdatedMail(i: DeliveryUpdatedMailInput): MailMessage {
  return letter({
    to: i.to,
    kind: 'delivery_updated',
    subject: `【耕云】${i.enterpriseName}的应急预案已更新，请登录下载`,
    greeting: `${i.name}，您好：`,
    blocks: [
      { p: `${i.enterpriseName}的应急预案已更新，专家已重新审核并交付。请登录下载最新的三份文档，登录后看到的就是更新后的这一版。` },
      {
        rows: [
          { label: '企业', value: i.enterpriseName },
          { label: '任务', value: `${i.taskName} · ${i.taskNumber}` },
          { label: '更新时间', value: formatBeijingDate(i.updatedAt) },
          ...(i.updateNote ? [{ label: '这次更新', value: updateNoteLine(i.updatedAt, i.updateNote) }] : []),
        ],
      },
      { button: '登录下载', href: i.link, hint: '登录后直接打开这个任务的成果文档' },
      { note: '邮件里不带附件，文档请登录耕云后下载。对内容有疑问，请联系耕云客服。' },
      { footer: DELIVERY_FOOTER },
    ],
  });
}

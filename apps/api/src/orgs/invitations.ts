import { INVITATION_TTL_DAYS, type Role } from '@genyun/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/client.ts';
import { organizationInvitations } from '../db/schema.ts';
import { appLink, type Mailer } from '../mail/mailer.ts';

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface NewInvitation {
  orgId: string;
  orgName: string;
  role: Role;
  email: string;
  name: string;
  phone: string | null;
  invitedBy: string;
  inviterName: string;
  // 重发或更换后发的新邮件：写明以最新一封为准
  resend?: boolean;
}

export const EMAIL_HAS_ACCOUNT = '这个邮箱已经有耕云账号，请换一个邮箱';

// 有效期写到分钟（北京时间），收信人不用自己算 7 天
function expiresText(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year} 年 ${p.month} 月 ${p.day} 日 ${p.hour}:${p.minute}`;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// 记一条邀请（链接 7 天有效），返回要发的邮件。邮件在事务提交后再发，避免发了邮件而开通没成功
export async function createInvitation(db: Database | Tx, inv: NewInvitation) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
  const [row] = await db
    .insert(organizationInvitations)
    .values({
      orgId: inv.orgId,
      role: inv.role,
      email: inv.email,
      name: inv.name,
      phone: inv.phone,
      tokenHash: hashInvitationToken(token),
      expiresAt,
      invitedBy: inv.invitedBy,
    })
    .returning({ id: organizationInvitations.id });
  const link = appLink(`/invite/${token}`);
  const mail = {
    to: inv.email,
    subject: `${inv.inviterName}邀请您加入「${inv.orgName}」`,
    text: [
      `${inv.name}，您好：`,
      '',
      `${inv.inviterName}邀请您以${inv.role === 'customer_admin' ? '机构管理员' : '成员'}身份加入耕云工作空间「${inv.orgName}」。打开下面的链接，设置登录密码后即可开始使用：`,
      link,
      '',
      `链接有效期至 ${expiresText(expiresAt)}（北京时间），只能使用一次。`,
      ...(inv.resend ? ['这是重新发送的邀请，之前的邀请链接已作废，请以最新一封为准。'] : []),
      '不认识这个机构？忽略这封邮件即可，链接过期后会自动失效。如有疑问请致电耕云 0752-5200831。',
      '',
      '耕云团队',
    ].join('\n'),
  };
  return { id: row!.id, expiresAt, mail };
}

export async function sendInvitationMail(mailer: Mailer, mail: Awaited<ReturnType<typeof createInvitation>>['mail']) {
  await mailer.send(mail);
}

import { INVITATION_TTL_DAYS, type Role } from '@genyun/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/client.ts';
import { organizationInvitations } from '../db/schema.ts';
import { appLink, type Mailer, type MailMessage } from '../mail/mailer.ts';
import { invitationMail } from '../mail/templates.ts';

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
  const mail = invitationMail({
    to: inv.email,
    name: inv.name,
    inviterName: inv.inviterName,
    orgName: inv.orgName,
    roleLabel: inv.role === 'customer_admin' ? '机构管理员' : '成员',
    link: appLink(`/invite/${token}`),
    expiresAt,
    resend: inv.resend,
  });
  return { id: row!.id, expiresAt, mail };
}

export async function sendInvitationMail(mailer: Mailer, mail: MailMessage) {
  await mailer.send(mail);
}

// 接受邀请（Paper 10 页 A02「接受邀请｜设置密码并加入」「链接已过期」）。前后端共用。
import { z } from 'zod';

// 同一条链接的几种状态：可以接受、已使用、已撤销（重发或更换管理员后旧链接作废）、已过期
export type InvitationState = 'valid' | 'accepted' | 'revoked' | 'expired';

type Stamp = string | Date | null;
const time = (v: Stamp) => (v === null ? null : new Date(v).getTime());

export function invitationState(
  inv: { acceptedAt: Stamp; revokedAt: Stamp; expiresAt: string | Date },
  now: Date = new Date(),
): InvitationState {
  if (inv.acceptedAt) return 'accepted';
  if (inv.revokedAt) return 'revoked';
  return (time(inv.expiresAt) ?? 0) <= now.getTime() ? 'expired' : 'valid';
}

// 设置密码的三条规则，表单下方逐条打勾（Paper：至少 8 位 / 含字母和数字 / 不与邮箱相同）
export function passwordChecks(password: string, email: string): { label: string; ok: boolean }[] {
  return [
    { label: '至少 8 位', ok: password.length >= 8 },
    { label: '含字母和数字', ok: /[a-z]/i.test(password) && /\d/.test(password) },
    { label: '不与邮箱相同', ok: password.trim().toLowerCase() !== email.trim().toLowerCase() },
  ];
}

// 不满足时的提示；满足返回 null
export function passwordProblem(password: string, email: string): string | null {
  const [long, mixed, notEmail] = passwordChecks(password, email);
  if (!long!.ok) return '密码至少 8 位';
  if (!mixed!.ok) return '密码要同时含字母和数字';
  if (!notEmail!.ok) return '密码不能与邮箱相同';
  return null;
}

export const acceptInvitationSchema = z.object({
  name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
  password: z.string().max(128, '密码最多 128 位'),
  agreed: z.literal(true, '请先阅读并同意服务协议和隐私政策'),
});
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from './request';

export interface OutboxMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind?: 'invitation' | 'recovery_code' | 'password_reset';
  at: string;
}

// 模拟发件箱（只在预览环境开放；正式环境接口返回 404，不再重试）
export function useOutbox() {
  return useQuery({
    queryKey: ['dev', 'outbox'],
    queryFn: () => request<{ mails: OutboxMail[] }>('/dev/outbox').then((r) => r.mails),
    retry: (count, err) => !(err instanceof ApiError && (err.status === 404 || err.status === 403)) && count < 2,
  });
}

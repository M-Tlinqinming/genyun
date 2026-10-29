import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface Notifications {
  items: Notification[];
  unread: number;
}

const notificationsKey = ['notifications'] as const;

// 站内提醒（顶栏铃铛）：每分钟看一次有没有新的
export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: () => request<Notifications>('/notifications'),
    refetchInterval: 60_000,
  });
}

// 不传 ids = 全部标为已读
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => request<Notifications>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: (data) => client.setQueryData(notificationsKey, data),
  });
}

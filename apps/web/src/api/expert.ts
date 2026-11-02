import type { ChecklistItemKey, StartMethod, TaskStatus } from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './request';

export interface ExpertTask {
  id: string;
  number: string;
  name: string;
  orgId: string;
  orgName: string;
  enterpriseName: string;
  status: TaskStatus;
  startMethod: StartMethod | null;
  submittedAt: string | null;
  closedAt: string | null;
  activityAt: string;
  verifyItems: { key: ChecklistItemKey; label: string; kind: 'photo' | 'call' }[];
  contact: { requestedAt: string; requestedBy: string; labels: string[]; deadline: string; daysLeft: number } | null;
}

export interface ExpertEvent {
  at: string;
  taskId: string;
  text: string;
  kind: 'submitted' | 'contact' | 'photo' | 'delivered';
}

export function useExpertTasks() {
  return useQuery({
    queryKey: ['expert', 'tasks'],
    queryFn: () => request<{ tasks: ExpertTask[]; events: ExpertEvent[] }>('/expert/tasks'),
  });
}

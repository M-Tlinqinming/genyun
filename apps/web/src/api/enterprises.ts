import type { EnterpriseInput, EnterpriseUpdate, StartMethod, TaskStatus, TaskView } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

export interface Enterprise {
  id: string;
  orgId: string;
  name: string;
  socialCreditCode: string | null;
  registeredAddress: string | null;
  legalRepresentative: string | null;
  createdAt: string;
  updatedAt: string;
  /** 列表里才有：分配到这家企业的成员（组织管理员不算） */
  members?: { id: string; name: string }[];
}

// 组织下的任务列表（企业页、工作台、任务列表共用）；完整任务详情在任务页取。
// missing = 还缺的开始编制必需资料；remaining = 提交后还没补的项；activityAt = 最近一次有人动过资料
export interface TaskSummary {
  id: string;
  enterpriseId: string;
  enterpriseName: string;
  number: string;
  name: string;
  status: TaskStatus;
  startMethod: StartMethod | null;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  missing: string[];
  remaining: number;
  activityAt: string;
  /** 最新的交付版本（已发布才有） */
  delivery: { version: number; publishedAt: string } | null;
  /** 客户端三段状态（标签、下一步、要不要处理） */
  view: TaskView;
  /** 「更新」列的时间：交付、提交或最近一次动资料 */
  updatedOn: string;
  /** 成果锁住时提示联系的组织管理员名字；没锁为 null */
  adminNames: string | null;
}

export const enterpriseKeys = {
  list: (orgId: string) => ['orgs', orgId, 'enterprises'] as const,
  detail: (id: string) => ['enterprises', id] as const,
};
export const orgTasksKey = (orgId: string) => ['orgs', orgId, 'tasks'] as const;

export function useEnterprises(orgId: string) {
  return useQuery({
    queryKey: enterpriseKeys.list(orgId),
    queryFn: () => request<Enterprise[]>(`/orgs/${orgId}/enterprises`),
  });
}

export function useEnterprise(id: string) {
  return useQuery({
    queryKey: enterpriseKeys.detail(id),
    queryFn: () => request<Enterprise>(`/enterprises/${id}`),
  });
}

export function useOrgTasks(orgId: string) {
  return useQuery({
    queryKey: orgTasksKey(orgId),
    queryFn: () => request<TaskSummary[]>(`/orgs/${orgId}/tasks`),
  });
}

export function useCreateEnterprise(orgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EnterpriseInput) =>
      request<Enterprise>(`/orgs/${orgId}/enterprises`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (created) => {
      client.setQueryData(enterpriseKeys.detail(created.id), created);
      // 先放进列表，新建任务页的下拉马上能选中它；再从后台重读
      client.setQueryData<Enterprise[]>(enterpriseKeys.list(orgId), (list) => (list ? [...list, created] : list));
      void client.invalidateQueries({ queryKey: enterpriseKeys.list(orgId) });
    },
  });
}

export function useUpdateEnterprise(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EnterpriseUpdate) =>
      request<Enterprise>(`/enterprises/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (updated) => {
      client.setQueryData(enterpriseKeys.detail(id), updated);
      void client.invalidateQueries({ queryKey: enterpriseKeys.list(updated.orgId) });
    },
  });
}

// 没结束的任务（closedAt 为空）才算「在办」
export function openTasksOf(tasks: TaskSummary[] | undefined, enterpriseId: string): TaskSummary[] {
  return (tasks ?? []).filter((t) => t.enterpriseId === enterpriseId && t.closedAt === null);
}

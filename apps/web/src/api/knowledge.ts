import type { AgencyInput, AgencyRegionInput, KnowledgeAgenciesView, ProcessTemplate } from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

const agenciesKey = ['operator', 'knowledge', 'agencies'] as const;
const publishedKey = ['process-templates'] as const;
const json = (body: unknown) => JSON.stringify(body);

// 客户选工艺模板：已发布的那一版
export function useProcessTemplates() {
  return useQuery({
    queryKey: publishedKey,
    queryFn: async () => (await request<{ templates: ProcessTemplate[] }>('/process-templates')).templates,
    staleTime: 5 * 60_000,
  });
}

// ---------- 运营：属地应急机构 ----------

export function useKnowledgeAgencies() {
  return useQuery({ queryKey: agenciesKey, queryFn: () => request<KnowledgeAgenciesView>('/operator/knowledge/agencies') });
}

function useAgenciesMutation<T>(fn: (input: T) => Promise<KnowledgeAgenciesView>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (view) => client.setQueryData(agenciesKey, view) });
}

export const useAddRegion = () =>
  useAgenciesMutation((input: AgencyRegionInput) => request('/operator/knowledge/regions', { method: 'POST', body: json(input) }));
export const useUpdateRegion = () =>
  useAgenciesMutation(({ id, ...input }: AgencyRegionInput & { id: string }) =>
    request(`/operator/knowledge/regions/${id}`, { method: 'PUT', body: json(input) }),
  );
export const useAddAgency = () =>
  useAgenciesMutation((input: AgencyInput) => request('/operator/knowledge/agencies', { method: 'POST', body: json(input) }));
export const useUpdateAgency = () =>
  useAgenciesMutation(({ id, ...input }: AgencyInput & { id: string }) =>
    request(`/operator/knowledge/agencies/${id}`, { method: 'PUT', body: json(input) }),
  );
export const useAgencyAction = () =>
  useAgenciesMutation(({ id, action }: { id: string; action: 'verify' | 'disable' | 'enable' }) =>
    request(`/operator/knowledge/agencies/${id}/${action}`, { method: 'POST' }),
  );

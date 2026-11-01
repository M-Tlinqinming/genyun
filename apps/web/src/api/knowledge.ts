import type {
  AgencyInput,
  AgencyRegionInput,
  HolidayInput,
  KnowledgeAgenciesView,
  KnowledgeHolidaysView,
  KnowledgeTemplatesView,
  ProcessTemplate,
  TemplateContent,
} from '@genyun/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';

const agenciesKey = ['operator', 'knowledge', 'agencies'] as const;
const holidaysKey = ['operator', 'knowledge', 'holidays'] as const;
const templatesKey = ['operator', 'knowledge', 'templates'] as const;
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

// ---------- 运营：节假日 ----------

export function useKnowledgeHolidays() {
  return useQuery({ queryKey: holidaysKey, queryFn: () => request<KnowledgeHolidaysView>('/operator/knowledge/holidays') });
}

function useHolidaysMutation<T>(fn: (input: T) => Promise<KnowledgeHolidaysView>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (view) => client.setQueryData(holidaysKey, view) });
}

export const useSaveHoliday = () =>
  useHolidaysMutation((input: HolidayInput) => request('/operator/knowledge/holidays', { method: 'POST', body: json(input) }));
export const useRemoveHoliday = () =>
  useHolidaysMutation((date: string) => request(`/operator/knowledge/holidays/${date}`, { method: 'DELETE' }));

// ---------- 运营：工艺模板 ----------

export function useKnowledgeTemplates() {
  return useQuery({ queryKey: templatesKey, queryFn: () => request<KnowledgeTemplatesView>('/operator/knowledge/templates') });
}

function useTemplatesMutation<T, R extends KnowledgeTemplatesView>(fn: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      client.setQueryData(templatesKey, { templates: view.templates });
      void client.invalidateQueries({ queryKey: publishedKey });
    },
  });
}

export const useAddTemplate = () =>
  useTemplatesMutation((content: TemplateContent) =>
    request<KnowledgeTemplatesView & { id: string }>('/operator/knowledge/templates', { method: 'POST', body: json(content) }),
  );
export const useSaveTemplateDraft = () =>
  useTemplatesMutation(({ id, content }: { id: string; content: TemplateContent }) =>
    request<KnowledgeTemplatesView>(`/operator/knowledge/templates/${id}/draft`, { method: 'PUT', body: json(content) }),
  );
export const usePublishTemplate = () =>
  useTemplatesMutation(({ id, content }: { id: string; content: TemplateContent }) =>
    request<KnowledgeTemplatesView>(`/operator/knowledge/templates/${id}/publish`, { method: 'POST', body: json(content) }),
  );
export const useTemplateAction = () =>
  useTemplatesMutation(({ id, action }: { id: string; action: 'disable' | 'enable' }) =>
    request<KnowledgeTemplatesView>(`/operator/knowledge/templates/${id}/${action}`, { method: 'POST' }),
  );

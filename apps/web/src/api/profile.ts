import type {
  BasicStep,
  BasicStepField,
  BasicStepSave,
  EnterpriseInput,
  FieldSource,
  ChecklistItemKey,
  OrganizationStep,
  OrganizationStepSave,
  ProductionStep,
  ProductionStepSave,
} from '@genyun/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from './request';

export interface BasicStepView {
  enterpriseId: string;
  version: number;
  identity: EnterpriseInput;
  basic: BasicStep;
  later: BasicStepField[];
  sources: Partial<Record<string, FieldSource>>;
  license: { fileId: string; originalName: string } | null;
  recognizerAvailable: boolean;
  updatedAt: string;
}

export type RecognitionStatus = 'recognized' | 'unrecognized' | 'unavailable' | 'failed';

export interface LicenseResult extends BasicStepView {
  recognition: { status: RecognitionStatus; count: number };
}

export const basicStepKey = (enterpriseId: string) => ['enterprises', enterpriseId, 'basic-step'] as const;

// 填写过程中不自动重新拉取，避免把正在输入的内容冲掉；离开这一步就丢掉缓存，
// 回来时重新读取（各步共用一个版本号，旧缓存会让第一次保存被当成冲突）
const fillQueryOptions = { staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false } as const;

export function useBasicStep(enterpriseId: string | undefined) {
  return useQuery({
    queryKey: basicStepKey(enterpriseId ?? ''),
    queryFn: () => request<BasicStepView>(`/enterprises/${enterpriseId}/basic-step`),
    enabled: Boolean(enterpriseId),
    ...fillQueryOptions,
  });
}

export interface OrganizationStepView {
  enterpriseId: string;
  version: number;
  step: OrganizationStep;
  roster: { fileId: string; originalName: string }[];
  // 第 1 步填的员工人数，用于建议小组数量
  employeeCount: number | null;
  updatedAt: string;
}

export const organizationStepKey = (enterpriseId: string) => ['enterprises', enterpriseId, 'organization-step'] as const;

export function useOrganizationStep(enterpriseId: string | undefined) {
  return useQuery({
    queryKey: organizationStepKey(enterpriseId ?? ''),
    queryFn: () => request<OrganizationStepView>(`/enterprises/${enterpriseId}/organization-step`),
    enabled: Boolean(enterpriseId),
    ...fillQueryOptions,
  });
}

export function saveOrganizationStep(enterpriseId: string, body: OrganizationStepSave) {
  return request<OrganizationStepView>(`/enterprises/${enterpriseId}/organization-step`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// 花名册：挂到任务的「各应急小组成员」上，再记到企业资料里
export async function addRoster(taskId: string, enterpriseId: string, fileId: string) {
  await request(`/tasks/${taskId}/checklist/emergency_groups/files`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
  return request<OrganizationStepView>(`/enterprises/${enterpriseId}/roster`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

export async function removeRoster(taskId: string, enterpriseId: string, fileId: string) {
  await request(`/tasks/${taskId}/checklist/emergency_groups/files/${fileId}`, { method: 'DELETE' });
  return request<OrganizationStepView>(`/enterprises/${enterpriseId}/roster/${fileId}`, { method: 'DELETE' });
}

export interface ProductionStepView {
  enterpriseId: string;
  version: number;
  step: ProductionStep;
  // 照片、台账的文件名
  fileNames: Record<string, string>;
  // 第 1 步填的经营范围
  businessScope: string | null;
  // false = 还没保存过，页面显示的是预选内容
  saved: boolean;
  updatedAt: string;
}

export const productionStepKey = (enterpriseId: string) => ['enterprises', enterpriseId, 'production-step'] as const;

export function useProductionStep(enterpriseId: string | undefined) {
  return useQuery({
    queryKey: productionStepKey(enterpriseId ?? ''),
    queryFn: () => request<ProductionStepView>(`/enterprises/${enterpriseId}/production-step`),
    enabled: Boolean(enterpriseId),
    ...fillQueryOptions,
  });
}

export function saveProductionStep(enterpriseId: string, body: ProductionStepSave) {
  return request<ProductionStepView>(`/enterprises/${enterpriseId}/production-step`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// 把文件挂到任务的资料项上（台账、铭牌、包装标签），或移除
export async function linkItemFile(taskId: string, itemKey: ChecklistItemKey, fileId: string) {
  await request(`/tasks/${taskId}/checklist/${itemKey}/files`, { method: 'POST', body: JSON.stringify({ fileId }) });
}

export async function unlinkItemFile(taskId: string, itemKey: ChecklistItemKey, fileId: string) {
  await request(`/tasks/${taskId}/checklist/${itemKey}/files/${fileId}`, { method: 'DELETE' });
}

export function saveBasicStep(enterpriseId: string, body: BasicStepSave) {
  return request<BasicStepView>(`/enterprises/${enterpriseId}/basic-step`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// 别人在这之间保存过：页面要重新读取
export function isStale(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.body?.reason === 'stale';
}

// 上传一个文件（营业执照用「图片或 PDF」规则），返回文件 ID
export async function uploadFile(orgId: string, file: File, rule: 'material' | 'image_or_pdf'): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/orgs/${orgId}/files?rule=${rule}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new ApiError(res.status, typeof body?.message === 'string' ? body.message : '上传失败，请稍后重试', body);
  }
  return body!.id as string;
}

// 营业执照：挂到任务的资料清单上，再挂到企业并识别
export async function attachLicense(taskId: string, enterpriseId: string, fileId: string): Promise<LicenseResult> {
  await request(`/tasks/${taskId}/checklist/business_license/files`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
  return request<LicenseResult>(`/enterprises/${enterpriseId}/license`, {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

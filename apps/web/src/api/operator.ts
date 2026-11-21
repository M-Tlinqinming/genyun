import type {
  AdminInvitationInput,
  AssignExpertInput,
  BusinessType,
  CreditAdjustInput,
  CreditAdjustResult,
  GiftCampaignStats,
  InvitationState,
  OperatorOrgCredits,
  OrgCreditsBrief,
  OperatorNote,
  OperatorNoteInput,
  OperatorTaskGroup,
  OrgOpenDraft,
  OrgRegisterInput,
  OrgRenewalInput,
  OrgRenewalResult,
  OrgServiceState,
  RegionParts,
  Role,
  TaskViewTone,
  ServiceScopeKind,
} from '@genyun/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './request';
import type { MissingListView } from './workup';

// 运营看到的客户组织（Paper 16 页 I02）
export interface OperatorOrg {
  id: string;
  name: string;
  region: string | null;
  // 省、市、区县三级；老数据只有文字时为 null
  regionParts: RegionParts | null;
  socialCreditCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  note: string | null;
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  registeredByName: string | null;
  state: OrgServiceState;
  contract: { number: string; scopeKind: ServiceScopeKind | null; scopeEnterprises: number | null } | null;
}

export interface OperatorOrgRow extends OperatorOrg {
  // 次数汇总；待开通（还没有合同）为 null
  credits: OrgCreditsBrief | null;
  enterprises: number;
  members: number;
  openTasks: number;
}

export interface ContractFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByName: string;
  state: InvitationState;
}

export interface OrgEnterpriseTask {
  id: string;
  name: string;
  // 运营那一侧的状态标签（和任务中心同一套）
  task: { id: string; number: string; view: OperatorTaskViewBrief } | null;
}

// 组织的一份合同（详情「年度服务」页签，新的在前）。credits 按这份合同上各类型的台账行相加，不含交付扣减
export interface OrgContract {
  id: string;
  number: string;
  startsAt: string;
  endsAt: string;
  state: 'active' | 'upcoming' | 'expired';
  scopeKind: ServiceScopeKind | null;
  scopeEnterprises: number | null;
  paymentConfirmedAt: string;
  paymentConfirmedByName: string;
  credits: { purchase: number; gift: number; topUp: number; compensation: number };
  file: { id: string; originalName: string; createdAt: string } | null;
}

// 组织详情（Paper 16 页 I03）：还没挂到合同上的合同原件、合同列表、成员、邀请记录（新的在前）、企业与当前任务
export interface OperatorOrgDetail extends OperatorOrg {
  contractFile: ContractFile | null;
  contracts: OrgContract[];
  members: OrgMember[];
  invitations: OrgInvitation[];
  enterprises: OrgEnterpriseTask[];
}

export interface SentInvitation {
  email: string;
  expiresAt: string;
  mailSent: boolean;
  mailSimulated: boolean;
  // 模拟发件箱开放（预览环境）：提示里可以说「可在模拟发件箱查看」
  mailInOutbox: boolean;
}

export const operatorOrgKeys = {
  list: ['operator', 'organizations'] as const,
  detail: (id: string) => ['operator', 'organizations', id] as const,
  credits: (id: string) => ['operator', 'organizations', id, 'credits'] as const,
  giftCampaigns: (year: number | null) => ['operator', 'gift-campaigns', year ?? 'current'] as const,
};

// 次数变了以后要刷新的：列表、详情、次数、运营概览、赠送统计
function invalidateCredits(client: ReturnType<typeof useQueryClient>, id: string) {
  void client.invalidateQueries({ queryKey: operatorOrgKeys.list, exact: true });
  void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(id) });
  void client.invalidateQueries({ queryKey: ['operator', 'overview'] });
  void client.invalidateQueries({ queryKey: ['operator', 'gift-campaigns'] });
}

export function useOperatorOrgs() {
  return useQuery({ queryKey: operatorOrgKeys.list, queryFn: () => request<OperatorOrgRow[]>('/operator/organizations') });
}

export function useOperatorOrg(id: string | null) {
  return useQuery({
    queryKey: operatorOrgKeys.detail(id ?? ''),
    queryFn: () => request<OperatorOrgDetail>(`/operator/organizations/${id}`),
    enabled: id !== null,
  });
}

export function useSaveOrg(id: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OrgRegisterInput) =>
      request<OperatorOrg>(id ? `/operator/organizations/${id}` : '/operator/organizations', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(saved.id) });
    },
  });
}

export function useOpenOrg(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: OrgOpenDraft) =>
      request<OperatorOrg & { invitation: SentInvitation }>(
        `/operator/organizations/${id}/open`,
        { method: 'POST', body: JSON.stringify(draft) },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(id) });
    },
  });
}

// 重发首位管理员邀请，或换一个人：旧链接作废，按这里填的人重新发一封
export function useInviteAdmin(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminInvitationInput) =>
      request<SentInvitation>(`/operator/organizations/${id}/admin-invitation`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: operatorOrgKeys.list });
      void client.invalidateQueries({ queryKey: operatorOrgKeys.detail(id) });
    },
  });
}

// 一个组织的次数：汇总、等次数的成果、调整会记在哪份合同上、台账明细
export function useOrgCredits(id: string, enabled = true) {
  return useQuery({
    queryKey: operatorOrgKeys.credits(id),
    queryFn: () => request<OperatorOrgCredits>(`/operator/organizations/${id}/credits`),
    enabled,
  });
}

export function useAdjustCredits(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreditAdjustInput) =>
      request<CreditAdjustResult>(`/operator/organizations/${id}/credits`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateCredits(client, id),
  });
}

// 登记续约：新合同、次数、组织上的到期日一起改；返回放开了几份成果
export function useRenewOrg(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OrgRenewalInput) =>
      request<OrgRenewalResult>(`/operator/organizations/${id}/renewal`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateCredits(client, id),
  });
}

// 赠送活动统计；year 为 null 时按今年
export function useGiftCampaigns(year: number | null) {
  return useQuery({
    queryKey: operatorOrgKeys.giftCampaigns(year),
    queryFn: () => request<GiftCampaignStats>(`/operator/credits/gift-campaigns${year ? `?year=${year}` : ''}`),
    // 换年份时先留着上一年的，免得年份下拉和汇总一闪而空
    placeholderData: keepPreviousData,
  });
}

// 上传已签合同原件（只收 PDF，20 MB 以内）
export async function uploadContractFile(orgId: string, file: File): Promise<ContractFile> {
  const form = new FormData();
  form.append('file', file);
  // 走 request：服务出错、断网时提示和其他请求一样
  return request<ContractFile>(`/operator/organizations/${orgId}/contract-file`, { method: 'POST', body: form });
}

/** 运营那一侧的状态：标签文字、颜色、下面一行说明 */
export interface OperatorTaskViewBrief {
  key: string;
  label: string;
  tone: TaskViewTone;
  detail: string | null;
}

// 运营任务中心（Paper 16 页 I04）：全部客户任务（含已交付），后台已按默认顺序排好
export interface OperatorTask {
  id: string;
  number: string;
  name: string;
  businessType: BusinessType;
  orgId: string;
  orgName: string;
  orgRegion: string | null;
  orgRegionProvince: string | null;
  orgRegionCity: string | null;
  orgRegionDistrict: string | null;
  enterpriseId: string;
  enterpriseName: string;
  status: 'preparing' | 'submitted';
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  assignedExpertId: string | null;
  assignedExpertName: string | null;
  assignedAt: string | null;
  view: OperatorTaskViewBrief;
  group: OperatorTaskGroup;
  /** 待分配 = 提交时间，等客户补资料 = 列出缺项的时间，其余为空 */
  waitingSince: string | null;
  activityAt: string;
  deliveredAt: string | null;
  canReassign: boolean;
  needsAssignment: boolean;
  assignBlockedReason: string | null;
}

// 抽屉：多了地区全称、组织主联系人（完整手机号）、缺项数、有没有正文可看
export interface OperatorTaskDetail extends OperatorTask {
  region: string | null;
  contactName: string | null;
  contactPhone: string | null;
  awaitingCustomerSince: string | null;
  awaitingCustomerItems: number | null;
  hasDraft: boolean;
}

export interface AssignableExpert {
  id: string;
  name: string;
  email: string;
  /** 头像代码 gy1–gy8，没选为空 */
  avatar: string | null;
  /** 擅长的行业代码 */
  industries: string[];
  openTasks: number;
  current: boolean;
  /** 专家已暂停接单：列出来但置灰、不能选 */
  paused: boolean;
}

export const operatorTaskKeys = {
  list: ['operator', 'tasks'] as const,
  detail: (id: string) => ['operator', 'tasks', id] as const,
  experts: (id: string) => ['operator', 'tasks', id, 'experts'] as const,
  notes: (id: string) => ['operator', 'tasks', id, 'notes'] as const,
  missingList: (id: string) => ['operator', 'tasks', id, 'missing-list'] as const,
};

// 抽屉「等客户补资料」的缺项清单（和专家的查看缺项同一个形状）。每次打开抽屉都重新取：专家可能刚代客户传上东西
export function useOperatorMissingList(taskId: string, enabled = true) {
  return useQuery({
    queryKey: operatorTaskKeys.missingList(taskId),
    queryFn: () => request<MissingListView>(`/operator/tasks/${taskId}/missing-list`),
    refetchOnMount: 'always',
    enabled,
  });
}

// 运营在任务上的记录（内部备注、提醒专家、改派），客户和专家看不到
export function useOperatorNotes(taskId: string) {
  return useQuery({ queryKey: operatorTaskKeys.notes(taskId), queryFn: () => request<OperatorNote[]>(`/operator/tasks/${taskId}/notes`) });
}

export function useAddOperatorNote(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OperatorNoteInput) =>
      request<OperatorNote[]>(`/operator/tasks/${taskId}/notes`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (notes) => client.setQueryData(operatorTaskKeys.notes(taskId), notes),
  });
}

export function useOperatorTasks() {
  return useQuery({ queryKey: operatorTaskKeys.list, queryFn: () => request<OperatorTask[]>('/operator/tasks') });
}

export function useOperatorTask(id: string | null) {
  return useQuery({
    queryKey: operatorTaskKeys.detail(id ?? ''),
    queryFn: () => request<OperatorTaskDetail>(`/operator/tasks/${id}`),
    enabled: id !== null,
  });
}

export function useAssignableExperts(taskId: string) {
  return useQuery({
    queryKey: operatorTaskKeys.experts(taskId),
    queryFn: () => request<AssignableExpert[]>(`/operator/tasks/${taskId}/experts`),
  });
}

// 分配或改派；别人刚改过时后台返回 409，列表和详情都重新取，让运营看到最新情况再决定
export function useAssignExpert(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignExpertInput) =>
      request<OperatorTask>(`/operator/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify(input) }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: operatorTaskKeys.list });
      void client.invalidateQueries({ queryKey: operatorTaskKeys.detail(taskId) });
      void client.invalidateQueries({ queryKey: operatorTaskKeys.experts(taskId) });
      // 改派记一条运营记录
      void client.invalidateQueries({ queryKey: operatorTaskKeys.notes(taskId) });
      // 组织详情「企业与任务」里的阶段跟着变
      void client.invalidateQueries({ queryKey: ['operator', 'organizations'] });
      // 概览统计和侧栏「任务中心」的待分配数字
      void client.invalidateQueries({ queryKey: ['operator', 'overview'] });
    },
  });
}

// 事实补件（M2 第 13 项，Paper 15 页 R00a、R00b、R00c）。前后端共用。
// 专家发现企业事实可能变了（如客户换了应急联系人、资料库有了新版名册），在任务里请客户确认；
// 客户提交文件或说明（R00a）；专家对照原件写下本轮采用的值并明确采用（R00b），才改本任务的企业事实；
// 之后按新事实重新生成三份草稿（R00c）。客户回应本身不改任务输入。
import { z } from 'zod';
import { CHECKLIST_ITEMS, type ChecklistItemKey } from './checklist/items.ts';
import { factPersonSchema, factSaveError, formatFact, type FactDef, type FactKind, type FactValue } from './workup.ts';

// awaiting_customer = 等客户回应；awaiting_expert = 客户已回应、等专家核实；adopted = 专家已明确采用；
// returned = 专家认为还不够，转入下一轮
export const SUPPLEMENT_STATUSES = ['awaiting_customer', 'awaiting_expert', 'adopted', 'returned'] as const;
export type SupplementStatus = (typeof SUPPLEMENT_STATUSES)[number];

// 本轮要核对的一项企业事实：发起时记下本任务原来用的值；采用时写下本轮采用的值和核实依据
export interface SupplementFact {
  key: string;
  label: string;
  kind: FactKind;
  before: FactValue | null;
  after?: FactValue;
  basis?: string;
}

export interface SupplementFile {
  id: string;
  name: string;
  // 来自企业资料库的带版本号
  version: number | null;
}

export interface SupplementResponse {
  fileIds: string[];
  note: string | null;
  at: string;
  byName: string;
}

// 专家看到的一轮补件
export interface FactSupplement {
  id: string;
  round: number;
  status: SupplementStatus;
  title: string;
  message: string;
  // 请客户提供哪一项资料的文件；null = 写说明即可
  itemKey: ChecklistItemKey | null;
  needsFile: boolean;
  facts: SupplementFact[];
  createdAt: string;
  createdByName: string;
  response: SupplementResponse | null;
  files: SupplementFile[];
  adoptedAt: string | null;
  adoptedByName: string | null;
  // 采用以后有没有按新事实重新生成过
  regenerated: boolean;
}

// 客户看到的一轮：不含本任务原来用的值和专家写的采用值
export type CustomerSupplement = Pick<
  FactSupplement,
  'id' | 'round' | 'title' | 'message' | 'itemKey' | 'needsFile' | 'createdAt' | 'createdByName' | 'response' | 'files' | 'adoptedAt'
> & { status: SupplementStatus; labels: string[] };

const itemKeys = CHECKLIST_ITEMS.map((i) => i.key) as [ChecklistItemKey, ...ChecklistItemKey[]];

export const supplementCreateSchema = z.object({
  title: z.string().trim().min(1, '请写本轮要客户确认什么').max(40, '标题最多 40 个字'),
  message: z.string().trim().min(1, '请写给客户的说明').max(300, '说明最多 300 个字'),
  factKeys: z.array(z.string().min(1).max(80)).min(1, '至少选一项要核对的企业事实').max(10, '一轮最多核对 10 项'),
  needsFile: z.boolean(),
  itemKey: z.enum(itemKeys).nullable().default(null),
});
export type SupplementCreate = z.infer<typeof supplementCreateSchema>;

export const supplementResponseSchema = z.object({
  fileIds: z.array(z.uuid()).max(5, '一次最多提供 5 个文件').default([]),
  note: z.string().trim().max(500, '补充说明最多 500 个字').optional(),
  // 「我已核对上述资料，确认其反映企业当前实际情况」
  confirmed: z.literal(true, { error: '请勾选确认' }),
});
export type SupplementResponseInput = z.infer<typeof supplementResponseSchema>;

export function supplementResponseError(s: Pick<FactSupplement, 'needsFile'>, input: SupplementResponseInput): string | null {
  if (s.needsFile && input.fileIds.length === 0) return '请提供补充文件';
  if (input.fileIds.length === 0 && !input.note) return '请上传文件或写补充说明';
  return null;
}

export const supplementAdoptSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        value: z.union([z.string().trim().min(1, '请填写本轮采用的值').max(500, '最多 500 个字'), z.number(), factPersonSchema]),
        basis: z.string().trim().max(50, '核实依据最多 50 个字').optional(),
      }),
    )
    .min(1),
  // 「已核对原件与客户确认，以上事实可靠，其他本次输入仍适用」
  confirmed: z.literal(true, { error: '请勾选确认' }),
});
export type SupplementAdopt = z.infer<typeof supplementAdoptSchema>;

// 每一项都要写本轮采用的值，类型对得上
export function supplementAdoptError(
  facts: readonly SupplementFact[],
  input: SupplementAdopt,
  defOf: (key: string) => FactDef | undefined,
): string | null {
  for (const f of facts) {
    const a = input.facts.find((x) => x.key === f.key);
    if (!a) return `请填写「${f.label}」本轮采用的值`;
    const error = factSaveError(defOf(f.key), a.value);
    if (error) return `「${f.label}」：${error}`;
  }
  if (input.facts.some((a) => !facts.some((f) => f.key === a.key))) return '只能采用本轮核对的企业事实';
  return null;
}

export const supplementReturnSchema = z.object({
  message: z.string().trim().min(1, '请写还需要客户补充什么').max(300, '说明最多 300 个字'),
});

// 同一时间只有一轮在进行（等客户或等专家）
export const supplementOpen = (s: Pick<FactSupplement, 'status'>) => s.status === 'awaiting_customer' || s.status === 'awaiting_expert';

// 已采用、还没按新事实重新生成：R00c「本次资料已更新，原文稿尚未更新」
export const supplementPendingRegeneration = (s: Pick<FactSupplement, 'status' | 'regenerated'>) =>
  s.status === 'adopted' && !s.regenerated;

// 本任务原来用的值，写成一行文字（表格「本任务原来使用」）
export const supplementBefore = (f: SupplementFact) => (f.before === null ? '（空）' : formatFact(f.before, f.kind));

// 给客户的默认标题和说明：按要核对的事实拼一句，专家可以改
export function defaultSupplementText(facts: readonly Pick<SupplementFact, 'label' | 'before' | 'kind'>[]): { title: string; message: string } {
  const labels = facts.map((f) => f.label);
  const title = `请确认${labels.slice(0, 3).join('、')}${labels.length > 3 ? '等' : ''}`.slice(0, 40);
  const known = facts.filter((f) => f.before !== null).map((f) => `${f.label}为${formatFact(f.before!, f.kind)}`);
  const message = `${known.length ? `本任务目前使用的${known.join('，')}。` : ''}请确认企业当前实际情况，并提供有效资料。`.slice(0, 300);
  return { title, message };
}

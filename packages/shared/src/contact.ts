// 联系客户与联系记录（Paper 14 页 E18-00E；TECH-PLAN 3.3 客户沟通）。前后端共用。
// 负责专家两种方式问客户：在任务里发补充请求（进客户待补清单 + 站内提醒，不发邮件），
// 或自己打电话后填结果。每次联系记一条，客户看不到联系记录本身，只看到发给他的问题。
import { z } from 'zod';
import { CHECKLIST_ITEMS, type ChecklistItemKey } from './checklist/items.ts';
import { factPersonSchema, type FactKind, type FactValue, type WorkupData } from './workup.ts';

export const CONTACT_METHODS = {
  request: '请客户在任务里补充',
  phone: '我打电话问',
} as const;
export type ContactMethod = keyof typeof CONTACT_METHODS;

export const CONTACT_RESULTS = {
  clarified: '已问清',
  later: '客户稍后补',
  unreachable: '未接通',
} as const;
export type ContactResult = keyof typeof CONTACT_RESULTS;

// 要问的一个问题：对应一项企业事实、客户请专家电话联系的一项资料，或专家自己写的问题
export interface ContactQuestion {
  id: string;
  factKey?: string;
  itemKey?: ChecklistItemKey;
  label: string;
  question: string;
  // 电话：专家记下的回答；任务内补充：客户的回答
  answer?: string;
  // 电话问清的企业事实：回填的值
  value?: FactValue;
  // 客户回答时附的文件
  fileIds?: string[];
}

// 拨打对象：从企业事实里带出的人
export interface ContactTarget {
  name: string;
  role: string;
  phone: string;
}

export interface ContactRecord {
  id: string;
  method: ContactMethod;
  questions: ContactQuestion[];
  target: ContactTarget | null;
  result: ContactResult | null;
  createdAt: string;
  createdByName: string;
  // 任务内补充：客户回答的时间与人；电话没有
  answeredAt: string | null;
  answeredByName: string | null;
}

const questionInputSchema = z.object({
  factKey: z.string().min(1).max(80).optional(),
  itemKey: z.enum(CHECKLIST_ITEMS.map((i) => i.key) as [ChecklistItemKey, ...ChecklistItemKey[]]).optional(),
  label: z.string().trim().min(1, '请写问题的标题').max(50, '标题最多 50 个字'),
  question: z.string().trim().min(1, '请写要问的问题').max(200, '问题最多 200 个字'),
  answer: z.string().trim().max(500, '回答最多 500 个字').optional(),
  value: z.union([z.string().trim().min(1).max(500), z.number(), factPersonSchema]).optional(),
});
export type ContactQuestionInput = z.infer<typeof questionInputSchema>;

const questionsSchema = z.array(questionInputSchema).min(1, '至少问一个问题').max(10, '一次最多问 10 个问题');

export const contactCreateSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('request'), questions: questionsSchema }),
  z.object({
    method: z.literal('phone'),
    questions: questionsSchema,
    target: z.object({
      name: z.string().trim().min(1).max(50),
      role: z.string().trim().max(50),
      phone: z.string().trim().min(1).max(30),
    }),
    result: z.enum(Object.keys(CONTACT_RESULTS) as [ContactResult, ...ContactResult[]]),
  }),
]);
export type ContactCreate = z.infer<typeof contactCreateSchema>;

// 电话问清时每个问题都要有回答；企业事实还要有能回填的值
export function contactCreateError(input: ContactCreate): string | null {
  if (input.method !== 'phone' || input.result !== 'clarified') return null;
  const missing = input.questions.find((q) => (q.factKey ? q.value === undefined : !q.answer));
  return missing ? `请填写「${missing.label}」的回答` : null;
}

// 客户回答补充请求：每个问题写文字或附文件，一次提交
export const contactAnswerSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(20),
        text: z.string().trim().max(500, '回答最多 500 个字').optional(),
        fileIds: z.array(z.uuid()).max(5, '每个问题最多附 5 个文件').default([]),
      }),
    )
    .min(1),
});
export type ContactAnswer = z.infer<typeof contactAnswerSchema>;

export function contactAnswerError(questions: readonly ContactQuestion[], input: ContactAnswer): string | null {
  for (const q of questions) {
    const a = input.answers.find((x) => x.questionId === q.id);
    if (!a || (!a.text && a.fileIds.length === 0)) return `请回答「${q.label}」，写文字或附文件都可以`;
  }
  return null;
}

// 按企业事实的类型给出默认问法，专家可以改
export function defaultQuestion(label: string, kind: FactKind): string {
  if (kind === 'count') return `公司现在有多少${label.replace(/(人数|数)$/, '')}？`;
  if (kind === 'person') return `${label}是谁？请提供姓名、职位和手机。`;
  return `请提供${label}。`;
}

// 客户请专家电话联系的资料项
export function itemQuestion(itemKey: ChecklistItemKey): Pick<ContactQuestion, 'itemKey' | 'label' | 'question'> {
  const label = CHECKLIST_ITEMS.find((i) => i.key === itemKey)!.label;
  return { itemKey, label, question: `客户请专家电话联系，问清「${label}」的实际情况。` };
}

// 客户请专家电话联系后，联系上客户（已问清 / 客户稍后补）才算已联系；未接通和任务内补充都不停 2 个工作日的倒计时
// （2026-10-29 Martin 确认未接通不算）
export function reachedCustomer(records: readonly Pick<ContactRecord, 'method' | 'result' | 'createdAt'>[], since: Date): boolean {
  return records.some(
    (r) => r.method === 'phone' && (r.result === 'clarified' || r.result === 'later') && new Date(r.createdAt) >= since,
  );
}

// 客户已回答、专家还没「采用」的企业事实（Martin 10-29：客户的回答由专家看过后点采用才写进企业事实）
export function awaitingAdoption(records: readonly ContactRecord[], data: WorkupData): Map<string, { contactId: string; answer: string }> {
  // 同一项问过多次时只看最近一次回答
  const latest = new Map<string, { contactId: string; answer: string }>();
  const answered = records.filter((r) => r.method === 'request' && r.answeredAt);
  answered.sort((a, b) => a.answeredAt!.localeCompare(b.answeredAt!));
  for (const r of answered) {
    for (const q of r.questions) if (q.factKey && q.answer) latest.set(q.factKey, { contactId: r.id, answer: q.answer });
  }
  for (const [key, v] of latest) if (data.overrides[key]?.contactId === v.contactId) latest.delete(key);
  return latest;
}

// 拨打对象的号码只露前三后四：138 **** 2071
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)} **** ${digits.slice(-4)}`;
}

import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import {
  CONTACT_METHODS,
  CONTACT_RESULTS,
  defaultQuestion,
  formatFact,
  itemQuestion,
  maskPhone,
  type ChecklistItemKey,
  type ContactCreate,
  type ContactMethod,
  type ContactResult,
  type ContactTarget,
  type Fact,
  type FactPerson,
  type FactValue,
} from '@genyun/shared';
import { App, Button, Input, InputNumber, Modal, Select, Space } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useCreateContact } from '../../../api/contacts';
import { ApiError } from '../../../api/request';
import { linkButton } from '../../../components/ui';
import { gy } from '../../../theme/tokens';

const muted = '#3F4A5C';
const label: CSSProperties = { fontSize: 14, lineHeight: '22px', color: gy.text };

interface Draft {
  id: string;
  factKey?: string;
  itemKey?: ChecklistItemKey;
  label: string;
  question: string;
  // 企业事实的类型：电话回答按类型填写，能直接回填
  fact?: Fact;
  answer: string;
  value: FactValue | null;
}

let seq = 0;
const nextId = () => `d${++seq}`;

function fromFact(fact: Fact): Draft {
  return { id: nextId(), factKey: fact.key, label: fact.label, question: defaultQuestion(fact.label, fact.kind), fact, answer: '', value: null };
}

// 拨打对象：企业事实里有电话的人（总指挥、联系人、副总指挥）
export function contactTargets(facts: readonly Fact[]): ContactTarget[] {
  const out: ContactTarget[] = [];
  for (const f of facts) {
    if (f.kind === 'person' && typeof f.value === 'object' && f.value.phone && (f.key === 'commander' || f.key.startsWith('deputy.'))) {
      out.push({ name: f.value.name, role: f.label, phone: f.value.phone });
    }
  }
  const person = facts.find((f) => f.key === 'contactPerson')?.value;
  const phone = facts.find((f) => f.key === 'contactPhone')?.value;
  if (typeof person === 'string' && typeof phone === 'string' && !out.some((t) => t.phone === phone)) {
    out.splice(1, 0, { name: person, role: '联系人', phone });
  }
  return out;
}

// 联系客户（14 页 E18-00E）：请客户在任务里补充，或自己打电话后记下回答与结果
export function ContactDialog({
  taskId,
  open,
  onClose,
  facts,
  initialKeys,
  callItems,
}: {
  taskId: string;
  open: boolean;
  onClose: () => void;
  facts: Fact[];
  // 从某个缺失项点进来时只带这一项；从顶部进来带全部缺失项
  initialKeys: string[];
  // 客户请专家电话联系、还没问清的资料项
  callItems: ChecklistItemKey[];
}) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={560} destroyOnHidden styles={{ container: { padding: 0, borderRadius: 8 } }}>
      <DialogBody taskId={taskId} onClose={onClose} facts={facts} initialKeys={initialKeys} callItems={callItems} />
    </Modal>
  );
}

function DialogBody({
  taskId,
  onClose,
  facts,
  initialKeys,
  callItems,
}: {
  taskId: string;
  onClose: () => void;
  facts: Fact[];
  initialKeys: string[];
  callItems: ChecklistItemKey[];
}) {
  const { message } = App.useApp();
  const create = useCreateContact(taskId);
  const targets = contactTargets(facts);
  const [method, setMethod] = useState<ContactMethod>(callItems.length > 0 ? 'phone' : 'request');
  const [drafts, setDrafts] = useState<Draft[]>(() => [
    ...initialKeys.map((k) => facts.find((f) => f.key === k)).filter((f): f is Fact => !!f).map(fromFact),
    ...callItems.map((key) => ({ id: nextId(), ...itemQuestion(key), answer: '', value: null })),
  ]);
  const [target, setTarget] = useState<ContactTarget | null>(targets[0] ?? null);
  const [result, setResult] = useState<ContactResult>('clarified');

  const update = (id: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => setDrafts((list) => list.filter((d) => d.id !== id));
  const addable = facts.filter((f) => !f.readonly && !drafts.some((d) => d.factKey === f.key));

  const clarified = method === 'phone' && result === 'clarified';
  const unanswered = clarified ? drafts.find((d) => (d.fact ? d.value === null : !d.answer.trim())) : undefined;
  const blocker =
    drafts.length === 0
      ? '至少问一个问题'
      : drafts.find((d) => !d.question.trim())
        ? '请写要问的问题'
        : method === 'phone' && !target
          ? '企业资料里还没有能拨打的电话'
          : unanswered
            ? `请填写「${unanswered.label}」的回答`
            : null;

  const submit = async () => {
    if (blocker) return;
    const questions = drafts.map((d) => {
      const q: ContactCreate['questions'][number] = { label: d.label, question: d.question.trim() };
      if (d.factKey) q.factKey = d.factKey;
      if (d.itemKey) q.itemKey = d.itemKey;
      if (method === 'phone') {
        const answer = d.fact ? formatFact(d.value ?? undefined, d.fact.kind) : d.answer.trim();
        if (answer) q.answer = answer;
        if (clarified && d.fact && d.value !== null) q.value = d.value;
      }
      return q;
    });
    const input: ContactCreate =
      method === 'request' ? { method, questions } : { method, questions, target: target!, result };
    try {
      await create.mutateAsync(input);
      message.success(method === 'request' ? '已发给客户，客户回答后会提醒您' : clarified ? '已保存，回答已回填' : '已记入联系记录');
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };

  const copy = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      message.success('号码已复制');
    } catch {
      message.info(`号码：${phone}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: gy.text }}>联系客户</h2>
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>您是这个任务的负责专家，直接问客户；回答会回填到这里。</span>
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} style={{ ...linkButton, color: gy.tertiary, marginTop: 4 }}>
          <CloseOutlined />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 24px 20px', maxHeight: 620, overflowY: 'auto' }}>
        <Group title="怎么问">
          <Choices
            value={method}
            options={(Object.keys(CONTACT_METHODS) as ContactMethod[]).map((m) => ({ value: m, label: CONTACT_METHODS[m] }))}
            onChange={setMethod}
          />
        </Group>

        <Group title="要问的问题">
          {drafts.map((d, i) => (
            <QuestionCard
              key={d.id}
              n={i + 1}
              draft={d}
              phone={method === 'phone'}
              onChange={(patch) => update(d.id, patch)}
              onRemove={() => remove(d.id)}
            />
          ))}
          <Space size={12}>
            <Select
              size="small"
              placeholder="添加要问的企业事实"
              value={null}
              style={{ width: 200 }}
              options={addable.map((f) => ({ value: f.key, label: f.label }))}
              onChange={(key: string) => {
                const fact = facts.find((f) => f.key === key);
                if (fact) setDrafts((list) => [...list, fromFact(fact)]);
              }}
            />
            <button
              type="button"
              style={{ ...linkButton, fontSize: 13 }}
              onClick={() => setDrafts((list) => [...list, { id: nextId(), label: '其他问题', question: '', answer: '', value: null }])}
            >
              <PlusOutlined /> 自己写一个问题
            </button>
          </Space>
        </Group>

        {method === 'phone' && (
          <>
            <Group title="拨打对象 · 任务联系人">
              {targets.length === 0 ? (
                <span style={{ fontSize: 13, color: gy.secondary }}>企业资料里还没有总指挥或联系人的电话。</span>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {targets.map((t) => {
                    const on = target?.phone === t.phone && target.name === t.name;
                    return (
                      <div
                        key={`${t.role}-${t.phone}`}
                        role="radio"
                        aria-checked={on}
                        tabIndex={0}
                        onClick={() => setTarget(t)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTarget(t)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: `1px solid ${on ? gy.primary : gy.split}`,
                          background: on ? gy.selected : gy.surface,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={label}>
                            {t.name} · {t.role}
                          </span>
                          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{maskPhone(t.phone)}</span>
                        </span>
                        <button
                          type="button"
                          style={{ ...linkButton, fontSize: 13 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copy(t.phone);
                          }}
                        >
                          复制号码
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Group>
            <Group title="这次联系结果">
              <Choices
                value={result}
                options={(Object.keys(CONTACT_RESULTS) as ContactResult[]).map((r) => ({ value: r, label: CONTACT_RESULTS[r] }))}
                onChange={setResult}
              />
            </Group>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 6, background: gy.selected }}>
          {method === 'phone' ? (
            <>
              <span style={{ fontSize: 13, lineHeight: '20px', color: muted }}>
                用自己的电话拨打即可，客户页面不显示您的号码。保存后回答回填到字段，并记入任务联系记录。
              </span>
              <span style={{ fontSize: 13, lineHeight: '20px', color: muted }}>
                未接通也请记一条：客户请求联系的 2 个工作日要等联系上客户才停止计算。
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, lineHeight: '20px', color: muted }}>
              问题直接出现在客户的待补清单，系统发站内提醒，不用您追；客户回答后您会收到提醒，看过后点「采用」写进企业事实。
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 20px' }}>
        {blocker && drafts.length > 0 && <span style={{ flex: 1, fontSize: 13, color: gy.tertiary }}>{blocker}</span>}
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={submit} loading={create.isPending} disabled={!!blocker}>
          {method === 'request' ? '发给客户' : clarified ? '保存并回填' : '保存联系记录'}
        </Button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={label}>{title}</span>
      {children}
    </div>
  );
}

function Choices<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              border: `1px solid ${on ? gy.primary : '#D9D9D9'}`,
              background: on ? gy.selected : gy.surface,
              color: on ? gy.primary : gy.text,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({
  n,
  draft,
  phone,
  onChange,
  onRemove,
}: {
  n: number;
  draft: Draft;
  phone: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const from = draft.fact ? '来自「企业事实」' : draft.itemKey ? '客户请专家电话联系' : '自己写的问题';
  return (
    <div
      data-question={draft.factKey ?? draft.itemKey ?? draft.id}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 6, border: `1px solid ${gy.split}`, background: '#FAFAFB' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {draft.fact || draft.itemKey ? (
          <span style={{ flex: 1, fontSize: 14, fontWeight: 500, lineHeight: '22px', color: gy.text }}>
            {n} · {draft.label}
          </span>
        ) : (
          <Input
            size="small"
            variant="borderless"
            value={draft.label}
            maxLength={50}
            aria-label={`第 ${n} 个问题的标题`}
            onChange={(e) => onChange({ label: e.target.value })}
            style={{ flex: 1, padding: 0, fontSize: 14, fontWeight: 500 }}
            prefix={<span style={{ fontWeight: 500 }}>{n} ·</span>}
          />
        )}
        <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>{from}</span>
        <button type="button" aria-label={`不问${draft.label}`} onClick={onRemove} style={{ ...linkButton, color: gy.tertiary, fontSize: 12 }}>
          <CloseOutlined />
        </button>
      </div>
      <Input.TextArea
        autoSize={{ minRows: 1, maxRows: 3 }}
        variant="borderless"
        value={draft.question}
        maxLength={200}
        placeholder="写下要问客户的问题"
        aria-label={`问题：${draft.label}`}
        onChange={(e) => onChange({ question: e.target.value })}
        style={{ padding: 0, fontSize: 14, lineHeight: '22px', color: gy.text, resize: 'none' }}
      />
      {phone && <AnswerInput draft={draft} onChange={onChange} />}
    </div>
  );
}

// 电话回答：企业事实按类型填，保存后直接回填；其他问题写文字
function AnswerInput({ draft, onChange }: { draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  const aria = `回答：${draft.label}`;
  const kind = draft.fact?.kind;
  if (kind === 'count') {
    return (
      <InputNumber
        min={0}
        precision={0}
        suffix="人"
        placeholder="客户的回答"
        value={typeof draft.value === 'number' ? draft.value : null}
        onChange={(v) => onChange({ value: v ?? null })}
        style={{ width: 200 }}
        aria-label={aria}
      />
    );
  }
  if (kind === 'person') {
    const p: FactPerson = typeof draft.value === 'object' && draft.value ? draft.value : { name: '', position: '', phone: '' };
    const set = (k: keyof FactPerson) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = { ...p, [k]: e.target.value };
      onChange({ value: next.name.trim() ? { name: next.name.trim(), position: next.position?.trim() || undefined, phone: next.phone?.trim() || undefined } : null });
    };
    return (
      <Space.Compact>
        <Input placeholder="姓名" defaultValue={p.name} onChange={set('name')} aria-label={`${aria} 姓名`} />
        <Input placeholder="职位" defaultValue={p.position ?? ''} onChange={set('position')} aria-label={`${aria} 职位`} />
        <Input placeholder="手机" defaultValue={p.phone ?? ''} onChange={set('phone')} aria-label={`${aria} 手机`} />
      </Space.Compact>
    );
  }
  if (kind === 'text') {
    return (
      <Input
        placeholder="客户的回答"
        maxLength={500}
        value={typeof draft.value === 'string' ? draft.value : ''}
        onChange={(e) => onChange({ value: e.target.value.trim() ? e.target.value : null })}
        aria-label={aria}
      />
    );
  }
  return <Input placeholder="客户的回答" maxLength={500} value={draft.answer} onChange={(e) => onChange({ answer: e.target.value })} aria-label={aria} />;
}

import { CheckOutlined, PaperClipOutlined } from '@ant-design/icons';
import {
  CHECKLIST_ITEMS,
  defaultSupplementText,
  formatFact,
  supplementBefore,
  supplementPendingRegeneration,
  type ChecklistItemKey,
  type Fact,
  type FactPerson,
  type FactSupplement,
  type FactValue,
  type SupplementFact,
} from '@genyun/shared';
import { App, Button, Checkbox, Input, InputNumber, Modal, Result, Select, Switch } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useSupplements } from '../../../api/supplements';
import { openFile } from '../../../api/documents';
import { ApiError } from '../../../api/request';
import { useAdoptSupplement, useCreateSupplement, useReturnSupplement } from '../../../api/supplements';
import { Loading, panel } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';

const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };
const text13: CSSProperties = { fontSize: 13, lineHeight: '20px' };
const h2: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };
const th: CSSProperties = { ...text13, color: gy.secondary, fontWeight: 400, textAlign: 'left', padding: '10px 12px', background: gy.canvas };
const td: CSSProperties = { ...text14, color: gy.text, padding: '12px', borderTop: `1px solid ${gy.split}`, verticalAlign: 'top' };

function stamp(iso: string): string {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('month')}.${v('day')} ${v('hour')}:${v('minute')}`;
}

const isPerson = (v: FactValue | null | undefined): v is FactPerson => typeof v === 'object' && v !== null;

// 当前这一轮：没结束的那轮，否则是采用了还没重新生成的那轮，否则最近一轮
export function currentSupplement(list: readonly FactSupplement[]): FactSupplement | undefined {
  return (
    list.find((s) => s.status === 'awaiting_customer' || s.status === 'awaiting_expert') ??
    list.find(supplementPendingRegeneration) ??
    list[0]
  );
}

// 事实补件（15 页 R00b、R00c）：客户回应后专家对照原件写下本轮采用的值，明确采用才改本任务的企业事实；
// 采用后提示按新事实重新生成三份草稿
export function SupplementView({
  taskId,
  list,
  isPending,
  onStart,
  onRegenerate,
  onBack,
}: {
  taskId: string;
  list: FactSupplement[] | undefined;
  isPending: boolean;
  onStart: () => void;
  onRegenerate: () => void;
  onBack: () => void;
}) {
  if (isPending || !list) return <Loading rows={6} />;
  const s = currentSupplement(list);
  if (!s) {
    return (
      <Result
        status="info"
        title="本任务还没有发起事实补件"
        subTitle="整理或编辑时发现企业事实可能变了，可以请客户确认并提供有效资料。"
        extra={[
          <Button key="start" type="primary" onClick={onStart}>
            发起事实补件
          </Button>,
          <Button key="back" onClick={onBack}>
            返回
          </Button>,
        ]}
      />
    );
  }
  return <Round key={`${s.id}-${s.status}`} taskId={taskId} s={s} onStart={onStart} onRegenerate={onRegenerate} onBack={onBack} />;
}

type Draft = Record<string, { value: FactValue | null; basis: string }>;

function initialDraft(s: FactSupplement): Draft {
  return Object.fromEntries(s.facts.map((f) => [f.key, { value: f.after ?? f.before ?? null, basis: f.basis ?? '' }]));
}

function Round({
  taskId,
  s,
  onStart,
  onRegenerate,
  onBack,
}: {
  taskId: string;
  s: FactSupplement;
  onStart: () => void;
  onRegenerate: () => void;
  onBack: () => void;
}) {
  const { message } = App.useApp();
  const adopt = useAdoptSupplement(taskId);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(s));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const verifying = s.status === 'awaiting_expert';
  const adopted = s.status === 'adopted';

  const status = adopted
    ? s.regenerated
      ? { title: '已按新事实重新生成', sub: '本轮补件已完成', text: `${s.adoptedByName}于 ${stamp(s.adoptedAt!)} 明确采用，三份草稿已按本次资料重新生成。`, tag: '已明确采用', tone: stage.done }
      : {
          title: '等待重新生成',
          sub: '本次资料已更新，原文稿尚未更新',
          text: `${s.adoptedByName}于 ${stamp(s.adoptedAt!)} 完成事实核实并明确采用。下一步根据本次资料重新生成三份待审核草稿。`,
          tag: '已明确采用',
          tone: stage.done,
        }
    : verifying
      ? {
          title: '补件待核实',
          sub: '客户已回应，等待注安师核实',
          text: `${s.response!.byName}于 ${stamp(s.response!.at)} 提交${s.response!.note ? `：${s.response!.note}` : '。'}${s.response!.note && !/[。！？]$/.test(s.response!.note) ? '。' : ''}当前任务仍采用原资料。`,
          tag: '尚未采用',
          tone: stage.action,
        }
      : s.status === 'returned'
        ? { title: '已请客户继续补充', sub: '本轮已结束', text: '本轮资料还不够，已转入下一轮。', tag: '未采用', tone: stage.progress }
        : {
            title: '等待客户回应',
            sub: `已于 ${stamp(s.createdAt)} 请客户确认`,
            text: `${s.title}。客户提交后，您会收到站内提醒；在您明确采用前，本任务仍采用原资料。`,
            tag: '尚未采用',
            tone: stage.progress,
          };

  const setValue = (key: string, value: FactValue | null) => setDraft((d) => ({ ...d, [key]: { basis: d[key]?.basis ?? '', value } }));
  const setBasis = (key: string, basis: string) => setDraft((d) => ({ ...d, [key]: { value: d[key]?.value ?? null, basis } }));

  const submit = async () => {
    for (const f of s.facts) {
      const v = draft[f.key]?.value;
      if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (isPerson(v) && !v.name.trim())) {
        return setError(`请填写「${f.label}」本轮采用的值`);
      }
    }
    if (!confirmed) return setError('请勾选确认');
    setError(null);
    try {
      await adopt.mutateAsync({
        id: s.id,
        confirmed: true,
        facts: s.facts.map((f) => {
          const d = draft[f.key] ?? { value: null, basis: '' };
          const v = d.value!;
          const value = isPerson(v)
            ? { name: v.name.trim(), position: v.position?.trim() || undefined, phone: v.phone?.trim() || undefined }
            : typeof v === 'string'
              ? v.trim()
              : v;
          return { key: f.key, value, basis: d.basis.trim() || undefined };
        }),
      });
      message.success('已采用到本任务');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '采用失败，请检查网络后重试');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-label="本轮补件状态" style={{ ...panel, padding: '20px 24px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h2 style={h2}>{status.title}</h2>
            <span style={{ ...text14, color: gy.secondary }}>{status.sub}</span>
          </div>
          <span style={{ ...text14, color: gy.text }}>{status.text}</span>
        </div>
        <span style={{ ...text13, lineHeight: '22px', padding: '1px 8px', borderRadius: 4, color: status.tone.color, background: status.tone.bg }}>
          {status.tag}
        </span>
      </section>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <section aria-label="核对本轮事实变化" style={{ ...panel, flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 style={{ ...h2, flex: 1 }}>核对本轮事实变化</h2>
            {s.files[0] && (
              <Button type="link" size="small" onClick={() => void openFile(s.files[0]!.id)} style={{ padding: 0 }}>
                打开原件与回应
              </Button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${gy.split}`, borderRadius: 6 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '22%' }}>核对项目</th>
                <th style={{ ...th, width: '24%' }}>本任务原来使用</th>
                <th style={th}>{adopted ? '本轮已采用' : '本轮拟采用'}</th>
                <th style={{ ...th, width: '22%' }}>核实依据</th>
              </tr>
            </thead>
            <tbody>
              {s.facts.map((f) => (
                <tr key={f.key}>
                  <td style={td}>{f.label}</td>
                  <td style={{ ...td, color: gy.secondary }}>{supplementBefore(f)}</td>
                  <td style={td}>
                    {verifying ? (
                      <ValueInput fact={f} value={draft[f.key]?.value ?? null} onChange={(v) => setValue(f.key, v)} />
                    ) : f.after !== undefined ? (
                      formatFact(f.after, f.kind)
                    ) : (
                      <span style={{ color: gy.tertiary }}>等客户回应后填写</span>
                    )}
                  </td>
                  <td style={td}>
                    {verifying ? (
                      <Input
                        aria-label={`${f.label}核实依据`}
                        value={draft[f.key]?.basis ?? ''}
                        maxLength={50}
                        placeholder="如：新名册第 1 页"
                        onChange={(e) => setBasis(f.key, e.target.value)}
                      />
                    ) : (
                      (f.basis ?? <span style={{ color: gy.tertiary }}>—</span>)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside aria-label="原件与本轮客户回应" style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={{ ...panel, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={h2}>原件与本轮客户回应</h2>
            {s.response ? (
              <>
                {s.files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => void openFile(file.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: `1px solid ${gy.split}`,
                      background: gy.canvas,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    <PaperClipOutlined aria-hidden style={{ color: gy.primary }} />
                    <span style={{ flex: 1, minWidth: 0, ...text14, color: gy.text }}>{file.name}</span>
                    {file.version !== null && <span style={{ ...text13, color: gy.secondary }}>V{file.version}</span>}
                  </button>
                ))}
                {s.response.note && <span style={{ ...text14, color: gy.text }}>补充说明：{s.response.note}</span>}
                <span style={{ ...text13, color: gy.success }}>
                  <CheckOutlined /> 客户确认 · {stamp(s.response.at)}
                </span>
              </>
            ) : (
              <span style={{ ...text14, color: gy.secondary }}>客户还没有回应。</span>
            )}
          </section>
          <section style={{ ...panel, padding: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ ...h2, fontSize: 14 }}>本次采用范围</h2>
            <span style={{ ...text13, color: gy.secondary }}>
              仅采用本轮核对的 {s.facts.length} 项企业事实；其他资料和事实不变。
            </span>
            <h2 style={{ ...h2, fontSize: 14, marginTop: 8 }}>原资料和人工修订保留</h2>
            <span style={{ ...text13, color: gy.secondary }}>
              明确采用后再生成新稿。旧稿不被覆盖，旧人工修订需逐项判断；新稿重新核对、审核后发布。
            </span>
          </section>
        </aside>
      </div>

      <footer
        style={{ ...panel, position: 'sticky', bottom: 0, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16, zIndex: 2 }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {verifying ? (
            <>
              <Checkbox
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  if (e.target.checked && error === '请勾选确认') setError(null);
                }}
              >
                已核对原件与客户确认，以上事实可靠，其他本次输入仍适用。
              </Checkbox>
              <span style={{ ...text13, color: gy.secondary }}>
                确认后更新已确认企业事实，并记录本任务采用的资料。仅客户提交回应不会自动改变任务输入。
              </span>
            </>
          ) : adopted ? (
            <span style={{ ...text14, color: gy.text }}>
              <CheckOutlined style={{ color: gy.success }} /> 已核对原件与客户确认，以上事实可靠，其他本次输入仍适用。
              <br />
              <span style={{ ...text13, color: gy.secondary }}>本次采用已记录。原稿上的核对与审核结论不能作为新稿发布依据。</span>
            </span>
          ) : (
            <span style={{ ...text14, color: gy.secondary }}>客户回应前不需要处理。</span>
          )}
          {error && (
            <span role="alert" style={{ ...text14, color: gy.error }}>
              {error}
            </span>
          )}
        </div>
        {verifying && (
          <>
            <Button size="large" onClick={() => setReturning(true)}>
              仍需客户补充
            </Button>
            <Button type="primary" size="large" loading={adopt.isPending} onClick={() => void submit()}>
              确认事实并采用到本任务
            </Button>
          </>
        )}
        {adopted && !s.regenerated && (
          <>
            <Button size="large" onClick={onBack}>
              暂不生成
            </Button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <Button type="primary" size="large" onClick={onRegenerate}>
                重新生成三份草稿
              </Button>
              <span style={{ ...text13, color: gy.secondary }}>继续原任务，无需客户再次申请</span>
            </div>
          </>
        )}
        {(s.status === 'returned' || (adopted && s.regenerated)) && (
          <Button size="large" onClick={onStart}>
            发起新一轮补件
          </Button>
        )}
        {s.status === 'awaiting_customer' && (
          <Button size="large" onClick={onBack}>
            返回
          </Button>
        )}
      </footer>
      <ReturnDialog taskId={taskId} id={s.id} open={returning} onClose={() => setReturning(false)} />
    </div>
  );
}

function ValueInput({ fact, value, onChange }: { fact: SupplementFact; value: FactValue | null; onChange: (v: FactValue | null) => void }) {
  if (fact.kind === 'person') {
    const p: FactPerson = isPerson(value) ? value : { name: '' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input aria-label={`${fact.label}姓名`} placeholder="姓名" value={p.name} maxLength={50} onChange={(e) => onChange({ ...p, name: e.target.value })} />
        <Input
          aria-label={`${fact.label}电话`}
          placeholder="电话"
          value={p.phone ?? ''}
          maxLength={30}
          onChange={(e) => onChange({ ...p, phone: e.target.value })}
        />
      </div>
    );
  }
  if (fact.kind === 'count') {
    return (
      <InputNumber
        aria-label={`${fact.label}本轮采用`}
        min={0}
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v ?? null)}
        style={{ width: '100%' }}
      />
    );
  }
  return (
    <Input
      aria-label={`${fact.label}本轮采用`}
      value={typeof value === 'string' ? value : ''}
      maxLength={500}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ReturnDialog({ taskId, id, open, onClose }: { taskId: string; id: string; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const back = useReturnSupplement(taskId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) return setError('请写还需要客户补充什么');
    try {
      await back.mutateAsync({ id, message: text.trim() });
      message.success('已请客户继续补充');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请检查网络后重试');
    }
  };
  return (
    <Modal
      open={open}
      title="仍需客户补充"
      onCancel={onClose}
      destroyOnHidden
      okText="请客户继续补充"
      cancelText="取消"
      onOk={() => void submit()}
      confirmLoading={back.isPending}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...text14, color: gy.secondary }}>本轮不采用，客户会在任务页看到新一轮说明。</span>
        <Input.TextArea
          aria-label="还需要客户补充什么"
          autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：名册上没有新联系人的电话，请补一页带电话的名册"
        />
        {error && (
          <span role="alert" style={{ ...text14, color: gy.error }}>
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}

// 发起事实补件：选要核对的企业事实，默认标题和说明按所选事实拼好，专家可以改
export function SupplementDialog({
  taskId,
  facts,
  initialKeys,
  open,
  onClose,
  onCreated,
}: {
  taskId: string;
  facts: readonly Fact[];
  initialKeys: string[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <Modal open={open} title="发起事实补件" onCancel={onClose} footer={null} width={600} destroyOnHidden>
      <SupplementForm taskId={taskId} facts={facts} initialKeys={initialKeys} onClose={onClose} onCreated={onCreated} />
    </Modal>
  );
}

function SupplementForm({
  taskId,
  facts,
  initialKeys,
  onClose,
  onCreated,
}: {
  taskId: string;
  facts: readonly Fact[];
  initialKeys: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const create = useCreateSupplement(taskId);
  const choices = facts.filter((f) => !f.readonly);
  const textFor = (keys: string[]) =>
    defaultSupplementText(
      keys.map((k) => choices.find((f) => f.key === k)).filter((f): f is Fact => !!f).map((f) => ({ label: f.label, kind: f.kind, before: f.value ?? null })),
    );
  const [keys, setKeys] = useState<string[]>(initialKeys);
  // 选完一项就收起下拉，不挡住下面的「发给客户」
  const [listOpen, setListOpen] = useState(false);
  const [title, setTitle] = useState(() => textFor(initialKeys).title);
  const [body, setBody] = useState(() => textFor(initialKeys).message);
  const [edited, setEdited] = useState(false);
  const firstItem = choices.find((f) => keys.includes(f.key) && f.itemKey)?.itemKey ?? null;
  const [needsFile, setNeedsFile] = useState(firstItem !== null);
  const [itemKey, setItemKey] = useState<ChecklistItemKey | null>(firstItem);
  const [error, setError] = useState<string | null>(null);

  const pick = (next: string[]) => {
    setKeys(next);
    setListOpen(false);
    if (!edited) {
      const t = textFor(next);
      setTitle(t.title);
      setBody(t.message);
    }
    if (!itemKey) setItemKey(choices.find((f) => next.includes(f.key) && f.itemKey)?.itemKey ?? null);
  };

  const submit = async () => {
    if (keys.length === 0) return setError('至少选一项要核对的企业事实');
    if (needsFile && !itemKey) return setError('请选择要客户提供哪一项资料');
    try {
      await create.mutateAsync({ title: title.trim(), message: body.trim(), factKeys: keys, needsFile, itemKey: needsFile ? itemKey : null });
      message.success('已发起，客户会在任务页看到');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发起失败，请检查网络后重试');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ ...text14, color: gy.secondary }}>
        客户提交后您会收到站内提醒。在您核实并明确采用前，本任务仍采用原资料。
      </span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...text14, color: gy.text }}>要核对的企业事实</span>
        <Select
          mode="multiple"
          aria-label="要核对的企业事实"
          value={keys}
          onChange={pick}
          open={listOpen}
          onOpenChange={setListOpen}
          listHeight={192}
          maxCount={10}
          optionFilterProp="label"
          options={choices.map((f) => ({ value: f.key, label: f.label }))}
          placeholder="选择企业事实"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...text14, color: gy.text }}>标题</span>
        <Input
          value={title}
          maxLength={40}
          onChange={(e) => {
            setTitle(e.target.value);
            setEdited(true);
          }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...text14, color: gy.text }}>给客户的说明</span>
        <Input.TextArea
          autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={300}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setEdited(true);
          }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Switch checked={needsFile} onChange={setNeedsFile} aria-label="需要客户提供文件" />
        <span style={{ ...text14, color: gy.text }}>需要客户提供文件</span>
        {needsFile && (
          <Select
            aria-label="要客户提供哪一项资料"
            style={{ minWidth: 220 }}
            value={itemKey ?? undefined}
            onChange={(v: ChecklistItemKey) => setItemKey(v)}
            placeholder="选择资料项"
            showSearch
            optionFilterProp="label"
            options={CHECKLIST_ITEMS.map((i) => ({ value: i.key, label: i.label }))}
          />
        )}
      </div>
      {error && (
        <span role="alert" style={{ ...text14, color: gy.error }}>
          {error}
        </span>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={create.isPending} onClick={() => void submit()}>
          发给客户
        </Button>
      </div>
    </div>
  );
}

// 采用了事实补件、还没按新事实重新生成（生成进度页、正文编辑页、审核结论页顶部）：原审核结论已作废，提示重新生成。
// 重新生成出新一批以后自然消失
export function FactsChangedNotice({ taskId, onRegenerate }: { taskId: string; onRegenerate?: () => void }) {
  const list = useSupplements(taskId);
  if (!list.data?.some(supplementPendingRegeneration)) return null;
  return (
    <section
      aria-label="事实已更新"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 20px',
        borderRadius: 8,
        background: stage.action.bg,
        border: `1px solid ${stage.action.color}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...text14, fontWeight: 500, color: gy.text }}>事实已更新，草稿还没有重新生成</span>
        <span style={{ ...text13, color: gy.secondary }}>已采用事实补件，原来的核对和审核结论不再作为发布依据。请按新事实重新生成三份草稿。</span>
      </div>
      {onRegenerate && (
        <Button type="primary" onClick={onRegenerate}>
          重新生成
        </Button>
      )}
    </section>
  );
}

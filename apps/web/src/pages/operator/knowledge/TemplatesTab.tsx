import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons';
import { PROCESS_STEP_MAX, templateContentSchema, templatePublishSchema, type KnowledgeTemplate, type TemplateContent, type TemplateStep } from '@genyun/shared';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import { useMemo, useState, type CSSProperties } from 'react';
import { useAddTemplate, usePublishTemplate, useSaveTemplateDraft, useTemplateAction } from '../../../api/knowledge';
import { linkButton, panel, requiredAfter } from '../../../components/ui';
import { gy, source, stage } from '../../../theme/tokens';
import { body, ellipsis, monthDay, muted, SearchBox, Tag, tagSelectProps } from './parts';

// 工艺模板（Paper 16 页「知识库 · 工艺模板」）：客户在「生产情况 · 工艺流程」选行业模板时使用。
// 修改先存草稿，发布后存为新版本，只影响之后选用模板的客户；已选用的企业资料不变

const ROW_LINE = '#F2F3F5';
const label13: CSSProperties = { fontSize: 13, lineHeight: '20px' };
const meta12: CSSProperties = { fontSize: 12, lineHeight: '18px' };
const COLS = { no: 28, name: 96, risks: 120, ops: 72 } as const;

const contentOf = (t: KnowledgeTemplate): TemplateContent => t.draft ?? t.published ?? { label: '', industry: undefined, keywords: [], steps: [] };
const emptyStep = (): TemplateStep => ({ name: '', equipment: [], materials: [], risks: [] });
const sameContent = (a: TemplateContent, b: TemplateContent) => JSON.stringify(a) === JSON.stringify(b);

export function TemplatesTab({ templates, adding, onAdded }: { templates: KnowledgeTemplate[]; adding: boolean; onAdded: () => void }) {
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const k = keyword.trim();
  const shown = useMemo(
    () =>
      templates.filter((t) => {
        const c = contentOf(t);
        return !k || c.label.includes(k) || (c.industry ?? '').includes(k) || c.steps.some((s) => s.name.includes(k));
      }),
    [templates, k],
  );
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <nav aria-label="工艺模板" style={{ ...panel, width: 300, flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px' }}>
          <SearchBox label="搜索行业或工序" value={keyword} onChange={setKeyword} placeholder="搜索行业或工序" />
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shown.map((t) => {
            const on = selected?.id === t.id;
            const c = contentOf(t);
            const sub =
              t.state === 'draft'
                ? '未发布，客户看不到'
                : t.state === 'disabled'
                  ? '已停用，客户看不到'
                  : [`${(t.published?.steps.length ?? 0)} 道工序`, t.published?.industry, t.draft ? '有未发布的修改' : ''].filter(Boolean).join(' · ');
            return (
              <li key={t.id} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    width: '100%',
                    padding: on ? '12px 16px 12px 13px' : '12px 16px',
                    border: 'none',
                    borderLeft: on ? `3px solid ${gy.primary}` : 'none',
                    background: on ? gy.selected : 'transparent',
                    textAlign: 'left',
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <span style={{ ...body, fontWeight: on ? 500 : 400, flex: '1 1 0', minWidth: 0, ...ellipsis }}>{c.label || '未命名模板'}</span>
                    {t.state === 'draft' && <Tag dense tone={stage.action}>草稿</Tag>}
                    {t.state === 'disabled' && <Tag dense tone={{ color: gy.secondary, bg: gy.neutralBg }}>已停用</Tag>}
                    {t.state === 'published' && <span style={{ ...meta12, color: gy.tertiary, flexShrink: 0 }}>被用 {t.usedBy} 次</span>}
                  </span>
                  <span style={{ ...meta12, color: gy.secondary, ...ellipsis }}>{sub}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li style={{ ...muted, padding: '12px 16px', borderTop: `1px solid ${ROW_LINE}` }}>没有找到「{k}」</li>}
        </ul>
      </nav>

      {selected ? (
        <TemplateEditor key={`${selected.id}-${selected.version}-${selected.updatedAt}`} template={selected} />
      ) : (
        <section style={{ ...panel, flex: '1 1 0', padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ ...muted, margin: 0 }}>还没有工艺模板。新增一个，发布后客户就能选用。</p>
        </section>
      )}
      <NewTemplateModal
        open={adding}
        onClose={(id) => {
          if (id) setSelectedId(id);
          onAdded();
        }}
      />
    </div>
  );
}

function TemplateEditor({ template }: { template: KnowledgeTemplate }) {
  const initial = contentOf(template);
  const [content, setContent] = useState<TemplateContent>(initial);
  const saveDraft = useSaveTemplateDraft();
  const publish = usePublishTemplate();
  const action = useTemplateAction();
  const { message, modal } = App.useApp();
  const busy = saveDraft.isPending || publish.isPending || action.isPending;
  // 模板换了（或保存、发布后）由外层 key 重新挂载，这里不用再同步
  const dirty = !sameContent(content, initial);

  const set = (patch: Partial<TemplateContent>) => setContent((c) => ({ ...c, ...patch }));
  const setStep = (i: number, patch: Partial<TemplateStep>) =>
    set({ steps: content.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const steps = [...content.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + d, 0, s!);
    set({ steps });
  };
  // 空行不保存
  const cleaned = (): TemplateContent => ({ ...content, steps: content.steps.filter((s) => s.name.trim() !== '') });

  const doSave = async () => {
    const parsed = templateContentSchema.safeParse(cleaned());
    if (!parsed.success) return message.error(parsed.error.issues[0]?.message ?? '请检查模板内容');
    try {
      await saveDraft.mutateAsync({ id: template.id, content: parsed.data });
      message.success('草稿已保存，客户还看不到这些修改');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有保存成功，请再试一次');
    }
  };
  const next = template.version + 1;
  const doPublish = () => {
    const parsed = templatePublishSchema.safeParse(cleaned());
    if (!parsed.success) return message.error(parsed.error.issues[0]?.message ?? '请检查模板内容');
    modal.confirm({
      title: `发布「${parsed.data.label}」第 ${next} 版？`,
      content: '发布后，之后选这个模板的客户按新版本预填工序和设备；已经选用的企业资料不变。',
      okText: '发布',
      cancelText: '取消',
      onOk: async () => {
        try {
          await publish.mutateAsync({ id: template.id, content: parsed.data });
          message.success(`「${parsed.data.label}」第 ${next} 版已发布`);
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有发布成功，请再试一次');
        }
      },
    });
  };
  const toggle = () => {
    const off = template.state === 'disabled';
    modal.confirm({
      title: off ? `恢复「${initial.label}」？` : `停用「${initial.label}」？`,
      content: off ? '恢复后客户选行业模板时又能看到它。' : '停用后客户选行业模板时不再看到它；已经选用的企业资料不受影响。以后可以恢复。',
      okText: off ? '恢复' : '停用',
      okButtonProps: off ? undefined : { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await action.mutateAsync({ id: template.id, action: off ? 'enable' : 'disable' });
          message.success(off ? '已恢复' : '已停用，客户看不到这个模板了');
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有成功，请再试一次');
        }
      },
    });
  };

  const stateTag =
    template.state === 'published' ? (
      <Tag dense tone={stage.done}>已发布 · 第 {template.version} 版</Tag>
    ) : template.state === 'draft' ? (
      <Tag dense tone={stage.action}>草稿</Tag>
    ) : (
      <Tag dense tone={{ color: gy.secondary, bg: gy.neutralBg }}>已停用</Tag>
    );
  const th: CSSProperties = { ...meta12, color: gy.tertiary, flexShrink: 0 };
  const cell: CSSProperties = { flex: '1 1 0', minWidth: 0 };

  return (
    <section aria-label={`编辑「${initial.label}」`} style={{ ...panel, flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '18px 24px', borderBottom: `1px solid ${gy.split}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 18, lineHeight: '26px', fontWeight: 600, color: gy.text, margin: 0, ...ellipsis }}>{initial.label}</h2>
            {stateTag}
            {template.state !== 'draft' && template.draft && <Tag dense tone={stage.action}>有未发布的修改</Tag>}
          </span>
          <span style={{ ...label13, color: gy.secondary }}>
            {initial.keywords.length ? `推荐给经营范围含「${initial.keywords.join('」「')}」的企业` : '没有推荐关键词，客户自己选'}
            {` · ${template.updatedByName ?? '系统'} ${monthDay(template.updatedAt)} 更新`}
            {template.state === 'published' && ` · 被 ${template.usedBy} 家企业选用`}
          </span>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ ...cell, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...label13, fontWeight: 500, color: gy.secondary }}>模板名称（客户看到的）</span>
            <Input value={content.label} maxLength={30} onChange={(e) => set({ label: e.target.value })} />
          </label>
          <label style={{ ...cell, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...label13, fontWeight: 500, color: gy.secondary }}>所属行业</span>
            <Input value={content.industry ?? ''} maxLength={30} placeholder="例如：电子" onChange={(e) => set({ industry: e.target.value || undefined })} />
          </label>
          <div style={{ ...cell, flex: '1.4 1 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span id="kw-label" style={{ ...label13, fontWeight: 500, color: gy.secondary }}>
              推荐关键词（经营范围里出现就推荐）
            </span>
            <Select {...tagSelectProps} aria-labelledby="kw-label" value={content.keywords} onChange={(v: string[]) => set({ keywords: v })} placeholder="回车分开" />
          </div>
        </div>

        <span style={{ ...label13, fontWeight: 500, color: gy.secondary }}>工序（用箭头调整顺序）</span>
        <div role="table" aria-label="工序" style={{ border: `1px solid ${gy.split}`, borderRadius: 6, overflow: 'hidden' }}>
          <div role="row" style={{ display: 'flex', gap: 10, padding: '8px 12px', background: gy.canvas }}>
            <span role="columnheader" style={{ ...th, width: COLS.no }}>序</span>
            <span role="columnheader" style={{ ...th, width: COLS.name }}>工序</span>
            <span role="columnheader" style={{ ...th, ...cell }}>常见设备</span>
            <span role="columnheader" style={{ ...th, ...cell }}>常见物料</span>
            <span role="columnheader" style={{ ...th, width: COLS.risks }}>风险提示</span>
            <span role="columnheader" style={{ ...th, width: COLS.ops }} aria-label="调整" />
          </div>
          {content.steps.map((s, i) => (
            <div role="row" key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: `1px solid ${ROW_LINE}` }}>
              <span role="cell" style={{ ...label13, color: gy.tertiary, width: COLS.no, flexShrink: 0 }}>{i + 1}</span>
              <span role="cell" style={{ width: COLS.name, flexShrink: 0 }}>
                <Input size="small" aria-label={`第 ${i + 1} 道工序名称`} value={s.name} maxLength={20} onChange={(e) => setStep(i, { name: e.target.value })} />
              </span>
              <span role="cell" style={cell}>
                <Select {...tagSelectProps} size="small" aria-label={`第 ${i + 1} 道工序的常见设备`} value={s.equipment} onChange={(v: string[]) => setStep(i, { equipment: v })} style={{ width: '100%' }} placeholder="回车分开" />
              </span>
              <span role="cell" style={cell}>
                <Select {...tagSelectProps} size="small" aria-label={`第 ${i + 1} 道工序的常见物料`} value={s.materials} onChange={(v: string[]) => setStep(i, { materials: v })} style={{ width: '100%' }} placeholder="回车分开" />
              </span>
              <span role="cell" style={{ width: COLS.risks, flexShrink: 0 }}>
                <Select {...tagSelectProps} size="small" aria-label={`第 ${i + 1} 道工序的风险提示`} value={s.risks} onChange={(v: string[]) => setStep(i, { risks: v })} style={{ width: '100%' }} placeholder="如：触电" />
              </span>
              <span role="cell" style={{ width: COLS.ops, flexShrink: 0, display: 'flex', gap: 2 }}>
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`第 ${i + 1} 道工序上移`} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === content.steps.length - 1} onClick={() => move(i, 1)} aria-label={`第 ${i + 1} 道工序下移`} />
                <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => set({ steps: content.steps.filter((_, j) => j !== i) })} aria-label={`删除第 ${i + 1} 道工序`} />
              </span>
            </div>
          ))}
          {content.steps.length === 0 && <div style={{ ...label13, color: gy.tertiary, padding: '12px', borderTop: `1px solid ${ROW_LINE}` }}>还没有工序</div>}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <button
            type="button"
            style={{ ...linkButton, ...label13 }}
            disabled={content.steps.length >= PROCESS_STEP_MAX}
            onClick={() => set({ steps: [...content.steps, emptyStep()] })}
          >
            + 添加工序
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', borderRadius: 6, background: source.system.bg }}>
          <span style={{ fontSize: 12, lineHeight: '20px', color: source.system.color }}>发布规则</span>
          <span style={{ ...label13, color: gy.text }}>
            修改后存为新版本，只影响之后选用模板的客户；已选用的任务不变。风险提示仅供注安师参考，不展示给客户。
          </span>
        </div>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: `1px solid ${gy.split}`, marginTop: 'auto' }}>
        {template.version > 0 && (
          <Button style={{ height: 34, paddingInline: 14 }} onClick={toggle} disabled={busy}>
            {template.state === 'disabled' ? '恢复' : '停用'}
          </Button>
        )}
        <Button style={{ height: 34, paddingInline: 14 }} onClick={() => void doSave()} loading={saveDraft.isPending} disabled={busy || !dirty}>
          保存草稿
        </Button>
        <Button type="primary" style={{ height: 34, paddingInline: 14, fontWeight: 500 }} onClick={doPublish} loading={publish.isPending} disabled={busy}>
          发布第 {next} 版
        </Button>
      </footer>
    </section>
  );
}

function NewTemplateModal({ open, onClose }: { open: boolean; onClose: (id?: string) => void }) {
  const [form] = Form.useForm<{ label: string; industry?: string }>();
  const add = useAddTemplate();
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields();
    const parsed = templateContentSchema.safeParse({ ...values, keywords: [], steps: [] });
    if (!parsed.success) return message.error(parsed.error.issues[0]?.message ?? '请检查模板名称');
    try {
      const res = await add.mutateAsync(parsed.data);
      message.success('已新增草稿，录入工序后发布，客户才能选用');
      onClose(res.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有新增成功，请再试一次');
    }
  };
  return (
    <Modal
      open={open}
      title="新增工艺模板"
      okText="新增"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={() => onClose()}
      confirmLoading={add.isPending}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={480}
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>先存成草稿，录入工序后发布，客户才能在「生产情况 · 工艺流程」选用。</p>
      <Form form={form} layout="vertical" requiredMark={requiredAfter}>
        <Form.Item label="模板名称" name="label" rules={[{ required: true, whitespace: true, message: '请填写模板名称' }]}>
          <Input maxLength={30} placeholder="例如：PCB 线路板" />
        </Form.Item>
        <Form.Item label="所属行业" name="industry">
          <Input maxLength={30} placeholder="例如：电子" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

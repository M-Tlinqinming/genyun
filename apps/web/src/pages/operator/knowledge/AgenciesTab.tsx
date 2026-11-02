import {
  AGENCY_CATEGORIES,
  AGENCY_CATEGORY_LABELS,
  agencyInputSchema,
  agencyRegionInputSchema,
  type AgencyCategory,
  type AgencyInput,
  type AgencyRegionInput,
  type KnowledgeAgency,
  type KnowledgeRegion,
} from '@genyun/shared';
import { App, Button, Form, Input, Modal, Radio, Select } from 'antd';
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { useAddAgency, useAddRegion, useAgencyAction, useUpdateAgency, useUpdateRegion } from '../../../api/knowledge';
import { linkButton, panel, requiredAfter } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import { body, ellipsis, monthDay, muted, SearchBox, small, Tag, tagSelectProps, TreeRow } from './parts';

// 属地应急机构（Paper 16 页「知识库 · 属地应急机构」）：按 省 / 市 / 区县 维护应急管理局、镇街应急办、消防大队。
// 生成预案时按企业地址自动引用；改动只影响之后生成的文档

type Filter = 'all' | AgencyCategory | 'pending';
const COLS = { name: 250, category: 100, verified: 130, state: 100, action: 60 } as const;
const PENDING_ROW = '#FFFCF5';

const pending = (a: KnowledgeAgency) => !a.disabled && !a.verifiedAt;

function subtitle(a: KnowledgeAgency): string {
  if (a.category === 'street') return [`适用：${a.area ?? '—'}`, a.aliases.length ? `也认：${a.aliases.join('、')}` : ''].filter(Boolean).join(' · ');
  return a.note ?? (a.category === 'emergency' ? '区县应急管理部门' : '辖区消防救援');
}

export function AgenciesTab({ regions, adding, onAdded }: { regions: KnowledgeRegion[]; adding: boolean; onAdded: () => void }) {
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ agency: KnowledgeAgency | null; verify?: boolean } | null>(null);
  const [regionModal, setRegionModal] = useState<{ region: KnowledgeRegion | null } | null>(null);

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0] ?? null;
  const k = keyword.trim();
  // 搜索：区县名、地址叫法、镇街名
  const shown = useMemo(
    () =>
      regions.filter(
        (r) =>
          !k ||
          r.name.includes(k) ||
          r.city.includes(k) ||
          r.aliases.some((a) => a.includes(k)) ||
          r.agencies.some((a) => a.name.includes(k) || (a.area ?? '').includes(k) || a.aliases.some((x) => x.includes(k))),
      ),
    [regions, k],
  );
  // 省 → 市 → 区县
  const tree = useMemo(() => {
    const provinces = new Map<string, Map<string, KnowledgeRegion[]>>();
    for (const r of shown) {
      const cities = provinces.get(r.province) ?? new Map<string, KnowledgeRegion[]>();
      cities.set(r.city, [...(cities.get(r.city) ?? []), r]);
      provinces.set(r.province, cities);
    }
    return provinces;
  }, [shown]);
  const activeCount = (list: KnowledgeRegion[]) => list.reduce((n, r) => n + r.agencies.filter((a) => !a.disabled).length, 0);
  const empty = regions.filter((r) => r.agencies.every((a) => a.disabled));

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <nav aria-label="行政区" style={{ ...panel, width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${gy.split}` }}>
          <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>行政区</h2>
          <SearchBox label="搜索区县或街道" value={keyword} onChange={setKeyword} placeholder="搜索区县 / 街道" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 8px 12px' }}>
          {[...tree].map(([province, cities]) => (
            <Fragment key={province}>
              <TreeRow indent={12} label={province} count={activeCount([...cities.values()].flat())} />
              {[...cities].map(([city, list]) => (
                <Fragment key={city}>
                  <TreeRow indent={28} label={city} count={activeCount(list)} />
                  {list.map((r) => (
                    <TreeRow
                      key={r.id}
                      indent={44}
                      label={r.name}
                      count={r.agencies.filter((a) => !a.disabled).length}
                      selected={selected?.id === r.id}
                      onClick={() => {
                        setSelectedId(r.id);
                        setFilter('all');
                      }}
                    />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
          {shown.length === 0 && <p style={{ ...small, margin: 0, padding: '6px 12px' }}>没有找到「{k}」</p>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 20px', borderTop: `1px solid ${gy.split}` }}>
          {empty.length > 0 && (
            <span style={{ ...small, color: stage.action.color }}>
              {empty.map((r) => r.name).join('、')}尚无可用机构 · 生成时这些地址不写属地机构
            </span>
          )}
          <button type="button" style={{ ...linkButton, fontSize: 12, lineHeight: '20px', alignSelf: 'flex-start' }} onClick={() => setRegionModal({ region: null })}>
            + 新增区县
          </button>
        </div>
      </nav>

      {selected ? (
        <RegionAgencies
          region={selected}
          filter={filter}
          onFilter={setFilter}
          onEdit={(agency, verify) => setEditing({ agency, verify })}
          onEditRegion={() => setRegionModal({ region: selected })}
        />
      ) : (
        <section style={{ ...panel, flex: '1 1 0', padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ ...muted, margin: 0 }}>还没有行政区。先新增一个区县，再录入它的应急管理局、镇街应急办和消防大队。</p>
        </section>
      )}

      <AgencyModal
        open={adding || editing !== null}
        agency={editing?.agency ?? null}
        verify={editing?.verify ?? false}
        regions={regions}
        defaultRegionId={selected?.id}
        onClose={() => {
          setEditing(null);
          onAdded();
        }}
      />
      <RegionModal open={regionModal !== null} region={regionModal?.region ?? null} onClose={() => setRegionModal(null)} onCreated={() => setSelectedId(null)} />
    </div>
  );
}

function RegionAgencies({
  region,
  filter,
  onFilter,
  onEdit,
  onEditRegion,
}: {
  region: KnowledgeRegion;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onEdit: (a: KnowledgeAgency, verify?: boolean) => void;
  onEditRegion: () => void;
}) {
  const agencies = region.agencies;
  const waiting = agencies.filter(pending);
  const rows = agencies.filter((a) => (filter === 'all' ? true : filter === 'pending' ? pending(a) : a.category === filter));
  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: '全部' },
    ...AGENCY_CATEGORIES.map((c) => ({ key: c, label: AGENCY_CATEGORY_LABELS[c] })),
    ...(filter === 'pending' ? [{ key: 'pending' as const, label: '待核实' }] : []),
  ];
  const th: CSSProperties = { ...body, fontWeight: 500, flexShrink: 0 };

  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {waiting.length > 0 && filter !== 'pending' && (
        <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 8, background: gy.warningBg }}>
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...body, fontWeight: 500, color: stage.action.color }}>{region.name}有 {waiting.length} 个机构还没核实过</span>
            <span style={muted}>这些是系统初始录入的电话和名称，请对照官方公布的信息核实一遍；核实前生成的预案也会照常引用。</span>
          </div>
          <Button onClick={() => onFilter('pending')}>去核实</Button>
        </div>
      )}

      <section aria-label={`${region.name}的机构`} style={{ ...panel, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>
              {region.city} · {region.name}
            </h2>
            <span style={small}>
              {agencies.filter((a) => !a.disabled).length} 个机构 · 地址里出现「{region.aliases.join('」「')}」就引用这里
              {' · '}
              <button type="button" style={{ ...linkButton, fontSize: 12, lineHeight: '20px' }} onClick={onEditRegion}>
                编辑区县
              </button>
            </span>
          </div>
          <div role="tablist" aria-label="机构类别" style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
            {tabs.map((t) => {
              const on = filter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => onFilter(t.key)}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '0 0 4px',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 14,
                    lineHeight: '22px',
                    color: on ? gy.primary : gy.secondary,
                    fontWeight: on ? 500 : 400,
                    borderBottom: `2px solid ${on ? gy.primary : 'transparent'}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 44,
            padding: '0 24px',
            background: '#FAFAFB',
            borderTop: `1px solid ${gy.split}`,
            borderBottom: `1px solid ${gy.split}`,
          }}
        >
          <span style={{ ...th, width: COLS.name }}>机构名称</span>
          <span style={{ ...th, width: COLS.category }}>类别</span>
          <span style={{ ...th, flex: '1 1 0', minWidth: 0 }}>联系电话</span>
          <span style={{ ...th, width: COLS.verified }}>最近核实</span>
          <span style={{ ...th, width: COLS.state }}>状态</span>
          <span style={{ ...th, width: COLS.action }}>操作</span>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((a) => {
            const wait = pending(a);
            const dim = a.disabled ? gy.tertiary : undefined;
            return (
              <li
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 64,
                  padding: '0 24px',
                  borderBottom: `1px solid ${gy.split}`,
                  background: wait ? PENDING_ROW : undefined,
                }}
              >
                <span style={{ width: COLS.name, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: 12 }}>
                  <span style={{ ...body, color: dim ?? gy.text, ...ellipsis }} title={a.name}>
                    {a.name}
                  </span>
                  <span style={{ ...small, color: dim ?? gy.secondary, ...ellipsis }}>{subtitle(a)}</span>
                </span>
                <span style={{ ...body, color: dim ?? gy.text, width: COLS.category, flexShrink: 0 }}>{AGENCY_CATEGORY_LABELS[a.category]}</span>
                <span style={{ ...body, color: dim ?? gy.text, flex: '1 1 0', minWidth: 0, ...ellipsis }}>{a.phone ?? '—'}</span>
                <span style={{ ...muted, color: dim ?? gy.secondary, width: COLS.verified, flexShrink: 0, ...ellipsis }}>
                  {a.verifiedAt ? `${monthDay(a.verifiedAt)} · ${a.verifiedByName ?? '—'}` : '未核实'}
                </span>
                <span style={{ width: COLS.state, flexShrink: 0 }}>
                  {a.disabled ? (
                    <Tag tone={{ color: gy.secondary, bg: gy.neutralBg }}>已停用</Tag>
                  ) : wait ? (
                    <Tag tone={stage.action}>待核实</Tag>
                  ) : (
                    <Tag tone={stage.done}>有效</Tag>
                  )}
                </span>
                <span style={{ width: COLS.action, flexShrink: 0 }}>
                  <button type="button" style={linkButton} onClick={() => onEdit(a, wait)} aria-label={`${wait ? '核实' : '编辑'}${a.name}`}>
                    {wait ? '核实' : '编辑'}
                  </button>
                </span>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li style={{ ...muted, padding: '24px', borderBottom: `1px solid ${gy.split}`, textAlign: 'center' }}>这一类还没有机构</li>
          )}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px' }}>
          <span style={small}>更新后只影响之后生成的文档；已交付的成果不会改动。</span>
          {filter === 'pending' && (
            <button type="button" style={{ ...linkButton, fontSize: 12, lineHeight: '20px' }} onClick={() => onFilter('all')}>
              显示全部 {agencies.length} 个
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

type AgencyForm = Omit<AgencyInput, 'aliases'> & { aliases?: string[] };

function AgencyModal({
  open,
  agency,
  verify,
  regions,
  defaultRegionId,
  onClose,
}: {
  open: boolean;
  agency: KnowledgeAgency | null;
  verify: boolean;
  regions: KnowledgeRegion[];
  defaultRegionId?: string;
  onClose: () => void;
}) {
  const [form] = Form.useForm<AgencyForm>();
  const add = useAddAgency();
  const update = useUpdateAgency();
  const action = useAgencyAction();
  const { message, modal } = App.useApp();
  const category = Form.useWatch('category', form);
  const busy = add.isPending || update.isPending || action.isPending;

  const submit = async () => {
    const values = await form.validateFields();
    const parsed = agencyInputSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      form.setFields([{ name: issue.path[0] as keyof AgencyForm, errors: [issue.message] }]);
      return;
    }
    try {
      if (agency && verify && !form.isFieldsTouched()) {
        await action.mutateAsync({ id: agency.id, action: 'verify' });
        message.success(`${agency.name}已记为核实`);
      } else if (agency) {
        await update.mutateAsync({ id: agency.id, ...parsed.data });
        message.success(`${parsed.data.name}已更新，之后生成的文档按新信息引用`);
      } else {
        await add.mutateAsync(parsed.data);
        message.success(`已新增${parsed.data.name}`);
      }
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有保存成功，请再试一次');
    }
  };

  const toggle = () => {
    if (!agency) return;
    const off = agency.disabled;
    modal.confirm({
      title: off ? `恢复 ${agency.name}？` : `停用 ${agency.name}？`,
      content: off
        ? '恢复后，之后生成的文档会重新引用这个机构。'
        : '停用后，之后生成的文档不再引用这个机构；已生成、已交付的文档不变。以后可以恢复。',
      okText: off ? '恢复' : '停用',
      okButtonProps: off ? undefined : { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await action.mutateAsync({ id: agency.id, action: off ? 'enable' : 'disable' });
          message.success(off ? `${agency.name}已恢复` : `${agency.name}已停用`);
          onClose();
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有成功，请再试一次');
        }
      },
    });
  };

  const initial: Partial<AgencyForm> = agency
    ? {
        regionId: agency.regionId,
        category: agency.category,
        name: agency.name,
        phone: agency.phone ?? undefined,
        area: agency.area ?? undefined,
        aliases: agency.aliases,
        plan: agency.plan ?? undefined,
        note: agency.note ?? undefined,
      }
    : { regionId: defaultRegionId, category: 'street', aliases: [] };

  return (
    <Modal
      open={open}
      title={agency ? (verify ? `核实 ${agency.name}` : `编辑 ${agency.name}`) : '新增机构'}
      onCancel={onClose}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>
            {agency && (
              <Button danger={!agency.disabled} onClick={toggle} disabled={busy}>
                {agency.disabled ? '恢复' : '停用'}
              </Button>
            )}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              {agency ? (verify ? '核实无误' : '保存') : '新增'}
            </Button>
          </span>
        </div>
      }
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>
        {verify ? '请对照官方公布的信息核对名称和电话，有出入直接改。' : '保存后只影响之后生成的文档；已交付的成果不会改动。'}
      </p>
      <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={initial}>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item label="行政区" name="regionId" rules={[{ required: true, message: '请选择行政区' }]} style={{ flex: '1 1 0' }}>
            <Select options={regions.map((r) => ({ value: r.id, label: `${r.city} · ${r.name}` }))} />
          </Form.Item>
          <Form.Item label="类别" name="category" rules={[{ required: true, message: '请选择类别' }]} style={{ flex: '1 1 0' }}>
            <Radio.Group optionType="button" options={AGENCY_CATEGORIES.map((c) => ({ value: c, label: AGENCY_CATEGORY_LABELS[c] }))} />
          </Form.Item>
        </div>
        <Form.Item label="机构名称" name="name" rules={[{ required: true, whitespace: true, message: '请填写机构名称' }]}>
          <Input maxLength={60} placeholder={category === 'street' ? '例如：陈江街道应急管理办公室' : '例如：惠州市仲恺高新区应急管理局'} />
        </Form.Item>
        <Form.Item label="联系电话" name="phone" extra="几个号码用顿号分开。">
          <Input maxLength={40} placeholder="例如：0752-3271385" />
        </Form.Item>
        {category === 'street' && (
          <>
            <div style={{ display: 'flex', gap: 16 }}>
              <Form.Item label="适用镇街" name="area" rules={[{ required: true, whitespace: true, message: '请填写适用的镇街' }]} style={{ flex: '1 1 0' }} extra="企业地址里出现这个名称（或去掉「街道」「镇」的简称）就引用这个机构。">
                <Input maxLength={30} placeholder="例如：陈江街道" />
              </Form.Item>
              <Form.Item label="地址里的其他叫法" name="aliases" style={{ flex: '1 1 0' }} extra="例如村名、园区名，回车分开。">
                <Select {...tagSelectProps} placeholder="例如：甲子" />
              </Form.Item>
            </div>
            <Form.Item label="镇街级上级预案" name="plan" extra="不写书名号。">
              <Input maxLength={80} placeholder="例如：陈江街道生产安全事故应急预案" />
            </Form.Item>
          </>
        )}
        <Form.Item label="备注" name="note">
          <Input maxLength={100} placeholder="只在知识库里显示，例如信息来源" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type RegionForm = Omit<AgencyRegionInput, 'aliases'> & { aliases?: string[] };

function RegionModal({ open, region, onClose, onCreated }: { open: boolean; region: KnowledgeRegion | null; onClose: () => void; onCreated: () => void }) {
  const [form] = Form.useForm<RegionForm>();
  const add = useAddRegion();
  const update = useUpdateRegion();
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields();
    const parsed = agencyRegionInputSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      form.setFields([{ name: issue.path[0] as keyof RegionForm, errors: [issue.message] }]);
      return;
    }
    try {
      if (region) await update.mutateAsync({ id: region.id, ...parsed.data });
      else {
        await add.mutateAsync(parsed.data);
        onCreated();
      }
      message.success(region ? `${parsed.data.name}已更新` : `已新增${parsed.data.name}，接着录入它的机构`);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有保存成功，请再试一次');
    }
  };
  const initial: Partial<RegionForm> = region
    ? { province: region.province, city: region.city, name: region.name, aliases: region.aliases, plan: region.plan ?? undefined }
    : { province: '广东省', city: '惠州市', aliases: [] };
  return (
    <Modal
      open={open}
      title={region ? `编辑 ${region.name}` : '新增区县'}
      okText={region ? '保存' : '新增'}
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={add.isPending || update.isPending}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={initial}>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item label="省份" name="province" rules={[{ required: true, whitespace: true, message: '请填写省份' }]} style={{ flex: '1 1 0' }}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item label="城市" name="city" rules={[{ required: true, whitespace: true, message: '请填写城市' }]} style={{ flex: '1 1 0' }}>
            <Input maxLength={20} />
          </Form.Item>
        </div>
        <Form.Item label="区县" name="name" rules={[{ required: true, whitespace: true, message: '请填写区县' }]}>
          <Input maxLength={30} placeholder="例如：惠城区" />
        </Form.Item>
        <Form.Item
          label="地址里会出现的叫法"
          name="aliases"
          rules={[{ required: true, type: 'array', min: 1, message: '请至少填一个，例如「惠城」' }]}
          extra="企业地址里出现其中任何一个，就按这个区县引用机构。回车分开。"
        >
          <Select {...tagSelectProps} placeholder="例如：惠城" />
        </Form.Item>
        <Form.Item label="区县级上级预案" name="plan" extra="不写书名号。">
          <Input maxLength={80} placeholder="例如：惠城区生产安全事故应急预案" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

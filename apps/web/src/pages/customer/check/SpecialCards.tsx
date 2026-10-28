import {
  ITEM_CHECK_LABELS,
  msdsNeedOf,
  SPECIAL_CATEGORIES,
  SPECIAL_CATEGORY_KEYS,
  type CategoryCheckItem,
  type ProductionStep,
  type SpecialAnswer,
  type SpecialCategory,
} from '@genyun/shared';
import { App, Button, Input, Upload } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { linkItemFile, uploadFile } from '../../../api/profile';
import { ApiError } from '../../../api/request';
import type { Task } from '../../../api/tasks';
import { gy } from '../../../theme/tokens';
import { AnswerSwitch } from '../fill/ProductionStepPage';
import { useCheckProfile, useProfileWriter } from './useProfileWriter';
import { linkButtonSmall } from '../../../components/ui';

const IMAGE_ACCEPT = 'image/*,.pdf';
const DOC_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
const muted = '#3F4A5C';

const SHORT: Record<SpecialCategory, string> = {
  pressureVessels: '压力容器',
  boilers: '锅炉',
  pressurePipelines: '压力管道',
  storageTanks: '储罐 / 油库',
};
const SPECIAL_OPTIONS: { value: SpecialAnswer; label: string }[] = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '没有' },
  { value: 'photo', label: '拍照给耕云看' },
];

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');

// 特种设备与储存设施（12 页 P05C）：四类逐项答有没有，拿不准就拍照。与自填第 3 步同一份数据，状态由后台同步
export function SpecialEquipmentCard({ task, item }: { task: Task; item: CategoryCheckItem }) {
  const { production } = useCheckProfile(task);
  const writer = useProfileWriter(task);
  const { message } = App.useApp();
  const [draft, setDraft] = useState<ProductionStep['specialEquipment'] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!production) return <Shell title={item.label} state={item.state} />;
  const current = draft ?? production.step.specialEquipment;
  const missing = SPECIAL_CATEGORY_KEYS.filter((k) => current[k].answer === undefined).length;
  const needPhoto = SPECIAL_CATEGORY_KEYS.filter((k) => current[k].answer === 'photo' && current[k].photoFileIds.length === 0);
  const set = (k: SpecialCategory, patch: Partial<ProductionStep['specialEquipment'][SpecialCategory]>) =>
    setDraft({ ...current, [k]: { ...current[k], ...patch } });

  const photo = async (k: SpecialCategory, file: File) => {
    setBusy(k);
    try {
      const fileId = await uploadFile(task.orgId, file, 'image_or_pdf');
      set(k, { photoFileIds: [...current[k].photoFileIds, fileId] });
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await writer.production((step) => ({ ...step, specialEquipment: current }));
      setDraft(null);
      message.success('已保存回答');
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell
      testId="special-equipment"
      title={item.label}
      state={item.state}
      tone={item.state === 'missing' ? 'action' : 'plain'}
      hint="请逐项回答有没有；拿不准就拍照，专家会判断。只有「有」的才需要参数，参数在自填第 3 步或专家联系时补。"
    >
      {SPECIAL_CATEGORY_KEYS.map((k) => {
        const c = current[k];
        return (
          <div
            key={k}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 6,
              background: gy.surface,
              border: c.answer === undefined ? '1px dashed #A9B4C6' : `1px solid ${gy.split}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 14, lineHeight: '22px', color: gy.text }}>
                {SHORT[k]}
                {c.answer === undefined && <span style={{ marginLeft: 8, fontSize: 12, color: gy.tertiary }}>未回答</span>}
              </span>
              <AnswerSwitch
                label={`${SPECIAL_CATEGORIES[k].label}有没有`}
                value={c.answer}
                options={SPECIAL_OPTIONS}
                width={252}
                onChange={(answer) => set(k, { answer })}
              />
            </div>
            {c.answer === 'photo' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: gy.secondary }}>
                <span style={{ flex: 1 }}>
                  {c.photoFileIds.length > 0 ? `已拍 ${c.photoFileIds.length} 张，注册安全工程师会判断` : '拍设备外观或铭牌'}
                </span>
                <Upload
                  accept={IMAGE_ACCEPT}
                  capture="environment"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void photo(k, file);
                    return false;
                  }}
                >
                  <Button size="small" loading={busy === k} aria-label={`拍${SHORT[k]}照片`}>
                    {c.photoFileIds.length > 0 ? '再拍一张' : '拍照上传'}
                  </Button>
                </Upload>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, fontSize: 13, color: gy.secondary }}>
          {missing > 0
            ? `还差 ${missing} 项回答`
            : needPhoto.length > 0
              ? `${needPhoto.map((k) => SHORT[k]).join('、')}还没拍照`
              : '都已回答'}
          {' · 照片由注册安全工程师判断'}
        </span>
        <Button type="primary" disabled={draft === null} loading={busy === 'save'} onClick={() => void save()}>
          保存回答
        </Button>
      </div>
    </Shell>
  );
}

// 外部应急队伍与资源：消防、医院、应急管理局由耕云按地址带出，客户只答相邻企业（与自填第 4 步同一份数据）
export function NeighborsCard({ task, item }: { task: Task; item: CategoryCheckItem }) {
  const { resources } = useCheckProfile(task);
  const writer = useProfileWriter(task);
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  if (!resources) return <Shell title={item.label} state={item.state} />;
  const n = resources.step.neighbors;
  const listed = n.items.filter((i) => i.name.trim());

  const save = async (neighbors: typeof n, done: string) => {
    setBusy(true);
    try {
      await writer.resources((step) => ({ ...step, neighbors }));
      setName('');
      setContact('');
      message.success(done);
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      testId="neighbors"
      title="相邻企业"
      state={item.state}
      tone={item.state === 'done' ? 'plain' : 'later'}
      hint="事故时需要互相通知。消防、医院、应急管理局等外部联系方式由耕云按地址带出，您不用填。"
    >
      {listed.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '22px', color: muted }}>
          {listed.map((i) => (
            <li key={i.id}>
              {i.name}
              {i.contact && ` · ${i.contact}`}
            </li>
          ))}
        </ul>
      )}
      {n.answer === 'none' && <span style={{ fontSize: 13, color: muted }}>已回答：周边没有相邻企业</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Input aria-label="相邻企业名称" placeholder="企业名称" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          aria-label="相邻企业联系方式"
          placeholder="门卫或联系电话（选填）"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        <Button
          disabled={!name.trim()}
          loading={busy}
          onClick={() =>
            void save(
              {
                answer: 'has',
                items: [...listed, { id: `n${Date.now().toString(36)}`, name: name.trim(), contact: contact.trim() || undefined }],
              },
              '已添加相邻企业',
            )
          }
        >
          添加
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {n.answer !== 'none' && (
          <button type="button" style={link} disabled={busy} onClick={() => void save({ answer: 'none', items: [] }, '已记为没有相邻企业')}>
            周边没有相邻企业
          </button>
        )}
        {item.state !== 'done' && (
          <span style={{ fontSize: 13, color: gy.tertiary }}>不清楚可以先不填，专家联系时再问</span>
        )}
      </div>
    </Shell>
  );
}

// 包装标签与安全技术说明书（12 页 P05D）：按物料逐行处理。是否危化品由专家判断，客户只给照片或说明书
export function MsdsCard({ task, item, fallback }: { task: Task; item: CategoryCheckItem; fallback: ReactNode }) {
  const { production, resources } = useCheckProfile(task);
  const writer = useProfileWriter(task);
  const { message } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);

  if (!production || !resources) return <Shell title={item.label} state={item.state} />;
  const materials = production.step.materials.filter((m) => m.name.trim());
  // 没列出物料（上传路线的物料在台账里）：按普通资料项处理
  if (materials.length === 0) return <>{fallback}</>;

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      message.success(done);
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const label = (id: string, file: File) =>
    run(`label-${id}`, async () => {
      const fileId = await uploadFile(task.orgId, file, 'image_or_pdf');
      await writer.production((step) => ({
        ...step,
        materials: step.materials.map((m) => (m.id === id ? { ...m, labelPhotoFileIds: [...m.labelPhotoFileIds, fileId] } : m)),
      }));
    }, '标签照片已保存');
  const msds = (id: string, file: File) =>
    run(`msds-${id}`, async () => {
      const fileId = await uploadFile(task.orgId, file, 'material');
      await writer.resources((step) => ({
        ...step,
        msds: { ...step.msds, [id]: { fileIds: [...(step.msds[id]?.fileIds ?? []), fileId], later: false } },
      }));
      await linkItemFile(task.id, 'msds', fileId);
    }, '说明书已保存');
  const later = (id: string) =>
    run(`later-${id}`, () =>
      writer.resources((step) => ({ ...step, msds: { ...step.msds, [id]: { fileIds: step.msds[id]?.fileIds ?? [], later: true } } })),
    '已标为稍后补');

  return (
    <Shell
      testId="msds"
      title="包装标签与安全技术说明书"
      state={item.state}
      tone={item.state === 'done' ? 'plain' : 'later'}
      hint="是不是危化品由专家判断，您只需要提供照片或说明书。"
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', borderRadius: 6, border: `1px solid ${gy.split}`, background: gy.surface }}>
        {materials.map((m, i) => {
          const need = msdsNeedOf(m);
          const files = resources.step.msds[m.id];
          let text: ReactNode;
          let actions: ReactNode = null;
          if (need === 'knowledge_base') text = <span style={{ color: gy.primary }}>纯物质 · 耕云资料库补全，无需上传</span>;
          else if (need === 'not_needed') text = <span style={{ color: gy.tertiary }}>一般原料 · 不需要</span>;
          else {
            const labelDone = m.labelPhotoFileIds.length > 0;
            const msdsDone = (files?.fileIds.length ?? 0) > 0;
            text = (
              <span style={{ color: labelDone || msdsDone ? gy.success : gy.warning }}>
                {[labelDone ? '✓ 标签已拍' : '待拍包装标签', msdsDone ? '说明书已传' : need === 'supplier' ? '说明书待供应商提供' : '专家判断后再定是否要说明书']
                  .filter(Boolean)
                  .join(' · ')}
                {files?.later && !msdsDone && '（稍后补）'}
              </span>
            );
            actions = (
              <span style={{ display: 'flex', gap: 12 }}>
                {!labelDone && (
                  <Upload
                    accept={IMAGE_ACCEPT}
                    capture="environment"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void label(m.id, file);
                      return false;
                    }}
                  >
                    <Button size="small" loading={busy === `label-${m.id}`} aria-label={`拍${m.name}包装标签`}>
                      拍包装标签
                    </Button>
                  </Upload>
                )}
                {need === 'supplier' && !msdsDone && (
                  <>
                    <Upload
                      accept={DOC_ACCEPT}
                      showUploadList={false}
                      beforeUpload={(file) => {
                        void msds(m.id, file);
                        return false;
                      }}
                    >
                      <button type="button" style={link} aria-label={`上传${m.name}说明书`}>
                        上传
                      </button>
                    </Upload>
                    {!files?.later && (
                      <button type="button" style={link} aria-label={`${m.name}稍后补`} onClick={() => void later(m.id)}>
                        稍后补
                      </button>
                    )}
                  </>
                )}
              </span>
            );
          }
          return (
            <li
              key={m.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i === 0 ? undefined : `1px solid ${gy.split}`, fontSize: 13 }}
            >
              <span style={{ width: 72, flexShrink: 0, color: gy.text }}>{m.name}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
              {actions}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

// 「是否出租厂房、是否有道路运输」：资料里看不出，需客户确认（12 页 P05 右栏）。与自填第 3 步同一份数据
export function BusinessQuestions({ task }: { task: Task }) {
  const { production } = useCheckProfile(task);
  const writer = useProfileWriter(task);
  const { message } = App.useApp();
  if (!production) return null;
  const s = production.step;
  const questions = [
    { key: 'leasesPremises' as const, text: '是否出租厂房？', value: s.leasesPremises },
    { key: 'ownVehicles' as const, text: '是否有道路运输？', value: s.ownVehicles },
  ].filter((q) => q.value === undefined);
  if (questions.length === 0) return null;

  const answer = (key: 'leasesPremises' | 'ownVehicles', value: boolean) =>
    writer.production((step) => ({ ...step, [key]: value })).catch((err: unknown) => message.error(errorText(err)));

  return (
    <section
      aria-label="业务问题"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 8, background: '#FFF7E6' }}
    >
      <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>还需回答 {questions.length} 个业务问题</span>
      {questions.map((q) => (
        <div key={q.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 14, color: gy.text }}>{q.text}</span>
          <Button size="small" onClick={() => void answer(q.key, true)}>
            是
          </Button>
          <Button size="small" onClick={() => void answer(q.key, false)}>
            否
          </Button>
        </div>
      ))}
      <span style={{ fontSize: 13, color: gy.secondary }}>资料中看不出，需由您确认；不影响提交。</span>
    </section>
  );
}

function Shell({
  title,
  state,
  hint,
  tone = 'plain',
  testId,
  children,
}: {
  title: string;
  state: CategoryCheckItem['state'];
  hint?: string;
  tone?: 'action' | 'later' | 'plain';
  testId?: string;
  children?: ReactNode;
}) {
  const style: CSSProperties =
    tone === 'action'
      ? { background: '#FFFBF0', border: '1px solid #E8C77A' }
      : tone === 'later'
        ? { background: gy.canvas, border: `1px solid ${gy.split}` }
        : { background: gy.surface, border: `1px solid ${gy.split}` };
  return (
    <section data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 8, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{title}</h3>
        <span style={{ fontSize: 12, color: state === 'done' ? gy.success : state === 'missing' ? gy.warning : gy.tertiary }}>
          {ITEM_CHECK_LABELS[state]}
        </span>
      </div>
      {hint && <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: muted }}>{hint}</p>}
      {children}
    </section>
  );
}

const link: CSSProperties = linkButtonSmall;

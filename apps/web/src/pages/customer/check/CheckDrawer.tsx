import {
  DRAWINGS,
  ITEM_STATUS_LABELS,
  ITEM_STEP,
  type CategoryCheck,
  type CategoryCheckItem,
  type DrawingKey,
} from '@genyun/shared';
import { CheckOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Drawer, Input, Select, Upload } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { addTaskDocument, taskDocumentsKey, useTaskDocuments } from '../../../api/documents';
import { linkItemFile, uploadFile } from '../../../api/profile';
import { ApiError } from '../../../api/request';
import { taskCheckKey, updateChecklistItem, type Task, type TaskCheck } from '../../../api/tasks';
import { gy, source } from '../../../theme/tokens';
import { MsdsCard, NeighborsCard, SpecialEquipmentCard } from './SpecialCards';

// 有专用卡片的项（12 页 P05C、P05D）：答案写进企业资料，状态由后台同步
const SPECIAL_KEYS = new Set(['special_equipment', 'external_resources', 'msds']);

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';
const IMAGE_ACCEPT = 'image/*,.pdf';
const muted = '#3F4A5C';

// 检查明细抽屉（12 页 P05B）：已满足的事实与来源在上，需要客户处理的项在下，交付前补齐的项最后。
// 特种设备、相邻企业、包装标签与说明书用专用卡片（P05C、P05D）。专用卡片写的是企业资料，提交后不再同步到任务，
// 所以提交后的待补项一律用普通卡片（上传、由我确认等直接记在任务上）
export function CheckDrawer({
  task,
  category,
  check,
  onClose,
  onBook,
}: {
  task: Task;
  category: CategoryCheck | null;
  check: TaskCheck;
  onClose: () => void;
  onBook: () => void;
}) {
  const all = category?.items ?? [];
  const submitted = task.status !== 'preparing';
  const special = (i: CategoryCheckItem) => !submitted && SPECIAL_KEYS.has(i.key);
  const generic = all.filter((i) => !special(i));
  const done = generic.filter((i) => i.state === 'done');
  const action = generic.filter((i) => i.state === 'missing');
  const waiting = generic.filter((i) => i.state === 'expert' || i.state === 'call');
  const later = generic.filter((i) => i.state === 'later');
  const count = (...states: string[]) => all.filter((i) => states.includes(i.state)).length;
  const single = (i: CategoryCheckItem) =>
    i.state === 'done' ? (
      <ul style={doneList}>
        <DoneRow task={task} item={i} check={check} first />
      </ul>
    ) : i.state === 'expert' || i.state === 'call' ? (
      <WaitingCard task={task} item={i} onBook={onBook} />
    ) : (
      <ActionCard task={task} item={i} tone={i.state === 'missing' ? 'action' : 'later'} onBook={onBook} />
    );
  const specialEquipment = all.find((i) => i.key === 'special_equipment' && special(i));
  const neighbors = all.find((i) => i.key === 'external_resources' && special(i));
  const msds = all.find((i) => i.key === 'msds' && special(i));
  const summary = [
    count('missing') && `${count('missing')} 项待补充`,
    count('expert', 'call') && `${count('expert', 'call')} 项耕云处理中`,
    count('later') && `${count('later')} 项可稍后补`,
  ].filter(Boolean);

  return (
    <Drawer
      open={category !== null}
      onClose={onClose}
      size={520}
      title={
        category && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{category.label} · 检查明细</span>
            <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 400, color: gy.secondary }}>
              {category.items.length} 项 · {summary.length > 0 ? summary.join('，') : '都已满足'}
            </span>
          </div>
        )
      }
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ fontSize: 13, color: gy.secondary }}>确认会记录确认人与时间，耕云专家核实时可见。</span>
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      {category && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {done.length > 0 && (
            <ul style={doneList}>
              {done.map((i, n) => (
                <DoneRow key={i.key} task={task} item={i} check={check} first={n === 0} />
              ))}
            </ul>
          )}
          {specialEquipment && <SpecialEquipmentCard task={task} item={specialEquipment} />}
          {action.map((i) => (
            <ActionCard key={i.key} task={task} item={i} tone="action" onBook={onBook} />
          ))}
          {waiting.map((i) => (
            <WaitingCard key={i.key} task={task} item={i} onBook={onBook} />
          ))}
          {msds && <MsdsCard task={task} item={msds} fallback={single(msds)} />}
          {neighbors && <NeighborsCard task={task} item={neighbors} />}
          {later.map((i) => (
            <ActionCard key={i.key} task={task} item={i} tone="later" onBook={onBook} />
          ))}
        </div>
      )}
    </Drawer>
  );
}

// 已满足的一项：说明 + 来源（文件名 / 您已确认 · 日期 / 企业自填 / 耕云生成）
function DoneRow({ task, item, check, first }: { task: Task; item: CategoryCheckItem; check: TaskCheck; first: boolean }) {
  const s = item.item;
  let detail = '';
  let tag: { text: string; tone: keyof typeof source } | null = null;
  if (item.requirement === 'system') {
    tag = { text: '耕云生成', tone: 'system' };
  } else if (s) {
    if (s.status === 'none') detail = '没有';
    else if (s.status === 'photo_for_expert') detail = '已拍照，耕云已判断';
    else if (s.note) detail = s.note;
    if (s.fileIds.length > 0) {
      const names = s.fileIds.map((f) => check.fileNames[f] ?? '已上传文件');
      tag = { text: names.length > 1 ? `${names[0]} 等 ${names.length} 份` : names[0]!, tone: 'customer' };
    } else if (s.confirmedBy) {
      const step = ITEM_STEP[item.key];
      tag =
        task.startMethod === 'self_fill' && !s.note && s.status === 'provided' && step
          ? { text: `企业自填第 ${step} 步`, tone: 'customer' }
          : { text: `${check.userNames[s.confirmedBy] ?? '您'}已确认 · ${monthDay(s.confirmedAt)}`, tone: 'confirm' };
    }
  }
  return (
    <li
      data-testid={`done-${item.key}`}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: first ? undefined : `1px solid ${gy.split}` }}
    >
      <CheckOutlined aria-hidden style={{ color: gy.success, fontSize: 13 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: '22px', color: gy.text }}>
        {item.label}
        {detail && <span style={{ color: gy.secondary }}> · {detail}</span>}
      </span>
      {tag && (
        <span
          style={{
            flexShrink: 0,
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 8px',
            borderRadius: 4,
            fontSize: 12,
            lineHeight: '22px',
            color: source[tag.tone].color,
            background: source[tag.tone].bg,
          }}
        >
          {tag.text}
        </span>
      )}
    </li>
  );
}

// 等耕云的项：拍照等专家判断、等专家电话联系。电话联系可以撤回，改为自己补
function WaitingCard({ task, item, onBook }: { task: Task; item: CategoryCheckItem; onBook: () => void }) {
  const [reopen, setReopen] = useState(false);
  if (reopen) {
    return <ActionCard task={task} item={item} tone={item.requirement === 'start' ? 'action' : 'later'} onBook={onBook} />;
  }
  return (
    <section
      data-testid={`item-${item.key}`}
      style={{ ...card, background: source.expert.bg, border: '1px solid #D8D2F2' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={cardTitle}>{item.label}</h3>
        <span style={{ fontSize: 12, color: source.expert.color }}>{item.state === 'call' ? '待专家联系' : '耕云判断中'}</span>
      </div>
      <p style={cardText}>
        {item.state === 'call'
          ? '提交后由负责专家打电话问清，不影响提交。'
          : '照片已收到，由注册安全工程师判断，您不用再管。'}
      </p>
      {item.state === 'call' && (
        <button type="button" style={link} onClick={() => setReopen(true)}>
          我自己补
        </button>
      )}
    </section>
  );
}

// 需要客户处理的一项：对应已传文件或补传、直接告诉我们（由我确认），也可以没有 / 拍照 / 电话联系 / 稍后补
function ActionCard({
  task,
  item,
  tone,
  onBook,
}: {
  task: Task;
  item: CategoryCheckItem;
  tone: 'action' | 'later';
  onBook: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const docs = useTaskDocuments(task.id);
  const [open, setOpen] = useState(tone === 'action');
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: taskCheckKey(task.id) });
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      message.success(done);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    } finally {
      setBusy(null);
    }
  };
  const setStatus = (status: 'provided' | 'none' | 'later' | 'photo_for_expert', extra: { callRequested?: boolean; note?: string } = {}) =>
    updateChecklistItem(task.id, item.key, { status, callRequested: extra.callRequested ?? false, note: extra.note });

  // 新文件：进企业资料库并关联到任务，再对应到这一项
  const uploadNew = (file: File, photo = false) =>
    run(
      photo ? 'photo' : 'upload',
      async () => {
        const fileId = await uploadFile(task.orgId, file, photo ? 'image_or_pdf' : 'material');
        client.setQueryData(taskDocumentsKey(task.id), await addTaskDocument(task.id, fileId));
        if (photo) await setStatus('photo_for_expert');
        await linkItemFile(task.id, item.key, fileId);
      },
      photo ? '照片已收到，交给耕云判断' : '已保存并对应到这一项',
    );

  const step = ITEM_STEP[item.key];
  const isLater = tone === 'later';
  const style: CSSProperties = isLater
    ? { ...card, background: gy.canvas, border: `1px solid ${gy.split}` }
    : { ...card, background: '#FFFBF0', border: '1px solid #E8C77A' };

  return (
    <section data-testid={`item-${item.key}`} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={cardTitle}>{item.label}</h3>
        {isLater && (
          <span style={{ padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', color: gy.warning, background: gy.warningBg }}>
            交付前补齐
          </span>
        )}
      </div>
      <p style={cardText}>
        {isLater
          ? '现在不补也能提交，专家审核时会提醒您。'
          : item.startPart
            ? `开始编制需要：${item.startPart}。`
            : '开始编制需要这一项。'}
        {item.item?.status === 'later' && !item.item.callRequested && '（已标为稍后补）'}
      </p>
      {item.key in DRAWINGS && <DrawingHint drawing={item.key as DrawingKey} onBook={onBook} />}

      {isLater && !open ? (
        <button type="button" style={link} onClick={() => setOpen(true)}>
          现在补充
        </button>
      ) : (
        <>
          <Block title="上传含此信息的文件" hint="已上传的资料里有，就直接选；没有可以补传">
            <div style={{ display: 'flex', gap: 8 }}>
              {(docs.data?.length ?? 0) > 0 && (
                <Select
                  aria-label={`${item.label}在哪份文件里`}
                  placeholder="选已上传的文件"
                  style={{ flex: 1, minWidth: 0 }}
                  value={null}
                  disabled={busy !== null}
                  options={docs.data!.map((d) => ({ value: d.fileId, label: `${d.name} · V${d.version}` }))}
                  onChange={(fileId: string) =>
                    void run('link', () => linkItemFile(task.id, item.key, fileId), '已对应到这一项')
                  }
                />
              )}
              <Upload
                accept={ACCEPT}
                showUploadList={false}
                disabled={busy !== null}
                beforeUpload={(file) => {
                  void uploadNew(file);
                  return false;
                }}
              >
                <Button loading={busy === 'upload'} aria-label={`为${item.label}选择文件`}>
                  选择文件
                </Button>
              </Upload>
            </div>
          </Block>

          <Block title="没有文件？直接告诉我们" hint="按企业当前实际情况填写" highlight>
            <Input.TextArea
              aria-label={`${item.label}实际情况`}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)}>
              我确认以上信息与企业实际情况一致
            </Checkbox>
            <Button
              type="primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!note.trim() || !agreed}
              loading={busy === 'note'}
              onClick={() => void run('note', () => setStatus('provided', { note: note.trim() }), '已保存确认')}
            >
              保存确认
            </Button>
          </Block>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 16px', fontSize: 13, color: gy.secondary }}>
            <span>也可以</span>
            {task.startMethod === 'self_fill' && task.status === 'preparing' && step && (
              <button type="button" style={link} onClick={() => navigate(`/customer/tasks/${task.id}/fill/${step}`)}>
                去第 {step} 步填写
              </button>
            )}
            {item.allowNone && (
              <button type="button" style={link} disabled={busy !== null} onClick={() => void run('none', () => setStatus('none'), `已记为${ITEM_STATUS_LABELS.none}`)}>
                没有这一项
              </button>
            )}
            {item.allowPhoto && (
              <Upload
                accept={IMAGE_ACCEPT}
                capture="environment"
                showUploadList={false}
                disabled={busy !== null}
                beforeUpload={(file) => {
                  void uploadNew(file, true);
                  return false;
                }}
              >
                <button type="button" style={link}>
                  拿不准，拍照给耕云看
                </button>
              </Upload>
            )}
            <button
              type="button"
              style={link}
              disabled={busy !== null}
              onClick={() => void run('call', () => setStatus('later', { callRequested: true }), '已请专家电话联系')}
            >
              请专家电话联系
            </button>
            {isLater && (
              <button type="button" style={link} disabled={busy !== null} onClick={() => void run('later', () => setStatus('later'), '已标为稍后补')}>
                稍后补（不影响提交）
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// 图纸怎么准备（12 页 P05D）：拍照、手画都可以；必需的图纸不能稍后补，实在没有可以请耕云上门绘制
function DrawingHint({ drawing, onBook }: { drawing: DrawingKey; onBook: () => void }) {
  const def = DRAWINGS[drawing];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: '20px', color: muted }}>
      <span>{def.hint}</span>
      {def.required && (
        <span>
          必需项不能稍后补。实在没有，可以
          <button type="button" style={{ ...link, alignSelf: 'auto', margin: '0 4px' }} onClick={onBook}>
            预约耕云上门
          </button>
          现场绘制。
        </span>
      )}
    </div>
  );
}

function Block({ title, hint, highlight, children }: { title: string; hint: string; highlight?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        borderRadius: 6,
        background: gy.surface,
        border: `1px solid ${highlight ? gy.primary : gy.split}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function monthDay(iso: string | undefined): string {
  if (!iso) return '';
  const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso)).split('-');
  return `${m}.${d}`;
}

const doneList: CSSProperties = { margin: 0, padding: 0, listStyle: 'none', borderRadius: 8, border: `1px solid ${gy.split}` };
const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 8 };
const cardTitle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text };
const cardText: CSSProperties = { margin: 0, fontSize: 13, lineHeight: '20px', color: muted };
const link: CSSProperties = {
  alignSelf: 'flex-start',
  textAlign: 'left',
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '20px',
  color: gy.primary,
};

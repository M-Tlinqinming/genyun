import { chinaToday, HOLIDAY_KIND_LABELS, holidayInputSchema, type HolidayInput, type HolidayKind, type KnowledgeHoliday } from '@genyun/shared';
import { App, Form, Input, Modal, Radio } from 'antd';
import { useMemo, useState, type CSSProperties } from 'react';
import { useRemoveHoliday, useSaveHoliday } from '../../../api/knowledge';
import { linkButton, panel, requiredAfter } from '../../../components/ui';
import { gy, stage } from '../../../theme/tokens';
import { body, monthDay, muted, small, Tag, TreeRow } from './parts';

// 节假日（设计稿没有这一页，按属地应急机构的样式做）：国务院每年公布的放假和调休上班日。
// 工作日计算（客户请求电话联系的 2 个工作日期限、超时转运营兜底）按这张表算；表里没有的年份只跳过周末

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
const COLS = { date: 200, kind: 120, updated: 160, action: 110 } as const;

export function HolidaysTab({ holidays, adding, onAdded }: { holidays: KnowledgeHoliday[]; adding: boolean; onAdded: () => void }) {
  const thisYear = Number(chinaToday().slice(0, 4));
  const years = useMemo(() => {
    const set = new Set([thisYear, thisYear + 1, ...holidays.map((h) => Number(h.date.slice(0, 4)))]);
    return [...set].sort((a, b) => a - b);
  }, [holidays, thisYear]);
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<KnowledgeHoliday | null>(null);
  const remove = useRemoveHoliday();
  const { message, modal } = App.useApp();
  const ofYear = (y: number) => holidays.filter((h) => h.date.startsWith(`${y}-`));
  const rows = ofYear(year);
  const off = rows.filter((h) => h.kind === 'holiday').length;
  const work = rows.length - off;
  const missing = years.filter((y) => y >= thisYear && ofYear(y).length === 0);

  const askRemove = (h: KnowledgeHoliday) =>
    modal.confirm({
      title: `删除 ${h.date}（${h.name}）？`,
      content: h.kind === 'holiday' ? '删除后这一天按平常日子算（工作日照常算工作日）。' : '删除后这一天按周末算，不再算工作日。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await remove.mutateAsync(h.date);
          message.success('已删除');
        } catch (err) {
          message.error(err instanceof Error ? err.message : '没有删除成功，请再试一次');
        }
      },
    });

  const th: CSSProperties = { ...body, fontWeight: 500, flexShrink: 0 };
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <nav aria-label="年份" style={{ ...panel, width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${gy.split}` }}>
          <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>年份</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 8px 12px' }}>
          {years.map((y) => (
            <TreeRow key={y} indent={12} label={`${y} 年`} count={ofYear(y).length} selected={y === year} onClick={() => setYear(y)} />
          ))}
        </div>
        {missing.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${gy.split}` }}>
            <span style={{ ...small, color: stage.action.color }}>
              {missing.map((y) => `${y} 年`).join('、')}尚无安排 · 国务院公布后请补上，之前只跳过周末
            </span>
          </div>
        )}
      </nav>

      <section aria-label={`${year} 年节假日`} style={{ ...panel, flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 24px' }}>
          <h2 style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text, margin: 0 }}>{year} 年放假和调休</h2>
          <span style={small}>{rows.length ? `${off} 天放假 · ${work} 天调休上班` : '还没有录入，这一年只跳过周末'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 24px', background: '#FAFAFB', borderTop: `1px solid ${gy.split}`, borderBottom: `1px solid ${gy.split}` }}>
          <span style={{ ...th, width: COLS.date }}>日期</span>
          <span style={{ ...th, width: COLS.kind }}>安排</span>
          <span style={{ ...th, flex: '1 1 0', minWidth: 0 }}>节日</span>
          <span style={{ ...th, width: COLS.updated }}>最近修改</span>
          <span style={{ ...th, width: COLS.action }}>操作</span>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((h) => (
            <li key={h.date} style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 24px', borderBottom: `1px solid ${gy.split}` }}>
              <span style={{ ...body, width: COLS.date, flexShrink: 0 }}>
                {h.date} <span style={muted}>{weekday(h.date)}</span>
              </span>
              <span style={{ width: COLS.kind, flexShrink: 0 }}>
                <Tag tone={h.kind === 'holiday' ? stage.done : stage.action}>{HOLIDAY_KIND_LABELS[h.kind]}</Tag>
              </span>
              <span style={{ ...body, flex: '1 1 0', minWidth: 0 }}>{h.name}</span>
              <span style={{ ...muted, width: COLS.updated, flexShrink: 0 }}>{h.updatedByName ? `${monthDay(h.updatedAt)} · ${h.updatedByName}` : '初始数据'}</span>
              <span style={{ width: COLS.action, flexShrink: 0, display: 'flex', gap: 4 }}>
                <button type="button" style={linkButton} onClick={() => setEditing(h)} aria-label={`编辑 ${h.date}`}>
                  编辑
                </button>
                <span style={{ ...body, color: gy.primary }} aria-hidden>
                  ·
                </span>
                <button type="button" style={linkButton} onClick={() => askRemove(h)} aria-label={`删除 ${h.date}`}>
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div style={{ padding: '12px 24px' }}>
          <span style={small}>客户请求电话联系后 2 个工作日内要联系上，超时转运营兜底，都按这张表算。改动马上生效。</span>
        </div>
      </section>

      <HolidayModal
        open={adding || editing !== null}
        holiday={editing}
        year={year}
        onClose={() => {
          setEditing(null);
          onAdded();
        }}
      />
    </div>
  );
}

function HolidayModal({ open, holiday, year, onClose }: { open: boolean; holiday: KnowledgeHoliday | null; year: number; onClose: () => void }) {
  const [form] = Form.useForm<HolidayInput>();
  const save = useSaveHoliday();
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields();
    const parsed = holidayInputSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      form.setFields([{ name: issue.path[0] as keyof HolidayInput, errors: [issue.message] }]);
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      message.success(`${parsed.data.date} 已设为${HOLIDAY_KIND_LABELS[parsed.data.kind]}`);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '没有保存成功，请再试一次');
    }
  };
  const initial: Partial<HolidayInput> = holiday
    ? { date: holiday.date, kind: holiday.kind, name: holiday.name }
    : { kind: 'holiday' as HolidayKind, date: year === Number(chinaToday().slice(0, 4)) ? undefined : `${year}-01-01` };
  return (
    <Modal
      open={open}
      title={holiday ? `编辑 ${holiday.date}` : '新增日期'}
      okText="保存"
      cancelText="取消"
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      afterClose={() => form.resetFields()}
      destroyOnHidden
      width={480}
    >
      <p style={{ ...muted, margin: '0 0 16px' }}>按国务院办公厅公布的放假安排录入，一天一条。同一天再保存会覆盖原来的。</p>
      <Form form={form} layout="vertical" requiredMark={requiredAfter} initialValues={initial}>
        <Form.Item label="日期" name="date" rules={[{ required: true, message: '请选择日期' }]}>
          <Input type="date" disabled={holiday !== null} />
        </Form.Item>
        <Form.Item label="安排" name="kind" rules={[{ required: true, message: '请选择' }]} extra="调休上班：本来是周末，但要上班，算工作日。">
          <Radio.Group options={(['holiday', 'workday'] as const).map((k) => ({ value: k, label: HOLIDAY_KIND_LABELS[k] }))} />
        </Form.Item>
        <Form.Item label="节日名称" name="name" rules={[{ required: true, whitespace: true, message: '请填写节日名称' }]}>
          <Input maxLength={20} placeholder="例如：春节、春节调休" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

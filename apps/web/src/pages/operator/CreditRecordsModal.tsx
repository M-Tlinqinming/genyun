import { CloseOutlined } from '@ant-design/icons';
import { chinaToday, CREDIT_ENTRY_TYPE_LABELS, type CreditEntryType, type OperatorCreditEntry } from '@genyun/shared';
import { Button, Modal, Table, type TableColumnType } from 'antd';
import { useState } from 'react';
import { useOrgCredits } from '../../api/operator';
import { Loading } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';

type Filter = 'all' | CreditEntryType;
// 页签顺序（画板上没有「加购次数」，补上）
const TABS: Filter[] = ['all', 'delivery_deduction', 'contract_purchase', 'top_up', 'gift', 'compensation'];

const dotted = (date: string) => date.replaceAll('-', '.');
const fullDate = (iso: string) => dotted(chinaToday(new Date(iso)));

function describe(e: OperatorCreditEntry): [string, string] {
  const reason = `原因：${e.reason ?? '—'}`;
  switch (e.type) {
    case 'delivery_deduction':
      return [
        `${e.enterpriseName ?? '—'} · ${e.taskNumber ?? '—'} · 已交付 · 扣的是${e.pool === 'gift' ? '赠送' : '购买'}的次数`,
        '专家交付时自动记下。之后重新打开再交付、撤回重发不再算。',
      ];
    case 'contract_purchase':
      return [`年度服务合同 · ${dotted(e.contractStartsAt)} – ${dotted(e.contractEndsAt)}`, reason];
    case 'gift':
      return [`活动：${e.campaign ?? '—'}`, reason];
    case 'top_up':
      return [`合同外加购，跟合同一起到期（${dotted(e.contractEndsAt)}）`, reason];
    case 'compensation':
      return [`补偿给客户，跟合同一起到期（${dotted(e.contractEndsAt)}）`, reason];
  }
}

const columns: TableColumnType<OperatorCreditEntry>[] = [
  { title: '日期', key: 'date', width: 92, render: (_, e) => fullDate(e.createdAt) },
  { title: '类型', key: 'type', width: 96, render: (_, e) => e.typeLabel },
  {
    title: '说明',
    key: 'text',
    render: (_, e) => {
      const [a, b] = describe(e);
      return (
        <>
          <div style={{ ...type.body, color: gy.text }}>{a}</div>
          <div style={{ ...type.caption, color: gy.secondary }}>{b}</div>
        </>
      );
    },
  },
  {
    title: '次数',
    key: 'delta',
    width: 64,
    align: 'right',
    render: (_, e) => (
      <span style={{ fontWeight: weight.strong, color: e.delta > 0 ? gy.success : gy.text, whiteSpace: 'nowrap' }}>
        {e.delta > 0 ? `+ ${e.delta}` : `− ${Math.abs(e.delta)}`}
      </span>
    ),
  },
  {
    title: '操作人',
    key: 'by',
    width: 80,
    render: (_, e) => (e.type === 'delivery_deduction' ? '系统' : (e.createdByName ?? '—')),
  },
];

// 次数记录（Paper 16 页「次数记录」弹窗）：按类型筛选，每页 10 条；点「调整次数」关掉这个、打开调整
export function CreditRecordsModal({
  orgId,
  orgName,
  onClose,
  onAdjust,
}: {
  orgId: string;
  orgName: string;
  onClose: () => void;
  onAdjust?: () => void;
}) {
  const credits = useOrgCredits(orgId);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const c = credits.data;
  const rows = c ? c.entries.filter((e) => filter === 'all' || e.type === filter) : [];
  const total = c ? c.entries.length : 0;

  const subtitle = c
    ? `${orgName} · 共 ${c.granted} 次，已用 ${c.used} 次，剩余 ${c.remaining.total} 次（赠送 ${c.remaining.gift} 次，购买 ${c.remaining.purchase} 次）${
        c.validUntil ? `· 有效期至 ${dotted(c.validUntil)}` : ''
      }`
    : orgName;

  return (
    <Modal
      open
      width={800}
      onCancel={onClose}
      closeIcon={<CloseOutlined aria-label="关闭" />}
      title={
        <div>
          <div style={{ ...type.subtitle, fontWeight: weight.strong }}>次数记录</div>
          <div style={{ ...type.body, fontWeight: 400, color: gy.secondary, marginTop: 4 }}>{subtitle}</div>
        </div>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>关闭</Button>
          {onAdjust && (
            <Button type="primary" onClick={onAdjust}>
              调整次数
            </Button>
          )}
        </div>
      }
    >
      {credits.isPending ? (
        <Loading rows={6} card={false} />
      ) : credits.isError ? (
        <div role="alert" style={{ ...type.body, color: gy.error }}>
          {credits.error.message}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
          <div role="tablist" aria-label="按类型筛选" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TABS.map((t) => {
              const on = t === filter;
              const n = t === 'all' ? total : (c?.typeCounts[t] ?? 0);
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setFilter(t);
                    setPage(1);
                  }}
                  style={{
                    ...type.body,
                    padding: '2px 12px',
                    borderRadius: 14,
                    border: 'none',
                    cursor: 'pointer',
                    background: on ? gy.selected : gy.neutralBg,
                    color: on ? gy.primary : gy.text,
                    fontWeight: on ? weight.strong : 400,
                  }}
                >
                  {t === 'all' ? '全部' : CREDIT_ENTRY_TYPE_LABELS[t]} {n}
                </button>
              );
            })}
          </div>
          <div style={{ border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
            <Table<OperatorCreditEntry>
              rowKey="id"
              size="middle"
              dataSource={rows}
              columns={columns}
              tableLayout="fixed"
              locale={{ emptyText: '还没有记录' }}
              pagination={
                rows.length > 10
                  ? { current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, style: { margin: '12px 16px' } }
                  : false
              }
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

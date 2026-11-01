import { ReloadOutlined } from '@ant-design/icons';
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, type AuditAction, type AuditLogEntry } from '@genyun/shared';
import { Button, Empty, Select, Table } from 'antd';
import { useState } from 'react';
import { useAuditLogs } from '../../api/audit';
import { PageHeader } from '../../components/PageHeader';
import { Notice, panel } from '../../components/ui';
import { gy } from '../../theme/tokens';

// 操作日志（M4 第 5 项，等保要求）：只读。没有 Paper 设计稿，沿用客户组织列表的标题、卡片和筛选样式。
// 只有运营能进；接口对其他身份返回 403

const label = { fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 } as const;
const secondLine = { display: 'block', fontSize: 12, lineHeight: '20px', color: gy.secondary } as const;

// 2026-11-01T01:30:05Z → 2026.11.01 09:30:05（北京时间）
function beijingTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const logs = useAuditLogs(page, action === 'all' ? undefined : action);

  return (
    <>
      <PageHeader
        eyebrow="耕云运营 / 操作日志"
        title="操作日志"
        description="登录、退出、修改和重设密码等关键操作的记录（登录失败时记的是输入的邮箱），只能查看，不能修改。时间为北京时间。"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void logs.refetch()} loading={logs.isFetching}>
            刷新
          </Button>
        }
      />
      {logs.isError && !logs.data ? (
        <Notice
          tone="warning"
          title="操作日志暂时打不开"
          text="请稍后点「重新加载」再试。"
          action={<Button onClick={() => void logs.refetch()}>重新加载</Button>}
        />
      ) : (
        <div style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '20px 24px' }}>
            <div style={{ width: 240 }}>
              <div style={label} id="audit-action-label">
                操作类型
              </div>
              <Select<AuditAction | 'all'>
                value={action}
                onChange={(v) => {
                  setAction(v);
                  setPage(1);
                }}
                aria-labelledby="audit-action-label"
                style={{ width: '100%' }}
                options={[{ value: 'all', label: '全部操作' }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))]}
              />
            </div>
          </div>
          <Table<AuditLogEntry>
            rowKey="id"
            dataSource={logs.data?.entries}
            loading={logs.isPending || (logs.isFetching && logs.isPlaceholderData)}
            pagination={{
              current: page,
              pageSize: logs.data?.pageSize ?? 50,
              total: logs.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
              showTotal: (n) => `共 ${n} 条`,
              style: { padding: '0 24px' },
            }}
            locale={{
              emptyText: <Empty description={action === 'all' ? '还没有操作记录' : `没有「${AUDIT_ACTION_LABELS[action]}」的记录`} style={{ padding: '48px 0' }} />,
            }}
            columns={[
              {
                title: '时间',
                dataIndex: 'at',
                width: 200,
                onHeaderCell: () => ({ style: { paddingLeft: 24 } }),
                onCell: () => ({ style: { paddingLeft: 24, fontVariantNumeric: 'tabular-nums' } }),
                render: beijingTime,
              },
              {
                title: '操作人',
                key: 'actor',
                width: 260,
                render: (_, e) => (
                  <>
                    <span style={{ display: 'block', wordBreak: 'break-all' }}>{e.actorName ?? e.actorEmail ?? '—'}</span>
                    {e.actorName && e.actorEmail && <span style={{ ...secondLine, wordBreak: 'break-all' }}>{e.actorEmail}</span>}
                  </>
                ),
              },
              { title: '操作', dataIndex: 'action', width: 160, render: (a: AuditAction) => AUDIT_ACTION_LABELS[a] ?? '其他' },
              { title: '对象', dataIndex: 'target', render: (t: string | null) => t ?? '—' },
              {
                title: 'IP',
                dataIndex: 'ip',
                width: 180,
                onCell: () => ({ style: { fontVariantNumeric: 'tabular-nums' } }),
                render: (ip: string | null) => ip ?? '—',
              },
            ]}
          />
        </div>
      )}
    </>
  );
}

import { SearchOutlined } from '@ant-design/icons';
import {
  chinaToday,
  contractState,
  formatRegion,
  maskPhone,
  ORG_SERVICE_STATES,
  orgCreditCell,
  orgNeedsAttention,
  regionFilterKey,
  type OrgServiceState,
} from '@genyun/shared';
import { Button, Empty, Input, Pagination, Select, Table, Typography, type TableColumnType } from 'antd';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useOperatorOrgs, type OperatorOrgRow } from '../../api/operator';
import { PageHeader } from '../../components/PageHeader';
import { StatCells } from '../../components/StatCells';
import { StatusTag, type StatusTone } from '../../components/StatusTag';
import { linkButton, Notice, panel } from '../../components/ui';
import { gy, weight } from '../../theme/tokens';
import { OpenOrgModal } from './OpenOrgModal';
import { RegisterOrgModal } from './RegisterOrgModal';

type Cell = 'active' | 'pending' | 'attention' | 'expired';
type Expiry = 'any' | 'within30' | 'within90' | 'expired';

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: 'any', label: '不限' },
  { value: 'within30', label: '30 天内到期' },
  { value: 'within90', label: '90 天内到期' },
  { value: 'expired', label: '已到期' },
];

const STATE_TONE: Record<OrgServiceState, StatusTone> = { active: 'done', pending: 'action', expired: 'progress' };
const PAGE_SIZE = 20;

// 2026-01-01 → 2026.01.01
const dotted = (date: string) => date.replaceAll('-', '.');
const monthDay = (iso: string) => dotted(chinaToday(new Date(iso))).slice(5);
const yearMonth = (iso: string) => dotted(chinaToday(new Date(iso))).slice(0, 7);

const label = { fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 } as const;
const firstLine: CSSProperties = { display: 'block', fontSize: 14, lineHeight: '22px', whiteSpace: 'nowrap' };
const secondLine: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '20px', color: gy.secondary, whiteSpace: 'nowrap' };

const shortRegion = (o: OperatorOrgRow) => (o.regionParts ? formatRegion(o.regionParts, 'short') : o.region);
const regionKey = (o: OperatorOrgRow) => (o.regionParts ? regionFilterKey(o.regionParts) : o.region);

function subtitleOf(o: OperatorOrgRow): string {
  const when = o.activatedAt ? `${yearMonth(o.activatedAt)} 开通` : `${monthDay(o.createdAt)} 登记`;
  return [shortRegion(o), when].filter(Boolean).join(' · ');
}

// 剩余次数：正常 / 快用完 / 已用完 / 待开通 / 合同还没开始 / 已到期（16 页列表和「次数用完」状态 2）
function CreditCell({ org: o }: { org: OperatorOrgRow }) {
  const c = orgCreditCell(o, o.credits);
  switch (c.kind) {
    case 'normal':
      return (
        <>
          <span style={firstLine}>{c.remaining} 次</span>
          <span style={secondLine}>共 {c.granted} 次</span>
        </>
      );
    case 'low':
      return (
        <>
          <span style={{ ...firstLine, color: gy.warning, fontWeight: weight.strong }}>{c.remaining} 次 · 快用完</span>
          <span style={secondLine}>共 {c.granted} 次</span>
        </>
      );
    case 'out':
      return (
        <>
          <span style={{ ...firstLine, color: gy.error, fontWeight: weight.strong }}>0 次 · 已用完</span>
          <span style={secondLine}>
            共 {c.granted} 次{c.awaiting > 0 ? ` · ${c.awaiting} 份成果等次数` : ''}
          </span>
        </>
      );
    case 'pending':
      return (
        <>
          <span style={firstLine}>—</span>
          <span style={secondLine}>开通时登记</span>
        </>
      );
    case 'upcoming':
      return (
        <>
          <span style={firstLine}>—</span>
          <span style={secondLine}>合同 {dotted(c.startsAt).slice(5)} 起生效</span>
        </>
      );
    case 'expired':
      return (
        <>
          <span style={firstLine}>—</span>
          <span style={secondLine}>合同已到期{c.awaiting > 0 ? ` · ${c.awaiting} 份成果等续约` : ''}</span>
        </>
      );
  }
}

function ServiceCell({ org: o }: { org: OperatorOrgRow }) {
  if (o.state === 'pending' || !o.contractStartsAt || !o.contractEndsAt) {
    return (
      <>
        <span style={firstLine}>—</span>
        <span style={secondLine}>开通时填写</span>
      </>
    );
  }
  const c = contractState(o);
  const note =
    c.state === 'upcoming'
      ? `${dotted(o.contractStartsAt).slice(5)} 起生效`
      : c.state === 'expired'
        ? '已到期'
        : `还有 ${c.daysLeft} 天到期`;
  return (
    <>
      <span style={firstLine}>
        {dotted(o.contractStartsAt)} – {dotted(o.contractEndsAt)}
      </span>
      <span style={{ ...secondLine, color: c.state === 'expiring' ? gy.warning : gy.secondary }}>{note}</span>
    </>
  );
}

// 服务到期筛选：按组织上的合同到期日算；待开通的不算
function matchesExpiry(o: OperatorOrgRow, expiry: Expiry, today: string): boolean {
  if (expiry === 'any') return true;
  if (o.state === 'pending' || !o.contractEndsAt) return false;
  const days = (Date.parse(o.contractEndsAt) - Date.parse(today)) / 86_400_000;
  if (expiry === 'expired') return days < 0;
  return days >= 0 && days <= (expiry === 'within30' ? 30 : 90);
}

// 表头 44 高、每行 72 高；第一列左边距 24
const cellPad = (first: boolean, header: boolean): CSSProperties => ({
  paddingTop: header ? 11 : 0,
  paddingBottom: header ? 11 : 0,
  paddingLeft: first ? 24 : 16,
});

// I02 客户组织：登记、开通客户组织，维护合同和编制次数（Paper 16 页）。点「查看」进组织详情（I03）
export function OrganizationListPage() {
  const orgs = useOperatorOrgs();
  const [cell, setCell] = useState<Cell | undefined>();
  const [keyword, setKeyword] = useState('');
  const [region, setRegion] = useState<string>('all');
  const [expiry, setExpiry] = useState<Expiry>('any');
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  // 从运营概览「今天先处理」点「开通与邀请」进来时带着 ?open=<组织>，直接打开开通弹窗
  const [params, setParams] = useSearchParams();
  const [opening, setOpening] = useState<string | null>(params.get('open'));

  const today = chinaToday();
  const all = useMemo(() => orgs.data ?? [], [orgs.data]);
  // 统计格按全部组织算，不受搜索和筛选影响；「快到期或快用完」和「服务中」有重叠
  const counts = useMemo(() => {
    const c: Record<Cell, number> = { active: 0, pending: 0, attention: 0, expired: 0 };
    for (const o of all) {
      c[o.state] += 1;
      if (orgNeedsAttention(o, o.credits, today)) c.attention += 1;
    }
    return c;
  }, [all, today]);
  const regions = useMemo(
    () => [...new Set(all.map(regionKey).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [all],
  );

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const digits = k.replace(/\D/g, '');
    return all
      .filter((o) => !cell || (cell === 'attention' ? orgNeedsAttention(o, o.credits, today) : o.state === cell))
      .filter((o) => region === 'all' || regionKey(o) === region)
      .filter((o) => matchesExpiry(o, expiry, today))
      .filter(
        (o) =>
          !k ||
          o.name.toLowerCase().includes(k) ||
          (o.contactName ?? '').toLowerCase().includes(k) ||
          (digits.length >= 3 && (o.contactPhone ?? '').replace(/\D/g, '').includes(digits)),
      );
  }, [all, cell, keyword, region, expiry, today]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const filtered = keyword !== '' || region !== 'all' || expiry !== 'any' || cell !== undefined;
  const reset = () => {
    setKeyword('');
    setRegion('all');
    setExpiry('any');
    setCell(undefined);
    setPage(1);
  };
  const filterBy =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  const registerButton = (
    <Button type="primary" onClick={() => setRegistering(true)}>
      登记客户组织
    </Button>
  );

  const baseColumns: TableColumnType<OperatorOrgRow>[] = [
    {
      title: '客户组织',
      key: 'name',
      width: 280,
      render: (_, o) => (
        <>
          <Typography.Text ellipsis={{ tooltip: o.name }} style={{ display: 'block', maxWidth: 240 }}>
            {o.name}
          </Typography.Text>
          <span style={secondLine}>{subtitleOf(o)}</span>
        </>
      ),
    },
    {
      title: '主联系人',
      key: 'contact',
      width: 180,
      render: (_, o) => (
        <>
          <span style={firstLine}>{o.contactName ?? '—'}</span>
          {o.contactPhone && <span style={secondLine}>{maskPhone(o.contactPhone)}</span>}
        </>
      ),
    },
    { title: '剩余次数', key: 'credits', width: 200, render: (_, o) => <CreditCell org={o} /> },
    {
      title: '在办任务',
      key: 'tasks',
      width: 96,
      render: (_, o) => (o.state === 'pending' ? '—' : o.openTasks),
    },
    { title: '年度服务', key: 'service', render: (_, o) => <ServiceCell org={o} /> },
    {
      title: '状态',
      key: 'state',
      width: 120,
      render: (_, o) => <StatusTag tone={STATE_TONE[o.state]}>{ORG_SERVICE_STATES[o.state]}</StatusTag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 96,
      render: (_, o) =>
        o.state === 'pending' ? (
          <button type="button" style={linkButton} onClick={() => setOpening(o.id)} aria-label={`开通${o.name}`}>
            开通
          </button>
        ) : (
          <Link to={o.id} style={linkButton} aria-label={`查看${o.name}`}>
            查看
          </Link>
        ),
    },
  ];
  const columns = baseColumns.map((c, i) => ({
    ...c,
    onHeaderCell: () => ({ style: cellPad(i === 0, true) }),
    onCell: () => ({ style: cellPad(i === 0, false) }),
  }));

  return (
    <>
      <PageHeader title="客户组织" description="登记、开通客户组织，维护合同和编制次数。" actions={registerButton} />
      {orgs.isError ? (
        <Notice
          tone="warning"
          title="客户组织没有加载出来"
          text={orgs.error.message}
          action={<Button onClick={() => void orgs.refetch()}>重新加载</Button>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <StatCells
            label="按服务状态筛选"
            selected={cell}
            onSelect={(k) => filterBy(setCell)(k as Cell | undefined)}
            items={[
              { key: 'active', label: '服务中', value: counts.active, tone: 'done' },
              { key: 'pending', label: '待开通', value: counts.pending, tone: 'action' },
              { key: 'attention', label: '快到期或快用完', value: counts.attention, tone: 'action', emphasis: counts.attention > 0 },
              { key: 'expired', label: '已到期', value: counts.expired, tone: 'progress' },
            ]}
          />
          <div style={{ ...panel, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '20px 24px' }}>
              <label style={{ flex: 1, minWidth: 0 }}>
                <div style={label}>搜索组织</div>
                <Input
                  allowClear
                  value={keyword}
                  prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                  placeholder="组织名称 / 联系人 / 手机号"
                  onChange={(e) => filterBy(setKeyword)(e.target.value)}
                />
              </label>
              <div style={{ width: 200 }}>
                <div style={label} id="org-region-label">
                  所在地区
                </div>
                <Select
                  value={region}
                  onChange={filterBy(setRegion)}
                  aria-labelledby="org-region-label"
                  style={{ width: '100%' }}
                  showSearch={{ optionFilterProp: 'label' }}
                  options={[{ value: 'all', label: '全部地区' }, ...regions.map((r) => ({ value: r, label: r }))]}
                />
              </div>
              <div style={{ width: 200 }}>
                <div style={label} id="org-expiry-label">
                  服务到期
                </div>
                <Select<Expiry>
                  value={expiry}
                  onChange={filterBy(setExpiry)}
                  aria-labelledby="org-expiry-label"
                  style={{ width: '100%' }}
                  options={EXPIRY_OPTIONS}
                />
              </div>
              <Button onClick={reset} disabled={!filtered}>
                重置
              </Button>
            </div>
            <Table<OperatorOrgRow>
              rowKey="id"
              dataSource={pageRows}
              loading={orgs.isPending}
              onRow={() => ({ style: { height: 72 } })}
              pagination={false}
              tableLayout="fixed"
              locale={{
                // 加载中不显示「还没有客户组织」和第二个登记按钮，免得一闪而过
                emptyText: orgs.isPending ? (
                  <div style={{ height: 160 }} />
                ) : all.length === 0 ? (
                  <Empty description="还没有客户组织。合作确认后先登记，签约到账后再开通。" style={{ padding: '48px 0' }}>
                    {registerButton}
                  </Empty>
                ) : (
                  <Empty description="没有符合条件的组织" style={{ padding: '48px 0' }}>
                    <Button onClick={reset}>重置</Button>
                  </Empty>
                ),
              }}
              columns={columns}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '16px 24px',
                borderTop: `1px solid ${gy.split}`,
              }}
            >
              <Link to="/operator/organizations/gift-campaigns" style={{ fontSize: 14, lineHeight: '22px' }}>
                赠送活动统计
              </Link>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>共 {rows.length} 个组织</span>
                <Pagination current={current} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} showSizeChanger={false} />
              </div>
            </div>
          </div>
        </div>
      )}
      <RegisterOrgModal orgId={null} open={registering} onClose={() => setRegistering(false)} />
      {opening && (
        <OpenOrgModal
          orgId={opening}
          onClose={() => {
            setOpening(null);
            if (params.has('open')) setParams({}, { replace: true });
          }}
        />
      )}
    </>
  );
}

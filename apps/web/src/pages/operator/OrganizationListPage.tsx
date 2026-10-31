import { SearchOutlined } from '@ant-design/icons';
import { chinaToday, contractState, maskPhone, ORG_SERVICE_STATES, type OrgServiceState } from '@genyun/shared';
import { Button, Empty, Input, Select, Table, Tabs, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useOperatorOrgs, type OperatorOrgRow } from '../../api/operator';
import { PageHeader } from '../../components/PageHeader';
import { linkButton, Notice, panel } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { OpenOrgModal } from './OpenOrgModal';
import { RegisterOrgModal } from './RegisterOrgModal';

type Tab = 'all' | OrgServiceState;
type Expiry = 'any' | 'expiring' | 'expired';

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: 'any', label: '不限' },
  { value: 'expiring', label: '30 天内到期' },
  { value: 'expired', label: '已到期' },
];

const STATE_TONE: Record<OrgServiceState, { color: string; bg: string }> = {
  active: stage.done,
  pending: stage.action,
  expired: stage.progress,
};

// 2026-01-01 → 2026.01.01
const dotted = (date: string) => date.replaceAll('-', '.');
const monthDay = (iso: string) => dotted(chinaToday(new Date(iso))).slice(5);
const yearMonth = (iso: string) => dotted(chinaToday(new Date(iso))).slice(0, 7);

const label = { fontSize: 14, lineHeight: '22px', color: gy.text, marginBottom: 8 } as const;
const secondLine = { display: 'block', fontSize: 12, lineHeight: '20px', color: gy.secondary } as const;

function subtitleOf(o: OperatorOrgRow): string {
  const when = o.activatedAt ? `${yearMonth(o.activatedAt)} 开通` : `${monthDay(o.createdAt)} 登记`;
  return [o.region, when].filter(Boolean).join(' · ');
}

function ServiceCell({ org: o }: { org: OperatorOrgRow }) {
  if (o.state === 'pending' || !o.contractStartsAt || !o.contractEndsAt) {
    return (
      <>
        <span>—</span>
        <span style={secondLine}>开通时填写</span>
      </>
    );
  }
  const c = contractState(o);
  const note =
    c.state === 'upcoming'
      ? `${dotted(o.contractStartsAt).slice(5)} 起生效`
      : c.state === 'expired'
        ? '已到期，不能新建任务'
        : `剩余 ${c.daysLeft} 天`;
  return (
    <>
      <span>
        {dotted(o.contractStartsAt)} – {dotted(o.contractEndsAt)}
      </span>
      <span style={{ ...secondLine, color: c.state === 'expiring' ? gy.warning : gy.secondary }}>{note}</span>
    </>
  );
}

// I02 客户组织：登记、开通并维护年度服务（Paper 16 页）。组织详情在 M3 第 2 项
export function OrganizationListPage() {
  const orgs = useOperatorOrgs();
  const [tab, setTab] = useState<Tab>('all');
  const [keyword, setKeyword] = useState('');
  const [region, setRegion] = useState<string>('all');
  const [expiry, setExpiry] = useState<Expiry>('any');
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const all = orgs.data ?? [];
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: all.length, active: 0, pending: 0, expired: 0 };
    for (const o of all) c[o.state] += 1;
    return c;
  }, [all]);
  const regions = useMemo(() => [...new Set(all.map((o) => o.region).filter((r): r is string => !!r))].sort(), [all]);

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const digits = k.replace(/\D/g, '');
    return all
      .filter((o) => tab === 'all' || o.state === tab)
      .filter((o) => region === 'all' || o.region === region)
      .filter((o) => {
        if (expiry === 'any') return true;
        if (o.state === 'pending') return false;
        const s = contractState(o).state;
        return expiry === 'expired' ? s === 'expired' : s === 'expiring';
      })
      .filter(
        (o) =>
          !k ||
          o.name.toLowerCase().includes(k) ||
          (o.contactName ?? '').toLowerCase().includes(k) ||
          (digits.length >= 3 && (o.contactPhone ?? '').replace(/\D/g, '').includes(digits)),
      );
  }, [all, tab, keyword, region, expiry]);

  const filtered = keyword !== '' || region !== 'all' || expiry !== 'any';
  const reset = () => {
    setKeyword('');
    setRegion('all');
    setExpiry('any');
  };

  const registerButton = (
    <Button type="primary" size="large" onClick={() => setRegistering(true)}>
      登记客户组织
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="耕云运营 / 客户组织"
        title="客户组织"
        description="合作已确认的安全咨询机构。在这里登记、开通并维护年度服务。"
        extra={registerButton}
      />
      {orgs.isError ? (
        <Notice
          tone="warning"
          title="客户组织没有加载出来"
          text={orgs.error.message}
          action={<Button onClick={() => void orgs.refetch()}>重新加载</Button>}
        />
      ) : (
        <div style={{ ...panel, overflow: 'hidden' }}>
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as Tab)}
            tabBarStyle={{ padding: '0 24px', margin: 0 }}
            tabBarGutter={32}
            items={(['all', 'active', 'pending', 'expired'] as const).map((k) => ({
              key: k,
              label: `${k === 'all' ? '全部' : ORG_SERVICE_STATES[k]} ${counts[k]}`,
            }))}
          />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '20px 24px' }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <div style={label}>搜索组织</div>
              <Input
                allowClear
                value={keyword}
                prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
                placeholder="组织名称 / 联系人 / 手机号"
                onChange={(e) => setKeyword(e.target.value)}
              />
            </label>
            <div style={{ width: 200 }}>
              <div style={label} id="org-region-label">
                所在地区
              </div>
              <Select
                value={region}
                onChange={setRegion}
                aria-labelledby="org-region-label"
                style={{ width: '100%' }}
                options={[{ value: 'all', label: '全部地区' }, ...regions.map((r) => ({ value: r, label: r }))]}
              />
            </div>
            <div style={{ width: 200 }}>
              <div style={label} id="org-expiry-label">
                服务到期
              </div>
              <Select<Expiry>
                value={expiry}
                onChange={setExpiry}
                aria-labelledby="org-expiry-label"
                style={{ width: '100%' }}
                options={EXPIRY_OPTIONS}
              />
            </div>
            <Button onClick={reset} disabled={!filtered}>
              清除筛选
            </Button>
          </div>
          <Table<OperatorOrgRow>
            rowKey="id"
            dataSource={rows}
            loading={orgs.isPending}
            onRow={() => ({ style: { height: 72 } })}
            pagination={{
              pageSize: 20,
              hideOnSinglePage: false,
              showTotal: (n) => `共 ${n} 个组织`,
              style: { padding: '0 24px' },
            }}
            locale={{
              emptyText:
                all.length === 0 ? (
                  <Empty description="还没有客户组织。合作确认后先登记，签约到账后再开通。" style={{ padding: '48px 0' }}>
                    {registerButton}
                  </Empty>
                ) : (
                  <Empty
                    description={filtered || tab === 'all' ? '没有符合条件的组织' : `没有${ORG_SERVICE_STATES[tab]}的组织`}
                    style={{ padding: '48px 0' }}
                  >
                    {filtered && <Button onClick={reset}>清除筛选</Button>}
                  </Empty>
                ),
            }}
            columns={[
              {
                title: '客户组织',
                key: 'name',
                width: 280,
                onHeaderCell: () => ({ style: { paddingLeft: 24 } }),
                onCell: () => ({ style: { paddingLeft: 24 } }),
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
                    <span style={{ display: 'block' }}>{o.contactName ?? '—'}</span>
                    {o.contactPhone && <span style={secondLine}>{maskPhone(o.contactPhone)}</span>}
                  </>
                ),
              },
              {
                title: '企业 / 成员',
                key: 'size',
                width: 120,
                render: (_, o) => (o.state === 'pending' ? '— / —' : `${o.enterprises} / ${o.members}`),
              },
              {
                title: '在办任务',
                key: 'tasks',
                width: 120,
                render: (_, o) => (o.state === 'pending' ? '—' : o.openTasks),
              },
              { title: '年度服务', key: 'service', render: (_, o) => <ServiceCell org={o} /> },
              {
                title: '状态',
                key: 'state',
                width: 120,
                render: (_, o) => (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      lineHeight: '22px',
                      color: STATE_TONE[o.state].color,
                      background: STATE_TONE[o.state].bg,
                    }}
                  >
                    {ORG_SERVICE_STATES[o.state]}
                  </span>
                ),
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
                    <button type="button" style={linkButton} onClick={() => setEditing(o.id)} aria-label={`修改${o.name}的资料`}>
                      修改资料
                    </button>
                  ),
              },
            ]}
          />
        </div>
      )}
      <RegisterOrgModal
        orgId={editing}
        open={registering || editing !== null}
        onClose={() => {
          setRegistering(false);
          setEditing(null);
        }}
      />
      {opening && <OpenOrgModal orgId={opening} onClose={() => setOpening(null)} />}
    </>
  );
}

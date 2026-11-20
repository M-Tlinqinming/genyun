import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { chinaToday, type GiftCampaignOrgRow, type GiftCampaignRow } from '@genyun/shared';
import { Button, Select } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useGiftCampaigns } from '../../api/operator';
import { PageHeader } from '../../components/PageHeader';
import { linkButton, Loading, Notice, panel } from '../../components/ui';
import { gy, type, weight } from '../../theme/tokens';

const dotted = (date: string) => date.replaceAll('-', '.');

// 各列宽度（照画板）；最后一列「操作」占剩下的
const COLS = [360, 150, 110, 110, 110, 190] as const;
const cell = (i: number): CSSProperties => ({ width: COLS[i], flexShrink: 0, paddingRight: 16, boxSizing: 'border-box' });
const row: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 24px', borderTop: `1px solid ${gy.split}` };
const text: CSSProperties = { ...type.body, color: gy.text };

function UsedBar({ used, granted, strong }: { used: number; granted: number; strong?: boolean }) {
  const ratio = granted > 0 ? Math.min(1, used / granted) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 94 }}>
      <span style={{ ...text, fontWeight: strong ? weight.strong : 400 }}>{used} 次</span>
      <div
        role="progressbar"
        aria-label="已用"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 4, borderRadius: 2, background: gy.neutralBg }}
      >
        <div style={{ height: 4, borderRadius: 2, background: gy.primary, width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function OrgRow({ org }: { org: GiftCampaignOrgRow }) {
  return (
    <div style={{ ...row, minHeight: 52 }}>
      <div style={{ ...cell(0), paddingLeft: 20 }}>
        <span style={text}>{org.orgName}</span>
      </div>
      <div style={{ ...cell(1), ...text, color: gy.secondary }}>
        {[dotted(org.lastGiftedOn), org.lastGiftedByName].filter(Boolean).join(' · ')}
      </div>
      <div style={{ ...cell(2), ...text }}>{org.granted} 次</div>
      <div style={cell(3)}>
        <UsedBar used={org.used} granted={org.granted} />
      </div>
      <div style={{ ...cell(4), ...text, color: org.unused > 0 ? gy.text : gy.secondary }}>{org.unused} 次</div>
      <div style={{ ...cell(5), ...text, color: org.expired ? gy.secondary : gy.text }}>
        {org.expired ? `${dotted(org.endsAt)} · 已到期` : dotted(org.endsAt)}
      </div>
      <div style={{ flex: 1 }}>
        <Link to={`/operator/organizations/${org.orgId}?records=1`} style={linkButton} aria-label={`${org.orgName}的次数记录`}>
          次数记录
        </Link>
      </div>
    </div>
  );
}

function CampaignRows({ campaign, name }: { campaign: GiftCampaignRow; name: string }) {
  const [open, setOpen] = useState(true);
  const empty = campaign.orgCount === 0;
  const strong = empty ? undefined : weight.strong;
  const dim = empty ? gy.secondary : gy.text;
  return (
    <>
      <div style={{ ...row, minHeight: 56 }}>
        <div style={{ ...cell(0), display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            aria-expanded={open && !empty}
            aria-label={`${open ? '收起' : '展开'}${name}`}
            disabled={empty}
            onClick={() => setOpen((v) => !v)}
            style={{ border: 'none', background: 'none', padding: 0, cursor: empty ? 'default' : 'pointer', color: gy.secondary, width: 12 }}
          >
            {open && !empty ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
          </button>
          <span style={{ ...text, color: dim, fontWeight: strong }}>{name}</span>
          <span style={{ ...type.caption, color: gy.secondary, whiteSpace: 'nowrap' }}>{campaign.orgCount} 个客户组织</span>
        </div>
        <div style={{ ...cell(1), ...text, color: gy.secondary }}>
          {campaign.lastGiftedOn ? `最近 ${dotted(campaign.lastGiftedOn)}` : '—'}
        </div>
        <div style={{ ...cell(2), ...text, color: dim, fontWeight: strong }}>{campaign.granted} 次</div>
        <div style={cell(3)}>
          {empty ? (
            <span style={{ ...text, color: dim }}>0 次</span>
          ) : (
            <UsedBar used={campaign.used} granted={campaign.granted} strong />
          )}
        </div>
        <div style={{ ...cell(4), ...text, color: dim, fontWeight: strong }}>{campaign.unused} 次</div>
        <div style={{ ...cell(5), ...text, color: gy.secondary }}>{empty ? '—' : '跟各家合同一起到期'}</div>
        <div style={{ flex: 1 }} />
      </div>
      {open && campaign.orgs.map((o) => <OrgRow key={o.orgId} org={o} />)}
    </>
  );
}

// 赠送活动统计（Paper 16 页）：每个活动送出去多少次、用掉多少；按活动名称归在一起，最后固定一行没写活动名称的
export function GiftCampaignsPage() {
  const [year, setYear] = useState<number>(() => Number(chinaToday().slice(0, 4)));
  const stats = useGiftCampaigns(year);
  const s = stats.data;

  let body: ReactNode;
  if (stats.isError)
    body = (
      <div style={{ padding: 24 }}>
        <Notice
          tone="warning"
          title="赠送统计没有加载出来"
          text={stats.error.message}
          action={<Button onClick={() => void stats.refetch()}>重新加载</Button>}
        />
      </div>
    );
  else if (!s) body = <Loading rows={4} card={false} />;
  else
    body = (
      <>
        <div style={{ ...row, borderTop: `1px solid ${gy.split}`, background: '#FAFAFB', minHeight: 44 }}>
          {['活动 / 客户组织', '登记日期', '送出', '已用', '还没用', '到期'].map((h, i) => (
            <div key={h} style={{ ...cell(i), ...text, color: gy.secondary }}>
              {h}
            </div>
          ))}
          <div style={{ flex: 1, ...text, color: gy.secondary }}>操作</div>
        </div>
        {s.campaigns.map((c) => (
          <CampaignRows key={c.campaign ?? ''} campaign={c} name={c.campaign ?? '没写活动名称的赠送'} />
        ))}
        <CampaignRows campaign={s.unnamed} name="没写活动名称的赠送" />
      </>
    );

  return (
    <>
      <PageHeader
        back={{ to: '/operator/organizations', label: '返回客户组织' }}
        title="赠送活动统计"
        description="每个活动送出去多少次、用掉多少。开通、续约和「调整次数」里登记的「耕云赠送」都算，按活动名称归在一起。"
      />
      <section aria-label="赠送活动" style={{ ...panel, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 24px' }}>
          <span style={{ ...text, color: gy.secondary }}>
            {s ? (
              <>
                {s.year} 年共送出 <b style={{ color: gy.text, fontWeight: weight.strong }}>{s.granted} 次</b>，送给 {s.orgCount}{' '}
                个客户组织，已用 {s.used} 次
              </>
            ) : (
              ' '
            )}
          </span>
          <Select<number>
            aria-label="年份"
            value={year}
            onChange={setYear}
            style={{ width: 96 }}
            options={(s?.years ?? [year]).map((y) => ({ value: y, label: `${y} 年` }))}
          />
        </div>
        {body}
      </section>
    </>
  );
}

import { KNOWLEDGE_TAB_LABELS, KNOWLEDGE_TABS, type KnowledgeTab } from '@genyun/shared';
import { Button } from 'antd';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useKnowledgeAgencies } from '../../../api/knowledge';
import { PageHeader } from '../../../components/PageHeader';
import { Loading, Notice } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { AgenciesTab } from './AgenciesTab';

// 知识库（Paper 16 页「知识库 · 属地应急机构」）：只有耕云运营能进。
// 工艺模板、节假日页签已取消；旧链接里的 ?tab=templates / holidays 落到属地应急机构

const HEADERS: Record<KnowledgeTab, { description: string; add: string }> = {
  agencies: { description: '按行政区维护应急局、街道、消防等机构的联系方式。编制时系统按企业地址自动引用。', add: '新增机构' },
};

const isTab = (v: string | null): v is KnowledgeTab => (KNOWLEDGE_TABS as readonly (string | null)[]).includes(v);

export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const tab: KnowledgeTab = isTab(params.get('tab')) ? (params.get('tab') as KnowledgeTab) : 'agencies';
  const [adding, setAdding] = useState(false);
  const agencies = useKnowledgeAgencies();
  const counts: Record<KnowledgeTab, number | undefined> = {
    agencies: agencies.data?.regions.reduce((n, r) => n + r.agencies.filter((a) => !a.disabled).length, 0),
  };
  const current = { agencies }[tab];

  let content: ReactNode;
  if (current.isPending) content = <Loading rows={8} />;
  else if (current.isError)
    content = <Notice tone="warning" title="知识库暂时打不开" text={current.error.message} action={<Button onClick={() => void current.refetch()}>重新加载</Button>} />;
  else content = <AgenciesTab regions={agencies.data!.regions} adding={adding} onAdded={() => setAdding(false)} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ marginBottom: -32 }}>
        <PageHeader
          eyebrow="耕云运营 / 知识库"
          title={`知识库 · ${KNOWLEDGE_TAB_LABELS[tab]}`}
          description={HEADERS[tab].description}
          extra={
            <Button type="primary" onClick={() => setAdding(true)} disabled={!current.data}>
              {HEADERS[tab].add}
            </Button>
          }
        />
      </div>
      <div role="tablist" aria-label="知识库分类" style={{ display: 'flex', gap: 28, borderBottom: `1px solid ${gy.split}` }}>
        {KNOWLEDGE_TABS.map((t) => {
          const on = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setAdding(false);
                setParams(t === 'agencies' ? {} : { tab: t }, { replace: true });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 0',
                marginBottom: -1,
                border: 'none',
                borderBottom: `2px solid ${on ? gy.primary : 'transparent'}`,
                background: 'none',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: on ? 500 : 400, color: on ? gy.primary : gy.secondary }}>{KNOWLEDGE_TAB_LABELS[t]}</span>
              {counts[t] !== undefined && <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>{counts[t]}</span>}
            </button>
          );
        })}
      </div>
      {content}
    </div>
  );
}

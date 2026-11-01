import { KNOWLEDGE_TAB_LABELS, KNOWLEDGE_TABS, type KnowledgeTab } from '@genyun/shared';
import { Button } from 'antd';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useKnowledgeAgencies, useKnowledgeHolidays, useKnowledgeTemplates } from '../../../api/knowledge';
import { PageHeader } from '../../../components/PageHeader';
import { Loading, Notice } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { AgenciesTab } from './AgenciesTab';
import { HolidaysTab } from './HolidaysTab';
import { TemplatesTab } from './TemplatesTab';

// 知识库（Paper 16 页「知识库 · 属地应急机构」「知识库 · 工艺模板」）：只有耕云运营能进。
// ?tab= 切换属地应急机构、工艺模板、节假日（节假日没有设计稿）

const HEADERS: Record<KnowledgeTab, { description: string; add: string }> = {
  agencies: { description: '按行政区维护应急局、街道、消防等机构的联系方式。编制时系统按企业地址自动引用。', add: '新增机构' },
  templates: { description: '客户在「生产情况 · 工艺流程」选行业模板时使用。选中后工序、常见设备和物料一起预填。', add: '新增模板' },
  holidays: { description: '国务院公布的放假和调休上班日。客户请求电话联系的期限等按工作日计算时使用。', add: '新增日期' },
};

const isTab = (v: string | null): v is KnowledgeTab => (KNOWLEDGE_TABS as readonly (string | null)[]).includes(v);

export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const tab: KnowledgeTab = isTab(params.get('tab')) ? (params.get('tab') as KnowledgeTab) : 'agencies';
  const [adding, setAdding] = useState(false);
  const agencies = useKnowledgeAgencies();
  const templates = useKnowledgeTemplates();
  const holidays = useKnowledgeHolidays();
  const counts: Record<KnowledgeTab, number | undefined> = {
    agencies: agencies.data?.regions.reduce((n, r) => n + r.agencies.filter((a) => !a.disabled).length, 0),
    templates: templates.data?.templates.filter((t) => t.state !== 'disabled').length,
    holidays: holidays.data?.holidays.length,
  };
  const current = { agencies, templates, holidays }[tab];

  let content: ReactNode;
  if (current.isPending) content = <Loading rows={8} />;
  else if (current.isError)
    content = <Notice tone="warning" title="知识库暂时打不开" text={current.error.message} action={<Button onClick={() => void current.refetch()}>重新加载</Button>} />;
  else if (tab === 'agencies') content = <AgenciesTab regions={agencies.data!.regions} adding={adding} onAdded={() => setAdding(false)} />;
  else if (tab === 'templates') content = <TemplatesTab templates={templates.data!.templates} adding={adding} onAdded={() => setAdding(false)} />;
  else content = <HolidaysTab holidays={holidays.data!.holidays} adding={adding} onAdded={() => setAdding(false)} />;

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

import { figuresView, orgChartSvg, type OrganizationStep, type OrgFigureSettings } from '@genyun/shared';
import { App, Radio } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from '../../../../api/request';
import { useSaveFigures, type Workup } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, type } from '../../../../theme/tokens';
import { caption, link14, SideCard, softLine } from './parts';
import type { Autosave } from './useAutosave';

// 页面预览缩小后宋体太细，换成界面字体；Word 里的图仍是宋体
const svgUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/font-family="[^"]*"/, `font-family="'Microsoft YaHei', 'Noto Sans SC', sans-serif"`))}`;

const rowLabel: CSSProperties = { width: 80, flexShrink: 0, ...type.caption, color: gy.secondary, lineHeight: '24px' };

// 右栏「组织体系图」：按这一步正在改的内容实时画；副总指挥、应急办公室显不显示和小组顺序存进图件画法
export function OrgChartCard({
  taskId,
  workup,
  step,
  autosave,
  latestVersion,
}: {
  taskId: string;
  workup: Workup;
  step: OrganizationStep;
  autosave: Autosave;
  latestVersion: () => number;
}) {
  const { message } = App.useApp();
  const saveFigures = useSaveFigures(taskId);
  const [ordering, setOrdering] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const stored = workup.data.profile?.organizationStep ?? workup.snapshot.profile.organizationStep;
  const data = { ...workup.data, profile: { ...workup.data.profile, organizationStep: { rosterFileIds: [], ...stored, step } } };
  const org = figuresView(workup.snapshot, data).org;
  const svg = orgChartSvg({ deputy: org.deputy, office: org.office, groups: org.groups });

  const saveOrg = async (patch: Partial<OrgFigureSettings> | null) => {
    try {
      await autosave.flush();
      await saveFigures.mutateAsync({ version: latestVersion(), org: patch === null ? null : { ...workup.data.figures?.org, ...patch } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        return;
      }
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    }
  };
  const saving = saveFigures.isPending;

  const moveBefore = (name: string, target: string) => {
    if (!name || name === target) return;
    const rest = org.groups.filter((g) => g !== name);
    const after = org.groups.indexOf(name) < org.groups.indexOf(target);
    rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, name);
    void saveOrg({ order: rest });
  };

  return (
    <SideCard title="应急救援组织体系图" tag={<SourceTag kind="system" text="实时生成" />} label="应急救援组织体系图">
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: 12, background: '#FAFBFC', border: `1px solid ${softLine}`, borderRadius: 6 }}
      >
        <img src={svgUrl(svg.svg)} alt={`组织体系图：应急指挥部下设${org.groups.join('、')}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>
      <span style={caption}>图上只写职务，姓名和电话放在成员表里。增删小组后，图会自动调整。</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: `1px solid ${softLine}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, ...caption }}>想调排版才调</span>
          {org.customized && (
            <button type="button" style={{ ...link14, ...type.caption, color: gy.secondary }} disabled={saving} onClick={() => void saveOrg(null)}>
              恢复自动排版
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LayoutRow name="副总指挥">
            <ShowHide name="副总指挥" value={org.deputy} disabled={saving} onChange={(deputy) => void saveOrg({ deputy })} />
          </LayoutRow>
          {org.deputy && !org.hasDeputy && <span style={{ ...type.caption, color: gy.warning, paddingLeft: 88 }}>还没有填副总指挥</span>}
          <LayoutRow name="应急办公室">
            <ShowHide name="应急办公室" value={org.office} disabled={saving} onChange={(office) => void saveOrg({ office })} />
          </LayoutRow>
          <LayoutRow name="小组顺序">
            <span style={{ ...type.caption, color: gy.text, lineHeight: '24px' }}>{org.customOrder ? '调整过' : '按规则排序'}</span>
            {org.groups.length > 1 && (
              <button type="button" style={{ ...link14, ...type.caption }} onClick={() => setOrdering(!ordering)}>
                {ordering ? '完成' : '拖动调整'}
              </button>
            )}
            {org.customOrder && (
              <button type="button" style={{ ...link14, ...type.caption }} disabled={saving} onClick={() => void saveOrg({ order: undefined })}>
                恢复规则排序
              </button>
            )}
          </LayoutRow>
          {ordering && (
            <ol aria-label="小组顺序" style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
              {org.groups.map((g, i) => (
                <li
                  key={g}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', g);
                    setDragging(g);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveBefore(e.dataTransfer.getData('text/plain') || dragging || '', g);
                    setDragging(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 32,
                    padding: '0 10px 0 8px',
                    borderRadius: 6,
                    borderWidth: 1,
                    borderStyle: dragging && dragging !== g ? 'dashed' : 'solid',
                    borderColor: dragging && dragging !== g ? gy.primary : '#D9D9D9',
                    background: gy.surface,
                    opacity: dragging === g ? 0.4 : 1,
                    cursor: 'grab',
                    ...type.caption,
                    color: gy.text,
                  }}
                >
                  <span aria-hidden style={{ width: 18, height: 18, borderRadius: 9, background: gy.neutralBg, textAlign: 'center', lineHeight: '18px', color: gy.secondary }}>
                    {i + 1}
                  </span>
                  {g}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </SideCard>
  );
}

function LayoutRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={rowLabel}>{name}</span>
      {children}
    </div>
  );
}

function ShowHide({ name, value, disabled, onChange }: { name: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <Radio.Group
      aria-label={name}
      size="small"
      optionType="button"
      buttonStyle="solid"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as boolean)}
      options={[
        { label: '显示', value: true },
        { label: '不显示', value: false },
      ]}
    />
  );
}

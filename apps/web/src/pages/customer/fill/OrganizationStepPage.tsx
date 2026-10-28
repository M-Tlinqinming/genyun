import { CloseOutlined, DownOutlined, LoadingOutlined, RightOutlined } from '@ant-design/icons';
import {
  compilationTeamOf,
  dutyPhoneOfStep,
  GROUP_DESCRIPTIONS,
  MAX_GROUPS,
  MIN_GROUPS,
  newId,
  orgChartOf,
  organizationStepSchema,
  peopleOf,
  PRESET_GROUPS,
  presetGroup,
  suggestedGroups,
  uploadRuleHint,
  type DraftGroup,
  type DraftPerson,
  type OrganizationStep,
  type PresetGroupKey,
} from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Dropdown, Input, Popconfirm, Segmented, Spin, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  addRoster,
  isStale,
  organizationStepKey,
  removeRoster,
  saveOrganizationStep,
  uploadFile,
  useOrganizationStep,
  type OrganizationStepView,
} from '../../../api/profile';
import type { Task } from '../../../api/tasks';
import { gy, source } from '../../../theme/tokens';
import { AFTER_FILLING, FillCard, FillFrame, SidePanel, StepTitle } from './FillFrame';
import { OrgChart } from './OrgChart';
import { useAutosave } from './useAutosave';

type PersonPatch = Partial<Omit<DraftPerson, 'id'>>;

const MAX_MEMBERS = 30;
// 「添加小组」按体系图的顺序列出还没加的预置组
const ADDABLE: PresetGroupKey[] = ['rescue', 'evacuation', 'medical', 'logistics', 'communication'];

const filled = (v?: string) => Boolean(v && v.trim() !== '');
const phoneError = (v?: string) =>
  v && !/^[\d\s\-+()（）]*$/.test(v) ? '电话只能填数字、空格和短横线' : undefined;
const person = (patch: PersonPatch): DraftPerson => ({ id: newId('p'), name: '', ...patch });

// 按 id 改一个人：同一个人兼任多个小组时，各处一起改
function patchPerson(step: OrganizationStep, id: string, patch: PersonPatch): OrganizationStep {
  const fix = <T extends DraftPerson | undefined>(p: T): T => (p && p.id === id ? { ...p, ...patch } : p);
  return {
    ...step,
    commander: fix(step.commander),
    deputies: step.deputies.map(fix),
    groups: step.groups.map((g) => ({ ...g, leader: fix(g.leader), members: g.members.map(fix) })),
  };
}

// S02 企业自填第 2 步「人员与应急组织」：逐项填写或上传花名册，边填边自动保存，体系图实时生成
export function OrganizationStepPage({ task }: { task: Task }) {
  const query = useOrganizationStep(task.enterpriseId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [step, setStep] = useState<OrganizationStep | null>(null);
  const [roster, setRoster] = useState<OrganizationStepView['roster']>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const saved = useRef<OrganizationStepView | null>(null);

  const remember = useCallback(
    (view: OrganizationStepView) => {
      saved.current = view;
      client.setQueryData(organizationStepKey(view.enterpriseId), view);
    },
    [client],
  );

  // 把后台返回的内容放进页面（首次打开、别人改过后）
  const apply = useCallback(
    (view: OrganizationStepView) => {
      remember(view);
      setStep(view.step);
      setRoster(view.roster);
    },
    [remember],
  );

  useEffect(() => {
    if (!query.data || saved.current) return;
    apply(query.data);
    // 默认展开第一个小组
    setExpanded(new Set(query.data.step.groups.slice(0, 1).map((g) => g.id)));
  }, [query.data, apply]);

  const autosave = useAutosave<OrganizationStep>(
    async (data) => {
      remember(await saveOrganizationStep(task.enterpriseId, { version: saved.current!.version, step: data }));
    },
    (err) => {
      if (!isStale(err)) return false;
      message.warning(err.message);
      void query.refetch().then((r) => r.data && apply(r.data));
      return true;
    },
  );

  // 格式不对（如电话里写了汉字）先不保存，字段下方已提示，改对后接着保存
  const update = (next: OrganizationStep) => {
    setStep(next);
    if (organizationStepSchema.safeParse(next).success) autosave.schedule(next);
  };

  const leave = async (to: string) => {
    setLeaving(true);
    try {
      await autosave.flush();
      navigate(to);
    } catch {
      message.error('还有内容没保存成功，请稍后再试');
    } finally {
      setLeaving(false);
    }
  };

  // 一次选了多份时逐份上传：每份都会让版本加 1，同时发会互相冲突
  const uploads = useRef(Promise.resolve());
  const onRosterFile = (file: File) => {
    setUploading(true);
    const next = uploads.current.then(async () => {
      try {
        await autosave.flush();
        const fileId = await uploadFile(task.orgId, file, 'material');
        const view = await addRoster(task.id, task.enterpriseId, fileId);
        remember(view);
        setRoster(view.roster);
      } catch (err) {
        message.error(err instanceof Error ? `${file.name}：${err.message}` : '上传失败，请稍后重试');
      }
    });
    uploads.current = next;
    void next.then(() => {
      if (uploads.current === next) setUploading(false);
    });
  };

  const onRemoveRoster = async (fileId: string) => {
    try {
      await autosave.flush();
      const view = await removeRoster(task.id, task.enterpriseId, fileId);
      remember(view);
      setRoster(view.roster);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '移除失败，请稍后重试');
    }
  };

  const rosterMode = step?.mode === 'roster';
  const pendingLeaders = step ? step.groups.filter((g) => !filled(g.leader?.name)).length : 0;
  const summary = !step
    ? ''
    : rosterMode
      ? roster.length > 0
        ? `已上传 ${roster.length} 份花名册`
        : '还没有上传花名册'
      : `${step.groups.length} 个小组${pendingLeaders > 0 ? `，${pendingLeaders} 位组长可稍后补` : ''}`;

  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
        第 2 步，共 5 步{summary && ` · ${summary}`}
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button size="large" disabled={leaving} onClick={() => void leave(`/customer/tasks/${task.id}/fill/1`)}>
          上一步
        </Button>
        <Button
          size="large"
          type="primary"
          loading={leaving}
          onClick={() => void leave(`/customer/tasks/${task.id}/fill/3`)}
        >
          下一步：生产情况
        </Button>
      </div>
    </>
  );

  return (
    <FillFrame
      step={2}
      enterpriseName={task.enterpriseName}
      saveState={autosave.state}
      savedAt={autosave.savedAt}
      onExit={() => void leave(`/customer/enterprises/${task.enterpriseId}`)}
      exiting={leaving}
      footer={footer}
    >
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title="出了事，谁来指挥、谁去处置"
          description="先填总指挥和各组组长，组员可以稍后补。右侧的组织体系图会随您填写实时生成，不用自己画。"
        />

        {!step ? (
          <Spin style={{ padding: '96px 0' }} />
        ) : (
          <>
            <ModeSwitch mode={step.mode} onChange={(mode) => update({ ...step, mode })} />
            {rosterMode ? (
              <RosterCard
                roster={roster}
                uploading={uploading}
                onFile={onRosterFile}
                onRemove={(id) => void onRemoveRoster(id)}
              />
            ) : (
              <>
                <CommandCard step={step} onChange={update} />
                <GroupsCard
                  step={step}
                  employeeCount={saved.current?.employeeCount ?? null}
                  expanded={expanded}
                  onExpanded={setExpanded}
                  onChange={update}
                />
              </>
            )}
            <DutyPhoneCard step={step} onChange={update} />
            {!rosterMode && <CompilationCard step={step} onChange={update} />}
          </>
        )}
      </div>

      <SidePanel
        top={step && !rosterMode ? <OrgChart chart={orgChartOf(step)} /> : undefined}
        why={[
          '预案要写明应急指挥部和各小组的负责人与联系电话，发生事故时按这张表通知到人。',
          '一人可兼任多个小组；电话请填手机，方便 24 小时联系。',
        ]}
        after={AFTER_FILLING}
      />
    </FillFrame>
  );
}

function ModeSwitch({ mode, onChange }: { mode: OrganizationStep['mode']; onChange: (m: OrganizationStep['mode']) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 16px',
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
        已有组织架构表或通讯录？上传后由专家整理，可跳过本页。
      </span>
      <Segmented
        value={mode}
        onChange={(v) => onChange(v as OrganizationStep['mode'])}
        options={[
          { value: 'form', label: '逐项填写' },
          { value: 'roster', label: '上传花名册' },
        ]}
      />
    </div>
  );
}

function CardHeading({ title, description, tag, extra }: { title: string; description: string; tag?: ReactNode; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</h2>
          {tag}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{description}</p>
      </div>
      {extra}
    </div>
  );
}

function SystemTag({ children, padding = '0 6px' }: { children: string; padding?: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        padding,
        borderRadius: 4,
        background: source.system.bg,
        color: source.system.color,
        fontSize: 12,
        lineHeight: '18px',
      }}
    >
      {children}
    </span>
  );
}

// 姓名、职位、手机三列；trailing 固定 24 宽，放「移除」或留空，保证各行对齐
function Columns({ label, labelWidth, small }: { label: string; labelWidth: number; small?: boolean }) {
  const text = { fontSize: small ? 12 : 13, lineHeight: small ? '18px' : '20px', color: gy.tertiary } as const;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ ...text, width: labelWidth, flexShrink: 0 }}>{label}</span>
      <span style={{ ...text, flex: '1 1 0' }}>姓名</span>
      <span style={{ ...text, flex: '1 1 0' }}>{small ? '公司岗位' : '公司职位'}</span>
      <span style={{ ...text, flex: '1.2 1 0' }}>手机</span>
      <span style={{ width: 24, flexShrink: 0 }} />
    </div>
  );
}

function PersonRow({
  role,
  strong,
  labelWidth,
  label,
  value,
  onChange,
  onRemove,
}: {
  role: string;
  strong?: boolean;
  labelWidth: number;
  // 无障碍名称前缀，如「总指挥」「抢险救灾组组长」
  label: string;
  value?: DraftPerson;
  onChange: (patch: PersonPatch) => void;
  onRemove?: () => void;
}) {
  const error = phoneError(value?.phone);
  const input = { flex: '1 1 0', minWidth: 0 } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            width: labelWidth,
            flexShrink: 0,
            fontSize: labelWidth > 64 ? 14 : 13,
            lineHeight: labelWidth > 64 ? '22px' : '20px',
            fontWeight: strong ? 500 : 400,
            color: strong ? gy.text : gy.secondary,
          }}
        >
          {role}
        </span>
        <Input
          aria-label={`${label}姓名`}
          value={value?.name ?? ''}
          maxLength={50}
          onChange={(e) => onChange({ name: e.target.value })}
          style={input}
        />
        <Input
          aria-label={`${label}职位`}
          value={value?.position ?? ''}
          maxLength={50}
          onChange={(e) => onChange({ position: e.target.value })}
          style={input}
        />
        <Input
          aria-label={`${label}手机`}
          value={value?.phone ?? ''}
          maxLength={30}
          inputMode="tel"
          status={error ? 'error' : undefined}
          onChange={(e) => onChange({ phone: e.target.value })}
          style={{ ...input, flex: '1.2 1 0' }}
        />
        <span style={{ width: 24, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          {onRemove && (
            <Button
              type="text"
              size="small"
              aria-label={`移除${label}`}
              icon={<CloseOutlined style={{ fontSize: 12, color: gy.tertiary }} />}
              onClick={onRemove}
            />
          )}
        </span>
      </div>
      {error && (
        <span style={{ paddingLeft: labelWidth + 12, fontSize: 12, lineHeight: '18px', color: gy.error }}>{error}</span>
      )}
    </div>
  );
}

function CommandCard({ step, onChange }: { step: OrganizationStep; onChange: (s: OrganizationStep) => void }) {
  const editCommander = (patch: PersonPatch) =>
    onChange(step.commander ? patchPerson(step, step.commander.id, patch) : { ...step, commander: person(patch) });
  // 空行一开始输入就变成正式的一行；先定好 id，行不会重建、输入框不会失去焦点
  const [draftId] = useState(() => newId('p'));
  const editDeputy = (i: number, patch: PersonPatch) => {
    const d = step.deputies[i];
    onChange(
      d
        ? patchPerson(step, d.id, patch)
        : { ...step, deputies: [...step.deputies, { id: draftId, name: '', ...patch }] },
    );
  };
  // 没有副总指挥时留一行空的；清掉就是「不设副总指挥」
  const rows: (DraftPerson | undefined)[] = step.deputies.length > 0 ? step.deputies : [undefined];

  return (
    <FillCard>
      <CardHeading title="应急指挥部" description="通常由总经理任总指挥、分管安全的负责人任副总指挥。" />
      <Columns label="应急职务" labelWidth={120} />
      <PersonRow role="总指挥" strong labelWidth={120} label="总指挥" value={step.commander} onChange={editCommander} />
      {rows.map((d, i) => (
        <PersonRow
          key={d?.id ?? draftId}
          role="副总指挥"
          strong
          labelWidth={120}
          label={rows.length > 1 ? `副总指挥 ${i + 1} ` : '副总指挥'}
          value={d}
          onChange={(patch) => editDeputy(i, patch)}
          onRemove={d ? () => onChange({ ...step, deputies: step.deputies.filter((x) => x.id !== d.id) }) : undefined}
        />
      ))}
      {step.deputies.length === 1 && (
        <Button
          type="link"
          onClick={() => onChange({ ...step, deputies: [...step.deputies, person({})] })}
          style={{ alignSelf: 'flex-start', padding: 0, height: 22, marginLeft: 132 }}
        >
          + 再加一位副总指挥
        </Button>
      )}
    </FillCard>
  );
}

function GroupsCard({
  step,
  employeeCount,
  expanded,
  onExpanded,
  onChange,
}: {
  step: OrganizationStep;
  employeeCount: number | null;
  expanded: Set<string>;
  onExpanded: (s: Set<string>) => void;
  onChange: (s: OrganizationStep) => void;
}) {
  const suggest = suggestedGroups(employeeCount ?? undefined);
  const range = suggest.min === suggest.max ? `${suggest.min}` : `${suggest.min}–${suggest.max}`;
  const people = peopleOf(step);
  const present = new Set(step.groups.map((g) => g.kind));
  const canAdd = step.groups.length < MAX_GROUPS;

  const setGroup = (id: string, fn: (g: DraftGroup) => DraftGroup) =>
    onChange({ ...step, groups: step.groups.map((g) => (g.id === id ? fn(g) : g)) });
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onExpanded(next);
  };
  const addGroup = (g: DraftGroup) => {
    onChange({ ...step, groups: [...step.groups, g] });
    onExpanded(new Set([...expanded, g.id]));
  };

  return (
    <FillCard gap={14}>
      <CardHeading
        title="应急小组"
        description={`${employeeCount !== null ? `已按 ${employeeCount} 人的规模` : '已'}预设 ${suggest.min} 个小组。先填组长，组员可交付前补齐。`}
        extra={<SystemTag padding="2px 8px">{`建议 ${range} 组`}</SystemTag>}
      />
      {step.groups.map((g) => (
        <GroupPanel
          key={g.id}
          group={g}
          open={expanded.has(g.id)}
          onToggle={() => toggle(g.id)}
          candidates={people.filter((p) => p.id !== g.leader?.id && !g.members.some((m) => m.id === p.id))}
          onLeader={(patch) =>
            onChange(g.leader ? patchPerson(step, g.leader.id, patch) : setLeader(step, g.id, person(patch)))
          }
          onMember={(id, patch) => onChange(patchPerson(step, id, patch))}
          onAddMember={(p) => setGroup(g.id, (x) => ({ ...x, members: [...x.members, p ?? person({})] }))}
          onRemoveMember={(id) => setGroup(g.id, (x) => ({ ...x, members: x.members.filter((m) => m.id !== id) }))}
          onRename={(name) => setGroup(g.id, (x) => ({ ...x, name }))}
          onRemove={
            step.groups.length > MIN_GROUPS
              ? () => onChange({ ...step, groups: step.groups.filter((x) => x.id !== g.id) })
              : undefined
          }
        />
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingTop: 4 }}>
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>添加小组</span>
        {canAdd ? (
          <>
            {ADDABLE.filter((k) => !present.has(k)).map((k) => (
              <AddChip key={k} onClick={() => addGroup(presetGroup(k))}>
                {PRESET_GROUPS[k]}
              </AddChip>
            ))}
            <AddChip onClick={() => addGroup({ id: newId('g'), kind: 'custom', name: '', members: [] })}>自定义</AddChip>
          </>
        ) : (
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>已有 {MAX_GROUPS} 个小组，不能再加</span>
        )}
      </div>
    </FillCard>
  );
}

function setLeader(step: OrganizationStep, groupId: string, leader: DraftPerson): OrganizationStep {
  return { ...step, groups: step.groups.map((g) => (g.id === groupId ? { ...g, leader } : g)) };
}

function AddChip({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 30,
        padding: '0 12px',
        borderRadius: 15,
        border: '1px dashed #A9B4C6',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: '20px',
        color: gy.primary,
      }}
    >
      + {children}
    </button>
  );
}

function GroupPanel({
  group,
  open,
  onToggle,
  candidates,
  onLeader,
  onMember,
  onAddMember,
  onRemoveMember,
  onRename,
  onRemove,
}: {
  group: DraftGroup;
  open: boolean;
  onToggle: () => void;
  candidates: DraftPerson[];
  onLeader: (patch: PersonPatch) => void;
  onMember: (id: string, patch: PersonPatch) => void;
  onAddMember: (p?: DraftPerson) => void;
  onRemoveMember: (id: string) => void;
  onRename: (name: string) => void;
  onRemove?: () => void;
}) {
  const title = group.name.trim() || '自定义小组';
  const hasLeader = filled(group.leader?.name);
  const memberCount = group.members.filter((m) => filled(m.name)).length;
  const headCount = memberCount + (hasLeader ? 1 : 0);
  const warn = !open && !hasLeader;
  const right = open
    ? { text: `${headCount} 人`, color: gy.tertiary }
    : hasLeader
      ? { text: `组长 ${group.leader!.name.trim()} · 组员 ${memberCount} 人`, color: gy.secondary }
      : { text: '组长待填 · 可稍后补', color: gy.warning };

  const addLabel = candidates.length > 0 ? '+ 添加组员（可从已填人员中选）' : '+ 添加组员';
  const addButton = (
    <Button type="link" style={{ padding: 0, height: 22 }} onClick={candidates.length > 0 ? undefined : () => onAddMember()}>
      {addLabel}
    </Button>
  );

  return (
    <section
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: open ? 16 : '14px 16px',
        borderRadius: 8,
        border: `1px solid ${warn ? '#F0D9A8' : gy.split}`,
        background: warn ? '#FFFBF2' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {open ? (
          <DownOutlined style={{ fontSize: 12, color: gy.secondary }} />
        ) : (
          <RightOutlined style={{ fontSize: 12, color: gy.secondary }} />
        )}
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{title}</span>
        {GROUP_DESCRIPTIONS[group.kind] && (
          <span style={{ fontSize: 12, lineHeight: '18px', color: '#8A93A3' }}>{GROUP_DESCRIPTIONS[group.kind]}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, lineHeight: '20px', color: right.color }}>{right.text}</span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 22 }}>
          {group.kind === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 64, flexShrink: 0, fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
                小组名称
              </span>
              <Input
                aria-label="自定义小组名称"
                value={group.name}
                maxLength={20}
                placeholder="如：环境监测组"
                onChange={(e) => onRename(e.target.value)}
                style={{ width: 240 }}
              />
            </div>
          )}
          <Columns label="职务" labelWidth={64} small />
          <PersonRow role="组长" strong labelWidth={64} label={`${title}组长`} value={group.leader} onChange={onLeader} />
          {group.members.map((m, i) => (
            <PersonRow
              key={m.id}
              role="组员"
              labelWidth={64}
              label={`${title}组员 ${i + 1} `}
              value={m}
              onChange={(patch) => onMember(m.id, patch)}
              onRemove={() => onRemoveMember(m.id)}
            />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {group.members.length >= MAX_MEMBERS ? (
              <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>每组最多 {MAX_MEMBERS} 名组员</span>
            ) : candidates.length > 0 ? (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'new', label: '新增一位组员' },
                    { type: 'divider' },
                    {
                      key: 'pick',
                      type: 'group',
                      label: '从已填人员中选',
                      children: candidates.map((p) => ({
                        key: p.id,
                        label: p.position ? `${p.name} · ${p.position}` : p.name,
                      })),
                    },
                  ],
                  onClick: ({ key }) => onAddMember(candidates.find((p) => p.id === key)),
                }}
              >
                {addButton}
              </Dropdown>
            ) : (
              addButton
            )}
            {onRemove && (
              <Popconfirm
                title={`删除${title}？`}
                description="组长和组员会一并移除。"
                okText="删除"
                cancelText="取消"
                onConfirm={onRemove}
              >
                <Button type="link" danger style={{ padding: 0, height: 22 }}>
                  删除这个小组
                </Button>
              </Popconfirm>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DutyPhoneCard({ step, onChange }: { step: OrganizationStep; onChange: (s: OrganizationStep) => void }) {
  const error = phoneError(step.dutyPhone);
  return (
    <section
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '20px 24px',
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>24 小时值班电话</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
          发生事故时第一时间接报。填值班室、门卫或值班负责人的电话。
        </p>
      </div>
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Input
          aria-label="24 小时值班电话"
          value={step.dutyPhone ?? ''}
          maxLength={30}
          inputMode="tel"
          placeholder="如 0752-1234567"
          status={error ? 'error' : undefined}
          onChange={(e) => onChange({ ...step, dutyPhone: e.target.value || undefined })}
        />
        {error && <span style={{ fontSize: 12, lineHeight: '18px', color: gy.error }}>{error}</span>}
      </div>
    </section>
  );
}

function CompilationCard({ step, onChange }: { step: OrganizationStep; onChange: (s: OrganizationStep) => void }) {
  const rows = compilationTeamOf(step);
  const setExtra = (id: string, patch: { name?: string; duty?: string }) =>
    onChange({
      ...step,
      compilationExtras: step.compilationExtras.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  const cell = { fontSize: 13, lineHeight: '20px' } as const;
  const row = (last: boolean) =>
    ({
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      borderBottom: last ? undefined : '1px solid #EEF0F3',
    }) as const;

  return (
    <FillCard gap={14}>
      <CardHeading
        title="应急预案编制小组"
        description="由总指挥、副总指挥和各组组长组成，分工已按常规写好，确认即可。"
        tag={<SystemTag>已自动生成</SystemTag>}
        extra={
          step.compilationExtras.length < 20 && (
            <Button
              type="link"
              style={{ padding: 0, height: 22, flexShrink: 0 }}
              onClick={() =>
                onChange({ ...step, compilationExtras: [...step.compilationExtras, { id: newId('c'), name: '' }] })
              }
            >
              + 添加编制成员
            </Button>
          )
        }
      />
      <div role="table" aria-label="应急预案编制小组" style={{ display: 'flex', flexDirection: 'column', borderRadius: 6, border: '1px solid #EEF0F3' }}>
        <div role="row" style={{ ...row(rows.length === 0), background: gy.canvas }}>
          <span role="columnheader" style={{ width: 64, flexShrink: 0, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>
            角色
          </span>
          <span role="columnheader" style={{ width: 120, flexShrink: 0, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>
            姓名 · 职务
          </span>
          <span role="columnheader" style={{ flex: 1, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>
            分工
          </span>
          <span style={{ width: 24, flexShrink: 0 }} />
        </div>
        {rows.length === 0 && (
          <p style={{ margin: 0, padding: '14px', ...cell, color: gy.tertiary }}>填写总指挥和各组组长后自动生成。</p>
        )}
        {rows.map((r, i) => (
          <div role="row" key={r.id} style={row(i === rows.length - 1)}>
            <span
              role="cell"
              style={{
                ...cell,
                width: 64,
                flexShrink: 0,
                fontWeight: r.role === '组长' ? 500 : 400,
                color: r.role === '组长' ? gy.text : gy.secondary,
              }}
            >
              {r.role}
            </span>
            {r.auto ? (
              <>
                <span role="cell" style={{ ...cell, width: 120, flexShrink: 0, color: gy.text }}>
                  {r.title ? `${r.name} · ${r.title}` : r.name}
                </span>
                <span role="cell" style={{ ...cell, flex: 1, color: '#3F4A5C' }}>
                  {r.duty}
                </span>
                <span style={{ width: 24, flexShrink: 0 }} />
              </>
            ) : (
              <>
                <span role="cell" style={{ width: 120, flexShrink: 0 }}>
                  <Input
                    aria-label={`编制成员 ${i + 1} 姓名`}
                    size="small"
                    value={r.name}
                    maxLength={50}
                    placeholder="姓名"
                    onChange={(e) => setExtra(r.id, { name: e.target.value })}
                  />
                </span>
                <span role="cell" style={{ flex: 1 }}>
                  <Input
                    aria-label={`编制成员 ${i + 1} 分工`}
                    size="small"
                    value={r.duty}
                    maxLength={100}
                    placeholder="如：负责费用与物资保障"
                    onChange={(e) => setExtra(r.id, { duty: e.target.value })}
                  />
                </span>
                <span style={{ width: 24, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  <Button
                    type="text"
                    size="small"
                    aria-label={`移除编制成员 ${i + 1}`}
                    icon={<CloseOutlined style={{ fontSize: 12, color: gy.tertiary }} />}
                    onClick={() =>
                      onChange({ ...step, compilationExtras: step.compilationExtras.filter((e) => e.id !== r.id) })
                    }
                  />
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </FillCard>
  );
}

function RosterCard({
  roster,
  uploading,
  onFile,
  onRemove,
}: {
  roster: OrganizationStepView['roster'];
  uploading: boolean;
  onFile: (file: File) => void;
  onRemove: (fileId: string) => void;
}) {
  return (
    <FillCard
      title="上传花名册"
      extra={<span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>{uploadRuleHint('material')}</span>}
    >
      <p style={{ margin: '-8px 0 0', fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
        组织架构表、应急通讯录或值班表都可以，可传多份。注册安全工程师整理后写进预案，您不用再逐项填写。
      </p>
      {roster.map((f) => (
        <div
          key={f.fileId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 6,
            background: '#F3F7FF',
            border: '1px solid #CFDDFB',
          }}
        >
          <span style={{ flex: 1, fontSize: 14, lineHeight: '22px', color: gy.text }}>{f.originalName}</span>
          <Popconfirm title="移除这份花名册？" okText="移除" cancelText="取消" onConfirm={() => onRemove(f.fileId)}>
            <Button type="link" size="small">
              移除
            </Button>
          </Popconfirm>
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 20px',
          borderRadius: 8,
          border: '1px dashed #C9CED6',
        }}
      >
        <span style={{ flex: 1, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
          {uploading ? (
            <>
              <LoadingOutlined style={{ marginRight: 8 }} />
              正在上传…
            </>
          ) : roster.length > 0 ? (
            '还有其他名单可以继续上传。'
          ) : (
            '拍照或选择文件上传，手机上可以直接拍。'
          )}
        </span>
        <Upload
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
          multiple
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => {
            onFile(file);
            return false;
          }}
        >
          <Button type={roster.length > 0 ? 'default' : 'primary'} disabled={uploading}>
            {roster.length > 0 ? '继续上传' : '上传花名册'}
          </Button>
        </Upload>
      </div>
    </FillCard>
  );
}

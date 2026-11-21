import { CloseOutlined, DeleteOutlined, DownOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import {
  compilationTeamOf,
  effectiveSnapshot,
  GROUP_DESCRIPTIONS,
  MAX_GROUPS,
  newId,
  organizationOfSnapshot,
  organizationStepView,
  PRESET_GROUPS,
  presetGroup,
  productionView,
  suggestedGroups,
  wizardStepOfKey,
  type DraftGroup,
  type DraftPerson,
  type OrganizationStep as OrgStep,
} from '@genyun/shared';
import { App, Button, Input, Modal, Tooltip } from 'antd';
import { useRef, useState, type CSSProperties } from 'react';
import { useSaveOrganizationStep } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, source, type, weight } from '../../../../theme/tokens';
import { AddMemberModal, type AddedMember } from './AddMemberModal';
import { OrgChartCard } from './OrgChartCard';
import { CompareBar, compareSheets, CompareSheets, type CompareMode } from './OriginalCompare';
import { OriginalSheetCard, RosterCard } from './OriginalSheetCard';
import { caption, Card, link14, softLine, StepTitle, UseCard } from './parts';
import { groupTitle, stepErrors, stepForSave, updatePerson, type PersonField } from './people';
import type { StepProps } from './types';

// 小组至少留 3 个（业务方 11-14：小组 3 / 3 / 5）
const MIN_KEEP = 3;
const PRESET_KINDS = Object.keys(PRESET_GROUPS) as (keyof typeof PRESET_GROUPS)[];
const DUTY_PHONE = /^[\d\s\-+()（）]*$/;

const headCell: CSSProperties = { ...type.caption, color: gy.tertiary };
const roleCell: CSSProperties = { width: 120, flexShrink: 0, ...type.body, fontWeight: weight.strong, color: gy.text };

// 资料核对第 2 步「核对应急指挥部和各小组」（13 页 E2-2、S06）：按客户表格预填，改动整步存进专家那份；右栏组织体系图随资料实时生成
export function OrganizationStep({ taskId, workup, autosave, customerText, frame, onGo, latestVersion }: StepProps) {
  const save = useSaveOrganizationStep(taskId);
  const { message } = App.useApp();
  // 只在进这一步时读一次（之后以页面上的为准；别人改过时外壳会重置这一步）
  const [initial] = useState(() => organizationStepView(workup.snapshot, workup.data));
  const [step, setStep] = useState<OrgStep>(initial);
  // 客户原来填的手机号不合规（比如座机）：一打开就标红，不用等离开输入框
  const [touched, setTouched] = useState<Set<string>>(() => new Set([...stepErrors(initial).keys()].filter((k) => k.endsWith(':phone'))));
  const [open, setOpen] = useState<Set<string>>(() => new Set(initial.groups[0] ? [initial.groups[0].id] : []));
  const [adding, setAdding] = useState<DraftGroup | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [mode, setMode] = useState<CompareMode>('items');
  const saved = useRef(initial);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const blank = (workup.data.blank ?? []).filter((k) => wizardStepOfKey(k) === 'organization');
  const errors = stepErrors(step);
  const dutyError = step.dutyPhone && !DUTY_PHONE.test(step.dutyPhone) ? '电话只能填数字、空格和短横线' : undefined;
  const customerOrg = organizationOfSnapshot(workup.snapshot);
  const employeeCount = effectiveSnapshot(workup.snapshot, workup.data).profile.basicStep?.basic.employeeCount;
  // 有没有危化品：专家在生产情况里判定过的以判定为准，没判定的按系统建议
  const hazardous = productionView(workup.snapshot, workup.data).materials.some((m) => m.hazard.value ?? m.hazard.suggestion?.value);
  const suggested = suggestedGroups(employeeCount, hazardous).min;
  const offScale = step.groups.length !== suggested;
  // 旧数据少于 3 个小组：琥珀提示，拦住「下一步」（保存照旧不拦）
  const tooFew = step.groups.length < MIN_KEEP;
  const groupsRef = useRef<HTMLDivElement | null>(null);

  const send = (next: OrgStep, stepsDone?: number) => {
    const forSave = stepForSave(next, saved.current);
    if (next.dutyPhone && !DUTY_PHONE.test(next.dutyPhone)) forSave.dutyPhone = saved.current.dutyPhone;
    return async () => {
      await save.mutateAsync({ version: latestVersion(), step: forSave, blank, stepsDone });
      saved.current = forSave;
    };
  };
  const change = (next: OrgStep) => {
    setStep(next);
    autosave.schedule(send(next));
  };

  // 某个位置上还没有人时（总指挥、副总指挥、组长空着），一填就建一个人
  const editPerson = (person: DraftPerson | undefined, place: (p: DraftPerson) => OrgStep, field: PersonField, value: string) => {
    if (person) change(updatePerson(step, person.id, { [field]: value }));
    else change(place({ id: newId('p'), name: '', [field]: value }));
  };
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  const errorOf = (person: DraftPerson | undefined, field: PersonField) => {
    if (!person) return undefined;
    const key = `${person.id}:${field}`;
    return touched.has(key) ? errors.get(key) : undefined;
  };

  const personInputs = (person: DraftPerson | undefined, place: (p: DraftPerson) => OrgStep, label: string) =>
    (['name', 'position', 'phone'] as const).map((field) => {
      const error = errorOf(person, field);
      const key = person ? `${person.id}:${field}` : `${label}:${field}`;
      return (
        <div key={field} style={{ flex: field === 'phone' ? 1.2 : 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Input
            ref={(el) => {
              if (el?.input) inputs.current.set(key, el.input);
            }}
            aria-label={`${label}${{ name: '姓名', position: '公司职位', phone: '手机' }[field]}`}
            value={person?.[field] ?? ''}
            status={error ? 'error' : undefined}
            inputMode={field === 'phone' ? 'tel' : undefined}
            maxLength={field === 'phone' ? 30 : 50}
            placeholder={field === 'name' ? '待您补充' : undefined}
            onChange={(e) => editPerson(person, place, field, e.target.value)}
            onBlur={() => person && touch(`${person.id}:${field}`)}
            style={{ height: 36 }}
          />
          {error && (
            <span role="alert" style={{ ...type.caption, color: gy.error }}>
              {error}
            </span>
          )}
        </div>
      );
    });

  // ── 指挥部 ──
  const commandRows: { label: string; person: DraftPerson | undefined; place: (p: DraftPerson) => OrgStep }[] = [
    { label: '总指挥', person: step.commander, place: (p) => ({ ...step, commander: p }) },
    ...(step.deputies.length ? step.deputies : [undefined]).map((d, i, all) => ({
      label: all.length > 1 ? `副总指挥 ${i + 1}` : '副总指挥',
      person: d,
      place: (p: DraftPerson) => ({ ...step, deputies: [...step.deputies, p] }),
    })),
  ];

  // ── 小组 ──
  const setGroup = (id: string, patch: Partial<DraftGroup>) => change({ ...step, groups: step.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  const removeGroup = (id: string) => change({ ...step, groups: step.groups.filter((g) => g.id !== id) });
  const addGroup = (kind: keyof typeof PRESET_GROUPS) => {
    const g = presetGroup(kind);
    change({ ...step, groups: [...step.groups, g] });
    setOpen(new Set(open).add(g.id));
  };
  const missingKinds = PRESET_KINDS.filter((k) => !step.groups.some((g) => g.kind === k));
  const named = (ps: DraftPerson[]) => ps.filter((p) => p.name.trim());
  const memberless = step.groups.filter((g) => named(g.members).length === 0);
  const notFilled = customerText === '客户表格' ? '客户未填' : '客户没填';

  const customerLeaders = customerOrg.groups.filter((g) => g.leader?.name.trim()).length;
  const groupsHint = [
    `${customerText === '客户表格' ? '客户填了' : '客户写了'} ${customerOrg.groups.length} 个小组，${
      customerLeaders === customerOrg.groups.length ? '组长都已填' : `${customerOrg.groups.length - customerLeaders} 个组长没填`
    }。`,
    memberless.length ? '组员没填的由您补上，拿不准就请客服联系客户。' : '',
  ].join('');

  const addMembers = (group: DraftGroup, added: AddedMember[]) => {
    let leader = group.leader;
    const members = [...group.members];
    for (const a of added) {
      if (a.role === 'leader') leader = a.person;
      else if (!members.some((m) => m.id === a.person.id)) members.push(a.person);
    }
    change({ ...step, groups: step.groups.map((g) => (g.id === group.id ? { ...g, leader, members: members.filter((m) => m.id !== leader?.id) } : g)) });
    setOpen(new Set(open).add(group.id));
  };

  const firstError = () => {
    const keys = [...errors.keys()];
    if (!keys.length) return false;
    setTouched(new Set([...touched, ...keys]));
    // 收起的小组展开，才能看到错在哪
    const ids = new Set(keys.map((k) => k.split(':')[0]));
    setOpen(new Set([...open, ...step.groups.filter((g) => [g.leader, ...g.members].some((p) => p && ids.has(p.id))).map((g) => g.id)]));
    setTimeout(() => inputs.current.get(keys[0]!)?.focus(), 0);
    return true;
  };

  const go = async (target: number) => {
    if (target > 2 && firstError()) return;
    if (target > 2 && tooFew) {
      groupsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      message.warning(`至少设 ${MIN_KEEP} 个小组，请先添加小组再进入下一步`);
      return;
    }
    const ok = await autosave.flush(send(step, target > 2 ? Math.max(workup.data.stepsDone ?? 0, 2) : undefined));
    if (ok) onGo(target);
  };

  const team = compilationTeamOf(stepForSave(step, saved.current));

  // 顶部小结：客户填了几位指挥、几个小组、几名小组成员（同一人兼几组只算一次）；旧流程附了通讯录的加半句
  const commanders = [customerOrg.commander, ...customerOrg.deputies].filter((p) => p?.name.trim()).length;
  const groupPeople = new Set(customerOrg.groups.flatMap((g) => [g.leader, ...g.members]).filter((p) => p?.name.trim()).map((p) => p!.id)).size;
  const rosterIds = workup.snapshot.profile.organizationStep?.rosterFileIds ?? [];
  const rosterCount = workup.flow === 'intake' ? 0 : rosterIds.length;
  const summary = `${customerText === '客户表格' ? '客户表格' : '客户'}填了 ${commanders} 位指挥、${customerOrg.groups.length} 个小组、${groupPeople} 名成员${
    rosterCount ? `，另附通讯录 ${rosterCount} 份` : ''
  }。`;

  const compare =
    workup.flow === 'intake' ? <CompareBar summary="客户表格里这一步用到的：「应急组织」" mode={mode} onChange={setMode} /> : null;
  const sheetMain = (
    <>
      <StepTitle
        title="核对应急指挥部和各小组"
        customerText={customerText}
        sub={`已按${customerText}「应急组织」预填。请核对各组负责人和手机号；右侧的组织体系图会随资料实时生成，不用自己画。`}
      />
      {compare}
      <CompareSheets
        taskId={taskId}
        workup={workup}
        sheets={compareSheets(
          Object.fromEntries(Object.entries(workup.sources).filter(([k]) => k.startsWith('organization.'))),
          { organization: { original: workup.snapshot.profile.organizationStep?.step, current: step } },
        )}
      />
    </>
  );
  const main = (
    <>
      <StepTitle
        title="核对应急指挥部和各小组"
        customerText={customerText}
        sub={`已按${customerText}「应急组织」预填。请核对各组负责人和手机号；右侧的组织体系图会随资料实时生成，不用自己画。`}
      />
      {compare}
      <div
        aria-label="客户填写小结"
        style={{ padding: '12px 16px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, ...type.body, color: gy.secondary }}
      >
        {summary}
      </div>

      <Card title="应急指挥部" tag={<SourceTag kind="customer" text={customerText} />} gap={16} hint="通常由总经理任总指挥、分管安全的负责人任副总指挥。">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ ...headCell, width: 120, flexShrink: 0 }}>应急职务</span>
            <span style={{ ...headCell, flex: 1 }}>姓名</span>
            <span style={{ ...headCell, flex: 1 }}>公司职位</span>
            <span style={{ ...headCell, flex: 1.2 }}>手机</span>
          </div>
          {commandRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ ...roleCell, lineHeight: '36px' }}>{r.label}</span>
              {personInputs(r.person, r.place, r.label)}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="应急小组"
        tag={<SourceTag kind="customer" text={customerText} />}
        gap={14}
        hint={groupsHint}
        extra={
          <span
            style={{
              padding: '0 8px',
              borderRadius: 4,
              ...type.caption,
              whiteSpace: 'nowrap',
              color: offScale ? gy.warning : source.system.color,
              background: offScale ? gy.warningBg : source.system.bg,
            }}
          >
            {offScale ? `按规模建议 ${suggested} 组` : `按规模 ${suggested} 组`}
          </span>
        }
      >
        {tooFew && (
          <div ref={groupsRef} role="alert" style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${gy.warningBg}`, background: gy.warningBg, ...type.body, color: gy.warning }}>
            现在只有 {step.groups.length} 个小组，至少要设 {MIN_KEEP} 个。请在下面添加小组，补够后才能进入下一步。
          </div>
        )}
        {step.groups.map((g) => (
          <GroupBox
            key={g.id}
            group={g}
            expanded={open.has(g.id)}
            onToggle={() => {
              const n = new Set(open);
              if (n.has(g.id)) n.delete(g.id);
              else n.add(g.id);
              setOpen(n);
            }}
            canRemove={step.groups.length > MIN_KEEP}
            onRemove={() => removeGroup(g.id)}
            notFilled={notFilled}
            leaderInputs={personInputs(g.leader, (p) => ({ ...step, groups: step.groups.map((x) => (x.id === g.id ? { ...x, leader: p } : x)) }), `${groupTitle(g)}组长`)}
            memberInputs={g.members.map((m) => ({
              id: m.id,
              inputs: personInputs(m, () => step, `${groupTitle(g)}组员${m.name ? ` ${m.name}` : ''}`),
              remove: () => setGroup(g.id, { members: g.members.filter((x) => x.id !== m.id) }),
            }))}
            onAdd={() => setAdding(g)}
          />
        ))}
        {missingKinds.length > 0 && step.groups.length < MAX_GROUPS && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ ...type.body, color: gy.secondary }}>添加小组</span>
            {missingKinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => addGroup(k)}
                style={{ height: 30, padding: '0 12px', borderRadius: 15, border: `1px dashed ${gy.controlLine}`, background: gy.surface, color: gy.primary, cursor: 'pointer', fontFamily: 'inherit', ...type.body }}
              >
                + {PRESET_GROUPS[k]}
              </button>
            ))}
          </div>
        )}
      </Card>

      <section
        aria-label="24 小时值班电话"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '20px 24px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>24 小时值班电话</h2>
            {(step.dutyPhone ?? '').trim() === (customerOrg.dutyPhone ?? '').trim() && step.dutyPhone ? (
              <SourceTag kind="customer" text={customerText} />
            ) : step.dutyPhone ? (
              <SourceTag kind="expert" text="您已修改" />
            ) : null}
          </div>
          <span style={{ ...type.body, color: gy.secondary }}>发生事故时第一时间接报。{customerOrg.dutyPhone ? '请确认是能接通的号码。' : `${notFilled}，请向客户核实。`}</span>
        </div>
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Input
            aria-label="24 小时值班电话"
            value={step.dutyPhone ?? ''}
            placeholder="待您补充"
            status={dutyError ? 'error' : undefined}
            maxLength={30}
            onChange={(e) => change({ ...step, dutyPhone: e.target.value })}
            style={{ height: 36 }}
          />
          {dutyError && (
            <span role="alert" style={{ ...type.caption, color: gy.error }}>
              {dutyError}
            </span>
          )}
        </div>
      </section>

      <Card
        title="应急预案编制小组"
        tag={<SourceTag kind="system" text="系统带出" />}
        gap={16}
        hint="由总指挥、副总指挥和各组组长组成，分工已按常规写好，您确认即可。"
        extra={
          <button type="button" style={link14} onClick={() => setExtraOpen(true)}>
            + 添加编制成员
          </button>
        }
      >
        <div role="table" aria-label="编制小组成员" style={{ border: `1px solid ${softLine}`, borderRadius: 6, overflow: 'hidden' }}>
          <div role="row" style={{ display: 'flex', gap: 12, padding: '8px 16px', background: gy.canvas }}>
            <span role="columnheader" style={{ ...headCell, width: 120 }}>
              角色
            </span>
            <span role="columnheader" style={{ ...headCell, width: 180 }}>
              姓名 · 职务
            </span>
            <span role="columnheader" style={{ ...headCell, flex: 1 }}>
              分工
            </span>
          </div>
          {team.map((r) => (
            <div role="row" key={r.id} style={{ display: 'flex', gap: 12, padding: '8px 16px', borderTop: `1px solid ${softLine}`, alignItems: 'flex-start' }}>
              <span role="cell" style={{ width: 120, ...type.body, color: gy.secondary }}>
                {r.role}
              </span>
              <span role="cell" style={{ width: 180, ...type.body, color: gy.text }}>
                {[r.name, r.title].filter(Boolean).join(' · ')}
              </span>
              <span role="cell" style={{ flex: 1, ...type.body, color: gy.secondary }}>
                {r.duty || '—'}
              </span>
              {!r.auto && (
                <button
                  type="button"
                  style={{ ...link14, color: gy.secondary }}
                  aria-label={`删除编制成员 ${r.name}`}
                  onClick={() => change({ ...step, compilationExtras: step.compilationExtras.filter((e) => e.id !== r.id) })}
                >
                  <CloseOutlined />
                </button>
              )}
            </div>
          ))}
          {team.length === 0 && <div style={{ padding: '8px 16px', borderTop: `1px solid ${softLine}`, ...caption }}>填了总指挥和组长后，这里自动列出。</div>}
        </div>
      </Card>

      {adding && (
        <AddMemberModal
          group={adding}
          step={step}
          onCancel={() => setAdding(null)}
          onAdd={(added) => {
            addMembers(adding, added);
            setAdding(null);
          }}
        />
      )}
      <ExtraModal
        open={extraOpen}
        onCancel={() => setExtraOpen(false)}
        onAdd={(e) => {
          change({ ...step, compilationExtras: [...step.compilationExtras, e] });
          setExtraOpen(false);
        }}
      />
    </>
  );

  const side = (
    <>
      <OriginalSheetCard taskId={taskId} workup={workup} sheets={['应急组织']} />
      <RosterCard workup={workup} roster={customerOrg.mode === 'roster'} fileIds={rosterIds} />
      <OrgChartCard taskId={taskId} workup={workup} step={stepForSave(step, saved.current)} autosave={autosave} latestVersion={latestVersion} />
      <UseCard
        lines={[
          '预案要写明应急指挥部和各小组的负责人与联系电话，发生事故时按这张表通知到人。',
          '一人可兼任多个小组；电话应为手机，座机或空号请客服向客户核实。',
        ]}
      />
    </>
  );

  return frame({
    main: mode === 'sheet' ? sheetMain : main,
    side,
    note: `第 2 步，共 5 步 · ${step.groups.length} 个小组${memberless.length ? `，${memberless.length} 组组员${notFilled}` : '，组员都已填'}`,
    actions: (
      <>
        <Button onClick={() => void go(1)}>上一步</Button>
        <Button type="primary" onClick={() => void go(3)}>
          下一步：生产情况
        </Button>
      </>
    ),
  });
}

function GroupBox({
  group,
  expanded,
  onToggle,
  canRemove,
  onRemove,
  notFilled,
  leaderInputs,
  memberInputs,
  onAdd,
}: {
  group: DraftGroup;
  expanded: boolean;
  onToggle: () => void;
  canRemove: boolean;
  onRemove: () => void;
  notFilled: string;
  leaderInputs: React.ReactNode;
  memberInputs: { id: string; inputs: React.ReactNode; remove: () => void }[];
  onAdd: () => void;
}) {
  const title = groupTitle(group);
  const members = group.members.filter((m) => m.name.trim());
  const people = (group.leader?.name.trim() ? 1 : 0) + members.length;
  const warn = !expanded && (!group.leader?.name.trim() || members.length === 0);
  const summary = [
    group.leader?.name.trim() ? `组长 ${group.leader.name.trim()}` : '组长待您补充',
    members.length ? `组员 ${members.length} 人` : `组员${notFilled}，待您补充`,
  ].join(' · ');
  const remove = (
    <Tooltip title={canRemove ? undefined : `至少设 ${MIN_KEEP} 个小组`}>
      <button
        type="button"
        aria-label={`删除${title}`}
        disabled={!canRemove}
        onClick={onRemove}
        style={{ ...link14, color: canRemove ? gy.secondary : gy.split, cursor: canRemove ? 'pointer' : 'not-allowed' }}
      >
        <DeleteOutlined />
      </button>
    </Tooltip>
  );

  return (
    <div
      role="group"
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: expanded ? 16 : '14px 16px',
        borderRadius: 8,
        border: `1px solid ${warn ? gy.warningBg : gy.split}`,
        background: warn ? gy.warningBg : gy.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
        >
          <span aria-hidden style={{ width: 14, color: gy.tertiary, fontSize: 12 }}>
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
          <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text, whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ ...type.caption, color: gy.tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{GROUP_DESCRIPTIONS[group.kind]}</span>
          <span style={{ flex: 1 }} />
          {expanded ? (
            <span style={{ ...type.caption, color: gy.tertiary, whiteSpace: 'nowrap' }}>{people} 人</span>
          ) : (
            <span style={{ ...type.body, color: warn ? gy.warning : gy.secondary, whiteSpace: 'nowrap' }}>{summary}</span>
          )}
        </button>
        {remove}
      </div>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 24 }}>
          <div style={{ display: 'flex', gap: 12, paddingRight: 24 }}>
            <span style={{ ...headCell, width: 64, flexShrink: 0 }}>职务</span>
            <span style={{ ...headCell, flex: 1 }}>姓名</span>
            <span style={{ ...headCell, flex: 1 }}>公司岗位</span>
            <span style={{ ...headCell, flex: 1.2 }}>手机</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingRight: 24 }}>
            <span style={{ width: 64, flexShrink: 0, ...type.body, color: gy.text, lineHeight: '36px' }}>组长</span>
            {leaderInputs}
          </div>
          {memberInputs.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 64, flexShrink: 0, ...type.body, color: gy.text, lineHeight: '36px' }}>组员</span>
              {m.inputs}
              <button type="button" aria-label="移出这名组员" onClick={m.remove} style={{ ...link14, width: 10, lineHeight: '36px', color: gy.tertiary }}>
                <CloseOutlined style={{ fontSize: 12 }} />
              </button>
            </div>
          ))}
          {memberInputs.length === 0 && <span style={{ ...type.body, color: gy.warning }}>组员{notFilled}，待您补充</span>}
          <button type="button" style={{ ...link14, alignSelf: 'flex-start' }} onClick={onAdd}>
            <PlusOutlined /> 添加组员（可从已填人员中选）
          </button>
        </div>
      )}
    </div>
  );
}

// 编制小组另加的成员（如安全员、技术负责人）
function ExtraModal({ open, onCancel, onAdd }: { open: boolean; onCancel: () => void; onAdd: (e: OrgStep['compilationExtras'][number]) => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [duty, setDuty] = useState('');
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Modal
      title="添加编制成员"
      open={open}
      width={480}
      okText="添加"
      cancelText="取消"
      onCancel={onCancel}
      afterOpenChange={(o) => {
        if (!o) return;
        setName('');
        setTitle('');
        setDuty('');
        setTried(false);
      }}
      onOk={() => {
        if (!name.trim()) {
          setTried(true);
          nameRef.current?.focus();
          return;
        }
        onAdd({ id: newId('c'), name: name.trim(), title: title.trim() || undefined, duty: duty.trim() || undefined });
      }}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>姓名</span>
          <Input
            ref={(el) => {
              nameRef.current = el?.input ?? null;
            }}
            value={name}
            status={tried && !name.trim() ? 'error' : undefined}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            style={{ height: 36 }}
          />
          {tried && !name.trim() && <span style={{ ...type.caption, color: gy.error }}>请填姓名</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>公司职务</span>
          <Input value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} style={{ height: 36 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>分工</span>
          <Input value={duty} maxLength={100} placeholder="如：负责编写应急物资清单" onChange={(e) => setDuty(e.target.value)} style={{ height: 36 }} />
        </label>
      </div>
    </Modal>
  );
}

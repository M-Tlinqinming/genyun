import { SearchOutlined } from '@ant-design/icons';
import { newId, peopleOf, type DraftGroup, type DraftPerson, type OrganizationStep } from '@genyun/shared';
import { Checkbox, Input, Modal, Segmented, Select } from 'antd';
import { useMemo, useRef, useState } from 'react';
import { gy, type, weight } from '../../../../theme/tokens';
import { caption, softLine } from './parts';
import { groupTitle, phoneError, rolesOf } from './people';

export interface AddedMember {
  person: DraftPerson;
  role: 'leader' | 'member';
}

// 给小组添加组员（13 页 S06）：从已填人员中选（一人可兼任多个小组），或新填一个人
export function AddMemberModal({
  group,
  step,
  onCancel,
  onAdd,
}: {
  group: DraftGroup;
  step: OrganizationStep;
  onCancel: () => void;
  onAdd: (added: AddedMember[]) => void;
}) {
  const title = groupTitle(group);
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [role, setRole] = useState<'leader' | 'member'>('member');
  const [person, setPerson] = useState({ name: '', position: '', phone: '' });
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // 已在这一组的人不再列出
  const inGroup = new Set([group.leader?.id, ...group.members.map((m) => m.id)].filter(Boolean));
  const candidates = useMemo(
    () => peopleOf(step).filter((p) => p.name.trim() && !inGroup.has(p.id)),
    [step],
  );
  const q = query.trim();
  const shown = q ? candidates.filter((p) => p.name.includes(q) || (p.position ?? '').includes(q)) : candidates;

  const nameError = tried && !person.name.trim() ? '请填姓名' : undefined;
  const phoneErr = tried ? phoneError(person.phone) : undefined;
  const count = mode === 'pick' ? picked.length : person.name.trim() ? 1 : 0;
  // 组长只能一个
  const leaderTaken = role === 'leader' && mode === 'pick' && picked.length > 1;

  const submit = () => {
    if (mode === 'pick') {
      if (!picked.length || leaderTaken) return;
      onAdd(picked.map((id) => ({ person: candidates.find((p) => p.id === id)!, role })));
      return;
    }
    setTried(true);
    if (!person.name.trim() || phoneError(person.phone)) {
      nameRef.current?.focus();
      return;
    }
    onAdd([
      {
        person: { id: newId('p'), name: person.name.trim(), position: person.position.trim() || undefined, phone: person.phone.trim() || undefined },
        role,
      },
    ]);
  };

  return (
    <Modal
      open
      title={`给「${title}」添加组员`}
      width={480}
      okText={count > 1 ? `添加 ${count} 人` : '添加'}
      cancelText="取消"
      okButtonProps={{ disabled: count === 0 || leaderTaken }}
      onOk={submit}
      onCancel={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Segmented
          block
          value={mode}
          onChange={(v) => setMode(v as 'pick' | 'new')}
          options={[
            { label: '从已填人员中选', value: 'pick' },
            { label: '新填一个人', value: 'new' },
          ]}
        />
        {mode === 'pick' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              aria-label="搜姓名或岗位"
              allowClear
              prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
              placeholder="搜姓名或岗位"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ height: 36 }}
            />
            <div role="list" aria-label="已填人员" style={{ maxHeight: 264, overflowY: 'auto', border: `1px solid ${softLine}`, borderRadius: 6 }}>
              {shown.map((p, i) => {
                const roles = rolesOf(step, p.id);
                const checked = picked.includes(p.id);
                return (
                  <label
                    role="listitem"
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderTop: i ? `1px solid ${softLine}` : undefined,
                      background: checked ? gy.selected : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <Checkbox checked={checked} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                    <span style={{ flex: 1, minWidth: 0, ...type.body, color: gy.text }}>
                      <span style={{ fontWeight: weight.strong }}>{p.name}</span>
                      {p.position ? ` · ${p.position}` : ''}
                    </span>
                    {roles.length > 0 && <span style={{ ...caption, whiteSpace: 'nowrap' }}>已在{roles.join('、')}</span>}
                  </label>
                );
              })}
              {shown.length === 0 && (
                <div style={{ padding: '16px 12px', ...type.body, color: gy.secondary }}>
                  {candidates.length ? '没找到，换个关键字，或改为「新填一个人」' : '还没有其他已填人员，请「新填一个人」'}
                </div>
              )}
            </div>
            <span style={caption}>一人可兼任多个小组，改了姓名或电话各处一起改。</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={type.body}>姓名</span>
              <Input
                ref={(el) => {
                  nameRef.current = el?.input ?? null;
                }}
                value={person.name}
                status={nameError ? 'error' : undefined}
                maxLength={50}
                onChange={(e) => setPerson({ ...person, name: e.target.value })}
                style={{ height: 36 }}
              />
              {nameError && <span style={{ ...type.caption, color: gy.error }}>{nameError}</span>}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={type.body}>公司岗位</span>
              <Input value={person.position} maxLength={50} onChange={(e) => setPerson({ ...person, position: e.target.value })} style={{ height: 36 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={type.body}>手机</span>
              <Input
                value={person.phone}
                inputMode="tel"
                status={phoneErr ? 'error' : undefined}
                maxLength={30}
                onChange={(e) => setPerson({ ...person, phone: e.target.value })}
                style={{ height: 36 }}
              />
              {phoneErr && <span style={{ ...type.caption, color: gy.error }}>{phoneErr}</span>}
            </label>
          </div>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={type.body}>在组里的职务</span>
          <Select
            aria-label="在组里的职务"
            value={role}
            onChange={setRole}
            options={[
              { value: 'member', label: '组员' },
              { value: 'leader', label: group.leader?.name.trim() ? `组长（替换 ${group.leader.name.trim()}）` : '组长' },
            ]}
            style={{ height: 36 }}
          />
          {leaderTaken && <span style={{ ...type.caption, color: gy.error }}>组长只能选一人</span>}
        </label>
      </div>
    </Modal>
  );
}

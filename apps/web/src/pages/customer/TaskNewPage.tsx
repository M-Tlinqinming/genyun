import { chinaToday, normalizeEnterpriseName } from '@genyun/shared';
import { App, Button, Input, Modal, Select } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCreateEnterprise, useEnterprises, type Enterprise } from '../../api/enterprises';
import { ApiError } from '../../api/request';
import { openTaskKey, useCreateTask, useOpenTask, type ExistingTask } from '../../api/tasks';
import { NoticeBar } from '../../components/NoticeBar';
import { Loading, panel } from '../../components/ui';
import { useWorkspace } from '../../layouts/workspace';
import { gy, layout, type, weight } from '../../theme/tokens';
import { CREATE_BLOCKED, useContract } from './tasks/shared';

// 新建任务：选所属企业（列表里没有，组织管理员可以当场新建）、填任务名称，新建后进入准备资料。
// 选中的企业已有没办完的任务时，换成「继续已有任务」或「查看这个任务」。
// 从企业页进来带 ?enterpriseId=，返回企业概览；从工作台、任务列表进来返回任务列表
export function TaskNewPage() {
  const { orgId, role } = useWorkspace();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search] = useSearchParams();
  const from = search.get('enterpriseId');
  const enterprises = useEnterprises(orgId);
  const contract = useContract(orgId);
  const create = useCreateTask();

  const [enterpriseId, setEnterpriseId] = useState<string | null>(from);
  const [name, setName] = useState(`${chinaToday().slice(0, 4)} 年应急预案编制`);
  const [enterpriseError, setEnterpriseError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const open = useOpenTask(enterpriseId);

  const list = enterprises.data ?? [];
  // 带进来的企业不在自己能看到的列表里：当没带
  useEffect(() => {
    if (enterprises.data && from && !enterprises.data.some((e) => e.id === from)) setEnterpriseId((id) => (id === from ? null : id));
  }, [enterprises.data, from]);

  if (enterprises.isPending) return <Loading rows={6} />;

  const fromEnterprise = from ? list.find((e) => e.id === from) : undefined;
  const back = fromEnterprise
    ? { to: `/customer/enterprises/${fromEnterprise.id}`, label: '返回企业概览' }
    : { to: '/customer/tasks', label: '返回任务列表' };
  const existing = enterpriseId ? (open.data ?? null) : null;

  const pick = (id: string) => {
    setEnterpriseId(id);
    setEnterpriseError(null);
    setKeyword('');
  };

  const submit = () => {
    const trimmed = name.trim();
    setEnterpriseError(enterpriseId ? null : '请选这次为哪家企业编制');
    setNameError(trimmed ? null : '请填写任务名称');
    if (!enterpriseId || !trimmed) return;
    create.mutate(
      { enterpriseId, input: { businessType: 'emergency_plan', name: trimmed } },
      {
        onSuccess: (task) => navigate(`/customer/tasks/${task.id}/prepare`),
        onError: (err) => {
          // 两个人同时新建：后到的一方也换成「继续已有任务」
          const other = err instanceof ApiError && err.status === 409 ? (err.body?.existingTask as ExistingTask | undefined) : undefined;
          if (other) client.setQueryData(openTaskKey(enterpriseId), { openTask: other });
          else message.error(err.message);
        },
      },
    );
  };

  const keywordShown = keyword.trim();
  const notFound = keywordShown ? (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...type.body, padding: '5px 12px', color: gy.tertiary }}>
        {role === 'customer_admin' ? `没有找到「${keywordShown}」` : `没有找到「${keywordShown}」。新建企业请联系组织管理员。`}
      </div>
      {role === 'customer_admin' && (
        <button
          type="button"
          style={addRow}
          // 先不让下拉框失焦收起，点击才能落到这一行上
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setMenuOpen(false);
            setAdding(keywordShown);
          }}
        >
          ＋ 新建企业「{keywordShown}」
        </button>
      )}
    </div>
  ) : (
    <div style={{ ...type.body, padding: '5px 12px', color: gy.tertiary }}>还没有企业</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <nav aria-label="位置" style={{ ...type.body, color: gy.secondary }}>
        {fromEnterprise ? (
          <>
            <Link to="/customer/enterprises" style={crumb}>
              企业
            </Link>
            {' / '}
            <Link to={`/customer/enterprises/${fromEnterprise.id}`} style={crumb}>
              {fromEnterprise.name}
            </Link>
            {' / 新建任务'}
          </>
        ) : (
          <>
            <Link to="/customer/tasks" style={crumb}>
              任务
            </Link>
            {' / 新建任务'}
          </>
        )}
      </nav>
      <h1 style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>新建任务</h1>

      {!contract.canCreate && (
        <div style={{ maxWidth: 920 }}>
          <NoticeBar tone="warning">{CREATE_BLOCKED}</NoticeBar>
        </div>
      )}
      {existing && <OpenTaskCallout task={existing} />}

      <section style={{ ...panel, maxWidth: 920, padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>任务信息</h2>
        <Field id="task-enterprise" label="所属企业" help="只列出您能看到的企业。" error={enterpriseError}>
          <Select
            id="task-enterprise"
            aria-label="所属企业"
            placeholder="搜索或选择企业"
            status={enterpriseError ? 'error' : undefined}
            style={{ width: '100%' }}
            value={enterpriseId}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onChange={pick}
            showSearch={{
              searchValue: keyword,
              onSearch: setKeyword,
              filterOption: (input, option) =>
                normalizeEnterpriseName(String(option?.label ?? '')).includes(normalizeEnterpriseName(input)),
            }}
            notFoundContent={notFound}
            options={list.map((e) => ({ value: e.id, label: e.name }))}
          />
        </Field>
        <Field id="task-name" label="任务名称" help="用于区分同一企业的不同编制任务。" error={nameError}>
          <Input
            id="task-name"
            value={name}
            disabled={existing !== null}
            status={nameError ? 'error' : undefined}
            maxLength={100}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setNameError(null);
            }}
          />
        </Field>
        <div style={{ borderTop: `1px solid ${gy.split}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span style={{ ...type.body, color: gy.secondary }}>
            {existing === null
              ? '新建后开始准备资料：下载资料模板，填好上传。提交给专家之前，任务可以删除。'
              : existing.status === 'preparing'
                ? '继续已有任务，已经上传的资料都还在。'
                : '可以先看看这个任务现在到哪一步了。'}
          </span>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button onClick={() => navigate(back.to)}>{back.label}</Button>
            {existing === null ? (
              <Button type="primary" loading={create.isPending} disabled={!contract.canCreate} onClick={submit}>
                新建任务
              </Button>
            ) : existing.status === 'preparing' ? (
              <Button type="primary" onClick={() => navigate(`/customer/tasks/${existing.id}/prepare`)}>
                继续已有任务
              </Button>
            ) : (
              <Button type="primary" onClick={() => navigate(`/customer/tasks/${existing.id}`)}>
                查看这个任务
              </Button>
            )}
          </div>
        </div>
      </section>

      {adding !== null && (
        <NewEnterpriseModal
          orgId={orgId}
          initialName={adding}
          onClose={() => setAdding(null)}
          onPicked={(e) => {
            setAdding(null);
            pick(e.id);
          }}
        />
      )}
    </div>
  );
}

// 选中的企业已有没办完的任务：还没提交的去继续，已提交给专家的只能先看
function OpenTaskCallout({ task }: { task: ExistingTask }) {
  const preparing = task.status === 'preparing';
  return (
    <div
      role="status"
      aria-label="这家企业已有任务"
      style={{
        maxWidth: 920,
        background: gy.warningBg,
        borderRadius: 8,
        padding: '12px 16px 12px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>
        {preparing ? '这家企业已经有一个任务在准备资料' : '这家企业已经有一个任务在专家编制'}
      </span>
      <span style={{ ...type.body, color: gy.secondary }}>
        {preparing
          ? `「${task.name}」还没提交。继续这个任务就行，已经传的资料都还在。`
          : `「${task.name}」已经提交给专家，交付以后才能新建下一个任务。`}
      </span>
    </div>
  );
}

// 当场新建企业：只填名称，其他信息在资料模板里填；保存后自动选中。组织里已有同名的，给「选这家企业」
function NewEnterpriseModal({
  orgId,
  initialName,
  onClose,
  onPicked,
}: {
  orgId: string;
  initialName: string;
  onClose: () => void;
  onPicked: (e: Pick<Enterprise, 'id' | 'name'>) => void;
}) {
  const { message } = App.useApp();
  const create = useCreateEnterprise(orgId);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [same, setSame] = useState<Pick<Enterprise, 'id' | 'name'> | null>(null);

  const save = () => {
    const trimmed = name.trim();
    setSame(null);
    if (!trimmed) {
      setError('请填企业名称');
      return;
    }
    create.mutate(
      { name: trimmed, socialCreditCode: null, registeredAddress: null, legalRepresentative: null },
      {
        onSuccess: (created) => {
          message.success('企业已新建');
          onPicked(created);
        },
        onError: (err) => {
          const existing =
            err instanceof ApiError && err.status === 409
              ? (err.body?.existingEnterprise as Pick<Enterprise, 'id' | 'name'> | undefined)
              : undefined;
          if (existing) {
            setError('组织里已经有这家企业了，直接在「所属企业」里选它。');
            setSame(existing);
          } else setError(err.message);
        },
      },
    );
  };

  return (
    <Modal
      open
      title="新建企业"
      width={544}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={create.isPending} onClick={save}>
            保存
          </Button>
        </div>
      }
    >
      <Field
        id="new-enterprise-name"
        label="企业名称"
        required={false}
        help="按营业执照上的全称填。其他信息在资料模板里填。"
        error={error}
        after={
          same && (
            <button type="button" style={linkText} onClick={() => onPicked(same)}>
              选这家企业
            </button>
          )
        }
      >
        <Input
          id="new-enterprise-name"
          autoFocus
          value={name}
          placeholder="按营业执照上的全称填"
          status={error ? 'error' : undefined}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
            setSame(null);
          }}
          onPressEnter={save}
        />
      </Field>
    </Modal>
  );
}

// 一个表单项：标签（必填带星号）、输入框、说明文字；出错时说明换成红字
function Field({
  id,
  label,
  required = true,
  help,
  error,
  after,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  help: string;
  error: string | null;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ maxWidth: layout.form, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor={id} style={{ ...type.body, color: gy.text }}>
        {label}
        {required && ' *'}
      </label>
      {children}
      <span role={error ? 'alert' : undefined} style={{ ...type.caption, color: error ? gy.error : gy.secondary }}>
        {error ?? help}
      </span>
      {after}
    </div>
  );
}

const crumb: CSSProperties = { color: gy.secondary };

const addRow: CSSProperties = {
  ...type.body,
  textAlign: 'left',
  padding: '5px 12px',
  border: 'none',
  borderRadius: 4,
  background: gy.selected,
  color: gy.primary,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const linkText: CSSProperties = {
  ...type.body,
  alignSelf: 'flex-start',
  padding: 0,
  border: 'none',
  background: 'none',
  color: gy.primary,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

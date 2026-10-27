import { BUSINESS_TYPES, TASK_STATUSES, chinaToday, isContractActive, taskCreateSchema } from '@genyun/shared';
import { App, Breadcrumb, Button, Form, Input, Result, Spin, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { openTasksOf, useEnterprise, useOrgTasks } from '../../api/enterprises';
import { ApiError } from '../../api/request';
import { useCreateTask, useOrganization, type ExistingTask } from '../../api/tasks';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';

const help = { fontSize: 12, lineHeight: '20px', color: gy.secondary } as const;

const EXPIRED = '合同不在有效期内，不能新建任务，请联系耕云续约；已交付的成果仍可下载';

// P02 创建编制任务；已有在办的同类任务时为 P02B，引导继续已有任务。
// 后台不允许同一企业同时有两个在办的同类任务，所以不提供设计稿里的「仍创建新草稿」
export function TaskCreatePage() {
  const { enterpriseId = '' } = useParams();
  const { orgId } = useWorkspace();
  const enterprise = useEnterprise(enterpriseId);
  const tasks = useOrgTasks(orgId);
  const org = useOrganization(orgId);
  const create = useCreateTask(enterpriseId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string }>();
  // 提交时后台才发现的重复（如同事刚刚建了一个）
  const [conflict, setConflict] = useState<ExistingTask>();
  const [expired, setExpired] = useState(false);

  if (enterprise.isPending || tasks.isPending || org.isPending) {
    return <Spin style={{ display: 'block', padding: '96px 0' }} />;
  }
  if (enterprise.isError) {
    return (
      <Result
        status="404"
        title="找不到该企业"
        subTitle="企业可能不在当前机构下，或您没有查看权限。"
        extra={<Link to="/customer/enterprises">返回企业列表</Link>}
      />
    );
  }

  const e = enterprise.data;
  const backToEnterprise = `/customer/enterprises/${e.id}`;
  const open = openTasksOf(tasks.data, e.id)[0];
  const existing = conflict ?? open;
  const contractActive = !expired && (!org.data || isContractActive(org.data));

  const onFinish = ({ name }: { name: string }) => {
    create.mutate(
      { businessType: 'emergency_plan', name },
      {
        onSuccess: (created) => navigate(`/customer/tasks/${created.id}/start`, { replace: true }),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409 && err.body?.existingTask) {
            setConflict(err.body.existingTask as ExistingTask);
          } else if (err instanceof ApiError && err.status === 403) {
            setExpired(true);
          } else {
            message.error(err.message);
          }
        },
      },
    );
  };

  let notice: ReactNode = null;
  let note = '创建后进入资料准备。不会自动提交生成申请。';
  let actions: ReactNode = (
    <>
      <Button size="large" onClick={() => navigate(backToEnterprise)}>
        返回企业概览
      </Button>
      <Button size="large" type="primary" htmlType="submit" loading={create.isPending}>
        创建草稿并准备资料
      </Button>
    </>
  );

  if (existing) {
    // 提交时才发现的重复，后台只返回编号和名称
    const stage = existing === open ? ` · ${TASK_STATUSES[open.status]}` : '';
    notice = (
      <Notice tone="warning" title="该企业已有同类在办任务">
        {existing.number} · {existing.name}
        {stage}。建议继续已有任务，避免重复办理。
      </Notice>
    );
    note = '继续已有任务会保留已上传资料与检查进度。';
    actions = (
      <>
        <Button size="large" onClick={() => navigate(backToEnterprise)}>
          返回企业概览
        </Button>
        <Button size="large" type="primary" onClick={() => navigate(`/customer/tasks/${existing.id}`)}>
          继续已有任务
        </Button>
      </>
    );
  } else if (!contractActive) {
    notice = (
      <Notice tone="error" title="暂时不能新建任务">
        {EXPIRED}。
      </Notice>
    );
    note = '续约后即可创建；已有的企业档案和资料会保留。';
    actions = (
      <>
        <Button size="large" onClick={() => navigate(backToEnterprise)}>
          返回企业概览
        </Button>
        <Button size="large" type="primary" disabled>
          创建草稿并准备资料
        </Button>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Breadcrumb
        items={[
          { title: <Link to="/customer/enterprises">企业</Link> },
          { title: <Link to={backToEnterprise}>{e.name}</Link> },
          { title: '创建任务' },
        ]}
      />
      <Typography.Title level={1} style={{ fontSize: 28, lineHeight: '40px', fontWeight: 500, margin: 0 }}>
        创建编制任务
      </Typography.Title>

      {notice}

      <Form
        form={form}
        layout="vertical"
        requiredMark={(label, { required }) => (
          <>
            {label}
            {required ? ' *' : ''}
          </>
        )}
        initialValues={{ name: `${chinaToday().slice(0, 4)} 年应急预案编制` }}
        onFinish={onFinish}
        style={{
          width: 920,
          background: gy.surface,
          border: `1px solid ${gy.split}`,
          borderRadius: 8,
          padding: 24,
        }}
      >
        <Typography.Title
          level={2}
          style={{
            fontSize: 20,
            lineHeight: '28px',
            fontWeight: 500,
            margin: '0 0 24px',
          }}
        >
          任务信息
        </Typography.Title>
        <Form.Item
          label="所属企业"
          required
          extra={<span style={help}>仅显示本账户有权访问的企业。</span>}
          style={{ maxWidth: 720 }}
        >
          <Input size="large" value={e.name} readOnly aria-label="所属企业" />
        </Form.Item>
        <Form.Item label="业务类型" extra={<span style={help}>本期开放业务。</span>} style={{ maxWidth: 720 }}>
          <Input size="large" value={BUSINESS_TYPES.emergency_plan} readOnly aria-label="业务类型" />
        </Form.Item>
        <Form.Item
          name="name"
          label="任务名称"
          required
          rules={[
            {
              validator: (_, v) => {
                const r = taskCreateSchema.shape.name.safeParse(v ?? '');
                return r.success ? Promise.resolve() : Promise.reject(new Error(r.error.issues[0]?.message));
              },
            },
          ]}
          extra={<span style={help}>用于区分同一企业的不同编制任务。</span>}
          style={{ maxWidth: 720 }}
        >
          <Input size="large" maxLength={100} disabled={Boolean(existing) || !contractActive} />
        </Form.Item>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            borderTop: `1px solid ${gy.split}`,
            paddingTop: 16,
          }}
        >
          <Typography.Text type="secondary">{note}</Typography.Text>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>{actions}</div>
        </div>
      </Form>
    </div>
  );
}

const TONES = {
  warning: { color: gy.warning, bg: gy.warningBg },
  error: { color: gy.error, bg: gy.errorBg },
} as const;

function Notice({ tone, title, children }: { tone: keyof typeof TONES; title: string; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <div
      role="alert"
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '16px 24px',
        borderRadius: 6,
        border: `1px solid ${t.color}`,
        background: t.bg,
      }}
    >
      <span style={{ color: t.color, fontWeight: 500 }}>{title}</span>
      <span style={{ color: gy.text }}>{children}</span>
    </div>
  );
}

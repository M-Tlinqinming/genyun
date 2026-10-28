import { FIELD_SOURCES, INDUSTRY_NAMES, TASK_STATUSES, type EnterpriseInput } from '@genyun/shared';
import { App, Breadcrumb, Button, Form, Modal, Result, Table, Tabs, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  openTasksOf,
  useEnterprise,
  useOrgTasks,
  useUpdateEnterprise,
  type Enterprise,
  type TaskSummary,
} from '../../api/enterprises';
import { useEnterpriseDocuments } from '../../api/documents';
import { useBasicStep, type BasicStepView } from '../../api/profile';
import { ApiError } from '../../api/request';
import { TaskStageTag, taskStageTone } from '../../components/TaskStageTag';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';
import { EnterpriseDocumentsTab } from './EnterpriseDocumentsTab';
import { EnterpriseFields, enterpriseRequiredMark, showEnterpriseError } from './EnterpriseFields';
import { Loading, panel } from '../../components/ui';

const card = panel;

const cardTitle = {
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 500,
  color: gy.text,
} as const;

const STAGE_HINT = {
  preparing: '资料还没有提交给耕云，可以分次填写，随时回来继续。',
  submitted: '资料已提交，耕云专家正在处理，进度会在这里更新。',
} as const;

// C03 企业详情：概览、企业资料、业务。「成果文档」在 M2 加上；?tab=documents 直接打开企业资料
export function EnterpriseDetailPage() {
  const { enterpriseId = '' } = useParams();
  const { orgId } = useWorkspace();
  const enterprise = useEnterprise(enterpriseId);
  const tasks = useOrgTasks(orgId);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') ?? 'overview';
  // 自填第 1 步的内容（行业、生产地址、联系人、人数），概览里一并显示
  const basicStep = useBasicStep(enterpriseId);
  const documents = useEnterpriseDocuments(enterpriseId);

  if (enterprise.isPending) return <Loading rows={6} />;
  if (enterprise.isError) {
    const notFound = enterprise.error instanceof ApiError && enterprise.error.status === 404;
    return (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? '找不到该企业' : '企业信息加载失败'}
        subTitle={notFound ? '企业可能不在当前机构下，或您没有查看权限。' : enterprise.error.message}
        extra={<Link to="/customer/enterprises">返回企业列表</Link>}
      />
    );
  }

  const e = enterprise.data;
  const all = (tasks.data ?? []).filter((t) => t.enterpriseId === e.id);
  const open = openTasksOf(tasks.data, e.id);
  const basic = basicStep.data;
  const industry = basic?.basic.industry ? INDUSTRY_NAMES[basic.basic.industry] : undefined;
  const summary = [industry, districtOf(basic?.basic.siteAddress || e.registeredAddress)].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Breadcrumb items={[{ title: <Link to="/customer/enterprises">企业</Link> }, { title: e.name }]} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Typography.Title
            level={1}
            style={{
              flex: 1,
              fontSize: 28,
              lineHeight: '40px',
              fontWeight: 500,
              margin: 0,
            }}
          >
            {e.name}
          </Typography.Title>
          <Button onClick={() => setEditing(true)}>编辑企业信息</Button>
        </div>
        {(summary || e.registeredAddress) && <Typography.Text type="secondary">{summary || e.registeredAddress}</Typography.Text>}
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setSearch(key === 'overview' ? {} : { tab: key }, { replace: true })}
        items={[
          {
            key: 'overview',
            label: '概览',
            children: <Overview enterprise={e} open={open} basic={basic} documentCount={documents.data?.length} />,
          },
          {
            key: 'documents',
            label: documents.data ? `企业资料 ${documents.data.length}` : '企业资料',
            children: <EnterpriseDocumentsTab enterpriseId={e.id} orgId={orgId} />,
          },
          {
            key: 'tasks',
            label: `业务 ${all.length}`,
            children: <TaskTable tasks={all} loading={tasks.isPending} />,
          },
        ]}
      />

      <EditModal enterprise={e} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

function Overview({
  enterprise: e,
  open,
  basic,
  documentCount,
}: {
  enterprise: Enterprise;
  open: TaskSummary[];
  basic: BasicStepView | undefined;
  documentCount: number | undefined;
}) {
  const current = open[0];
  const b = basic?.basic;
  const sourceOf = (field: string, value: unknown) => {
    const s = basic?.sources[field];
    if (s) return FIELD_SOURCES[s];
    return value ? '企业自填' : undefined;
  };
  const contact = [b?.contactPerson, b?.contactPhone].filter(Boolean).join(' · ') || null;
  const siteAddress = b?.siteAddress || null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {current && (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 8,
            border: `1px solid ${taskStageTone(current.status).color}`,
            background: taskStageTone(current.status).bg,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>
              {current.name} · {TASK_STATUSES[current.status]}
            </div>
            <Typography.Text type="secondary">{STAGE_HINT[current.status]}</Typography.Text>
          </div>
          <Link to={`/customer/tasks/${current.id}`}>
            <Button type="primary">{current.status === 'preparing' ? '继续准备资料' : '查看任务'}</Button>
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <section style={{ ...card, flex: 1, padding: '8px 24px 16px' }}>
          <h2 style={{ ...cardTitle, margin: 0, padding: '14px 0 8px' }}>企业基本信息</h2>
          <InfoRow label="统一社会信用代码" value={e.socialCreditCode} source={sourceOf('socialCreditCode', e.socialCreditCode)} />
          <InfoRow label="法定代表人" value={e.legalRepresentative} source={sourceOf('legalRepresentative', e.legalRepresentative)} />
          <InfoRow label="注册地址" value={e.registeredAddress} source={sourceOf('registeredAddress', e.registeredAddress)} />
          <InfoRow label="实际生产地址" value={siteAddress} source={sourceOf('siteAddress', siteAddress)} />
          <InfoRow label="企业联系人" value={contact} source={sourceOf('contactPerson', contact)} />
          <InfoRow
            label="员工人数"
            value={b?.employeeCount !== undefined ? `${b.employeeCount} 人` : null}
            source={sourceOf('employeeCount', b?.employeeCount)}
            last
          />
        </section>

        <div
          style={{
            width: 340,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <section style={{ ...card, padding: '20px 24px' }}>
            <h2 style={{ ...cardTitle, margin: '0 0 14px' }}>这家企业</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Stat label="企业资料" value={documentCount ? `${documentCount} 份原件` : '暂无'} />
              <Stat label="在办任务" value={open.length > 0 ? `${open.length} 项` : '无'} />
              <Stat label="已交付成果" value="暂无" />
            </div>
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${gy.split}`,
                fontSize: 13,
                lineHeight: '20px',
                color: gy.secondary,
              }}
            >
              企业资料可在下一年度的编制任务中直接复用，只需更新变化部分。
            </div>
          </section>

          <section
            style={{
              ...card,
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <h2 style={{ ...cardTitle, margin: 0 }}>新的编制需求？</h2>
            <Typography.Text type="secondary">同一企业已有在办任务时，建议先完成当前任务。</Typography.Text>
            <Link to={`/customer/enterprises/${e.id}/tasks/new`} style={{ alignSelf: 'flex-start' }}>
              <Button>创建编制任务</Button>
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, source, last }: { label: string; value: string | null; source?: string; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        minHeight: 48,
        borderBottom: last ? 'none' : `1px solid ${gy.split}`,
      }}
    >
      <span style={{ width: 140, flexShrink: 0, color: gy.secondary }}>{label}</span>
      <span style={{ flex: 1, color: value ? gy.text : gy.tertiary }}>{value ?? '暂未填写'}</span>
      {value && source && <span style={{ flexShrink: 0, fontSize: 13, color: gy.tertiary }}>{source}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: gy.secondary }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function TaskTable({ tasks, loading }: { tasks: TaskSummary[]; loading: boolean }) {
  return (
    <Table<TaskSummary>
      rowKey="id"
      dataSource={tasks}
      loading={loading}
      pagination={false}
      locale={{ emptyText: '这家企业还没有编制任务' }}
      style={{ ...card, overflow: 'hidden' }}
      columns={[
        { title: '任务编号', dataIndex: 'number', width: 160 },
        { title: '任务名称', dataIndex: 'name' },
        {
          title: '进展',
          key: 'status',
          width: 200,
          render: (_, t) => <TaskStageTag status={t.status} />,
        },
        {
          title: '创建日期',
          key: 'createdAt',
          width: 160,
          render: (_, t) =>
            new Date(t.createdAt).toLocaleDateString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            }),
        },
      ]}
    />
  );
}

function EditModal({ enterprise, open, onClose }: { enterprise: Enterprise; open: boolean; onClose: () => void }) {
  const update = useUpdateEnterprise(enterprise.id);
  const { message } = App.useApp();
  const [form] = Form.useForm<EnterpriseInput>();

  const onFinish = (values: EnterpriseInput) => {
    update.mutate(values, {
      onSuccess: () => {
        message.success('企业信息已更新');
        onClose();
      },
      onError: (err) => {
        const text = showEnterpriseError(form, err);
        if (text) message.error(text);
      },
    });
  };

  return (
    <Modal
      title="编辑企业信息"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="保存"
      confirmLoading={update.isPending}
      width={800}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={enterpriseRequiredMark}
        initialValues={enterprise}
        onFinish={onFinish}
        style={{ marginTop: 16 }}
      >
        <EnterpriseFields />
      </Form>
    </Modal>
  );
}

// 地址里的区县，如「惠州市惠阳区淡水街道…」→「惠阳区」；找不到就不显示
function districtOf(address: string | null | undefined): string | undefined {
  return address?.match(/市([^市区县]{1,6}?[区县])/)?.[1];
}

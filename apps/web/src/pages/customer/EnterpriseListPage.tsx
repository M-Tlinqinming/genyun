import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { TaskStatus } from '@genyun/shared';
import { Button, Empty, Input, Select, Table, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { openTasksOf, useEnterprises, useOrgTasks, type Enterprise, type TaskSummary } from '../../api/enterprises';
import { PageHeader } from '../../components/PageHeader';
import { TaskStageTag } from '../../components/TaskStageTag';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';

type Progress = 'all' | TaskStatus | 'none';

const PROGRESS_OPTIONS: { value: Progress; label: string }[] = [
  { value: 'all', label: '进展：全部' },
  { value: 'preparing', label: '资料准备中' },
  { value: 'submitted', label: '已提交' },
  { value: 'none', label: '暂无在办任务' },
];

interface Row extends Enterprise {
  openTasks: TaskSummary[];
}

// 列表第二行：优先显示注册地址，没有就显示信用代码
function subtitleOf(e: Enterprise): string {
  return e.registeredAddress ?? e.socialCreditCode ?? '尚未填写注册地址';
}

// 企业列表与筛选。成员只看到分配给自己的企业，也不能新建企业（由机构管理员新建并分配）
export function EnterpriseListPage() {
  const { orgId, role } = useWorkspace();
  const isAdmin = role === 'customer_admin';
  const enterprises = useEnterprises(orgId);
  const tasks = useOrgTasks(orgId);
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [progress, setProgress] = useState<Progress>('all');

  const rows = useMemo<Row[]>(() => {
    const k = keyword.trim().toUpperCase();
    return (enterprises.data ?? [])
      .map((e) => ({ ...e, openTasks: openTasksOf(tasks.data, e.id) }))
      .filter((e) => !k || e.name.toUpperCase().includes(k) || (e.socialCreditCode ?? '').includes(k))
      .filter((e) => {
        if (progress === 'all') return true;
        if (progress === 'none') return e.openTasks.length === 0;
        return e.openTasks.some((t) => t.status === progress);
      });
  }, [enterprises.data, tasks.data, keyword, progress]);

  const total = enterprises.data?.length ?? 0;
  const newButton = (
    <Button
      type="primary"
      size="large"
      icon={<PlusOutlined />}
      onClick={() => navigate('/customer/enterprises/new')}
      style={{ fontSize: 16 }}
    >
      新建企业
    </Button>
  );

  return (
    <>
      <PageHeader
        title="企业"
        description={isAdmin ? '管理本机构服务的企业。企业资料可在多次编制任务中复用。' : '分配给您的企业。企业资料可在多次编制任务中复用。'}
        extra={isAdmin ? newButton : undefined}
      />
      <div style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 12, padding: '20px 24px', borderBottom: `1px solid ${gy.split}` }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: gy.tertiary }} />}
            placeholder="搜索企业名称 / 统一社会信用代码"
            onChange={(e) => setKeyword(e.target.value)}
            style={{ flex: 1 }}
          />
          <Select<Progress>
            value={progress}
            onChange={setProgress}
            options={PROGRESS_OPTIONS}
            style={{ width: 168 }}
            aria-label="按进展筛选"
          />
        </div>
        <Table<Row>
          rowKey="id"
          dataSource={rows}
          loading={enterprises.isPending || tasks.isPending}
          onRow={(record) => ({
            onClick: () => navigate(`/customer/enterprises/${record.id}`),
            style: { cursor: 'pointer', height: 72 },
          })}
          pagination={{
            pageSize: 10,
            hideOnSinglePage: false,
            showTotal: (n) => `共 ${n} 家企业`,
            style: { padding: '0 24px' },
          }}
          locale={{
            emptyText:
              total === 0 ? (
                isAdmin ? (
                  <Empty description="还没有企业。先建立企业档案，再为它创建编制任务。" style={{ padding: '48px 0' }}>
                    {newButton}
                  </Empty>
                ) : (
                  <Empty description="还没有分配给您的企业。请联系机构管理员分配。" style={{ padding: '48px 0' }} />
                )
              ) : (
                <Empty description="没有符合条件的企业" style={{ padding: '48px 0' }} />
              ),
          }}
          columns={[
            {
              title: '企业',
              key: 'name',
              onHeaderCell: () => ({ style: { paddingLeft: 24 } }),
              onCell: () => ({ style: { paddingLeft: 24 } }),
              render: (_, e) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography.Text strong>{e.name}</Typography.Text>
                  <Typography.Text style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
                    {subtitleOf(e)}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: '负责成员',
              key: 'members',
              width: 160,
              render: (_, e) =>
                e.members && e.members.length > 0 ? (
                  <Typography.Text ellipsis={{ tooltip: true }} style={{ maxWidth: 136 }}>
                    {e.members.map((m) => m.name).join('、')}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">未分配</Typography.Text>
                ),
            },
            {
              title: '在办任务',
              key: 'open',
              width: 104,
              render: (_, e) =>
                e.openTasks.length > 0 ? (
                  `${e.openTasks.length} 项`
                ) : (
                  <Typography.Text type="secondary">无</Typography.Text>
                ),
            },
            {
              title: '当前进展',
              key: 'progress',
              width: 256,
              render: (_, e) =>
                e.openTasks[0] ? (
                  <TaskStageTag status={e.openTasks[0].status} />
                ) : (
                  <Typography.Text type="secondary">暂无在办任务</Typography.Text>
                ),
            },
            {
              title: '操作',
              key: 'action',
              width: 120,
              render: (_, e) => (
                <Link to={`/customer/enterprises/${e.id}`} onClick={(ev) => ev.stopPropagation()}>
                  查看企业 →
                </Link>
              ),
            },
          ]}
        />
      </div>
      {!isAdmin && (
        <div style={{ marginTop: 20, padding: '16px 20px', borderRadius: 8, background: gy.selected, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>找不到某家企业？</span>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            成员只能看到分配给自己的企业。请联系机构管理员确认企业是否已建立或已分配。
          </span>
        </div>
      )}
    </>
  );
}

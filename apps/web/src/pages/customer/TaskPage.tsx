import { Breadcrumb, Empty, Result, Spin, Tabs } from 'antd';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { gy } from '../../theme/tokens';
import { TaskDocumentsSection } from './TaskDocumentsSection';

const STAGES = ['资料准备', '耕云编制', '专家审核', '成果交付'];

// 任务入口：还没选开始方式先去选；按提示填写转到填写向导。
// 上传已有资料：任务详情（12 页 P03），「资料与检查」里上传与关联企业原始资料
export function TaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);

  if (task.isPending) return <Spin style={{ display: 'block', padding: '96px 0' }} />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? '找不到该任务' : '任务加载失败'}
        subTitle={notFound ? '任务可能不在当前机构下，或您没有查看权限。' : task.error.message}
        extra={<Link to="/customer/enterprises">返回企业列表</Link>}
      />
    );
  }

  const t = task.data;
  if (t.startMethod === null) return <Navigate to={`/customer/tasks/${t.id}/start`} replace />;
  // 按提示填写：进入填写向导（停在哪一步的记忆在后续项目里做，先从第 1 步开始）
  if (t.startMethod === 'self_fill') return <Navigate to={`/customer/tasks/${t.id}/fill/1`} replace />;

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 8 }}
        items={[
          { title: <Link to="/customer/enterprises">企业</Link> },
          {
            title: <Link to={`/customer/enterprises/${t.enterpriseId}`}>{t.enterpriseName}</Link>,
          },
          { title: t.number },
        ]}
      />
      <PageHeader
        title={t.name}
        description={`${t.number} · ${t.status === 'preparing' ? '资料准备 · 申请尚未提交' : '已提交'}`}
      />
      <StageBar current={t.status === 'preparing' ? 0 : 1} />
      <Tabs
        style={{ marginTop: 8 }}
        items={[
          { key: 'materials', label: '资料与检查', children: <TaskDocumentsSection task={t} /> },
          { key: 'records', label: '处理记录', children: <Empty description="提交后，耕云的处理记录会显示在这里" /> },
          { key: 'versions', label: '成果版本', children: <Empty description="审核完成后，成果文档会显示在这里" /> },
        ]}
      />
    </>
  );
}

// 任务阶段条：资料准备 → 耕云编制 → 专家审核 → 成果交付
function StageBar({ current }: { current: number }) {
  return (
    <ol
      aria-label="任务阶段"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        margin: '-8px 0 16px',
        padding: '20px 24px',
        listStyle: 'none',
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      {STAGES.map((name, i) => {
        const active = i === current;
        return (
          <li key={name} style={{ display: 'contents' }}>
            {i > 0 && <span style={{ flex: 1, height: 1, background: gy.split }} />}
            <span
              aria-current={active ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '22px' }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: active ? gy.primary : undefined,
                  color: active ? '#FFFFFF' : gy.secondary,
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: active ? gy.primary : gy.secondary }}>{name}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

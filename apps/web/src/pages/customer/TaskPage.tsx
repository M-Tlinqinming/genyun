import { Breadcrumb, Button, Empty, Result, Tabs } from 'antd';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { gy } from '../../theme/tokens';
import { CheckView } from './check/CheckView';
import { SubmittedMaterials, SubmittedRecords, SubmittedStatusBar } from './submit/SubmittedView';
import { OpenSupplementCard, useOpenSupplement } from './submit/SupplementCard';
import { TaskDocumentsSection } from './TaskDocumentsSection';
import { Loading } from '../../components/ui';
import { TaskVersions } from './documents/TaskVersions';

const STAGES = ['资料准备', '耕云编制', '专家审核', '成果交付'];

// 任务详情（12 页 P03、P05；13 页 F03）：还没选开始方式先去选。「资料与检查」：上传路线先上传与关联企业原始资料，
// 再进资料检查；按提示填写的任务直接看资料检查，从那里继续填写。提交以后默认看「处理记录」（待补清单在这里）
export function TaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const [search, setSearch] = useSearchParams();
  // 注安师发起、等客户回应的事实补件
  const ask = useOpenSupplement(taskId, task.data !== undefined && task.data.status !== 'preparing');

  if (task.isPending) return <Loading rows={6} />;
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
  const submitted = t.status !== 'preparing';
  const tab = search.get('tab') ?? (submitted ? 'records' : 'materials');
  // 上传路线先看文件，点「检查资料」进检查页（?view=check）；自填路线直接看检查页，从那里继续填写
  const checking = t.startMethod === 'self_fill' || search.get('view') === 'check';
  const materials = submitted ? (
    <SubmittedMaterials task={t} />
  ) : checking ? (
    <CheckView
      task={t}
      onBackToFiles={t.startMethod === 'upload' ? () => setSearch({}, { replace: true }) : undefined}
    />
  ) : (
    <TaskDocumentsSection task={t} onCheck={() => setSearch({ view: 'check' })} />
  );

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
        description={`${t.number} · ${ask ? `等待您回应 · 第 ${ask.round} 轮` : submitted ? '申请已提交 · 当前由耕云处理' : '资料准备 · 申请尚未提交'}`}
        extra={
          <Link to={`/customer/enterprises/${t.enterpriseId}?tab=documents`}>
            <Button>查看企业资料</Button>
          </Link>
        }
      />
      {submitted ? <SubmittedStatusBar task={t} /> : <StageBar current={0} />}
      {submitted && <OpenSupplementCard task={t} />}
      <Tabs
        style={{ marginTop: 8 }}
        activeKey={tab}
        onChange={(key) =>
          setSearch(
            (prev) => {
              prev.set('tab', key);
              return prev;
            },
            { replace: true },
          )
        }
        items={[
          { key: 'materials', label: '资料与检查', children: materials },
          {
            key: 'records',
            label: '处理记录',
            children: submitted ? (
              <SubmittedRecords task={t} onShowMaterials={() => setSearch({ tab: 'materials' }, { replace: true })} />
            ) : (
              <Empty description="提交后，耕云的处理记录会显示在这里" />
            ),
          },
          { key: 'versions', label: '成果版本', children: <TaskVersions taskId={t.id} /> },
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

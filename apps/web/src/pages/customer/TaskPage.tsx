import { Breadcrumb, Button, Empty, Result, Tabs } from 'antd';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { gy } from '../../theme/tokens';
import { SubmittedMaterials, SubmittedRecords, SubmittedStatusBar } from './submit/SubmittedView';
import { SubmittedTaskPage } from './submitted/SubmittedTaskPage';
import { TaskDocumentsSection } from './TaskDocumentsSection';
import { Loading } from '../../components/ui';

const STAGES = ['资料准备', '耕云编制', '专家审核', '成果交付'];

// 任务详情（12 页 P03；13 页 F03）。「资料与检查」：上传、关联企业原始资料。提交以后默认看「处理记录」。
// 选择开始方式、按提示填写、资料检查、补充资料、成果版本已取消；新流程的任务在准备资料时转到准备资料页
export function TaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const [search, setSearch] = useSearchParams();

  if (task.isPending) return <Loading rows={6} />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? '找不到这个任务' : '任务加载失败'}
        subTitle={notFound ? '可能已经删除，或者您没有查看权限。' : task.error.message}
        extra={
          notFound ? <Link to="/customer/tasks">返回任务列表</Link> : <Link to="/customer/enterprises">返回企业列表</Link>
        }
      />
    );
  }

  const t = task.data;
  // 新流程还在准备资料的任务：到准备资料页
  if (t.flow === 'intake' && t.status === 'preparing') return <Navigate to={`/customer/tasks/${taskId}/prepare`} replace />;
  // 新流程提交给专家以后、交付以前：已提交页（交付以后照旧）
  if (t.flow === 'intake' && t.status === 'submitted' && !t.closedAt) return <SubmittedTaskPage task={t} />;
  const submitted = t.status !== 'preparing';
  const requested = search.get('tab');
  const tab = requested === 'materials' || requested === 'records' ? requested : submitted ? 'records' : 'materials';
  const materials = submitted ? <SubmittedMaterials task={t} /> : <TaskDocumentsSection task={t} />;

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
        description={`${t.number} · ${submitted ? '申请已提交 · 当前由耕云处理' : '资料准备 · 申请尚未提交'}`}
        extra={
          <Link to={`/customer/enterprises/${t.enterpriseId}?tab=documents`}>
            <Button>查看企业资料</Button>
          </Link>
        }
      />
      {submitted ? <SubmittedStatusBar task={t} /> : <StageBar current={0} />}
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

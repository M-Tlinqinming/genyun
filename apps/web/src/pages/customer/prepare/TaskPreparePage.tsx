import { Button, Result, Spin } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../../api/request';
import { useTask } from '../../../api/tasks';
import { membershipsIn, useSession } from '../../../auth/session';
import { CUSTOMER_STAGES, WizardLayout } from '../../../layouts/WizardLayout';
import { gy, type, weight } from '../../../theme/tokens';

// 准备资料（向导，不带侧栏）：顶栏是任务名称和企业、阶段条停在「准备资料」。
// 这一版只搭好壳子，下载资料模板、上传资料表格在后续补上
export function TaskPreparePage() {
  const session = useSession();
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const task = useTask(taskId);

  if (session.isPending) return <Spin fullscreen />;
  if (!session.data || membershipsIn(session.data, 'customer').length === 0) return <Navigate to="/login" replace />;

  const back = (
    <Button onClick={() => navigate('/customer')} style={{ borderColor: gy.controlLine }}>
      返回工作台
    </Button>
  );

  if (task.isPending) return <Spin fullscreen />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <WizardLayout stages={CUSTOMER_STAGES} current={0} headerExtra={back}>
        <Result
          status={notFound ? '404' : 'error'}
          title={notFound ? '找不到这个任务' : '任务加载失败'}
          subTitle={notFound ? '任务可能已删除，或您没有查看权限。' : task.error.message}
          extra={<Link to="/customer/tasks">返回任务列表</Link>}
        />
      </WizardLayout>
    );
  }

  return (
    <WizardLayout
      title={task.data.name}
      enterpriseName={task.data.enterpriseName}
      stages={CUSTOMER_STAGES}
      current={0}
      headerExtra={back}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text, margin: 0 }}>下载资料模板，填好后上传</h1>
      </div>
    </WizardLayout>
  );
}

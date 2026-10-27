import { Result, Spin } from 'antd';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../api/request';
import { useTask } from '../../../api/tasks';
import { useSession } from '../../../auth/session';
import { BasicStepPage } from './BasicStepPage';
import { FILL_STEPS } from './FillFrame';
import { OrganizationStepPage } from './OrganizationStepPage';
import { ProcessStepPage } from './ProcessStepPage';
import { ProductionStepPage } from './ProductionStepPage';
import { ResourcesStepPage } from './ResourcesStepPage';
import { ReviewStepPage } from './ReviewStepPage';

// 企业自填 /customer/tasks/:taskId/fill/:step（全屏，不在工作区框架里）。第 3 步分两页，第 2 页为 ?page=process。
export function SelfFillPage() {
  const { taskId = '', step: stepParam = '1' } = useParams();
  const session = useSession();
  const task = useTask(taskId);
  const step = Number(stepParam);
  const [search] = useSearchParams();
  const processPage = step === 3 && search.get('page') === 'process';

  if (session.isPending) return <Spin fullscreen />;
  if (!session.data) return <Navigate to="/login" replace />;
  if (!(step >= 1 && step <= FILL_STEPS.length)) return <Navigate to={`/customer/tasks/${taskId}/fill/1`} replace />;
  if (task.isPending) return <Spin fullscreen />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? '找不到该任务' : '任务加载失败'}
        subTitle={notFound ? '任务可能不在您的机构下，或您没有查看权限。' : task.error.message}
        extra={<Link to="/customer">返回工作台</Link>}
      />
    );
  }

  if (step === 1) return <BasicStepPage key={task.data.id} task={task.data} />;
  if (step === 2) return <OrganizationStepPage key={task.data.id} task={task.data} />;
  if (step === 3) {
    return processPage ? (
      <ProcessStepPage key={task.data.id} task={task.data} />
    ) : (
      <ProductionStepPage key={task.data.id} task={task.data} />
    );
  }
  if (step === 4) return <ResourcesStepPage key={task.data.id} task={task.data} />;
  return <ReviewStepPage key={task.data.id} task={task.data} />;
}

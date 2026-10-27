import { Button, Empty, Result, Spin } from 'antd';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../api/request';
import { useTask } from '../../../api/tasks';
import { useSession } from '../../../auth/session';
import { gy } from '../../../theme/tokens';
import { BasicStepPage } from './BasicStepPage';
import { FILL_STEPS, FillFrame } from './FillFrame';
import { OrganizationStepPage } from './OrganizationStepPage';
import { ProcessStepPage } from './ProcessStepPage';
import { ProductionStepPage } from './ProductionStepPage';

// 企业自填 /customer/tasks/:taskId/fill/:step（全屏，不在工作区框架里）。第 3 步分两页，第 2 页为 ?page=process。
// 第 4–5 步在第 8–9 项做，目前先占位
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
  return (
    <PendingStep
      step={step}
      taskId={task.data.id}
      enterpriseId={task.data.enterpriseId}
      enterpriseName={task.data.enterpriseName}
    />
  );
}

function PendingStep({
  step,
  taskId,
  enterpriseId,
  enterpriseName,
}: {
  step: number;
  taskId: string;
  enterpriseId: string;
  enterpriseName: string;
}) {
  const navigate = useNavigate();
  const next = FILL_STEPS[step];
  return (
    <FillFrame
      step={step}
      enterpriseName={enterpriseName}
      saveState="idle"
      onExit={() => navigate(`/customer/enterprises/${enterpriseId}`)}
      footer={
        <>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>第 {step} 步，共 5 步</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              size="large"
              // 第 4 步的上一步是第 3 步第 2 页（工艺流程）
              onClick={() => navigate(`/customer/tasks/${taskId}/fill/${step - 1}${step === 4 ? '?page=process' : ''}`)}
            >
              上一步
            </Button>
            {next && (
              <Button
                size="large"
                type="primary"
                onClick={() => navigate(`/customer/tasks/${taskId}/fill/${step + 1}`)}
              >
                下一步：{next.title}
              </Button>
            )}
          </div>
        </>
      }
    >
      <Empty description="这一步正在建设中" style={{ flex: 1, padding: '96px 0' }} />
    </FillFrame>
  );
}

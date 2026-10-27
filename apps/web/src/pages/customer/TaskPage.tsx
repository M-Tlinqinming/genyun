import { START_METHODS } from '@genyun/shared';
import { Breadcrumb, Empty, Result, Spin } from 'antd';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { TaskStageTag } from '../../components/TaskStageTag';

// 任务入口：还没选开始方式先去选。
// 选好之后的页面：按提示填写在第 6–9 项、上传已有资料在第 10 项做，目前先占位
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
        description={`${t.number} · ${START_METHODS[t.startMethod]}`}
        extra={<TaskStageTag status={t.status} />}
      />
      <Empty description="这一页正在建设中" style={{ padding: '96px 0' }} />
    </>
  );
}

import { Button, Result } from 'antd';
import { Link, useParams } from 'react-router';
import { useGeneration } from '../../api/generation';
import { useTask } from '../../api/tasks';
import { Loading } from '../../components/ui';
import { EditView } from '../expert/editing/EditView';
import { phaseOf } from '../expert/workup/GenerationView';

// 运营查看任务正文（只读）：网址 /operator/tasks/<任务>。任务中心（列表与分派）在 /operator/tasks?task=<任务>，
// 正文在这里看；三份草稿生成完才有正文可看，修改只能由负责专家做
export function OperatorTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const generation = useGeneration(taskId);
  const back = (
    <Link to="/operator/tasks">
      <Button>返回任务中心</Button>
    </Link>
  );
  if (task.isPending || generation.isPending) return <Loading rows={6} />;
  if (task.isError) return <Result status="404" title="找不到该任务" subTitle="任务不存在。" extra={back} />;
  const current = generation.data?.current ?? null;
  if (!current || phaseOf(current) !== 'done') {
    return <Result status="info" title="还没有可查看的正文" subTitle="三份草稿生成完以后，这里可以查看正文。" extra={back} />;
  }
  return (
    <EditView
      taskId={taskId}
      enterpriseName={task.data.enterpriseName}
      taskNumber={task.data.number}
      generation={current}
      links={{ center: '/operator/tasks', task: `/operator/tasks/${taskId}` }}
    />
  );
}

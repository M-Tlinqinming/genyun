import { ArrowLeftOutlined } from '@ant-design/icons';
import { Empty, Result } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useTask } from '../../api/tasks';
import { PageHeader } from '../../components/PageHeader';
import { linkButton, Loading, panel } from '../../components/ui';

// 进入任务（I05 处理工作台）。三栏专业整理在下一项做，这里先确认能进、只能进自己的任务
export function ExpertTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const navigate = useNavigate();
  const back = (
    <button type="button" style={linkButton} onClick={() => navigate('/expert')}>
      <ArrowLeftOutlined /> 返回任务中心
    </button>
  );

  if (task.isPending) return <Loading rows={4} />;
  if (task.isError) {
    return <Result status="404" title="找不到该任务" subTitle="任务不存在，或没有分派给您。" extra={back} />;
  }
  return (
    <>
      <PageHeader
        eyebrow="耕云内部 / 专业处理 / 任务中心"
        title={task.data.enterpriseName}
        description={`${task.data.name} · ${task.data.number}`}
        extra={back}
      />
      <div style={{ ...panel, padding: '64px 0' }}>
        <Empty description="专业整理工作台正在建设中" />
      </div>
    </>
  );
}

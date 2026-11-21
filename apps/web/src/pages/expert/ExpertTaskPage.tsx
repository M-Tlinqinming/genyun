import { ArrowLeftOutlined } from '@ant-design/icons';
import { Result } from 'antd';
import { useEffect, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGeneration } from '../../api/generation';
import { useTask } from '../../api/tasks';
import { useWorkup } from '../../api/workup';
import { linkButton, Loading } from '../../components/ui';
import { gy, stage } from '../../theme/tokens';
import { PublishView } from './editing/PublishView';
import { ReviewWorkspace } from './editing/ReviewWorkspace';
import { GenerationView, phaseOf } from './workup/GenerationView';
import { WorkupWizard } from './workup/wizard/WorkupWizard';

const STAGES = ['资料核实', '专业编制', '审核与修订', '成果交付'];
const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };

// 资料核对第 5 步第 2 页（核对并生成）：原来的确认采用资料页和整理页都收进向导，旧网址转到这里
const CONFIRM_PARAMS = { view: 'workup', step: '5', page: '2' };

// 专家处理一个任务：资料核对向导（?view=workup）→ 三份草稿的生成进度（E18-02、E18-02b）→ 核对定稿 → 定稿并交付。
// 生成过草稿就默认看进度，?view=workup 回到资料核对
export function ExpertTaskPage() {
  const { taskId = '' } = useParams();
  const task = useTask(taskId);
  const workup = useWorkup(taskId);
  const generation = useGeneration(taskId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const requested = params.get('view');
  const legacy = requested === 'confirm' || requested === 'workup-old';

  // 旧网址：确认采用资料（?view=confirm）、原来的整理页（?view=workup-old）
  useEffect(() => {
    if (legacy) setParams(CONFIRM_PARAMS, { replace: true });
  }, [legacy, setParams]);

  const back = (
    <button type="button" style={linkButton} onClick={() => navigate('/expert')}>
      <ArrowLeftOutlined /> 返回任务中心
    </button>
  );
  if (task.isPending || workup.isPending || generation.isPending || legacy) return <Loading rows={6} />;
  if (task.isError) {
    // 原负责专家打开旧链接：接口说明已改派给谁
    const moved = task.error.message.startsWith('这个任务已改派给');
    return moved ? (
      <Result status="info" title={task.error.message} subTitle="您不用再处理。已整理的内容都随任务交给了对方。" extra={back} />
    ) : (
      <Result status="404" title="找不到该任务" subTitle="任务不存在，或没有分派给您。" extra={back} />
    );
  }
  if (workup.isError) {
    return <Result status="info" title="还不能开始资料核对" subTitle={workup.error.message} extra={back} />;
  }

  const w = workup.data;
  const current = generation.data?.current ?? null;
  const phase = current ? phaseOf(current) : null;

  // 成果交付（R03–R04b）：审核结论有效时由负责专家交付
  if (requested === 'publish' && current && phase === 'done') {
    return (
      <PublishView
        taskId={taskId}
        enterpriseName={task.data.enterpriseName}
        taskNumber={task.data.number}
        onOpen={(k) => setParams({ view: 'edit', doc: k })}
        onEdit={() => setParams({ view: 'edit', tab: 'conclusion' })}
      />
    );
  }

  // 核对定稿（E18-03 到 E18-15）：三份草稿都生成完才进得来；旧网址 ?view=review 打开审核结论页签
  if ((requested === 'edit' || requested === 'review') && current && phase === 'done') {
    return <ReviewWorkspace taskId={taskId} enterpriseName={task.data.enterpriseName} taskNumber={task.data.number} generation={current} />;
  }

  if (requested === 'workup' || !current) {
    return <WorkupWizard taskId={taskId} enterpriseName={task.data.enterpriseName} workup={w} />;
  }

  const chip =
    phase === 'running'
      ? { text: '生成中', color: gy.primary, bg: gy.selected }
      : phase === 'failed'
        ? { text: '生成部分失败', ...stage.error }
        : { text: '草稿已生成', ...stage.done };
  return (
    <div className="gy-wide-workbench" style={{ display: 'flex', flexDirection: 'column', gap: 24, margin: '-16px 0 -24px', paddingBottom: 24 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="面包屑" style={{ ...text14, color: gy.secondary }}>
          <Link to="/expert" style={{ color: gy.secondary }}>
            任务中心
          </Link>
          {`　/　${task.data.enterpriseName}　/　生成草稿`}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, lineHeight: '32px', color: gy.text }}>{task.data.enterpriseName}</h1>
          <span style={{ ...text14, color: gy.secondary }}>{task.data.number}</span>
          <span style={{ flex: 1 }} />
          <span role="status" style={{ ...text14, padding: '2px 10px', borderRadius: 4, background: chip.bg, color: chip.color }}>
            {chip.text}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 0 12px', borderBottom: `1px solid ${gy.split}` }}>
          <ol aria-label="处理阶段" style={{ display: 'flex', gap: 28, flex: 1, margin: 0, padding: 0, listStyle: 'none' }}>
            {STAGES.map((s, i) => (
              <li key={s} aria-current={i === 1 ? 'step' : undefined} style={{ ...text14, color: i === 1 ? gy.primary : gy.secondary }}>
                {i + 1}　{s}
              </li>
            ))}
          </ol>
        </div>
      </header>
      <GenerationView
        taskId={taskId}
        taskNumber={task.data.number}
        generation={current}
        onBackToCenter={() => navigate('/expert')}
        onBackToWorkup={() => {
          setParams(CONFIRM_PARAMS);
          window.scrollTo({ top: 0 });
        }}
        onEdit={() => {
          setParams({ view: 'edit' });
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

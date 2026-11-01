import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOrgTasks } from '../../api/enterprises';
import { useSession } from '../../auth/session';
import { ContactLink } from '../../components/ContactLink';
import { Loading, Notice, panel } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';
import { CreateTaskButton, taskHref, taskRows, useContract, whenText, type TaskRow } from './tasks/shared';

const MAX_TODO = 5;

// C01 工作台｜待我处理优先：登录后先看到要处理的任务，点按钮直达那一步；再看正在办理与最近交付。
// 年度服务到期前 30 天提醒，过期后不能新建任务（13 页 S01）
export function WorkbenchPage() {
  const { orgId } = useWorkspace();
  const session = useSession();
  const tasks = useOrgTasks(orgId);
  const contract = useContract(orgId);
  const navigate = useNavigate();

  const now = new Date();
  const rows = taskRows(tasks.data);
  const mine = rows.filter((t) => t.todo.bucket === 'mine');
  const working = rows.find((t) => t.todo.bucket === 'gengyun');
  const workingCount = rows.filter((t) => t.todo.bucket === 'gengyun').length;
  const delivered = rows.find((t) => t.todo.bucket === 'delivered');

  return (
    <>
      <PageHeader
        eyebrow={`客户工作台 · ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(now)}`}
        title={`${greeting(now)}，${session.data?.name ?? ''}`}
        description="先处理需要您回应的事项，再查看正在办理的任务。"
        extra={<CreateTaskButton orgId={orgId} canCreate={contract.canCreate} />}
      />

      <ContractNotice state={contract.state} daysLeft={contract.daysLeft} endsAt={contract.endsAt} />

      {tasks.isPending ? (
        <Loading rows={6} />
      ) : tasks.isError ? (
        <Result status="error" title="任务加载失败" subTitle={tasks.error.message} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section aria-label="待我处理" style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '28px 28px 24px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, lineHeight: '28px', fontWeight: 500, color: gy.text }}>
                  待我处理
                  {mine.length > 0 && <span style={badge}>{mine.length}</span>}
                </h2>
                <span style={{ fontSize: 14, color: gy.secondary }}>确认企业事实、补充资料，让任务继续推进。</span>
              </div>
              <Link to="/customer/tasks" style={{ color: gy.text }}>
                查看业务任务 <ArrowRightOutlined />
              </Link>
            </div>
            {mine.length === 0 ? (
              <div style={{ padding: '24px 28px 28px', borderTop: `1px solid ${gy.split}`, fontSize: 14, color: gy.secondary }}>
                暂时没有需要您处理的事项。有新任务时，点右上角「创建编制任务」。
              </div>
            ) : (
              mine.slice(0, MAX_TODO).map((t, i) => <TodoRow key={t.id} task={t} primary={i === 0} now={now} />)
            )}
            {mine.length > MAX_TODO && (
              <div style={{ padding: '16px 28px', borderTop: `1px solid ${gy.split}`, fontSize: 14, color: gy.secondary }}>
                还有 {mine.length - MAX_TODO} 项待处理，<Link to="/customer/tasks">在业务任务里查看全部</Link>
              </div>
            )}
          </section>

          <div style={{ display: 'flex', gap: 24 }}>
            <SummaryCard
              label="正在办理"
              aside={workingCount > 0 ? `${workingCount} 项` : undefined}
              task={working}
              tag={<><ClockCircleOutlined /> 耕云编制中</>}
              text={(t) => (t.remaining > 0 ? `当前由耕云整理资料；还有 ${t.remaining} 项可稍后补，审核前补齐更好。` : '当前由耕云整理资料并生成初稿，暂无需要您处理的事项。')}
              action="查看处理进度"
              empty="提交生成申请后，耕云处理中的任务会显示在这里。"
              onOpen={(t) => navigate(taskHref(t))}
            />
            <SummaryCard
              label="最近交付"
              task={delivered}
              tag={<><CheckCircleOutlined /> 已交付</>}
              text={() => '注安师已审核并发布，三份 Word 可直接查看和下载。'}
              action="查看编制成果"
              empty="注安师审核发布后，成果会显示在这里。"
              onOpen={(t) => navigate(taskHref(t))}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 14, color: gy.secondary }}>
            {contract.state && (
              <span style={{ padding: '1px 8px', borderRadius: 4, background: gy.neutralBg, color: gy.text, fontSize: 13 }}>
                {SERVICE_TAG[contract.state]}
              </span>
            )}
            <span style={{ flex: 1 }}>
              {contract.endsAt ? `年度服务至 ${contract.endsAt}。` : ''}服务信息与续约可联系耕云。
            </span>
            <span>仅展示您有权访问的企业与任务</span>
          </div>
        </div>
      )}
    </>
  );
}

const SERVICE_TAG = {
  none: '年度服务未开通',
  upcoming: '年度服务未开始',
  active: '年度服务有效',
  expiring: '年度服务即将到期',
  expired: '年度服务已到期',
} as const;

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(now));
  return hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
}

// 年度服务提醒：30 天内到期提醒续约；已到期或未开通时不能新建任务，在办任务与历史成果不受影响
export function ContractNotice({
  state,
  daysLeft,
  endsAt,
}: {
  state: ReturnType<typeof useContract>['state'];
  daysLeft: number | null;
  endsAt: string | null;
}) {
  if (state === null || state === 'active') return null;
  const notice =
    state === 'expiring'
      ? {
          title: daysLeft === 0 ? '年度服务今天到期' : `年度服务将于 ${endsAt} 到期，还有 ${daysLeft} 天`,
          text: '到期后不能创建新的编制任务；在办任务和已交付成果不受影响。',
        }
      : state === 'expired'
        ? { title: '年度服务已到期', text: '新任务暂不可创建。在办任务按服务约定处理，历史成果仍可查看和下载。' }
        : state === 'upcoming'
          ? { title: '年度服务尚未开始', text: '服务开始后即可创建编制任务。' }
          : { title: '年度服务尚未开通', text: '耕云登记合同后即可创建编制任务。' };
  return (
    <div style={{ marginBottom: 24 }}>
      <Notice
        tone="warning"
        label="年度服务提醒"
        title={notice.title}
        text={notice.text}
        action={
          <ContactLink
            title="联系耕云续约"
            hint="续约或开通年度服务，请直接联系耕云。"
            trigger={(open) => (
              <Button type="primary" onClick={open}>
                {state === 'upcoming' ? '联系耕云' : state === 'none' ? '联系耕云开通' : '联系耕云续约'}
              </Button>
            )}
          />
        }
      />
    </div>
  );
}

function TodoRow({ task: t, primary, now }: { task: TaskRow; primary: boolean; now: Date }) {
  const navigate = useNavigate();
  return (
    <div
      data-testid={`todo-${t.number}`}
      style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '24px 28px', borderTop: `1px solid ${gy.split}` }}
    >
      <div style={{ width: 266, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{t.enterpriseName}</span>
        <span style={{ fontSize: 13, color: gy.secondary }}>
          {t.name} · {t.number}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{t.todo.next}</span>
        <span style={{ fontSize: 13, color: gy.secondary }}>{t.todo.stageText} · 资料已保存，可随时继续</span>
      </div>
      <span style={{ width: 96, flexShrink: 0, fontSize: 13, color: gy.secondary }}>{whenText(t.activityAt, now)}</span>
      <Button type={primary ? 'primary' : 'default'} style={{ width: 114, flexShrink: 0 }} onClick={() => navigate(taskHref(t))}>
        {t.todo.action}
      </Button>
    </div>
  );
}

function SummaryCard({
  label,
  aside,
  task,
  tag,
  text,
  action,
  empty,
  onOpen,
}: {
  label: string;
  aside?: string;
  task: TaskRow | undefined;
  tag: ReactNode;
  text: (t: TaskRow) => string;
  action: string;
  empty: string;
  onOpen: (t: TaskRow) => void;
}) {
  return (
    <section aria-label={label} style={{ ...panel, flex: 1, minWidth: 0, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>{label}</h2>
        {aside && <span style={{ ...badge, borderRadius: 4, padding: '0 8px', background: gy.neutralBg, color: gy.text }}>{aside}</span>}
      </div>
      {task ? (
        <>
          <span style={{ alignSelf: 'flex-start', padding: '0 8px', borderRadius: 4, fontSize: 12, lineHeight: '22px', background: gy.neutralBg, color: gy.text }}>
            {tag}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 18, lineHeight: '26px', fontWeight: 500, color: gy.text }}>{task.enterpriseName}</span>
            <span style={{ fontSize: 14, color: gy.secondary }}>
              {task.name} · {task.number}
            </span>
          </div>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{text(task)}</span>
          <Button style={{ alignSelf: 'flex-start' }} onClick={() => onOpen(task)}>
            {action} <ArrowRightOutlined />
          </Button>
        </>
      ) : (
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{empty}</span>
      )}
    </section>
  );
}

const badge: CSSProperties = {
  padding: '0 6px',
  borderRadius: 10,
  fontSize: 12,
  lineHeight: '20px',
  fontWeight: 400,
  color: gy.primary,
  background: gy.selected,
};

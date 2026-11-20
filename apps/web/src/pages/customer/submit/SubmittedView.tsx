import { checkOverview } from '@genyun/shared';
import { Button, Result } from 'antd';
import { type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTaskCheck, useTaskSubmission, type Submission, type Task } from '../../../api/tasks';
import { gy, source, stage } from '../../../theme/tokens';
import { AnswerList, DocumentList } from './SubmitDialog';
import { Loading, Notice, panel } from '../../../components/ui';

const AFTER_SUBMIT = [
  { title: '耕云继续编制', text: '基于本次资料整理信息，生成三份文档初稿。' },
  { title: '专家核对与修订', text: '校验企业事实与文稿；需要补充事实时，负责专家直接联系您。' },
  { title: '交付后获取成果', text: '在成果文档里下载应急预案、风险评估和资源调查。' },
];

// 已提交任务的阶段条（13 页 F03）：资料已提交、下一步
export function SubmittedStatusBar({ task: _task }: { task: Task }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '-8px 0 16px',
        padding: '20px 24px',
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
        fontSize: 14,
        lineHeight: '22px',
      }}
    >
      <span style={{ padding: '1px 8px', borderRadius: 4, color: stage.done.color, background: stage.done.bg }}>资料已提交</span>
      <span style={{ flex: 1, color: gy.text }}>下一步：耕云整理资料并生成初稿</span>
      <span style={{ color: gy.secondary }}>生成完成后进入专家审核</span>
    </div>
  );
}

// 「处理记录」标签（13 页 F03）：提交成功提示、处理记录；右栏负责专家与提交后流程。
// 系统里不再补件：需要补充时负责专家直接联系客户
export function SubmittedRecords({ task, onShowMaterials }: { task: Task; onShowMaterials: () => void }) {
  const navigate = useNavigate();
  const submissionQuery = useTaskSubmission(task.id);
  const check = useTaskCheck(task.id);
  const submission = submissionQuery.data?.submitted ? submissionQuery.data.submission : null;
  const error = submissionQuery.error ?? check.error;

  if (submissionQuery.isPending || check.isPending) return <Loading rows={6} />;
  if (error || !submission || !check.data) {
    return <Result status="error" title="处理记录加载失败" subTitle={error?.message ?? '请刷新页面重试'} />;
  }

  const overview = checkOverview(check.data.items);
  const expertItems = overview.withExpert.filter((i) => i.state === 'expert');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Notice
        tone="success"
        title="申请已提交，当前无需您操作"
        text="本次资料版本已记录。需要您补充企业事实时，负责专家会直接联系您。"
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section aria-label="处理记录" style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 16px', borderBottom: `1px solid ${gy.split}` }}>
              <h2 style={h2}>本次任务的处理记录</h2>
              <span style={{ fontSize: 14, color: gy.secondary }}>最近更新：{dateTime(submission.submittedAt)}</span>
            </div>
            <Record
              at={submission.submittedAt}
              title="生成申请已提交"
              text={`${submission.submittedByName}提交 · ${submission.documents.length} 份资料版本已记录`}
              current
            />
            <Record at={task.createdAt} title="任务已创建" text="开始准备资料" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderTop: `1px solid ${gy.split}` }}>
              <span style={{ fontSize: 14, color: gy.secondary }}>提交后如有企业事实变化，请联系耕云客服或负责专家。无需再次提交同一申请。</span>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button type="primary" onClick={onShowMaterials}>
                  查看本次提交资料
                </Button>
                <Button onClick={() => navigate(`/customer/enterprises/${task.enterpriseId}`)}>返回企业</Button>
              </div>
            </div>
          </section>
        </div>

        <aside style={{ width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {task.assignedExpertName && (
            <section style={{ ...panel, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 13, color: gy.tertiary }}>负责专家</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>{task.assignedExpertName}</span>
              <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
                需要补充时{task.assignedExpertName}会直接联系您。
              </span>
            </section>
          )}
          {expertItems.length > 0 && (
            <section style={{ padding: 20, borderRadius: 8, background: source.expert.bg, border: '1px solid #D8D2F2', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>耕云专家判断中 · {expertItems.length} 项</span>
              <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{expertItems.map((i) => i.label).join(' · ')}</span>
              <span style={{ fontSize: 13, color: gy.tertiary }}>包含在服务内，您不用操作</span>
            </section>
          )}
          <AfterSubmit />
        </aside>
      </div>

    </div>
  );
}

function Record({ at, title, text, current }: { at: string; title: string; text: string; current?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, padding: '20px 24px', borderTop: `1px solid ${gy.split}` }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 14, color: gy.secondary }}>{dateTime(at)}</span>
      <span style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 4, background: current ? gy.primary : gy.border }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>{title}</span>
        <span style={{ fontSize: 14, color: gy.secondary }}>{text}</span>
      </div>
    </div>
  );
}

function AfterSubmit() {
  return (
    <section style={{ ...panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ ...h2, fontSize: 20, lineHeight: '28px' }}>提交后会发生什么</h2>
      {AFTER_SUBMIT.map((s, i) => (
        <div key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>
            {String(i + 1).padStart(2, '0')}　{s.title}
          </span>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{s.text}</span>
        </div>
      ))}
      <span style={{ paddingTop: 16, borderTop: `1px solid ${gy.split}`, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
        您提供企业事实；文稿的核对、修正和审核由耕云专家负责。
      </span>
    </section>
  );
}

// 「资料与检查」标签在提交后显示当时提交的资料版本与确认事项
export function SubmittedMaterials({ task }: { task: Task }) {
  const submission = useTaskSubmission(task.id);
  if (submission.isPending) return <Loading rows={5} />;
  if (submission.isError || !submission.data.submitted) {
    return <Result status="error" title="提交资料加载失败" subTitle={submission.error?.message ?? '请刷新页面重试'} />;
  }
  return <MaterialsCard submission={submission.data.submission} aside={<AfterSubmit />} />;
}

function MaterialsCard({ submission, aside }: { submission: Submission; aside: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
      <section aria-label="本次提交资料" style={{ ...panel, flex: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={h2}>本次提交资料</h2>
          <span style={{ fontSize: 14, color: gy.secondary }}>
            {submission.submittedByName} · {dateTime(submission.submittedAt)} 提交 · 以后上传新文件不会替换这里的版本
          </span>
        </div>
        <DocumentList documents={submission.documents} />
        <AnswerList answers={submission.answers} title="由您确认的事项" />
      </section>
      <aside style={{ width: 290, flexShrink: 0 }}>{aside}</aside>
    </div>
  );
}

// 北京时间 MM.DD HH:mm
function dateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

const h2: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };

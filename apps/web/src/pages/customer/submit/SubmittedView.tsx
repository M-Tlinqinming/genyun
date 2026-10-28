import {
  checkOverview,
  supplementProgress,
  type Category,
  type CategoryCheckItem,
} from '@genyun/shared';
import { CheckCircleFilled, CheckOutlined } from '@ant-design/icons';
import { Button, Progress, Result, Spin } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTaskCheck, useTaskSubmission, type Submission, type Task } from '../../../api/tasks';
import { gy, source, stage } from '../../../theme/tokens';
import { CheckDrawer } from '../check/CheckDrawer';
import { OnSiteDialog } from '../OnSiteVisit';
import { AnswerList, DocumentList } from './SubmitDialog';

const AFTER_SUBMIT = [
  { title: '耕云继续编制', text: '基于本次资料整理信息，生成三份文档初稿。' },
  { title: '专家核对与修订', text: '校验企业事实与文稿；需要补充事实时，在本任务向您说明。' },
  { title: '发布后获取成果', text: '下载同一交付版本的应急预案、风险评估和资源调查。' },
];

// 已提交任务的阶段条（13 页 F03）：资料已提交、下一步、待补几项
export function SubmittedStatusBar({ task }: { task: Task }) {
  const { remaining } = useSupplements(task);
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
      <span style={{ color: gy.secondary }}>
        {remaining.length > 0 ? `待补 ${remaining.length} 项 · 审核前补齐更好` : '生成完成后进入专家审核'}
      </span>
    </div>
  );
}

// 提交时待补、现在还没补的项
function useSupplements(task: Task) {
  const submission = useTaskSubmission(task.id);
  const check = useTaskCheck(task.id);
  const s = submission.data?.submitted ? submission.data.submission : null;
  const items = check.data?.items ?? {};
  const pending = s?.pendingKeys ?? [];
  const progress = supplementProgress(pending, items);
  return {
    submission: s,
    check,
    isPending: submission.isPending || check.isPending,
    error: submission.error ?? check.error,
    progress,
    remaining: pending.filter((k) => !progress.doneKeys.includes(k)),
  };
}

// 「处理记录」标签（13 页 F03、F03B）：提交成功提示、待补清单、处理记录；右栏负责专家与提交后流程
export function SubmittedRecords({ task, onShowMaterials }: { task: Task; onShowMaterials: () => void }) {
  const navigate = useNavigate();
  const { submission, check, isPending, error, progress, remaining } = useSupplements(task);
  const [openCategory, setOpenCategory] = useState<Category | null>(null);
  const [booking, setBooking] = useState(false);

  if (isPending) return <Spin style={{ display: 'block', padding: '64px 0' }} />;
  if (error || !submission || !check.data) {
    return <Result status="error" title="处理记录加载失败" subTitle={error?.message ?? '请刷新页面重试'} />;
  }

  const overview = checkOverview(check.data.items);
  const pendingKeys = new Set(submission.pendingKeys);
  const groups = overview.categories
    .map((c) => ({ ...c, items: c.items.filter((i) => pendingKeys.has(i.key)) }))
    .filter((c) => c.items.length > 0);
  const opened = overview.categories.find((c) => c.category === openCategory) ?? null;
  const expertItems = overview.withExpert.filter((i) => i.state === 'expert');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '20px 24px',
          borderRadius: 8,
          background: gy.successBg,
          border: `1px solid ${gy.success}`,
        }}
      >
        <CheckCircleFilled style={{ color: gy.success, fontSize: 20 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text }}>
            {remaining.length > 0 ? '申请已提交，耕云已开始整理' : '申请已提交，当前无需您操作'}
          </span>
          <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            {remaining.length > 0
              ? `还有 ${remaining.length} 项可稍后补，不影响编制；专家审核前补齐，初稿会更准确。`
              : '本次资料版本已记录。需要您补充企业事实时，会在本任务中说明。'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groups.length > 0 && (
            <section aria-label="待补清单" style={panel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '24px 24px 16px', borderBottom: `1px solid ${gy.split}` }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h2 style={h2}>待补清单</h2>
                  <span style={{ fontSize: 13, lineHeight: '20px', color: gy.secondary }}>
                    补一项少一项，补完的会通知负责的注册安全工程师。
                  </span>
                </div>
                <span style={{ fontSize: 14, color: gy.text }}>
                  已补 {progress.done} / {progress.total}
                </span>
                <Progress
                  percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
                  showInfo={false}
                  size="small"
                  style={{ width: 120, margin: 0 }}
                />
              </div>
              <div style={{ padding: '8px 24px 24px' }}>
                {groups.map((g) => (
                  <div key={g.category} style={{ paddingTop: 16 }}>
                    <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{g.label}</span>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {g.items.map((i, n) => (
                        <SupplementRow
                          key={i.key}
                          item={i}
                          first={n === 0}
                          onOpen={() => setOpenCategory(g.category)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                {overview.suggestOnSiteVisit && remaining.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      marginTop: 20,
                      padding: 16,
                      borderRadius: 8,
                      border: `1px dashed ${gy.border}`,
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>还剩 {remaining.length} 项，没空一项项找？</span>
                      <span style={{ fontSize: 13, color: gy.secondary }}>请耕云专家到厂一次补齐。留下联系方式，耕云会电话联系您。</span>
                    </div>
                    <Button onClick={() => setBooking(true)}>预约上门</Button>
                  </div>
                )}
              </div>
            </section>
          )}

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
              <span style={{ fontSize: 14, color: gy.secondary }}>提交后如有企业事实变化，请在待补清单中补充或请专家电话联系。无需再次提交同一申请。</span>
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
              <span style={{ fontSize: 14, fontWeight: 500, color: gy.text }}>{task.assignedExpertName} · 注册安全工程师</span>
              <span style={{ fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
                需要补充时{task.assignedExpertName}会直接联系您。有问题可以在待补项点「请专家电话联系」。
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

      <CheckDrawer
        task={task}
        category={opened}
        check={check.data}
        onClose={() => setOpenCategory(null)}
        onBook={() => setBooking(true)}
      />
      <OnSiteDialog taskId={task.id} open={booking} onClose={() => setBooking(false)} />
    </div>
  );
}

function SupplementRow({ item, first, onOpen }: { item: CategoryCheckItem; first: boolean; onOpen: () => void }) {
  const done = item.state === 'done';
  return (
    <li
      data-testid={`supplement-${item.key}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderTop: first ? undefined : `1px solid ${gy.split}`,
        fontSize: 14,
        lineHeight: '22px',
      }}
    >
      <span style={{ width: 16, flexShrink: 0 }}>{done && <CheckOutlined aria-hidden style={{ color: gy.success, fontSize: 12 }} />}</span>
      <span style={{ flex: 1, minWidth: 0, color: done ? gy.secondary : gy.text }}>{item.label}</span>
      {done ? (
        <span style={{ color: gy.success }}>已补</span>
      ) : (
        <>
          {item.state === 'call' && <span style={{ color: source.expert.color }}>待专家联系</span>}
          <button type="button" style={link} aria-label={`补充${item.label}`} onClick={onOpen}>
            去补充
          </button>
        </>
      )}
    </li>
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
  if (submission.isPending) return <Spin style={{ display: 'block', padding: '64px 0' }} />;
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

const panel: CSSProperties = { borderRadius: 8, background: gy.surface, border: `1px solid ${gy.split}` };
const h2: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500, color: gy.text };
const link: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
};

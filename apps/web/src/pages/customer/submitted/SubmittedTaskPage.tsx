import type { IntakeView } from '@genyun/shared';
import { App, Button, Result } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { downloadFile, useIntake } from '../../../api/intake';
import type { Task } from '../../../api/tasks';
import wechatQr from '../../../assets/wechat-qr.svg';
import { GENGYUN_PHONE } from '../../../components/ContactLink';
import { Loading } from '../../../components/ui';
import { gy, type, weight } from '../../../theme/tokens';
import { TitledNotice } from '../prepare/IntakeParts';
import { WithdrawDialog } from './dialogs';
import { materialsIntro, submittedRows, when } from './materialRows';

// 已提交页（12 页 U3、U3b）：新流程的任务提交给专家以后、交付以前。
// 看进度、看这次提交了哪些资料、找客服；专家开始核对之前可以撤回一次（S01）。

const card = {
  background: gy.surface,
  border: `1px solid ${gy.split}`,
  borderRadius: 8,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
} as const;
const cardTitle = { ...type.subtitle, fontWeight: weight.strong, color: gy.text } as const;
const plain = { borderColor: gy.controlLine } as const;

export function SubmittedTaskPage({ task }: { task: Task }) {
  const intake = useIntake(task.id);
  const [withdrawing, setWithdrawing] = useState(false);
  // 点「撤回」时专家刚好开始核对：这次访问里顶部换成红色说明，刷新页面后恢复
  const [clash, setClash] = useState(false);
  const materials = useRef<HTMLElement>(null);

  if (intake.isPending) return <Loading rows={6} />;
  if (intake.isError) {
    return (
      <Result
        status="error"
        title="资料加载失败"
        subTitle={intake.error.message}
        extra={<Button onClick={() => void intake.refetch()}>重新加载</Button>}
      />
    );
  }
  const view = intake.data;
  const submittedAt = view.submission?.submittedAt ?? task.submittedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <nav aria-label="位置" style={{ ...type.body, color: gy.secondary }}>
          <Link to="/customer/tasks" style={{ color: gy.secondary }}>
            任务
          </Link>
          {' / '}
          {task.enterpriseName}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, paddingTop: 8 }}>
          <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{task.name}</h1>
          <Button style={plain} onClick={() => materials.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            查看提交过的资料
          </Button>
        </div>
        <div style={{ ...type.body, color: gy.secondary }}>
          {task.number}
          {submittedAt && ` · ${when(submittedAt)} 提交`}
        </div>
      </div>

      {clash ? (
        <TitledNotice tone="error" title="专家已经开始核对，不能撤回了">
          有要改的地方，请联系客服。
        </TitledNotice>
      ) : (
        <SuccessNotice />
      )}

      <Progress view={view} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <Materials view={view} sectionRef={materials} onWithdraw={() => setWithdrawing(true)} />
        <ContactCard />
      </div>

      <WithdrawDialog
        open={withdrawing}
        taskId={task.id}
        onClose={() => setWithdrawing(false)}
        onExpertStarted={() => setClash(true)}
      />
    </div>
  );
}

function SuccessNotice() {
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 12px 24px', borderRadius: 8, background: gy.successBg }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" fill={gy.success} />
        <path d="m7 12 3 3 7-7" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>已提交，编制期间不需要您操作</div>
        <div style={{ ...type.body, color: gy.secondary }}>
          专家会整理资料并编制。个别内容需要核实时，耕云客服会用企业微信联系您。完成后会通知您。
        </div>
      </div>
    </div>
  );
}

/** 进度三步：准备资料（完成）→ 专家编制（当前）→ 已交付 */
function Progress({ view }: { view: IntakeView }) {
  const s = view.submission;
  return (
    <section aria-label="进度" style={{ ...card, gap: 20 }}>
      <div style={cardTitle}>进度</div>
      <ol style={{ display: 'flex', gap: 24, listStyle: 'none', margin: 0, padding: 0 }}>
        <Step
          mark={
            <Dot bg={gy.success}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3 7.2l2.6 2.6L11 4.4" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Dot>
          }
          name="准备资料"
          desc={s ? `${when(s.submittedAt)} 提交 · ${s.submittedByName}` : '已提交'}
        />
        <Step
          current
          mark={
            <Dot bg={gy.primary}>
              <span style={{ ...type.body, fontWeight: 500, color: '#FFFFFF' }}>2</span>
            </Dot>
          }
          name="专家编制"
          desc={view.expertStarted ? '专家已经开始核对资料' : '已交给专家，等专家开始核对'}
        />
        <Step
          mark={
            <Dot border>
              <span style={{ ...type.body, color: gy.tertiary }}>3</span>
            </Dot>
          }
          name="已交付"
          muted
          desc="完成后会通知您，在「成果文档」下载"
        />
      </ol>
    </section>
  );
}

function Dot({ bg, border, children }: { bg?: string; border?: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        border: border ? `1px solid ${gy.border}` : undefined,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </span>
  );
}

function Step({
  mark,
  name,
  desc,
  current,
  muted,
}: {
  mark: ReactNode;
  name: string;
  desc: string;
  current?: boolean;
  muted?: boolean;
}) {
  return (
    <li aria-current={current ? 'step' : undefined} style={{ flex: '1 1 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {mark}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...type.subtitle, fontWeight: weight.strong, color: muted ? gy.secondary : gy.text }}>{name}</span>
        <span style={{ ...type.body, color: gy.secondary }}>{desc}</span>
      </div>
    </li>
  );
}

function Materials({
  view,
  sectionRef,
  onWithdraw,
}: {
  view: IntakeView;
  sectionRef: React.RefObject<HTMLElement | null>;
  onWithdraw: () => void;
}) {
  const { message } = App.useApp();
  const intro = materialsIntro(view);
  const download = (fileId: string) =>
    void downloadFile(fileId).catch((err: unknown) => message.error(err instanceof Error ? err.message : '下载没有成功，请再试一次'));

  return (
    <section ref={sectionRef} aria-label="本次提交的资料" style={{ ...card, flex: '1 1 0', minWidth: 0, scrollMarginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 16 }}>
        <div style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={cardTitle}>本次提交的资料</div>
          <div style={{ ...type.body, color: gy.secondary }}>{intro.text}</div>
        </div>
        {intro.withdraw && (
          <Button style={{ ...plain, flexShrink: 0 }} onClick={onWithdraw}>
            撤回修改
          </Button>
        )}
      </div>
      {submittedRows(view).map((r) => (
        <div
          key={r.key}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${gy.split}` }}
        >
          <span style={{ flex: '1 1 0', minWidth: 0, ...type.body, color: gy.text }}>{r.name}</span>
          <span style={{ ...type.body, color: r.warn ? gy.warning : gy.secondary }}>{r.note}</span>
          {r.fileId && (
            <Button
              type="link"
              style={{ padding: 0, height: 22, ...type.body }}
              aria-label={`下载 ${r.name}`}
              onClick={() => download(r.fileId!)}
            >
              下载
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

function ContactCard() {
  return (
    <aside aria-label="有事找客服" style={{ ...card, gap: 12, width: 320, flexShrink: 0 }}>
      <div style={cardTitle}>有事找客服</div>
      <div style={{ ...type.body, color: gy.secondary }}>填错了要改、有问题要问，都找耕云客服。</div>
      <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
        <img src={wechatQr} alt="耕云客服企业微信二维码" width={120} height={120} style={{ display: 'block', borderRadius: 8 }} />
        <figcaption style={{ ...type.caption, color: gy.tertiary, textAlign: 'center' }}>企业微信二维码</figcaption>
      </figure>
      <div style={{ ...type.body, color: gy.secondary }}>工作日 9:00–18:00 · {GENGYUN_PHONE}</div>
    </aside>
  );
}

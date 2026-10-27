import type { ReviewStepSummary } from '@genyun/shared';
import { App, Button, Checkbox, Result, Spin } from 'antd';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTaskReview, type Task } from '../../../api/tasks';
import { gy } from '../../../theme/tokens';
import { OnSiteBanner, OnSiteDialog } from '../OnSiteVisit';
import { FILL_STEPS, FillCard, FillFrame, SecureNote, StepTitle } from './FillFrame';

const muted = '#3F4A5C';
const rowLine = '1px solid #EEF0F3';

const AFTER_SUBMIT = [
  { title: '耕云编制初稿', text: '危险源辨识、风险评估、法规匹配', dot: gy.primary },
  { title: '注册安全工程师审核', text: '核实待定项，需要时由负责专家联系您', dot: gy.primary },
  { title: '发布成果', text: '审核完成后发布，任务页和邮件会通知您', dot: '#EDC147' },
  { title: '下载全套文档', text: '预案、风险评估、资源调查 Word', dot: gy.success },
];

// S05 企业自填第 5 步「核对并提交」：前 4 步的概括、还缺的必需资料、专家判断与稍后补、预约上门。
// 「提交给耕云」的提交流程（确认资料版本、提交中、结果未知先查询）在第 12 项接上
export function ReviewStepPage({ task }: { task: Task }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const data = useTaskReview(task.id);
  const [agreed, setAgreed] = useState(true);
  const [booking, setBooking] = useState(false);
  const exit = () => navigate(`/customer/enterprises/${task.enterpriseId}`);

  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>已含在您的合同内，提交、审核、下载不另收费</span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button size="large" onClick={() => navigate(`/customer/tasks/${task.id}/fill/4`)}>
          上一步
        </Button>
        <Button
          size="large"
          type="primary"
          style={{ fontWeight: 600 }}
          disabled={!data.data?.review.canSubmit || !agreed}
          onClick={() => message.info('资料已核对完毕，提交功能即将开放；填写的内容都已保存。')}
        >
          提交给耕云
        </Button>
      </div>
    </>
  );

  if (data.isPending || data.isError) {
    return (
      <FillFrame step={5} enterpriseName={task.enterpriseName} saveState="idle" onExit={exit} footer={footer}>
        {data.isPending ? (
          <Spin style={{ flex: 1, padding: '96px 0' }} />
        ) : (
          <Result status="error" title="核对内容加载失败" subTitle={data.error.message} style={{ flex: 1 }} />
        )}
      </FillFrame>
    );
  }

  const { review, contract, onSiteRequest } = data.data;
  const later = review.steps.flatMap((s) => s.later);
  const missingCount = review.steps.reduce((n, s) => n + s.missing.length, 0);

  return (
    <FillFrame step={5} enterpriseName={task.enterpriseName} saveState="idle" onExit={exit} footer={footer}>
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title={review.canSubmit ? '核对一下，就可以交给耕云了' : `还差 ${missingCount} 项必需资料`}
          description={
            review.canSubmit
              ? '必需的资料已齐，可以提交。「稍后补」的项不影响提交，审核时会提醒您；专业判断由注册安全工程师完成。'
              : '下面标出了缺的资料，点「去补充」回到对应的一步。「稍后补」的项不影响提交。'
          }
        />

        <section
          aria-label="填写概览"
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '8px 24px',
            borderRadius: 8,
            background: gy.surface,
            border: `1px solid ${gy.split}`,
          }}
        >
          {review.steps.map((s, i) => (
            <StepRow
              key={s.step}
              summary={s}
              last={i === review.steps.length - 1}
              onEdit={() => navigate(`/customer/tasks/${task.id}/fill/${s.step}`)}
            />
          ))}
        </section>

        {(review.expert.length > 0 || later.length > 0) && (
          <div style={{ display: 'flex', gap: 16 }}>
            {review.expert.length > 0 && (
              <ListCard
                label="耕云专家判断"
                title={`耕云专家判断 · ${review.expert.length} 项`}
                hint="专业判断包含在服务内，您不用再管"
                items={review.expert}
                tone={{ bg: '#F3F1FC', border: '#D8D2F2' }}
              />
            )}
            {later.length > 0 && (
              <ListCard
                label="稍后补"
                title={`稍后补 · ${later.length} 项`}
                hint="提交后在任务页随时补，会提醒您"
                items={review.steps.filter((s) => s.later.length > 0).map((s) => s.later.join('、'))}
                tone={{ bg: gy.canvas, border: gy.split }}
              />
            )}
          </div>
        )}

        {review.suggestOnSiteVisit && (
          <OnSiteBanner
            title={`有 ${later.length} 项要稍后补，自己整理比较费时间`}
            description="可以先提交，也可以请耕云专家到厂一次补齐。留下联系方式，耕云会电话联系您。"
            submittedAt={onSiteRequest?.createdAt}
            onBook={() => setBooking(true)}
          />
        )}

        <FillCard title="提交以后会发生什么" gap={20}>
          <ol style={{ display: 'flex', margin: 0, padding: 0, listStyle: 'none' }}>
            {AFTER_SUBMIT.map((a, i) => (
              <li key={a.title} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ width: 12, height: 12, flexShrink: 0, borderRadius: 6, background: a.dot }} />
                  {i < AFTER_SUBMIT.length - 1 && <span style={{ flex: 1, height: 2, background: '#C9D7F6' }} />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
                  <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{a.title}</span>
                  <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{a.text}</span>
                </div>
              </li>
            ))}
          </ol>
          <div style={{ height: 1, background: '#EEF0F3' }} />
          <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)}>
            <span style={{ fontSize: 14, lineHeight: '22px', color: muted }}>
              以上信息据实填写；如审核中需要补充，我同意耕云通过上面填写的电话联系我。
            </span>
          </Checkbox>
        </FillCard>
      </div>

      <aside style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SideCard heading="服务范围" tone="tinted">
          <p style={sideText}>
            本次编制已含在您的合同内{contract.endsAt ? `（${contract.endsAt.replaceAll('-', '.')} 前有效）` : ''}
            。提交、审核、下载都不另收费。
          </p>
          <p style={sideText}>合同与发票问题请联系耕云商务。</p>
        </SideCard>
        <SideCard heading="拿不准？先问问我们" tone="plain">
          <p style={sideText}>提交后由负责专家审核，有疑问会在任务里问您，或直接打电话。</p>
          {onSiteRequest ? (
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.success }}>已提交上门需求，耕云会电话联系您</span>
          ) : (
            <button type="button" style={link} onClick={() => setBooking(true)}>
              资料太多整理不过来？预约专家上门
            </button>
          )}
        </SideCard>
        <SecureNote />
      </aside>

      <OnSiteDialog taskId={task.id} open={booking} onClose={() => setBooking(false)} />
    </FillFrame>
  );
}

function StepRow({ summary: s, last, onEdit }: { summary: ReviewStepSummary; last: boolean; onEdit: () => void }) {
  const ok = s.missing.length === 0;
  const title = FILL_STEPS[s.step - 1]!.title;
  return (
    <div
      data-testid={`review-step-${s.step}`}
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: last ? undefined : rowLine }}
    >
      <span
        aria-label={ok ? '已填好' : '还缺必需资料'}
        style={{
          width: 24,
          height: 24,
          flexShrink: 0,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ok ? '#E8F5EE' : gy.warningBg,
        }}
      >
        {ok ? (
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.5 7.5L5.5 10.5L11.5 3.5"
              fill="none"
              stroke={gy.success}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: gy.warning }}>!</span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
          {s.facts.length > 0 ? s.facts.join(' · ') : '还没填写'}
        </span>
        {!ok && (
          <span style={{ fontSize: 13, lineHeight: '20px', color: gy.warning }}>还缺：{s.missing.join('、')}</span>
        )}
      </div>
      {s.later.length > 0 && (
        <span
          style={{
            flexShrink: 0,
            padding: '0 8px',
            borderRadius: 4,
            background: gy.neutralBg,
            fontSize: 12,
            lineHeight: '20px',
            color: gy.secondary,
          }}
        >
          {s.later.length} 项稍后补
        </span>
      )}
      <button type="button" aria-label={`修改${title}`} style={{ ...link, flexShrink: 0 }} onClick={onEdit}>
        {ok ? '修改' : '去补充'}
      </button>
    </div>
  );
}

function ListCard({
  label,
  title,
  hint,
  items,
  tone,
}: {
  label: string;
  title: string;
  hint: string;
  items: string[];
  tone: { bg: string; border: string };
}) {
  return (
    <section
      aria-label={label}
      style={{
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 20,
        borderRadius: 8,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: gy.text }}>{title}</h2>
      <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>{hint}</span>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <li key={item} style={{ fontSize: 13, lineHeight: '20px', color: muted }}>
            · {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SideCard({ heading, tone, children }: { heading: string; tone: 'tinted' | 'plain'; children: ReactNode }) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tone === 'tinted' ? 12 : 8,
        padding: 20,
        borderRadius: 8,
        background: tone === 'tinted' ? '#EEF2F7' : gy.surface,
        border: tone === 'tinted' ? undefined : `1px solid ${gy.split}`,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: gy.text }}>{heading}</h2>
      {children}
    </section>
  );
}

const sideText = { margin: 0, fontSize: 13, lineHeight: '21px', color: muted } as const;
const link = {
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 14,
  lineHeight: '22px',
  color: gy.primary,
} as const;

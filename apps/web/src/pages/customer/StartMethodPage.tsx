import type { StartMethod } from '@genyun/shared';
import { App, Button, Result, Spin } from 'antd';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/request';
import { useTask, useUpdateTask } from '../../api/tasks';
import { useSession } from '../../auth/session';
import { WizardHeader } from '../../components/WizardHeader';
import { gy } from '../../theme/tokens';
import { OnSiteBanner, OnSiteDialog } from './OnSiteVisit';

const STEPS = ['企业基本信息', '人员与应急组织', '生产情况：场所、设备、物料、工艺', '应急资源与图纸', '核对并提交'];
const UPLOAD_EXAMPLES = [
  '旧版应急预案、安全评价报告',
  '组织架构、通讯录、设备与物料台账',
  'Word、Excel、PDF、照片都可以',
];
const FOOTNOTES = ['先签约付款，再开通使用', '依据 GB/T 29639-2020 编制', '资料加密存储'];

const muted = '#3F4A5C';

// S00 选择开始方式：全屏页，不带侧栏。两种方式写入同一份资料清单；资料不齐的可以先预约耕云上门。
export function StartMethodPage() {
  const { taskId = '' } = useParams();
  const session = useSession();
  const task = useTask(taskId);
  const update = useUpdateTask(taskId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [booking, setBooking] = useState(false);

  if (session.isPending) return <Spin fullscreen />;
  if (!session.data) return <Navigate to="/login" replace />;

  const choose = (startMethod: StartMethod) =>
    update.mutate(
      { startMethod },
      {
        // 按提示填写直接进第 1 步；上传已有资料进任务页上传
        onSuccess: () => navigate(startMethod === 'self_fill' ? `/customer/tasks/${taskId}/fill/1` : `/customer/tasks/${taskId}`),
        onError: (err) => message.error(err.message),
      },
    );

  let body: ReactNode;
  if (task.isPending) {
    body = <Spin style={{ padding: '96px 0' }} />;
  } else if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    body = (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? '找不到该任务' : '任务加载失败'}
        subTitle={notFound ? '任务可能不在您的机构下，或您没有查看权限。' : task.error.message}
        extra={<Link to="/customer">返回工作台</Link>}
      />
    );
  } else {
    const pending = update.isPending ? update.variables?.startMethod : undefined;
    body = (
      <>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              lineHeight: '38px',
              fontWeight: 600,
              color: gy.text,
            }}
          >
            您想怎么开始？
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: '24px',
              color: gy.secondary,
            }}
          >
            无论哪种方式，最后都由注册安全工程师审核，交付的文档一样。
          </p>
        </div>

        <div style={{ display: 'flex', gap: 24, width: 960 }}>
          <MethodCard
            recommended
            icon={
              <path
                d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8.5 13h7M8.5 16.5h4.5"
                stroke={gy.primary}
              />
            }
            title="按提示填写"
            description="5 步，只问您知道的。拍营业执照自动识别，工艺流程和组织图自动画，专业判断交给耕云。"
            list={
              <ol style={{ ...listStyle, listStyle: 'none' }}>
                {STEPS.map((s, i) => (
                  <li key={s} style={listItem}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        flexShrink: 0,
                        borderRadius: 11,
                        background: '#F1F3F6',
                        color: gy.secondary,
                        fontSize: 12,
                        lineHeight: '22px',
                        textAlign: 'center',
                      }}
                    >
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            }
            action={
              <Button
                type="primary"
                block
                style={buttonStyle}
                loading={pending === 'self_fill'}
                disabled={update.isPending}
                onClick={() => choose('self_fill')}
              >
                开始填写
              </Button>
            }
            footnote="可分次填写，自动保存"
          />
          <MethodCard
            icon={<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke={muted} />}
            title="上传已有资料"
            description="手上有旧预案、安评报告或各类台账？直接上传，专家帮您整理。"
            list={
              <ul style={{ ...listStyle, listStyle: 'none' }}>
                {UPLOAD_EXAMPLES.map((s) => (
                  <li key={s} style={listItem}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        flexShrink: 0,
                        borderRadius: 3,
                        background: '#8A93A3',
                      }}
                    />
                    {s}
                  </li>
                ))}
              </ul>
            }
            action={
              <Button
                block
                style={{ ...buttonStyle, borderColor: '#D9D9D9' }}
                loading={pending === 'upload'}
                disabled={update.isPending}
                onClick={() => choose('upload')}
              >
                上传资料
              </Button>
            }
            footnote="专家整理后，缺什么会告诉您"
          />
        </div>

        <div style={{ width: 960 }}>
          <OnSiteBanner
            title="资料不齐、没人手整理？请耕云专家上门"
            description="注册安全工程师到厂查看并整理图纸、设备参数和化学品资料。留下联系方式即可，耕云会电话联系您商定。"
            onBook={() => setBooking(true)}
          />
        </div>
        <OnSiteDialog taskId={taskId} open={booking} onClose={() => setBooking(false)} withLaterItems={false} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {FOOTNOTES.map((f, i) => (
            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              {i > 0 && <span style={{ width: 1, height: 12, background: '#D9DDE3' }} />}
              <span style={{ fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{f}</span>
            </span>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: gy.surface,
      }}
    >
      <WizardHeader
        enterpriseName={task.data?.enterpriseName}
        extra={<Button onClick={() => navigate('/customer')}>返回工作台</Button>}
      />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 40,
          padding: '64px 0 48px',
        }}
      >
        {body}
      </main>
    </div>
  );
}

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const listItem: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 14,
  lineHeight: '22px',
  color: muted,
};
const buttonStyle: CSSProperties = {
  height: 44,
  fontSize: 15,
  fontWeight: 500,
};

function MethodCard({
  recommended,
  icon,
  title,
  description,
  list,
  action,
  footnote,
}: {
  recommended?: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  list: ReactNode;
  action: ReactNode;
  footnote: string;
}) {
  return (
    <section
      aria-label={title}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: 32,
        borderRadius: 12,
        background: gy.surface,
        border: recommended ? `2px solid ${gy.primary}` : `1px solid ${gy.split}`,
        boxShadow: recommended ? '0 8px 24px #245BDB1A' : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: recommended ? '#EEF3FD' : '#F1F3F6',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {icon}
          </svg>
        </span>
        {recommended && (
          <span
            style={{
              padding: '0 8px',
              borderRadius: 4,
              background: '#EEF3FD',
              color: gy.primary,
              fontSize: 12,
              lineHeight: '20px',
            }}
          >
            推荐 · 适合大多数企业
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            lineHeight: '28px',
            fontWeight: 600,
            color: gy.text,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: '22px',
            color: gy.secondary,
          }}
        >
          {description}
        </p>
      </div>
      {list}
      <div style={{ flex: 1 }} />
      {action}
      <div
        style={{
          fontSize: 12,
          lineHeight: '20px',
          color: gy.tertiary,
          textAlign: 'center',
        }}
      >
        {footnote}
      </div>
    </section>
  );
}

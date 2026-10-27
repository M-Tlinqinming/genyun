import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import { Button, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { WizardHeader } from '../../../components/WizardHeader';
import { gy } from '../../../theme/tokens';
import type { SaveState } from './useAutosave';

export const FILL_STEPS = [
  { title: '企业基本信息', hint: '营业执照上有的' },
  { title: '人员与应急组织', hint: '谁负责、怎么联系' },
  { title: '生产情况', hint: '场所、设备、物料、工艺' },
  { title: '应急资源与图纸', hint: '物资、药箱、图纸' },
  { title: '核对并提交', hint: '交给耕云' },
] as const;

const WIDTH = 1112;

// 企业自填 5 步共用的框架（12 页 S01–S05）：顶栏（保存状态、保存并退出）、步骤条、底部操作栏
export function FillFrame({
  step,
  enterpriseName,
  saveState,
  savedAt,
  onExit,
  exiting,
  footer,
  children,
}: {
  step: number;
  enterpriseName?: string;
  saveState: SaveState;
  savedAt?: Date;
  onExit: () => void;
  exiting?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    // 设计稿的输入框高 36
    <ConfigProvider theme={{ token: { controlHeight: 36 } }}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: gy.canvas }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <WizardHeader
            enterpriseName={enterpriseName}
            extra={
              <>
                <SaveStatus state={saveState} savedAt={savedAt} />
                <Button onClick={onExit} loading={exiting}>
                  保存并退出
                </Button>
              </>
            }
          />
        </div>
        <Stepper current={step} />
        <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '24px 0 32px' }}>
          <div style={{ width: WIDTH, display: 'flex', alignItems: 'flex-start', gap: 32 }}>{children}</div>
        </main>
        <footer
          style={{
            position: 'sticky',
            bottom: 0,
            // 选中的单选按钮自带层级，底栏要盖住它
            zIndex: 10,
            height: 72,
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'center',
            background: gy.surface,
            borderTop: `1px solid ${gy.split}`,
          }}
        >
          <div style={{ width: WIDTH, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {footer}
          </div>
        </footer>
      </div>
    </ConfigProvider>
  );
}

function SaveStatus({ state, savedAt }: { state: SaveState; savedAt?: Date }) {
  const time = savedAt?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
  let content: ReactNode = null;
  if (state === 'saving' || state === 'pending') {
    content = (
      <span style={{ color: gy.tertiary }}>
        <LoadingOutlined style={{ marginRight: 6 }} />
        正在保存…
      </span>
    );
  } else if (state === 'error') {
    content = <span style={{ color: gy.error }}>保存失败，稍后自动重试</span>;
  } else if (savedAt) {
    content = (
      <span style={{ color: gy.success }}>
        <CheckOutlined style={{ marginRight: 6 }} />
        已自动保存 {time}
      </span>
    );
  }
  return (
    <span role="status" style={{ fontSize: 14, lineHeight: '22px' }}>
      {content}
    </span>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="填写步骤" style={{ display: 'flex', justifyContent: 'center', padding: '28px 0 8px' }}>
      <ol
        style={{
          width: WIDTH,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {FILL_STEPS.map((s, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return (
            <li key={s.title} style={{ display: 'contents' }}>
              {i > 0 && <span style={{ flex: 1, height: 1, background: done || active ? gy.primary : '#D9DDE3' }} />}
              <span
                aria-current={active ? 'step' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: active ? 500 : 400,
                    background: active ? gy.primary : done ? gy.selected : undefined,
                    color: active ? '#FFFFFF' : done ? gy.primary : gy.tertiary,
                    border: active || done ? undefined : '1px solid #C4C9D2',
                  }}
                >
                  {n}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span
                    style={{
                      fontSize: 14,
                      lineHeight: '22px',
                      fontWeight: active ? 500 : 400,
                      color: active ? gy.text : gy.secondary,
                    }}
                  >
                    {s.title}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: '18px', color: '#8A93A3' }}>{s.hint}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// 页标题：24 号标题 + 一句说明
export function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h1 style={{ margin: 0, fontSize: 24, lineHeight: '32px', fontWeight: 600, color: gy.text }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>{description}</p>
    </div>
  );
}

// 表单列里的白色卡片
export function FillCard({
  title,
  extra,
  children,
  gap = 16,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        padding: 24,
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      {(title || extra) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>{title}</h2>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

// 右侧说明栏（top 放在最上面，如第 2 步的组织体系图 / 为什么问这些 / 您填完以后 / 加密存储）
export function SidePanel({ why, after, top }: { why: string[]; after: string[]; top?: ReactNode }) {
  const text = { fontSize: 13, lineHeight: '21px', color: '#3F4A5C', margin: 0 } as const;
  const heading = { margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: gy.text } as const;
  return (
    <aside style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {top}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          borderRadius: 8,
          background: '#EEF2F7',
        }}
      >
        <h2 style={heading}>为什么问这些</h2>
        {why.map((w) => (
          <p key={w} style={text}>
            {w}
          </p>
        ))}
      </section>
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          borderRadius: 8,
          background: gy.surface,
          border: `1px solid ${gy.split}`,
        }}
      >
        <h2 style={heading}>您填完以后</h2>
        {after.map((a) => (
          <div key={a} style={{ display: 'flex', gap: 10 }}>
            <span
              style={{ width: 6, height: 6, flexShrink: 0, marginTop: 8, borderRadius: 3, background: gy.primary }}
            />
            <p style={text}>{a}</p>
          </div>
        ))}
      </section>
      <div style={{ display: 'flex', gap: 10, padding: '0 4px', fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
          <rect x="2.5" y="6" width="9" height="6" rx="1" fill="none" stroke={gy.tertiary} strokeWidth="1.3" />
          <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke={gy.tertiary} strokeWidth="1.3" />
        </svg>
        企业资料加密存储，仅用于生成您的文档。
      </div>
    </aside>
  );
}

export const AFTER_FILLING = [
  'AI 根据行业与场所辨识危险源、匹配法规',
  '注册安全工程师逐项审核，并完成危化品、特种设备等专业判断',
  '已含在合同内，审核完成后直接下载 Word',
];

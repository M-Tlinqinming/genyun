import { LockOutlined } from '@ant-design/icons';
import type { CSSProperties, ReactNode } from 'react';
import { SourceTag } from '../../../../components/SourceTag';
import { linkButton } from '../../../../components/ui';
import { gy, type, weight } from '../../../../theme/tokens';

// 资料核对向导各步共用的小块：卡片、带来源标签的字段、来源图例、右栏卡片

export const MAIN_WIDTH = 728;
export const SIDE_WIDTH = 320;

export const caption: CSSProperties = { ...type.caption, color: gy.tertiary };
export const body: CSSProperties = { ...type.body, color: gy.text };
export const link14: CSSProperties = { ...linkButton, ...type.body };
// 输入框描边（设计稿 #D9D9D9，与 antd 默认一致）
export const inputLine = '#D9D9D9';
// 浅底块里的分隔线与描边
export const softLine = '#EEF0F3';

/** 字段的来源：客户表格（或客户填写）、您已修改、系统带出、待您补充 */
export type FieldSource = 'customer' | 'expert' | 'system' | 'missing' | null;

export function FieldTag({ source, customerText }: { source: FieldSource; customerText: string }) {
  if (source === 'customer') return <SourceTag kind="customer" text={customerText} />;
  if (source === 'expert') return <SourceTag kind="expert" text="您已修改" />;
  if (source === 'system') return <SourceTag kind="system" text="系统带出" />;
  if (source === 'missing') return <MissingTag />;
  return null;
}

export function MissingTag({ text = '待您补充' }: { text?: string }) {
  return (
    <span
      data-source="missing"
      style={{ display: 'inline-block', padding: '0 6px', borderRadius: 4, ...type.caption, whiteSpace: 'nowrap', color: gy.warning, background: gy.warningBg }}
    >
      {text}
    </span>
  );
}

/** 页面标题、说明和来源图例 */
export function StepTitle({ title, sub, customerText }: { title: string; sub: ReactNode; customerText: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h1 style={{ margin: 0, ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>{title}</h1>
      <span style={{ ...type.body, color: gy.secondary }}>{sub}</span>
      <div aria-label="来源图例" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
        <span style={caption}>来源</span>
        <SourceTag kind="customer" text={customerText} />
        <SourceTag kind="system" text="系统带出" />
        <SourceTag kind="expert" text="您已修改" />
        <MissingTag />
      </div>
    </div>
  );
}

/** 白底卡片：标题行（可带标签与右侧操作）+ 内容 */
export function Card({
  title,
  tag,
  extra,
  hint,
  gap = 20,
  padding = 24,
  label,
  style,
  children,
}: {
  title: ReactNode;
  tag?: ReactNode;
  extra?: ReactNode;
  hint?: ReactNode;
  gap?: number;
  padding?: number | string;
  label?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      style={{ display: 'flex', flexDirection: 'column', gap, padding, background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, ...style }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{title}</h2>
          {tag}
          <span style={{ flex: 1 }} />
          {extra}
        </div>
        {hint && <span style={{ ...type.body, color: gy.secondary }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 一个字段：标签 + 来源标签一行，下面是输入框，再下面是说明或错误 */
export function Field({
  label,
  tag,
  hint,
  error,
  extra,
  aside,
  flex = 1,
  children,
}: {
  label: ReactNode;
  tag?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  extra?: ReactNode;
  /** 输入框右侧（如「先留空」勾选框） */
  aside?: ReactNode;
  flex?: number | string;
  children: ReactNode;
}) {
  return (
    <div data-field={typeof label === 'string' ? label : undefined} style={{ flex, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        <span style={{ ...type.body, color: gy.text }}>{label}</span>
        {tag}
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      {aside ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          <div style={{ flexShrink: 0 }}>{aside}</div>
        </div>
      ) : (
        children
      )}
      {error ? (
        <span role="alert" style={{ ...type.caption, color: gy.error }}>
          {error}
        </span>
      ) : (
        hint && <span style={caption}>{hint}</span>
      )}
    </div>
  );
}

export function Row({ children, gap = 24 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>{children}</div>;
}

/** 右栏卡片 */
export function SideCard({ title, tag, extra, children, label }: { title: ReactNode; tag?: ReactNode; extra?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20, background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, ...type.body, fontWeight: weight.strong, color: gy.text }}>{title}</h2>
        {tag}
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 「这一步用在哪里」 */
export function UseCard({ lines }: { lines: string[] }) {
  return (
    <SideCard title="这一步用在哪里">
      {lines.map((l) => (
        <p key={l} style={{ margin: 0, ...type.body, color: gy.secondary }}>
          {l}
        </p>
      ))}
    </SideCard>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: gy.avatarBg, ...type.caption, color: gy.secondary }}>{children}</span>;
}

export function LockNote({ text = '客户原表不会被改动，您的修改单独记录。' }: { text?: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...caption }}>
      <LockOutlined aria-hidden />
      {text}
    </span>
  );
}

/** 浅底信息块（执照上的其他信息、属地部门） */
export function InfoBox({
  title,
  tag,
  extra,
  children,
  background = gy.canvas,
  radius = 6,
}: {
  title: ReactNode;
  tag?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  background?: string;
  radius?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: radius, background }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{title}</span>
        {tag}
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </div>
  );
}

export function InfoItem({ label, value, flex = 1 }: { label: string; value: ReactNode; flex?: number }) {
  return (
    <div style={{ flex, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={caption}>{label}</span>
      <span style={{ ...body, overflowWrap: 'anywhere' }}>{value || <span style={{ color: gy.tertiary }}>—</span>}</span>
    </div>
  );
}

// 「11 月 16 日」「11 月 16 日 10:40」
export function dayOf(iso: string, withTime = false): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} 月 ${get('day')} 日${withTime ? ` ${get('hour')}:${get('minute')}` : ''}`;
}

export function clockOf(d: Date | string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}

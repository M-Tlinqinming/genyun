import type { CSSProperties } from 'react';
import { gy } from '../../../theme/tokens';

// 成果文档三个页面共用的小件：发布时间写法、Word 图标、文字按钮

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, ...opts }).formatToParts(new Date(iso));

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';

/** 2026.09.29 10:50（北京时间） */
export function stampFull(iso: string): string {
  const p = fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${part(p, 'year')}.${part(p, 'month')}.${part(p, 'day')} ${part(p, 'hour')}:${part(p, 'minute')}`;
}

/** 09.29 10:50（北京时间） */
export function stampShort(iso: string): string {
  const p = fmt(iso, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${part(p, 'month')}.${part(p, 'day')} ${part(p, 'hour')}:${part(p, 'minute')}`;
}

export const versionText = (version: number) => `V${version}`;

/** 按 ?v= 取交付版本；不写就是最新。写了但没有这一版时退回最新，并给出提示文字 */
export function pickVersion<T extends { version: number }>(versions: T[], raw: string | null): { current: T | undefined; missing: string | null } {
  const latest = versions[0];
  if (raw === null || raw === '') return { current: latest, missing: null };
  const found = /^\d+$/.test(raw) ? versions.find((v) => v.version === Number(raw)) : undefined;
  if (found) return { current: found, missing: null };
  const label = /^\d{1,6}$/.test(raw) ? `交付 V${Number(raw)}` : '这个交付版本';
  return { current: latest, missing: `没有找到${label}，已为您显示最新版本` };
}

/** 指定的版本不存在时的提示条 */
export function MissingVersion({ text }: { text: string }) {
  return (
    <div role="status" style={{ padding: '10px 16px', borderRadius: 6, background: gy.warningBg, color: gy.text, fontSize: 14, lineHeight: '22px' }}>
      {text}
    </div>
  );
}

// Word 文件图标（设计稿 C06 的 20×20 线框图标）
export function WordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke={gy.primary} strokeWidth="1.2" />
      <path d="M11.5 2.5V6.5H15.5" fill="none" stroke={gy.primary} strokeWidth="1.2" />
      <path d="M7 10l1 4 1.5-3 1.5 3 1-4" fill="none" stroke={gy.primary} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const text14: CSSProperties = { fontSize: 14, lineHeight: '22px' };

// 蓝色文字按钮（在线阅读、下载）
export const textLink: CSSProperties = {
  ...text14,
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: gy.primary,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};

export const textLinkDisabled: CSSProperties = { ...textLink, cursor: 'not-allowed', color: gy.tertiary };

export const card: CSSProperties = {
  background: gy.surface,
  border: `1px solid ${gy.split}`,
  borderRadius: 8,
};

export const NOT_READABLE = '这份暂时不能在线阅读，请下载 Word 查看';

import type { TaskDeliveries } from '@genyun/shared';
import type { CSSProperties } from 'react';
import { gy } from '../../../theme/tokens';

// 成果文档两个页面共用的小件：发布时间写法、Word 图标、文字按钮

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

// 蓝色文字按钮（下载）
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

export const card: CSSProperties = {
  background: gy.surface,
  border: `1px solid ${gy.split}`,
  borderRadius: 8,
};


// 成果锁住（编制次数用完或年度服务到期，等续约）时的文字。次数、续约这些字只给管理员看
export type DeliveryLock = NonNullable<TaskDeliveries['lock']>;

export function lockText(lock: DeliveryLock, isAdmin: boolean) {
  return isAdmin
    ? {
        tag: '已编制好 · 续约后可下载',
        line: '三份文档都在，续约后自动放开，算 1 次',
        title: lock.reason === 'expired' ? '年度服务已到期，续约后就能下载' : '编制次数已经用完，续约后就能下载',
        body: '续约后这份成果自动放开，算 1 次，不用重新提交资料。',
      }
    : {
        tag: '已编制好 · 暂不能下载',
        line: `需要贵组织管理员处理，请联系${lock.adminNames}`,
        title: '需要组织管理员处理后才能下载',
        body: `请联系${lock.adminNames}，处理好后这里自动放开，不用重新提交资料。`,
      };
}

// 锁住时下载按钮置灰（设计稿 U4b / U4c 的灰色按钮）
export const textLinkDisabled: CSSProperties = { ...textLink, color: gy.tertiary, cursor: 'not-allowed' };

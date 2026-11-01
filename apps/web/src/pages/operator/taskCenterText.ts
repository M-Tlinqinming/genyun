import { chinaToday, type BusinessType } from '@genyun/shared';
import type { OperatorTask } from '../../api/operator';

// 运营任务中心里的短业务名（Paper I04：「编制应急预案」）
const SHORT_BUSINESS: Record<BusinessType, string> = { emergency_plan: '编制应急预案' };

export const businessShort = (t: Pick<OperatorTask, 'businessType'>) => SHORT_BUSINESS[t.businessType];

// 「示例化工有限公司 · 编制应急预案」
export const taskTitle = (t: Pick<OperatorTask, 'enterpriseName' | 'businessType'>) => `${t.enterpriseName} · ${businessShort(t)}`;

// 10.23
export const monthDay = (iso: string) => chinaToday(new Date(iso)).slice(5).replace('-', '.');

// 10.23 09:15（北京时间）
export function monthDayTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${monthDay(iso)} ${time}`;
}

export const submittedLine = (t: Pick<OperatorTask, 'submittedAt'>) => (t.submittedAt ? `${monthDay(t.submittedAt)} 提交资料` : null);

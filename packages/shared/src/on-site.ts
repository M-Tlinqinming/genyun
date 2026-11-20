// 预约耕云上门（已下线）：客户入口和运营上门工单都已拆掉，数据表保留，这里只留表结构要用的取值
export const CALL_TIMES = { weekday_morning: '工作日上午', weekday_afternoon: '工作日下午', anytime: '随时' } as const;
export type CallTime = keyof typeof CALL_TIMES;

// new = 新工单；handed_over = 已转交公司；closed = 已关闭
export const ON_SITE_STATUSES = ['new', 'handed_over', 'closed'] as const;
export type OnSiteStatus = (typeof ON_SITE_STATUSES)[number];

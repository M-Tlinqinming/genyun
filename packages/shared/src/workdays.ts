// 工作日：跳过周末和法定节假日，调休上班的周末算工作日。时间都按北京时间的日期算。
//
// 节假日先内置 2026 年的国务院放假安排（M3 第 4 项）。运营维护节假日日历是 M3 第 5 项知识库，做好后换成从数据库读。
// 表里没有的年份只跳过周末。2026 年安排按国办发明电〔2025〕7 号整理，需对照原文核实。

// 放假的日子（含落在周末的）
const HOLIDAYS: ReadonlySet<string> = new Set([
  // 元旦
  '2026-01-01', '2026-01-02', '2026-01-03',
  // 春节
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  // 清明节
  '2026-04-04', '2026-04-05', '2026-04-06',
  // 劳动节
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  // 端午节
  '2026-06-19', '2026-06-20', '2026-06-21',
  // 中秋节
  '2026-09-25', '2026-09-26', '2026-09-27',
  // 国庆节
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]);

// 调休上班的周末
const ADJUSTED_WORKDAYS: ReadonlySet<string> = new Set([
  '2026-01-04',
  '2026-02-14',
  '2026-02-28',
  '2026-05-09',
  '2026-09-20',
  '2026-10-10',
]);

// 内置了节假日表的年份；之外的年份只跳过周末
export const HOLIDAY_YEARS: readonly number[] = [2026];

const CHINA_OFFSET = 8 * 3_600_000;
const DAY = 86_400_000;

// 北京时间的第几天（从 1970-01-01 起）
const chinaDay = (d: Date) => Math.floor((d.getTime() + CHINA_OFFSET) / DAY);
const dayKey = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

function isWorkdayNumber(day: number): boolean {
  const key = dayKey(day);
  if (ADJUSTED_WORKDAYS.has(key)) return true;
  if (HOLIDAYS.has(key)) return false;
  const weekday = new Date(day * DAY).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

// 这个时刻所在的北京时间那一天是不是工作日
export function isWorkday(at: Date): boolean {
  return isWorkdayNumber(chinaDay(at));
}

// 从提出时间起往后数 n 个工作日，保留同一时刻（北京时间 09.19 15:20 → 09.21 15:20）
export function addWorkingDays(from: Date, n: number): Date {
  let day = chinaDay(from);
  let left = n;
  while (left > 0) {
    day++;
    if (isWorkdayNumber(day)) left--;
  }
  return new Date(from.getTime() + (day - chinaDay(from)) * DAY);
}

// 离期限还剩几个工作日：0 = 今天到期，负数 = 已超时
export function workingDaysLeft(deadline: Date, now: Date = new Date()): number {
  if (now.getTime() > deadline.getTime()) return -1;
  return workingDaysBetween(now, deadline);
}

// 从 from 那天之后到 to 那天（含）之间有几个工作日：10.21 提出、10.23 看 → 已等 2 个工作日
export function workingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  for (let day = chinaDay(from) + 1; day <= chinaDay(to); day++) {
    if (isWorkdayNumber(day)) count++;
  }
  return count;
}

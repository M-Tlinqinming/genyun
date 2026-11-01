// 工作日：跳过周末和法定节假日，调休上班的周末算工作日。时间都按北京时间的日期算。
//
// 节假日由运营在知识库维护（M3 第 5 项），接口从数据库读来用 setHolidayCalendar 设置；
// 接口启动时读库失败就先用内置的 2026 年国务院放假安排（按国办发明电〔2025〕7 号整理，需对照原文核实）。
// 表里没有的年份只跳过周末。

// 一天的安排：放假（含落在周末的）或调休上班的周末
export type HolidayKind = 'holiday' | 'workday';
export const HOLIDAY_KIND_LABELS: Record<HolidayKind, string> = { holiday: '放假', workday: '调休上班' };
export interface HolidayEntry {
  date: string; // YYYY-MM-DD（北京时间的日期）
  kind: HolidayKind;
  name: string; // 节日名称，如「春节」；调休上班写「春节调休」等
}

const days = (name: string, dates: string[]): HolidayEntry[] => dates.map((date) => ({ date, kind: 'holiday', name }));
const work = (name: string, date: string): HolidayEntry => ({ date, kind: 'workday', name });

// 内置的 2026 年安排：迁移 0025 原样写进数据库作为初始数据；数据库没有数据时也用它
export const BUILTIN_HOLIDAYS: readonly HolidayEntry[] = [
  ...days('元旦', ['2026-01-01', '2026-01-02', '2026-01-03']),
  work('元旦调休', '2026-01-04'),
  ...days('春节', ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23']),
  work('春节调休', '2026-02-14'),
  work('春节调休', '2026-02-28'),
  ...days('清明节', ['2026-04-04', '2026-04-05', '2026-04-06']),
  ...days('劳动节', ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05']),
  work('劳动节调休', '2026-05-09'),
  ...days('端午节', ['2026-06-19', '2026-06-20', '2026-06-21']),
  ...days('中秋节', ['2026-09-25', '2026-09-26', '2026-09-27']),
  work('中秋节调休', '2026-09-20'),
  ...days('国庆节', ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']),
  work('国庆节调休', '2026-10-10'),
];

// 内置了节假日表的年份；之外的年份只跳过周末
export const HOLIDAY_YEARS: readonly number[] = [2026];

interface Calendar {
  holidays: ReadonlySet<string>;
  workdays: ReadonlySet<string>;
}
const calendarOf = (entries: readonly HolidayEntry[]): Calendar => ({
  holidays: new Set(entries.filter((e) => e.kind === 'holiday').map((e) => e.date)),
  workdays: new Set(entries.filter((e) => e.kind === 'workday').map((e) => e.date)),
});
const BUILTIN = calendarOf(BUILTIN_HOLIDAYS);
let current: Calendar = BUILTIN;

// 换成运营在知识库维护的节假日（接口启动时和每次修改后从数据库读来设置）。
// 只有读库失败（传 null）才回到内置表；读到空表就按空表算，只跳过周末
export function setHolidayCalendar(entries: readonly HolidayEntry[] | null): void {
  current = entries ? calendarOf(entries) : BUILTIN;
}

const CHINA_OFFSET = 8 * 3_600_000;
const DAY = 86_400_000;

// 北京时间的第几天（从 1970-01-01 起）
const chinaDay = (d: Date) => Math.floor((d.getTime() + CHINA_OFFSET) / DAY);
const dayKey = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

function isWorkdayNumber(day: number): boolean {
  const key = dayKey(day);
  if (current.workdays.has(key)) return true;
  if (current.holidays.has(key)) return false;
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

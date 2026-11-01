// 设计系统 v1.1（Paper「04 · 设计系统 v1.1」）中的 gy-v1 / gy-stage / gy-source 三组 token。
// 只在这里写颜色值；其他地方引用这里或 CSS 变量。旧的绿色 --color-primary 已废弃，不要引用。

export const gy = {
  surface: '#FFFFFF',
  canvas: '#F8F9FB',
  text: '#18243B',
  secondary: '#596170',
  tertiary: '#6B7484',
  split: '#E5E7EB',
  border: '#89909C',
  primary: '#245BDB',
  hover: '#1E4FC4',
  active: '#143FB5',
  selected: '#EFF4FF',
  success: '#237B4B',
  warning: '#925F00',
  error: '#B42318',
  successBg: '#EDF7F0',
  warningBg: '#FFF7E6',
  errorBg: '#FEF3F2',
  neutralBg: '#F0F2F5',
  mask: 'rgb(24 36 59 / 45%)',
  // 侧栏、顶栏的分隔线（设计稿实测值）
  frameLine: '#E8EAEE',
} as const;

// 任务阶段：需要客户/专家处理、进行中、已完成、出错
export const stage = {
  action: { color: gy.warning, bg: gy.warningBg },
  progress: { color: gy.secondary, bg: gy.neutralBg },
  done: { color: gy.success, bg: gy.successBg },
  error: { color: gy.error, bg: gy.errorBg },
} as const;

// 信息来源：客户填写、专家补充、系统调取、客户确认
export const source = {
  customer: { color: gy.primary, bg: gy.selected },
  expert: { color: '#5B4BB7', bg: '#F3F1FC' },
  system: { color: '#0E7490', bg: '#ECF8FA' },
  confirm: { color: gy.secondary, bg: gy.neutralBg },
} as const;

// 官网与 Logo 的品牌色
export const brand = {
  ink: '#071A33',
  paper: '#F5F3EE',
  blue: '#0068BD',
  teal: '#23A6AD',
  green: '#75AF76',
  gold: '#EDC147',
  wordmark: '#002351',
  wordmarkSub: '#5A6B85',
} as const;

export const layout = {
  header: 64,
  sider: 224,
  content: 1152,
  form: 720,
} as const;

// 字体本地优先，不下载外部字体（Logo 字标除外，随应用打包）。
export const fontFamily =
  '"Noto Sans SC", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

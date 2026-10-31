// 官网全站共用的业务信息。改电话、登录地址只改这里。

export const PHONE = '0752-5200831';
export const PHONE_HREF = 'tel:+867525200831';
export const EMAIL = 'hello@genyun.cn';
export const COMPANY = '惠州元御智能科技有限公司';

/**
 * 「登录 / 进入工作台」指向产品的登录页。
 * 官网与产品同域部署（Caddy 按路径分流），所以默认是站内相对地址；
 * 若以后改成子域名，构建时设置 PUBLIC_APP_LOGIN_URL 即可。
 */
export const LOGIN_URL: string = import.meta.env.PUBLIC_APP_LOGIN_URL ?? '/login';

export type NavKey = 'product' | 'how' | 'expertise' | 'about';

export const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: 'product', label: '服务内容', href: '/product/' },
  { key: 'how', label: '工作方式', href: '/#how' },
  { key: 'expertise', label: '交付样例', href: '/expertise/' },
  { key: 'about', label: '关于耕云', href: '/#about' },
];

/** 「预约演示」等按钮打开的联系窗口，按入口换一句说明 */
export type ContactTopic = 'demo' | 'notify' | 'sample';

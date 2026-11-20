import { Link } from 'react-router';
import { gy, type } from '../theme/tokens';

// 返回链接：详情页标题上方一行「← 返回任务中心」，主色 14 号字，不放面包屑
export function BackLink({
  to,
  label,
}: {
  /** 点了回到哪个页面（站内路径） */
  to: string;
  /** 链接文字，写目的地，如「返回任务中心」；前面的箭头自动加 */
  label: string;
}) {
  return (
    <Link to={to} style={{ ...type.body, color: gy.primary, alignSelf: 'flex-start' }}>
      ← {label}
    </Link>
  );
}

import type { CSSProperties, ReactNode } from 'react';
import { gy, stage, type, weight } from '../theme/tokens';
import type { StatusTone } from './StatusTag';

/** 一格统计的内容 */
export type StatItem = {
  /** 唯一键，选中时回传 */
  key: string;
  /** 第一行：阶段名，前面带一个阶段色小圆点 */
  label: string;
  /** 第二行：数字，不补零 */
  value: number;
  /** 第三行：一句 12 号灰字，单行 */
  note?: ReactNode;
  /** 小圆点颜色，与阶段标签同一套 */
  tone: StatusTone;
};

// 统计格：一排等宽、间距 16。受控：点一格选中（蓝框浅蓝底）当筛选用，再点一次取消
export function StatCells({
  items,
  selected,
  onSelect,
  label = '按阶段筛选',
}: {
  /** 各格内容，一般四格 */
  items: StatItem[];
  /** 当前选中的格的 key；没选中传 undefined */
  selected?: string;
  /** 点格子时回调：选中传 key，再点同一格取消传 undefined；不传则格子只展示、不能点 */
  onSelect?: (key: string | undefined) => void;
  /** 读屏用的分组名 */
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 16 }}>
      {items.map((item) => (
        <StatCell
          key={item.key}
          item={item}
          selected={selected === item.key}
          onClick={onSelect ? () => onSelect(selected === item.key ? undefined : item.key) : undefined}
        />
      ))}
    </div>
  );
}

function StatCell({ item, selected, onClick }: { item: StatItem; selected: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: stage[item.tone].color }} />
        <span style={{ ...type.body, color: gy.secondary }}>{item.label}</span>
      </span>
      <span className="gy-tabular" style={{ ...type.pageTitle, fontWeight: weight.strong, color: gy.text }}>
        {item.value}
      </span>
      {item.note && (
        <span style={{ ...type.caption, color: gy.tertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.note}
        </span>
      )}
    </>
  );
  const style: CSSProperties = {
    flex: '1 1 0',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '16px 20px',
    borderRadius: 8,
    border: `1px solid ${selected ? gy.primary : gy.split}`,
    background: selected ? gy.selected : gy.surface,
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, background-color 0.15s',
  };
  if (!onClick) return <div style={style}>{body}</div>;
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} style={{ ...style, cursor: 'pointer' }}>
      {body}
    </button>
  );
}

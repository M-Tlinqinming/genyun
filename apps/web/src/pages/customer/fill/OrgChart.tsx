import type { OrgChart as Chart } from '@genyun/shared';
import { gy, source } from '../../../theme/tokens';

const INK = gy.text;
const BOX = 36;
// 三组时组与组之间的距离（设计稿 240 宽放 3 组），组多了就收紧，最宽 272
const SPACING = 66;
const MAX_WIDTH = 272;

function Box({ children }: { children: string }) {
  return (
    <div
      style={{
        width: 104,
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        background: '#FFFFFF',
        border: `1.2px solid ${INK}`,
        fontSize: 13,
        lineHeight: '20px',
        color: INK,
      }}
    >
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <svg width="12" height="22" viewBox="0 0 12 22" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M6 1v18M3 15l3 4 3-4" {...stroke} />
    </svg>
  );
}

const stroke = {
  fill: 'none',
  stroke: INK,
  strokeWidth: 1.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// 应急救援组织体系图（S02 右侧实时预览）：总指挥 →（有副总指挥时）副总指挥 → 各组，组名竖排，只写职务
export function OrgChart({ chart }: { chart: Chart }) {
  const n = chart.groups.length;
  const width = n <= 1 ? BOX : Math.min(MAX_WIDTH, BOX * n + SPACING * (n - 1));
  const centers = chart.groups.map((_, i) => (n <= 1 ? width / 2 : BOX / 2 + (i * (width - BOX)) / (n - 1)));
  const mid = width / 2;
  const branches =
    n === 0
      ? ''
      : [
          `M${mid} 0V14`,
          n > 1 ? `M${centers[0]} 14H${centers[n - 1]}` : '',
          ...centers.map((x) => `M${x} 14V32M${x - 3} 28l3 4 3-4`),
        ].join('');

  return (
    <section
      aria-label="应急救援组织体系图"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 20,
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600, color: gy.text }}>
          应急救援组织体系图
        </h2>
        <span
          style={{
            padding: '0 6px',
            borderRadius: 4,
            background: source.system.bg,
            color: source.system.color,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          实时生成
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
          borderRadius: 6,
          background: '#FAFBFC',
          border: '1px solid #EEF0F3',
        }}
      >
        <Box>总指挥</Box>
        {chart.deputy && (
          <>
            <Arrow />
            <Box>副总指挥</Box>
          </>
        )}
        {n > 0 && (
          <>
            <svg width={width} height="34" viewBox={`0 0 ${width} 34`} aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d={branches} {...stroke} />
            </svg>
            <ul
              style={{
                width,
                display: 'flex',
                alignItems: 'stretch',
                justifyContent: n <= 1 ? 'center' : 'space-between',
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              {chart.groups.map((g, i) => (
                <li
                  // 同名的自定义组也要各画一个
                  key={`${g}-${i}`}
                  style={{
                    width: BOX,
                    minHeight: 108,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 0',
                    boxSizing: 'border-box',
                    background: '#FFFFFF',
                    border: `1.2px solid ${INK}`,
                  }}
                >
                  <span style={{ width: 14, fontSize: 13, lineHeight: '18px', textAlign: 'center', color: INK }}>{g}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>
        图上只写职务，姓名和电话放在成员表里。增删小组或去掉副总指挥后，图会自动调整。
      </p>
    </section>
  );
}

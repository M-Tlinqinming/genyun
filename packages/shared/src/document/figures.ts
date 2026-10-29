// 交付文档里的图：同一份 SVG 给网页预览和 Word（后台转 PNG）用，TECH-PLAN 3.5「文档生成」。
// 组织体系图、工艺流程图与网页自填页（OrgChart.tsx、ProcessStepPage.tsx FlowChart）同一画法与尺寸；
// 预案体系图、应急响应流程图、报警流程图沿用同样的方框加箭头，取代旧仓库的 Mermaid 图。
import type { OrgChart } from '../profile/organization-step.ts';
import { snakeRows } from '../profile/process-flow.ts';

const INK = '#1F2329';
// Windows 用宋体；服务器（Linux）上没有宋体，用思源宋体（Dockerfile 里装）
const FONT = "SimSun, 宋体, 'Noto Serif CJK SC', serif";
const FONT_SIZE = 13;
const LINE = 18;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 估算文字宽度：汉字一个字号宽，字母数字约半个 */
function textWidth(s: string, size = FONT_SIZE): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? size : size * 0.55;
  return w;
}

/** 按宽度折行（汉字逐字可断） */
function wrap(s: string, maxWidth: number, size = FONT_SIZE): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of s) {
    if (line && textWidth(line + ch, size) > maxWidth) {
      lines.push(line);
      line = '';
    }
    line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${FONT_SIZE}" fill="${INK}"><rect width="${width}" height="${height}" fill="#FFFFFF"/>${body}</svg>`;
}

/** 方框，文字居中，多行 */
function box(x: number, y: number, w: number, h: number, lines: string[], opts: { bold?: boolean } = {}): string {
  const top = y + h / 2 - ((lines.length - 1) * LINE) / 2 + FONT_SIZE / 2 - 1;
  const text = lines
    .map((l, i) => `<text x="${x + w / 2}" y="${top + i * LINE}" text-anchor="middle"${opts.bold ? ' font-weight="bold"' : ''}>${esc(l)}</text>`)
    .join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF" stroke="${INK}" stroke-width="1.2"/>${text}`;
}

const STROKE = `fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"`;

/** 竖直或水平箭头，箭头在终点 */
function arrow(x1: number, y1: number, x2: number, y2: number): string {
  const head =
    x1 === x2
      ? y2 > y1
        ? `M${x2 - 3} ${y2 - 4}l3 4 3-4`
        : `M${x2 - 3} ${y2 + 4}l3-4 3 4`
      : x2 > x1
        ? `M${x2 - 4} ${y2 - 3}l4 3-4 3`
        : `M${x2 + 4} ${y2 - 3}l-4 3 4 3`;
  return `<path d="M${x1} ${y1}L${x2} ${y2}${head}" ${STROKE}/>`;
}

function label(x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end' = 'start'): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12">${esc(s)}</text>`;
}

export interface Svg {
  svg: string;
  width: number;
  height: number;
}

// ── 应急救援组织体系图：总指挥 →（有副总指挥时）副总指挥 → 各组，组名竖排，只写职务 ──
export function orgChartSvg(chart: OrgChart): Svg {
  const BOX = 36;
  const SPACING = 66;
  const MAX_WIDTH = 272;
  const PAD = 20;
  const n = chart.groups.length;
  const rowWidth = n <= 1 ? BOX : Math.min(MAX_WIDTH, BOX * n + SPACING * (n - 1));
  const width = Math.max(rowWidth, 104) + PAD * 2;
  const mid = width / 2;
  const left = mid - rowWidth / 2;
  const groupHeight = Math.max(108, ...chart.groups.map((g) => [...g].length * LINE + 16));

  let y = PAD;
  const parts: string[] = [box(mid - 52, y, 104, 34, ['总指挥'])];
  y += 34;
  if (chart.deputy) {
    parts.push(arrow(mid, y, mid, y + 22), box(mid - 52, y + 22, 104, 34, ['副总指挥']));
    y += 56;
  }
  if (n > 0) {
    const centers = chart.groups.map((_, i) => left + (n <= 1 ? rowWidth / 2 : BOX / 2 + (i * (rowWidth - BOX)) / (n - 1)));
    parts.push(`<path d="M${mid} ${y}V${y + 14}${n > 1 ? `M${centers[0]} ${y + 14}H${centers[n - 1]}` : ''}" ${STROKE}/>`);
    centers.forEach((x, i) => {
      parts.push(arrow(x, y + 14, x, y + 32));
      parts.push(box(x - BOX / 2, y + 32, BOX, groupHeight, [...chart.groups[i]!]));
    });
    y += 32 + groupHeight;
  }
  const height = y + PAD;
  return { svg: svg(width, height, parts.join('')), width, height };
}

// ── 工艺流程图：方框加箭头，每行 5 道，蛇形折行 ──
export function processFlowSvg(steps: string[]): Svg {
  const PER_ROW = 5;
  const W = 112;
  const H = 44;
  const GAP = 28;
  const DOWN = 36;
  const PAD = 20;
  const rowWidth = W * Math.min(PER_ROW, Math.max(steps.length, 1)) + GAP * (Math.min(PER_ROW, Math.max(steps.length, 1)) - 1);
  const fullWidth = W * PER_ROW + GAP * (PER_ROW - 1);
  const rows = snakeRows(steps, PER_ROW);
  const innerWidth = rows.length > 1 ? fullWidth : rowWidth;
  const width = innerWidth + PAD * 2;
  const parts: string[] = [];
  rows.forEach((row, r) => {
    const y = PAD + r * (H + DOWN);
    // 反向行靠右排，与网页一致
    const offset = row.reversed ? innerWidth - (W * row.items.length + GAP * (row.items.length - 1)) : 0;
    row.items.forEach((name, i) => {
      const x = PAD + offset + i * (W + GAP);
      parts.push(box(x, y, W, H, wrap(name, W - 12)));
      // 反向行从右往左走：箭头从右边那格指向左边这格
      if (i > 0) parts.push(row.reversed ? arrow(x - 3, y + H / 2, x - GAP + 3, y + H / 2) : arrow(x - GAP + 3, y + H / 2, x - 3, y + H / 2));
    });
    if (r > 0) {
      // 上一行末尾在右（正向）或左（反向），向下接到这一行同一侧
      const prev = rows[r - 1]!;
      const x = prev.reversed ? PAD + W / 2 : PAD + innerWidth - W / 2;
      parts.push(arrow(x, y - DOWN + 4, x, y - 4));
    }
  });
  const height = PAD * 2 + rows.length * H + Math.max(rows.length - 1, 0) * DOWN;
  return { svg: svg(width, height, parts.join('')), width, height };
}

// ── 应急预案体系与衔接图：上级预案 → 本企业预案 → 综合 / 专项 / 现场处置 ──
export function planSystemSvg(p: { upper: string[]; company: string; specialty: string[]; site: string[] }): Svg {
  const COL = 250;
  const GAP = 24;
  const PAD = 20;
  const width = COL * 3 + GAP * 2 + PAD * 2;
  const mid = width / 2;
  const parts: string[] = [];
  let y = PAD;
  for (const name of p.upper) {
    const lines = wrap(name, 300);
    const h = lines.length * LINE + 16;
    parts.push(box(mid - 160, y, 320, h, lines));
    y += h;
    parts.push(arrow(mid, y, mid, y + 22));
    y += 22;
  }
  const companyLines = [...wrap(p.company, 300), '生产安全事故应急预案'];
  const ch = companyLines.length * LINE + 16;
  parts.push(box(mid - 160, y, 320, ch, companyLines, { bold: true }));
  y += ch;
  const xs = [PAD, PAD + COL + GAP, PAD + (COL + GAP) * 2];
  parts.push(`<path d="M${mid} ${y}V${y + 14}M${xs[0]! + COL / 2} ${y + 14}H${xs[2]! + COL / 2}" ${STROKE}/>`);
  const columns = [['综合应急预案'], ['专项应急预案', ...p.specialty], ['现场处置方案', ...p.site]];
  const columnLines = columns.map(([head, ...items]) => [head!, ...items.flatMap((i) => wrap(i, COL - 16))]);
  const colHeight = Math.max(...columnLines.map((l) => l.length)) * LINE + 16;
  columnLines.forEach((lines, i) => {
    const x = xs[i]!;
    parts.push(arrow(x + COL / 2, y + 14, x + COL / 2, y + 34));
    const top = y + 34;
    parts.push(`<rect x="${x}" y="${top}" width="${COL}" height="${colHeight}" fill="#FFFFFF" stroke="${INK}" stroke-width="1.2"/>`);
    lines.forEach((l, j) => {
      parts.push(`<text x="${x + COL / 2}" y="${top + 8 + FONT_SIZE + j * LINE}" text-anchor="middle"${j === 0 ? ' font-weight="bold"' : ''}>${esc(l)}</text>`);
    });
  });
  const height = y + 34 + colHeight + PAD;
  return { svg: svg(width, height, parts.join('')), width, height };
}

// ── 竖排流程：一列方框，可在某一步右侧挂一个分支框（如「请求外部支援」） ──
interface FlowStep {
  text: string;
  /** 指向下一步的箭头旁的说明 */
  edge?: string;
  /** 并列的几步（如响应启动后同时开展的三项工作） */
  parallel?: string[];
  /** 右侧分支：从这一步向右，再回到下一步 */
  side?: { text: string; edge: string; back?: string };
}

function verticalFlow(steps: FlowStep[]): Svg {
  const W = 200;
  const PAD = 20;
  const SIDE_GAP = 70;
  const SIDE_W = 170;
  const hasSide = steps.some((s) => s.side);
  const parallelWidth = Math.max(0, ...steps.map((s) => (s.parallel ? s.parallel.length * 150 + (s.parallel.length - 1) * 16 : 0)));
  const coreWidth = Math.max(W, parallelWidth);
  const width = PAD * 2 + coreWidth + (hasSide ? SIDE_GAP + SIDE_W : 0);
  const mid = PAD + coreWidth / 2;
  const parts: string[] = [];
  let y = PAD;
  steps.forEach((step, i) => {
    let h: number;
    if (step.parallel) {
      const n = step.parallel.length;
      const bw = 150;
      const total = n * bw + (n - 1) * 16;
      const x0 = mid - total / 2;
      const boxes = step.parallel.map((t) => wrap(t, bw - 16));
      h = Math.max(...boxes.map((l) => l.length)) * LINE + 16;
      boxes.forEach((lines, j) => parts.push(box(x0 + j * (bw + 16), y, bw, h, lines)));
      // 上方汇入、下方汇出的横线
      const cx = boxes.map((_, j) => x0 + j * (bw + 16) + bw / 2);
      parts.push(`<path d="M${cx[0]} ${y - 10}H${cx[n - 1]}M${cx[0]} ${y + h}V${y + h + 10}H${cx[n - 1]}V${y + h}${cx.slice(1, -1).map((x) => `M${x} ${y + h}V${y + h + 10}`).join('')}" ${STROKE}/>`);
      cx.forEach((x) => parts.push(arrow(x, y - 10, x, y - 1)));
      h += 10;
    } else {
      const lines = wrap(step.text, W - 16);
      h = lines.length * LINE + 16;
      parts.push(box(mid - W / 2, y, W, h, lines));
      if (step.side) {
        const sx = PAD + coreWidth + SIDE_GAP;
        const sLines = wrap(step.side.text, SIDE_W - 16);
        const sh = sLines.length * LINE + 16;
        parts.push(arrow(mid + W / 2, y + h / 2, sx, y + h / 2), label(mid + W / 2 + 8, y + h / 2 - 6, step.side.edge));
        parts.push(box(sx, y + h / 2 - sh / 2, SIDE_W, sh, sLines));
        if (step.side.back !== undefined) {
          const by = y + h + 34 + 12;
          parts.push(`<path d="M${sx + SIDE_W / 2} ${y + h / 2 + sh / 2}V${by}H${mid + W / 2 + 4}" ${STROKE}/>`, arrow(mid + W / 2 + 12, by, mid + W / 2 + 1, by));
        }
      }
    }
    y += h;
    if (i < steps.length - 1) {
      const next = steps[i + 1]!;
      const gap = next.parallel ? 44 : 34;
      if (next.parallel) parts.push(`<path d="M${mid} ${y}V${y + gap - 10}" ${STROKE}/>`);
      else parts.push(arrow(mid, y, mid, y + gap));
      if (step.edge) parts.push(label(mid + 8, y + gap / 2 + 4, step.edge));
      y += gap;
    }
  });
  const height = y + PAD;
  return { svg: svg(width, height, parts.join('')), width, height };
}

/** 应急响应流程图（综合预案 3.3 响应启动） */
export function responseFlowSvg(): Svg {
  return verticalFlow([
    { text: '事故接报' },
    { text: '研判定级' },
    { text: '总指挥宣布启动响应级别' },
    { text: '', parallel: ['召开应急会议，下达处置指令', '信息上报 / 续报', '资源协调：队伍·物资·经费'] },
    { text: '应急处置' },
    { text: '事态是否超出企业能力？', edge: '否', side: { text: '请求外部支援', edge: '是', back: '' } },
    { text: '事态受控' },
    { text: '响应终止' },
  ]);
}

/** 报警流程图（附件「报警流程」）：现场员工 → 现场负责人 → 总指挥 → 应急小组与外部联动 */
export function alarmFlowSvg(p: { commander: string; bureau: string }): Svg {
  return verticalFlow([
    { text: '现场员工发现事故', edge: '立即报告（口头 / 对讲机 / 内线）' },
    { text: '现场负责人评估事故等级', edge: '上报事故级别与现场情况' },
    { text: `总指挥（${p.commander}）`, edge: '启动对应级别响应' },
    {
      text: '',
      parallel: ['调集各应急小组', '拨打 119 火警 / 120 急救 / 110 公安', `上报${p.bureau}`],
    },
    { text: '外部救援到达，现场处置指令经现场负责人下达' },
  ]);
}

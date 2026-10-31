// 把官网用到的字裁成小字体文件，放到 public/fonts/，并生成对应的 @font-face（src/styles/fonts.generated.css）。
// 在 dev / build / typecheck 之前运行。
//
// 为什么：Noto Sans SC / Noto Serif SC 的简体全集每个字重 1.1–1.5 MB，
// 按 unicode-range 切片又会在 dist 里留下上千个文件。官网文案是固定的，
// 只收录 src/ 里出现过的字，不依赖任何境外 CDN。
//
// 怎么裁：每个字重先用 fontsource 的「简体中文」和「西文」两个大文件；
// 这两个文件里没有的字（①②③④、● 这类符号）再到 fontsource 的编号切片里找，
// 每个用到的切片单独裁一个小文件，unicode-range 只写这几个字，浏览器用到才下载。
// 哪个字在所有文件里都找不到，就打印出来并以失败退出，免得页面上悄悄换成系统字体。
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'fonts');
const cssOut = join(root, 'src', 'styles', 'fonts.generated.css');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return files.flat();
}

const sourceFiles = (await walk(join(root, 'src'))).filter((f) =>
  ['.astro', '.ts', '.md', '.json'].includes(extname(f)),
);
const used = new Set();
for (const file of sourceFiles) {
  for (const ch of await readFile(file, 'utf8')) used.add(ch);
}
// 西文与常用标点整段收进来，避免改一个英文词就缺字
for (let c = 0x20; c <= 0x7e; c++) used.add(String.fromCodePoint(c));
for (const ch of '·—–…“”‘’「」『』《》、，。：；！？（）【】～×→①②③④⑤●✓−＋') used.add(ch);

const codepoints = [...used].map((ch) => ch.codePointAt(0)).filter((cp) => cp >= 0x20 && cp !== 0xfeff);

/** 读 TrueType / OpenType 的 cmap，返回字体里有字形的码位 */
function cmapOf(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...buf.subarray(rec, rec + 4)) === 'cmap') cmap = view.getUint32(rec + 8);
  }
  if (cmap < 0) throw new Error('字体里没有 cmap 表');
  const out = new Set();
  const n = view.getUint16(cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap + view.getUint32(cmap + 4 + i * 8 + 4);
    const format = view.getUint16(sub);
    if (format === 12) {
      const groups = view.getUint32(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        for (let c = view.getUint32(at); c <= view.getUint32(at + 4); c++) out.add(c);
      }
    } else if (format === 4) {
      const segs = view.getUint16(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const offsets = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const start = view.getUint16(starts + s * 2);
        const end = view.getUint16(ends + s * 2);
        const delta = view.getUint16(deltas + s * 2);
        const ro = view.getUint16(offsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = ro === 0 ? (c + delta) & 0xffff : view.getUint16(offsets + s * 2 + ro + (c - start) * 2);
          if (glyph !== 0) out.add(c);
        }
      }
    }
  }
  return out;
}

/** fontsource 的 CSS 里每个切片的文件名与 unicode-range */
async function slicesOf(pkg, weight) {
  const css = await readFile(require.resolve(`@fontsource/${pkg}/${weight}.css`), 'utf8');
  const slices = [];
  for (const block of css.split('@font-face').slice(1)) {
    const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!file || !range) continue;
    const ranges = range.split(',').map((r) => {
      const [a, b = a] = r.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(a, 16), parseInt(b, 16)];
    });
    slices.push({ file, has: (cp) => ranges.some(([a, b]) => cp >= a && cp <= b) });
  }
  return slices;
}

const hex4 = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');
const hex = (cp) => `U+${hex4(cp)}`;
/** 连续的码位合并成 U+0020-007E 这样的区间 */
function rangeOf(cps) {
  const sorted = [...cps].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? hex(sorted[i]) : `${hex(sorted[i])}-${hex4(sorted[j])}`);
    i = j;
  }
  return parts.join(', ');
}
const textOf = (cps) => String.fromCodePoint(...cps);

const faces = [
  // [字族, 包名, 字重, 输出名前缀, 先用的大文件（后面的覆盖前面的）]
  ['Noto Sans SC', 'noto-sans-sc', 400, 'noto-sans-sc-400', ['chinese-simplified', 'latin']],
  ['Noto Sans SC', 'noto-sans-sc', 500, 'noto-sans-sc-500', ['chinese-simplified', 'latin']],
  ['Noto Serif SC', 'noto-serif-sc', 600, 'noto-serif-sc-600', ['chinese-simplified', 'latin']],
  // 等宽字只放西文；中文和符号按 font-family 退到 Noto Sans SC
  ['IBM Plex Mono', 'ibm-plex-mono', 400, 'ibm-plex-mono-400', ['latin']],
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const css = ['/* scripts/subset-fonts.mjs 生成，不要手改 */'];
const missing = [];
let total = 0;
let count = 0;

for (const [family, pkg, weight, prefix, subsets] of faces) {
  const covered = new Set();
  const rules = [];
  for (const subset of subsets) {
    const src = await readFile(require.resolve(`@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff2`));
    const want = subset === 'latin' ? codepoints.filter((cp) => cp <= 0x2fff) : codepoints;
    const sfnt = await subsetFont(src, textOf(want), { targetFormat: 'sfnt' });
    const got = [...cmapOf(sfnt)].filter((cp) => want.includes(cp));
    if (!got.length) continue;
    const name = subset === 'latin' ? `${prefix}-latin.woff2` : `${prefix}.woff2`;
    const out = await subsetFont(src, textOf(got), { targetFormat: 'woff2' });
    await writeFile(join(outDir, name), out);
    total += out.length;
    count++;
    got.forEach((cp) => covered.add(cp));
    // 大的中文文件不写 unicode-range；西文文件写上范围，接管西文字符
    rules.push({ name, range: subset === 'latin' ? got : null });
  }

  if (family !== 'IBM Plex Mono') {
    // 两个大文件里都没有的字，到编号切片里找
    const rest = codepoints.filter((cp) => !covered.has(cp));
    const slices = await slicesOf(pkg, weight);
    const bySlice = new Map();
    for (const cp of rest) {
      const slice = slices.find((s) => s.has(cp));
      if (!slice) {
        missing.push(`${family} ${weight}：${String.fromCodePoint(cp)}（${hex(cp)}）`);
        continue;
      }
      bySlice.set(slice.file, [...(bySlice.get(slice.file) ?? []), cp]);
    }
    let k = 0;
    for (const [file, cps] of bySlice) {
      const src = await readFile(require.resolve(`@fontsource/${pkg}/files/${file}`));
      const name = `${prefix}-extra-${++k}.woff2`;
      const out = await subsetFont(src, textOf(cps), { targetFormat: 'woff2' });
      await writeFile(join(outDir, name), out);
      total += out.length;
      count++;
      rules.push({ name, range: cps });
    }
  }

  for (const { name, range } of rules) {
    css.push(
      `@font-face {\n  font-family: '${family}';\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('/fonts/${name}') format('woff2');` +
        (range ? `\n  unicode-range: ${rangeOf(range)};` : '') +
        '\n}',
    );
  }
}

await writeFile(cssOut, css.join('\n') + '\n');
console.log(`字体裁剪完成：${codepoints.length} 个字符，${count} 个文件，共 ${(total / 1024).toFixed(1)} KB`);
// 只关心页面上可能出现的字：源码里的制表符之类控制字符已经排除在外
if (missing.length) {
  console.error(`以下字符在字体里找不到，会显示成系统字体：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

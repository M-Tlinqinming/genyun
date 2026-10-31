// 把官网用到的字裁成小字体文件，放到 public/fonts/，在 dev / build 之前运行。
//
// 为什么：Noto Sans SC / Noto Serif SC 的简体全集每个字重 1.1–1.5 MB，
// 按 unicode-range 切片又会在 dist 里留下上千个文件。官网文案是固定的，
// 只收录 src/ 里出现过的字，三个中文字重加起来在 200 KB 左右，不依赖任何境外 CDN。
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'fonts');

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
for (const ch of '·—–…“”‘’「」『』《》、，。：；！？（）【】～×→①②③④⑤✓−＋') used.add(ch);

const text = [...used].filter((ch) => ch.codePointAt(0) >= 0x20).join('');

const fontFile = (pkg, file) => require.resolve(`@fontsource/${pkg}/files/${file}`);

const targets = [
  ['noto-sans-sc-400.woff2', fontFile('noto-sans-sc', 'noto-sans-sc-chinese-simplified-400-normal.woff2')],
  ['noto-sans-sc-500.woff2', fontFile('noto-sans-sc', 'noto-sans-sc-chinese-simplified-500-normal.woff2')],
  ['noto-serif-sc-600.woff2', fontFile('noto-serif-sc', 'noto-serif-sc-chinese-simplified-600-normal.woff2')],
  ['noto-sans-sc-latin-400.woff2', fontFile('noto-sans-sc', 'noto-sans-sc-latin-400-normal.woff2')],
  ['noto-sans-sc-latin-500.woff2', fontFile('noto-sans-sc', 'noto-sans-sc-latin-500-normal.woff2')],
  ['noto-serif-sc-latin-600.woff2', fontFile('noto-serif-sc', 'noto-serif-sc-latin-600-normal.woff2')],
  ['ibm-plex-mono-400.woff2', fontFile('ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')],
];

await mkdir(outDir, { recursive: true });
let total = 0;
for (const [name, src] of targets) {
  const out = await subsetFont(await readFile(src), text, { targetFormat: 'woff2' });
  await writeFile(join(outDir, name), out);
  total += out.length;
  console.log(`  ${name.padEnd(32)} ${(out.length / 1024).toFixed(1)} KB`);
}
console.log(`字体裁剪完成：${used.size} 个字符，共 ${(total / 1024).toFixed(1)} KB`);

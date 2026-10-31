// 官网截图：按 1366 / 1440 / 1920 三种宽度截整页，并把 1440 宽的截图和 Paper 画板图左右拼在一起。
// 用法：先 `npm run build -w @genyun/site && npm run preview -w @genyun/site`，再 `node apps/site/scripts/screenshots.mjs`
// 输出在仓库根目录 out/site/（不进 git）。Paper 画板图需事先导出到 out/site/paper/。
import { chromium } from '@playwright/test';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(repo, 'out', 'site');
const base = process.env.SITE_BASE ?? 'http://localhost:4321';

const pages = [
  { name: 'w01-home', path: '/' },
  { name: 'w02-product', path: '/product/' },
  { name: 'w03-expertise', path: '/expertise/' },
  { name: 'w06-privacy', path: '/privacy/' },
  { name: 'w07-service', path: '/terms/' },
].filter((p) => !process.env.ONLY || process.env.ONLY.split(',').includes(p.name));
const widths = [1366, 1440, 1920];

const exists = (f) => access(f).then(() => true, () => false);

await mkdir(join(out, 'impl'), { recursive: true });
await mkdir(join(out, 'compare'), { recursive: true });
const browser = await chromium.launch();

for (const p of pages) {
  for (const width of widths) {
    // 减少动态：截到的是入场完成后的样子，轮播停在 Paper 画的那一屏
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const res = await page.goto(base + p.path, { waitUntil: 'networkidle' });
    if (!res?.ok()) {
      console.log(`跳过 ${p.path}（${res?.status()}）`);
      await ctx.close();
      break;
    }
    await page.evaluate(() => document.fonts.ready);
    const file = join(out, 'impl', `${p.name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${p.name} @${width}: ${file}${overflow > 0 ? `  ⚠ 横向溢出 ${overflow}px` : ''}`);
    await ctx.close();
  }

  const paper = join(out, 'paper', `${p.name}.png`);
  const impl = join(out, 'impl', `${p.name}-1440.png`);
  if ((await exists(paper)) && (await exists(impl))) {
    const ctx = await browser.newContext({ viewport: { width: 2960, height: 1000 } });
    const page = await ctx.newPage();
    // about:blank 里不能引用本地图片，先写成文件再打开
    const html = join(out, 'compare', `${p.name}.html`);
    await writeFile(html, `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;gap:80px;align-items:flex-start;background:#d9d6cf">
      <figure style="margin:0;width:1440px"><figcaption style="font:600 28px sans-serif;padding:24px">Paper 设计稿</figcaption><img src="${pathToFileURL(paper)}" style="width:1440px;display:block"></figure>
      <figure style="margin:0;width:1440px"><figcaption style="font:600 28px sans-serif;padding:24px">实现（1440）</figcaption><img src="${pathToFileURL(impl)}" style="width:1440px;display:block"></figure>
    </body>`);
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    const file = join(out, 'compare', `${p.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`对照图：${file}`);
    await ctx.close();
  }
}

await browser.close();

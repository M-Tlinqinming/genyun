import { expect, test, type Page } from '@playwright/test';

// 逐个可见文字算对比度（WCAG 2）：前景按透明度叠到背景上，背景往上找第一层不透明的底色
function lowContrastTexts(page: Page) {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const parse = (s: string): Rgba | null => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    };
    const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba;
    const lum = (c: Rgba) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const backgroundOf = (el: Element) => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0) layers.push(c);
        if (c && c[3] === 1) break;
      }
      return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1] as Rgba);
    };
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      const el = walker.currentNode.parentElement;
      if (!text || !el || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      if (opacity === 0) continue;
      const bg = backgroundOf(el);
      const c = parse(cs.color)!;
      const fg = over([c[0], c[1], c[2], c[3] * opacity], bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) bad.push(`${text.slice(0, 20)}（${ratio.toFixed(2)}）`);
    }
    return bad;
  });
}

// 官网（apps/site）：构建后的静态页面，由 playwright.config.ts 的第三个 webServer 在 4322 端口提供
const SITE = 'http://localhost:4322';

test.describe('官网首页', () => {
  test('标题、描述、分享信息和「登录」链接', async ({ page }) => {
    await page.goto(`${SITE}/`);
    await expect(page).toHaveTitle('耕云 · AI + 注册安全工程师编制应急预案');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /应急预案/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/images\/og\.jpg$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/只填您知道的，\s*专业的交给耕云。/);
    await expect(page.getByRole('banner').getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: '客户登录' })).toHaveAttribute('href', '/login');
  });

  test('不向境外或其他站点请求字体、脚本、图片', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith(SITE) && !req.url().startsWith('data:')) external.push(req.url());
    });
    await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
    // 品牌字体真的加载了
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    expect(loaded).toEqual(expect.arrayContaining(['Noto Serif SC', 'Noto Sans SC', 'IBM Plex Mono']));
  });

  test('「预约演示」打开联系窗口，按 Esc 关闭后焦点回到按钮', async ({ page }) => {
    await page.goto(`${SITE}/`);
    const opener = page.getByRole('banner').getByRole('link', { name: '预约演示' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '预约演示' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: '0752-5200831' })).toHaveAttribute('href', 'tel:+867525200831');
    await expect(dialog.getByRole('img', { name: /企业微信二维码/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('「上线时通知我」用同一个窗口，换成对应的说明；点关闭按钮关掉', async ({ page }) => {
    await page.goto(`${SITE}/`);
    await page.getByRole('link', { name: '上线时通知我' }).first().click();
    const dialog = page.getByRole('dialog', { name: '上线时通知我' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('上线时，我们第一时间告诉您');
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden();
  });

  test('点窗口外的遮罩关闭联系窗口', async ({ page }) => {
    await page.goto(`${SITE}/`);
    await page.getByRole('banner').getByRole('link', { name: '预约演示' }).click();
    const dialog = page.getByRole('dialog', { name: '预约演示' });
    await expect(dialog).toBeVisible();
    // 左上角在窗口外，点到的是遮罩
    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
  });

  test.describe('关掉 JS', () => {
    test.use({ javaScriptEnabled: false });

    test('内容直接可见，「预约演示」退回到页脚的联系一栏', async ({ page }) => {
      await page.goto(`${SITE}/`);
      const state = await page.evaluate(() => ({
        jsEnter: document.documentElement.classList.contains('js-enter'),
        h1Opacity: getComputedStyle(document.querySelector('h1')!).opacity,
      }));
      expect(state).toEqual({ jsEnter: false, h1Opacity: '1' });
      await page.getByRole('banner').getByRole('link', { name: '预约演示' }).click();
      await expect(page).toHaveURL(/#contact$/);
      await expect(page.locator('#contact')).toBeInViewport();
      await expect(page.locator('#contact')).toContainText('0752-5200831');
    });
  });

  test('轮播：点标签或用方向键切换画面', async ({ page }) => {
    await page.goto(`${SITE}/`);
    const tabs = page.getByRole('tablist', { name: '产品界面示意' }).getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await tabs.nth(3).click();
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-win-url]')).not.toHaveText('');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toBeFocused();
  });

  test('入场动画结束后内容全部可见，轮播 6 秒后自动翻到下一屏', async ({ page }) => {
    await page.goto(`${SITE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).not.toHaveClass(/js-enter/);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('AI 风险辨识');
    await expect(page.getByRole('tab', { selected: true })).toHaveText('注安师审核', { timeout: 9000 });
  });

  test.describe('减少动态', () => {
    test.use({ reducedMotion: 'reduce' });

    test('不做入场动画，轮播停在第二屏不自动翻页', async ({ page }) => {
      await page.goto(`${SITE}/`);
      // 一次性判断，不靠重试：加载完立刻看，入场用的 js-enter 从没加上、标题本来就是不透明的
      const state = await page.evaluate(() => ({
        jsEnter: document.documentElement.classList.contains('js-enter'),
        h1Opacity: getComputedStyle(document.querySelector('h1')!).opacity,
      }));
      expect(state).toEqual({ jsEnter: false, h1Opacity: '1' });
      const active = page.getByRole('tab', { selected: true });
      await expect(active).toHaveText('AI 风险辨识');
      await expect(active.locator('.tab__fill')).toHaveAttribute('style', /width: 100%/);
      await page.waitForTimeout(6500);
      await expect(page.getByRole('tab', { selected: true })).toHaveText('AI 风险辨识');
    });

    // 关掉动画再查，免得量到淡入一半的颜色
    test('所有文字对比度 ≥ 4.5:1（大字 3:1），轮播四屏都查', async ({ page }) => {
      await page.goto(`${SITE}/`);
      const tabs = page.getByRole('tab');
      for (let i = 0; i < 4; i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
        expect(await lowContrastTexts(page), `轮播第 ${i + 1} 屏`).toEqual([]);
      }
    });
  });

  for (const width of [390, 1366, 1440, 1920]) {
    test(`${width} 宽没有横向滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${SITE}/`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBe(0);
    });
  }
});

test('robots.txt 与 sitemap.xml', async ({ request }) => {
  const robots = await (await request.get(`${SITE}/robots.txt`)).text();
  expect(robots).toContain('Sitemap: https://preview.gengyun.net.cn/sitemap.xml');
  const sitemap = await request.get(`${SITE}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://preview.gengyun.net.cn/</loc>');
});

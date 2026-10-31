import { expect, test } from '@playwright/test';

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
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('opacity', '1');
      const active = page.getByRole('tab', { selected: true });
      await expect(active).toHaveText('AI 风险辨识');
      await expect(active.locator('.tab__fill')).toHaveAttribute('style', /width: 100%/);
      await page.waitForTimeout(6500);
      await expect(page.getByRole('tab', { selected: true })).toHaveText('AI 风险辨识');
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

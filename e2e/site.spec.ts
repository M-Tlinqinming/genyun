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

// 官网（apps/site）：构建后的静态页面，由 playwright.config.ts 的第三个 webServer 提供，端口见 E2E_SITE_PORT（默认 3322）
const SITE = `http://localhost:${process.env.E2E_SITE_PORT ?? '3322'}`;

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
    await expect(dialog).toContainText('安全台账生成上线时，我们第一时间告诉您');
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

  // 轮播标签是普通按钮（aria-pressed），不用 role=tab
  const slideButtons = (page: Page) => page.getByRole('group', { name: '产品界面示意' }).getByRole('button');
  const pressed = (page: Page) => page.getByRole('group', { name: '产品界面示意' }).getByRole('button', { pressed: true });

  test('轮播：点按钮或用方向键切换画面，切过之后不再自动翻页', async ({ page }) => {
    await page.goto(`${SITE}/`);
    const buttons = slideButtons(page);
    await expect(buttons).toHaveCount(4);
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await buttons.nth(3).click();
    await expect(buttons.nth(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-win-url]')).toHaveText('genyun.cn / 成果下载');
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(0)).toBeFocused();
    // 移开鼠标和焦点，免得因为悬停暂停而误判
    await page.mouse.move(5, 880);
    await page.locator('h1').click();
    await page.waitForTimeout(6500);
    await expect(pressed(page)).toHaveText('5 步填报');
  });

  test('入场动画结束后内容全部可见；自动播放只转一轮，停回第二屏', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`${SITE}/`);
    await page.mouse.move(5, 880);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).not.toHaveClass(/js-enter/);
    await expect(pressed(page)).toHaveText('AI 风险辨识');
    for (const label of ['注安师审核', '下载整套 Word', '5 步填报', 'AI 风险辨识']) {
      await expect(pressed(page)).toHaveText(label, { timeout: 9000 });
    }
    await page.waitForTimeout(7000);
    await expect(pressed(page)).toHaveText('AI 风险辨识');
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
      const active = pressed(page);
      await expect(active).toHaveText('AI 风险辨识');
      await expect(active.locator('.tab__fill')).toHaveAttribute('style', /width: 100%/);
      await page.waitForTimeout(6500);
      await expect(pressed(page)).toHaveText('AI 风险辨识');
    });

    // 关掉动画再查，免得量到淡入一半的颜色
    test('所有文字对比度 ≥ 4.5:1（大字 3:1），轮播四屏都查', async ({ page }) => {
      await page.goto(`${SITE}/`);
      const tabs = slideButtons(page);
      for (let i = 0; i < 4; i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute('aria-pressed', 'true');
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

test.describe('官网内页', () => {
  const pages = [
    { path: '/product/', title: '服务内容 · 耕云', h1: /一份企业档案，\s*一整套迎检文件。/, nav: '服务内容', noindex: false },
    { path: '/expertise/', title: '交付样例 · 耕云', h1: /先看成果，\s*再做决定。/, nav: '交付样例', noindex: false },
    { path: '/privacy/', title: '隐私说明 · 耕云', h1: '隐私说明', nav: null, noindex: true },
    { path: '/terms/', title: '服务说明 · 耕云', h1: '服务说明', nav: null, noindex: true },
  ];

  for (const p of pages) {
    test.describe(p.path, () => {
      test.use({ reducedMotion: 'reduce' });

      test('标题、导航高亮、收录设置；文字对比度达标', async ({ page }) => {
        await page.goto(`${SITE}${p.path}`);
        await expect(page).toHaveTitle(p.title);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.h1);
        const current = page.getByRole('banner').locator('[aria-current="page"]');
        if (p.nav) await expect(current).toHaveText(p.nav);
        else await expect(current).toHaveCount(0);
        await expect(page.locator('meta[name="robots"]')).toHaveCount(p.noindex ? 1 : 0);
        // 常见问题全部展开再查，收起的答案量不到
        await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
        expect(await lowContrastTexts(page)).toEqual([]);
      });

      for (const width of [390, 1366, 1920]) {
        test(`${width} 宽没有横向滚动`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${SITE}${p.path}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow).toBe(0);
        });
      }
    });
  }

  test('服务内容：常见问题可以展开收起，「预约演示」打开联系窗口', async ({ page }) => {
    await page.goto(`${SITE}/product/`);
    const faq = page.locator('details');
    await expect(faq).toHaveCount(5);
    await expect(faq.first()).toHaveAttribute('open', '');
    await faq.nth(1).locator('summary').click();
    await expect(faq.nth(1)).toHaveAttribute('open', '');
    await expect(faq.nth(1)).toContainText('GB/T 29639-2020');
    await page.getByRole('main').getByRole('link', { name: '预约演示' }).first().click();
    await expect(page.getByRole('dialog', { name: '预约演示' })).toBeVisible();
  });

  test('交付样例：按行业筛选；「索取完整样例」「上线时通知我」各换对应说明', async ({ page }) => {
    await page.goto(`${SITE}/expertise/`);
    const chips = page.getByRole('group', { name: '按行业筛选' }).getByRole('button');
    await expect(chips).toHaveCount(5);
    const cards = page.locator('[data-industry]');
    await expect(cards).toHaveCount(3);

    await chips.filter({ hasText: '电子电器' }).click();
    await expect(chips.filter({ hasText: '电子电器' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.filter({ visible: true })).toHaveCount(1);
    await expect(cards.filter({ visible: true })).toContainText('电子装配企业');

    await chips.filter({ hasText: '化工仓储' }).click();
    await expect(cards.filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('[data-filter-empty]')).toBeVisible();

    await chips.filter({ hasText: '全部行业' }).click();
    await expect(cards.filter({ visible: true })).toHaveCount(3);

    await page.getByRole('link', { name: '索取完整样例' }).click();
    const sample = page.getByRole('dialog', { name: '索取完整样例' });
    await expect(sample).toContainText('我们把脱敏样例发给您');
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: '上线时通知我' }).first().click();
    await expect(page.getByRole('dialog', { name: '上线时通知我' })).toContainText('电子装配企业 · 脱敏样例上线时');
  });

  test.describe('交付样例关掉 JS', () => {
    test.use({ javaScriptEnabled: false });

    test('不显示筛选按钮，三张样例卡都在', async ({ page }) => {
      await page.goto(`${SITE}/expertise/`);
      await expect(page.getByRole('group', { name: '按行业筛选' })).toBeHidden();
      await expect(page.locator('[data-industry]').filter({ visible: true })).toHaveCount(3);
    });
  });

  test('法律页面：目录链接跳到对应一节', async ({ page }) => {
    await page.goto(`${SITE}/terms/`);
    const toc = page.getByRole('navigation', { name: '目录' });
    await expect(toc.getByRole('link')).toHaveCount(7);
    await toc.getByRole('link', { name: /交付与修改/ }).click();
    await expect(page).toHaveURL(/#delivery$/);
    await expect(page.locator('#delivery h2')).toBeInViewport();
  });

  // 设计审查 #59：点第 3 节高亮落在第 2 节、后两节永远高亮不到、滚到页底停在第 4 节
  test('法律页面：点目录的平滑滚动停下后，拖滚动条等任何滚动都重新按位置高亮；后退时高亮跟着锚点', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${SITE}/privacy/`);
    const toc = page.getByRole('navigation', { name: '目录' });
    const links = toc.getByRole('link');
    const current = toc.locator('a[aria-current="true"]');

    await links.nth(5).click();
    await expect(current).toHaveText(await links.nth(5).innerText());
    await page.waitForTimeout(800);
    // 不经滚轮、键盘（如拖滚动条）滚到第 3 节
    const top = await page.locator('.legal__body section').nth(2).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo({ top: y - 40, behavior: 'instant' }), top);
    await expect(current).toHaveText(await links.nth(2).innerText());

    // 依次点第 4、6 项，后退回到第 4 项的锚点
    await links.nth(3).click();
    await links.nth(5).click();
    await expect(current).toHaveText(await links.nth(5).innerText());
    await page.goBack();
    await expect(current).toHaveText(await links.nth(3).innerText());
  });

  for (const width of [1366, 1440, 1920]) {
    for (const path of ['/terms/', '/privacy/']) {
      test(`${path} ${width} 宽：目录高亮跟着点击和滚动走`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${SITE}${path}`);
        const links = page.getByRole('navigation', { name: '目录' }).getByRole('link');
        const current = page.getByRole('navigation', { name: '目录' }).locator('a[aria-current="true"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveText(await links.first().innerText());

        // 点哪一项标哪一项，包括滚不到顶部的最后两节
        for (const i of [3, 5, 6, 1]) {
          await links.nth(i).click();
          await expect(current).toHaveText(await links.nth(i).innerText());
          await page.waitForTimeout(600); // 平滑滚动结束后也不被改掉
          await expect(current).toHaveText(await links.nth(i).innerText());
        }

        // 用户自己滚到页底：标最后一节
        await page.mouse.move(width / 2, 450);
        await page.mouse.wheel(0, 20000);
        await expect(current).toHaveText(await links.last().innerText());

        // 滚回第 2 节（序号 1）的位置
        await page.mouse.wheel(0, -20000);
        await expect(current).toHaveText(await links.first().innerText());
        const top = await page.locator('.legal__body section').nth(2).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        await page.evaluate((y) => window.scrollTo({ top: y - 40, behavior: 'instant' }), top);
        await expect(current).toHaveText(await links.nth(2).innerText());
      });
    }
  }

  test('交付样例：空状态的按钮切到机械制造；读屏提示跟着筛选结果变；只剩一张卡时宽度不变', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${SITE}/expertise/`);
    const chips = page.getByRole('group', { name: '按行业筛选' }).getByRole('button');
    const note = page.locator('[data-filter-note]');
    const coming = page.locator('.sample--coming').first();
    const widthBefore = (await coming.boundingBox())!.width;

    await chips.filter({ hasText: '电子电器' }).click();
    await expect(note).toHaveText('电子电器：1 份（整理中）');
    expect(Math.abs((await coming.boundingBox())!.width - widthBefore)).toBeLessThan(2);

    await chips.filter({ hasText: '机械制造' }).click();
    await expect(note).toHaveText('机械制造：1 份');

    await chips.filter({ hasText: '化工仓储' }).click();
    await expect(note).toHaveText('化工仓储：暂无样例');
    await page.getByRole('button', { name: '先看机械制造的样例' }).click();
    await expect(chips.filter({ hasText: '机械制造' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.filter({ hasText: '机械制造' })).toBeFocused();
    await expect(page.locator('[data-industry]').filter({ visible: true })).toHaveCount(1);

    await chips.filter({ hasText: '全部行业' }).click();
    await expect(note).toHaveText('全部行业：3 份（其中 2 份整理中）');
  });

  test('服务内容：常见问题第 5 条链到隐私说明', async ({ page }) => {
    await page.goto(`${SITE}/product/`);
    const last = page.locator('details').nth(4);
    await last.locator('summary').click();
    await last.getByRole('link', { name: '隐私说明' }).click();
    await expect(page).toHaveURL(/\/privacy\/$/);
  });

  test.describe('隐私页关掉 JS', () => {
    test.use({ javaScriptEnabled: false });

    test('「预约演示」跳到页脚的联系栏（页内只有一个 id="contact"）', async ({ page }) => {
      await page.goto(`${SITE}/privacy/`);
      await expect(page.locator('[id="contact"]')).toHaveCount(1);
      await page.getByRole('banner').getByRole('link', { name: '预约演示' }).click();
      await expect(page).toHaveURL(/#contact$/);
      await expect(page.locator('footer #contact')).toBeInViewport();
      await expect(page.locator('footer #contact')).toContainText('0752-5200831');
    });
  });
});

test('robots.txt 与 sitemap.xml', async ({ request }) => {
  const robots = await (await request.get(`${SITE}/robots.txt`)).text();
  expect(robots).toContain('Sitemap: https://preview.gengyun.net.cn/sitemap.xml');
  const sitemap = await request.get(`${SITE}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  const xml = await sitemap.text();
  for (const path of ['/', '/product/', '/expertise/']) {
    expect(xml).toContain(`<loc>https://preview.gengyun.net.cn${path}</loc>`);
  }
  // 法律页面是草案，不进站点地图
  expect(xml).not.toContain('/privacy/');
  expect(xml).not.toContain('/terms/');
});

test.describe('窄屏导航', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ['/', '/terms/']) {
    test(`${path}：菜单按钮展开导航，Esc 收起后焦点回到按钮，点链接能跳转`, async ({ page }) => {
      await page.goto(`${SITE}${path}`);
      const banner = page.getByRole('banner');
      const nav = banner.getByRole('navigation', { name: '主导航' });
      const toggle = banner.getByRole('button', { name: '菜单' });
      await expect(nav).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(nav).toBeVisible();
      // 名字始终是「菜单」，展开状态只由 aria-expanded 表达
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(banner.getByRole('button', { name: '收起' })).toHaveCount(0);
      await expect(nav.getByRole('link')).toHaveCount(5);

      // Tab 进入菜单里的第一个链接，Esc 收起，焦点回到按钮
      await page.keyboard.press('Tab');
      await expect(nav.getByRole('link', { name: '服务内容' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await nav.getByRole('link', { name: '交付样例' }).click();
      await expect(page).toHaveURL(/\/expertise\/$/);
    });
  }

  test('点菜单外面收起', async ({ page }) => {
    await page.goto(`${SITE}/product/`);
    const banner = page.getByRole('banner');
    await banner.getByRole('button', { name: '菜单' }).click();
    await expect(banner.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.getByRole('main').locator('p').first().click();
    await expect(banner.getByRole('navigation', { name: '主导航' })).toBeHidden();
  });

  test('展开后滚动页面自动收起', async ({ page }) => {
    await page.goto(`${SITE}/product/`);
    const banner = page.getByRole('banner');
    const toggle = banner.getByRole('button', { name: '菜单' });
    await toggle.click();
    await expect(banner.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.mouse.move(195, 600);
    await page.mouse.wheel(0, 400);
    await expect(banner.getByRole('navigation', { name: '主导航' })).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('900 宽以上不显示菜单按钮，导航常显', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`${SITE}/product/`);
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('button', { name: '菜单' })).toBeHidden();
    await expect(banner.getByRole('navigation', { name: '主导航' })).toBeVisible();
  });
});

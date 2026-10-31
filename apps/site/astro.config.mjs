import { defineConfig } from 'astro/config';

// 官网是纯静态站点：构建产物放在 dist/，由 Caddy 直接托管（见 deploy/preview）。
// SITE_URL 只用于生成 canonical、OG 和 sitemap 里的绝对地址。
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://preview.gengyun.net.cn',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  server: { port: 4321 },
  devToolbar: { enabled: false },
});

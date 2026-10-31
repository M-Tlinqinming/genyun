import type { APIRoute } from 'astro';

// 预览环境的 Caddy 另外加了 X-Robots-Tag: noindex；正式上线时去掉那一行即可，这里不用改。
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

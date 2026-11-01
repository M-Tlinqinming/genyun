import type { APIRoute } from 'astro';

// 官网页面固定，手写列表比引入 sitemap 插件更直接。新增页面时在这里加一行。
// 法律页面是草案（noindex），正式发布后再加进来
export const PAGES = ['/', '/product/', '/expertise/'];

export const GET: APIRoute = ({ site }) => {
  const urls = PAGES.map((path) => `  <url><loc>${new URL(path, site)}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};

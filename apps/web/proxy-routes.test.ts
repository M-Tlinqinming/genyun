// 预览环境的 Caddy 按路径把请求分给业务应用和官网（deploy/preview/Caddyfile）。
// 业务应用新加顶层路由却忘了改 Caddyfile，部署后那个地址会打开官网的 404，这里提前拦住。
// 放在 src 外面：要读仓库里的文件，用 Node 的 fs，不进前端的类型检查。
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const router = read('./src/router.tsx');
const caddyfile = read('../../deploy/preview/Caddyfile');

/** Caddyfile 里 @app 匹配的路径 */
const appMatchers = (caddyfile.match(/^\s*@app path (.+)$/m)?.[1] ?? '').trim().split(/\s+/);

/** router.tsx 顶层路由的第一段，例如 /login、/customer */
function topLevelSegments(): string[] {
  const block = router.slice(router.indexOf('createBrowserRouter('));
  const paths = [...block.matchAll(/path: (['"])(\/.*?)\1/g)].map((m) => m[2]!);
  const workspaces = [...block.matchAll(/workspaceRoutes\((['"])(\w+)\1\)/g)].map((m) => `/${m[2]}`);
  return [...new Set([...paths, ...workspaces].map((p) => `/${p.split('/')[1]}`))];
}

describe('预览环境的路径分流', () => {
  it('找到了 Caddyfile 的 @app 和前端的顶层路由', () => {
    expect(appMatchers.length).toBeGreaterThan(5);
    expect(topLevelSegments()).toContain('/login');
  });

  it('前端每个顶层路由都转给业务应用（本身和下级路径）', () => {
    for (const seg of topLevelSegments()) {
      expect(appMatchers, seg).toContain(seg);
      expect(appMatchers, `${seg}/*`).toContain(`${seg}/*`);
    }
  });

  it('后台邮件里的链接（appLink）也转给业务应用，前端页面还没做时也一样', () => {
    const api = new URL('../api/src/', import.meta.url);
    const files = readdirSync(api, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const segs = new Set<string>();
    for (const f of files) {
      // 第一段在 /、?、#、${ 或引号处截断，例如 appLink(`/reset-password?token=${t}`) 取 /reset-password
      const source = readFileSync(new URL(f.replaceAll('\\', '/'), api), 'utf8');
      for (const m of source.matchAll(/appLink\(\s*[`'"](\/[^/?#`'"$]+)/g)) segs.add(m[1]!);
    }
    expect(segs.size, '找到 appLink 的链接').toBeGreaterThan(0);
    for (const seg of segs) {
      expect(appMatchers, seg).toContain(seg);
      expect(appMatchers, `${seg}/*`).toContain(`${seg}/*`);
    }
  });

  it('接口和前端构建产物转给业务应用', () => {
    expect(appMatchers).toContain('/api/*');
    expect(appMatchers).toContain('/assets/*');
  });

  it('不用前缀通配，免得 /expert* 把官网的 /expertise/ 也带走', () => {
    for (const m of appMatchers) {
      expect(m.endsWith('*') ? m.endsWith('/*') : true, m).toBe(true);
    }
  });

  it('业务路径不和官网页面重名', () => {
    const sitePages = ['/', '/product', '/expertise', '/privacy', '/terms', '/_astro', '/fonts', '/images'];
    for (const m of appMatchers) {
      expect(sitePages, m).not.toContain(m.replace(/\/\*$/, ''));
    }
  });
});

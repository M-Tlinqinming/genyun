# 预览环境

地址：https://preview.gengyun.net.cn （阿里云香港轻量服务器 47.82.104.179，只放虚构样例数据，ICP 备案完成后退订）

服务器上四个容器（`compose.yml`）：应用、PostgreSQL、Redis（草稿生成队列）、Caddy（自动申请和续期 HTTPS 证书，同时托管官网静态页）。数据库、上传文件、队列、证书都在 Docker 数据卷里，重新发布和服务器重启都不会丢；服务器重启后容器自动起来。

## 发布

在仓库根目录、要发布的提交上运行：

```sh
bash deploy/preview/deploy.sh
```

脚本上传当前提交的代码，在服务器上构建镜像（业务应用、Caddy + 官网两个）并重启，约 2–3 分钟，官网构建另需一点时间。只发布已提交的代码。

## 官网和业务应用怎么分

同一个域名按路径分流（`Caddyfile`）：

| 路径 | 去哪 |
|---|---|
| `/api/*`、`/assets/*`（前端构建产物） | 业务应用 |
| `/login`、`/recover`、`/reset-password`、`/account`、`/customer`、`/expert`、`/operator` 及其下级 | 业务应用 |
| 其余（`/`、`/product/`、`/expertise/`、`/privacy/`、`/terms/`、`/_astro/*`、`/fonts/*`、`/images/*` 等） | 官网静态页 |

官网在构建 Caddy 镜像时一起构建（`site.Dockerfile`：先用 Node 构建 `apps/site`，再把 `dist` 放进 Caddy 镜像），所以发布脚本不用改，`docker compose up --build` 会同时重建两个镜像。

为什么不用子域名（比如官网 `gengyun.net.cn`、产品 `app.gengyun.net.cn`）：

- 登录状态放在业务应用的 cookie 里，同一个域名下官网和产品是同源，以后官网要显示「进入工作台」不用跨域；接口也不用开跨域
- 官网的「登录」链接写的就是站内相对地址 `/login`（`apps/site/src/site.ts`），预览、正式、本机都不用改配置
- 只要一条域名解析、一张证书；预览环境现在也只有 `preview.gengyun.net.cn` 一条解析，不用 Martin 另加
- 代价：业务应用每加一个顶层路由，要同时加进 `Caddyfile` 的 `@app`。`apps/web/proxy-routes.test.ts` 会检查 `router.tsx` 的顶层路由都在 `@app` 里，漏了测试就失败
- 以后真要拆子域名：官网构建时设 `PUBLIC_APP_LOGIN_URL=https://app.<域名>/login`，Caddyfile 拆成两个站点块即可

其他：

- HTTPS 由 Caddy 自动申请和续期；响应统一 zstd / gzip 压缩
- 缓存：带哈希的文件（官网 `/_astro/*`、业务应用 `/assets/*`）缓存一年；官网字体、图片缓存一天；官网页面 `no-cache`，改了文案马上生效
- 安全响应头：HSTS、`nosniff`、`Referrer-Policy`、`X-Frame-Options: SAMEORIGIN`（专家看原件用同源 iframe）、`Permissions-Policy`，去掉 `Server`、`X-Powered-By`
- 内容安全策略（CSP）先用「只报告」模式：官网有内联脚本、Ant Design 运行时插样式，正式拦截前要在预览环境打开各页看浏览器控制台有没有违规提示
- 不存在的官网地址返回 404（官网有 `404.html` 时用它，没有就是一行文字）

## 发布后检查

```sh
bash deploy/preview/smoke.sh https://preview.gengyun.net.cn
```

逐项检查：官网各路径拿到官网、业务路径拿到业务应用、`/expertise/` 没有被错分、接口通、缓存头、压缩和安全头。CI 每次也会用同一份 Caddyfile 起一套容器跑这个脚本。

## 服务器上的位置

- `/opt/genyun/.env`：密钥（数据库密码、下载链接签名密钥、演示账号密码），由 `server-setup.sh` 首次运行时随机生成，不进仓库
- `/opt/genyun/src`：最近一次发布的代码；`/opt/genyun/DEPLOYED_COMMIT`：对应的提交

## 演示账号

`admin@demo.genyun.net.cn`（客户机构管理员）、`expert@demo.genyun.net.cn`（专业人员周工）、`ops@demo.genyun.net.cn`（运营管理员）、`feiyu@demo.genyun.net.cn`（飞宇演示客户管理员）、`expert2@demo.genyun.net.cn`（专业人员吴工），同一个密码。演示数据里飞宇的已提交任务分派给周工，另一家分派给吴工。查看密码：

```sh
ssh -F /dev/null -i ~/.ssh/id_ed25519 -o UserKnownHostsFile=~/.ssh/known_hosts root@47.82.104.179 "grep DEMO_PASSWORD /opt/genyun/.env"
```

演示账号只需写入一次（重复运行会因邮箱已存在而报错）：

```sh
docker exec -e ALLOW_DEMO_SEED=1 -e DEMO_PASSWORD=<密码> genyun-preview-app-1 node apps/api/dist/scripts/seed-demo.js
```

## 新服务器从零开始

```sh
ssh ... root@<IP> 'bash -s preview.gengyun.net.cn' < deploy/preview/server-setup.sh
bash deploy/preview/deploy.sh
# 再写入演示账号（见上）
```

`server-setup.sh` 会加 2G 交换空间、安装 Docker、生成密钥文件。阿里云防火墙只需开 22 / 80 / 443。

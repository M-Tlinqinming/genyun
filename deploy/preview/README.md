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
| `/login`、`/invite`（邀请邮件里的链接）、`/recover`、`/reset-password`、`/account`、`/customer`、`/expert`、`/operator` 及其下级 | 业务应用 |
| 其余（`/`、`/product/`、`/expertise/`、`/privacy/`、`/terms/`、`/_astro/*`、`/fonts/*`、`/images/*` 等） | 官网静态页 |

官网在构建 Caddy 镜像时一起构建（`site.Dockerfile`：先用 Node 构建 `apps/site`，再把 `dist` 放进 Caddy 镜像），发布脚本依次构建应用和 Caddy 两个镜像（服务器内存小，不同时构建），再重启容器。

为什么不用子域名（比如官网 `gengyun.net.cn`、产品 `app.gengyun.net.cn`）：

- 登录状态放在业务应用的 cookie 里，同一个域名下官网和产品是同源，以后官网要显示「进入工作台」不用跨域；接口也不用开跨域
- 官网的「登录」链接写的就是站内相对地址 `/login`（`apps/site/src/site.ts`），预览、正式、本机都不用改配置
- 只要一条域名解析、一张证书；预览环境现在也只有 `preview.gengyun.net.cn` 一条解析，不用 Martin 另加
- 代价：业务应用每加一个顶层路由，要同时加进 `Caddyfile` 的 `@app`。`apps/web/proxy-routes.test.ts` 会检查 `router.tsx` 的顶层路由都在 `@app` 里，漏了测试就失败
- 以后真要拆子域名：官网构建时设 `PUBLIC_APP_LOGIN_URL=https://app.<域名>/login`，Caddyfile 拆成两个站点块即可

其他：

- HTTPS 由 Caddy 自动申请和续期；响应统一 zstd / gzip 压缩
- 缓存：带哈希的文件（官网 `/_astro/*`、业务应用 `/assets/*`）缓存一年（`/assets/*` 只给成功的响应加，不存在的文件返回 404）；官网字体、图片缓存一天；官网页面 `no-cache`，改了文案马上生效
- 安全响应头：HSTS、`nosniff`、`Referrer-Policy`、`X-Frame-Options: SAMEORIGIN`（专家看原件用同源 iframe）、`Permissions-Policy`，去掉 `Server`、`X-Powered-By`
- 内容安全策略（CSP）先用「只报告」模式：官网有内联脚本、Ant Design 运行时插样式，正式拦截前要在预览环境打开各页看浏览器控制台有没有违规提示。文件原件（`/api/files/blob`）不加 CSP，专家在 iframe 里看 PDF 不受影响
- 不存在的官网地址返回 404（官网有 `404.html` 时用它，没有就是一行文字）

## 发布后检查

```sh
bash deploy/preview/smoke.sh https://preview.gengyun.net.cn
```

逐项检查：官网各路径拿到官网、业务路径拿到业务应用、`/expertise/` 没有被错分、接口通、经过代理登录错误密码返回 401、HTTPS 地址的 http 跳转、缓存头、压缩和安全头。CI 每次也会用同一份 Caddyfile 起一套容器跑这个脚本。

## 回退

发布脚本在构建前把正在运行的两个镜像标成 `genyun:previous`、`genyun-site:previous`，清理旧镜像时它们会留下。新版本有问题时，在服务器上：

```sh
cd /opt/genyun/src/deploy/preview
docker tag genyun:previous genyun:preview
docker tag genyun-site:previous genyun-site:preview
docker compose --env-file /opt/genyun/.env up -d --no-build
```

回退后 `/opt/genyun/DEPLOYED_COMMIT` 不会跟着改，它仍是有问题的那个提交；可以顺手把它改回上一次发布的提交号（例如 `echo <上一个提交号> > /opt/genyun/DEPLOYED_COMMIT`）。

第一次按新方式发布后，官网镜像还没有 `genyun-site:previous`，这时只能回退业务应用：只执行第一条 `docker tag`，再 `up -d --no-build`。

新版本有问题时，先回退，再修好后重新发布。不要在有问题的版本还在运行时直接再发一次，否则 `previous` 会被有问题的版本覆盖，就退不回去了。

只能退一版。要退得更远，在本机切到那个提交重新运行 `deploy.sh`。数据库迁移只会往前加，退回旧版本的代码一般能直接用新表结构；如果某次发布删过列或改过列名，退回前先确认。

## 查看模拟发信

还没接阿里云邮件推送，邀请、找回密码的邮件都不真的发出，而是写成文件放进发件箱（数据卷 `mail_outbox`，容器里是 `/data/mail-outbox`），发布和重启都不会丢。在服务器上：

```sh
cd /opt/genyun/src/deploy/preview
# 最近 10 封（文件名是「时间-收件人.json」）
docker compose --env-file /opt/genyun/.env exec app ls -t /data/mail-outbox | head
# 看最新一封的内容，里面有邀请链接
docker compose --env-file /opt/genyun/.env exec app sh -c 'cat "$(ls -t /data/mail-outbox/* | head -1)"'
# 服务日志里能看到发给谁、什么标题
docker compose --env-file /opt/genyun/.env logs app | grep 模拟发信
```

日志不一定记正文（M3 第 2 项起正式环境不记），链接以发件箱文件为准。

## 服务器上的位置

- `/opt/genyun/.env`：密钥（数据库密码、下载链接签名密钥、演示账号密码），由 `server-setup.sh` 首次运行时随机生成，不进仓库
- `/opt/genyun/src`：最近一次发布的代码；`/opt/genyun/DEPLOYED_COMMIT`：对应的提交

## 演示账号

`admin@demo.genyun.net.cn`（客户机构管理员）、`expert@demo.genyun.net.cn`（专业人员周工）、`ops@demo.genyun.net.cn`（运营管理员）、`feiyu@demo.genyun.net.cn`（飞宇演示客户管理员）、`expert2@demo.genyun.net.cn`（专业人员吴工），同一个密码。演示数据里飞宇的已提交任务分派给周工，另一家分派给吴工。查看密码：

```sh
ssh -F /dev/null -i ~/.ssh/id_ed25519 -o UserKnownHostsFile=~/.ssh/known_hosts root@47.82.104.179 "grep DEMO_PASSWORD /opt/genyun/.env"
```

写入演示数据（每次发布后都可以跑，反复运行不出错、不重复），在本机仓库根目录：

```sh
bash deploy/preview/seed.sh
```

脚本通过 ssh 在服务器上执行写入，演示密码在服务器上从 `/opt/genyun/.env` 读，不经过本机、不进命令行历史。已经登录在服务器上时，也可以直接运行：

```sh
docker exec -e ALLOW_DEMO_SEED=1 -e DEMO_PASSWORD="$(grep ^DEMO_PASSWORD= /opt/genyun/.env | cut -d= -f2-)" genyun-preview-app-1 node apps/api/dist/scripts/seed-demo.js
```

脚本只补还没有的：账号按邮箱、组织按名称、企业按信用代码（没有代码的按名称）、任务按企业、合同按组织先查后插。已有的账号不改密码和姓名，已有组织只补空着的地区、联系人、合同有效期，测试人员在预览环境里录的数据一概不动、不删。演示任务的编号和客户新建任务用同一个流水，不会撞号。运行完会列出「新写入」和「已有、跳过」各哪几项。

写入的内容（都是虚构的）：

- 五个演示账号（见上）
- 两家已开通的客户组织「示例安全咨询机构」「飞宇演示客户」，各登记一份演示合同（合同原件是一页英文样张 PDF），运营在「客户组织」列表里看到都是服务中
- 飞宇演示客户名下两家企业：飞宇（各步资料都填了，技术人员数故意留空，演示专家整理时补齐）和示例五金
- 两个已提交的任务：飞宇分派给周工（有两项请专家电话联系、一项拍照给耕云看），示例五金分派给吴工。周工补齐专家判断后就能确认生成三份草稿

## 交给测试人员前检查

发布、写入演示数据之后，在本机运行（只读，不改数据）：

```sh
DEMO_PASSWORD=$(ssh -F /dev/null -i ~/.ssh/id_ed25519 -o UserKnownHostsFile=~/.ssh/known_hosts root@47.82.104.179 "grep ^DEMO_PASSWORD= /opt/genyun/.env | cut -d= -f2-") bash deploy/preview/check.sh https://preview.gengyun.net.cn
```

密码从服务器上取，不写进命令行历史。也可以手动输入（输入时不显示）：

```sh
read -rs DEMO_PASSWORD; export DEMO_PASSWORD
bash deploy/preview/check.sh https://preview.gengyun.net.cn
```

逐项检查：`/api/health` 通；官网首页、`/login` 能打开；五个演示账号都能登录；周工、吴工各自看到自己的演示任务且互相看不到；飞宇客户在自己的组织里；运营的客户组织列表里两家演示组织都是服务中；运营能打开模拟发件箱。服务器上的版本还没有模拟发件箱入口（合并请求 #63 之前）时这一项显示「跳过」，不算失败。

脚本一共登录 5 次，正式环境每分钟限 10 次，一分钟内别连跑两遍。

## 新服务器从零开始

```sh
ssh ... root@<IP> 'bash -s preview.gengyun.net.cn' < deploy/preview/server-setup.sh
bash deploy/preview/deploy.sh
bash deploy/preview/seed.sh
# 再跑检查（见上）
```

`server-setup.sh` 会加 2G 交换空间、安装 Docker、生成密钥文件。阿里云防火墙只需开 22 / 80 / 443。

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

预览环境默认模拟发信（`MAIL_DRIVER=mock`）：邀请、找回密码的邮件都不真的发出，而是写成文件放进发件箱（数据卷 `mail_outbox`，容器里是 `/data/mail-outbox`），发布和重启都不会丢。

**最方便的看法**：用运营账号登录，打开 `https://<预览域名>/operator/mail-outbox`（「模拟发件箱」，不在侧栏菜单里）。列表里直接显示验证码、可复制邀请链接，点一行看邮件全文（邮件样式 / 纯文本）。只有运营能看；`MAIL_DRIVER` 不是 `mock` 时这个页面和接口都不存在（404）。

改成真发：在 `/opt/genyun/.env` 加 `MAIL_DRIVER=aliyun`、`ALIYUN_DM_ACCESS_KEY_ID`、`ALIYUN_DM_ACCESS_KEY_SECRET`、`ALIYUN_DM_ACCOUNT_NAME`（邮件推送控制台配好的发信地址），重新发布。三项缺任何一项，服务启动时就报错退出（免得以为邮件发出去了其实没有）；`MAIL_DRIVER` 没设或写错也一样。发送失败会自动重试一次，失败记日志（只有邮件种类、打码的收件人和错误码，没有验证码和链接）。

也可以在服务器上直接看文件：

```sh
cd /opt/genyun/src/deploy/preview
# 最近 10 封（文件名以时间开头）
docker compose --env-file /opt/genyun/.env exec app ls -t /data/mail-outbox | head
# 看最新一封的内容，里面有邀请链接
docker compose --env-file /opt/genyun/.env exec app sh -c 'cat "$(ls -t /data/mail-outbox/* | head -1)"'
# 服务日志里能看到发给谁、什么标题
docker compose --env-file /opt/genyun/.env logs app | grep 模拟发信
```

服务日志只记收件人（打码）和主题，不记正文；链接和验证码以发件箱为准。

## 健康检查和日志

- `GET /api/health` 返回 `{"status":"ok|degraded|down","checks":{"database":…,"redis":…,"disk":…}}`。
  - 每项最多等 2 秒。
  - 数据库或 Redis 连不上时是 `down`，返回 503。容器会被判为不健康，`deploy.sh` 等不到 healthy 就会报错。
  - 上传文件所在分区的剩余空间低于 10% 时是 `degraded`，仍返回 200：服务照常可用，但该清理或扩容了。
  - 返回内容里没有路径、地址和版本号。
- 容器日志用 json-file 轮转：每个文件最大 10 MB，最多 5 个（`compose.yml` 的 `x-logging`）。四个容器都设了 `restart: unless-stopped`。
  - 查最近的日志：`docker logs --tail 200 genyun-preview-app-1`。

## 备份与恢复

每天 03:30 备份一次，存到 `/opt/genyun/backups/<日期>/`，保留最近 7 天。每份备份包含：

- `db.sql.gz`：在 db 容器里跑 `pg_dump` 导出的数据库；
- `files.tar.gz`：`files` 数据卷，即客户上传的文件和生成的草稿；
- `SHA256SUMS`：前两个文件的校验和。

备份先写到 `<日期>.partial`，全部成功才改名，所以失败时不会留下半截的备份。

备份不包含的内容和要知道的限制：

- **Redis 不在备份范围内**。Redis 里只有草稿生成队列，恢复后排队中、生成中的草稿会丢失，需要专家在页面上重新点生成；已生成的草稿在数据库和文件里，不受影响。
- **数据库和上传文件不是同一瞬间的快照**。先 `pg_dump` 再打包文件，两步之间有几秒时间差。应用备份时照常运行，这几秒里上传的文件可能只在其中一边：恢复后个别文件可能有记录没文件、或有文件没记录。凌晨 03:30 几乎没人使用，一般不会遇到。

```sh
# 安装定时任务（发布过一次之后，只需运行一次）
bash /opt/genyun/src/deploy/preview/install-cron.sh
# 手动备份；同一天再跑会覆盖当天那份
bash /opt/genyun/src/deploy/preview/backup.sh
# 恢复
bash /opt/genyun/src/deploy/preview/restore.sh 2026-11-01
```

`restore.sh` 依次执行：

1. 核对校验和；
2. 要求输入一遍备份名称，确认后才继续；
3. 把当前状态另存为 `<今天>-before-restore-<时分秒>`；
4. 停止应用；
5. 删库重建并导入；
6. 清空 `files` 数据卷后解包；
7. 启动应用，等健康检查通过。

如果恢复错了，再用 `restore.sh <今天>-before-restore-…` 恢复回去。

第 5、6 步中途出错时，脚本**不会自动启动应用**（数据可能只恢复了一半），会提示运行 `restore.sh <今天>-before-restore-…` 回滚；回滚成功后应用会自动启动。

备份日志在 `/var/log/genyun-backup.log`，按周轮转。备份目前只存在同一台服务器上：服务器本身坏了，备份也会一起丢失。异地备份（例如阿里云 OSS）留给后续。

### 本机演练（2026-11-01）

本机没有 Docker 和 PostgreSQL，演练时用真实的 `backup.sh` 和 `restore.sh`，只把 `docker` 换成 `rehearsal/docker`。这个假 docker 的做法：

- 数据库用 e2e 留下的 PGlite 目录冒充，`pg_dump` 用 `@electric-sql/pglite-tools` 的 WASM 版；
- 数据卷用本机目录冒充。

```sh
# 先跑过一次 e2e，留下 apps/api/.data/e2e-db 和 .data/files
mkdir /tmp/pgtools && (cd /tmp/pgtools && npm init -y && npm i @electric-sql/pglite@0.5.14 @electric-sql/pglite-tools@0.4.14)
PGLITE_TOOLS_DIR=/tmp/pgtools bash deploy/preview/rehearsal/rehearse.sh
```

演练过程和结果：

1. 准备：28 张表，用户 6 个，上传文件 58 个。另外放了两份 8 天前和 6 天前的旧备份。
2. 备份：生成 `db.sql.gz`（11 KB）、`files.tar.gz`（546 KB）和 `SHA256SUMS`。8 天前的旧备份被删除，6 天前的保留。
3. 删数据：`TRUNCATE organizations, users CASCADE`，并删掉全部上传文件。之后用户剩 0 个，文件剩 0 个。
4. 恢复时故意输错备份名称：中止，数据没有变化。
5. 正常恢复：先另存了一份 `before-restore`，然后删库重建、导入、解包文件。
6. 核对：28 张表的行数与备份前逐表一致；58 个文件的 sha256 逐个一致。

与服务器上的差别：

- 演练导出用的是 `--inserts`，因为 PGlite 不支持 `COPY … FROM stdin`；服务器上 psql 导入的是 `pg_dump` 默认的 COPY 格式。
- 停止、启动应用和健康检查在演练里只打印，不实际执行。
- 第一次在服务器上安装定时任务后，请手动跑一次 `backup.sh`，再在测试库上恢复一次确认。

## 服务器上的位置

- `/opt/genyun/.env`：密钥（数据库密码、下载链接签名密钥、演示账号密码），由 `server-setup.sh` 首次运行时随机生成，不进仓库
- `/opt/genyun/src`：最近一次发布的代码；`/opt/genyun/DEPLOYED_COMMIT`：对应的提交
- `/opt/genyun/backups`：每日备份（见「备份与恢复」）

## 演示账号

`admin@demo.genyun.net.cn`（客户机构管理员）、`expert@demo.genyun.net.cn`（专业人员周工）、`ops@demo.genyun.net.cn`（运营管理员）、`feiyu@demo.genyun.net.cn`（飞宇演示客户管理员）、`expert2@demo.genyun.net.cn`（专业人员吴工），同一个密码。演示数据里飞宇的已提交任务分派给周工，另一家（示例五金）待运营在任务中心分派（M3 第 3 项之前写入的老预览库里它在吴工名下，不用改）。查看密码：

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
- 两个已提交的任务：飞宇分派给周工（有两项请专家电话联系、一项拍照给耕云看），示例五金待运营分派（老预览库里在吴工名下）。周工补齐专家判断后就能确认生成三份草稿

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

逐项检查：`/api/health` 通；官网首页、`/login` 能打开；五个演示账号都能登录；周工看到飞宇任务、看不到示例五金，吴工看不到飞宇；飞宇客户在自己的组织里；运营的客户组织列表里两家演示组织都是服务中；运营能打开模拟发件箱。服务器上的版本还没有模拟发件箱入口（合并请求 #63 之前）时这一项显示「跳过」，不算失败。

脚本一共登录 5 次，正式环境每分钟限 10 次，一分钟内别连跑两遍。

## 新服务器从零开始

```sh
ssh ... root@<IP> 'bash -s preview.gengyun.net.cn' < deploy/preview/server-setup.sh
bash deploy/preview/deploy.sh
bash deploy/preview/seed.sh
# 再跑检查（见上）
```

`server-setup.sh` 会加 2G 交换空间、安装 Docker、生成密钥文件。第一次发布后再运行 `install-cron.sh` 安装每日备份。阿里云防火墙只需开 22 / 80 / 443。

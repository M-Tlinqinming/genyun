# 预览环境

地址：https://preview.gengyun.net.cn （阿里云香港轻量服务器 47.82.104.179，只放虚构样例数据，ICP 备案完成后退订）

服务器上四个容器（`compose.yml`）：应用、PostgreSQL、Redis（草稿生成队列）、Caddy（自动申请和续期 HTTPS 证书）。数据库、上传文件、队列、证书都在 Docker 数据卷里，重新发布和服务器重启都不会丢；服务器重启后容器自动起来。

## 发布

在仓库根目录、要发布的提交上运行：

```sh
bash deploy/preview/deploy.sh
```

脚本上传当前提交的代码，在服务器上构建镜像并重启应用，约 2–3 分钟。只发布已提交的代码。

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

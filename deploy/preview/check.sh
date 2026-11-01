#!/usr/bin/env bash
# 发布后、交给测试人员之前的检查：服务通、官网和登录页能打开、五个演示账号都能登录、
# 各角色能看到演示数据、模拟发件箱能打开。只读，不改任何数据。
# 用法（密码怎么传见 README「交给测试人员前检查」，别把密码直接写在命令里，会留在命令行历史）：
#   read -rs DEMO_PASSWORD; export DEMO_PASSWORD
#   bash deploy/preview/check.sh https://preview.gengyun.net.cn
# 本机整套容器（同 CI 冒烟）用 http://localhost:8080；只开前端开发服务时官网首页一项会失败
# （开发服务的 / 是业务应用），其余照常检查。脚本不会打印密码。
set -uo pipefail

BASE="${1:?用法：DEMO_PASSWORD=<演示密码> check.sh <地址>}"
BASE="${BASE%/}"
: "${DEMO_PASSWORD:?请用 DEMO_PASSWORD 环境变量给出演示密码}"
fail=0
jar_dir=$(mktemp -d)
trap 'rm -rf "$jar_dir"' EXIT

ok() { echo "  通过  $1"; }
bad() { echo "  失败  $1"; fail=1; }
skip() { echo "  跳过  $1"; }

get() { curl -sS --max-time 20 "$@"; }
status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "服务"
if get "$BASE/api/health" | grep -q '"ok":true'; then ok "/api/health"; else bad "/api/health 不通"; fi

echo "页面"
code=$(status "$BASE/")
if [ "$code" = 200 ] && ! get "$BASE/" | grep -q 'id="root"'; then ok "官网首页 / → 200"; else bad "官网首页 / → $code，或拿到的不是官网"; fi
code=$(status "$BASE/login")
if [ "$code" = 200 ] && get "$BASE/login" | grep -q 'id="root"'; then ok "登录页 /login → 200"; else bad "登录页 /login → $code，或拿到的不是业务应用"; fi

# 登录一个演示账号，会话 cookie 存进 $jar_dir/<名字>
login() {
  local email="$1" jar="$jar_dir/$2"
  # 请求体从标准输入传（-d @-），密码不出现在 curl 的命令参数里
  code=$(printf '{"email":"%s","password":"%s"}' "$email" "$DEMO_PASSWORD" |
    curl -sS -o "$jar.json" -w '%{http_code}' --max-time 20 -c "$jar" -H 'Content-Type: application/json' -d @- "$BASE/api/auth/login")
  if [ "$code" = 200 ]; then ok "$email 登录"; return 0; fi
  if [ "$code" = 429 ]; then bad "$email 登录 → 429（一分钟内登录太多次，等一分钟再跑）"; else bad "$email 登录 → $code（演示数据没写入，或密码不对）"; fi
  return 1
}

echo "演示账号登录"
login admin@demo.genyun.net.cn admin
login feiyu@demo.genyun.net.cn feiyu && feiyu=1 || feiyu=0
login expert@demo.genyun.net.cn expert && expert=1 || expert=0
login expert2@demo.genyun.net.cn expert2 && expert2=1 || expert2=0
login ops@demo.genyun.net.cn ops && ops=1 || ops=0

echo "演示数据"
if [ "$expert" = 1 ]; then
  tasks=$(get -b "$jar_dir/expert" "$BASE/api/expert/tasks")
  echo "$tasks" | grep -q '惠阳飞宇电器有限公司' && ok "周工的任务中心有飞宇的任务" || bad "周工的任务中心没有飞宇的任务"
  echo "$tasks" | grep -q '示例五金制品有限公司' && bad "周工看到了不归他的示例五金任务" || ok "周工看不到示例五金的任务（待分派或在吴工名下）"
fi
if [ "$expert2" = 1 ]; then
  # 新写入的演示数据里示例五金待运营分派（M3 第 3 项）；老预览库里它仍在吴工名下。两种都算对，只查吴工看不到飞宇
  get -b "$jar_dir/expert2" "$BASE/api/expert/tasks" | grep -q '惠阳飞宇电器有限公司' && bad "吴工看到了周工的飞宇任务" || ok "吴工看不到周工的飞宇任务"
fi
if [ "$feiyu" = 1 ]; then
  get -b "$jar_dir/feiyu" "$BASE/api/auth/me" | grep -q '飞宇演示客户' && ok "飞宇客户进入「飞宇演示客户」" || bad "飞宇客户不在「飞宇演示客户」组织里"
fi
if [ "$ops" = 1 ]; then
  orgs=$(get -b "$jar_dir/ops" "$BASE/api/operator/organizations")
  for name in 飞宇演示客户 示例安全咨询机构; do
    # 每个组织是一段 {…}，名称和状态在同一段里
    echo "$orgs" | tr '}' '\n' | grep "\"name\":\"$name\"" | grep -q '"state":"active"' && ok "运营的客户组织列表里「$name」服务中" || bad "运营的客户组织列表里没有服务中的「$name」"
  done
fi

echo "模拟发件箱"
if [ "$ops" = 1 ]; then
  code=$(status -b "$jar_dir/ops" "$BASE/api/dev/outbox")
  case "$code" in
    200) ok "运营能打开模拟发件箱（/operator/mail-outbox）" ;;
    404) skip "服务器上的版本还没有模拟发件箱入口（合并请求 #63 合并并发布后才有）；邮件先按 README「查看模拟发信」到服务器上看" ;;
    *) bad "模拟发件箱 /api/dev/outbox → $code" ;;
  esac
else
  skip "运营账号登录不了，没法检查模拟发件箱"
fi

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查没通过"; fi
exit "$fail"

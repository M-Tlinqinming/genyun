#!/usr/bin/env bash
# 检查反向代理分流是否正确：官网路径拿到官网，业务路径拿到业务应用，接口能通，缓存头和安全头在。
# 用法：bash deploy/preview/smoke.sh https://preview.gengyun.net.cn
#       CI 里对本机起的整套容器跑：bash deploy/preview/smoke.sh http://localhost:8080
set -uo pipefail

BASE="${1:?用法：smoke.sh <地址>}"
BASE="${BASE%/}"
fail=0

ok() { echo "  通过  $1"; }
bad() { echo "  失败  $1"; fail=1; }

# 取页面正文；业务应用的页面里有 <div id="root">，官网没有
body() { curl -sS --max-time 20 "$BASE$1"; }
status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$1"; }
header() { curl -sS -o /dev/null -D - --max-time 20 -H 'Accept-Encoding: gzip, zstd' "$BASE$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }

echo "官网路径"
for p in / /robots.txt /sitemap.xml /favicon.svg; do
  code=$(status "$p")
  [ "$code" = 200 ] && ok "$p → $code" || bad "$p → $code（应为 200）"
done
if body / | grep -q 'id="root"'; then bad "/ 返回的是业务应用，应为官网首页"; else ok "/ 是官网首页"; fi
# /expertise/ 以 /expert 开头，最容易被错分到业务应用
if body /expertise/ | grep -q 'id="root"'; then bad "/expertise/ 被分到了业务应用"; else ok "/expertise/ 没有分到业务应用"; fi
code=$(status /no-such-page)
[ "$code" = 404 ] && ok "不存在的官网页 → 404" || bad "不存在的官网页 → $code（应为 404）"

echo "业务应用路径"
for p in /login /invite/abc /recover /reset-password /account /customer /customer/tasks /expert /expert/tasks/1 /operator; do
  if body "$p" | grep -q 'id="root"'; then ok "$p → 业务应用"; else bad "$p 没有分到业务应用"; fi
done

echo "接口"
health=$(body /api/health)
if echo "$health" | grep -q '"status":"ok"'; then ok "/api/health"
elif echo "$health" | grep -q '"status":"degraded"'; then ok "/api/health（degraded：数据盘剩余不到 10%，该清理了）"
else bad "/api/health 不通或有检查项失败：$health"; fi
# 经过代理登录：错误密码应返回 401（说明 POST、请求体、cookie 路径都通到了应用）
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H 'Content-Type: application/json' \
  -d '{"email":"smoke-nobody@example.com","password":"wrong-password"}' "$BASE/api/auth/login")
[ "$code" = 401 ] && ok "/api/auth/login 错误密码 → 401" || bad "/api/auth/login 错误密码 → $code（应为 401）"

if [[ "$BASE" == https://* ]]; then
  echo "HTTP 跳转"
  http="http://${BASE#https://}"
  loc=$(curl -sS -o /dev/null -D - --max-time 20 "$http/login" | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2-)
  [[ "$loc" == https://* ]] && ok "http → $loc" || bad "http 没有跳转到 https（Location：$loc）"
fi

echo "缓存头"
asset=$(body /login | grep -o '/assets/[^"]*\.js' | head -1)
if [ -n "$asset" ]; then
  cc=$(header "$asset" Cache-Control)
  echo "$cc" | grep -q immutable && ok "业务前端 $asset：$cc" || bad "业务前端 $asset：$cc（应长期缓存）"
else
  bad "/login 页面里没找到 /assets/ 下的脚本"
fi
code=$(status /assets/no-such-file.js)
cc=$(header /assets/no-such-file.js Cache-Control)
if [ "$code" = 404 ] && ! echo "$cc" | grep -q immutable; then ok "不存在的 /assets/ 文件 → 404，不长期缓存"; else bad "不存在的 /assets/ 文件 → $code，Cache-Control：$cc（应为 404 且不长期缓存）"; fi
astro=$(body / | grep -o '/_astro/[^"]*\.\(js\|css\)' | head -1)
if [ -n "$astro" ]; then
  cc=$(header "$astro" Cache-Control)
  echo "$cc" | grep -q immutable && ok "官网 $astro：$cc" || bad "官网 $astro：$cc（应长期缓存）"
else
  bad "首页里没找到 /_astro/ 下的文件"
fi
cc=$(header / Cache-Control)
[ "$cc" = no-cache ] && ok "官网首页：no-cache" || bad "官网首页 Cache-Control：$cc（应为 no-cache）"

echo "压缩与安全头"
enc=$(header / Content-Encoding)
[ -n "$enc" ] && ok "压缩：$enc" || bad "首页没有压缩"
for h in X-Content-Type-Options Referrer-Policy X-Frame-Options Strict-Transport-Security Content-Security-Policy-Report-Only X-Robots-Tag; do
  for p in / /login; do
    v=$(header "$p" "$h")
    [ -n "$v" ] && ok "$p $h" || bad "$p 缺 $h"
  done
done
v=$(header /api/files/blob Content-Security-Policy-Report-Only)
[ -z "$v" ] && ok "文件原件（/api/files/blob）不加 CSP" || bad "/api/files/blob 带了 CSP，切到拦截后专家会看不了 PDF"
for h in Server X-Powered-By; do
  v=$(header /login "$h")
  [ -z "$v" ] && ok "/login 不暴露 $h" || bad "/login 暴露了 $h：$v"
done

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查没通过"; fi
exit "$fail"

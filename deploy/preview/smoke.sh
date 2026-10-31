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
if body /api/health | grep -q '"ok":true'; then ok "/api/health"; else bad "/api/health 不通"; fi

echo "缓存头"
asset=$(body /login | grep -o '/assets/[^"]*\.js' | head -1)
if [ -n "$asset" ]; then
  cc=$(header "$asset" Cache-Control)
  echo "$cc" | grep -q immutable && ok "业务前端 $asset：$cc" || bad "业务前端 $asset：$cc（应长期缓存）"
else
  bad "/login 页面里没找到 /assets/ 下的脚本"
fi
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
for h in Server X-Powered-By; do
  v=$(header /login "$h")
  [ -z "$v" ] && ok "/login 不暴露 $h" || bad "/login 暴露了 $h：$v"
done

if [ "$fail" = 0 ]; then echo "全部通过"; else echo "有检查没通过"; fi
exit "$fail"

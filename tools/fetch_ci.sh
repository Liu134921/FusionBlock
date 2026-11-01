#!/bin/bash
# 在 GitHub Actions 里拉上游源（runner 在海外，直连即可）
set -u
mkdir -p lists
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

dl(){
  url=$1; out=$2
  code=000; sz=0
  for attempt in 1 2 3; do
    code=$(curl -sSL --max-time 180 --retry 1 -A "$UA" -o "lists/$out" -w '%{http_code}' "$url" 2>/dev/null)
    sz=$(stat -c%s "lists/$out" 2>/dev/null || echo 0)
    [ "$sz" -gt 1000 ] && break
    sleep 4
  done
  if [ "$sz" -gt 1000 ]; then
    echo "  OK   $out  ${sz}B  (HTTP $code)"
  else
    echo "  FAIL $out  ${sz}B  (HTTP $code)"
    rm -f "lists/$out"
  fi
}

dl 'https://filters.adtidy.org/android/filters/2_optimized.txt'                                   adguard_base.txt
dl 'https://filters.adtidy.org/android/filters/11_optimized.txt'                                  adguard_mobile.txt
dl 'https://filters.adtidy.org/android/filters/224_optimized.txt'                                 adguard_chinese.txt
dl 'https://easylist-downloads.adblockplus.org/easylistchina.txt'                                 easylistchina.txt
dl 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/light.txt'               hagezi_light.txt
dl 'https://raw.githubusercontent.com/217heidai/adblockfilters/main/rules/adblockfilters.txt'     heidai.txt
dl 'https://raw.githubusercontent.com/xinggsf/Adblock-Plus-Rule/master/rule.txt'                  xinggsf.txt
dl 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt'   unbreak.txt
dl 'https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-adguard.txt' antiad.txt
dl 'https://easylist.to/easylist/easyprivacy.txt'                                                 EasyPrivacy.txt
dl 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-ag.txt'                       Phishing.txt

echo '--- 缺失检查'
miss=0
for f in adguard_base.txt adguard_mobile.txt adguard_chinese.txt easylistchina.txt \
         hagezi_light.txt heidai.txt antiad.txt EasyPrivacy.txt Phishing.txt xinggsf.txt unbreak.txt; do
  [ -s "lists/$f" ] || { echo "缺 $f"; miss=$((miss+1)); }
done
[ "$miss" -eq 0 ] || { echo "缺失 $miss 个，中止"; exit 1; }
exit 0
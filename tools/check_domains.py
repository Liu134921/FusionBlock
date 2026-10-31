# -*- coding: utf-8 -*-
"""
关键服务体检 v2：拿一份"不能被拦"的域名清单，去撞规则文件，找已知误杀。

重要区别：
  ||qq.com/path        路径规则，只拦这一个 URL —— 不算拦了整个域
  ||qlogo.cn^$domain=x 带 domain= 的规则只在一个站生效 —— 不算全局拦截
  ||qpic.cn^           纯域名规则，拦 qpic.cn 及其所有子域 —— 这才算

判定：
  严重  该域名本身（或它的上级域）被纯域名规则拦 —— 服务直接不可用
  关注  它的某个子域被纯域名规则拦，且子域名看不出是广告统计
  轻微  它的某个子域被拦，子域名本身就是 ad/stat/track 这类
"""
import re
import sys
import os

KEY = {
    '微信': ['weixin.qq.com', 'weixinbridge.com', 'servicewechat.com', 'wxs.qq.com',
             'wx.qq.com', 'wechat.com', 'weixin.qq.com.cn', 'mmsns.qpic.cn',
             'wx.qlogo.cn', 'mmbiz.qpic.cn', 'res.wx.qq.com', 'finder.video.qq.com'],
    'QQ': ['im.qq.com', 'qzone.qq.com', 'qpic.cn', 'qqmail.com'],
    '支付宝': ['alipay.com', 'alipayobjects.com', 'alipay.cn', 'mclient.alipay.com'],
    '淘宝天猫': ['taobao.com', 'tmall.com', 'alicdn.com'],
    '京东': ['jd.com', '360buyimg.com'],
    'B站': ['bilibili.com', 'bilivideo.com', 'hdslb.com'],
    '抖音': ['douyin.com', 'byteimg.com', 'amemv.com', 'douyinpic.com'],
    '网易云': ['music.163.com', '126.net'],
    '高德地图': ['amap.com'],
    '系统服务': ['oplus.com', 'coloros.com', 'heytapmobi.com', 'heytap.com', 'oppomobile.com'],
    '支付': ['tenpay.com', 'unionpay.com'],
}
ADWORD = re.compile(
    r'(^|\.)(ad|ads|advert|adserver|adservice|stat|stats|track|tracker|log|logs|report|'
    r'analytics|ana|ping|beacon|click|monitor|metric|promo|marketing|mkt|sdk|event|'
    r'collect|crash|trace|gdt)', re.I)

HOSTS_RE = re.compile(r'^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+(\S+)\s*$')
DOM_RE = re.compile(r'^\|\|([^\^/$|]+)\^(\$[^\s]*)?$')
DOM_PATH_RE = re.compile(r'^\|\|([^\^/$|]+)([/^].*)$')
URL_RE = re.compile(r'^[|]?https?://([^/^]+)')


def load_rules(path):
    """返回 [(domain, line, is_plain)]，is_plain=True 表示拦整个域及子域"""
    plain, pathy = [], []
    for line in open(path, encoding='utf-8', errors='ignore'):
        l = line.strip()
        if not l or l.startswith('!') or l.startswith('[') or l.startswith('@@'):
            continue
        if '##' in l or '#@#' in l or '#$#' in l or '#?#' in l:
            continue
        m = HOSTS_RE.match(l)
        if m:
            d = m.group(1).lower().rstrip('.')
            if '.' in d:
                plain.append((d, '||%s^' % d))
            continue
        m = DOM_RE.match(l)
        if m:
            mods = m.group(2) or ''
            d = m.group(1).lower().rstrip('.')
            (pathy if 'domain=' in mods else plain).append((d, l))
            continue
        m = DOM_PATH_RE.match(l)
        if m:
            pathy.append((m.group(1).lower().rstrip('.'), l))
            continue
        m = URL_RE.match(l)
        if m and '.' in m.group(1):
            pathy.append((m.group(1).lower(), l))
    return plain, pathy


def main():
    path = sys.argv[1]
    plain, pathy = load_rules(path)
    doms = set(d for d, l in plain)
    out = []
    out.append('体检对象: %s' % os.path.basename(path))
    out.append('纯域名拦截 %d 个 / 路径类规则 %d 条（路径类不参与判定）'
               % (len(doms), len(pathy)))
    out.append('')

    severe, watch, minor = [], [], []
    for svc, hosts in KEY.items():
        for h in hosts:
            parts = h.split('.')
            ancestors = ['.'.join(parts[i:]) for i in range(len(parts))]
            hit = [d for d in ancestors if d in doms]
            if hit:
                lines = [l for d, l in plain if d == hit[0]][:3]
                severe.append((svc, h, hit[0], lines))
                continue
            subs = [d for d in doms if d.endswith('.' + h)]
            if subs:
                non = [d for d in subs if not ADWORD.search(d)]
                adv = [d for d in subs if ADWORD.search(d)]
                if non:
                    lines = [l for d, l in plain if d in non][:3]
                    watch.append((svc, h, len(non), lines))
                elif adv:
                    minor.append((svc, h, len(adv)))

    def dump(title, items, with_lines=True):
        out.append('== %s (%d)' % (title, len(items)))
        for it in items:
            svc, h = it[0], it[1]
            if with_lines:
                out.append('   [%s] %s  <- %s' % (svc, h, it[2]))
                for l in it[3]:
                    out.append('        ' + l[:80])
            else:
                out.append('   [%s] %s  子域 %d 个' % (svc, h, it[2]))
        if not items:
            out.append('   无')
        out.append('')

    dump('严重：整个域名被拦', severe)
    dump('关注：有子域被拦且不像广告', watch)
    dump('轻微：只拦了广告类子域', minor, with_lines=False)

    txt = '\n'.join(out)
    print(txt)
    dst = path.rsplit('.', 1)[0] + '-CHECK.txt'
    open(dst, 'w', encoding='utf-8').write(txt + '\n')
    print('\n报告: %s' % dst)


if __name__ == '__main__':
    main()
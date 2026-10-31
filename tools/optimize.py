# -*- coding: utf-8 -*-
"""
FusionBlock 规则优化器 v2
========================
核心原则：**等价化简**——改完之后 AdGuard 拦的东西一条不变，只是条目变少。
合并建议那一节会扩大范围，只出清单不动手。

识别四类规则：
  net    ||a.com^ 或 ||a.com^$xxx        域名规则
  path   ||a.com/ad.js 或 |http://a.com/  路径规则（域名部分可被父域覆盖）
  cos    domain##.ad / ##.ad             元素隐藏
  raw    其余（正则、IP、特殊语法）       原样保留

优化步骤：
  1 hosts 写法归一到 ||domain^
  2 精确去重
  3 危险宽泛剔除（||xyz^ 这类会拦整个后缀）
  4 例外覆盖：有 @@||a.com^，则 ||a.com^ 及所有子域、路径规则永远不生效 -> 删
  5 修饰符冗余：有 ||a.com^，则 ||a.com^$xxx 被完全覆盖 -> 删
  6 祖先覆盖：有 ||a.com^，则 ||x.a.com^、||x.a.com/path 全覆盖 -> 删

用法：
  python3 optimize.py --in A.txt B.txt --limit 3000 --dry
  python3 optimize.py --in A.txt B.txt --name FusionBlock-Ads.txt
"""
import os
import re
import argparse
import collections

HOSTS_RE = re.compile(r'^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+(\S+)\s*$')
DOM_RE = re.compile(r'^\|\|([^\^/$|]+)\^(\$[^\s]*)?$')
DOM_PATH_RE = re.compile(r'^\|\|([^\^/$|]+)([/^].*)$')
URL_RE = re.compile(r'^[|]?https?://([^/^]+)')
COS_RE = re.compile(r'##|#@#|#\$#|#%#|#\?#')

DANGER = {'xyz', 'click', 'cfd', 'today', '*', '[::]', '[::ffff:b2a2:ecde]'}
KEEP_ON_IMPORTANT = ('important',)

# 单条规则长度上限：AdGuard 解析器对超长规则会丢弃，留着只会拖慢加载
MAXLEN = 8000

# 会掐断微信消息/图片的规则，无论哪个源带来都不输出
EXCLUDE = {
    '||wxs.qq.com^', '||wximg.wxs.qq.com^',
    '||badjs.weixinbridge.com^', '||minorshort.weixin.qq.com^',
    '||szlong.weixin.qq.com^',
}

# 按域名后缀整体排除：这些域及其所有子域都不拦
EXCLUDE_SUFFIX = ('wxs.qq.com',)


def suffixes(d, include_self=True):
    parts = d.split('.')
    if include_self:
        yield d
    for i in range(1, len(parts)):
        yield '.'.join(parts[i:])


def load(files, limit=None):
    net, exc, cos, raw = [], [], [], []
    seen = set()
    stat = collections.Counter()
    for path in files:
        n = 0
        with open(path, encoding='utf-8', errors='ignore') as fh:
            for line in fh:
                l = line.strip().lstrip('\ufeff')
                if not l or l.startswith('!') or l.startswith('['):
                    continue
                if len(l) > MAXLEN:
                    stat['超长丢弃'] += 1
                    continue
                m = HOSTS_RE.match(l)
                if m:
                    d = m.group(1).lower().rstrip('.')
                    if d and '.' in d:
                        l = '||%s^' % d
                        stat['hosts归一'] += 1
                    else:
                        continue
                if l in seen:
                    stat['重复行'] += 1
                    continue
                seen.add(l)

                if COS_RE.search(l) and not l.startswith('||'):
                    cos.append(l)
                    continue

                is_exc = l.startswith('@@')
                body = l[2:] if is_exc else l
                m = DOM_RE.match(body)
                if m:
                    kind = 'exc' if is_exc else 'net'
                    (exc if is_exc else net).append(
                        (kind, m.group(1).lower().rstrip('.'), m.group(2) or '', l))
                else:
                    m = DOM_PATH_RE.match(body)
                    if m:
                        kind = 'exc_path' if is_exc else 'path'
                        (exc if is_exc else net).append(
                            (kind, m.group(1).lower().rstrip('.'), '', l))
                    else:
                        m = URL_RE.match(body)
                        if m and '.' in m.group(1):
                            kind = 'exc_path' if is_exc else 'path'
                            (exc if is_exc else net).append(
                                (kind, m.group(1).lower(), '', l))
                        else:
                            raw.append(l)
                n += 1
                if limit and n >= limit:
                    break
    return net, exc, cos, raw, stat


def optimize(net, exc):
    cov = {d for k, d, m, l in net if k == 'net' and m == ''}
    exset = {d for k, d, m, l in exc if k == 'net' and m == ''}
    out = []
    st = collections.Counter()
    samples = collections.defaultdict(list)

    def note(key, text):
        st[key] += 1
        if len(samples[key]) < 6:
            samples[key].append(text)

    for kind, d, m, l in net:
        if d in DANGER:
            note('危险宽泛', l)
            continue

        if l in EXCLUDE or any(d == s or d.endswith('.' + s) for s in EXCLUDE_SUFFIX):
            note('微信保护', l)
            continue

        protect = any(k2 in m for k2 in KEEP_ON_IMPORTANT)

        if not protect:
            hit = next((s for s in suffixes(d) if s in exset), None)
            if hit:
                note('例外覆盖', '%s   <-被 @@||%s^ 豁免' % (l, hit))
                continue

        if kind == 'net' and m and d in cov:
            note('修饰符冗余', '%s   <-已由 ||%s^ 覆盖' % (l, d))
            continue

        hit = next((s for s in suffixes(d, False) if s in cov), None)
        if hit:
            note('祖先覆盖', '%s   <-已由 ||%s^ 覆盖' % (l, hit))
            continue

        out.append(l)

    return out, st, samples


def merge_candidates(net, threshold=8):
    child = collections.Counter()
    for k, d, m, l in net:
        if m or k != 'net':
            continue
        p = d.split('.', 1)
        if len(p) > 1 and '.' in p[1]:
            child[p[1]] += 1
    cand = [(k, v) for k, v in child.items() if v >= threshold]
    cand.sort(key=lambda x: -x[1])
    return cand


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inputs', nargs='+', required=True)
    ap.add_argument('--outdir', default='/sdcard/_File/AdguardNeoConfig/FusionBlock')
    ap.add_argument('--name', default='FusionBlock-Ads.txt')
    ap.add_argument('--title', default='FusionBlock Ads')
    ap.add_argument('--desc', default='广告拦截规则：多源合并，已去重与化简')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    net, exc, cos, raw, loadst = load(a.inputs, a.limit or None)
    out, st, samples = optimize(net, exc)
    cand = merge_candidates(net)

    rep = []
    rep.append('== 输入')
    rep.append('   域名规则 %d / 路径规则 %d / 例外 %d / 元素隐藏 %d / 未解析 %d'
               % (sum(1 for k, d, m, l in net if k == 'net'),
                  sum(1 for k, d, m, l in net if k == 'path'),
                  len(exc), len(cos), len(raw)))
    if loadst:
        rep.append('   载入阶段：%s' % dict(loadst))
    rep.append('')
    rep.append('== 优化')
    for k, v in st.most_common():
        rep.append('   %-6s -%d' % (k, v))
    total = len(net)
    rep.append('   合计删除 %d，保留 %d（%.1f%%）'
               % (total - len(out), len(out), 100.0 * len(out) / max(1, total)))
    rep.append('')
    rep.append('== 样例')
    for k, v in samples.items():
        rep.append('   [%s]' % k)
        for s in v:
            rep.append('      ' + s)
    rep.append('')
    rep.append('== 合并候选（父域下纯子域规则 >=8 条，只建议不改动）')
    for k, v in cand[:15]:
        rep.append('   %-42s %d 条' % (k, v))
    if not cand:
        rep.append('   无')

    text = '\n'.join(rep)
    print(text)

    if a.dry:
        return

    os.makedirs(a.outdir, exist_ok=True)
    lines = ['! Title: ' + a.title,
             '! Description: ' + a.desc,
             '! Homepage: https://gitee.com/liuuyyubbo/FusionBlock',
             '! Version: 2026.10.31',
             '! Expires: 7 days',
             '! License: 各上游规则版权归原作者（AdGuard / EasyList / HaGeZi / 217heidai）',
             '',
             '! ===== 例外规则 (%d) =====' % len(exc), '']
    lines += sorted(set(l for k, d, m, l in exc))
    lines += ['', '! ===== 网络规则 (%d) =====' % len(out), '']
    lines += sorted(set(out))
    if cos:
        lines += ['', '! ===== 元素隐藏 (%d) =====' % len(cos), '']
        lines += sorted(set(cos))
    if raw:
        lines += ['', '! ===== 未解析 (%d) =====' % len(raw), '']
        lines += sorted(set(raw))

    p = os.path.join(a.outdir, a.name)
    with open(p, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    rp = os.path.join(a.outdir, os.path.splitext(a.name)[0] + '-REPORT.txt')
    with open(rp, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    print('\n写入: %s  (%.1f MB, %d 行)'
          % (p, os.path.getsize(p) / 1024 / 1024, len(lines)))


if __name__ == '__main__':
    main()
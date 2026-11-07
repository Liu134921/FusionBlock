# AGENTS.md

给接手这个仓库的人（和 AI）看的操作手册。用户文档在 [README.md](README.md)，这里只讲怎么改、别搞坏什么。

## 一句话

成品规则由 CI 生成，人只改 `tools/` 和文档。改规则文件本身一定会在下次构建被覆盖。

## 目录职责

| 路径 | 是什么 | 谁改 |
|---|---|---|
| `tools/fetch_ci.sh` | 上游清单地址表，CI 拉不到任何一份就整体中止 | 人，换源时改这里**和** build.yml 的 `--in` |
| `tools/optimize.py` | 合并 / 去重 / 化简器，四个 `FusionBlock-*.txt` 都由它生成 | 人 |
| `tools/check_domains.py` | 关键服务体检，产出 `*-CHECK.txt` | 人，加关键域名改这里的 `KEY` |
| `tools/whitelist.txt` | 白名单头部与手写例外 | 人 |
| `.github/workflows/build.yml` | 构建流程、四份产物的上游组合、提交推送 | 人 |
| `FusionBlock-*.txt` | 产物，CI 每八小时重写 | **不要手改** |
| `reports/` | 构建报告，CI 写入 | **不要手改** |
| `docs/index.html` | GitHub Pages 介绍页，订阅按钮和复制地址都在里面 | 人 |
| `docs/enhance.user.js` | 附加用户脚本 | 人 |

## 构建怎么走

```
fetch_ci.sh  ──拉 11 份上游到 lists/（gitignore）
   ↓
optimize.py  ──四份产物 + 四份 -REPORT.txt
   ↓  白名单：tools/whitelist.txt + unbreak 的 @@ + 四份 AdGuard/EasyList 的 @@，去重
check_domains.py ──FusionBlock-Ads-CHECK.txt（体检）
   ↓
reports/ 归拢 → git commit -m "auto build ..." → 只在有 diff 时提交
```

四份产物的上游组合写在 `build.yml` 里，不是脚本里：

- `Ads` ← adguard_base / adguard_mobile / adguard_chinese / easylistchina / hagezi_light / heidai / xinggsf（7 个）
- `Privacy` ← EasyPrivacy
- `Phishing` ← Phishing（malware-filter）
- `Extra-CN` ← antiad
- `Whitelist` ← whitelist.txt + unbreak + 前四份里的 `@@`

拉下来但只用于取 `@@` 的：`unbreak`。读 `fetch_ci.sh` 里的完整清单，不要在文档里另抄一份数字。

## 本地跑

```bash
bash tools/fetch_ci.sh                      # 国内要能连 GitHub/adtidy，否则手动放 lists/
FB_STAMP=$(TZ=Asia/Shanghai date +%Y.%m.%d.%H%M) python3 tools/optimize.py \
  --in lists/adguard_base.txt lists/adguard_mobile.txt lists/adguard_chinese.txt \
       lists/easylistchina.txt lists/hagezi_light.txt lists/heidai.txt lists/xinggsf.txt \
  --name FusionBlock-Ads.txt --title 'FusionBlock Ads' --desc '...' --outdir .
python3 tools/check_domains.py FusionBlock-Ads.txt
```

`--dry` 只打印报告不写文件。完整重建要拉 30 MB 上游，别在手机上一口气跑四份。

## 改规则的安全红线

`optimize.py` 的核心承诺是**等价化简**：改完之后 AdGuard 拦的东西一条不变，只是条目变少。下面这些改动会破坏承诺，除非明确要扩大/缩小拦截范围：

1. **不要动 `optimize()` 里的删除判定顺序**。`例外覆盖` 放在 `祖先覆盖` 前面是有原因的：`@@` 例外可以来自子域，父域规则是否被豁免要看所有后缀，顺序反了会删掉本该保留的规则。
2. **`KEEP_ON_IMPORTANT`（带 `important` 修饰符的规则）不做例外覆盖检查**，因为 `$important` 能盖过 `@@`。别顺手把它并进普通分支。
3. **`EXCLUDE` / `EXCLUDE_SUFFIX` 是微信保护名单**，`wxs.qq.com` 整个后缀排除。加域名进去之前先想清楚，这里是"宁可少拦"。
4. **`DANGER` 只放会拦掉整个顶级后缀的写法**（`||xyz^` 这种）。列表是白名单式的，新增要有理由。
5. **`MAXLEN = 8000`**：AdGuard 会丢弃超长规则，长规则是主动丢弃并计入报告，不是 bug。
6. 合并候选（`merge_candidates`）**只出报告不动手**。把子域合并成父域是扩大拦截范围，会误杀。
7. 白名单**只放 `@@`**，里面出现拦截规则就是 bug。`build.yml` 用 `grep '^@@'` 保证这点，加新的例外来源时保持同样的过滤。

## 文档与数据的一致性

README 和 `docs/index.html` 里有行数、体积、上游数量这些会漂的数字。**每次构建后可能都要更新**，改的时候注意：

- 真实值以仓库根目录产物的 `wc -l` / `stat -c%s` 为准，白名单条数不含 `!` 开头的头部行。
- 两处都要改：README 的「文件」表和 docs/index.html 的 `.meta`、`.stats`。
- 「上游源」数字有三种口径：CI 实际下载的文件数（`fetch_ci.sh`）、主列表合并的源数（`build.yml --in`）、四份产物的全部来源数（介绍页）。写清是哪一个，别混。
- 订阅地址永远优先写 `gh-proxy.org` 加速地址；Gitee 只是代码镜像，不提供订阅，别再说"订阅走 Gitee"。

## 提交

- 规则构建由 CI 自己 commit（`auto build <UTC 时间>`），提交信息别和它冲突。
- 人工改动用 `docs:` / `tools:` / `feat:` 前缀，说明改了什么口径。
- push 前先 `git pull --rebase`：CI 每八小时推一次 main，本地攒久了会分叉。
- `origin` 指向 `https://v4.gh-proxy.org/https://github.com/...`，推需要凭据；CI 里的 push 用 runner 自带 token。

## 已知的口径陷阱

- `reports/FusionBlock-Ads-REPORT.txt` 里的「保留 N 条」只统计网络规则（net），不含例外、元素隐藏、未解析。写"总行数"时不能用它。
- 体检报告里的「关注」不等于误杀。图片/日志/统计类子域（`img2.360buyimg.com`、`cactus.jd.com` 这类）经实测是广告资源，**不要为了消掉报告条目去加白名单**。
- `FusionBlock-Extra-CN.txt` 不在推荐列表里，README 和介绍页都把它放在"不建议启用"。别把它加进「四份」。

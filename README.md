# FusionBlock

一套给 AdGuard 用的广告拦截规则。

不是从零写规则，而是把几个一直在维护的公开规则源合到一起：去掉重复的、去掉被父域规则完全覆盖的，再补一份"别拦我"的白名单。

微信的图片和消息域名就在被拦名单里，很多合并列表都带着它，装完收不到图，白名单就是干这个的。

## 特点

- **只留该拦的**：构建时会检查有没有规则会拦掉整个后缀，`||xyz^` 这种一律剔除
- **关键服务体检**：每次构建前，用 45 个关键域名（微信、支付宝、淘宝、B站、抖音、系统服务、支付）撞一遍，谁的子域被拦会写进报告，看着不对就加白
- **等价化简**：父域名已经被拦时，它的子域规则直接删掉。拦的东西一条不少，条目能少两三成
- **白名单自带**：微信、支付宝、系统服务、图片 CDN、HTTPDNS 全在里面

## 文件说明

**FusionBlock-Ads.txt** — 广告拦截主列表，必开。

**FusionBlock-Privacy.txt** — 隐私追踪拦截，建议开。

**FusionBlock-Phishing.txt** — 钓鱼站点拦截，建议开。

**FusionBlock-Whitelist.txt** — 白名单，**必开**。这个不当过滤器加，要粘到用户规则里，见下面。

**FusionBlock-Extra-CN.txt** — 国内加强包，可选。误杀会明显变多，不建议和主列表一起开。

## 怎么用

### AdGuard for Android

1. 打开 AdGuard → 设置 → 过滤器 → 自定义过滤器
2. 点 `+` → 从文件导入，把 `FusionBlock-Ads.txt`、`FusionBlock-Privacy.txt`、`FusionBlock-Phishing.txt` 三个分别加进去
3. 打开 AdGuard → 过滤规则 → 用户规则，把 `FusionBlock-Whitelist.txt` 的内容整段复制粘贴进去
4. 把之前那些列表全部关掉，只留这三个加一份白名单
5. 重启一次 AdGuard，让它重建索引

### AdGuard Home

过滤器 → DNS 黑名单 → 添加订阅地址，填下面这几个：

```
https://gitee.com/liuuyyubbo/FusionBlock/raw/main/FusionBlock-Ads.txt
https://gitee.com/liuuyyubbo/FusionBlock/raw/main/FusionBlock-Privacy.txt
https://gitee.com/liuuyyubbo/FusionBlock/raw/main/FusionBlock-Phishing.txt
```

### 其他软件

只要是 Adblock Plus 或 AdGuard 语法的都能用，规则本身不挑软件。

## 更新

上游源每天都在变，这里不定时重新构建。想拿最新的，重新下载，或者在 AdGuard 里用订阅地址让它自己拉。

每次构建会带一份报告，写明哪个源贡献了多少条、删了多少冗余、关键服务体检的结果。

## 遇到问题

直接提 [Issue](https://gitee.com/liuuyyubbo/FusionBlock/issues)，说清这三样就行：

- 哪个网站、哪个 App
- 具体现象（白屏 / 图片裂 / 按钮点不动 / 收不到消息）
- 你的 AdGuard 版本

能截图最好，看到会尽快处理。

## 赞助

如果这套规则帮你省了点时间，可以请我喝瓶水。完全自愿，不影响任何功能。

![微信赞赏码](assets/sponsor.png)

## 感谢

规则来自这些公开项目，都是长期在维护的：

- [AdGuard Filters](https://github.com/AdguardTeam/AdguardFilters)
- [EasyList](https://easylist.to/) / [EasyList China](https://github.com/easylist/easylistchina)
- [HaGeZi DNS Blocklists](https://github.com/hagezi/dns-blocklists)
- [217heidai/adblockfilters](https://github.com/217heidai/adblockfilters)

本仓库只做合并、去重和化简，不主张对原始规则的著作权。发现问题欢迎提 Issue，也可以去上游反馈。

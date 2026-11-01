// ==UserScript==
// @name         FusionBlock 增强
// @name:zh-CN   FusionBlock 增强
// @namespace    https://liu134921.github.io/FusionBlock/
// @version      2.0.0
// @description  拆反广告拦截遮罩、拦弹窗与自动跳转、还原 AMP 页面、清掉 Cookie 横幅和固定广告条。配合 FusionBlock 过滤器使用。
// @author       林墨
// @homepageURL  https://liu134921.github.io/FusionBlock/
// @match        *://*/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

/*
  参考的三个脚本：
  - Nvirya AdGuard 11.7.2（MIT）：反检测与遮罩处理的思路、
    恶意 meta refresh 的处理、原生函数伪装
  - AdGuard Popup Blocker 2.5：popunder 的判定，无手势即视为广告弹窗
  - AdGuard Disable AMP 1.0：AMP 地址形态收在这里的 AMP_PATHS 里
  没有整段搬运：那份 1.2 万行的主世界 hook 太重，会把正常站点一起改坏。
*/

(function () {
  'use strict';

  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  var D = W.document;
  var HOST = W.location.hostname;

  /* ================= 配置 ================= */

  // 这些站完全不动
  var SKIP_HOSTS = [
    'github.com', 'gitee.com', 'githubusercontent.com', 'raw.githubusercontent.com',
    'baidu.com', 'zhihu.com',
    'weixin.qq.com', 'wechat.com', 'qq.com', 'alipay.com',
    'taobao.com', 'tmall.com', 'jd.com', 'unionpay.com',
    'gov.cn', '12306.cn', 'bankcomm.com', 'icbc.com.cn', 'ccb.com', 'abchina.com'
  ];

  // 遮罩里出现这些词才当成反广告拦截提示
  var ADBLOCK_WORDS = [
    '广告拦截', '拦截器', '关闭拦截', '禁用广告', '关闭广告屏蔽', '屏蔽广告插件',
    'adblock', 'ad blocker', 'ad-blocker', 'adblocker',
    'whitelist this', 'disable your ad', 'turn off your ad'
  ];

  var COOKIE_SELECTORS = [
    '#cookie-banner', '#cookie-consent', '#onetrust-banner-sdk', '#cookie-notice',
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-bar', '.cookie-policy',
    '.cc-window', '.gdpr-banner', '.cmp-container', '.consent-banner',
    '[id*="cookie"][id*="banner"]', '[class*="cookie"][class*="banner"]'
  ];

  var STICKY_AD_SELECTORS = [
    '.sticky-ad', '.fixed-ad', '.bottom-ad', '.ad-sticky-bottom', '#bottom-ad',
    '.sticky-bottom-ad', '.bottom-fixed-ad'
  ];

  // AMP 地址的典型形态，取自 AdGuard Disable AMP 的 @include 清单
  var AMP_PATHS = /\/(amp|amp\/|amp-|articleAmp|ampNews|NewsViewAmp|articleViewAmp|amp_articleshow|lite)\//i;

  /* ================= 工具 ================= */

  function isSkip(h) {
    h = String(h || '').toLowerCase();
    for (var i = 0; i < SKIP_HOSTS.length; i++) {
      var s = SKIP_HOSTS[i];
      if (h === s || h.slice(-(s.length + 1)) === '.' + s) return true;
    }
    return false;
  }

  function store(key, val) {
    try {
      if (typeof GM_getValue !== 'function') return null;
      if (arguments.length === 1) return GM_getValue(key, null);
      GM_setValue(key, val);
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function disabledHere() {
    if (/[?&]fboff=1/.test(W.location.search)) return true;
    var list = store('fb-off') || [];
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
    return list.indexOf(HOST) !== -1;
  }

  var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
  function firstTime(el) {
    if (!seen) return true;
    if (seen.has(el)) return false;
    seen.add(el);
    return true;
  }

  function on(el, type, fn, cap) {
    try { el.addEventListener(type, fn, cap || false); } catch (e) { /* 忽略 */ }
  }

  /* ================= 1. 反广告拦截 ================= */

  // 只在页面真被锁住时才改，别碰正常布局
  function unlockScroll() {
    [D.documentElement, D.body].forEach(function (el) {
      if (!el) return;
      var cs = W.getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
      }
      if (el === D.body && cs.position === 'fixed') {
        el.style.setProperty('position', 'static', 'important');
        el.style.removeProperty('padding-right');
        el.style.removeProperty('top');
      }
    });
  }

  function looksLikeOverlay(el) {
    try {
      var cs = W.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      var r = el.getBoundingClientRect();
      return r.width * r.height > W.innerWidth * W.innerHeight * 0.25;
    } catch (e) { return false; }
  }

  // 从命中的节点往上找，找到最大的那一层遮罩
  function killOverlay(el) {
    var node = el, hit = null;
    for (var i = 0; i < 5 && node && node !== D.body; i++) {
      if (looksLikeOverlay(node)) hit = node;
      node = node.parentElement;
    }
    if (hit) {
      hit.style.setProperty('display', 'none', 'important');
      unlockScroll();
      return true;
    }
    return false;
  }

  function hasAdblockText(el) {
    var t = (el.textContent || '').toLowerCase();
    if (!t || t.length > 2000) return false;
    for (var i = 0; i < ADBLOCK_WORDS.length; i++) {
      if (t.indexOf(ADBLOCK_WORDS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  function sweepOverlays() {
    var nodes = D.querySelectorAll('div,section,aside,dialog');
    var limit = Math.min(nodes.length, 3000);
    for (var i = 0; i < limit; i++) {
      var el = nodes[i];
      if (!firstTime(el)) continue;
      if (!hasAdblockText(el)) continue;
      if (killOverlay(el)) return true;
    }
    return false;
  }

  /* ================= 2. 弹窗与自动跳转 ================= */

  var lastGesture = 0;
  ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function (t) {
    on(D, t, function () { lastGesture = Date.now(); }, true);
  });

  function hasGesture() {
    try {
      if (W.navigator && W.navigator.userActivation) return W.navigator.userActivation.isActive;
    } catch (e) { /* 忽略 */ }
    return Date.now() - lastGesture < 1200;
  }

  // 拦截时给页面一个空壳窗口，比返回 null 安全
  function fakeWin() {
    var noop = function () {};
    return {
      closed: true, focus: noop, blur: noop, close: noop, postMessage: noop,
      location: { href: 'about:blank', replace: noop, assign: noop, reload: noop },
      document: { write: noop, writeln: noop, close: noop, open: noop }
    };
  }

  // 无手势 + 跨域 = 广告弹窗；有手势的一律放行
  function guardOpen() {
    var nativeOpen = W.open;
    if (typeof nativeOpen !== 'function' || nativeOpen.__fb) return;
    var patched = function (url, name, features) {
      try {
        if (!hasGesture() && url) {
          var u = null;
          try { u = new W.URL(String(url), W.location.href); } catch (e) { u = null; }
          if (u && u.hostname && u.hostname !== HOST && !isSkip(u.hostname)) return fakeWin();
        }
      } catch (e) { /* 忽略 */ }
      return nativeOpen.apply(this, arguments);
    };
    patched.__fb = true;
    try { patched.toString = function () { return 'function open() { [native code] }'; }; } catch (e) { /* 忽略 */ }
    try { W.open = patched; } catch (e) { /* 忽略 */ }
  }

  // 页面自己加的 meta refresh 跳转到外域，多半是广告
  function handleMeta(el) {
    if (!el || el.tagName !== 'META') return;
    if ((el.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') return;
    var m = (el.getAttribute('content') || '').match(/url\s*=\s*['"]?([^'";]+)/i);
    if (!m) return;
    try {
      var u = new W.URL(m[1].trim(), W.location.href);
      if (u.hostname === HOST || isSkip(u.hostname)) return;
      if (el.parentNode) el.parentNode.removeChild(el);
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 3. AMP ================= */

  // google.com/amp/s/example.com/x -> example.com/x
  function deAmp(url) {
    if (!url) return url;
    var m = String(url).match(/^https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z.]+\/amp\/s\/(.+)$/i);
    if (m) return 'https://' + m[1];
    m = String(url).match(/^https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z.]+\/amp\/(?:[a-z]{2}\/)?(.+)$/i);
    if (m) return 'https://' + m[1];
    return url;
  }

  // 搜索结果页里直接改链接，点之前就绕开 AMP
  function rewriteLinks(root) {
    var as = (root || D).querySelectorAll('a[href*="/amp/"]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      var fixed = deAmp(a.getAttribute('href'));
      if (fixed !== a.getAttribute('href')) a.setAttribute('href', fixed);
    }
  }

  // 已经在 AMP 页上，就照 canonical 跳回原文
  function escapeAmp() {
    var path = W.location.pathname + W.location.search;
    var isAmp = AMP_PATHS.test(path) || /[?&]amp(=1|$)/i.test(W.location.search) ||
      D.documentElement.hasAttribute('amp') || D.documentElement.hasAttribute('\u26A1');
    if (!isAmp) return;
    var c = D.querySelector('link[rel="canonical"]');
    if (!c) return;
    var href = c.getAttribute('href');
    if (!href) return;
    try {
      var u = new W.URL(href, W.location.href);
      if (u.hostname === HOST && u.pathname === W.location.pathname) return;
      if (isSkip(u.hostname)) return;
      W.location.replace(u.href);
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 4. 页面杂物 ================= */

  function hideMatching(selectors) {
    var n = 0;
    selectors.forEach(function (sel) {
      var els;
      try { els = D.querySelectorAll(sel); } catch (e) { return; }
      for (var i = 0; i < els.length; i++) {
        els[i].style.setProperty('display', 'none', 'important');
        n++;
      }
    });
    return n;
  }

  /* ================= 启动 ================= */

  function boot() {
    if (disabledHere()) return;

    guardOpen();
    rewriteLinks(D);

    var lastPass = 0;
    function pass() {
      var now = Date.now();
      if (now - lastPass < 600) return;
      lastPass = now;
      try {
        var a = sweepOverlays();
        var b = hideMatching(COOKIE_SELECTORS) > 0;
        var c = hideMatching(STICKY_AD_SELECTORS) > 0;
        if (a || b || c) unlockScroll();
      } catch (e) { /* 忽略 */ }
    }

    pass();

    // AMP 页的 canonical 要等 head 解析完才在
    function ampLater() {
      try { escapeAmp(); } catch (e) { /* 忽略 */ }
    }
    if (D.readyState === 'loading') {
      on(D, 'DOMContentLoaded', ampLater);
    } else {
      ampLater();
    }
    setTimeout(ampLater, 900);

    // 有些站是延迟上遮罩的，补两次，不常驻
    setTimeout(pass, 1200);
    setTimeout(pass, 3200);

    // 页面后续插入的节点
    if (W.MutationObserver) {
      var obs = new W.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          if (!added || !added.length) continue;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'META') handleMeta(node);
            if (node.querySelectorAll) {
              var metas = node.querySelectorAll('meta[http-equiv]');
              for (var k = 0; k < metas.length; k++) handleMeta(metas[k]);
            }
          }
        }
        rewriteLinks(D);
        pass();
      });
      function startObs() {
        try {
          if (!D.documentElement) return false;
          obs.observe(D.documentElement, { childList: true, subtree: true });
          setTimeout(function () { obs.disconnect(); }, 30000);
          return true;
        } catch (e) { return false; }
      }
      if (!startObs()) on(D, 'DOMContentLoaded', startObs);
    }

    // 现有的 meta refresh 也要过一遍
    var ms = D.querySelectorAll('meta[http-equiv]');
    for (var i = 0; i < ms.length; i++) handleMeta(ms[i]);

    if (typeof GM_registerMenuCommand === 'function') {
      try {
        GM_registerMenuCommand('在这儿出问题了？停用本扩展', function () {
          var list = store('fb-off') || [];
          if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
          if (list.indexOf(HOST) === -1) list.push(HOST);
          store('fb-off', JSON.stringify(list));
          W.location.reload();
        });
      } catch (e) { /* 忽略 */ }
    }
  }

  try {
    boot();
  } catch (e) {
    // 任何异常都不该让页面卡住
  }
})();

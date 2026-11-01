// ==UserScript==
// @name         FusionBlock 增强
// @namespace    https://liu134921.github.io/FusionBlock/
// @version      1.0.0
// @description  拆掉“请关闭广告拦截”的遮罩、关掉 Cookie 横幅、移除固定底部广告条。配合 FusionBlock 过滤器使用。
// @author       林墨
// @homepage     https://liu134921.github.io/FusionBlock/
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ---------------- 配置 ---------------- */

  // 在这几个站上什么都不做（子域自动包含）
  var SKIP_HOSTS = [
    'github.com', 'gitee.com', 'google.com', 'bing.com',
    'weixin.qq.com', 'alipay.com', 'taobao.com', 'jd.com'
  ];

  // 遮罩里出现这些词，才当成“反广告拦截提示”
  var ADBLOCK_WORDS = [
    '广告拦截', '拦截器', '关闭拦截', '禁用广告', '关闭广告',
    'adblock', 'ad blocker', 'ad-blocker', 'whitelist this', 'disable your ad'
  ];

  // Cookie / 隐私横幅
  var COOKIE_SELECTORS = [
    '#cookie-banner', '#cookie-consent', '#onetrust-banner-sdk',
    '.cookie-banner', '.cookie-notice', '.cookie-consent', '.cookie-bar',
    '.cc-window', '.gdpr-banner', '[id*="cookie"][id*="banner"]'
  ];

  // 固定底部广告条（谨慎，只认明确的）
  var STICKY_BOTTOM_SELECTORS = [
    '.sticky-ad', '.fixed-ad', '.bottom-ad', '.ad-sticky-bottom',
    '#bottom-ad', '[class*="sticky"][class*="ad"]'
  ];

  /* ---------------- 工具 ---------------- */

  function hostSkipped() {
    var h = location.hostname;
    return SKIP_HOSTS.some(function (s) { return h === s || h.endsWith('.' + s); });
  }

  function looksLikeOverlay(el) {
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    var r = el.getBoundingClientRect();
    // 至少要有半个屏幕大，才算遮罩
    return r.width * r.height > innerWidth * innerHeight * 0.25;
  }

  // 只在页面真被锁住时才改，不碰正常布局
  function unlockScroll() {
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      var cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
      }
      if (cs.position === 'fixed' && el === document.body) {
        el.style.setProperty('position', 'static', 'important');
        el.style.removeProperty('padding-right');
      }
    });
  }

  // 找到遮罩并连同它的祖先一起藏掉，然后解锁滚动
  function killOverlay(el) {
    var node = el;
    for (var i = 0; i < 4 && node && node !== document.body; i++) {
      if (looksLikeOverlay(node)) {
        node.style.setProperty('display', 'none', 'important');
        unlockScroll();
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function textHasAdblockWord(el) {
    var t = (el.textContent || '').toLowerCase();
    if (!t || t.length > 2000) return false;
    return ADBLOCK_WORDS.some(function (w) { return t.indexOf(w.toLowerCase()) !== -1; });
  }

  /* ---------------- 各条处理 ---------------- */

  function handleAntiAdblock(root) {
    var nodes = root.querySelectorAll('div,section,aside,dialog');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.fbDone) continue;
      el.dataset.fbDone = '1';
      if (!textHasAdblockWord(el)) continue;
      if (killOverlay(el)) return true;
    }
    return false;
  }

  function removeMatching(selectors) {
    var n = 0;
    selectors.forEach(function (sel) {
      var els;
      try { els = document.querySelectorAll(sel); } catch (e) { return; }
      Array.prototype.forEach.call(els, function (el) {
        el.style.setProperty('display', 'none', 'important');
        n++;
      });
    });
    return n;
  }

  function run() {
    if (hostSkipped()) return;
    var changed = false;

    // 每次最多处理 3 轮，避免和动态渲染打架
    var rounds = 0;
    (function tick() {
      if (rounds++ > 3) return;
      var a = handleAntiAdblock(document);
      var b = removeMatching(COOKIE_SELECTORS) > 0;
      var c = removeMatching(STICKY_BOTTOM_SELECTORS) > 0;
      if (a || b || c) changed = true;
      if (changed) unlockScroll();
    })();
  }

  /* ---------------- 启动 ---------------- */

  run();

  // 页面后续插入的遮罩也要处理，30 秒后自动停手
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      if (!added || !added.length) continue;
      run();
      return;
    }
  });

  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 30000);
  } catch (e) { /* 忽略 */ }

  // 有些站过了几秒才上锁，分两次补漏，不常驻
  setTimeout(unlockScroll, 1500);
  setTimeout(unlockScroll, 4000);
})();

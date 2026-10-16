/* ==========================================================================
 * Resonance Engine · util.js
 * 基础工具：数学、随机、颜色、DOM、格式化、存储（带内存回退）
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};

  var U = RG.U = {};

  /* ---------------- math ---------------- */
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.invLerp = function (a, b, v) { return b === a ? 0 : (v - a) / (b - a); };
  U.smooth = function (t) { return t * t * (3 - 2 * t); };
  U.approach = function (cur, target, rate, dt) {
    var d = target - cur;
    var step = rate * dt;
    if (Math.abs(d) <= step) return target;
    return cur + Math.sign(d) * step;
  };
  U.easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  U.easeInCubic = function (t) { return t * t * t; };
  U.easeOutBack = function (t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  U.easeOutElastic = function (t) {
    if (t === 0 || t === 1) return t;
    var p = 0.36;
    return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
  };
  U.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };

  /* ---------------- random ---------------- */
  U.hashStr = function (s) {
    var h = 2166136261 >>> 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  U.mulberry32 = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.rng = function (seed) {
    var f = U.mulberry32(typeof seed === 'string' ? U.hashStr(seed) : seed);
    return {
      next: f,
      range: function (a, b) { return a + (b - a) * f(); },
      int: function (a, b) { return Math.floor(a + (b - a + 1) * f()); },
      pick: function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; },
      chance: function (p) { return f() < p; },
      sign: function () { return f() < 0.5 ? -1 : 1; },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(f() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
      }
    };
  };

  /* ---------------- color ---------------- */
  U.hexToRgb = function (hex) {
    hex = String(hex).replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgba = function (hex, a) {
    var c = U.hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  };
  U.mix = function (hexA, hexB, t) {
    var a = U.hexToRgb(hexA), b = U.hexToRgb(hexB);
    var r = Math.round(U.lerp(a.r, b.r, t)), g = Math.round(U.lerp(a.g, b.g, t)), bl = Math.round(U.lerp(a.b, b.b, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  };
  U.shade = function (hex, amt) { // amt -1..1
    var c = U.hexToRgb(hex);
    var f = amt < 0 ? 0 : 255;
    var p = Math.abs(amt);
    return 'rgb(' + Math.round(U.lerp(c.r, f, p)) + ',' + Math.round(U.lerp(c.g, f, p)) + ',' + Math.round(U.lerp(c.b, f, p)) + ')';
  };
  U.hsl = function (h, s, l, a) { return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')'; };

  /* ---------------- format ---------------- */
  U.pad = function (n, len) { var s = String(Math.floor(Math.abs(n))); while (s.length < (len || 2)) s = '0' + s; return s; };
  U.fmtTime = function (sec, ms) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    var out = m + ':' + U.pad(s, 2);
    if (ms) out += '.' + U.pad(Math.floor((sec % 1) * 1000), 3);
    return out;
  };
  U.fmtScore = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  U.fmtPct = function (v, d) { return (v * 100).toFixed(d === undefined ? 2 : d) + '%'; };
  U.fmtDelta = function (ms) { return (ms >= 0 ? '+' : '') + Math.round(ms) + 'ms'; };

  /* ---------------- dom ---------------- */
  U.$ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  U.$$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  U.el = function (tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else if (k.indexOf('data-') === 0 || k === 'type' || k === 'id' || k === 'title' || k === 'placeholder' ||
        k === 'min' || k === 'max' || k === 'step' || k === 'value' || k === 'accept' || k === 'href') e.setAttribute(k, attrs[k]);
      else e[k] = attrs[k];
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  };
  U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };
  U.on = function (target, type, fn, opts) { target.addEventListener(type, fn, opts || false); return fn; };
  U.delegate = function (rootEl, action, handler) {
    return U.on(rootEl, 'click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-action="' + action + '"]') : null;
      if (t && rootEl.contains(t)) handler(ev, t);
    });
  };
  var KEYNAME = {
    ' ': 'SPACE', 'ArrowLeft': '←', 'ArrowRight': '→', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'Escape': 'ESC', 'Enter': 'ENTER', 'ShiftLeft': 'L-SHIFT', 'ShiftRight': 'R-SHIFT',
    'ControlLeft': 'L-CTRL', 'ControlRight': 'R-CTRL', 'AltLeft': 'L-ALT', 'AltRight': 'R-ALT', 'Tab': 'TAB'
  };
  U.keyName = function (code) {
    if (!code) return '—';
    if (KEYNAME[code]) return KEYNAME[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'NUM' + code.slice(6);
    return code.toUpperCase();
  };
  U.canvasSize = function (cv, dprCap) {
    var dpr = Math.min(root.devicePixelRatio || 1, dprCap || 2);
    var w = cv.clientWidth || cv.width, h = cv.clientHeight || cv.height;
    var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, dpr: dpr, ctx: ctx };
  };

  /* ---------------- storage ---------------- */
  var memStore = {};
  U.storage = {
    get: function (k) {
      try { var v = root.localStorage && root.localStorage.getItem(k); return v === null || v === undefined ? (memStore[k] || null) : v; }
      catch (e) { return memStore[k] || null; }
    },
    set: function (k, v) {
      memStore[k] = v;
      try { if (root.localStorage) root.localStorage.setItem(k, v); return true; } catch (e) { return false; }
    },
    remove: function (k) {
      delete memStore[k];
      try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { }
    }
  };
  U.loadJSON = function (k, fallback) {
    var raw = U.storage.get(k);
    if (!raw) return fallback;
    try { var v = JSON.parse(raw); return v === null || v === undefined ? fallback : v; }
    catch (e) { return fallback; }
  };
  U.saveJSON = function (k, v) { return U.storage.set(k, JSON.stringify(v)); };

  /* ---------------- misc ---------------- */
  U.deepClone = function (o) {
    if (o === null || typeof o !== 'object') return o;
    try { return JSON.parse(JSON.stringify(o)); }
    catch (e) { return Array.isArray(o) ? o.slice() : Object.assign({}, o); }
  };
  /** 深合并：结果与 base 完全脱离。
   *  base 里没被 over 覆盖的嵌套对象也会被深拷贝 —— 否则默认值会被运行时改动污染，
   *  「恢复默认设置」和「清除所有存档」都会失效（保存进度被写进 DEFAULT 对象里）。 */
  U.deepMerge = function (base, over) {
    var out;
    if (Array.isArray(base)) out = base.slice();
    else if (base && typeof base === 'object') {
      out = {};
      for (var k in base) out[k] = (base[k] && typeof base[k] === 'object') ? U.deepClone(base[k]) : base[k];
    } else out = {};
    if (!over || typeof over !== 'object') return out;
    for (var k2 in over) {
      var bv = out[k2], ov = over[k2];
      if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) out[k2] = U.deepMerge(bv, ov);
      else if (ov !== undefined) out[k2] = (ov && typeof ov === 'object') ? U.deepClone(ov) : ov;
    }
    return out;
  };
  U.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  };
  U.now = function () { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); };
  U.uid = function (p) { return (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); };

  /* 二分：找到第一个 time >= t 的索引 */
  U.lowerBound = function (arr, t, key) {
    key = key || 't';
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid][key] < t) lo = mid + 1; else hi = mid; }
    return lo;
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
 * Resonance · art.js
 *   RG.Art —— 内置程序化绘画：场景背景（11 种）+ 角色立绘剪影（7 种）
 *   全部由 Canvas 路径实时绘制：无外部素材、无网络请求、同 seed 同画面
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  /* ======================================================================
   * 1. 内置程序化绘画
   * ====================================================================== */
  var bgCache = {};

  function newCanvas(w, h) {
    var cv = root.document ? root.document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = Math.max(2, Math.round(w));
    cv.height = Math.max(2, Math.round(h));
    return cv;
  }

  function rngFor(kind, seed) { return U.rng('art|' + kind + '|' + (seed || 0)); }

  /* ---- 通用构件 ---- */
  function skyline(ctx, w, h, baseY, color, rng, count, minH, maxH, alpha) {
    for (var i = 0; i < count; i++) {
      var bw = rng.range(w * 0.015, w * 0.05);
      var bx = rng.range(-bw, w);
      var bh = rng.range(minH, maxH);
      ctx.globalAlpha = alpha * rng.range(0.55, 1);
      ctx.fillStyle = color;
      ctx.fillRect(bx, baseY - bh, bw, bh);
      /* 窗格 */
      ctx.globalAlpha = alpha * 0.5;
      var cols = Math.max(2, Math.floor(bw / 9));
      var rows = Math.max(2, Math.floor(bh / 14));
      for (var cx = 0; cx < cols; cx++) {
        for (var cy = 0; cy < rows; cy++) {
          if (rng.next() > 0.42) continue;
          ctx.fillStyle = rng.next() > 0.75 ? '#ffe9a8' : color;
          ctx.fillRect(bx + 3 + cx * (bw - 6) / cols, baseY - bh + 4 + cy * (bh - 8) / rows, 3, 5);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function spectrumBars(ctx, w, h, baseY, colA, colB, rng, count, maxH) {
    var bw = w / count;
    for (var i = 0; i < count; i++) {
      var v = Math.pow(rng.next(), 1.6);
      var bh = v * maxH + 4;
      var g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
      g.addColorStop(0, U.rgba(colB, 0.55));
      g.addColorStop(1, U.rgba(colA, 0.10));
      ctx.fillStyle = g;
      ctx.fillRect(i * bw + 1, baseY - bh, bw - 2, bh);
    }
  }

  function starField(ctx, w, h, colA, colB, rng, n, maxY) {
    for (var i = 0; i < n; i++) {
      var x = rng.range(0, w), y = rng.range(0, maxY || h);
      var r = rng.range(0.5, 1.7);
      ctx.fillStyle = U.rgba(i % 3 ? colA : colB, rng.range(0.25, 0.85));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function fogBands(ctx, w, h, col, rng, n) {
    for (var i = 0; i < n; i++) {
      var y = rng.range(h * 0.2, h);
      var hh = rng.range(6, 34);
      var g = ctx.createLinearGradient(0, y - hh, 0, y + hh);
      g.addColorStop(0, U.rgba(col, 0));
      g.addColorStop(0.5, U.rgba(col, rng.range(0.05, 0.16)));
      g.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, y - hh, w, hh * 2);
    }
  }

  function glow(ctx, x, y, r, col, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, U.rgba(col, a));
    g.addColorStop(0.5, U.rgba(col, a * 0.25));
    g.addColorStop(1, U.rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ---- 场景绘制 ---- */
  var KINDS = {
    room: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, w * 0.4, h);
      g.addColorStop(0, '#0a1020'); g.addColorStop(1, '#05070f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      /* 窗 */
      var wx = w * 0.58, wy = h * 0.16, ww = w * 0.34, wh = h * 0.46;
      ctx.fillStyle = 'rgba(120,170,220,0.10)';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = 'rgba(180,210,255,0.35)'; ctx.lineWidth = 2;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
      /* 雨 */
      for (var i = 0; i < 90; i++) {
        var rx = wx + rng.range(0, ww), ry = wy + rng.range(0, wh);
        ctx.strokeStyle = 'rgba(190,220,255,' + rng.range(0.05, 0.25) + ')';
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 3, ry + 11); ctx.stroke();
      }
      /* 桌面与谐振器 */
      ctx.fillStyle = 'rgba(10,14,26,0.95)';
      ctx.fillRect(0, h * 0.70, w * 0.52, h * 0.02);
      var ix = w * 0.14, iy = h * 0.60;
      ctx.fillStyle = '#131a2c';
      ctx.fillRect(ix, iy, w * 0.16, h * 0.10);
      ctx.strokeStyle = U.rgba(th.a, 0.8); ctx.lineWidth = 2;
      ctx.strokeRect(ix, iy, w * 0.16, h * 0.10);
      glow(ctx, ix + w * 0.08, iy + h * 0.05, h * 0.14, th.a, 0.30);
      /* 心口微光 */
      glow(ctx, w * 0.34, h * 0.58, h * 0.22, th.a, 0.14);
    },
    city: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, U.mix('#05070f', th.a, 0.20));
      g.addColorStop(1, '#04050b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      starField(ctx, w, h * 0.5, th.a, th.b, rng, 60);
      glow(ctx, w * 0.7, h * 0.42, h * 0.5, th.b, 0.16);
      skyline(ctx, w, h, h * 0.86, '#0d1526', rng, 26, h * 0.12, h * 0.5, 0.95);
      spectrumBars(ctx, w, h * 0.86, h * 0.86, th.a, th.b, rng, 46, h * 0.34);
      skyline(ctx, w, h, h * 0.92, '#06090f', rng, 20, h * 0.08, h * 0.3, 0.9);
      fogBands(ctx, w, h, th.a, rng, 5);
      /* 湿地面反射 */
      ctx.globalAlpha = 0.25;
      spectrumBars(ctx, w, h, h, h, th.a, th.b, rng, 46, h * 0.14);
      ctx.globalAlpha = 1;
    },
    street: function (ctx, w, h, th, rng) {
      KINDS.city(ctx, w, h, th, rng);
      /* 静默的灰雪 */
      ctx.save();
      for (var i = 0; i < 220; i++) {
        var x = rng.range(0, w), y = rng.range(0, h), r = rng.range(0.6, 2.2);
        ctx.fillStyle = 'rgba(210,220,235,' + rng.range(0.05, 0.35) + ')';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      fogBands(ctx, w, h, '#9fb0cc', rng, 4);
    },
    corridor: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#04120c'); g.addColorStop(1, '#02070a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      /* 透视地板 */
      ctx.strokeStyle = U.rgba('#5cff9d', 0.22); ctx.lineWidth = 1;
      for (var i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 18, h * 0.48);
        ctx.lineTo(w / 2 + i * w * 0.09, h);
        ctx.stroke();
      }
      for (var k = 0; k < 16; k++) {
        var p = k / 16;
        var y = h * 0.48 + Math.pow(p, 2.2) * h * 0.55;
        ctx.strokeStyle = U.rgba('#5cff9d', 0.06 + p * 0.16);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      /* CRT 屏 */
      var self = this;
      for (var s = 0; s < 14; s++) {
        var sx = rng.range(0, w), sy = rng.range(h * 0.06, h * 0.5);
        var sw = rng.range(w * 0.04, w * 0.12), sh = rng.range(h * 0.05, h * 0.12);
        ctx.fillStyle = 'rgba(6,20,14,0.85)';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = U.rgba('#5cff9d', 0.5); ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, sw, sh);
        for (var ln = 0; ln < 4; ln++) {
          ctx.fillStyle = U.rgba('#5cff9d', rng.range(0.15, 0.5));
          ctx.fillRect(sx + 3, sy + 4 + ln * 5, (sw - 6) * rng.range(0.3, 1), 1.6);
        }
      }
      glow(ctx, w * 0.5, h * 0.46, h * 0.3, '#5cff9d', 0.18);
      /* 像素天际线 */
      ctx.globalAlpha = 0.5;
      skyline(ctx, w, h, h * 0.47, '#0a2318', rng, 22, h * 0.04, h * 0.2, 0.8);
      ctx.globalAlpha = 1;
    },
    abyss: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#04101f'); g.addColorStop(0.6, '#02080f'); g.addColorStop(1, '#01050a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      /* 声呐环 */
      for (var i = 0; i < 7; i++) {
        var cx = rng.range(w * 0.1, w * 0.9), cy = rng.range(h * 0.15, h * 0.8);
        var r0 = rng.range(h * 0.05, h * 0.28);
        ctx.strokeStyle = U.rgba(th.a, rng.range(0.06, 0.22));
        ctx.lineWidth = rng.range(0.7, 2);
        ctx.beginPath(); ctx.ellipse(cx, cy, r0, r0 * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
        glow(ctx, cx, cy, r0 * 0.8, th.a, 0.10);
      }
      /* 生物光点 */
      for (var p = 0; p < 130; p++) {
        var x = rng.range(0, w), y = rng.range(0, h);
        ctx.fillStyle = U.rgba(p % 4 ? th.a : '#8ef7ff', rng.range(0.1, 0.6));
        ctx.beginPath(); ctx.arc(x, y, rng.range(0.5, 2), 0, Math.PI * 2); ctx.fill();
      }
      /* 沉船钢板 */
      ctx.save();
      ctx.translate(w * 0.24, h * 0.78);
      ctx.rotate(-0.09);
      ctx.fillStyle = 'rgba(10,18,30,0.95)';
      ctx.fillRect(-w * 0.2, -h * 0.02, w * 0.44, h * 0.05);
      ctx.strokeStyle = U.rgba(th.a, 0.4); ctx.lineWidth = 1.4;
      ctx.strokeRect(-w * 0.2, -h * 0.02, w * 0.44, h * 0.05);
      ctx.restore();
      fogBands(ctx, w, h, th.a, rng, 6);
    },
    core: function (ctx, w, h, th, rng) {
      var g = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, h * 0.9);
      g.addColorStop(0, U.rgba('#ff7a3c', 0.45));
      g.addColorStop(0.35, U.rgba('#ff4fd8', 0.16));
      g.addColorStop(1, '#07050a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      /* 几何矩阵墙 */
      ctx.strokeStyle = 'rgba(255,150,90,0.16)';
      ctx.lineWidth = 1;
      for (var i = 0; i < 16; i++) {
        var t = i / 16;
        ctx.beginPath();
        ctx.moveTo(w * t, 0);
        ctx.lineTo(w * (0.5 + (t - 0.5) * 2.4), h * 0.62);
        ctx.stroke();
      }
      for (var j = 0; j < 10; j++) {
        var y = h * (0.1 + j * 0.07);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      /* 熔流 */
      for (var k = 0; k < 6; k++) {
        ctx.beginPath();
        var x0 = rng.range(0, w);
        ctx.moveTo(x0, 0);
        for (var s = 1; s <= 8; s++) {
          ctx.lineTo(x0 + Math.sin(s * 0.8 + k) * w * 0.05, (h / 8) * s);
        }
        ctx.strokeStyle = U.rgba(k % 2 ? '#ffd35c' : '#ff7a3c', rng.range(0.1, 0.35));
        ctx.lineWidth = rng.range(1, 3.5);
        ctx.stroke();
      }
      glow(ctx, w * 0.5, h * 0.62, h * 0.5, '#ff7a3c', 0.28);
      /* 浮起的名字（火星） */
      for (var n = 0; n < 120; n++) {
        var nx = rng.range(w * 0.15, w * 0.85), ny = rng.range(h * 0.1, h * 0.9);
        ctx.fillStyle = U.rgba('#ffe9a8', rng.range(0.15, 0.8));
        ctx.fillRect(nx, ny, rng.range(1, 2.6), rng.range(1, 2));
      }
    },
    zenith: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a0f33'); g.addColorStop(0.55, '#2a1240'); g.addColorStop(1, '#080611');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      starField(ctx, w, h, '#e8d7ff', th.a, rng, 150);
      /* 云海 */
      for (var i = 0; i < 5; i++) {
        var y = h * (0.62 + i * 0.06);
        ctx.fillStyle = U.rgba('#d9c6ff', 0.05 + i * 0.02);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (var x = 0; x <= w; x += w / 12) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 10);
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      }
      /* 共振尖塔 */
      ctx.fillStyle = 'rgba(255,240,200,0.10)';
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.06);
      ctx.lineTo(w * 0.545, h);
      ctx.lineTo(w * 0.455, h);
      ctx.closePath(); ctx.fill();
      glow(ctx, w * 0.5, h * 0.12, h * 0.3, '#ffe9a8', 0.35);
      /* 合唱光点 */
      for (var c = 0; c < 26; c++) {
        var a = (c / 26) * Math.PI * 2;
        var rr = Math.min(w, h) * rng.range(0.16, 0.34);
        var cx = w * 0.5 + Math.cos(a) * rr * 1.5, cy = h * 0.42 + Math.sin(a) * rr * 0.5;
        glow(ctx, cx, cy, h * 0.045, c % 3 ? '#e8d7ff' : th.a, 0.30);
      }
    },
    finale: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#241436'); g.addColorStop(0.45, '#3a1a3c'); g.addColorStop(1, '#0b0713');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      starField(ctx, w, h * 0.7, '#ffe9c9', th.a, rng, 90);
      /* 黎明 */
      glow(ctx, w * 0.5, h * 0.72, h * 0.7, '#ffb26b', 0.3);
      /* 远端城市 */
      ctx.globalAlpha = 0.5;
      skyline(ctx, w, h, h * 0.78, '#160f22', rng, 30, h * 0.04, h * 0.2, 0.9);
      ctx.globalAlpha = 1;
      /* 巨大的静默人形 */
      ctx.save();
      ctx.globalAlpha = 0.5;
      var gx = w * 0.72, gy = h * 0.36;
      var gg = ctx.createLinearGradient(0, gy - h * 0.2, 0, h);
      gg.addColorStop(0, 'rgba(120,130,160,0.55)');
      gg.addColorStop(1, 'rgba(40,44,60,0.05)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(gx, gy, w * 0.045, h * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(gx - w * 0.055, h * 0.98);
      ctx.quadraticCurveTo(gx - w * 0.05, gy + h * 0.06, gx, gy + h * 0.05);
      ctx.quadraticCurveTo(gx + w * 0.05, gy + h * 0.06, gx + w * 0.055, h * 0.98);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      /* 共振塔 */
      glow(ctx, w * 0.34, h * 0.5, h * 0.34, th.a, 0.22);
    },
    silence: function (ctx, w, h, th, rng) {
      ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) {
        var x = rng.range(0, w), y = rng.range(0, h);
        ctx.fillStyle = 'rgba(200,210,230,' + rng.range(0.02, 0.1) + ')';
        ctx.fillRect(x, y, 1.4, 1.4);
      }
      ctx.strokeStyle = 'rgba(150,160,190,0.25)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();
      glow(ctx, w * 0.5, h * 0.5, h * 0.4, '#9aa5cc', 0.10);
    },
    sea: function (ctx, w, h, th, rng) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, U.mix('#05070f', th.a, 0.25));
      g.addColorStop(0.6, '#03060e');
      g.addColorStop(1, '#01030a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 40; i++) {
        var y = h * (i / 40);
        ctx.strokeStyle = U.rgba(th.a, 0.04 * (1 - i / 40));
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (var x = 0; x <= w; x += w / 16) ctx.lineTo(x, y + Math.sin(x * 0.02 + i * 0.5) * (3 + i * 0.4));
        ctx.stroke();
      }
      glow(ctx, w * 0.5, h * 0.3, h * 0.5, th.b, 0.18);
    },
    spire: function (ctx, w, h, th, rng) {
      ctx.fillStyle = '#04060d'; ctx.fillRect(0, 0, w, h);
      starField(ctx, w, h, th.a, th.b, rng, 80);
      /* 塔身 */
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5);
      var tw = w * 0.09;
      var tg = ctx.createLinearGradient(0, -h * 0.42, 0, h * 0.5);
      tg.addColorStop(0, U.rgba(th.a, 0.7));
      tg.addColorStop(1, U.rgba(th.b, 0.15));
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.42);
      ctx.lineTo(tw, h * 0.5);
      ctx.lineTo(-tw, h * 0.5);
      ctx.closePath(); ctx.fill();
      for (var i = 0; i < 14; i++) {
        var y = -h * 0.4 + i * h * 0.065;
        ctx.strokeStyle = U.rgba('#ffffff', 0.10 + (i % 3 === 0 ? 0.15 : 0));
        ctx.lineWidth = 1 + (i % 3 === 0 ? 1 : 0);
        ctx.beginPath();
        ctx.moveTo(-tw * (1 - i / 18), y);
        ctx.lineTo(tw * (1 - i / 18), y);
        ctx.stroke();
      }
      ctx.restore();
      glow(ctx, w * 0.5, h * 0.1, h * 0.4, th.a, 0.4);
    }
  };

  /** 生成（并缓存）一张内置场景图 */
  function background(kind, w, h, theme, seed) {
    kind = KINDS[kind] ? kind : 'city';
    var key = kind + '|' + Math.round(w) + 'x' + Math.round(h) + '|' + (seed || 0);
    if (bgCache[key]) return bgCache[key];
    var cv = newCanvas(w, h);
    if (!cv) return null;
    var ctx = cv.getContext('2d');
    var th = { a: (theme && theme.a) || '#38e8ff', b: (theme && theme.b) || '#ff4fd8' };
    var rng = rngFor(kind, seed);
    try {
      /* 底噪，避免纯黑 */
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, w, h);
      KINDS[kind](ctx, w, h, th, rng);
      /* 统一暗角与色调 */
      var vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    } catch (e) { /* 某些 2D 上下文实现不支持全部 API，忽略 */ }
    bgCache[key] = cv;
    if (Object.keys(bgCache).length > 24) bgCache = {};
    return cv;
  }

  /* ---- 角色立绘（剪影风） ---- */
  function paintPortrait(ctx, glyph, color, cx, baseY, scale, active, t) {
    var s = scale;
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.5;
    var a = active ? 1 : 0.6;
    function bodyPath(wMul, hMul, neck) {
      ctx.beginPath();
      ctx.moveTo(cx - 46 * s * wMul, baseY);
      ctx.quadraticCurveTo(cx - 40 * s * wMul, baseY - 70 * s * hMul, cx - 16 * s * wMul, baseY - 86 * s * hMul - neck);
      ctx.lineTo(cx + 16 * s * wMul, baseY - 86 * s * hMul - neck);
      ctx.quadraticCurveTo(cx + 40 * s * wMul, baseY - 70 * s * hMul, cx + 46 * s * wMul, baseY);
      ctx.closePath();
    }
    var fill = U.rgba('#070a12', 0.96);
    var rim = color;

    if (glyph === 'echo') {
      /* 浮游光核 */
      var r = 26 * s;
      var bob = Math.sin((t || 0) * 1.6) * 6 * s;
      glow(ctx, cx, baseY - 90 * s + bob, r * 4.2, rim, active ? 0.5 : 0.24);
      ctx.fillStyle = U.rgba(rim, 0.9);
      ctx.beginPath(); ctx.arc(cx, baseY - 90 * s + bob, r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = U.rgba(rim, 0.55); ctx.lineWidth = 1.6 * s;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, baseY - 90 * s + bob, r * (1.1 + i * 0.5), r * (0.32 + i * 0.12), (t || 0) * (0.3 + i * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      /* 悬在谐振器上方 */
      ctx.fillStyle = U.rgba('#0d1526', 0.95);
      ctx.fillRect(cx - 34 * s, baseY - 30 * s, 68 * s, 30 * s);
      ctx.strokeStyle = U.rgba(rim, 0.6); ctx.lineWidth = 1.4 * s;
      ctx.strokeRect(cx - 34 * s, baseY - 30 * s, 68 * s, 30 * s);
      ctx.restore();
      return;
    }
    if (glyph === 'fer') {
      /* 高大无面人形 */
      ctx.globalAlpha = (active ? 0.95 : 0.55);
      var g = ctx.createLinearGradient(0, baseY - 200 * s, 0, baseY);
      g.addColorStop(0, 'rgba(150,160,190,0.85)');
      g.addColorStop(1, 'rgba(20,22,34,0.9)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 190 * s, 26 * s, 32 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 62 * s, baseY);
      ctx.quadraticCurveTo(cx - 54 * s, baseY - 120 * s, cx - 26 * s, baseY - 152 * s);
      ctx.lineTo(cx + 26 * s, baseY - 152 * s);
      ctx.quadraticCurveTo(cx + 54 * s, baseY - 120 * s, cx + 62 * s, baseY);
      ctx.closePath(); ctx.fill();
      /* 面具裂缝 */
      ctx.strokeStyle = U.rgba('#ffe9a8', active ? 0.9 : 0.5);
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 12 * s, baseY - 208 * s);
      ctx.lineTo(cx + 4 * s, baseY - 192 * s);
      ctx.lineTo(cx - 4 * s, baseY - 176 * s);
      ctx.stroke();
      glow(ctx, cx, baseY - 190 * s, 90 * s, '#c86bff', active ? 0.3 : 0.14);
      ctx.restore();
      return;
    }
    if (glyph === 'choir') {
      for (var k = 0; k < 3; k++) {
        ctx.save();
        ctx.globalAlpha = (active ? 0.75 : 0.35) - k * 0.12;
        var off = (k - 1) * 34 * s;
        ctx.translate(off, -k * 12 * s);
        bodyPath(0.9, 0.9, 0);
        ctx.fillStyle = U.rgba('#0b1020', 0.9);
        ctx.fill();
        ctx.strokeStyle = U.rgba(rim, 0.7); ctx.lineWidth = 1.4 * s;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, baseY - 100 * s, 18 * s, 0, Math.PI * 2);
        ctx.fillStyle = U.rgba('#0b1020', 0.9); ctx.fill();
        ctx.strokeStyle = U.rgba(rim, 0.7); ctx.stroke();
        ctx.restore();
      }
      glow(ctx, cx, baseY - 110 * s, 120 * s, rim, active ? 0.22 : 0.1);
      ctx.restore();
      return;
    }

    /* 人类角色：rin / gen / npc */
    var hunch = glyph === 'gen' ? 8 * s : 0;
    ctx.translate(0, hunch);
    /* 身体 */
    bodyPath(1, 1, 0);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = U.rgba(rim, 0.85); ctx.lineWidth = 1.8 * s; ctx.stroke();
    /* 头 */
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 118 * s, 22 * s, 25 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = U.rgba(rim, 0.85); ctx.stroke();
    if (glyph === 'rin') {
      /* 短发轮廓 */
      ctx.beginPath();
      ctx.moveTo(cx - 24 * s, baseY - 116 * s);
      ctx.quadraticCurveTo(cx - 30 * s, baseY - 150 * s, cx - 2 * s, baseY - 146 * s);
      ctx.quadraticCurveTo(cx + 26 * s, baseY - 148 * s, cx + 22 * s, baseY - 112 * s);
      ctx.quadraticCurveTo(cx + 8 * s, baseY - 132 * s, cx - 24 * s, baseY - 116 * s);
      ctx.closePath();
      ctx.fillStyle = U.rgba(rim, 0.35); ctx.fill();
      ctx.strokeStyle = U.rgba(rim, 0.9); ctx.lineWidth = 1.4 * s; ctx.stroke();
      /* 耳机横梁 */
      ctx.beginPath();
      ctx.arc(cx, baseY - 122 * s, 26 * s, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = U.rgba(rim, 0.95); ctx.lineWidth = 3 * s; ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - 26 * s, baseY - 118 * s, 5.2 * s, 0, Math.PI * 2);
      ctx.arc(cx + 26 * s, baseY - 118 * s, 5.2 * s, 0, Math.PI * 2);
      ctx.fillStyle = U.rgba(rim, 0.95); ctx.fill();
      /* 眼睛（一道光） */
      ctx.fillStyle = U.rgba('#ffffff', 0.85);
      ctx.fillRect(cx - 10 * s, baseY - 120 * s, 7 * s, 1.6 * s);
      ctx.fillRect(cx + 3 * s, baseY - 120 * s, 7 * s, 1.6 * s);
      /* 谐振器 */
      ctx.fillStyle = U.rgba('#0d1526', 0.98);
      ctx.fillRect(cx - 22 * s, baseY - 56 * s, 44 * s, 30 * s);
      ctx.strokeStyle = U.rgba(rim, 0.9); ctx.lineWidth = 1.6 * s;
      ctx.strokeRect(cx - 22 * s, baseY - 56 * s, 44 * s, 30 * s);
    } else if (glyph === 'gen') {
      /* 胡须与散乱头发 */
      ctx.fillStyle = 'rgba(220,225,240,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx - 20 * s, baseY - 108 * s);
      ctx.quadraticCurveTo(cx, baseY - 74 * s, cx + 20 * s, baseY - 108 * s);
      ctx.quadraticCurveTo(cx, baseY - 96 * s, cx - 20 * s, baseY - 108 * s);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 24 * s, baseY - 128 * s);
      ctx.quadraticCurveTo(cx, baseY - 156 * s, cx + 24 * s, baseY - 128 * s);
      ctx.strokeStyle = 'rgba(220,225,240,0.45)'; ctx.lineWidth = 2 * s; ctx.stroke();
      /* 闭着的眼 */
      ctx.strokeStyle = U.rgba(rim, 0.9); ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(cx - 12 * s, baseY - 118 * s); ctx.lineTo(cx - 3 * s, baseY - 118 * s);
      ctx.moveTo(cx + 3 * s, baseY - 118 * s); ctx.lineTo(cx + 12 * s, baseY - 118 * s);
      ctx.stroke();
    } else {
      ctx.fillStyle = U.rgba('#ffffff', 0.7);
      ctx.beginPath(); ctx.arc(cx - 8 * s, baseY - 120 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 8 * s, baseY - 120 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    }
    if (active) glow(ctx, cx, baseY - 110 * s, 130 * s, rim, 0.16);
    ctx.restore();
  }

  RG.Art = {
    background: background,
    backgroundColor: KINDS,
    portrait: paintPortrait,
    kinds: function () { return Object.keys(KINDS); },
    /** 清空场景画布缓存（换种子重绘时用） */
    clearCache: function () { bgCache = {}; },
    /** 把内置场景画到目标上下文（cover 铺满） */
    drawCover: function (ctx, src, x, y, w, h) {
      if (!src) return;
      var sw = src.width, sh = src.height;
      var scale = Math.max(w / sw, h / sh);
      var dw = sw * scale, dh = sh * scale;
      ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

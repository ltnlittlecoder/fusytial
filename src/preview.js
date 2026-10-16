/* ==========================================================================
 * RESONANCE · preview.js
 * 设置页的实时预览：用真实渲染器 + 一段合成谱面，把「游玩/皮肤/特效/视角」
 * 的改动立刻画出来（改滑杆就能看到，不用进游戏）
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  var LOOP = 8.0;          // 预览循环长度（秒）

  /* 一段覆盖全部五种音符的合成谱面（4 轨） */
  var PATTERN = [
    { t: 0.00, lane: 0, type: 'tap' },
    { t: 0.50, lane: 1, type: 'tap' },
    { t: 1.00, lane: 2, type: 'hold', d: 0.8 },
    { t: 2.00, lane: 3, type: 'flick' },
    { t: 2.50, lane: 1, type: 'tap' },
    { t: 3.00, lane: 0, type: 'slide', d: 0.7, tail: 1 },
    { t: 4.00, lane: 3, type: 'mine' },
    { t: 4.50, lane: 2, type: 'tap' },
    { t: 5.00, lane: 0, type: 'hold', d: 0.6 },
    { t: 5.80, lane: 3, type: 'tap' },
    { t: 6.20, lane: 2, type: 'tap' },
    { t: 6.60, lane: 0, type: 'flick' },
    { t: 7.00, lane: 3, type: 'slide', d: 0.6, tail: 2 },
    { t: 7.60, lane: 1, type: 'tap' }
  ];

  var P = RG.Preview = {
    mounted: false,
    view: 'auto',        // auto | 2d | 3d
    t: 0,
    loopIdx: 0,
    lastFx: -1,
    bands: [],
    theme: { a: '#38e8ff', b: '#ff4fd8' }
  };

  P.mount = function (container) {
    if (!container) return;
    if (!P.wrap) P.build();
    if (P.wrap.parentNode !== container) container.appendChild(P.wrap);
    if (!P.renderer) {
      P.renderer = new RG.Render(P.canvas, { settings: RG.Store.settings() });
      P.renderer.setLanes(4);
      P.renderer.clearEffects();
    }
    P.mounted = true;
    P.applyView(true);
    P.refresh();
    return P;
  };

  /** DOM 只建一次，反复进出设置页也不会打断动画 */
  P.build = function () {
    var wrap = P.wrap = U.el('div', { class: 'pv-wrap' });
    P.canvas = U.el('canvas', { class: 'pv-canvas' });
    wrap.appendChild(P.canvas);

    var bar = U.el('div', { class: 'pv-bar' });
    P.readout = U.el('div', { class: 'pv-readout' });
    bar.appendChild(P.readout);
    bar.appendChild(U.el('div', { class: 'spacer' }));
    P.viewBtns = {};
    [['auto', '自动交替'], ['2d', '2D'], ['3d', '3D']].forEach(function (o) {
      var b = U.el('button', {
        class: 'gbtn small' + (P.view === o[0] ? ' on' : ''), text: o[1],
        onclick: function () {
          P.view = o[0];
          Object.keys(P.viewBtns).forEach(function (k) { P.viewBtns[k].classList.toggle('on', k === P.view); });
          P.applyView(true);
          P.refresh();
        }
      });
      P.viewBtns[o[0]] = b;
      bar.appendChild(b);
    });
    bar.appendChild(U.el('button', {
      class: 'gbtn small', text: '↻ 重播',
      onclick: function () { P.t = 0; P.lastFx = -1; P.applyView(true); }
    }));
    wrap.appendChild(bar);
    wrap.appendChild(U.el('div', {
      class: 'pv-hint',
      text: '实时预览：改下面的滑杆立刻生效（皮肤 / 速度 / 判定线 / 音符大小 / 特效 / 3D 相机 都会反映出来）'
    }));
  };

  P.unmount = function () {
    P.mounted = false;      // 保留 DOM 与渲染器，下次挂载时继续播放
  };

  /** 视角：自动模式每 8 秒在 2D/3D 之间真实过渡一次 */
  P.applyView = function (instant) {
    if (!P.renderer) return;
    var mode = P.view === 'auto'
      ? ((Math.floor(P.t / LOOP) % 2 === 0) ? '2d' : '3d')
      : P.view;
    if (instant || P.renderer.view.target !== (mode === '3d' ? 1 : 0)) {
      P.renderer.setView(mode, mode === '3d' ? 1.0 : 0.7, !!instant);
    }
  };

  /** 读取当前设置，拼一行读数 */
  P.refresh = function () {
    if (P.renderer) P.renderer.settings = RG.Store.settings();   // 导入/清除存档会换掉设置对象，这里重新绑定
    if (!P.readout) return;
    var s = RG.Store.settings();
    var win = RG.Engine.PRESETS[s.judgeDifficulty] || RG.Engine.PRESETS.normal;
    var winTxt = s.judgeDifficulty === 'custom'
      ? ('自定义 ±' + (s.customWindows && s.customWindows.perfect || 40) + 'ms')
      : ({ lenient: '宽松', normal: '标准', strict: '严格' }[s.judgeDifficulty] || '标准') + ' ±' + win.perfect + 'ms';
    var skinTxt = { neon: '霓虹', minimal: '极简', solid: '实心' }[s.skin] || s.skin;
    var effTxt = { off: '关闭', low: '低', high: '高' }[s.effects] || s.effects;
    var cam = s.camera || {};
    P.readout.innerHTML =
      '<b>速度</b> ' + (s.scrollSpeed || 6).toFixed(1) +
      ' · <b>判定</b> ' + winTxt +
      ' · <b>皮肤</b> ' + skinTxt +
      ' · <b>音符</b> ' + (s.noteSize || 1).toFixed(2) + '×' +
      ' · <b>判定线</b> ' + Math.round((s.judgeLine || 0.82) * 100) + '%' +
      ' · <b>特效</b> ' + effTxt +
      '';
    P.applyView(false);
  };

  P.shows3d = function () {
    if (!P.renderer) return false;
    if (P.view === '3d') return true;
    if (P.view === '2d') return false;
    return P.renderer.view.target === 1;
  };

  /** 生成当前可见窗口里的音符（循环） */
  P.visibleNotes = function (now) {
    var out = [];
    var approach = P.renderer ? P.renderer.approachTime() : 1.5;
    var from = now - 0.4, to = now + approach + 0.6;
    var k0 = Math.floor(from / LOOP), k1 = Math.ceil(to / LOOP);
    for (var k = k0; k <= k1; k++) {
      for (var i = 0; i < PATTERN.length; i++) {
        var p = PATTERN[i];
        var t = p.t + k * LOOP;
        if (t < from || t > to) continue;
        var n = {
          t: t, lane: p.lane, type: p.type, d: p.d || 0, tail: p.tail,
          endT: t + (p.d || 0), state: 0, judge: '', delta: 0, tailJudge: ''
        };
        if (t < now) n.state = 2;                  // 已经过去 → 淡出
        if ((p.type === 'hold' || p.type === 'slide') && t < now && n.endT > now) n.state = 1;
        out.push(n);
      }
    }
    return out;
  };

  /** 音符到判定线时放一次特效，让预览有反馈 */
  P.triggerFx = function (now) {
    var idx = Math.floor(now / 0.5);
    if (idx === P.lastFx) return;
    P.lastFx = idx;
    var half = 0.5;
    for (var i = 0; i < PATTERN.length; i++) {
      var p = PATTERN[i];
      var k = Math.round((now - p.t) / LOOP);
      var t = p.t + k * LOOP;
      if (Math.abs(now - t) > 0.12) continue;
      if (p.type === 'mine') continue;
      if (p.type === 'hold') P.renderer.holdStart(p.lane);
      else P.renderer.judge(p.lane, 'perfect', 0);
      break;
    }
  };

  P.tick = function (dt) {
    if (!P.mounted || !P.renderer || !P.canvas) return;
    var cv = P.canvas;
    if (!cv.clientWidth) return;                    // 界面隐藏时不画
    P.renderer.settings = RG.Store.settings();      // 始终跟随当前设置对象
    P.t += dt;
    /* 自动交替视角 */
    if (P.view === 'auto') P.applyView(false);
    P.renderer._layout();                           // 让设置改动立刻生效
    var now = P.t % LOOP;
    var bands = P.bands;
    for (var i = 0; i < 26; i++) {
      bands[i] = 0.22 + 0.55 * Math.abs(Math.sin(P.t * 1.6 + i * 0.4)) * (i < 6 ? 1.2 : 0.7);
    }
    P.triggerFx(now);
    /* 自动交替模式下把下一次切换时间告诉渲染器 → 也能看到"沿轨道填满"的预告动效 */
    var next = null;
    if (P.view === 'auto') {
      var loopNo = Math.floor(P.t / LOOP);
      next = { t: (loopNo + 1) * LOOP, mode: ((loopNo + 1) % 2 === 0) ? '2d' : '3d' };
    }
    /* 3D 时把连击数画到路面上，预览也照实呈现 */
    var combo = 12 + (Math.floor(P.t * 1.7) % 120);
    P.renderer.setLanes(4);
    P.renderer.draw({
      now: now, dt: dt, notes: P.visibleNotes(now), lanes: 4,
      music: { bpm: 120, beatDur: 0.5, barDur: 2 }, bands: bands,
      combo: combo, viewNext: next
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);

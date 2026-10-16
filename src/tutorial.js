/* ==========================================================================
 * RESONANCE · tutorial.js
 * 新手教程：没有存档时，TAP TO START 之后直接进入，**每次都从头开始**。
 * 每一步都是一段**动画演示**（音符怎么落、手怎么动、键盘亮哪几个键）+ 一次真实上机，
 * 不用读文字说明（只有音符代号、本步目标和按键）。
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;
  var UI = RG.UI;

  var MUSIC = {
    style: 'chiptune', seed: 4242, bpm: 96, rootMidi: 45, scale: 'major',
    sections: [{ name: 'a', intensity: 1, bars: 4 }, { name: 'b', intensity: 2, bars: 4 }]
  };
  var LANES = 4;

  function n(t, lane, type, d, tail) {
    var o = { t: t, lane: lane, type: type };
    if (d) o.d = d;
    if (tail !== undefined) o.tail = tail;
    return o;
  }

  var STEPS = [
    {
      id: 'welcome', demo: 'welcome', title: 'RESONANCE',
      action: '开始'
    },
    {
      id: 'tap', demo: 'tap', title: 'TAP',
      play: {
        notes: [n(3, 0, 'tap'), n(4, 0, 'tap'), n(5, 1, 'tap'), n(6, 2, 'tap')],
        length: 9, require: 'noMiss'
      }, goal: 'MISS = 0'
    },
    {
      id: 'hold', demo: 'hold', title: 'HOLD',
      goal: 'BREAK = 0',
      play: { notes: [n(3, 0, 'hold', 1.0), n(5, 2, 'hold', 1.2)], length: 9, require: 'noBreak' }
    },
    {
      id: 'slide', demo: 'slide', title: 'SLIDE',
      play: {
        notes: [n(3, 0, 'slide', 0.8, 1), n(5, 3, 'slide', 0.8, 2)],
        length: 9, require: 'noBreak'
      }, goal: 'BREAK = 0'
    },
    {
      id: 'flick', demo: 'flick', title: 'FLICK',
      play: {
        notes: [n(3, 1, 'flick'), n(4, 2, 'flick'), n(5, 0, 'flick'), n(6, 3, 'flick')],
        length: 9, require: 'noMiss'
      }, goal: 'MISS = 0'
    },
    {
      id: 'mine', demo: 'mine', title: 'MINE',
      play: {
        notes: [n(3, 0, 'tap'), n(3.9, 2, 'mine'), n(4.8, 3, 'tap'), n(6, 0, 'tap')],
        length: 9, require: 'clean'
      }, goal: 'MINE = 0 · MISS = 0'
    },
    {
      id: 'done', demo: 'done', title: 'START',
      action: '进入模式选取'
    }
  ];

  var T = RG.Tutorial = {
    steps: STEPS,
    idx: 0,
    entering: false,
    lastResult: null,
    t: 0
  };

  T.init = function (app) {
    T.app = app;
    T.cardEl = document.getElementById('tut-card');
    T.stepsEl = document.getElementById('tut-steps');
    T.artCanvas = document.getElementById('tut-art');
    return T;
  };

  T.done = function () { return !!RG.Store.save().tutorialDone; };

  /** 每次进入都从头开始（不接着上次的进度） */
  T.open = function () {
    var save = RG.Store.save();
    T.idx = 0;
    save.tutorialStep = 0;
    RG.Store.persist();
    T.lastResult = null;
    T.demoT = 0;
    UI.overlaysOff();
    UI.show('screen-tutorial');
    T.render();
  };

  T.close = function (toModes) {
    T.markDone();
    if (toModes !== false) RG.Front.showModes();
  };

  T.markDone = function () {
    var save = RG.Store.save();
    if (!save.tutorialDone) {
      save.tutorialDone = true;
      save.tutorialStep = STEPS.length - 1;
      RG.Store.persist();
    }
  };

  T.step = function () { return STEPS[T.idx] || STEPS[0]; };

  T.render = function () {
    var st = T.step();
    var host = U.clear(T.cardEl);
    /* 步骤指示 */
    if (T.stepsEl) {
      U.clear(T.stepsEl);
      STEPS.forEach(function (s, i) {
        T.stepsEl.appendChild(U.el('span', {
          class: 'tut-dot' + (i === T.idx ? ' cur' : '') + (i < T.idx ? ' done' : ''),
          title: s.title
        }));
      });
    }
    host.appendChild(U.el('div', { class: 'tut-step-no', text: 'STEP ' + (T.idx + 1) + ' / ' + STEPS.length }));
    host.appendChild(U.el('h2', { text: st.title }));
    /* 没有文字说明：看左边的动画演示就行，这里只留本步目标 */
    if (st.goal) {
      host.appendChild(U.el('div', { class: 'tut-goal' }, [
        U.el('span', { text: '目标' }), U.el('b', { text: st.goal })
      ]));
    }

    /* 结果反馈 */
    if (T.lastResult) {
      host.appendChild(U.el('div', {
        class: 'tut-result ' + (T.lastResult.pass ? 'ok' : 'fail'),
        html: T.lastResult.pass
          ? '✅ 通过！' + (T.lastResult.detail || '')
          : '⚠ ' + T.lastResult.detail
      }));
    }

    var btns = U.el('div', { class: 'ov-btns' });
    if (st.action) {
      btns.appendChild(U.el('button', {
        class: 'gbtn accent big', text: '▶ ' + st.action,
        onclick: function () {
          if (T.idx >= STEPS.length - 1) { T.close(true); return; }
          T.idx++;
          T.lastResult = null;
          RG.Store.save().tutorialStep = T.idx;
          RG.Store.persist();
          T.render();
          RG.audio.ui('confirm');
        }
      }));
    } else if (st.play) {
      btns.appendChild(U.el('button', {
        class: 'gbtn' + (T.lastResult && T.lastResult.pass ? '' : ' accent') + ' big',
        text: T.lastResult && T.lastResult.pass ? '↻ 再练一次'
          : (T.lastResult ? '↻ 再试一次' : '▶ 按这个来一遍'),
        onclick: function () { T.startStep(); }
      }));
      if (T.lastResult && T.lastResult.pass) {
        btns.appendChild(U.el('button', {
          class: 'gbtn accent big', text: '下一步 ▶',
          onclick: function () {
            T.idx = Math.min(STEPS.length - 1, T.idx + 1);
            T.lastResult = null;
            RG.Store.save().tutorialStep = T.idx;
            RG.Store.persist();
            T.render();
            RG.audio.ui('confirm');
          }
        }));
      }
    }
    btns.appendChild(U.el('button', {
      class: 'gbtn big', text: '跳过教程，直接进主页',
      onclick: function () { T.close(true); }
    }));
    host.appendChild(btns);
  };

  /* ---------------- 上机 ---------------- */
  T.buildChart = function (st) {
    var chart = RG.Chart.create({
      id: 'tutorial-' + st.id, songId: 'tutorial-' + st.id,
      title: st.title, artist: 'RESONANCE', difficulty: '教程', level: 1,
      lanes: LANES, bpm: MUSIC.bpm, offsetSec: 0, length: st.play.length,
      view: '2d', viewEvents: [], music: MUSIC, seed: 1, desc: st.hint || ''
    });
    chart.notes = st.play.notes.map(function (o) { return U.deepClone(o); });
    RG.Chart.normalize(chart);
    return chart;
  };

  T.startStep = function () {
    var st = T.step();
    if (!st.play) return;
    var chart = T.buildChart(st);
    RG.audio.unlock();
    T.app.startGame({
      song: {
        id: chart.meta.id, title: st.title, artist: '教程', custom: true, chart: chart,
        theme: { a: '#38e8ff', b: '#5cff9d' },
        diffs: [{ name: '教程', level: 1, lanes: LANES }]
      },
      diffIndex: 0, chart: chart, custom: true, returnTo: 'tutorial',
      noFail: true, tutorial: { step: T.idx, id: st.id }
    });
  };

  /** 纯逻辑：本步是否通过（无 DOM，便于无头测试） */
  T.check = function (require, res) {
    if (!res || !res.counts) return { pass: false, detail: '这一遍没有成绩记录' };
    var c = res.counts || {};
    var pass = false, detail = '';
    if (require === 'noMiss') {
      pass = (c.miss || 0) === 0;
      detail = 'MISS ' + (c.miss || 0) + ' · 共振率 ' + U.fmtPct(res.acc || 0, 1);
    } else if (require === 'noBreak') {
      pass = (c.break || 0) === 0 && (c.miss || 0) === 0;
      detail = '断连 ' + (c.break || 0) + ' · MISS ' + (c.miss || 0);
    } else {
      pass = (c.mineHit || 0) === 0 && (c.miss || 0) === 0;
      detail = '踩雷 ' + (c.mineHit || 0) + ' · MISS ' + (c.miss || 0);
    }
    return { pass: pass, detail: detail };
  };

  /** 由 main.js 在会话结束时调用 */
  T.onResult = function (stepIdx, res) {
    T.idx = U.clamp(stepIdx, 0, STEPS.length - 1);
    var st = STEPS[T.idx];
    var req = (st.play && st.play.require) || 'noMiss';
    var chk = T.check(req, res);
    var pass = chk.pass, detail = chk.detail;
    if (!pass) {
      var c = res.counts || {};
      var why = [];
      if (c.miss) why.push('漏了 ' + c.miss + ' 个音符');
      if (c.break) why.push('有 ' + c.break + ' 个长条提前松手');
      if (c.mineHit) why.push('踩到 ' + c.mineHit + ' 个地雷');
      detail = (why.join('，') || '没有达成目标') + (st.hint ? '。' + st.hint : '');
    }
    T.lastResult = { pass: pass, detail: detail, result: res };
    var save = RG.Store.save();
    if (pass) {
      save.tutorialStep = Math.min(STEPS.length - 1, T.idx + 1);
      RG.Store.persist();
    }
    T.app.session = null;
    UI.show('screen-tutorial');
    T.render();
    if (pass) RG.Achievements.check({});
  };

  /* ======================================================================
   * 动画演示：每一步都循环播放一段"音符怎么落、手怎么动、键盘亮哪几个键"
   * 时间轴（秒）：0.0 落下 → 1.5 命中判定线 → 1.5~2.6 手势 → 2.6~3.4 反馈 → 循环
   * ====================================================================== */
  var LOOP = 3.4;
  var FALL = 1.5;          // 音符从顶部落到判定线的时间

  T.demoT = 0;

  T.tick = function (dt) {
    if (UI.current !== 'screen-tutorial') return;
    T.t += dt;
    T.demoT += dt;
    T.drawArt();
  };

  /** 当前演示的进度（0..1 沿时间轴） */
  function phase(t) {
    return U.clamp((t - FALL) / (LOOP - FALL), 0, 1);
  }

  T.drawArt = function () {
    var cv = T.artCanvas;
    if (!cv || !cv.clientWidth) return;
    var s = U.canvasSize(cv, 1.5), ctx = s.ctx, w = s.w, h = s.h;
    var st = T.step();
    var kind = st.demo || 'welcome';
    var TYPES = RG.Chart.TYPES;
    var t = T.demoT % LOOP;
    var TYPESORDER = ['tap', 'hold', 'slide', 'flick', 'mine'];
    var pulse = 0.5 + 0.5 * Math.sin(T.t * 2.4);

    ctx.clearRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, '#070b14');
    g.addColorStop(1, '#04060c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* 轨道 */
    var lanes = LANES;
    var fieldW = Math.min(w * 0.5, 400);
    var laneW = fieldW / lanes;
    var fx = (w - fieldW) / 2;
    var judgeY = h * 0.78;
    var noteW = laneW - 14;
    var binds = RG.Store.lanesFor(lanes);
    var i, cx;

    function laneX(lane) { return fx + (lane + 0.5) * laneW; }

    /* 键帽（演示时按下的键会亮起来；点划会同时亮两个） */
    function keycaps(litLanes, glow) {
      ctx.save();
      ctx.font = '700 12px Consolas,monospace';
      ctx.textAlign = 'center';
      for (var j = 0; j < lanes; j++) {
        var on = litLanes.indexOf(j) >= 0;
        var kx = laneX(j), ky = judgeY + 26;
        var kwi = laneW * 0.52, khi = 17;
        ctx.globalAlpha = on ? 1 : 0.55;
        ctx.fillStyle = on ? U.rgba('#ffffff', 0.22) : 'rgba(8,11,20,0.6)';
        ctx.fillRect(kx - kwi / 2, ky - khi / 2, kwi, khi);
        ctx.strokeStyle = on ? U.rgba(TYPES.tap.color, 0.95) : 'rgba(120,150,255,0.3)';
        ctx.lineWidth = on ? 2 : 1;
        ctx.strokeRect(kx - kwi / 2 + 0.5, ky - khi / 2 + 0.5, kwi - 1, khi - 1);
        ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.45)';
        ctx.fillText(U.keyName(binds[j]), kx, ky + 4);
      }
      ctx.restore();
      if (glow) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = U.rgba(TYPES.tap.color, glow * 0.18);
        ctx.fillRect(fx, 0, fieldW, h);
        ctx.restore();
      }
    }

    for (i = 0; i < lanes; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.055)';
      ctx.fillRect(fx + i * laneW, 0, laneW, h);
      ctx.strokeStyle = 'rgba(120,150,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(fx + i * laneW + 0.5, 0);
      ctx.lineTo(fx + i * laneW + 0.5, h);
      ctx.stroke();
    }
    /* 判定线 */
    ctx.save();
    ctx.shadowColor = '#38e8ff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(fx, judgeY - 1.5, fieldW, 3);
    ctx.restore();

    /* ---- 绘制工具 ---- */
    function boxAt(cx0, cy, col, ww) {
      var hh = 17;
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 14 + pulse * 10;
      var lg = ctx.createLinearGradient(0, cy - hh / 2, 0, cy + hh / 2);
      lg.addColorStop(0, 'rgba(255,255,255,0.9)');
      lg.addColorStop(0.5, col);
      lg.addColorStop(1, U.shade(col, -0.4));
      ctx.fillStyle = lg;
      var useW = ww === undefined ? noteW : ww;
      ctx.fillRect(cx0 - useW / 2, cy - hh / 2, useW, hh);
      ctx.restore();
    }
    function peakAt(cx0, cy, col) {                 // 点划的尖顶
      var aw = noteW * 0.56, tipY = cy - 13;
      ctx.save();
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(cx0, tipY);
      ctx.lineTo(cx0 + aw / 2, tipY + 10);
      ctx.lineTo(cx0 - aw / 2, tipY + 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    function fingerAt(cx0, cy, alpha) {             // 手指触点
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 0.85 : alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx0, cy, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.arc(cx0, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function ringAt(cx0, cy, r, alpha) {            // 命中涟漪
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#ffffff', alpha);
      ctx.lineWidth = 3 * alpha + 0.6;
      ctx.beginPath(); ctx.ellipse(cx0, cy, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    function stamp(txt, col, cy, alpha) {           // 判定戳
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '800 22px "Segoe UI",Consolas,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      ctx.fillText(txt, w / 2, cy || h * 0.2);
      ctx.restore();
    }
    function swipeTrail(x0, y0, x1, y1, alpha) {    // 滑动轨迹
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#ffffff', alpha);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = U.rgba(TYPES.flick.color, alpha * 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    }

    /* ---- 每一步的演示 ---- */
    if (kind === 'welcome' || kind === 'done') {
      /* 五个音符代号轮播落下（不指手，只看外形） */
      for (var b = 0; b < 34; b++) {
        var bh = (0.15 + 0.55 * Math.abs(Math.sin(T.t * 1.5 + b * 0.6))) * h * 0.42;
        ctx.fillStyle = U.rgba(b % 5 === 0 ? TYPES.flick.color : TYPES.tap.color, 0.28);
        ctx.fillRect(fx + (b / 34) * fieldW, judgeY - 40 - bh, fieldW / 34 - 4, bh);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#8ef7ff', 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var px = fx; px <= fx + fieldW; px += 4) {
        ctx.lineTo(px, h * 0.30 + Math.sin(px * 0.04 + T.t * 3) * 8);
      }
      ctx.stroke();
      ctx.restore();
      /* 五个代号横排 */
      ctx.save();
      ctx.font = '800 15px Consolas,monospace';
      ctx.textAlign = 'center';
      TYPESORDER.forEach(function (k, idx) {
        var cxx = fx + (idx + 0.5) * (fieldW / 5);
        var sel = Math.floor(T.t / 0.7) % 5 === idx;
        ctx.globalAlpha = sel ? 1 : 0.45;
        ctx.fillStyle = TYPES[k].color;
        ctx.fillText(k.toUpperCase(), cxx, h * 0.14);
        boxAt(cxx, h * 0.28, TYPES[k].color, fieldW / 5 - 22);
        if (k === 'flick') peakAt(cxx, h * 0.28, TYPES[k].color);
      });
      ctx.restore();
      keycaps([]);
      return;
    }

    /* 音符下落的公共部分：y 从 -40 到判定线 */
    var fall = U.clamp(t / FALL, 0, 1);
    var ease = 1 - Math.pow(1 - fall, 2.2);
    var ny = -40 + (judgeY - (-40)) * ease;
    var ph = phase(t);                     // 手势阶段进度 0..1
    var lane0 = kind === 'slide' ? 0 : (kind === 'flick' ? 1 : (kind === 'mine' ? 0 : 0));
    var lane1 = kind === 'slide' ? 2 : lane0;
    var x0 = laneX(lane0), x1 = laneX(lane1);
    var lit = [];
    var gestureHit = t >= FALL;

    if (kind === 'tap') {
      if (!gestureHit) boxAt(x0, ny, TYPES.tap.color);
      else {
        boxAt(x0, judgeY, TYPES.tap.color);
        ringAt(x0, judgeY, 10 + ph * 54, Math.max(0, 1 - ph * 1.4));
      }
      fingerAt(x0, judgeY + (gestureHit ? 0 : 22), gestureHit ? 1 : 0.25);
      if (gestureHit) lit = [0];
      if (ph > 0.25 && ph < 0.95) stamp('PERFECT', '#8ef7ff', h * 0.2, U.clamp(1 - (ph - 0.25) * 1.6, 0, 1));
    } else if (kind === 'hold') {
      /* 长条：头到尾的长度固定，头落到判定线后"按住"，尾端在最后收尾 */
      var bodyLen = laneW * 1.5;
      var headY = gestureHit ? judgeY : ny;
      var tailY = headY - bodyLen;
      ctx.save();
      ctx.fillStyle = U.rgba(TYPES.hold.color, 0.34);
      ctx.fillRect(x0 - noteW / 2, Math.max(0, tailY), noteW, Math.min(judgeY, judgeY - tailY));
      ctx.restore();
      if (tailY > -20) boxAt(x0, tailY, TYPES.hold.color);
      boxAt(x0, headY, TYPES.hold.color);
      fingerAt(x0, judgeY + (gestureHit ? 0 : 24), gestureHit ? 1 : 0.3);
      if (gestureHit) {
        lit = [0];
        /* 按住时间条：越到后面越亮 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = U.rgba(TYPES.hold.color, 0.25 * ph);
        ctx.fillRect(x0 - noteW / 2, judgeY - bodyLen * (1 - ph * 0.0) - 0, noteW, bodyLen);
        ctx.restore();
        if (ph > 0.75) ringAt(x0, judgeY - bodyLen, 8 + (ph - 0.75) * 90, U.clamp((ph - 0.75) * 4, 0, 0.8));
        stamp('HOLD', TYPES.hold.color, h * 0.2, U.clamp(0.5 - Math.abs(ph - 0.5) * 1.6, 0, 0.5));
      }
    } else if (kind === 'slide') {
      var headY2 = gestureHit ? judgeY : ny;
      /* 倾斜光束（与游戏里一致：起点轨道 → 终点轨道） */
      var beamW = noteW, beamLen = laneW * 1.9;
      var tx = x0 + (x1 - x0) * U.clamp(ph * 1.15, 0, 1);
      var ty = headY2 - beamLen;
      ctx.save();
      ctx.globalAlpha = 0.85;
      var gs = ctx.createLinearGradient(x0, headY2, x1, ty);
      gs.addColorStop(0, U.rgba(TYPES.slide.color, 0.7));
      gs.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      gs.addColorStop(1, U.rgba(TYPES.slide.color, 0.7));
      ctx.fillStyle = gs;
      ctx.beginPath();
      ctx.moveTo(x0 - beamW / 2, headY2);
      ctx.lineTo(x0 + beamW / 2, headY2);
      ctx.lineTo(x1 + beamW / 2, ty);
      ctx.lineTo(x1 - beamW / 2, ty);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      boxAt(x0, headY2, TYPES.slide.color);
      if (gestureHit) {
        /* 手指从起点轨道拖到终点轨道 */
        fingerAt(tx, judgeY - 6, 1);
        lit = [lane0, lane1];
        if (ph > 0.6) ringAt(x1, judgeY, 8 + (ph - 0.6) * 80, U.clamp((ph - 0.6) * 3, 0, 0.8));
        stamp('SLIDE', TYPES.slide.color, h * 0.2, U.clamp(0.5 - Math.abs(ph - 0.6) * 1.5, 0, 0.5));
      }
    } else if (kind === 'flick') {
      var fcol = TYPES.flick.color;
      if (!gestureHit) {
        boxAt(x0, ny, fcol); peakAt(x0, ny, fcol);
        /* 旁边放一个 TAP 作对比 */
        boxAt(x0 - laneW * 1.6, ny, TYPES.tap.color);
        ctx.save();
        ctx.font = '700 11px Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = U.rgba(TYPES.tap.color, 0.9);
        ctx.fillText('TAP', x0 - laneW * 1.6, ny - 16);
        ctx.fillStyle = U.rgba(fcol, 0.95);
        ctx.fillText('FLICK', x0, ny - 26);
        ctx.restore();
      } else {
        boxAt(x0, judgeY, fcol);
        /* 尖顶按下后向上飞出去（滑动的感觉） */
        var fly = U.clamp(ph * 2.2, 0, 1);
        peakAt(x0, judgeY - 13 - fly * 26, fcol);
        /* 滑动轨迹：朝右上滑 */
        var sx = x0, sy = judgeY - 4;
        var ex = x0 + 34 * U.clamp(ph * 2, 0, 1), ey = judgeY - 4 - 40 * U.clamp(ph * 2, 0, 1);
        if (ph < 0.6) swipeTrail(sx, sy, ex, ey, U.clamp(1 - ph, 0, 1) * 0.9);
        fingerAt(ex, ey, 1);
        lit = [lane0, (lane0 + 2) % lanes];        // 键盘：同时两个键
        if (ph > 0.3) ringAt(x0, judgeY, 10 + (ph - 0.3) * 70, U.clamp((ph - 0.3) * 2.4, 0, 0.8));
        stamp('FLICK', fcol, h * 0.2, U.clamp(0.6 - Math.abs(ph - 0.45) * 1.6, 0, 0.6));
      }
    } else if (kind === 'mine') {
      var mx = laneX(2);
      if (!gestureHit) {
        /* 手先伸过去，然后缩回来 */
        fingerAt(mx, ny + 30, 0.5 + 0.3 * Math.sin(T.t * 6));
      } else {
        /* 手停在旁边，绝不碰它 */
        fingerAt(laneX(0), judgeY, 1);
        lit = [0];
        var back = Math.min(1, ph * 3);
        fingerAt(mx, judgeY - 30 * (1 - back) - 10, 0.35 * (1 - back));
        /* 红色警示圈 + 禁止标记 */
        ringAt(mx, judgeY, 14 + Math.sin(T.t * 8) * 3, 0.5);
        ctx.save();
        ctx.strokeStyle = '#ff5c6e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(mx - 12, judgeY + 30); ctx.lineTo(mx + 12, judgeY + 54);
        ctx.moveTo(mx + 12, judgeY + 30); ctx.lineTo(mx - 12, judgeY + 54);
        ctx.stroke();
        ctx.restore();
      }
      /* 地雷本体（旋转尖刺） */
      var my = gestureHit ? judgeY : ny;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(T.t * 1.6);
      ctx.fillStyle = U.rgba(TYPES.mine.color, 0.95);
      ctx.shadowColor = TYPES.mine.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      for (var k = 0; k < 12; k++) {
        var a2 = (k / 12) * Math.PI * 2, r2 = k % 2 ? noteW * 0.22 : noteW * 0.36;
        ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a2) * r2, Math.sin(a2) * r2);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      /* 另一个轨道的 TAP 正常打（对比） */
      var tx2 = laneX(0);
      if (gestureHit) { boxAt(tx2, judgeY, TYPES.tap.color); }
      else boxAt(tx2, ny, TYPES.tap.color);
    }

    keycaps(lit, gestureHit ? Math.max(0, 1 - ph) * 0.6 : 0);
  };
})(typeof window !== 'undefined' ? window : globalThis);

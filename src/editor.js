/* ==========================================================================
 * Resonance Engine · editor.js
 * 制谱编辑器：网格铺面、吸附、框选/拖动/缩放长条、撤销重做、试听、
 *             自动生成草稿、导入导出、一键试玩
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;
  var UI = RG.UI;          // screens.js 先于本文件加载

  var RULER_W = 58, TOP_PAD = 10, NOTE_H = 15, VIEW_W = 34;
  var SNAPS = [[1, '1/1'], [2, '1/2'], [4, '1/4'], [8, '1/8'], [12, '1/12'], [16, '1/16'], [32, '1/32'], [0, '无']];

  function defaultMusicDef(seed) {
    return {
      style: 'synthwave', seed: seed || 7777, bpm: 128, rootMidi: 45, scale: 'minor',
      sections: [
        { name: 'intro', intensity: 0, bars: 4 }, { name: 'verse', intensity: 1, bars: 12 },
        { name: 'chorus', intensity: 2, bars: 12 }, { name: 'bridge', intensity: 1, bars: 4 },
        { name: 'chorus', intensity: 3, bars: 12 }, { name: 'outro', intensity: 0, bars: 4 }
      ]
    };
  }

  var ED = RG.Editor = {
    chart: null,
    songDef: null,
    source: null,        // {song, diffIndex} 便于试玩后回到地图
    music: null,
    playing: false,
    time: 0,
    viewT: 0,
    pps: 150,
    snap: 4,
    toolType: 'tap',
    selection: [],
    clipboard: [],
    viewSel: null,
    undoStack: [],
    redoStack: [],
    hovering: null,
    drag: null,
    box: null,
    cursor: { t: 0, lane: 0, x: 0, y: 0 },
    metronome: false,
    _lastBeat: -1,
    _energy: null,
    _raf: 0
  };

  /* ---------------- 生命周期 ---------------- */
  ED.init = function (app) {
    ED.app = app;
    ED.canvas = document.getElementById('editor-canvas');
    ED.pps = RG.Store.get('editorZoom') || 150;
    ED.snap = RG.Store.get('editorSnap') || 4;
    ED.metronome = !!RG.Store.get('editorMetronome');
    ED._bind();
    ED.renderTools();
  };

  ED.open = function (chart, songDef, source) {
    ED.chart = chart ? RG.Chart.clone(chart) : null;
    ED.songDef = songDef || null;
    ED.source = source || null;
    if (!ED.chart) {
      var seed = Math.floor(Math.random() * 100000);
      var music = defaultMusicDef(seed);
      ED.chart = RG.Chart.create({
        id: U.uid('custom'), songId: 'custom-' + seed, title: '新谱面', artist: '我',
        difficulty: '自定义', level: 7, lanes: RG.Store.get('defaultLanes') || 4,
        bpm: music.bpm, offsetSec: 0, length: 0, author: 'me', builtin: false,
        music: music, seed: seed, desc: ''
      });
      var built = RG.Music.build(music);
      ED.chart.meta.length = Math.round(built.duration);
      ED.songDef = { title: '程序生成曲目', music: music };
    }
    if (!ED.chart.meta.music) ED.chart.meta.music = (ED.songDef && ED.songDef.music) || defaultMusicDef(ED.chart.meta.seed || 1);
    RG.Chart.normalize(ED.chart);
    ED.music = RG.Music.build(ED.chart.meta.music);
    if (!ED.chart.meta.length) ED.chart.meta.length = Math.round(ED.music.duration);
    ED._energy = null;
    ED.time = 0; ED.viewT = 0;
    ED.selection = []; ED.undoStack = []; ED.redoStack = [];
    ED.playing = false; ED._lastBeat = -1;
    RG.audio.load(ED.chart.meta.music, 'editor:' + ED.chart.meta.id);
    ED.syncFields();
    ED.renderTools();
    ED.resize();
    UI.show('screen-editor');
    setTimeout(function () { ED.resize(); }, 30);
    if (!ED._loop) { ED._loop = true; ED.tick(); }
  };

  ED.close = function (save) {
    ED.stop();
    if (save && ED.chart) ED.save(true);
    ED._loop = false;
    UI.show('screen-workshop');
    UI.renderWorkshop(ED.app.workshopHandlers());
  };

  ED.save = function (silent) {
    if (!ED.chart) return null;
    ED.chart.meta.title = (document.getElementById('ed-title').value || '未命名谱面').trim();
    RG.Chart.normalize(ED.chart);
    RG.Store.upsertChart(ED.chart);
    if (!silent) UI.toast('已保存「' + ED.chart.meta.title + '」', 'ok');
    return ED.chart;
  };

  ED.resize = function () {
    if (!ED.canvas) return;
    var s = U.canvasSize(ED.canvas, 2);
    ED.ctx = s.ctx; ED.w = s.w; ED.h = s.h; ED.dpr = s.dpr;
    ED.laneW = (ED.w - RULER_W - VIEW_W - 10) / Math.max(1, ED.chart ? ED.chart.meta.lanes : 4);
  };

  /* ---------------- 视角切换环节 ---------------- */
  ED.viewEvents = function () {
    if (!ED.chart.meta.viewEvents) ED.chart.meta.viewEvents = [];
    return ED.chart.meta.viewEvents;
  };
  ED.eraAt = function (t) { return RG.Chart.viewAt(ED.chart, t).mode; };
  ED.selView = function () {
    if (!ED.viewSel) return null;
    var evs = ED.viewEvents();
    for (var i = 0; i < evs.length; i++) {
      if (evs[i].mode === ED.viewSel.mode && Math.abs(evs[i].t - ED.viewSel.t) < 0.001) return evs[i];
    }
    ED.viewSel = null;
    return null;
  };
  ED.addView = function (t, mode) {
    ED.snapshot();
    var ev = { t: +Math.max(0, ED.snapTime(t)).toFixed(3), mode: mode, dur: mode === '3d' ? 1.0 : 0.7 };
    ED.viewEvents().push(ev);
    RG.Chart.normalizeViews(ED.chart);
    ED.viewSel = { t: ev.t, mode: ev.mode };
    return ev;
  };
  ED.removeView = function (ev) {
    if (!ev) return;
    ED.snapshot();
    var evs = ED.viewEvents();
    var i = evs.indexOf(ev);
    if (i >= 0) evs.splice(i, 1);
    RG.Chart.normalizeViews(ED.chart);
    ED.viewSel = null;
  };
  ED.hitView = function (y) {
    var evs = ED.viewEvents();
    for (var i = 0; i < evs.length; i++) {
      if (Math.abs(ED.yOf(evs[i].t) - y) < 9) return evs[i];
    }
    return null;
  };
  /** 在视图轨上点一下：有标记就选中，否则按当前时代取反放置切换 */
  ED.toggleViewAt = function (t) {
    var evs = ED.viewEvents();
    for (var i = 0; i < evs.length; i++) {
      if (Math.abs(evs[i].t - t) < 0.12) { ED.viewSel = { t: evs[i].t, mode: evs[i].mode }; return null; }
    }
    var era = ED.eraAt(t);
    return ED.addView(t, era === '3d' ? '2d' : '3d');
  };

  /* ---------------- 工具条 ---------------- */
  ED.renderTools = function () {
    var host = document.getElementById('ed-note-tools');
    U.clear(host);
    host.style.gridTemplateColumns = '1fr';
    RG.Chart.ORDER.forEach(function (k, i) {
      var t = RG.Chart.TYPES[k];
      host.appendChild(U.el('button', {
        class: 'gbtn note-tool' + (ED.toolType === k ? ' on' : ''),
        'data-note': k,
        html: '<span class="sw" style="background:' + t.color + '"></span>' + (i + 1) + ' · ' + t.label,
        onclick: function () { ED.setType(k); }
      }));
    });
    var snapHost = U.clear(document.getElementById('ed-snap-tools'));
    snapHost.appendChild(U.el('button', {
      class: 'gbtn wide', text: '吸附 ' + (SNAPS.filter(function (s) { return s[0] === ED.snap; })[0] || [0, '无'])[1],
      onclick: function () { ED.cycleSnap(1); }
    }));
    ED.renderViewTools();
    var lanes = document.getElementById('ed-lanes');
    if (lanes && ED.chart) lanes.value = String(ED.chart.meta.lanes);
  };

  /** 视角环节工具组 */
  ED.renderViewTools = function () {
    if (!ED.chart) return;
    var container = document.querySelector('.ed-tools');
    if (!container) return;
    var host = document.getElementById('ed-view-tools');
    if (!host) {
      host = U.el('div', { class: 'tool-group grow', id: 'ed-view-tools' });
      container.appendChild(host);
    }
    U.clear(host);
    var evs = ED.viewEvents();
    var st = RG.Chart.viewTotals(ED.chart);
    host.appendChild(U.el('div', {
      class: 'set-label', style: 'grid-column:1/-1',
      html: '<b style="color:#38e8ff">视角环节</b><i>' + evs.length + ' 次切换 · 3D ' +
        Math.round(st.three) + 's / 2D ' + Math.round(st.two) + 's</i>'
    }));
    var seg = U.el('div', { class: 'seg', style: 'grid-column:1/-1' });
    [['2d', '起始 2D'], ['3d', '起始 3D']].forEach(function (o) {
      seg.appendChild(U.el('button', {
        class: (ED.chart.meta.view === o[0]) ? 'on' : '', text: o[1],
        onclick: function () {
          ED.snapshot();
          ED.chart.meta.view = o[0];
          RG.Chart.normalizeViews(ED.chart);
          ED.renderViewTools();
          UI.toast('起始视角 → ' + (o[0] === '3d' ? '3D 立体' : '2D 平面'), 'ok');
        }
      }));
    });
    host.appendChild(seg);
    var row = U.el('div', { class: 'seg', style: 'grid-column:1/-1' });
    row.appendChild(U.el('button', {
      class: 'wide', text: '＋ 切到 2D',
      onclick: function () { ED.addView(ED.time, '2d'); ED.renderViewTools(); }
    }));
    row.appendChild(U.el('button', {
      class: 'wide', text: '＋ 切到 3D',
      onclick: function () { ED.addView(ED.time, '3d'); ED.renderViewTools(); }
    }));
    host.appendChild(row);
    host.appendChild(U.el('div', {
      class: 'set-label', style: 'grid-column:1/-1',
      html: '<i>左键点左侧「视角轨」空白处 = 按当前时代取反放置切换；拖动可改时间；右键删除。快捷键 <kbd>V</kbd> 在播放头处切换。</i>'
    }));
  };

  ED.setType = function (k) {
    ED.toolType = k;
    RG.Chart.ORDER.forEach(function (x) {
      var b = document.querySelector('[data-note="' + x + '"]');
      if (b) b.classList.toggle('on', x === k);
    });
  };
  ED.cycleSnap = function (dir) {
    var idx = 0;
    SNAPS.forEach(function (s, i) { if (s[0] === ED.snap) idx = i; });
    idx = U.clamp(idx + dir, 0, SNAPS.length - 1);
    ED.snap = SNAPS[idx][0];
    RG.Store.set('editorSnap', ED.snap);
    ED.renderTools();
  };

  ED.syncFields = function () {
    if (!ED.chart) return;
    document.getElementById('ed-title').value = ED.chart.meta.title || '';
    document.getElementById('ed-song-name').textContent = ED.songDef ? ('曲目：' + (ED.songDef.title || '自定义')) : '曲目：程序生成';
    document.getElementById('ed-bpm').value = ED.chart.meta.bpm;
    document.getElementById('ed-offset').value = Math.round((ED.chart.meta.offsetSec || 0) * 1000);
    document.getElementById('ed-length').value = Math.round(ED.chart.meta.length);
    var lanes = document.getElementById('ed-lanes');
    if (lanes) lanes.value = String(ED.chart.meta.lanes);
  };

  /* ---------------- 播放 ---------------- */
  ED.play = function () {
    if (!ED.chart) return;
    RG.audio.unlock();
    RG.audio.load(ED.chart.meta.music, 'editor:' + ED.chart.meta.id);
    RG.audio.play(ED.time + (ED.chart.meta.offsetSec || 0));
    ED.playing = true;
    ED._lastBeat = Math.floor(ED.time / RG.Chart.beatDurOf(ED.chart)) - 1;
    var btn = document.querySelector('[data-action="ed-toggle-play"]');
    if (btn) btn.textContent = '⏸ 暂停';
  };
  ED.stop = function () {
    RG.audio.pause();
    ED.playing = false;
    var btn = document.querySelector('[data-action="ed-toggle-play"]');
    if (btn) btn.textContent = '▶ 播放';
  };
  ED.toggle = function () { if (ED.playing) ED.stop(); else ED.play(); };
  ED.seek = function (t) {
    ED.time = U.clamp(t, 0, ED.chart ? ED.chart.meta.length : 0);
    if (ED.playing) { RG.audio.seek(ED.time + (ED.chart.meta.offsetSec || 0)); }
    ED.viewT = U.clamp(ED.viewT, ED.time - (ED.h - TOP_PAD) / ED.pps, ED.time);
  };

  /* ---------------- 编辑操作 ---------------- */
  ED.snapshot = function () {
    ED.undoStack.push({ notes: U.deepClone(ED.chart.notes), meta: U.deepClone(ED.chart.meta) });
    if (ED.undoStack.length > 80) ED.undoStack.shift();
    ED.redoStack.length = 0;
  };
  ED.undo = function () {
    if (!ED.undoStack.length) { UI.toast('没有可撤销的操作'); return; }
    var st = ED.undoStack.pop();
    ED.redoStack.push({ notes: U.deepClone(ED.chart.notes), meta: U.deepClone(ED.chart.meta) });
    ED.chart.notes = st.notes; ED.chart.meta = st.meta;
    ED.selection = []; ED.syncFields(); ED.renderTools();
  };
  ED.redo = function () {
    if (!ED.redoStack.length) return;
    var st = ED.redoStack.pop();
    ED.undoStack.push({ notes: U.deepClone(ED.chart.notes), meta: U.deepClone(ED.chart.meta) });
    ED.chart.notes = st.notes; ED.chart.meta = st.meta;
    ED.selection = []; ED.syncFields(); ED.renderTools();
  };
  ED.snapTime = function (t) { return RG.Chart.snap(ED.chart, t, ED.snap, 0); };
  ED._sort = function () { ED.chart.notes.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; }); };

  ED.place = function (t, lane, dur) {
    var type = ED.toolType;
    var n = { t: +ED.snapTime(t).toFixed(4), lane: U.clamp(lane, 0, ED.chart.meta.lanes - 1), type: type };
    if (type === 'hold') n.d = +Math.max(RG.Chart.beatDurOf(ED.chart) / 2, dur || RG.Chart.beatDurOf(ED.chart)).toFixed(4);
    if (type === 'slide') {
      n.d = +Math.max(RG.Chart.beatDurOf(ED.chart) / 2, dur || RG.Chart.beatDurOf(ED.chart)).toFixed(4);
      n.tail = (n.lane + 1) % ED.chart.meta.lanes;
    }
    ED.snapshot();
    ED.chart.notes.push(n);
    ED._sort();
    ED.selection = [n];
    return n;
  };
  ED.remove = function (notes) {
    if (!notes.length) return;
    ED.snapshot();
    ED.chart.notes = ED.chart.notes.filter(function (n) { return notes.indexOf(n) < 0; });
    ED.selection = [];
  };
  ED.copy = function () {
    ED.clipboard = U.deepClone(ED.selection);
    UI.toast('已复制 ' + ED.clipboard.length + ' 个音符');
  };
  ED.paste = function () {
    if (!ED.clipboard.length) return;
    var base = ED.clipboard.reduce(function (a, n) { return Math.min(a, n.t); }, Infinity);
    var at = ED.cursor.t;
    ED.snapshot();
    ED.clipboard.forEach(function (c) {
      var n = U.deepClone(c);
      n.t = +(n.t - base + at).toFixed(4);
      ED.chart.notes.push(n);
    });
    ED._sort();
    ED.clipboard = ED.clipboard; // 保持剪贴板
    UI.toast('已粘贴到 ' + U.fmtTime(at, true));
  };
  ED.mirror = function () {
    ED.snapshot();
    var L = ED.chart.meta.lanes - 1;
    ED.chart.notes.forEach(function (n) {
      n.lane = L - n.lane;
      if (n.type === 'slide' && n.tail !== undefined) n.tail = L - n.tail;
    });
    ED._sort();
    UI.toast('已镜像');
  };
  ED.quantize = function () {
    ED.snapshot();
    ED.chart.notes.forEach(function (n) { n.t = +ED.snapTime(n.t).toFixed(4); });
    ED._sort();
    UI.toast('已量化到吸附网格');
  };
  ED.clear = function () {
    UI.confirm('清空谱面', '将删除当前谱面的全部音符。', function () {
      ED.snapshot();
      ED.chart.notes = [];
      ED.selection = [];
      UI.toast('已清空', 'ok');
    });
  };
  ED.generate = function (level) {
    var music = ED.music || RG.Music.build(ED.chart.meta.music);
    var chart = RG.Chart.generate(music, {
      lanes: ED.chart.meta.lanes, level: level, seed: Math.floor(Math.random() * 99999),
      songId: ED.chart.meta.songId, title: ED.chart.meta.title, artist: ED.chart.meta.artist,
      difficulty: ED.chart.meta.difficulty, theme: ED.chart.meta.theme, desc: ED.chart.meta.desc
    });
    ED.snapshot();
    ED.chart.notes = chart.notes;
    ED.chart.meta.bpm = music.bpm;
    ED.chart.meta.length = Math.round(music.duration);
    ED.chart.meta.level = level;
    ED.selection = [];
    ED.syncFields();
    UI.toast('已生成 ' + chart.notes.length + ' 个音符的草稿', 'ok');
  };

  /* ---------------- 坐标 / 命中 ---------------- */
  ED.view = function () {
    if (!ED.chart) return { pps: ED.pps, laneW: ED.laneW, t: ED.viewT };
    return { pps: ED.pps, laneW: ED.laneW, t: ED.viewT };
  };
  ED.yOf = function (t) { return TOP_PAD + (t - ED.viewT) * ED.pps; };
  ED.tOf = function (y) { return (y - TOP_PAD) / ED.pps + ED.viewT; };
  ED.xOf = function (lane) { return RULER_W + VIEW_W + lane * ED.laneW; };
  ED.laneOf = function (x) {
    return U.clamp(Math.floor((x - RULER_W - VIEW_W) / ED.laneW), 0, ED.chart.meta.lanes - 1);
  };
  ED.zoneOf = function (x) {
    if (x < RULER_W) return 'ruler';
    if (x < RULER_W + VIEW_W) return 'view';
    return 'grid';
  };

  ED.hitTest = function (x, y) {
    var notes = ED.chart.notes;
    for (var i = notes.length - 1; i >= 0; i--) {
      var n = notes[i];
      var y0 = ED.yOf(n.t), y1 = ED.yOf(n.t + (n.d || 0));
      var x0 = ED.xOf(n.lane) + 4, x1 = ED.xOf(n.lane + 1) - 4;
      var inside = (n.d > 0)
        ? (x >= x0 && x <= x1 && y >= Math.min(y0, y1) - NOTE_H / 2 && y <= Math.max(y0, y1) + NOTE_H / 2)
        : (x >= x0 && x <= x1 && y >= y0 - NOTE_H && y <= y0 + NOTE_H);
      if (inside) {
        var tailHit = n.d > 0 && Math.abs(y - y1) < 8;
        return { note: n, tail: tailHit };
      }
    }
    return null;
  };

  /* ---------------- 事件绑定 ---------------- */
  ED._bind = function () {
    var cv = ED.canvas;
    var self = ED;
    U.on(cv, 'contextmenu', function (e) { e.preventDefault(); });
    U.on(cv, 'pointerdown', function (e) {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      ED._onDown(e);
    });
    U.on(cv, 'pointermove', function (e) {
      var r = cv.getBoundingClientRect();
      ED._onMove(e.clientX - r.left, e.clientY - r.top, e);
    });
    U.on(cv, 'pointerup', function (e) {
      var r = cv.getBoundingClientRect();
      ED._onUp(e.clientX - r.left, e.clientY - r.top, e);
    });
    U.on(cv, 'wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.altKey || e.metaKey) {
        var r = cv.getBoundingClientRect();
        var my = e.clientY - r.top;
        var anchor = ED.tOf(my);
        var f = e.deltaY > 0 ? 0.88 : 1.14;
        ED.pps = U.clamp(ED.pps * f, 24, 900);
        RG.Store.set('editorZoom', ED.pps);
        ED.viewT = anchor - (my - TOP_PAD) / ED.pps;
      } else {
        ED.viewT += (e.deltaY / ED.pps) * 0.9;
        ED.playing = false;
      }
      ED.viewT = U.clamp(ED.viewT, -1, Math.max(0, ED.chart.meta.length - 0.5));
    }, { passive: false });

    /* 键盘快捷键 */
    U.on(window, 'keydown', function (e) {
      if (UI.current !== 'screen-editor') return;
      var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? ED.redo() : ED.undo(); return; }
      if (ctrl && e.code === 'KeyY') { e.preventDefault(); ED.redo(); return; }
      if (ctrl && e.code === 'KeyC') { e.preventDefault(); ED.copy(); return; }
      if (ctrl && e.code === 'KeyV') { e.preventDefault(); ED.paste(); return; }
      if (ctrl && e.code === 'KeyA') { e.preventDefault(); ED.selection = ED.chart.notes.slice(); return; }
      if (ctrl && e.code === 'KeyS') { e.preventDefault(); ED.save(); return; }
      if (e.code === 'Space') { e.preventDefault(); ED.toggle(); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        var sv = ED.selView();
        if (sv) ED.removeView(sv); else ED.remove(ED.selection);
        ED.renderViewTools();
        return;
      }
      if (e.code === 'Escape') { ED.selection = []; ED.viewSel = null; return; }
      if (e.code === 'KeyV') {   // 在播放头处增删视角切换
        ED.toggleViewAt(ED.snapTime(ED.time));
        ED.renderViewTools();
        return;
      }
      if (e.code === 'KeyQ') { ED.cycleSnap(-1); return; }
      if (e.code === 'KeyE') { ED.cycleSnap(1); return; }
      if (e.code === 'Home') { ED.seek(0); return; }
      if (e.code === 'KeyZ') { // 微调
        ED.snapshot();
        ED.selection.forEach(function (n) { n.t = Math.max(0, n.t - RG.Chart.beatDurOf(ED.chart) / 16); });
        ED._sort(); return;
      }
      if (e.code === 'KeyX') {
        ED.snapshot();
        ED.selection.forEach(function (n) { n.t += RG.Chart.beatDurOf(ED.chart) / 16; });
        ED._sort(); return;
      }
      var digits = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };
      if (digits[e.code] !== undefined) ED.setType(RG.Chart.ORDER[digits[e.code]]);
      if (e.code === 'KeyW') { // 循环切换长条类型
        var cur = ED.selection[0];
        if (cur && (cur.type === 'hold' || cur.type === 'slide')) {
          ED.snapshot();
          cur.type = cur.type === 'hold' ? 'slide' : 'hold';
          if (cur.type === 'slide') { cur.tail = (cur.lane + 1) % ED.chart.meta.lanes; }
          else delete cur.tail;
        }
      }
    });

    /* 工具条输入 */
    ['ed-bpm', 'ed-offset', 'ed-length'].forEach(function (id) {
      U.on(document.getElementById(id), 'change', function () {
        var v = parseFloat(this.value);
        if (id === 'ed-bpm') { ED.chart.meta.bpm = U.clamp(v || 120, 40, 300); }
        if (id === 'ed-offset') { ED.chart.meta.offsetSec = U.clamp(v || 0, -500, 500) / 1000; }
        if (id === 'ed-length') { ED.chart.meta.length = U.clamp(v || 60, 5, 900); }
        ED.viewT = ED.viewT;
      });
    });
    U.on(document.getElementById('ed-lanes'), 'change', function () {
      var n = +this.value;
      ED.snapshot();
      ED.chart.meta.lanes = n;
      ED.chart.notes.forEach(function (nt) {
        nt.lane = U.clamp(nt.lane, 0, n - 1);
        if (nt.tail !== undefined) nt.tail = U.clamp(nt.tail, 0, n - 1);
      });
      ED.resize();
      UI.toast('轨道数 → ' + n, 'ok');
    });
    var genLevel = document.getElementById('ed-gen-level');
    U.on(genLevel, 'input', function () { document.getElementById('ed-gen-level-v').textContent = this.value; });
  };

  ED._pos = function (e) {
    var r = ED.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  ED._onDown = function (e) {
    var p = ED._pos(e);
    ED.cursor = { t: ED.tOf(p.y), lane: ED.laneOf(p.x), x: p.x, y: p.y };
    RG.audio.unlock();
    var zone = ED.zoneOf(p.x);
    /* 右键：删除 / 平移 */
    if (e.button === 2) {
      if (zone === 'view') {
        var hv = ED.hitView(p.y);
        if (hv) ED.removeView(hv);
        return;
      }
      var hitR = ED.hitTest(p.x, p.y);
      if (hitR) { ED.remove([hitR.note]); return; }
      ED.drag = { mode: 'pan', y0: p.y, t0: ED.viewT };
      return;
    }
    /* 标尺：拖动播放头 */
    if (zone === 'ruler') {
      ED.drag = { mode: 'scrub' };
      ED.stop();
      ED.seek(ED.tOf(p.y));
      return;
    }
    /* 视角轨：拖动已有标记，或点空白处放置切换环节 */
    if (zone === 'view') {
      var hitV = ED.hitView(p.y);
      if (hitV) {
        ED.snapshot();
        ED.viewSel = { t: hitV.t, mode: hitV.mode };
        ED.drag = { mode: 'viewmove', ev: hitV, y0: p.y, t0: hitV.t };
      } else {
        RG.Chart.normalizeViews(ED.chart);
        var ev = ED.toggleViewAt(ED.snapTime(ED.tOf(p.y)));
        if (ev) ED.drag = { mode: 'viewmove', ev: ev, y0: p.y, t0: ev.t, moved: false };
      }
      return;
    }
    var hit = ED.hitTest(p.x, p.y);
    if (hit) {
      if (e.shiftKey) {
        var at = ED.selection.indexOf(hit.note);
        if (at >= 0) ED.selection.splice(at, 1); else ED.selection.push(hit.note);
      } else if (ED.selection.indexOf(hit.note) < 0) {
        ED.selection = [hit.note];
      }
      ED.snapshot();
      ED.drag = {
        mode: hit.tail ? 'resize' : 'move', note: hit.note, x0: p.x, y0: p.y,
        orig: ED.selection.map(function (n) { return { n: n, t: n.t, lane: n.lane, d: n.d || 0 }; })
      };
      return;
    }
    ED.drag = { mode: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, t0: ED.snapTime(ED.tOf(p.y)), lane: ED.laneOf(p.x) };
    if (!e.shiftKey) ED.selection = [];
  };

  ED._onMove = function (px, py) {
    ED.cursor = { t: ED.tOf(py), lane: ED.laneOf(px), x: px, y: py };
    var d = ED.drag;
    if (!d) { ED.hovering = ED.hitTest(px, py); return; }
    if (d.mode === 'pan') { ED.viewT = d.t0 - (py - d.y0) / ED.pps; return; }
    if (d.mode === 'scrub') { ED.seek(ED.tOf(py)); return; }
    if (d.mode === 'box') {
      d.x1 = px; d.y1 = py;
      if (Math.abs(px - d.x0) + Math.abs(py - d.y0) > 5) d.moved = true;
      return;
    }
    if (d.mode === 'move') {
      var dt = ED.snapTime(d.orig[0].t + (py - d.y0) / ED.pps) - d.orig[0].t;
      var dl = ED.laneOf(px) - ED.laneOf(d.x0);
      d.orig.forEach(function (o) {
        o.n.t = Math.max(0, +(o.t + dt).toFixed(4));
        o.n.lane = U.clamp(o.lane + dl, 0, ED.chart.meta.lanes - 1);
      });
      ED._sort();
      return;
    }
    if (d.mode === 'resize') {
      var n = d.note;
      var end = ED.snapTime(ED.tOf(py));
      n.d = +Math.max(RG.Chart.beatDurOf(ED.chart) / 8, end - n.t).toFixed(4);
      return;
    }
    if (d.mode === 'viewmove') {
      var nt = +Math.max(0, ED.snapTime(d.t0 + (py - d.y0) / ED.pps)).toFixed(3);
      d.ev.t = nt;
      ED.viewSel = { t: nt, mode: d.ev.mode };
      return;
    }
  };

  ED._onUp = function (px, py) {
    var d = ED.drag;
    ED.drag = null;
    if (!d) return;
    if (d.mode === 'viewmove') { RG.Chart.normalizeViews(ED.chart); return; }
    if (d.mode === 'box') {
      if (!d.moved) {
        /* 单击空白 = 放置音符；纵向拖动可指定长条长度 */
        var dur = null;
        ED.place(d.t0, d.lane, dur);
      } else {
        var t0 = Math.min(ED.tOf(d.y0), ED.tOf(d.y1)), t1 = Math.max(ED.tOf(d.y0), ED.tOf(d.y1));
        var l0 = ED.laneOf(Math.min(d.x0, d.x1)), l1 = ED.laneOf(Math.max(d.x0, d.x1));
        var picked = ED.chart.notes.filter(function (n) { return n.t >= t0 && n.t <= t1 && n.lane >= l0 && n.lane <= l1; });
        ED.selection = picked;
      }
    }
  };

  /* ---------------- 生成草稿对话框 ---------------- */
  ED.generateDialog = function () {
    var songs = RG.Songs.all();
    var opts = songs.map(function (s, i) {
      return '<option value="' + s.id + '">' + s.title + ' · ' + s.artist + '（' + s.music.style + ' / ' + s.music.bpm + 'BPM）</option>';
    }).join('');
    UI.modal({
      title: '由乐曲生成草稿',
      body: '<div class="md-body">选择一首曲目作为素材，引擎会跟随鼓点与旋律自动铺面，之后可继续手动编辑。<br><br>' +
        '<b>曲目</b><br><select id="gen-song" style="margin-top:6px">' + opts + '</select><br><br>' +
        '<b>难度等级</b>（决定密度与音符种类）<br>' +
        '<input type="range" id="gen-level" min="1" max="19" value="8" style="width:100%">' +
        '<div id="gen-level-v" style="text-align:center;color:#38e8ff;font-family:Consolas,monospace">LV 8</div>' +
        '<b>轨道数</b><br><select id="gen-lanes" style="margin-top:6px">' +
        [4, 6, 8].map(function (n) { return '<option value="' + n + '"' + (n === RG.Store.get('defaultLanes') ? ' selected' : '') + '>' + n + ' 键</option>'; }).join('') +
        '</select></div>',
      buttons: [
        { label: '取消' },
        {
          label: '生成并打开', primary: true, keepOpen: false, onClick: function () {
            var songId = document.getElementById('gen-song').value;
            var lvl = +document.getElementById('gen-level').value;
            var lanes = +document.getElementById('gen-lanes').value;
            var song = RG.Songs.byId(songId) || songs[0];
            var music = RG.Music.build(song.music);
            var chart = RG.Chart.generate(music, {
              lanes: lanes, level: lvl, seed: Math.floor(Math.random() * 99999),
              songId: song.id + '-custom', title: song.title + '（自制）', artist: song.artist,
              difficulty: '自制 LV' + lvl, theme: song.theme, music: song.music, builtin: false
            });
            chart.meta.id = U.uid('custom');
            chart.meta.music = song.music;
            chart.meta.author = 'me';
            ED.open(chart, { title: song.title, music: song.music }, { song: song, diffIndex: 0 });
            UI.toast('已生成草稿：' + chart.notes.length + ' 音符', 'ok');
          }
        }
      ]
    });
    setTimeout(function () {
      var r = document.getElementById('gen-level');
      if (r) r.oninput = function () { document.getElementById('gen-level-v').textContent = 'LV ' + r.value; };
    }, 20);
  };

  /* ---------------- 渲染 ---------------- */
  ED.tick = function () {
    if (!ED._loop) return;
    requestAnimationFrame(ED.tick);
    if (UI.current !== 'screen-editor' || !ED.chart) return;
    var now = performance.now();
    var dt = ED._lastT ? Math.min(0.05, (now - ED._lastT) / 1000) : 0.016;
    ED._lastT = now;

    if (ED.playing) {
      ED.time = U.clamp(RG.audio.now() - (ED.chart.meta.offsetSec || 0), 0, ED.chart.meta.length);
      var beat = RG.Chart.beatDurOf(ED.chart);
      if (ED.metronome) {
        var bi = Math.floor(ED.time / beat);
        if (bi !== ED._lastBeat) {
          ED._lastBeat = bi;
          RG.audio.metro(bi % 4 === 0);
        }
      }
      /* 跟随播放 */
      var yNow = ED.yOf(ED.time);
      if (yNow > ED.h * 0.62) ED.viewT = ED.time - (ED.h * 0.62 - TOP_PAD) / ED.pps;
      if (yNow < TOP_PAD) ED.viewT = ED.time;
      if (RG.audio.now() > ED.chart.meta.length + (ED.chart.meta.offsetSec || 0)) ED.stop();
    } else {
      ED.time = U.clamp(ED.time, 0, ED.chart.meta.length);
    }
    ED.draw();
  };

  ED._energyAt = function (bins) {
    if (!ED._energy || ED._energy.length !== bins) {
      ED._energy = new Array(bins).fill(0);
      var m = ED.music;
      m.events.forEach(function (e) {
        if (e.type === 'pad') return;
        var idx = Math.floor((e.t / m.duration) * bins);
        if (idx >= 0 && idx < bins) ED._energy[idx] = Math.min(1, ED._energy[idx] + (e.type === 'kick' || e.type === 'snare' ? 0.5 : 0.22));
      });
    }
    return ED._energy;
  };

  ED.draw = function () {
    var ctx = ED.ctx, chart = ED.chart;
    if (!ctx) return;
    var cw = ED.canvas.clientWidth, ch = ED.canvas.clientHeight;
    if (cw && ch && (Math.abs(cw - ED.w) > 0.5 || Math.abs(ch - ED.h) > 0.5)) { ED.resize(); ctx = ED.ctx; }
    var lanes = chart.meta.lanes;
    var laneW = ED.laneW;
    var th = (chart.meta.theme) || { a: '#38e8ff', b: '#ff4fd8' };
    ctx.setTransform(ED.dpr, 0, 0, ED.dpr, 0, 0);
    ctx.clearRect(0, 0, ED.w, ED.h);
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, ED.w, ED.h);

    var beat = RG.Chart.beatDurOf(chart);
    var t0 = ED.viewT, t1 = ED.tOf(ED.h);
    var beat0 = Math.floor(t0 / beat), beat1 = Math.ceil(t1 / beat);
    var gridX0 = ED.xOf(0), gridX1 = ED.xOf(lanes);
    var evs = ED.viewEvents();

    /* 时代底色：2D 冷 / 3D 暖，一眼看出谱面的视角分布 */
    (function () {
      var cur = chart.meta.view === '3d' ? '3d' : '2d';
      var from = 0;
      var segs = evs.concat([{ t: chart.meta.length, mode: null }]);
      segs.forEach(function (e) {
        var yA = ED.yOf(from), yB = ED.yOf(e.t);
        if (yB > 0 && yA < ED.h) {
          ctx.fillStyle = cur === '3d' ? 'rgba(255,79,216,0.055)' : 'rgba(56,232,255,0.035)';
          ctx.fillRect(gridX0, yA, gridX1 - gridX0, Math.max(0, yB - yA));
          /* 切换的过渡带 */
          if (e.mode) {
            var yT = ED.yOf(e.t + e.dur);
            ctx.fillStyle = cur === '3d' ? 'rgba(56,232,255,0.12)' : 'rgba(255,79,216,0.12)';
            ctx.fillRect(gridX0, yB, gridX1 - gridX0, Math.max(2, yT - yB));
          }
        }
        if (e.mode) { cur = e.mode; from = e.t; }
      });
    })();

    /* 轨道底色 */
    for (var i = 0; i < lanes; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.022)' : 'rgba(255,255,255,0.045)';
      ctx.fillRect(ED.xOf(i), 0, laneW, ED.h);
      ctx.strokeStyle = 'rgba(120,150,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(ED.xOf(i) + 0.5, 0); ctx.lineTo(ED.xOf(i) + 0.5, ED.h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,150,255,0.14)';
    ctx.beginPath(); ctx.moveTo(ED.xOf(lanes) - 0.5, 0); ctx.lineTo(ED.xOf(lanes) - 0.5, ED.h); ctx.stroke();

    /* 节拍网格 */
    for (var b = beat0; b <= beat1; b++) {
      if (b < 0) continue;
      var y = ED.yOf(b * beat);
      if (y < -2 || y > ED.h + 2) continue;
      var isBar = b % 4 === 0;
      var isBeat = true;
      ctx.strokeStyle = isBar ? 'rgba(120,150,255,0.5)' : 'rgba(120,150,255,0.2)';
      ctx.lineWidth = isBar ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(RULER_W, y + 0.5); ctx.lineTo(ED.xOf(lanes), y + 0.5); ctx.stroke();
      if (ED.snap >= 4) {
        for (var s = 1; s < ED.snap; s++) {
          var y2 = ED.yOf(b * beat + (s / ED.snap) * beat);
          if (y2 < 0 || y2 > ED.h) continue;
          ctx.strokeStyle = 'rgba(120,150,255,0.08)';
          ctx.beginPath(); ctx.moveTo(RULER_W, y2 + 0.5); ctx.lineTo(ED.xOf(lanes), y2 + 0.5); ctx.stroke();
        }
      }
    }

    /* 标尺 */
    ctx.fillStyle = 'rgba(6,9,16,0.92)';
    ctx.fillRect(0, 0, RULER_W, ED.h);
    ctx.strokeStyle = 'rgba(120,150,255,0.25)';
    ctx.beginPath(); ctx.moveTo(RULER_W - 0.5, 0); ctx.lineTo(RULER_W - 0.5, ED.h); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.font = '600 10px Consolas,monospace';
    for (var bb = beat0; bb <= beat1; bb++) {
      if (bb < 0) continue;
      var yy = ED.yOf(bb * beat);
      if (yy < -8 || yy > ED.h + 8) continue;
      if (bb % 4 === 0) {
        ctx.fillStyle = 'rgba(160,180,230,0.9)';
        ctx.fillText(String(bb / 4 + 1), RULER_W - 8, yy + 3);
        ctx.strokeStyle = 'rgba(120,150,255,0.5)';
        ctx.beginPath(); ctx.moveTo(RULER_W - 6, yy + 0.5); ctx.lineTo(RULER_W, yy + 0.5); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(120,140,190,0.55)';
        ctx.fillText('·', RULER_W - 8, yy + 3);
      }
    }
    /* 音乐能量条 */
    var bins = 140;
    var energy = ED._energyAt(bins);
    ctx.fillStyle = 'rgba(56,232,255,0.3)';
    for (var e2 = 0; e2 < bins; e2++) {
      var et = (e2 / bins) * chart.meta.length;
      var ey = ED.yOf(et);
      if (ey < 0 || ey > ED.h) continue;
      var ew = energy[e2] * (RULER_W - 14);
      if (ew > 0.5) ctx.fillRect(6, ey, ew, 1.6);
    }

    /* ============ 视角轨（2D/3D 切换环节标记） ============ */
    var vx0 = RULER_W, vx1 = RULER_W + VIEW_W;
    ctx.fillStyle = 'rgba(8,11,20,0.96)';
    ctx.fillRect(vx0, 0, VIEW_W, ED.h);
    (function drawViewLane() {
      var cur = chart.meta.view === '3d' ? '3d' : '2d';
      var from = 0;
      var segs = evs.concat([{ t: chart.meta.length, mode: null }]);
      segs.forEach(function (e) {
        var yA = ED.yOf(from), yB = ED.yOf(e.t);
        /* 时代色条 */
        var col = cur === '3d' ? '#ff4fd8' : '#38e8ff';
        ctx.fillStyle = U.rgba(col, 0.16);
        ctx.fillRect(vx0 + 2, yA, VIEW_W - 8, Math.max(0, yB - yA));
        ctx.fillStyle = U.rgba(col, 0.55);
        ctx.fillRect(vx0 + 2, yA, 3, Math.max(0, yB - yA));
        /* 时代标签 */
        if (yB - yA > 34) {
          ctx.save();
          ctx.fillStyle = U.rgba(col, 0.85);
          ctx.font = '700 10px Consolas,monospace';
          ctx.textAlign = 'center';
          ctx.translate(vx0 + VIEW_W / 2 + 2, yA + 16);
          ctx.fillText(cur === '3d' ? '3D' : '2D', 0, 0);
          ctx.restore();
        }
        if (e.mode) { cur = e.mode; from = e.t; }
      });
      /* 标记：三角箭头 + 目标视角文字 */
      evs.forEach(function (e) {
        var y = ED.yOf(e.t);
        if (y < -20 || y > ED.h + 20) return;
        var isSel = !!(ED.viewSel && ED.viewSel.mode === e.mode && Math.abs(ED.viewSel.t - e.t) < 0.001);
        var col = e.mode === '3d' ? '#ff4fd8' : '#38e8ff';
        ctx.save();
        /* 贯穿网格的虚线 */
        ctx.strokeStyle = U.rgba(col, isSel ? 0.95 : 0.5);
        ctx.lineWidth = isSel ? 2 : 1.2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(RULER_W, y + 0.5); ctx.lineTo(ED.xOf(lanes), y + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        /* 三角 */
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = isSel ? 14 : 6;
        ctx.beginPath();
        ctx.moveTo(vx0 + 8, y - 7);
        ctx.lineTo(vx0 + VIEW_W - 4, y);
        ctx.lineTo(vx0 + 8, y + 7);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '700 9px Consolas,monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = isSel ? '#fff' : 'rgba(255,255,255,0.72)';
        ctx.fillText(e.mode === '3d' ? '3D' : '2D', vx0 + 6, y + 3);
        /* 过渡时长刻度 */
        var yT = ED.yOf(e.t + e.dur);
        ctx.strokeStyle = U.rgba(col, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vx0 + VIEW_W - 6, y);
        ctx.lineTo(vx0 + VIEW_W - 6, yT);
        ctx.stroke();
        ctx.restore();
      });
      /* 当前时代指示（播放头处） */
      var eraNow = ED.eraAt(ED.time);
      ctx.save();
      ctx.fillStyle = eraNow === '3d' ? '#ff4fd8' : '#38e8ff';
      ctx.font = '700 9px Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('当前 ' + (eraNow === '3d' ? '3D' : '2D'), vx0 + VIEW_W / 2, ED.h - 6);
      ctx.restore();
    })();
    ctx.strokeStyle = 'rgba(120,150,255,0.25)';
    ctx.beginPath(); ctx.moveTo(vx1 - 0.5, 0); ctx.lineTo(vx1 - 0.5, ED.h); ctx.stroke();

    /* 音符 */
    chart.notes.forEach(function (n) {
      var T = RG.Chart.TYPES[n.type];
      var y = ED.yOf(n.t);
      if (y < -60 || y > ED.h + 60) return;
      var x = ED.xOf(n.lane) + 3, w = laneW - 6;
      var sel = ED.selection.indexOf(n) >= 0;
      ctx.save();
      if (n.d > 0) {
        var y1 = ED.yOf(n.t + n.d);
        var top = Math.min(y, y1), hh = Math.max(4, Math.abs(y - y1));
        ctx.fillStyle = U.rgba(T.color, 0.32);
        ctx.fillRect(x, top, w, hh);
        ctx.strokeStyle = U.rgba(T.color, 0.85);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 0.5, top + 0.5, w - 1, hh - 1);
        if (n.type === 'slide' && n.tail !== undefined) {
          var tx = ED.xOf(n.tail) + laneW / 2, ty = ED.yOf(n.t + n.d);
          ctx.strokeStyle = U.rgba('#ffd35c', 0.9);
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(x + w / 2, ty); ctx.lineTo(tx, ty - 10); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffd35c';
          ctx.beginPath(); ctx.arc(tx, ty - 10, 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = U.rgba(T.color, 0.9);
        ctx.fillRect(x, y - 3, w, 6);          // 头部
        ctx.fillRect(x, y1 - 3, w, 6);         // 尾部
      }
      ctx.fillStyle = U.rgba(T.color, n.type === 'mine' ? 0.95 : 1);
      if (n.type === 'mine') {
        ctx.save();
        ctx.translate(x + w / 2, y);
        ctx.beginPath();
        for (var k = 0; k < 10; k++) {
          var a = (k / 10) * Math.PI * 2, r = k % 2 ? w * 0.3 : w * 0.46;
          ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r * 0.6);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        /* 单点 / 点划：同一种外形（点划只是换了颜色，并在上方隔一点空隙加一个尖顶） */
        ctx.fillRect(x, y - NOTE_H / 2, w, NOTE_H);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, y - NOTE_H / 2, w, 3);
        if (n.type === 'flick') {
          /* 点划：方块上方隔一点空隙加一个尖顶 */
          ctx.save();
          ctx.fillStyle = TYPES[n.type].color;
          var tipY = y - NOTE_H / 2 - 8;
          ctx.beginPath();
          ctx.moveTo(x + w / 2, tipY);
          ctx.lineTo(x + w * 0.72, tipY + 5.5);
          ctx.lineTo(x + w * 0.28, tipY + 5.5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.moveTo(x + w / 2, tipY);
          ctx.lineTo(x + w * 0.58, tipY + 2.6);
          ctx.lineTo(x + w * 0.42, tipY + 2.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      if (sel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2.5, (n.d > 0 ? Math.min(y, ED.yOf(n.t + n.d)) : y - NOTE_H / 2) - 2.5,
          w + 5, (n.d > 0 ? Math.abs(y - ED.yOf(n.t + n.d)) : NOTE_H) + 5);
      }
      ctx.restore();
    });

    /* 框选 */
    if (ED.drag && ED.drag.mode === 'box' && ED.drag.moved) {
      var bx = Math.min(ED.drag.x0, ED.drag.x1), by = Math.min(ED.drag.y0, ED.drag.y1);
      ctx.fillStyle = 'rgba(56,232,255,0.12)';
      ctx.strokeStyle = 'rgba(56,232,255,0.7)';
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, Math.abs(ED.drag.x1 - ED.drag.x0), Math.abs(ED.drag.y1 - ED.drag.y0));
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.abs(ED.drag.x1 - ED.drag.x0), Math.abs(ED.drag.y1 - ED.drag.y0));
    }

    /* 光标位置提示线 */
    if (ED.cursor && ED.cursor.t >= 0) {
      var cy = ED.yOf(ED.snapTime(ED.cursor.t));
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(RULER_W, cy + 0.5); ctx.lineTo(ED.xOf(lanes), cy + 0.5); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* 播放头 */
    var py = ED.yOf(ED.time);
    ctx.save();
    ctx.strokeStyle = '#ff4fd8';
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, py + 0.5); ctx.lineTo(ED.xOf(lanes), py + 0.5); ctx.stroke();
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.moveTo(RULER_W - 10, py - 6); ctx.lineTo(RULER_W, py); ctx.lineTo(RULER_W - 10, py + 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    /* 状态栏 */
    var st = RG.Chart.stats(chart);
    var selInfo = ED.selection.length ? (' · 选中 ' + ED.selection.length +
      (ED.selection[0].type === 'hold' || ED.selection[0].type === 'slide' ? '（' + ED.selection[0].type + ' d=' + (ED.selection[0].d || 0).toFixed(3) + 's）' : '')) : '';
    document.getElementById('ed-status').textContent =
      U.fmtTime(ED.time, true) + ' / ' + U.fmtTime(chart.meta.length, true) +
      ' · 小节 ' + (ED.time / beat / 4 + 1).toFixed(2) +
      ' · 音符 ' + chart.notes.length + '（可击打 ' + st.total + '）' +
      ' · 视角 ' + (chart.meta.view === '3d' ? '3D' : '2D') + ' 起始 / ' + st.switches + ' 次切换（3D ' + Math.round(st.view3d) + 's）' +
      selInfo + ' · 吸附 1/' + (ED.snap || '∞') + ' · 缩放 ' + Math.round(ED.pps) + 'px/s' +
      ' · ' + (ED.playing ? '播放中' : '已暂停');
    document.getElementById('ed-time').textContent = U.fmtTime(ED.time, true) + ' / ' + U.fmtTime(chart.meta.length, true);
    var insp = document.getElementById('ed-inspector');
    var sv = ED.selView();
    if (sv) {
      insp.innerHTML = '🎬 视角切换标记 · 切到 <b>' + (sv.mode === '3d' ? '3D 立体' : '2D 平面') + '</b><br>' +
        '时间 <b>' + sv.t.toFixed(3) + 's</b>（第 ' + (sv.t / beat / 4 + 1).toFixed(2) + ' 小节）· 过渡 <b>' + sv.dur + 's</b><br>' +
        '<span style="color:#5b6480">拖动改时间，右键或 Del 删除</span>';
    } else if (ED.selection.length === 1) {
      var n = ED.selection[0];
      insp.innerHTML = '类型 <b>' + RG.Chart.TYPES[n.type].label + '</b> · 轨道 <b>' + (n.lane + 1) + '</b><br>' +
        '时间 <b>' + n.t.toFixed(3) + 's</b>（第 ' + (n.t / beat / 4 + 1).toFixed(2) + ' 小节）' +
        (n.d ? '<br>时长 <b>' + n.d.toFixed(3) + 's</b>' + (n.type === 'slide' ? ' · 终点轨道 <b>' + (n.tail + 1) + '</b>' : '') : '');
    } else if (ED.selection.length > 1) {
      insp.innerHTML = '已选中 <b>' + ED.selection.length + '</b> 个音符';
    } else {
      insp.innerHTML = '未选中音符<br><span style="color:#5b6480">左键放置 / 拖动，右键删除，框选可多选</span>';
    }
  };

  RG.Editor.defaultMusicDef = defaultMusicDef;
  RG.Editor.SNAPS = SNAPS;
})(typeof window !== 'undefined' ? window : globalThis);

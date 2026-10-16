/* ==========================================================================
 * Resonance · frontend.js
 *   主页（TAP TO START 街机式待机画面）→ 模式选取 → 档案（统计/章节/成就/存档）
 *   RG.Achievements —— 成就判定
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;
  var UI = RG.UI;

  /* ======================================================================
   * 成就
   * ====================================================================== */
  var Achievements = RG.Achievements = {
    list: [
      { id: 'first-clear', name: '初次共振', desc: '通关任意一首乐曲', icon: '📶' },
      { id: 'fc', name: '全连', desc: '在一首乐曲中达成 FC', icon: '🔗' },
      { id: 'ap', name: '全完美', desc: '在一首乐曲中达成 AP', icon: '💠' },
      { id: 'stars10', name: '星光收集者', desc: '累计获得 10 颗星', icon: '⭐' },
      { id: 'stars60', name: '星光猎人', desc: '累计获得 60 颗星', icon: '🌟' },
      { id: 'composer', name: '创作者', desc: '保存一张自制谱面', icon: '🛠' },
      { id: 'all-songs', name: '全曲通关', desc: '内置曲目全部至少通关一次', icon: '🎼' },
      { id: 'no-mine', name: '排雷专家', desc: '一首乐曲中一颗 MINE 都不踩', icon: '🧯' }
    ],
    get: function (id) {
      for (var i = 0; i < Achievements.list.length; i++) if (Achievements.list[i].id === id) return Achievements.list[i];
      return null;
    },
    unlocked: function () { return RG.Store.save().achievements || {}; },
    unlock: function (id) {
      var save = RG.Store.save();
      if (!save.achievements) save.achievements = {};
      if (save.achievements[id]) return false;
      save.achievements[id] = Date.now();
      RG.Store.persist();
      var a = Achievements.get(id);
      if (a && UI) UI.toast('成就解锁 · ' + a.icon + ' ' + a.name, 'ok');
      return true;
    },
    /** 每次演奏结束后调用；返回本次新解锁的成就 */
    check: function (ctx) {
      ctx = ctx || {};
      var save = RG.Store.save();
      var out = [];
      function tryUnlock(id, cond) { if (cond && Achievements.unlock(id)) out.push(id); }
      var r = ctx.result;
      tryUnlock('first-clear', r && r.clear);
      tryUnlock('fc', r && r.fc);
      tryUnlock('ap', r && r.ap);
      tryUnlock('stars10', RG.Store.totalStars() >= 10);
      tryUnlock('stars60', RG.Store.totalStars() >= 60);
      tryUnlock('composer', (save.customCharts || []).length > 0);
      if (r) {
        tryUnlock('no-mine', !!(r.clear && r.mines > 0 && r.counts && r.counts.mineHit === 0));
        tryUnlock('all-songs', (function () {
          var all = RG.Songs.flat().filter(function (x) { return !x.song.custom; });
          if (!all.length) return false;
          for (var i = 0; i < all.length; i++) {
            var rec = RG.Store.record(all[i].song.id, all[i].diff);
            if (!rec || !rec.clear) return false;
          }
          return true;
        })());
      }
      return out;
    },
    progress: function () {
      var got = Achievements.unlocked();
      var n = 0;
      Achievements.list.forEach(function (a) { if (got[a.id]) n++; });
      return { got: n, total: Achievements.list.length };
    }
  };

  /* ======================================================================
   * 主页 / 模式选取 / 档案
   * ====================================================================== */
  var T = RG.Front = {
    t: 0,
    ripples: [],
    _built: false,
    selected: 0,
    expanded: 'free',       // 首页默认展开自由演奏
    modes: []
  };

  T.init = function (app) {
    T.app = app;
    T.attractCanvas = document.getElementById('title-bg');
    T.modesCanvas = document.getElementById('modes-bg');
    T.listEl = document.getElementById('mode-list');
    T.detailEl = document.getElementById('mode-detail');
    T.tapEl = document.getElementById('tap-hint');
    T.metaEl = document.getElementById('title-meta');
    T.buildModes();
    return T;
  };

  /* ---------------- 模式定义（手风琴：一次只展开一张） ---------------- */
  T.buildModes = function () {
    var save = RG.Store.save();
    var ach = Achievements.progress();
    var chapters = RG.Songs.chapters.filter(function (c) { return !c.workshop; });
    var totalCh = 0, clearedCh = 0;
    chapters.forEach(function (c) { var p = RG.Songs.chapterProgress(c); totalCh += p.total; clearedCh += p.cleared; });
    var s = RG.Store.settings();

    T.modes = [
      {
        id: 'free', icon: '🗺', name: '自由演奏', sub: 'FREE PLAY · 大地图',
        desc: '六片章节区域、18 首曲目、54 张内置谱面。想弹哪首就弹哪首，成绩与星级照常记录；' +
          '攒够星级就会解锁下一片区域。',
        badge: '★ ' + RG.Store.totalStars(),
        chips: ['谱面通关 ' + clearedCh + '/' + totalCh, '总星数 ' + RG.Store.totalStars(),
          save.lastSong ? '上次：' + (RG.Songs.byId(save.lastSong) ? RG.Songs.byId(save.lastSong).title : save.lastSong) : '还没演奏过'],
        strip: { kind: 'stars' },
        actions: [
          { label: '▶ 进入大地图', primary: true, run: function () { T.app.showMap(); } },
          { label: '随机一首', run: function () { T.playRandom(); } },
          save.lastSong ? { label: '继续上次曲目', run: function () { T.playLast(); } } : null
        ].filter(Boolean)
      },
      {
        id: 'workshop', icon: '🛠', name: '创作工坊', sub: 'WORKSHOP · 制谱',
        desc: '从零铺面，或让引擎跟着乐曲自动生成草稿再精修。可以摆放 2D/3D 视角切换环节，并一键试玩、导出分享。',
        badge: (save.customCharts || []).length + ' 张自制谱面',
        chips: ['支持 4/6/8 轨', '视角轨', '导出 / 导入 JSON'],
        strip: { kind: 'charts', charts: save.customCharts || [] },
        actions: [
          { label: '▶ 进入工坊', primary: true, run: function () { T.app.showWorkshop(); } },
          { label: '＋ 新建谱面', run: function () { RG.Editor.open(null); } },
          { label: '由乐曲生成草稿', run: function () { RG.Editor.generateDialog(); } }
        ]
      },
      {
        id: 'profile', icon: '🗂', name: '档案', sub: 'ARCHIVE · 统计 / 成就',
        desc: '成绩统计、各章节进度、成就列表，以及存档的导出与清除。',
        badge: '成就 ' + ach.got + '/' + ach.total,
        chips: ['成绩 ' + Object.keys(save.progress || {}).length + ' 条', '成就 ' + ach.got + '/' + ach.total,
          '游玩 ' + save.stats.plays + ' 次'],
        strip: { kind: 'ach', list: Achievements.list, got: Achievements.unlocked() },
        actions: [
          { label: '▶ 打开档案', primary: true, run: function () { T.showProfile(); } },
          { label: '成就', run: function () { T.showProfile('ach'); } }
        ]
      },
      {
        id: 'settings', icon: '⚙', name: '设置', sub: 'SETTINGS · 带实时预览',
        desc: '判定、偏移、下落速度、皮肤、特效、键位与存档管理（玩法说明也在里面），改动都有实时预览。',
        badge: (s.scrollSpeed || 6).toFixed(1) + ' 速',
        chips: ['判定 ' + ({ lenient: '宽松', normal: '标准', strict: '困难' }[s.judgeDifficulty] || '标准'),
          '皮肤 ' + ({ neon: '霓虹', minimal: '极简', solid: '实心' }[s.skin] || s.skin),
          '偏移 ' + (s.offsetMs >= 0 ? '+' : '') + s.offsetMs + 'ms'],
        strip: { kind: 'preview' },
        actions: [
          { label: '▶ 打开设置', primary: true, run: function () { T.app.showSettings('modes'); } },
          { label: '玩法说明', run: function () { UI.showHelp(); } }
        ]
      }
    ];
    T.renderModes();
    T.renderAttractMeta();
  };

  T.renderAttractMeta = function () {
    var fresh = RG.Store.isFresh() && !RG.Tutorial.done();
    var hint = T.tapEl;
    if (hint) {
      hint.innerHTML = fresh
        ? '<b>TAP TO START</b><span>检测到全新存档 · 先来两分钟新手教程</span>'
        : '<b>TAP TO START</b><span>点击 / 空格 / Enter 开始</span>';
    }
    if (T.metaEl) {
      var save = RG.Store.save();
      var ach = Achievements.progress();
      var best = 0;
      RG.Songs.flat().forEach(function (x) {
        var r = RG.Store.record(x.song.id, x.diff);
        if (r && (r.score || 0) > best) best = r.score;
      });
      T.metaEl.innerHTML = fresh
        ? '<div><b>NEW</b>全新存档</div><div><b>2 分钟</b>新手教程</div><div><b>6</b>大章节</div><div><b>18</b>首曲目</div>'
        : '<div><b>★ ' + RG.Store.totalStars() + '</b>总星数</div>' +
        '<div><b>' + RG.Store.clearedCount() + '</b>通关谱面</div>' +
        '<div><b>' + U.fmtScore(best) + '</b>最高分</div>' +
        '<div><b>' + save.stats.plays + '</b>游玩次数</div>' +
        '<div><b>' + ach.got + '/' + ach.total + '</b>成就</div>';
    }
  };

  /** 随机抽一首已解锁的曲目开打 */
  T.playRandom = function () {
    var pool = [];
    RG.Songs.chapters.forEach(function (c) {
      if (c.workshop) return;
      if (!RG.Songs.isChapterUnlocked(c)) return;
      c.songs.forEach(function (song) { if (RG.Songs.isSongUnlocked(song)) pool.push(song); });
    });
    if (!pool.length) { UI.toast('还没有解锁任何曲目', 'err'); return; }
    var song = U.rng(Date.now() % 100000).pick(pool);
    var diff = Math.min(1, song.diffs.length - 1);
    T.app.currentSong = song;
    T.app.currentChapter = RG.Songs.chapterOf(song);
    T.app.currentDiff = diff;
    T.app.showMap();
    T.app.pickSong(song, T.app.currentChapter);
    T.app.startGame({ song: song, diffIndex: diff, returnTo: 'map' });
  };
  T.playLast = function () {
    var save = RG.Store.save();
    var song = save.lastSong ? RG.Songs.byId(save.lastSong) : null;
    if (!song) { UI.toast('没有上次的曲目记录', 'err'); return; }
    var diff = U.clamp(save.lastDiff || 0, 0, song.diffs.length - 1);
    T.app.currentSong = song;
    T.app.currentChapter = RG.Songs.chapterOf(song);
    T.app.currentDiff = diff;
    T.app.showMap();
    T.app.pickSong(song, T.app.currentChapter);
    T.app.startGame({ song: song, diffIndex: diff, returnTo: 'map' });
  };

  /* ---------------- 手风琴渲染 ---------------- */
  T.renderModes = function () {
    if (!T.listEl) return;
    U.clear(T.listEl);
    T.modes.forEach(function (m, i) {
      var open = T.expanded === m.id;
      var panel = U.el('div', {
        class: 'acc-panel' + (open ? ' open' : '') + (m.primary ? ' primary' : '') + (m.danger ? ' danger' : ''),
        'data-mode': m.id
      });
      /* 头部：点击展开自己、收起其他 */
      var head = U.el('button', {
        class: 'acc-head', 'aria-expanded': open ? 'true' : 'false',
        onclick: function () { T.expand(m.id, true); }
      }, [
        U.el('span', { class: 'acc-icon', text: m.icon }),
        U.el('span', { class: 'acc-title' }, [
          U.el('b', { text: m.name }),
          U.el('i', { text: m.sub })
        ]),
        U.el('span', { class: 'acc-badge', text: m.badge || '' }),
        U.el('span', { class: 'acc-caret', text: open ? '▾' : '▸' })
      ]);
      panel.appendChild(head);

      /* 展开体 */
      var body = U.el('div', { class: 'acc-body' });
      var inner = U.el('div', { class: 'acc-inner' });
      body.appendChild(inner);
      panel.appendChild(body);

      if (open) {
        inner.appendChild(U.el('p', { class: 'acc-desc', text: m.desc }));
        if (m.chips && m.chips.length) {
          var chips = U.el('div', { class: 'acc-chips' });
          m.chips.forEach(function (c) { chips.appendChild(U.el('span', { class: 'acc-chip', text: c })); });
          inner.appendChild(chips);
        }
        var strip = T.renderStrip(m.strip);
        if (strip) inner.appendChild(strip);
        var acts = U.el('div', { class: 'acc-actions' });
        (m.actions || []).forEach(function (a) {
          acts.appendChild(U.el('button', {
            class: 'gbtn ' + (a.primary ? 'accent ' : '') + (a.danger ? 'danger ' : '') + 'big',
            text: a.label,
            onclick: function (ev) {
              if (ev && ev.stopPropagation) ev.stopPropagation();
              RG.audio.ui('confirm');
              a.run();
            }
          }));
        });
        inner.appendChild(acts);
        /* 展开时把这张卡滚进视野 */
        setTimeout(function () {
          if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 30);
      }
      T.listEl.appendChild(panel);
    });
    if (T.detailEl) T.detailEl.classList.add('hidden');
    T.renderKeys();
  };

  /** 展开某张卡（收起其余） */
  T.expand = function (id, byUser) {
    if (T.expanded === id && byUser) {
      /* 再点一次＝收起（但总得留一张展开，所以收起后回到第一张） */
      T.expanded = (id === 'free') ? null : 'free';
    } else {
      T.expanded = id;
      T.selected = Math.max(0, T.modes.findIndex(function (m) { return m.id === id; }));
    }
    if (byUser) RG.audio.ui('confirm');
    T.renderModes();
  };

  T.renderKeys = function () {
    if (!T.listEl) return;
    var foot = document.getElementById('mode-keys');
    if (!foot) {
      foot = U.el('div', { class: 'acc-keys', id: 'mode-keys' });
      T.listEl.parentNode.appendChild(foot);
    }
    foot.innerHTML = '<kbd>↑</kbd><kbd>↓</kbd> 切换卡片 · <kbd>Enter</kbd> 进入展开的卡片 · ' +
      '<kbd>←</kbd><kbd>→</kbd> 展开/收起 · <kbd>Esc</kbd> 返回标题';
  };

  /** 展开卡片里的小可视化（章节进度 / 星 / 谱面列表 / 成就 / 全局音符图例） */
  T.renderStrip = function (strip) {
    if (!strip) return null;
    if (strip.kind === 'preview') {
      var host = U.el('div', { class: 'acc-preview', id: 'acc-preview' });
      /* 用真正的渲染器做一张会动的小预览（同步挂载，父节点随后接入 DOM 也没关系） */
      if (RG.Preview) RG.Preview.mount(host);
      return host;
    }
    if (strip.kind === 'stars') {
      var st = RG.Store.totalStars();
      var row2 = U.el('div', { class: 'acc-strip' });
      for (var i = 0; i < Math.min(30, Math.max(6, st + 4)); i++) {
        row2.appendChild(U.el('span', { class: 'acc-star' + (i < st ? ' on' : ''), text: '★' }));
      }
      return row2;
    }
    if (strip.kind === 'charts') {
      var row3 = U.el('div', { class: 'acc-strip charts' });
      if (!strip.charts.length) row3.appendChild(U.el('span', { class: 'acc-chip', text: '还没有自制谱面' }));
      strip.charts.slice(0, 5).forEach(function (c) {
        row3.appendChild(U.el('span', { class: 'acc-chip', text: c.meta.title }));
      });
      return row3;
    }
    if (strip.kind === 'ach') {
      var row4 = U.el('div', { class: 'acc-strip' });
      strip.list.slice(0, 9).forEach(function (a) {
        row4.appendChild(U.el('span', {
          class: 'acc-ach' + (strip.got[a.id] ? ' on' : ''), title: a.name + ' · ' + a.desc,
          text: strip.got[a.id] ? a.icon : '🔒'
        }));
      });
      return row4;
    }
    if (strip.kind === 'notes') {
      var row5 = U.el('div', { class: 'acc-strip' });
      RG.Chart.ORDER.forEach(function (k) {
        var ty = RG.Chart.TYPES[k];
        row5.appendChild(U.el('span', {
          class: 'acc-note-chip', style: 'border-color:' + ty.color + ';color:' + ty.color,
          text: ty.label + '（' + ty.key + '）'
        }));
      });
      return row5;
    }
    return null;
  };

  T.renderDetail = function () { /* 详情已并入展开体 */ };

  T.moveSelection = function (dir) {
    var n = T.modes.length;
    var cur = T.modes.findIndex(function (m) { return m.id === T.expanded; });
    if (cur < 0) cur = 0;
    cur = (cur + dir + n) % n;
    T.expand(T.modes[cur].id, false);
    RG.audio.ui('hover');
  };
  /** ←/→ 在「展开 ↔ 收起」之间切换 */
  T.moveOpen = function (dir) {
    if (dir > 0) {
      var i = Math.max(0, T.modes.findIndex(function (m) { return m.id === T.expanded; }));
      T.expand(T.modes[(i + 1) % T.modes.length].id, false);
    } else {
      T.expand('free', false);
    }
    RG.audio.ui('hover');
  };
  /** Enter：执行展开卡片的主按钮 */
  T.enterSelected = function () {
    var m = T.modes.filter(function (x) { return x.id === T.expanded; })[0] || T.modes[0];
    var primary = (m.actions || []).filter(function (a) { return a.primary; })[0] || (m.actions || [])[0];
    if (!primary) return;
    RG.audio.ui('confirm');
    primary.run();
  };

  /* ---------------- 画面切换 ---------------- */
  T.showAttract = function () {
    T.built = true;
    if (RG.Preview) RG.Preview.unmount();
    T.renderAttractMeta();
    UI.show('screen-title');
    UI.overlaysOff();
  };
  T.showModes = function (expandId) {
    if (RG.Preview) RG.Preview.unmount();
    if (!T.expanded) T.expanded = 'free';         // 默认展开自由演奏
    if (expandId) T.expanded = expandId;
    T.buildModes();
    UI.show('screen-modes');
    UI.overlaysOff();
  };
  T.tap = function () {
    /* 涟漪后进入：全新存档先去新手教程 */
    var s = T.attractCanvas ? U.canvasSize(T.attractCanvas, 2) : { w: 800, h: 600 };
    T.ripples.push({ x: s.w / 2, y: s.h * 0.52, r: 0, life: 1 });
    RG.audio.ui('confirm');
    if (RG.Store.isFresh() && !RG.Tutorial.done()) {
      RG.Tutorial.open();
      return;
    }
    T.showModes();
  };

  /* ---------------- 待机画面绘制 ---------------- */
  T.tick = function (dt, nowMs, bands) {
    T.t += dt;
    var cv = T.attractCanvas;
    if (cv && UI.current === 'screen-title') {
      T.drawAttract(cv, dt, bands, 1);
    } else if (T.modesCanvas && UI.current === 'screen-modes') {
      T.drawAttract(T.modesCanvas, dt, bands, 0.55);
    }
  };

  T.drawAttract = function (cv, dt, bands, intensity) {
    var s = U.canvasSize(cv, 2), ctx = s.ctx, w = s.w, h = s.h;
    var t = T.t;
    ctx.clearRect(0, 0, w, h);
    /* 底色 */
    var g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, '#060912');
    g.addColorStop(0.55, '#080c18');
    g.addColorStop(1, '#04050c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* 远处城市：由频谱柱构成 */
    var n = Math.max(28, Math.floor(w / 26));
    var bw = w / n;
    var baseY = h * 0.86;
    for (var i = 0; i < n; i++) {
      var seed = U.hashStr('b' + i) / 4294967296;
      var band = bands && bands.length ? (bands[Math.floor((i / n) * bands.length)] || 0) : 0;
      var idle = 0.30 + 0.24 * Math.sin(t * (0.5 + seed) + i * 0.7);
      var level = U.clamp(Math.max(idle, band * 1.25), 0.05, 1.1);
      /* 静默现象：个别楼随机熄灭再亮起 */
      var sil = Math.sin(t * 0.33 + seed * 40);
      if (sil > 0.985) level *= U.clamp((1 - (sil - 0.985) / 0.015), 0, 1) * 0.35 + 0.05;
      var bh = level * h * 0.42 * (0.5 + seed * 0.7);
      var col = i % 5 === 0 ? '#ff4fd8' : (i % 3 === 0 ? '#8b7bff' : '#38e8ff');
      var bg = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
      bg.addColorStop(0, U.rgba(col, 0.55 * intensity));
      bg.addColorStop(1, U.rgba(col, 0.05 * intensity));
      ctx.fillStyle = bg;
      ctx.fillRect(i * bw + 1.5, baseY - bh, bw - 3, bh);
      /* 窗格微光 */
      ctx.fillStyle = U.rgba('#ffffff', 0.05 * intensity);
      for (var k = 0; k < 3; k++) {
        var wy = baseY - bh + 6 + k * 12;
        if (wy < baseY - 4) ctx.fillRect(i * bw + 4, wy, bw - 8, 2);
      }
    }
    /* 心跳声波线 */
    var midY = h * 0.52;
    var beat = (t % 0.8) / 0.8;
    var pulse = Math.exp(-Math.pow((beat - 0.05) / 0.10, 2));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = U.rgba('#8ef7ff', (0.35 + pulse * 0.6) * intensity);
    ctx.lineWidth = 1.6 + pulse * 1.6;
    ctx.beginPath();
    for (var x = 0; x <= w; x += 4) {
      var d = Math.abs(x - w * 0.5) / (w * 0.5);
      var y = midY + Math.sin(x * 0.014 + t * 1.6) * 6 * (1 - d * 0.4);
      /* 行进中的脉冲鼓包 */
      var px = ((t * 0.28) % 1.4 - 0.2) * w;
      y += Math.exp(-Math.pow((x - px) / 60, 2)) * 34 * Math.sin(t * 12);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    /* 涟漪 */
    for (var r = T.ripples.length - 1; r >= 0; r--) {
      var rp = T.ripples[r];
      rp.r += dt * 900;
      rp.life -= dt * 1.1;
      if (rp.life <= 0) { T.ripples.splice(r, 1); continue; }
      ctx.strokeStyle = U.rgba('#38e8ff', rp.life * 0.7);
      ctx.lineWidth = 2 * rp.life + 0.5;
      ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    /* 尘埃 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var p = 0; p < 70; p++) {
      var sd = U.hashStr('p' + p) / 4294967296;
      var px2 = ((sd * w + t * (8 + sd * 22)) % (w + 40)) - 20;
      var py2 = (h - ((t * (14 + sd * 30) + sd * h) % (h + 60)));
      ctx.fillStyle = U.rgba(p % 3 ? '#38e8ff' : '#ff4fd8', 0.06 + sd * 0.14 * intensity);
      ctx.beginPath(); ctx.arc(px2, py2, 0.6 + sd * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    /* 中央光晕 */
    var hg = ctx.createRadialGradient(w * 0.5, midY, 0, w * 0.5, midY, h * 0.6);
    hg.addColorStop(0, U.rgba('#38e8ff', 0.10 * intensity + pulse * 0.06));
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
  };

  /* ---------------- 档案 ---------------- */
  T.showProfile = function (tab) {
    T.profileTab = tab || T.profileTab || 'overview';
    T.renderProfile();
    UI.show('screen-profile');
    UI.overlaysOff();
  };

  T.renderProfile = function () {
    var host = document.getElementById('profile-body');
    var tabsHost = document.getElementById('profile-tabs');
    if (!host || !tabsHost) return;
    U.clear(tabsHost);
    [['overview', '总览'], ['chapters', '章节进度'], ['ach', '成就'], ['data', '存档']].forEach(function (tb) {
      tabsHost.appendChild(U.el('div', {
        class: 'tab' + (T.profileTab === tb[0] ? ' on' : ''),
        text: tb[1], onclick: function () { T.showProfile(tb[0]); }
      }));
    });
    U.clear(host);
    var save = RG.Store.save();
    if (T.profileTab === 'overview') {
      var st = save.stats;
      var card = U.el('div', { class: 'set-card' });
      card.appendChild(U.el('h3', { text: '演奏统计' }));
      [['总游玩次数', st.plays], ['通关谱面', RG.Store.clearedCount()], ['总星数', RG.Store.totalStars()],
      ['演奏音符数', U.fmtScore(st.notes)], ['全连次数', st.fullCombo], ['全完美次数', st.allPerfect],
      ['累计演奏时长', U.fmtTime(st.playTime)], ['自制谱面', (save.customCharts || []).length]].forEach(function (r) {
        var line = U.el('div', { class: 'set-row' });
        line.appendChild(U.el('div', { class: 'set-label', text: r[0] }));
        line.appendChild(U.el('div', { class: 'seg' }));
        line.appendChild(U.el('div', { class: 'set-val', text: String(r[1]) }));
        card.appendChild(line);
      });
      host.appendChild(card);
      var card2 = U.el('div', { class: 'set-card' });
      card2.appendChild(U.el('h3', { text: '进度' }));
      host.appendChild(card2);
      var pg = U.el('div', { class: 'prof-bars' });
      var ach = Achievements.progress();
      pg.appendChild(T._bar('成就', ach.got, ach.total, '#ffd35c'));
      var totalCh = 0, clearedCh = 0;
      RG.Songs.chapters.forEach(function (c) { if (c.workshop) return; var p = RG.Songs.chapterProgress(c); totalCh += p.total; clearedCh += p.cleared; });
      pg.appendChild(T._bar('谱面通关', clearedCh, totalCh, '#5cff9d'));
      card2.appendChild(pg);
    } else if (T.profileTab === 'chapters') {
      /* 大地图的六片区域进度（原先的剧情章节页替换为曲包进度） */
      var card3 = U.el('div', { class: 'set-card' });
      card3.appendChild(U.el('h3', { text: '章节区域' }));
      RG.Songs.chapters.forEach(function (c) {
        if (c.workshop) return;
        var p = RG.Songs.chapterProgress(c);
        var unlocked = RG.Songs.isChapterUnlocked(c);
        var done = p.total > 0 && p.cleared >= p.total;
        var row = U.el('div', { class: 'chapter-row' + (done ? ' done' : '') + (unlocked ? '' : ' locked') }, [
          U.el('div', { class: 'cr-name', html: (done ? '✔ ' : (unlocked ? '▶ ' : '🔒 ')) + c.name }),
          U.el('div', {
            class: 'cr-sub',
            text: c.sub + ' · 通关 ' + p.cleared + '/' + p.total + ' · ★' + p.stars + '/' + p.maxStars +
              (unlocked ? '' : ' · ' + RG.Songs.unlockHint(c))
          })
        ]);
        card3.appendChild(row);
      });
      host.appendChild(card3);
    } else if (T.profileTab === 'data') {
      var dcard = U.el('div', { class: 'set-card' });
      dcard.appendChild(U.el('h3', { text: '存档' }));
      dcard.appendChild(U.el('div', {
        class: 'md-body',
        html: '存档保存在浏览器本地（localStorage）。可以导出成 JSON 备份，或导入别人的存档；<br>' +
          '也可以在「设置 → 数据」里重置进度或清除全部存档。'
      }));
      var dbtns = U.el('div', { class: 'sp-actions' });
      dbtns.appendChild(U.el('button', { class: 'gbtn accent', text: '导出存档', 'data-action': 'export-save' }));
      dbtns.appendChild(U.el('button', { class: 'gbtn', text: '导入存档', 'data-action': 'import-save' }));
      dcard.appendChild(dbtns);
      host.appendChild(dcard);
    } else {
      var got2 = Achievements.unlocked();
      var acard = U.el('div', { class: 'set-card' });
      acard.appendChild(U.el('h3', { text: '成就（' + Achievements.progress().got + '/' + Achievements.list.length + '）' }));
      var list = U.el('div', { class: 'ach-list' });
      Achievements.list.forEach(function (a) {
        var on = !!got2[a.id];
        list.appendChild(U.el('div', { class: 'ach-row' + (on ? ' on' : '') }, [
          U.el('span', { class: 'ach-icon', text: on ? a.icon : '🔒' }),
          U.el('span', { class: 'ach-body' }, [
            U.el('b', { text: a.name }),
            U.el('i', { text: a.desc })
          ])
        ]));
      });
      acard.appendChild(list);
      host.appendChild(acard);
    }
  };

  T._bar = function (label, val, total, color) {
    var pct = total ? Math.round(val / total * 100) : 0;
    return U.el('div', { class: 'prof-bar' }, [
      U.el('div', { class: 'pb-label' }, [U.el('span', { text: label }), U.el('b', { text: val + '/' + total })]),
      U.el('div', { class: 'pb-track' }, [U.el('i', { style: 'width:' + pct + '%;background:' + color })])
    ]);
  };

})(typeof window !== 'undefined' ? window : globalThis);

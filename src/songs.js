/* ==========================================================================
 * Resonance Engine · songs.js
 * 曲库：章节、曲目、难度（决定自动铺面强度）、大地图节点布局与解锁规则
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  function plan(list) {
    return list.map(function (s) { return { name: s[0], intensity: s[1], bars: s[2] }; });
  }
  var PLANS = {
    short: plan([['intro', 0, 8], ['verse', 1, 12], ['chorus', 2, 12], ['bridge', 1, 4], ['chorus', 3, 8], ['outro', 0, 4]]),
    mid: plan([['intro', 0, 8], ['verse', 1, 16], ['chorus', 2, 16], ['bridge', 1, 8], ['chorus', 3, 12], ['outro', 0, 4]]),
    long: plan([['intro', 0, 8], ['verse', 1, 16], ['chorus', 2, 16], ['bridge', 1, 8], ['chorus', 3, 16], ['outro', 0, 8]]),
    boss: plan([['intro', 0, 8], ['verse', 1, 16], ['chorus', 2, 16], ['bridge', 1, 8], ['chorus', 3, 24], ['finale', 3, 8], ['outro', 0, 8]])
  };

  /* ---------------- 章节 ---------------- */
  var CHAPTERS = [
    {
      id: 'origin', name: '霓虹起点', sub: 'NEON ORIGIN', color: '#38e8ff', accent: '#8b7bff',
      x: 430, y: 1030, r: 205, layout: 'path', unlock: { stars: 0 },
      desc: '合成器浪潮的入口。四轨基础操作，认识 TAP、HOLD 与 SLIDE。'
    },
    {
      id: 'pixel', name: '像素回廊', sub: 'PIXEL CORRIDOR', color: '#5cff9d', accent: '#ffd35c',
      x: 880, y: 570, r: 215, layout: 'zigzag', unlock: { stars: 3 },
      desc: '8bit 芯片音色的走廊，节奏更快，FLICK 首次登场。'
    },
    {
      id: 'abyss', name: '深海脉冲', sub: 'ABYSS PULSE', color: '#4f9dff', accent: '#38e8ff',
      x: 1345, y: 1115, r: 225, layout: 'arc', unlock: { stars: 9 },
      desc: '碎拍与低频压迫感。轨道变为六轨，MINE 开始出现在暗处。'
    },
    {
      id: 'core', name: '熔核矩阵', sub: 'CORE MATRIX', color: '#ff7a3c', accent: '#ff4fd8',
      x: 1815, y: 600, r: 240, layout: 'spiral', unlock: { stars: 16 },
      desc: '硬核高速区。密集连打、双押与 SLIDE 复合，考验体力与读谱。'
    },
    {
      id: 'zenith', name: '终焉回声', sub: 'ZENITH ECHOES', color: '#c86bff', accent: '#ff4fd8',
      x: 2225, y: 1140, r: 175, layout: 'cluster', unlock: { stars: 26 }, secret: true,
      desc: '隐藏章节。全曲最高难度，只有真正的共振者才能抵达。'
    },
    {
      id: 'workshop', name: '创作工坊', sub: 'WORKSHOP', color: '#ffd35c', accent: '#5cff9d',
      x: 300, y: 400, r: 150, layout: 'cluster', unlock: { stars: 0 }, workshop: true,
      desc: '你自己的谱面都在这里。进入编辑器，或游玩已保存的作品。'
    }
  ];

  /* ---------------- 曲目 ---------------- */
  function song(o) {
    o.diffs = o.diffs.map(function (d, i) {
      return {
        name: d[0], level: d[1], lanes: d[2] || o.lanes || 4,
        seed: d[3] === undefined ? (U.hashStr(o.id) + i * 977) : d[3],
        bpm: o.music.bpm
      };
    });
    return o;
  }

  var SONGS = [
    /* ===== 第一章 · 霓虹起点 ===== */
    song({
      id: 'first-light', title: '初光', artist: 'Resonance', chapter: 'origin', lanes: 4,
      desc: '引擎的第一束光。节奏规整，用来熟悉判定与手感。',
      theme: { a: '#38e8ff', b: '#8b7bff' },
      music: { style: 'synthwave', seed: 1001, bpm: 112, rootMidi: 45, scale: 'minor', sections: PLANS.short },
      diffs: [['简单', 2, 4], ['标准', 4, 4], ['困难', 6, 4]]
    }),
    song({
      id: 'neon-drive', title: '霓虹疾驰', artist: 'Resonance', chapter: 'origin', lanes: 4,
      desc: '夜路巡航。主旋律的琶音会连成轨道间流动的 SLIDE。',
      theme: { a: '#38e8ff', b: '#ff4fd8' },
      music: { style: 'synthwave', seed: 1002, bpm: 124, rootMidi: 43, scale: 'minor', sections: PLANS.mid },
      diffs: [['简单', 3, 4], ['标准', 6, 4], ['困难', 8, 4]]
    }),
    song({
      id: 'midnight-grid', title: '午夜网格', artist: 'Resonance', chapter: 'origin', lanes: 4,
      desc: '低频脉冲如同城市电网。HOLD 变多，注意尾部判定。',
      theme: { a: '#6b8bff', b: '#38e8ff' },
      music: { style: 'pop', seed: 1003, bpm: 118, rootMidi: 44, scale: 'minor', sections: PLANS.mid },
      diffs: [['简单', 4, 4], ['标准', 7, 4], ['困难', 9, 4]]
    }),
    song({
      id: 'circuit-bloom', title: '电路花开', artist: 'Resonance', chapter: 'origin', lanes: 4, boss: true,
      desc: '第一章首领曲。副歌会突然加密，学会在密集段保留体力。',
      theme: { a: '#ff4fd8', b: '#38e8ff' },
      music: { style: 'synthwave', seed: 1004, bpm: 132, rootMidi: 45, scale: 'minor', sections: PLANS.boss },
      diffs: [['简单', 5, 4], ['标准', 8, 4], ['困难', 10, 4]]
    }),

    /* ===== 第二章 · 像素回廊 ===== */
    song({
      id: 'bit-garden', title: '位元花园', artist: 'Resonance', chapter: 'pixel', lanes: 4,
      desc: '大调芯片旋律，明快但小节末常有十六分过门。',
      theme: { a: '#5cff9d', b: '#ffd35c' },
      music: { style: 'chiptune', seed: 2001, bpm: 140, rootMidi: 48, scale: 'major', sections: PLANS.short },
      diffs: [['简单', 4, 4], ['标准', 7, 4], ['困难', 9, 4]]
    }),
    song({
      id: 'cartridge-rain', title: '卡带之雨', artist: 'Resonance', chapter: 'pixel', lanes: 4,
      desc: 'FLICK 首次大量出现：上方带尖顶的音符，按下后要滑动（键盘则同时按两个键）。',
      theme: { a: '#5cff9d', b: '#38e8ff' },
      music: { style: 'chiptune', seed: 2002, bpm: 148, rootMidi: 46, scale: 'minor', sections: PLANS.mid },
      diffs: [['简单', 5, 4], ['标准', 8, 4], ['困难', 10, 4]]
    }),
    song({
      id: 'sprite-rush', title: '精灵冲刺', artist: 'Resonance', chapter: 'pixel', lanes: 4,
      desc: '高速八分连打。轨道会在相邻两轨之间来回游走。',
      theme: { a: '#ffd35c', b: '#5cff9d' },
      music: { style: 'chiptune', seed: 2003, bpm: 156, rootMidi: 50, scale: 'major', sections: PLANS.mid },
      diffs: [['简单', 6, 4], ['标准', 9, 4], ['困难', 11, 4]]
    }),
    song({
      id: 'requiem-8bit', title: '八位镇魂曲', artist: 'Resonance', chapter: 'pixel', lanes: 4, boss: true,
      desc: '和声小调的悲鸣。难点在长条之后的立刻转向。',
      theme: { a: '#8b7bff', b: '#5cff9d' },
      music: { style: 'chiptune', seed: 2004, bpm: 164, rootMidi: 45, scale: 'harmonic', sections: PLANS.boss },
      diffs: [['简单', 7, 4], ['标准', 10, 4], ['困难', 12, 4]]
    }),

    /* ===== 第三章 · 深海脉冲 ===== */
    song({
      id: 'bathyal', title: '深渊带', artist: 'Resonance', chapter: 'abyss', lanes: 6,
      desc: '缓速氛围曲，六轨。音符稀疏但判定窗口显得格外漫长。',
      theme: { a: '#4f9dff', b: '#38e8ff' },
      music: { style: 'ambient', seed: 3001, bpm: 88, rootMidi: 41, scale: 'minor', sections: PLANS.mid },
      diffs: [['标准', 6, 6], ['困难', 9, 6], ['专家', 11, 6]]
    }),
    song({
      id: 'sonar-bloom', title: '声呐之花', artist: 'Resonance', chapter: 'abyss', lanes: 4,
      desc: '碎拍鼓组，节拍重心不断偏移，读谱要靠听底鼓。',
      theme: { a: '#38e8ff', b: '#4f9dff' },
      music: { style: 'dnb', seed: 3002, bpm: 172, rootMidi: 43, scale: 'minor', sections: PLANS.mid },
      diffs: [['标准', 7, 4], ['困难', 10, 4], ['专家', 12, 4]]
    }),
    song({
      id: 'pressure', title: '压强', artist: 'Resonance', chapter: 'abyss', lanes: 6,
      desc: '持续六轨推进。MINE 藏在低强度段，手抖就会踩上。',
      theme: { a: '#2f6bff', b: '#38e8ff' },
      music: { style: 'dnb', seed: 3003, bpm: 174, rootMidi: 40, scale: 'minor', sections: PLANS.long },
      diffs: [['标准', 8, 6], ['困难', 11, 6], ['专家', 13, 6]]
    }),
    song({
      id: 'leviathan', title: '利维坦', artist: 'Resonance', chapter: 'abyss', lanes: 6, boss: true,
      desc: '第三章首领曲。副歌密集连打与 SLIDE 交替，呼吸节奏很重要。',
      theme: { a: '#00d0c0', b: '#4f9dff' },
      music: { style: 'dnb', seed: 3004, bpm: 176, rootMidi: 38, scale: 'harmonic', sections: PLANS.boss },
      diffs: [['标准', 9, 6], ['困难', 12, 6], ['专家', 14, 6]]
    }),

    /* ===== 第四章 · 熔核矩阵 ===== */
    song({
      id: 'ion-thrust', title: '离子推进', artist: 'Resonance', chapter: 'core', lanes: 4,
      desc: '高速四轨，落点密集。适合练习短时爆发。',
      theme: { a: '#ff7a3c', b: '#ffd35c' },
      music: { style: 'hardcore', seed: 4001, bpm: 186, rootMidi: 45, scale: 'minor', sections: PLANS.mid },
      diffs: [['标准', 8, 4], ['困难', 11, 4], ['专家', 13, 4]]
    }),
    song({
      id: 'overclock', title: '超频', artist: 'Resonance', chapter: 'core', lanes: 6,
      desc: '十六分贝斯线带来连续音墙，六轨必须双手交替。',
      theme: { a: '#ff4fd8', b: '#ff7a3c' },
      music: { style: 'hardcore', seed: 4002, bpm: 194, rootMidi: 43, scale: 'minor', sections: PLANS.mid },
      diffs: [['标准', 9, 6], ['困难', 12, 6], ['专家', 14, 6]]
    }),
    song({
      id: 'meltdown', title: '熔毁', artist: 'Resonance', chapter: 'core', lanes: 6,
      desc: '中段会有长达八小节的连打墙，注意 MINE 间隔。',
      theme: { a: '#ff5c3c', b: '#ffd35c' },
      music: { style: 'hardcore', seed: 4003, bpm: 200, rootMidi: 41, scale: 'minor', sections: PLANS.long },
      diffs: [['标准', 10, 6], ['困难', 13, 6], ['专家', 15, 6]]
    }),
    song({
      id: 'singularity', title: '奇点', artist: 'Resonance', chapter: 'core', lanes: 6, boss: true,
      desc: '第四章首领曲。210BPM 的极限密度，全程无喘息。',
      theme: { a: '#ff2f6d', b: '#ff7a3c' },
      music: { style: 'hardcore', seed: 4004, bpm: 210, rootMidi: 40, scale: 'minor', sections: PLANS.boss },
      diffs: [['标准', 11, 6], ['困难', 14, 6], ['专家', 16, 6]]
    }),

    /* ===== 第五章 · 终焉回声（隐藏） ===== */
    song({
      id: 'zenith-echoes', title: '天顶回声', artist: 'Resonance', chapter: 'zenith', lanes: 6,
      desc: '大调史诗感。旋律声部与打击声部会分成两组轨道。',
      theme: { a: '#c86bff', b: '#38e8ff' },
      music: { style: 'synthwave', seed: 5001, bpm: 128, rootMidi: 48, scale: 'major', sections: PLANS.long },
      diffs: [['标准', 12, 6], ['困难', 15, 6], ['专家', 17, 6]]
    }),
    song({
      id: 'resonance-inf', title: '共振 ∞', artist: 'Resonance', chapter: 'zenith', lanes: 8, boss: true,
      desc: '引擎的最终考验：八轨、205BPM、全音符类型混合。',
      theme: { a: '#ff4fd8', b: '#ffd35c' },
      music: { style: 'hardcore', seed: 5002, bpm: 205, rootMidi: 43, scale: 'harmonic', sections: PLANS.boss },
      diffs: [['困难', 15, 8], ['专家', 17, 8], ['极限', 19, 8]]
    })
  ];

  var byId = {}, chapterById = {};
  SONGS.forEach(function (s) { byId[s.id] = s; });
  CHAPTERS.forEach(function (c) { chapterById[c.id] = c; c.songs = []; });
  SONGS.forEach(function (s) {
    var c = chapterById[s.chapter];
    if (c) c.songs.push(s);
  });

  /* ---------------- 大地图节点布局（确定性） ---------------- */
  function layoutNodes(chapter) {
    var n = Math.max(1, chapter.songs.length);
    var rng = U.rng('layout-' + chapter.id);
    var pts = [];
    var i, a, t;
    if (chapter.workshop) {
      for (i = 0; i < n; i++) {
        a = -Math.PI / 2 + i * (Math.PI * 2 / n);
        pts.push({ x: chapter.x + Math.cos(a) * chapter.r * 0.5, y: chapter.y + Math.sin(a) * chapter.r * 0.45 });
      }
      return pts;
    }
    if (chapter.layout === 'path' || chapter.layout === 'zigzag') {
      for (i = 0; i < n; i++) {
        t = n === 1 ? 0.5 : i / (n - 1);
        var px = chapter.x - chapter.r * 0.88 + t * chapter.r * 1.76;
        var amp = chapter.layout === 'zigzag' ? 0.72 : 0.5;
        var py = chapter.y + Math.sin(t * Math.PI * (chapter.layout === 'zigzag' ? 2.2 : 1.35)) * chapter.r * amp * rng.sign();
        pts.push({ x: px + rng.range(-12, 12), y: py + rng.range(-12, 12) });
      }
    } else if (chapter.layout === 'arc') {
      for (i = 0; i < n; i++) {
        t = n === 1 ? 0.5 : i / (n - 1);
        a = Math.PI * 0.92 - t * Math.PI * 0.84;
        pts.push({ x: chapter.x + Math.cos(a) * chapter.r * 0.86, y: chapter.y - Math.sin(a) * chapter.r * 0.7 });
      }
    } else if (chapter.layout === 'spiral') {
      for (i = 0; i < n; i++) {
        t = n === 1 ? 0.5 : i / (n - 1);
        a = t * Math.PI * 2.1 - Math.PI / 2;
        var rr = chapter.r * (0.35 + 0.6 * t);
        pts.push({ x: chapter.x + Math.cos(a) * rr * 1.05, y: chapter.y + Math.sin(a) * rr * 0.85 });
      }
    } else {
      for (i = 0; i < n; i++) {
        a = -Math.PI / 2 + i * (Math.PI * 1.6 / n) + rng.range(-0.14, 0.14);
        var rd = chapter.r * (0.42 + rng.range(0, 0.36));
        pts.push({ x: chapter.x + Math.cos(a) * rd, y: chapter.y + Math.sin(a) * rd * 0.9 });
      }
    }
    return pts;
  }
  CHAPTERS.forEach(function (c) {
    var pts = layoutNodes(c);
    c.songs.forEach(function (s, i) { s.node = pts[i] || { x: c.x, y: c.y }; });
    if (c.workshop) c.node = { x: c.x, y: c.y };
  });

  /* ---------------- 解锁与进度 ---------------- */
  var S = {
    chapters: CHAPTERS,
    all: function () { return SONGS; },
    byId: function (id) { return byId[id] || null; },
    chapter: function (id) { return chapterById[id] || null; },
    chapterOf: function (song) { return chapterById[song.chapter] || null; },

    chapterStars: function (ch) {
      var sum = 0;
      ch.songs.forEach(function (s) {
        s.diffs.forEach(function (d, i) {
          var r = RG.Store.record(s.id, i);
          if (r) sum += r.stars || 0;
        });
      });
      return sum;
    },
    chapterCleared: function (ch) {
      var n = 0;
      ch.songs.forEach(function (s) { var r = RG.Store.record(s.id, 0); if (r && r.clear) n++; });
      return n;
    },
    chapterProgress: function (ch) {
      var cleared = 0, total = 0, stars = 0, maxStars = 0;
      ch.songs.forEach(function (s) {
        s.diffs.forEach(function (d, i) {
          total++; maxStars += 3;
          var r = RG.Store.record(s.id, i);
          if (r && r.clear) cleared++;
          if (r) stars += r.stars || 0;
        });
      });
      return { cleared: cleared, total: total, stars: stars, maxStars: maxStars, ratio: total ? cleared / total : 0 };
    },
    isChapterUnlocked: function (ch) {
      if (!ch) return false;
      if (ch.workshop) return true;
      if (!ch.unlock || !ch.unlock.stars) return true;
      return RG.Store.totalStars() >= ch.unlock.stars;
    },
    unlockHint: function (ch) {
      if (S.isChapterUnlocked(ch)) return '';
      return '需要 ★' + (ch.unlock ? ch.unlock.stars : 0) + '（当前 ★' + RG.Store.totalStars() + '）';
    },
    isSongUnlocked: function (song) {
      var ch = chapterById[song.chapter];
      if (!ch || !S.isChapterUnlocked(ch)) return false;
      var idx = ch.songs.indexOf(song);
      if (idx <= 0) return true;
      var prev = ch.songs[idx - 1];
      var r = RG.Store.record(prev.id, 0);
      return !!(r && r.clear);
    },
    songUnlockHint: function (song) {
      var ch = chapterById[song.chapter];
      if (!ch) return '';
      if (!S.isChapterUnlocked(ch)) return S.unlockHint(ch);
      var idx = ch.songs.indexOf(song);
      if (idx <= 0) return '';
      var prev = ch.songs[idx - 1];
      if (S.isSongUnlocked(song)) return '';
      return '先通关「' + prev.title + '」';
    },
    flat: function () {
      var out = [];
      CHAPTERS.forEach(function (c) {
        if (c.workshop) return;
        c.songs.forEach(function (s) { s.diffs.forEach(function (d, i) { out.push({ song: s, diff: i }); }); });
      });
      return out;
    },
    next: function (songId, diffIndex) {
      var list = S.flat(), at = -1;
      for (var i = 0; i < list.length; i++) if (list[i].song.id === songId && list[i].diff === diffIndex) { at = i; break; }
      if (at < 0 || at + 1 >= list.length) return null;
      return list[at + 1];
    },
    workshopItems: function () {
      return RG.Store.customCharts().map(function (c) {
        return {
          id: c.meta.id, title: c.meta.title, artist: c.meta.artist || '我',
          chapter: 'workshop', lanes: c.meta.lanes, custom: true, chart: c,
          desc: c.meta.desc || '自制谱面', theme: c.meta.theme || { a: '#ffd35c', b: '#5cff9d' },
          diffs: [{ name: c.meta.difficulty || '自定义', level: c.meta.level, lanes: c.meta.lanes, seed: 0 }]
        };
      });
    },
    /** 把自制谱面同步进工坊章节（含地图节点坐标） */
    refreshWorkshop: function () {
      var ch = chapterById.workshop;
      if (!ch) return;
      ch.songs = S.workshopItems();
      var pts = layoutNodes(ch);
      ch.songs.forEach(function (s, i) { s.node = pts[i] || { x: ch.x, y: ch.y }; });
      return ch;
    },
    chartFor: function (song, diffIndex) {
      if (song.custom) return RG.Chart.clone(song.chart);
      return RG.Chart.fromSong(song, diffIndex);
    },
    musicFor: function (song, diffIndex) {
      if (song.custom) {
        var m = song.chart.meta.music;
        return m ? RG.Music.build(m) : null;
      }
      return RG.Music.build(song.music);
    }
  };

  RG.Songs = S;
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
 * Resonance Engine · chart.js
 * 谱面模型：音符类型、校验、统计、序列化，以及「由乐曲自动铺面」算法
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  /* ---------------- 音符类型 ---------------- */
  var TYPES = {
    tap: { id: 'tap', label: 'TAP', short: 'T', color: '#38e8ff', base: 1000, key: '按一下' },
    hold: { id: 'hold', label: 'HOLD', short: 'H', color: '#5cff9d', base: 1500, key: '按住不放' },
    slide: { id: 'slide', label: 'SLIDE', short: 'S', color: '#ffd35c', base: 1600, key: '起点按 + 终点按' },
    flick: { id: 'flick', label: 'FLICK', short: 'F', color: '#ff9d3c', base: 1200, key: '按下后滑动 / 同时按两个键' },
    mine: { id: 'mine', label: 'MINE', short: 'M', color: '#ff5c6e', base: 600, key: '不要按！', avoid: true }
  };
  var ORDER = ['tap', 'hold', 'slide', 'flick', 'mine'];

  function noteDur(n) {
    if (n.type === 'hold' || n.type === 'slide') return Math.max(0.05, n.d || 0);
    return 0;
  }

  /* ---------------- 谱面对象 ---------------- */
  function create(meta) {
    return {
      format: 'rg-chart', version: 1,
      meta: Object.assign({
        id: U.uid('chart'), songId: 'custom', title: '未命名谱面', artist: '—',
        difficulty: '自定义', level: 7, lanes: 4, bpm: 120, offsetSec: 0,
        length: 120, author: 'me', builtin: false, seed: 1, theme: null, music: null,
        view: '2d',          // 起始视角：2d | 3d
        viewEvents: [],      // 内嵌的 2D/3D 切换环节：[{t, mode, dur}]
        desc: ''
      }, meta || {}),
      notes: []
    };
  }
  function clone(chart) { return U.deepClone(chart); }

  function normalize(chart) {
    if (!chart || !chart.meta) return chart;
    chart.meta.lanes = U.clamp(chart.meta.lanes | 0 || 4, 1, 10);
    chart.meta.level = U.clamp(Math.round(chart.meta.level || 1), 1, 20);
    chart.notes = (chart.notes || []).filter(function (n) {
      return n && isFinite(n.t) && isFinite(n.lane) && TYPES[n.type];
    }).map(function (n) {
      var o = { t: Math.max(0, +n.t), lane: U.clamp(n.lane | 0, 0, chart.meta.lanes - 1), type: n.type };
      if (n.type === 'hold') o.d = Math.max(0.05, +(n.d || 0.25));
      if (n.type === 'slide') {
        o.d = Math.max(0.05, +(n.d || 0.25));
        o.tail = U.clamp((n.tail === undefined ? n.lane : n.tail) | 0, 0, chart.meta.lanes - 1);
        if (o.tail === n.lane) o.tail = (n.lane + 1) % chart.meta.lanes;
      }
      return o;
    }).sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
    /* 视角切换环节：排序、清洗、去掉与起始视角重复的开头事件 */
    normalizeViews(chart);
    return chart;
  }

  /** 视角标记清洗与规范化 */
  function normalizeViews(chart) {
    var m = chart.meta;
    if (m.view !== '3d') m.view = '2d';
    var list = (m.viewEvents || []).filter(function (e) {
      return e && isFinite(e.t) && (e.mode === '2d' || e.mode === '3d');
    }).map(function (e) {
      return {
        t: Math.max(0, +e.t),
        mode: e.mode,
        dur: U.clamp(+(e.dur === undefined ? 0.8 : e.dur), 0.15, 3)
      };
    }).sort(function (a, b) { return a.t - b.t; });
    /* 去掉太近的重复切换（同一视角 0.4s 内不再重复） */
    var out = [], last = { t: -99, mode: m.view };
    list.forEach(function (e) {
      if (e.mode === last.mode && e.t - last.t < 0.4) return;
      if (Math.abs(e.t - last.t) < 0.12) return;
      out.push(e);
      last = e;
    });
    /* 首个标记若与起始视角相同且贴着开头，视为冗余 */
    if (out.length && out[0].mode === m.view && out[0].t < 0.35) out.shift();
    m.viewEvents = out;
    m.view = out.length ? m.view : m.view;
    return chart;
  }

  /** 取某个时刻生效的视角；返回 {mode, dur, since}（since = 该次切换已过去多久） */
  function viewAt(chart, t) {
    var m = chart.meta;
    var mode = m.view === '3d' ? '3d' : '2d';
    var last = null;
    var evs = m.viewEvents || [];
    for (var i = 0; i < evs.length; i++) {
      if (evs[i].t <= t) { mode = evs[i].mode; last = evs[i]; }
      else break;
    }
    return { mode: mode, dur: last ? last.dur : 0.8, since: last ? t - last.t : Infinity, event: last };
  }

  /** 下一次视角切换（用于 HUD 预告） */
  function nextViewEvent(chart, t) {
    var evs = chart.meta.viewEvents || [];
    for (var i = 0; i < evs.length; i++) if (evs[i].t > t + 0.01) return evs[i];
    return null;
  }

  /** 统计两种视角各占多久 */
  function viewTotals(chart) {
    var m = chart.meta, len = m.length || 0;
    var cur = { t: 0, mode: m.view === '3d' ? '3d' : '2d' };
    var acc = { '2d': 0, '3d': 0 };
    (m.viewEvents || []).forEach(function (e) {
      if (e.t > cur.t) acc[cur.mode] += Math.min(e.t, len) - cur.t;
      cur = { t: Math.max(cur.t, e.t), mode: e.mode };
    });
    if (cur.t < len) acc[cur.mode] += len - cur.t;
    return { two: acc['2d'], three: acc['3d'], switches: (m.viewEvents || []).length };
  }

  /** 校验：返回错误/警告与统计 */
  function validate(chart) {
    var errors = [], warnings = [];
    if (!chart || typeof chart !== 'object') return { ok: false, errors: ['谱面不是对象'], warnings: [], stats: null };
    if (chart.format !== 'rg-chart') errors.push('format 字段应为 "rg-chart"');
    if (!chart.meta) errors.push('缺少 meta');
    if (!Array.isArray(chart.notes)) errors.push('notes 必须是数组');
    if (errors.length) return { ok: false, errors: errors, warnings: warnings, stats: null };
    var m = chart.meta, lanes = m.lanes | 0;
    if (lanes < 1 || lanes > 10) errors.push('轨道数需在 1~10 之间');
    if (!(m.bpm > 0)) warnings.push('BPM 非法，已按 120 处理');
    var unknown = 0;
    chart.notes.forEach(function (n, i) {
      if (!TYPES[n.type]) { unknown++; if (unknown < 4) warnings.push('第 ' + (i + 1) + ' 个音符类型未知：' + n.type); return; }
      if (n.lane < 0 || n.lane >= lanes) errors.push('第 ' + (i + 1) + ' 个音符轨道越界：' + n.lane);
      if (!isFinite(n.t) || n.t < 0) errors.push('第 ' + (i + 1) + ' 个音符时间非法');
      if ((n.type === 'hold' || n.type === 'slide') && !(n.d > 0)) errors.push('第 ' + (i + 1) + ' 个长条缺少时长 d');
      if (n.type === 'slide' && (n.tail === undefined || n.tail < 0 || n.tail >= lanes || n.tail === n.lane))
        warnings.push('第 ' + (i + 1) + ' 个 SLIDE 终点非法，已自动修正');
    });
    if (unknown) warnings.push('共 ' + unknown + ' 个未知类型音符将被忽略');
    /* 视角切换环节 */
    if (m.view && m.view !== '2d' && m.view !== '3d') warnings.push('起始视角非法，已按 2D 处理');
    (m.viewEvents || []).forEach(function (e, i) {
      if (!e || (e.mode !== '2d' && e.mode !== '3d')) warnings.push('第 ' + (i + 1) + ' 个视角切换标记模式非法，将被忽略');
      else if (!isFinite(e.t) || e.t < 0) errors.push('第 ' + (i + 1) + ' 个视角切换标记时间非法');
    });
    // 同轨重叠检测
    var byLane = {};
    chart.notes.forEach(function (n) {
      if (!TYPES[n.type]) return;
      (byLane[n.lane] = byLane[n.lane] || []).push(n);
    });
    Object.keys(byLane).forEach(function (l) {
      var arr = byLane[l].slice().sort(function (a, b) { return a.t - b.t; });
      for (var i = 1; i < arr.length; i++) {
        var prevEnd = arr[i - 1].t + noteDur(arr[i - 1]);
        if (arr[i].t < prevEnd - 0.01 && arr[i].type !== 'mine' && arr[i - 1].type !== 'mine')
          warnings.push('轨道 ' + (+l + 1) + ' 在 ' + arr[i].t.toFixed(2) + 's 处音符重叠');
      }
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, stats: stats(chart) };
  }

  function stats(chart) {
    var counts = { tap: 0, hold: 0, slide: 0, flick: 0, mine: 0 };
    var maxCombo = 0, total = 0, first = Infinity, last = 0, weight = 0;
    (chart.notes || []).forEach(function (n) {
      if (!TYPES[n.type]) return;
      if (n.type !== 'mine') { counts[n.type]++; maxCombo++; total++; weight += TYPES[n.type].base; }
      else counts.mine++;
      first = Math.min(first, n.t);
      last = Math.max(last, n.t + noteDur(n));
    });
    var len = chart.meta.length || last || 1;
    var vt = viewTotals(chart);
    return {
      counts: counts, total: total, maxCombo: maxCombo, mines: counts.mine,
      first: isFinite(first) ? first : 0, last: last, duration: len,
      nps: total / Math.max(1, (isFinite(first) ? last - first : 1)),
      baseScore: Math.round(weight),
      view: chart.meta.view || '2d', switches: vt.switches, view2d: vt.two, view3d: vt.three
    };
  }

  function serialize(chart, pretty) {
    var out = { format: 'rg-chart', version: 1, meta: chart.meta, notes: chart.notes };
    return JSON.stringify(out, null, pretty ? 2 : 0);
  }
  function parse(text) {
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data && data.kind === 'rg-save') throw new Error('这是存档文件，不是谱面文件');
    var chart = { format: data.format, version: data.version || 1, meta: data.meta, notes: data.notes };
    var v = validate(chart);
    if (!v.ok) throw new Error('谱面校验失败：' + v.errors.slice(0, 3).join('；'));
    return normalize(chart);
  }

  /* ---------------- 时间 / 节拍工具 ---------------- */
  function beatDurOf(chart) { return 60 / (chart.meta.bpm || 120); }
  function beatAt(chart, t) { return t / beatDurOf(chart); }
  function timeAtBeat(chart, b) { return b * beatDurOf(chart); }
  /** 吸附到 1/(snapPerBeat) 拍网格；snapPerBeat=0 表示不吸附 */
  function snap(chart, t, snapPerBeat, offsetBeats) {
    if (!snapPerBeat) return t;
    var grid = beatDurOf(chart) / snapPerBeat;
    var off = (offsetBeats || 0) * beatDurOf(chart);
    return Math.max(0, Math.round((t - off) / grid) * grid + off);
  }

  /* ======================================================================
   * 自动铺面：把乐曲事件转成可玩的谱面
   * ====================================================================== */
  var WEIGHTS = { kick: 1.0, snare: 0.9, lead: 0.62, bass: 0.3, hat: 0.16, ohat: 0.24, crash: 0.34, spark: 0.42, riser: 0, pad: 0 };

  function npsForLevel(level) { return 0.85 + level * 0.56; }

  function generate(music, spec) {
    spec = spec || {};
    var lanes = U.clamp(spec.lanes || 4, 1, 10);
    var level = U.clamp(spec.level || 5, 1, 20);
    var rng = U.rng(spec.seed === undefined ? 1 : spec.seed);
    var beat = music.beatDur, bar = music.barDur;
    var offset = spec.offsetSec || 0;

    /* --- 1. 候选击打点 --- */
    var gridDiv = level <= 2 ? 1 : (level <= 5 ? 2 : (level <= 8 ? 2 : 4));
    var grid = beat / gridDiv;
    var byTime = {};
    music.events.forEach(function (e) {
      var w = WEIGHTS[e.type];
      if (!w) return;
      var t = e.t - offset;
      if (t < bar * 2) return;             // 前两小节留白
      var st = Math.round(t / grid) * grid;
      if (Math.abs(st - t) > grid * 0.6) return;
      var key = st.toFixed(4);
      var slot = byTime[key] || (byTime[key] = { t: st, w: 0, types: {}, count: 0, dur: 0 });
      slot.w = Math.max(slot.w, w) + w * 0.28;
      slot.types[e.type] = (slot.types[e.type] || 0) + 1;
      slot.count++;
      slot.dur = Math.max(slot.dur, e.d);
    });
    var cands = Object.keys(byTime).map(function (k) { return byTime[k]; });
    cands.forEach(function (c) {
      var b = c.t / beat;
      var inBar = b % 4;
      if (Math.abs(inBar - Math.round(inBar)) < 0.01) c.w += 0.42;             // 正拍
      if (Math.abs(inBar - 0) < 0.01 || Math.abs(inBar - 2) < 0.01) c.w += 0.34; // 强拍
      if (c.types.crash) c.w += 0.3;
      c.w += rng.range(-0.12, 0.12);
      if (c.types.pad && !c.types.kick && !c.types.snare && !c.types.lead) c.w -= 0.7;
    });

    /* --- 2. 按目标密度挑选 --- */
    var span = Math.max(1, (cands.length ? cands[cands.length - 1].t : 1) - bar * 2);
    var allowed = Math.round(npsForLevel(level) * span);
    allowed = Math.max(8, allowed);
    var minGap = beat / (level >= 10 ? 4 : (level >= 7 ? 3 : 2));
    cands.sort(function (a, b) { return b.w - a.w; });
    var picked = [];
    for (var i = 0; i < cands.length && picked.length < allowed; i++) {
      var c = cands[i];
      var ok = true;
      for (var j = picked.length - 1; j >= 0; j--) {
        if (picked[j].t <= c.t - minGap) break;
        if (Math.abs(picked[j].t - c.t) < minGap - 1e-6) { ok = false; break; }
      }
      if (ok) picked.push(c);
    }
    picked.sort(function (a, b) { return a.t - b.t; });

    /* --- 3. 分配轨道 + 音符类型 --- */
    var notes = [];
    var busy = new Array(lanes);
    for (var bi = 0; bi < lanes; bi++) busy[bi] = -1;
    var lastLane = Math.floor(lanes / 2) - 1, dir = 1, streak = 0;
    var chordPairs = lanes >= 4 ? [[0, lanes - 1], [1, lanes - 2], [0, 2], [lanes - 3, lanes - 1]] : [[0, 0]];
    var barsPerPhrase = 4;

    function freeAt(lane, t, guard) {
      if (busy[lane] > t - (guard || 0.02)) return false;
      for (var k = notes.length - 1; k >= 0 && notes[k].t > t - 1.2; k--) {
        var n = notes[k];
        if (n.lane === lane && Math.abs(n.t - t) < (guard || 0.02)) return false;
      }
      return true;
    }
    function place(lane, t, type, dur, tail) {
      var n = { t: +t.toFixed(4), lane: lane, type: type };
      if (type === 'hold') n.d = +Math.max(0.06, dur).toFixed(4);
      if (type === 'slide') { n.d = +Math.max(0.06, dur).toFixed(4); n.tail = tail; }
      notes.push(n);
      busy[lane] = t + noteDur(n) + (type === 'mine' ? 0.3 : 0.02);
      return n;
    }

    for (var pi = 0; pi < picked.length; pi++) {
      var it = picked[pi], t = it.t;
      var accent = !!(it.types.kick || it.types.snare) && it.w > 1.1;
      var density = it.types.lead ? 'stream' : 'single';
      // 轨道选择
      var lane;
      if (density === 'stream') {
        streak++;
        if (streak % rng.int(3, 5) === 0) dir = rng.chance(0.5) ? 1 : -1;
        lane = lastLane + dir;
        if (lane < 0 || lane >= lanes) { dir = -dir; lane = U.clamp(lastLane + dir, 0, lanes - 1); }
        if (rng.chance(level >= 8 ? 0.16 : 0.05)) lane = rng.int(0, lanes - 1);
      } else {
        streak = 0;
        if (rng.chance(0.62)) {
          var cand = rng.int(0, lanes - 1);
          if (cand === lastLane) cand = (cand + 1 + rng.int(0, lanes - 2)) % lanes;
          lane = cand;
        } else {
          lane = U.clamp(lastLane + rng.sign() * rng.int(1, Math.max(1, lanes - 1)), 0, lanes - 1);
        }
        if (!freeAt(lane, t, 0.03)) {
          for (var L = 0; L < lanes; L++) { if (freeAt(L, t, 0.03)) { lane = L; break; } }
        }
      }
      if (!freeAt(lane, t, 0.03)) { lastLane = lane; continue; }
      lastLane = lane;

      // 类型判定
      var nextT = (pi + 1 < picked.length) ? picked[pi + 1].t : t + bar;
      var gap = nextT - t;
      var isPhraseEdge = Math.abs((t / bar) % barsPerPhrase) < 0.06 || Math.abs((t / bar) % barsPerPhrase - (barsPerPhrase - 0.001)) < 0.06;
      var type = 'tap', dur = 0, tail = 0;

      if (level >= 6 && it.types.lead && it.t % (bar * 2) < 0.05 && gap > beat * 1.2) {
        // 段落感的滑条：跨越到相邻轨道
        var tailLane = lane + (rng.chance(0.5) ? 1 : -1);
        if (tailLane >= 0 && tailLane < lanes && freeAt(tailLane, t + beat, 0.12)) {
          type = 'slide'; dur = Math.min(beat * 1.5, Math.max(beat, gap - 0.05)); tail = tailLane;
        }
      }
      if (type === 'tap' && it.dur >= beat * 1.1 && gap > beat * 1.3 && (rng.chance(0.62) || isPhraseEdge)) {
        type = 'hold'; dur = Math.min(it.dur, gap - 0.06, bar * 0.95);
        if (dur < beat * 0.5) type = 'tap';
      }
      if (type === 'tap' && level >= 5 && (it.types.snare || it.types.spark) && rng.chance(0.13 + level * 0.01)) {
        type = 'flick';
      }
      if (type === 'tap' && accent && level >= 4 && lanes >= 4 && rng.chance(0.1 + level * 0.02)) {
        // 双押
        var pair = rng.pick(chordPairs);
        var other = (pair[0] === lane) ? pair[1] : pair[0];
        if (other !== lane && freeAt(other, t, 0.05)) place(other, t, 'tap');
      }
      place(lane, t, type, dur, tail);
    }

    /* --- 4. 地雷（高难度点缀） --- */
    if (level >= 6) {
      var mineQuota = Math.round((level - 5) * 1.1 * Math.max(1, span / 60));
      var tries = 0;
      while (mineQuota > 0 && tries < 400) {
        tries++;
        var src = cands[rng.int(0, cands.length - 1)];
        if (!src) break;
        var mt = src.t + (rng.chance(0.5) ? -grid * 0.5 : grid * 0.5);
        if (mt < bar * 4) continue;
        var ml = rng.int(0, lanes - 1);
        var clash = false;
        for (var ni = 0; ni < notes.length; ni++) {
          if (notes[ni].lane === ml && Math.abs(notes[ni].t - mt) < 0.34) { clash = true; break; }
        }
        if (clash) continue;
        // 不要放在整拍强位置，让玩家有反应空间
        notes.push({ t: +mt.toFixed(4), lane: ml, type: 'mine' });
        mineQuota--;
      }
    }

    notes.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });

    /* --- 5. 内嵌 2D/3D 切换环节：跟着段落强度走（副歌/高潮切 3D） --- */
    var viewEvents = [];
    var startView = '2d';
    if (spec.viewSwitch !== false) {
      var cur = startView;
      var lastT = -99;
      (music.sections || []).forEach(function (sec, si) {
        var want = sec.intensity >= 2 ? '3d' : '2d';
        // 第一段保持起始视角，避免一开场就切
        if (si === 0) want = startView;
        if (want === cur) return;
        // 提前一点开始过渡，让画面正好在段落重拍处完成切换
        var at = Math.max(bar * 2, sec.start - (want === '3d' ? 1.6 : 1.2));
        if (at - lastT < 4) return;                        // 至少隔 4 秒
        viewEvents.push({ t: +at.toFixed(3), mode: want, dur: want === '3d' ? 1.0 : 0.7 });
        cur = want;
        lastT = at;
      });
      // 高难度谱面再多一次「插入式」切换，制造惊喜段落（后半段切回 2D 再切 3D）
      if (level >= 12 && viewEvents.length >= 2 && music.duration > 40) {
        var mid = music.duration * 0.62;
        var after = viewEvents.filter(function (e) { return e.t > mid; })[0];
        if (after && after.mode === '3d') {
          viewEvents.push({ t: +(mid).toFixed(3), mode: '2d', dur: 0.6 });
        }
      }
    }

    var chart = create(Object.assign({
      id: (spec.songId || 'gen') + '::' + (spec.diffIndex === undefined ? 0 : spec.diffIndex),
      songId: spec.songId || 'gen', title: spec.title || '生成谱面', artist: spec.artist || 'Resonance',
      difficulty: spec.difficulty || '标准', level: level, lanes: lanes, bpm: music.bpm,
      offsetSec: offset, length: music.duration, author: 'auto', builtin: !!spec.builtin,
      seed: spec.seed, theme: spec.theme || null, music: spec.music || null, desc: spec.desc || '',
      view: startView, viewEvents: viewEvents
    }, spec.meta || {}));
    chart.notes = notes;
    return normalize(chart);
  }

  /* ---------------- 便捷：内置曲目的谱面（带缓存） ---------------- */
  var builtinCache = {};
  function fromSong(song, diffIndex) {
    var key = song.id + '::' + diffIndex;
    if (builtinCache[key]) return builtinCache[key];
    var spec = song.diffs[diffIndex] || song.diffs[0];
    var music = spec.music ? RG.Music.build(spec.music) : RG.Music.build(song.music);
    var chart = generate(music, {
      lanes: spec.lanes || song.lanes || 4,
      level: spec.level || 5,
      seed: (spec.seed === undefined ? (U.hashStr(song.id) + diffIndex * 977) : spec.seed),
      songId: song.id, diffIndex: diffIndex,
      title: song.title, artist: song.artist, difficulty: spec.name,
      theme: song.theme, builtin: true, music: song.music,
      desc: song.desc
    });
    chart.meta.music = null; // 内置曲目无需内嵌
    builtinCache[key] = chart;
    return chart;
  }

  RG.Chart = {
    TYPES: TYPES, ORDER: ORDER,
    create: create, clone: clone, normalize: normalize, validate: validate, stats: stats,
    serialize: serialize, parse: parse, noteDur: noteDur,
    beatDurOf: beatDurOf, beatAt: beatAt, timeAtBeat: timeAtBeat, snap: snap,
    generate: generate, fromSong: fromSong, npsForLevel: npsForLevel,
    normalizeViews: normalizeViews, viewAt: viewAt, nextViewEvent: nextViewEvent, viewTotals: viewTotals,
    clearCache: function () { builtinCache = {}; }
  };
})(typeof window !== 'undefined' ? window : globalThis);

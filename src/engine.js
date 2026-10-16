/* ==========================================================================
 * Resonance Engine · engine.js
 * 玩法核心：判定窗口、五种音符的完整状态机、连击/分数/血量/评级
 * 纯逻辑实现（时间由外部注入），可在 Node 沙箱里做无头仿真测试。
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  var PRESETS = {
    lenient: { perfect: 52, great: 100, good: 150, miss: 196 },
    normal: { perfect: 40, great: 78, good: 122, miss: 158 },
    strict: { perfect: 28, great: 56, good: 92, miss: 124 }
  };
  var MULT = { perfect: 1, great: 0.75, good: 0.4, miss: 0, break: 0.3, avoid: 0 };
  var MINE_WINDOW = 0.16;
  /* 点划（flick）规则：
   *   指针/触屏：在判定时刻按下，然后朝任意方向滑动一下即可（无需松手）
   *   键盘：和单点一样按，但必须至少有 2 个键同时按下
   * 两者都在「按下那一刻」的时机上判定；没完成（没滑动 / 只按了一个键）就按漏击处理。 */
  var LIFE_GAIN = { perfect: 0.45, great: 0.25, good: -1.2, miss: -7.5, break: -4.5, mine: -12 };

  /** 判定难度对扣血的影响：困难（strict）扣血 ×2；宽松（lenient）不计入成绩 */
  function lifeScaleFor(settings) {
    return (settings && settings.judgeDifficulty === 'strict') ? 2 : 1;
  }
  function rankedFor(settings) {
    return !(settings && settings.judgeDifficulty === 'lenient');
  }

  function weightsFor(settings) {
    var preset = settings.judgeDifficulty || 'normal';
    if (preset === 'custom' && settings.customWindows) {
      return {
        perfect: settings.customWindows.perfect, great: settings.customWindows.great,
        good: settings.customWindows.good, miss: settings.customWindows.miss
      };
    }
    return PRESETS[preset] || PRESETS.normal;
  }

  function grade(acc, failed) {
    if (failed) return 'F';
    if (acc >= 0.995) return 'SS';
    if (acc >= 0.95) return 'S';
    if (acc >= 0.90) return 'A';
    if (acc >= 0.80) return 'B';
    if (acc >= 0.70) return 'C';
    return 'D';
  }

  function Engine(cfg) {
    cfg = cfg || {};
    this.chart = RG.Chart.normalize(RG.Chart.clone(cfg.chart));
    if (!this.chart.meta.length) {
      var st = RG.Chart.stats(this.chart);
      this.chart.meta.length = st.last || 60;
    }
    this.settings = cfg.settings || {};
    this.isHeld = cfg.isHeld || function () { return false; };
    /* 当前按下的键盘键数（点划的键盘规则要求 ≥2 个键同时按下；触摸不计入） */
    this.heldKeys = cfg.heldKeys || cfg.heldCount || function () { return 0; };
    this.autoplay = cfg.autoplay !== undefined ? !!cfg.autoplay : !!(this.settings.autoplay);
    this.hooks = cfg.hooks || {};
    this.win = weightsFor(this.settings);
    this.noFail = cfg.noFail !== undefined ? !!cfg.noFail : !!this.settings.noFail;
    this.lifeScale = lifeScaleFor(this.settings);      // 困难模式扣血 ×2
    this.ranked = rankedFor(this.settings);            // 宽松模式不计入成绩
    this.reset();
  }
  Engine.PRESETS = PRESETS;

  Engine.prototype.reset = function () {
    var self = this;
    this.notes = this.chart.notes.map(function (n, i) {
      return {
        i: i, t: n.t, lane: n.lane, type: n.type, d: n.d || 0, tail: n.tail,
        endT: n.t + (n.d || 0), state: 0, judge: '', delta: 0, breakEarly: false, tailJudge: ''
      };
    });
    this.active = [];
    this.armed = {};
    this.missCursor = 0;
    this.time = 0;
    this.combo = 0; this.maxCombo = 0; this.life = 100; this.failed = false; this.finished = false;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0, break: 0, mineHit: 0, avoided: 0, empty: 0 };
    this.gotWeight = 0;
    this.totalWeight = 0;
    this.offsetSum = 0; this.offsetN = 0;
    this.earlyN = 0; this.lateN = 0; this.earlySum = 0; this.lateSum = 0;
    this.playable = 0;
    this.notes.forEach(function (n) {
      if (n.type === 'mine') return;
      self.playable++;
      self.totalWeight += RG.Chart.TYPES[n.type].base / 1000;
    });
    this._lastJudge = null;
    return this;
  };

  Engine.prototype.windowsSec = function () {
    return { perfect: this.win.perfect / 1000, great: this.win.great / 1000, good: this.win.good / 1000, miss: this.win.miss / 1000 };
  };
  Engine.prototype._laneOffset = function (lane) {
    var a = this.settings.laneOffsetMs;
    return (a && a[lane]) ? +a[lane] : 0;
  };
  Engine.prototype._deltaMs = function (note, t) {
    return (t - note.t) * 1000 - (this.settings.offsetMs || 0) - this._laneOffset(note.lane);
  };
  Engine.prototype._classify = function (ms) {
    var a = Math.abs(ms);
    if (a <= this.win.perfect) return 'perfect';
    if (a <= this.win.great) return 'great';
    if (a <= this.win.good) return 'good';
    return 'miss';
  };

  Engine.prototype._emit = function (name, payload) {
    var fn = this.hooks[name];
    if (fn) { try { fn(payload); } catch (e) { if (root.console) root.console.error(e); } }
  };

  /* ---------------- 判定结果落实 ---------------- */
  Engine.prototype._judge = function (note, result, deltaMs, isTail) {
    var T = RG.Chart.TYPES[note.type];
    var w = T.base / 1000;
    var headShare = (note.type === 'hold' || note.type === 'slide') ? 0.5 : 1;
    if (isTail) {
      note.tailJudge = result;
      var tMult = (result === 'break') ? 0.3 : (MULT[result] || 0);
      this.gotWeight += w * 0.5 * tMult;
      if (result === 'break') {
        this.counts.break++;
        this.combo = 0;
        this.life += LIFE_GAIN.break * this.lifeScale;
        this._lastJudge = { result: 'break', note: note, delta: 0, tail: true };
        this._emit('onJudge', { note: note, result: 'break', delta: 0, tail: true });
      } else {
        this.counts[result]++;
        this.life += 0.3;
        this._lastJudge = { result: result, note: note, delta: 0, tail: true };
        this._emit('onJudge', { note: note, result: result, delta: 0, tail: true });
      }
    } else {
      if (note.type === 'mine') {
        if (result === 'avoid') {
          this.counts.avoided++;
          note.state = 2; note.judge = 'avoid';
          this._emit('onJudge', { note: note, result: 'avoid', delta: 0 });
          return;
        }
        this.counts.mineHit++;
        this.combo = 0;
        this.life += LIFE_GAIN.mine * this.lifeScale;
        note.state = 2; note.judge = 'mine';
        this._lastJudge = { result: 'mine', note: note, delta: 0 };
        this._emit('onJudge', { note: note, result: 'mine', delta: 0 });
        this._emit('onMine', { note: note });
        this._checkLife();
        return;
      }
      this.gotWeight += w * headShare * (MULT[result] || 0);
      note.delta = deltaMs;
      if (result === 'miss') {
        this.counts.miss++;
        this.combo = 0;
        this.life += LIFE_GAIN.miss * this.lifeScale;
        note.state = 2; note.judge = 'miss';
      } else {
        this.counts[result]++;
        this.combo++;
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
        this.life += (LIFE_GAIN[result] || 0) * (LIFE_GAIN[result] < 0 ? this.lifeScale : 1);
        note.judge = result;
        if (deltaMs !== 0) {
          this.offsetSum += deltaMs; this.offsetN++;
          if (deltaMs < 0) { this.earlyN++; this.earlySum += deltaMs; } else { this.lateN++; this.lateSum += deltaMs; }
        }
        if (note.type === 'hold' || note.type === 'slide') {
          note.state = 1;
          this.active.push(note);
          this._emit('onHoldStart', { note: note });
        } else {
          note.state = 2;
        }
      }
      this._lastJudge = { result: result, note: note, delta: deltaMs };
      this._emit('onJudge', { note: note, result: result, delta: deltaMs });
      this._emit('onCombo', { combo: this.combo, result: result });
    }
    this.life = U.clamp(this.life, 0, 100);
    this._checkLife();
  };

  Engine.prototype._checkLife = function () {
    this.life = U.clamp(this.life, 0, 100);
    if (!this.noFail && this.life <= 0 && !this.failed) {
      this.failed = true;
      this.finished = true;
      this._emit('onFail', { life: this.life });
    }
  };

  Engine.prototype._finishHold = function (note, result) {
    delete note.__hold;
    this._judge(note, result || 'break', 0, true);
    note.state = 2;
    this._emit('onHoldEnd', { note: note, result: note.tailJudge });
  };

  /* ---------------- 输入事件 ---------------- */
  Engine.prototype.handleEvents = function (events) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === 'down') this.onDown(e.lane, e.time, e.source);
      else if (e.type === 'up') this.onUp(e.lane, e.time, e.source);
      else if (e.type === 'swipe') this.onSwipe(e.lane, e.time, e);
    }
  };

  /** 键盘路径的点划：只要凑够 2 个键按下就算完成（用最初那次按下的时机判定） */
  Engine.prototype._completeArmedByKeys = function (T) {
    if (this.heldKeys() < 2) return false;
    var done = false;
    for (var lk in this.armed) {
      var arm = this.armed[lk];
      if (!arm || arm.need !== 'keys' || arm.note.state !== 0) continue;
      if (this._flickExpired(arm, T)) continue;
      delete this.armed[lk];
      this._judge(arm.note, arm.result || this._classify(arm.deltaMs || 0), arm.deltaMs || 0);
      this._emit('onSwipe', { lane: arm.note.lane, note: arm.note, judged: true, by: 'keys' });
      done = true;
    }
    return done;
  };

  /** 点划是否已经错过完成时限（判定窗口结束） */
  Engine.prototype._flickExpired = function (arm, T) {
    return T > arm.note.t + this.win.miss / 1000;
  };

  Engine.prototype._candidate = function (lane, T) {
    var missSec = this.win.miss / 1000;
    var start = U.lowerBound(this.notes, T - 0.9);
    var best = null, bestD = Infinity, mine = null, mineD = Infinity;
    for (var i = start; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.t > T + 0.9) break;
      if (n.state !== 0) continue;
      var d = Math.abs(T - n.t);
      if (n.type === 'mine') {
        if (d <= MINE_WINDOW && d < mineD) { mine = n; mineD = d; }
        continue;
      }
      if (n.lane !== lane) continue;
      var lim = (n.type === 'hold' || n.type === 'slide') ? missSec : missSec;
      if (d <= lim && d < bestD) { best = n; bestD = d; }
    }
    return { note: best, dist: bestD, mine: mine, mineDist: mineD };
  };

  Engine.prototype.onDown = function (lane, T, source) {
    if (this.finished) return;
    /* 键盘点划：第二个键到达时先把等待中的点划结掉 */
    this._completeArmedByKeys(T);
    var c = this._candidate(lane, T);
    if (c.note) {
      var n = c.note;
      var delta = this._deltaMs(n, T);
      if (n.type === 'flick') {
        /* 时机在「按下」那一瞬判定；之后用「滑动」或「第二个键」来完成 */
        var fres = this._classify(delta);
        if (fres === 'miss') { this.counts.empty++; return; }   // 太早的边缘触碰忽略，可再试
        var need = source === 'pointer' ? 'swipe' : 'keys';
        if (need === 'keys' && this.heldKeys() >= 2) {           // 两键齐按：当场算数
          this._judge(n, fres, delta);
          this._emit('onSwipe', { lane: lane, note: n, judged: true, by: 'keys' });
          return;
        }
        if (!this.armed[lane] || this.armed[lane].note !== n) {
          this.armed[lane] = { note: n, down: T, need: need, result: fres, deltaMs: delta };
        } else {
          this.armed[lane].need = need;
        }
        this._emit('onFlickArm', { note: n, need: need });
        return;
      }
      if (n.type === 'hold' || n.type === 'slide') {
        var res = this._classify(delta);
        if (res === 'miss') { this._judge(n, 'miss', delta); return; }
        this._judge(n, res, delta);
        return;
      }
      this._judge(n, this._classify(delta), delta);
      return;
    }
    if (c.mine) { this._judge(c.mine, 'mine', 0); return; }
    this.counts.empty++;
  };

  /** 指针/触屏：按下后朝任意方向滑动一下即可完成点划（不需要松手） */
  Engine.prototype.onSwipe = function (lane, T, info) {
    if (this.finished) return;
    info = info || {};
    var arm = this.armed[lane];
    if (!arm || arm.note.state !== 0 || this._flickExpired(arm, T)) {
      /* 没有等待中的点划：只给一点视觉反馈 */
      this._emit('onSwipe', { lane: lane, judged: false, dx: info.dx || 0, dy: info.dy || 0 });
      return;
    }
    delete this.armed[lane];
    this._judge(arm.note, arm.result || this._classify(arm.deltaMs || 0), arm.deltaMs || 0);
    this._emit('onSwipe', {
      lane: lane, note: arm.note, judged: true, by: 'swipe',
      dx: info.dx || 0, dy: info.dy || 0
    });
  };

  Engine.prototype.onUp = function (lane, T) {
    if (this.finished) return;
    /* 点划：松手不再判失败。没滑动 / 只按了一个键的点划保持未判定，
       由漏击扫描在窗口结束时判 MISS（所以「按住不放」不会像旧版那样直接断掉）。 */
    var arm = this.armed[lane];
    if (arm) {
      delete this.armed[lane];
      if (arm.note.state === 0) {
        this._emit('onFlickFail', { note: arm.note, reason: arm.need === 'swipe' ? 'no-swipe' : 'one-key' });
      }
    }
    // 长条提前松手
    for (var i = this.active.length - 1; i >= 0; i--) {
      var a = this.active[i];
      if (a.lane !== lane) continue;
      if (this.isHeld(lane)) continue;         // 指针仍按住则不算松手
      if (T >= a.endT - this.win.good / 1000) {
        this._finishHold(a, 'perfect');
      } else {
        a.breakEarly = true;
        this._finishHold(a, 'break');
      }
      this.active.splice(i, 1);
    }
  };

  /* ---------------- 主循环 ---------------- */
  Engine.prototype.update = function (now) {
    if (this.finished) { this.time = now; return; }
    this.time = now;
    var missSec = this.win.miss / 1000;
    var i;
    /* 0. 自动演示优先结算：即使某一帧时间跳变，也不会误判成漏击 */
    if (this.autoplay) this._autoplayStep(now);
    /* 1. 漏击 / 地雷安全通过 */
    while (this.missCursor < this.notes.length && this.notes[this.missCursor].t + missSec < now) {
      var n = this.notes[this.missCursor];
      if (n.state === 0) {
        if (n.type === 'mine') this._judge(n, 'avoid', 0);
        else this._judge(n, 'miss', (now - n.t) * 1000);
      }
      this.missCursor++;
    }
    /* 2. 点划未完成（没滑动 / 只按了一个键）：清掉等待记录，
       音符本身交给上面的漏击扫描在窗口结束时判 MISS */
    for (var lk in this.armed) {
      var arm = this.armed[lk];
      if (!arm) continue;
      if (arm.note.state !== 0 || this._flickExpired(arm, now) || now > arm.note.t + 1.2) {
        if (arm.note.state === 0 && now > arm.note.t + 1.2) {
          this._emit('onFlickFail', { note: arm.note, reason: arm.need === 'swipe' ? 'no-swipe' : 'one-key' });
        }
        delete this.armed[lk];
      }
    }
    /* 3. 长条尾部（带容错窗口：略早/略晚按到终点轨道都不算断） */
    var tailGrace = (this.win.good + 70) / 1000;
    for (i = this.active.length - 1; i >= 0; i--) {
      var h = this.active[i];
      if (now < h.endT) continue;
      var held = this.autoplay || (this.isHeld(h.lane) && (h.type !== 'slide' || this.isHeld(h.tail)));
      var late = (now - h.endT) * 1000;
      if (held) {
        var tRes = late <= this.win.perfect ? 'perfect' : (late <= this.win.great ? 'great' : 'good');
        this._finishHold(h, tRes);
        this.active.splice(i, 1);
      } else if (now - h.endT > tailGrace) {
        this._finishHold(h, 'break');
        this.active.splice(i, 1);
      }
    }
    /* 4. 自动演示（已在帧首处理，这里仅兜底） */
    if (this.autoplay) this._autoplayStep(now);
    /* 5. 结束 */
    var last = this.notes.length ? this.notes[this.notes.length - 1] : null;
    var lastEnd = last ? Math.max(last.endT, last.t) + 0.4 : 0;
    if (now > lastEnd || (this.chart.meta.length && now > this.chart.meta.length + 0.9)) {
      if (!this.finished) {
        this.finished = true;
        this.flushPending();
        this._emit('onFinish', this.result());
      }
    }
  };

  Engine.prototype._autoplayStep = function (now) {
    var self = this;
    for (var i = this.missCursor; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.t > now + 0.001) break;
      if (n.state !== 0) continue;
      if (n.type === 'mine') continue;
      this._judge(n, 'perfect', 0);
    }
  };

  /** 把仍在按下的长条按完美收尾 */
  Engine.prototype.flushPending = function () {
    for (var i = this.active.length - 1; i >= 0; i--) this._finishHold(this.active[i], 'perfect');
    this.active.length = 0;
  };

  /** 曲终：把还在按的长条收尾（失败或中途退出时不再补记未演奏的音符） */
  Engine.prototype.finish = function () {
    if (this.finished) return this.result();
    this.finished = true;
    this.flushPending();
    this._emit('onFinish', this.result());
    return this.result();
  };

  Engine.prototype.accuracy = function () {
    return this.totalWeight > 0 ? U.clamp(this.gotWeight / this.totalWeight, 0, 1) : 1;
  };
  Engine.prototype.progress = function () {
    var len = this.chart.meta.length || 1;
    return U.clamp(this.time / len, 0, 1);
  };
  Engine.prototype.avgOffset = function () {
    return this.offsetN ? this.offsetSum / this.offsetN : 0;
  };

  Engine.prototype.result = function () {
    var acc = this.accuracy();
    var comboRatio = this.playable > 0 ? this.maxCombo / this.playable : 0;
    var score = Math.round(1000000 * (0.9 * acc + 0.1 * U.clamp(comboRatio, 0, 1)));
    var noBad = this.counts.miss === 0 && this.counts.break === 0 && this.counts.mineHit === 0;
    var fc = noBad;
    var ap = noBad && this.counts.good === 0 && this.counts.great === 0;
    var clear = !this.failed && (this.finished || this.time > 0);
    var stars = 0;
    if (clear) {
      var clean = this.counts.mineHit === 0;
      if (ap || (acc >= 0.97 && clean)) stars = 3;
      else if (acc >= 0.90 && clean) stars = 2;
      else stars = 1;
    }
    return {
      score: score, acc: acc, grade: grade(acc, this.failed), maxCombo: this.maxCombo,
      counts: U.deepClone(this.counts), life: this.life, failed: this.failed, finished: this.finished,
      clear: clear, fc: fc, ap: ap, stars: stars, autoplay: this.autoplay,
      totalNotes: this.playable, mines: this.notes.length - this.playable,
      avgOffset: this.avgOffset(), early: this.earlyN, late: this.lateN,
      duration: this.chart.meta.length || this.time, songId: this.chart.meta.songId,
      chartId: this.chart.meta.id,
      ranked: this.ranked, judgeDifficulty: this.settings.judgeDifficulty || 'normal'
    };
  };

  /** HUD 用快照 */
  Engine.prototype.snapshot = function () {
    return {
      time: this.time, combo: this.combo, maxCombo: this.maxCombo, score: this.result().score,
      acc: this.accuracy(), life: this.life, counts: this.counts, last: this._lastJudge,
      progress: this.progress(), finished: this.finished, failed: this.failed,
      autoplay: this.autoplay
    };
  };

  RG.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);

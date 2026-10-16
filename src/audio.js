/* ==========================================================================
 * Resonance Engine · audio.js
 *   RG.Music  —— 纯逻辑：由「乐曲定义」程序化生成音符事件（可在 Node 中测试）
 *   RG.Audio   —— 浏览器端：WebAudio 合成播放、音效、频谱分析、时钟
 * 设计：整首曲子由 seed 决定且完全确定，因此可任意 seek / 重播 / 交给编辑器。
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  /* ======================================================================
   * 1. 音乐生成器（纯函数，无副作用）
   * ====================================================================== */
  var STYLES = {
    synthwave: { bpm: [104, 126], drum: 'four', bass: 'pulse8', lead: 'arp16', pad: 'saw', hatDiv: 2, swing: 0 },
    chiptune: { bpm: [132, 166], drum: 'rock', bass: 'offbeat', lead: 'melody8', pad: 'square', hatDiv: 2, swing: 0 },
    pop: { bpm: [112, 142], drum: 'rock', bass: 'root8', lead: 'melody8', pad: 'pad', hatDiv: 2, swing: 0 },
    dnb: { bpm: [168, 178], drum: 'break', bass: 'sub', lead: 'stab', pad: 'pad', hatDiv: 4, swing: 0 },
    hardcore: { bpm: [178, 216], drum: 'four', bass: 'pulse16', lead: 'stab', pad: 'saw', hatDiv: 4, swing: 0 },
    ambient: { bpm: [72, 98], drum: 'sparse', bass: 'long', lead: 'sparse', pad: 'pad', hatDiv: 1, swing: 0 }
  };

  var PROGS = {
    minor: [
      [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']],     // i - VI - III - VII
      [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']],     // i - VII - VI - V
      [[0, 'min'], [5, 'min'], [3, 'maj'], [10, 'maj']],     // i - iv - III - VII
      [[0, 'min'], [3, 'maj'], [8, 'maj'], [7, 'min']],      // i - III - VI - v
      [[0, 'min'], [8, 'maj'], [10, 'maj'], [7, 'min']]      // i - VI - VII - v
    ],
    major: [
      [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],      // I - V - vi - IV
      [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],      // vi - IV - I - V
      [[0, 'maj'], [5, 'maj'], [7, 'maj'], [9, 'min']],
      [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']]
    ]
  };
  var SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    penta: [0, 3, 5, 7, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11]
  };
  var QUALITY = {
    min: [0, 3, 7], maj: [0, 4, 7], min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    sus4: [0, 5, 7], dim: [0, 3, 6], pow: [0, 7, 12]
  };
  function chordTones(rootMidi, quality, octave) {
    var iv = QUALITY[quality] || QUALITY.min;
    var o = (octave || 0) * 12;
    return iv.map(function (s) { return rootMidi + s + o; });
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /** 默认段落结构：intro 8 · verse 16 · chorus 16 · bridge 8 · chorus 16 · outro 8 */
  function defaultPlan(totalBars) {
    var plan = [
      { name: 'intro', intensity: 0, bars: 8 },
      { name: 'verse', intensity: 1, bars: 16 },
      { name: 'chorus', intensity: 2, bars: 16 },
      { name: 'bridge', intensity: 1, bars: 8 },
      { name: 'chorus', intensity: 3, bars: 16 },
      { name: 'outro', intensity: 0, bars: 8 }
    ];
    if (totalBars && Math.abs(totalBars - 72) > 6) {
      var scale = totalBars / 72;
      plan.forEach(function (s) { s.bars = Math.max(2, Math.round(s.bars * scale)); });
    }
    return plan;
  }

  function build(musicDef) {
    musicDef = musicDef || {};
    var styleName = STYLES[musicDef.style] ? musicDef.style : 'synthwave';
    var style = STYLES[styleName];
    var rng = U.rng(musicDef.seed === undefined ? styleName : musicDef.seed);
    var bpm = musicDef.bpm || Math.round(rng.range(style.bpm[0], style.bpm[1]));
    var beatDur = 60 / bpm, barDur = beatDur * 4;
    var scaleName = musicDef.scale || 'minor';
    var scale = SCALES[scaleName] || SCALES.minor;
    var rootMidi = musicDef.rootMidi || 45; // A2
    var progPool = PROGS[scaleName === 'major' ? 'major' : 'minor'];
    var progVerse = musicDef.progVerse ? PROGS.minor[musicDef.progVerse % PROGS.minor.length] : rng.pick(progPool);
    var progChorus = musicDef.progChorus ? PROGS.minor[musicDef.progChorus % PROGS.minor.length] : rng.pick(progPool);
    var plan = musicDef.sections || defaultPlan(musicDef.bars);

    var events = [], beats = [], barTimes = [], sections = [];
    var t = 0, barIndex = 0;
    var leadDeg = 0;

    function ev(type, time, dur, freq, gain, extra) {
      var e = { t: Math.max(0, time), d: dur, f: freq, type: type, g: gain === undefined ? 1 : gain };
      if (extra) for (var k in extra) e[k] = extra[k];
      events.push(e);
      return e;
    }

    for (var si = 0; si < plan.length; si++) {
      var sec = plan[si];
      var secStart = t;
      var secEnd = t + sec.bars * barDur;
      var inten = U.clamp(sec.intensity | 0, 0, 3);
      if (inten >= 2) ev('crash', secStart, 0.9, 6000, inten === 3 ? 0.5 : 0.35);
      if (inten >= 2 && sec.name === 'chorus') ev('riser', secStart - barDur * 0.5, barDur * 0.5, 200, 0.32);

      for (var b = 0; b < sec.bars; b++) {
        var bt = secStart + b * barDur;
        var pick = (inten >= 2 ? progChorus : progVerse);
        var ch = pick[b % pick.length];
        var chordRoot = rootMidi + ch[0];
        var quality = ch[1];
        if (inten >= 2 && quality === 'min' && rng.chance(0.35)) quality = 'min7';
        if (inten >= 2 && quality === 'maj' && rng.chance(0.3)) quality = 'maj7';
        barTimes.push(bt);
        for (var q = 0; q < 4; q++) {
          var nbt = bt + q * beatDur;
          beats.push(nbt);
          if (inten >= 3 && q !== 3) { beats.push(nbt + beatDur * 0.5); }
        }

        /* ---- 鼓组 ---- */
        var drum = style.drum;
        var kickAt = [], snareAt = [];
        if (drum === 'four') {
          kickAt = [0, 1, 2, 3];
          snareAt = [1, 3];
        } else if (drum === 'rock') {
          kickAt = [0, 2, 2.5];
          if (rng.chance(0.3)) kickAt.push(3.5);
          snareAt = [1, 3];
        } else if (drum === 'break') {
          kickAt = [0, 2.5];
          if (rng.chance(0.5)) kickAt.push(1.75);
          snareAt = [1, 3];
        } else {
          kickAt = [0]; snareAt = inten >= 1 ? [2] : [];
        }
        if (inten === 0) { kickAt = []; snareAt = []; }
        if (inten === 1) { kickAt = kickAt.slice(0, Math.max(1, Math.ceil(kickAt.length / 2))); snareAt = []; }
        var lastBar = (b === sec.bars - 1);
        kickAt.forEach(function (k) { ev('kick', bt + k * beatDur, 0.26, 120, 0.95); });
        snareAt.forEach(function (k) { ev('snare', bt + k * beatDur, 0.2, 190, inten >= 2 ? 0.75 : 0.5); });
        if (lastBar && inten >= 2) { // 段落收尾过门
          for (var f = 0; f < 4; f++) ev('snare', bt + 3 * beatDur + f * beatDur / 4, 0.12, 260, 0.4 + f * 0.12);
        }
        if (inten >= 1) {
          var hd = style.hatDiv; // 每拍细分
          for (var h = 0; h < 4 * hd; h++) {
            var ht = bt + h * beatDur / hd;
            var open = (hd <= 2 && h % 4 === 2);
            if (inten === 1 && h % 2 === 1) continue;
            ev(open ? 'ohat' : 'hat', ht, open ? 0.16 : 0.05, 8000, (h % hd === 0 ? 0.34 : 0.2) * (inten >= 3 ? 1.05 : 1));
          }
        }

        /* ---- 和声垫 ---- */
        if (style.pad !== 'none' && (inten >= 1 || sec.name === 'intro' || sec.name === 'outro')) {
          var padTones = chordTones(chordRoot, quality, 1);
          var padDur = (inten >= 2 ? barDur : barDur * 1.95);
          padTones.forEach(function (m, i) {
            ev('pad', bt, padDur, mtof(m), (inten >= 2 ? 0.14 : 0.09) * (1 - i * 0.08), { wave: style.pad });
          });
        }

        /* ---- 贝斯 ---- */
        if (inten >= 1) {
          var bassNote = chordRoot - 12;
          var bp = style.bass;
          if (bp === 'pulse8') {
            for (var k8 = 0; k8 < 8; k8++) {
              var f8 = (k8 % 4 === 3 && rng.chance(0.35)) ? bassNote + 7 : bassNote;
              ev('bass', bt + k8 * beatDur / 2, beatDur * 0.42, mtof(f8), k8 % 2 === 0 ? 0.5 : 0.34);
            }
          } else if (bp === 'offbeat') {
            for (var k9 = 0; k9 < 4; k9++) ev('bass', bt + k9 * beatDur + beatDur / 2, beatDur * 0.4, mtof(bassNote), 0.46);
          } else if (bp === 'sub') {
            ev('bass', bt, barDur * 0.85, mtof(bassNote - 12), 0.6, { sub: true });
            if (rng.chance(0.4)) ev('bass', bt + 3 * beatDur, beatDur * 0.5, mtof(bassNote), 0.34);
          } else if (bp === 'long') {
            if (b % 2 === 0) ev('bass', bt, barDur * 1.8, mtof(bassNote), 0.42);
          } else if (bp === 'pulse16') {
            for (var k16 = 0; k16 < 16; k16++) ev('bass', bt + k16 * beatDur / 4, beatDur * 0.2, mtof(bassNote), k16 % 4 === 0 ? 0.5 : 0.3);
          } else { // root8
            for (var k7 = 0; k7 < 4; k7++) ev('bass', bt + k7 * beatDur, beatDur * 0.7, mtof(k7 === 3 ? bassNote + 5 : bassNote), 0.45);
          }
        }

        /* ---- 主旋律 / 琶音 ---- */
        var lp = style.lead;
        var scaleNote = function (deg) {
          var oct = Math.floor(deg / scale.length), idx = ((deg % scale.length) + scale.length) % scale.length;
          return rootMidi + 24 + scale[idx] + oct * 12;
        };
        if (inten >= 2 && lp === 'arp16') {
          var tones = chordTones(chordRoot, quality, 2);
          for (var a = 0; a < 16; a++) {
            if (rng.chance(0.08)) continue;
            var pat = [0, 1, 2, 1, 2, 3 % tones.length, 2, 1];
            var note = tones[pat[a % pat.length] % tones.length] + (a >= 8 ? 12 : 0);
            ev('lead', bt + a * beatDur / 4, beatDur * 0.22, mtof(note), a % 4 === 0 ? 0.3 : 0.2);
          }
        } else if (inten >= 2 && lp === 'melody8') {
          var rhythm = [[1, 0, 1, 1, 0, 1, 1, 0], [1, 1, 0, 1, 0, 1, 0, 1], [1, 0, 0, 1, 1, 0, 1, 1]][(b + si) % 3];
          for (var m8 = 0; m8 < 8; m8++) {
            if (!rhythm[m8]) continue;
            if (rng.chance(0.22)) leadDeg += rng.int(-2, 2);
            ev('lead', bt + m8 * beatDur / 2, beatDur * 0.44, mtof(scaleNote(leadDeg)), m8 % 2 === 0 ? 0.3 : 0.22);
          }
        } else if (inten >= 2 && lp === 'stab') {
          var st = [0.5, 1.5, 2, 3.5];
          st.forEach(function (s, i) {
            if (rng.chance(0.15) && i > 0) return;
            chordTones(chordRoot, quality, 1).forEach(function (m) {
              ev('lead', bt + s * beatDur, beatDur * 0.18, mtof(m), 0.17);
            });
          });
        } else if (lp === 'sparse' || inten <= 1) {
          if (inten >= 1 && rng.chance(0.7)) {
            if (rng.chance(0.5)) leadDeg += rng.int(-1, 2);
            ev('lead', bt + (rng.chance(0.5) ? beatDur * 2 : 0), beatDur * 1.4, mtof(scaleNote(leadDeg)), 0.16);
          }
        }
        /* 高频点缀 */
        if (inten >= 3 && rng.chance(0.3)) {
          ev('spark', bt + rng.pick([beatDur * 1.5, beatDur * 2.5, beatDur * 3.5]), 0.3, mtof(scaleNote(leadDeg + 7) + 12), 0.12);
        }
      }
      sections.push({ name: sec.name, start: secStart, end: secEnd, intensity: inten });
      t = secEnd;
      barIndex += sec.bars;
    }

    events.sort(function (a, b) { return a.t - b.t || (a.type < b.type ? -1 : 1); });
    beats = beats.filter(function (v, i) { return i === 0 || v > beats[i - 1] + 1e-6; });

    return {
      style: styleName, bpm: bpm, beatDur: beatDur, barDur: barDur, rootMidi: rootMidi,
      scale: scaleName, scaleSteps: scale, duration: t, events: events, beats: beats,
      barTimes: barTimes, sections: sections,
      on: function (types) {
        var set = {}; (Array.isArray(types) ? types : [types]).forEach(function (x) { set[x] = 1; });
        return events.filter(function (e) { return set[e.type]; });
      }
    };
  }

  RG.Music = { build: build, STYLES: STYLES, PROGS: PROGS, SCALES: SCALES, mtof: mtof, chordTones: chordTones };

  /* ======================================================================
   * 2. 浏览器音频引擎
   * ====================================================================== */
  function Audio() {
    this.ctx = null;
    this.song = null;
    this._cache = {};
    this._playing = false;
    this._idx = 0;
    this._startCtx = 0;
    this._startSong = 0;
    this._timer = null;
    this._noiseBuf = null;
    this._musicVol = 0.8;
    this._sfxVol = 0.6;
    this._unlocked = false;
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) return this.ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    var ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    var master = this.master = ctx.createGain();
    master.gain.value = 0.9;
    var analyser = this.analyser = ctx.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.72;
    this.bands = new Uint8Array(analyser.frequencyBinCount);
    master.connect(analyser);
    analyser.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this._musicVol;
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this._sfxVol;
    this.musicBus.connect(master); this.sfxBus.connect(master);
    // 白噪声缓冲（打击乐/上升音）
    var len = Math.floor(ctx.sampleRate * 1.2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return ctx;
  };
  Audio.prototype.unlock = function () {
    var ctx = this.ensure();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    if (!this._unlocked) {
      // 静音脉冲，规避部分浏览器的自动播放限制
      var o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.02);
      this._unlocked = true;
    }
    return true;
  };
  Audio.prototype.setVolumes = function (music, sfx) {
    this._musicVol = music; this._sfxVol = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
  };

  /** 生成（带缓存）并返回乐曲事件表 */
  Audio.prototype.load = function (musicDef, cacheKey) {
    var key = cacheKey || ('seed:' + musicDef.seed + '|' + musicDef.style + '|' + (musicDef.bars || ''));
    if (!this._cache[key]) this._cache[key] = RG.Music.build(musicDef);
    this.song = this._cache[key];
    return this.song;
  };
  Audio.prototype.songData = function () { return this.song; };
  Audio.prototype.duration = function () { return this.song ? this.song.duration : 0; };

  Audio.prototype.now = function () {
    if (!this.ctx) return 0;
    if (!this._playing) return this._startSong;
    return this._startSong + (this.ctx.currentTime - this._startCtx);
  };
  Audio.prototype.isPlaying = function () { return !!this._playing; };

  Audio.prototype.play = function (fromTime) {
    var ctx = this.ensure();
    if (!ctx || !this.song) return false;
    if (fromTime !== undefined) this._startSong = Math.max(0, fromTime);
    this._startCtx = ctx.currentTime;
    this._idx = U.lowerBound(this.song.events, this._startSong);
    if (this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setValueAtTime(this._musicVol, ctx.currentTime);
    }
    this._playing = true;
    if (ctx.state === 'suspended') ctx.resume();
    var self = this;
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(function () { self._pump(); }, 25);
    this._pump();
    return true;
  };
  Audio.prototype._pump = function () {
    if (!this._playing || !this.ctx || !this.song) return;
    var ctx = this.ctx;
    var now = this.now();
    var limit = now + 0.2;
    var evs = this.song.events;
    while (this._idx < evs.length && evs[this._idx].t <= limit) {
      var e = evs[this._idx++];
      var when = ctx.currentTime + Math.max(0, e.t - now);
      this._voice(e, when, this.musicBus);
    }
    if (now >= this.song.duration + 0.35) this._playing = false;
  };
  Audio.prototype.pause = function () {
    if (this._startSong !== undefined && this.ctx && this._playing) this._startSong = this.now();
    this._playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.ctx && this.ctx.state === 'running') { try { this.ctx.suspend(); } catch (e) { } }
  };
  Audio.prototype.resume = function () {
    if (!this.ctx || !this.song) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.play(this._startSong);
  };
  Audio.prototype.stop = function () {
    this._playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.ctx) {
      // 快速淡出，清掉已排程的音符
      try {
        var g = this.musicBus.gain, t0 = this.ctx.currentTime;
        g.cancelScheduledValues(t0);
        g.setValueAtTime(g.value, t0);
        g.linearRampToValueAtTime(0.0001, t0 + 0.03);
        g.setValueAtTime(this._musicVol, t0 + 0.06);
      } catch (e) { }
    }
    this._startSong = 0; this._idx = 0;
  };
  Audio.prototype.seek = function (t) {
    if (!this.ctx || !this.song) return;
    var playing = this._playing;
    if (playing) this.stop();
    this._startSong = U.clamp(t, 0, this.song.duration);
    this._idx = U.lowerBound(this.song.events, this._startSong);
    if (playing) this.play(this._startSong);
    else this._startCtx = this.ctx.currentTime;
  };

  /* ---------------- 音色合成 ---------------- */
  Audio.prototype._noise = function (when, dur, dest, gain) {
    var ctx = this.ctx, s = ctx.createBufferSource();
    s.buffer = this._noiseBuf; s.loop = true;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(g); g.connect(dest);
    s.start(when); s.stop(when + dur + 0.02);
    return { src: s, gain: g };
  };
  Audio.prototype._voice = function (e, when, dest) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = when, d = Math.max(0.02, e.d), g = (e.g === undefined ? 1 : e.g);
    var osc, gain, filt;
    switch (e.type) {
      case 'kick':
        osc = ctx.createOscillator(); gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(44, t + 0.1);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(g * 0.9, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + d + 0.05);
        break;
      case 'snare': {
        var n = this._noise(t, d, dest, g * 0.5);
        filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 1900; filt.Q.value = 0.8;
        n.src.disconnect(); n.src.connect(filt); filt.connect(n.gain);
        osc = ctx.createOscillator(); var g2 = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(e.f || 190, t);
        g2.gain.setValueAtTime(g * 0.35, t);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.6);
        osc.connect(g2); g2.connect(dest); osc.start(t); osc.stop(t + d + 0.02);
        break;
      }
      case 'hat': case 'ohat': case 'crash': {
        var n2 = this._noise(t, d, dest, g * (e.type === 'crash' ? 0.5 : 0.35));
        filt = ctx.createBiquadFilter();
        filt.type = 'highpass';
        filt.frequency.value = e.type === 'crash' ? 4200 : (e.type === 'ohat' ? 6500 : 8200);
        n2.src.disconnect(); n2.src.connect(filt); filt.connect(n2.gain);
        break;
      }
      case 'riser': {
        var n3 = this._noise(t, d, dest, 0.0001);
        filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.Q.value = 4;
        filt.frequency.setValueAtTime(300, t);
        filt.frequency.exponentialRampToValueAtTime(7000, t + d);
        n3.gain.gain.cancelScheduledValues(t);
        n3.gain.gain.setValueAtTime(0.0001, t);
        n3.gain.gain.linearRampToValueAtTime(g, t + d * 0.85);
        n3.gain.gain.linearRampToValueAtTime(0.0001, t + d);
        n3.src.disconnect(); n3.src.connect(filt); filt.connect(n3.gain);
        break;
      }
      case 'bass': {
        osc = ctx.createOscillator(); gain = ctx.createGain(); filt = ctx.createBiquadFilter();
        osc.type = e.sub ? 'sine' : 'sawtooth';
        osc.frequency.value = e.f;
        filt.type = 'lowpass'; filt.Q.value = 6;
        filt.frequency.setValueAtTime(e.sub ? 220 : 500, t);
        filt.frequency.exponentialRampToValueAtTime(e.sub ? 120 : 260, t + d);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(g * 0.5, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(filt); filt.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + d + 0.03);
        break;
      }
      case 'pad': {
        gain = ctx.createGain(); filt = ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.frequency.value = 1500; filt.Q.value = 0.6;
        var atk = Math.min(0.35, d * 0.28), rel = Math.min(0.5, d * 0.4);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(g * 0.3, t + atk);
        gain.gain.setValueAtTime(g * 0.3, t + Math.max(atk, d - rel));
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        filt.connect(gain); gain.connect(dest);
        for (var i = 0; i < 3; i++) {
          var o2 = ctx.createOscillator();
          o2.type = e.wave === 'square' ? 'square' : 'sawtooth';
          o2.frequency.value = e.f * (1 + (i - 1) * 0.0016);
          o2.detune.value = (i - 1) * 7;
          o2.connect(filt); o2.start(t); o2.stop(t + d + 0.05);
        }
        break;
      }
      case 'lead': {
        osc = ctx.createOscillator(); gain = ctx.createGain(); filt = ctx.createBiquadFilter();
        osc.type = 'square';
        osc.frequency.value = e.f;
        filt.type = 'lowpass'; filt.frequency.value = 5200; filt.Q.value = 1.2;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(g * 0.28, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(filt); filt.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + d + 0.03);
        var osc3 = ctx.createOscillator(); osc3.type = 'triangle';
        osc3.frequency.value = e.f; osc3.detune.value = 8;
        var g3 = ctx.createGain(); g3.gain.value = 0.5;
        osc3.connect(g3); g3.connect(gain);
        osc3.start(t); osc3.stop(t + d + 0.03);
        break;
      }
      case 'spark': {
        osc = ctx.createOscillator(); gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(e.f, t);
        osc.frequency.exponentialRampToValueAtTime(e.f * 1.5, t + d);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(g * 0.3, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(gain); gain.connect(dest);
        osc.start(t); osc.stop(t + d + 0.03);
        break;
      }
    }
  };

  /* ---------------- 打击音效 ---------------- */
  Audio.prototype.hit = function (kind, strength) {
    if (!this.ctx || this._sfxVol <= 0.001) return;
    var ctx = this.ctx, t = ctx.currentTime + 0.001;
    var conf = {
      perfect: { f: 1500, f2: 2400, d: 0.09, type: 'triangle', g: 0.4 },
      great: { f: 1100, f2: 1500, d: 0.08, type: 'triangle', g: 0.33 },
      good: { f: 760, f2: 900, d: 0.07, type: 'sine', g: 0.28 },
      miss: { f: 150, f2: 90, d: 0.14, type: 'sawtooth', g: 0.22 },
      mine: { f: 300, f2: 60, d: 0.3, type: 'square', g: 0.3 },
      tick: { f: 1800, f2: 1200, d: 0.03, type: 'sine', g: 0.15 }
    }[kind] || { f: 1000, f2: 1200, d: 0.05, type: 'sine', g: 0.2 };
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = conf.type;
    o.frequency.setValueAtTime(conf.f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, conf.f2), t + conf.d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(conf.g * (strength === undefined ? 1 : strength), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + conf.d);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + conf.d + 0.02);
  };
  Audio.prototype.ui = function (kind) {
    if (!this.ctx || this._sfxVol <= 0.001) return;
    var ctx = this.ctx, t = ctx.currentTime + 0.001;
    var f = kind === 'back' ? 420 : (kind === 'confirm' ? 900 : 700);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (kind === 'back' ? 0.6 : 1.7), t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  };
  Audio.prototype.metro = function (accent) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime + 0.001;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1800 : 1200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.2 : 0.12, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.08);
  };

  /* ---------------- 频谱 ---------------- */
  Audio.prototype.getBands = function (n) {
    n = n || 24;
    var out = new Array(n);
    if (!this.analyser) { for (var i0 = 0; i0 < n; i0++) out[i0] = 0; return out; }
    this.analyser.getByteFrequencyData(this.bands);
    var bins = this.bands.length;
    for (var i = 0; i < n; i++) {
      // 对数分频，低频分辨率更高
      var a = Math.floor(Math.pow(i / n, 1.6) * bins * 0.85);
      var b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * bins * 0.85));
      var s = 0, c = 0;
      for (var k = a; k < b && k < bins; k++) { s += this.bands[k]; c++; }
      out[i] = c ? (s / c) / 255 : 0;
    }
    return out;
  };
  Audio.prototype.getLevel = function () {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.bands);
    var s = 0;
    for (var i = 0; i < this.bands.length; i += 4) s += this.bands[i];
    return (s / (this.bands.length / 4)) / 255;
  };

  RG.Audio = Audio;
  RG.audio = new Audio();
})(typeof window !== 'undefined' ? window : globalThis);

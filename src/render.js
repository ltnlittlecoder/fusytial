/* ==========================================================================
 * Resonance Engine · render.js
 * 渲染层：2D 下落轨道 / 3D 透视高速公路，共用特效系统
 *   - 3D 为真实透视投影（相机+投影+画家算法），只是用 Canvas2D 绘制多边形
 *   - 支持霓虹/极简/实心三种皮肤、音频频谱联动背景、粒子与判定弹字
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  function Renderer(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.settings = opts.settings || (RG.Store && RG.Store.settings()) || {};
    /* 视角由谱面内嵌的切换环节驱动：blend 0 = 2D 下落轨道，1 = 3D 透视高速公路 */
    this.view = { blend: 0, from: 0, to: 0, target: 0, dur: 0.8, t: 0 };
    this.mode = '2d';
    /* 切换视角后，原来那套轨道与音符还会继续画并慢慢淡出（3 秒后完全消失） */
    this.linger = null;
    this._was3d = false;
    this.theme = { a: '#38e8ff', b: '#ff4fd8' };
    this.w = 0; this.h = 0; this.cx = 0; this.cy = 0; this.focal = 0;
    this.laneW = 0; this.fieldX = 0; this.fieldW = 0; this.judgeY = 0;
    this.fx = []; this.popups = []; this.p2 = []; this.p3 = []; this.slashes = [];
    this.beams = {};
    this.time = 0; this.bgT = 0; this.beatPulse = 0; this.hitFlash = 0;
    this.bands = []; this.lanes = 4; this.fps = 60;
    this.music = null;
    /* 3D 动效状态：震动 / 倾斜(roll) / 摇头(yaw) / 呼吸(bob) / 机位俯冲(dive) / 轨道冲量 */
    this.dyn = {
      shake: 0, shakeX: 0, shakeY: 0, roll: 0, lean: 0, yaw: 0, bob: 0, bobTarget: 0,
      dive: 0, lane: [], flash: 0, streak: 0, rollNoise: 0
    };
    this._starField = null;
    this.resize();
  }
  RG.Render = Renderer;

  /* ---------------- 基础 ---------------- */
  Renderer.prototype.resize = function () {
    var s = U.canvasSize(this.canvas, 2);
    this.ctx = s.ctx; this.w = s.w; this.h = s.h; this.dpr = s.dpr;
    this.lanes = this.lanes || 4;
    this._layout();
    if (this._starField) this._starField = null;
    return s;
  };
  Renderer.prototype.setLanes = function (n) { this.lanes = n; this._layout(); };
  Renderer.prototype.setTheme = function (t) { if (t) this.theme = { a: t.a || '#38e8ff', b: t.b || '#ff4fd8' }; };

  /** 由谱面切换环节调用：mode = '2d' | '3d'，dur = 过渡秒数 */
  Renderer.prototype.setView = function (mode, dur, instant) {
    var target = mode === '3d' ? 1 : 0;
    if (instant) {
      this.view.blend = this.view.target = this.view.to = target;
      this.view.from = target; this.view.t = 0; this.view.dur = 0.001;
      this.dyn.dive = 0; this.dyn.flash = 0; this.dyn.streak = 0;
      this.linger = null;                       // 直接切：不需要残留淡出
      this._was3d = target >= 0.5;
    } else if (target !== this.view.target) {
      /* 切换：把「原来那套轨道与音符」记下来，接下来 3 秒慢慢淡出 */
      var was3d = this.view.blend >= 0.5;
      this.linger = { is3d: was3d, t: 0, total: LINGER_TIME };
      this._was3d = target >= 0.5;
      this.view.from = this.view.blend;
      this.view.to = target;
      this.view.target = target;
      this.view.dur = Math.max(0.15, dur || 0.8);
      this.view.t = 0;
      this.dyn.flash = 1;
      this.dyn.streak = 1;
      this.dyn.dive = target ? 2.4 : -1.1;      // 切到 3D 时机位从远处俯冲进来
      this.beatPulse = 1;
    }
    this.mode = this.view.target >= 0.5 ? '3d' : '2d';
    return this;
  };
  Renderer.prototype.viewMode = function () { return this.view.blend >= 0.5 ? '3d' : '2d'; };
  Renderer.prototype.isTransitioning = function () {
    return Math.abs(this.view.blend - this.view.target) > 0.002;
  };

  var MULT = null;
  /* 切换视角后旧画面残留淡出时长（秒） */
  var LINGER_TIME = 3.0;

  Renderer.prototype._layout = function () {
    var s = this.settings;
    var maxFieldW = Math.min(this.w * 0.88, 940);
    this.laneW = Math.min(maxFieldW / this.lanes, 156);
    this.fieldW = this.laneW * this.lanes;
    this.fieldX = (this.w - this.fieldW) / 2;
    this.judgeY = this.h * (s.judgeLine || 0.82);
    this.cx = this.w / 2;
    /* 3D 相机参数：完全内置（不再暴露成设置）。
       设置里若显式带有 camera（只有布局报告/测试会这样注入）才用它，方便离线调参。 */
    var CAM = (RG.Store && RG.Store.CAMERA) ||
      { fov: 72, pitch: 48, height: 2.1, dist: 2.4, width: 4.2, speed: 0.8, curve: 0 };
    var cam = s.camera || CAM;
    var fov = cam.fov === undefined ? CAM.fov : cam.fov;
    this.focal = (this.h * 0.5) / Math.tan((fov * Math.PI / 180) / 2);
    var camH = cam.height === undefined ? CAM.height : cam.height;
    var camD = Math.max(0.6, cam.dist === undefined ? CAM.dist : cam.dist);
    /* 俯角：把相机绕横轴向下转 pitch 度（0 = 平视机位，越大越俯视） */
    var pitchDeg = U.clamp(cam.pitch === undefined ? CAM.pitch : cam.pitch, 0, 72);
    this.pitch = pitchDeg * Math.PI / 180;
    this.sinP = Math.sin(this.pitch);
    this.cosP = Math.cos(this.pitch);
    this.tanP = Math.tan(this.pitch);
    /* 视野（FOV）+ 机位 + 俯角决定画面上的一切；反向推出投影中心 cy，
       使判定面恰好落在「判定线位置」设定处 —— 任何参数下判定线都不漂移 */
    var yc0 = camD * this.sinP - camH * this.cosP;
    var zc0 = Math.max(0.25, camD * this.cosP + camH * this.sinP);
    this.judgeZ = zc0;
    this.cy = this.judgeY + (this.focal * yc0) / zc0;
    /* 路面消失点（z → ∞）的高度，用于地平线上方的裁剪与远景光晕 */
    this.horizonY = this.cy - this.focal * this.tanP;
    this.cam = {
      fov: fov, pitch: pitchDeg, height: camH, dist: camD,
      width: cam.width === undefined ? CAM.width : cam.width,
      speed: cam.speed === undefined ? CAM.speed : cam.speed,
      curve: cam.curve === undefined ? CAM.curve : cam.curve
    };
    this.worldFar = 60;
    this.laneWU = this.cam.width / this.lanes;
  };
  Renderer.prototype.approachTime = function () {
    var sp = this.settings.scrollSpeed || 6;
    return U.clamp(2.15 - sp * 0.125, 0.42, 2.2);
  };
  Renderer.prototype._zSpeed = function () {
    /* 3D 速度系数（内置，默认 0.8）：数值越小，音符在 3D 路面上的推进越慢 */
    var k = (this.cam && this.cam.speed) || 1;
    return (this.worldFar / this.approachTime()) * k;
  };

  /** 3D 透视投影：含相机俯角（pitch）/ roll（倾斜）/ yaw（摇头）/ bob（呼吸）/ shake（震动）/ dive（俯冲） */
  Renderer.prototype._project = function (x, y, z) {
    var cam = this.cam, d = this.dyn;
    var dz = z + Math.max(0.6, cam.dist) + d.dive;
    if (dz < 0.25) return null;
    var f = this.focal;
    var vx = x + (cam.curve ? cam.curve * Math.sin(z * 0.055) * 1.3 : 0);
    var vy = y - cam.height;
    /* 俯角：绕相机横轴旋转（pitch = 0 时就是原来的平视机位） */
    var zc = dz * this.cosP - vy * this.sinP;
    var yc = dz * this.sinP + vy * this.cosP;
    if (zc < 0.25) return null;
    var roll = d.roll, yaw = d.yaw;
    if (roll) {                       // 绕相机视线轴旋转 → 整个高速公路倾斜
      var cr = Math.cos(roll), sr = Math.sin(roll);
      var rx = vx * cr - yc * sr;
      yc = vx * sr + yc * cr;
      vx = rx;
    }
    if (yaw) {                        // 绕相机上轴旋转 → 路面左右摆动
      var cyw = Math.cos(yaw), syw = Math.sin(yaw);
      var rx2 = vx * cyw + zc * syw;
      zc = -vx * syw + zc * cyw;
      vx = rx2;
      if (zc < 0.25) return null;
    }
    return {
      x: this.cx + d.shakeX + (vx * f) / zc,
      y: this.cy + d.bob + d.shakeY - (yc * f) / zc,
      s: f / zc, z: z
    };
  };

  /** 指针 → 轨道（两种模式都支持；3D 用「投影后最接近的轨道中心」反查，天然兼容倾斜/震动） */
  Renderer.prototype.laneAt = function (px, py) {
    if (this.view.blend < 0.5) {
      if (px < this.fieldX || px > this.fieldX + this.fieldW) return -1;
      return U.clamp(Math.floor((px - this.fieldX) / this.laneW), 0, this.lanes - 1);
    }
    if (py < this.horizonY + this.dyn.bob - this.h * 0.02) return -1;   // 地平线以上不接受
    var half = this.lanes / 2;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < this.lanes; i++) {
      var p = this._project((i + 0.5 - half) * this.laneWU, 0, 0.04);
      if (!p) continue;
      var dd = Math.abs(p.x - px) * 0.8 + Math.abs(p.y - py) * 0.2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best < 0) return -1;
    /* 判定面处相邻轨道的实际投影间距（自动适配俯角/机位/FOV，不用估算公式） */
    var pa = this._project(-half * this.laneWU, 0, 0.04), pb = this._project((-half + 1) * this.laneWU, 0, 0.04);
    var lanePx = (pa && pb) ? Math.abs(pb.x - pa.x) : (this.laneWU * this.focal) / Math.max(0.6, this.cam.dist + this.dyn.dive);
    if (bestD > lanePx * 2.4) return -1;                          // 离判定面太远，视为未命中轨道
    return best;
  };

  /* ---------------- 特效接口 ---------------- */
  var JCOLOR = { perfect: '#8ef7ff', great: '#5cff9d', good: '#ffd35c', miss: '#ff5c6e', break: '#ff9d5c', mine: '#ff5c6e', avoid: '#8f9ac4' };
  var JTEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS', break: 'BREAK', mine: 'MINE!', avoid: '' };

  /** 点划完成时的方向感特效：沿滑动方向的白色划痕 + 粒子 + 轨道冲量 */
  Renderer.prototype.swipe = function (lane, dx, dy, judged) {
    var s = this.settings;
    if ((s.effects || 'high') === 'off') return;
    var laneW = this.view.blend < 0.5 ? this.laneW : (this.laneWU * this.focal) / Math.max(0.6, this.cam.dist + this.dyn.dive);
    var cx = this.view.blend < 0.5
      ? this.fieldX + (lane + 0.5) * this.laneW
      : (this._project((lane + 0.5 - this.lanes / 2) * this.laneWU, 0.04, 0) || { x: this.cx, y: this.judgeY }).x;
    var cy = this.view.blend < 0.5 ? this.judgeY : (this._project((lane + 0.5 - this.lanes / 2) * this.laneWU, 0.04, 0) || { x: this.cx, y: this.judgeY }).y;
    /* 方向：优先用真实滑动方向；键盘（无方向）默认向上 */
    var len = Math.sqrt(dx * dx + dy * dy);
    var ux = 0, uy = -1;
    if (len > 0.5) { ux = dx / len; uy = dy / len; }
    this.slashes.push({
      x: cx, y: cy, ux: ux, uy: uy, w: Math.max(26, laneW * 0.9),
      len: Math.max(46, laneW * 1.5), life: 0.34, max: 0.34, judged: !!judged
    });
    var n = judged ? 9 : 4;
    for (var i = 0; i < n; i++) {
      var spread = (Math.random() - 0.5) * 1.2;
      var ang = Math.atan2(uy, ux) + spread;
      var sp = (judged ? 260 : 140) * (0.5 + Math.random());
      this.p2.push({
        x: cx + ux * 6, y: cy + uy * 6, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
        life: 0.42, max: 0.42, size: 1.6 + Math.random() * 2.2,
        color: judged ? this.theme.a : '#8f9ac4'
      });
    }
    this.dyn.lane[lane] = Math.min(1.3, (this.dyn.lane[lane] || 0) + (judged ? 0.55 : 0.2));
    if (judged) this.beatPulse = Math.max(this.beatPulse, 0.5);
  };

  Renderer.prototype.judge = function (lane, result, delta) {
    var s = this.settings;
    var eff = s.effects || 'high';
    var d = this.dyn;
    var half = (this.lanes - 1) / 2;
    var side = half ? (lane - half) / half : 0;      // -1(左) .. +1(右)
    if (result === 'avoid') return;
    if (JTEXT[result]) {
      this.popups.push({
        text: JTEXT[result], color: JCOLOR[result] || '#fff', lane: lane, life: 0.65, max: 0.65,
        sub: (s.showEarlyLate && (result === 'perfect' || result === 'great' || result === 'good'))
          ? (delta < -1 ? 'EARLY' : (delta > 1 ? 'LATE' : '')) : ''
      });
    }
    /* 打击驱动的动效（音符落点越靠边，倾斜越明显） */
    if (eff !== 'off') {
      d.lane[lane] = Math.min(1.4, (d.lane[lane] || 0) + (result === 'perfect' ? 0.85 : 0.5));
      if (result === 'mine') {
        d.shake = Math.min(1.6, d.shake + 1.1);
        d.rollNoise = Math.min(1, d.rollNoise + 0.9);
        d.dive = Math.max(d.dive, 0.7);
      } else if (result === 'miss' || result === 'break') {
        d.shake = Math.min(1.6, d.shake + 0.32);
      } else if (result === 'perfect') {
        d.lean += -side * 0.055;                     // 命中左侧则向左倾
        d.yaw += side * 0.012;
      } else {
        d.lean += -side * 0.03;
      }
      if (eff === 'low') { d.shake *= 0.5; d.lean *= 0.5; }
    }
    if (eff === 'off') return;
    if (result === 'miss') { this._burst(lane, '#ff5c6e', 8); return; }
    if (result === 'mine') { this._burst(lane, '#ff5c6e', 34, 1.7); this.hitFlash = 1; return; }
    if (result === 'break') { this._burst(lane, '#ff9d5c', 10); return; }
    this.beams[lane] = 0.3;
    this._burst(lane, JCOLOR[result], result === 'perfect' ? (eff === 'high' ? 14 : 7) : 8);
    this.hitFlash = Math.max(this.hitFlash, result === 'perfect' ? 0.75 : 0.4);
  };
  Renderer.prototype.holdStart = function (lane) { this.beams[lane] = 0.5; this.dyn.lane[lane] = Math.min(1, (this.dyn.lane[lane] || 0) + 0.4); };
  Renderer.prototype.holdEnd = function (lane) {
    this.beams[lane] = 0.25;
    this.dyn.lean += 0.03;
    this.dyn.shake = Math.min(1.2, this.dyn.shake + 0.14);
  };

  Renderer.prototype._burst = function (lane, color, n, scale) {
    var k = scale || 1;
    if (this.mode === '2d') {
      var x = this.fieldX + (lane + 0.5) * this.laneW, y = this.judgeY;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, sp = U.lerp(60, 340, Math.random()) * k;
        this.p2.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75 - 40, life: U.lerp(0.25, 0.6, Math.random()), max: 0.6, color: color, size: U.lerp(1.5, 3.6, Math.random()) * k });
      }
    } else {
      var wx = (lane + 0.5 - this.lanes / 2) * this.laneWU;
      for (var j = 0; j < n; j++) {
        var aa = Math.random() * Math.PI * 2;
        this.p3.push({
          x: wx + Math.cos(aa) * 0.05, y: 0.2 + Math.random() * 0.3, z: Math.random() * 0.5,
          vx: Math.cos(aa) * U.lerp(0.4, 2.2, Math.random()) * k, vy: U.lerp(0.5, 2.6, Math.random()) * k,
          vz: U.lerp(-0.4, 1.6, Math.random()) * k, life: U.lerp(0.3, 0.7, Math.random()), max: 0.7,
          color: color, size: U.lerp(1.5, 4, Math.random()) * k
        });
      }
    }
    this.fx.push({ kind: 'ring', lane: lane, life: 0.4, max: 0.4, color: color, scale: k });
  };
  Renderer.prototype.clearEffects = function () {
    this.fx.length = 0; this.popups.length = 0; this.p2.length = 0; this.p3.length = 0;
    this.slashes.length = 0; this.beams = {};
    var d = this.dyn;
    d.shake = 0; d.shakeX = 0; d.shakeY = 0; d.roll = 0; d.lean = 0; d.yaw = 0; d.bob = 0; d.bobTarget = 0;
    d.dive = 0; d.flash = 0; d.streak = 0; d.rollNoise = 0; d.lane = [];
  };

  /* ---------------- 3D 动效推进 ---------------- */
  Renderer.prototype._updateDynamics = function (dt, frame) {
    var d = this.dyn, eff = this.settings.effects || 'high';
    var scale = eff === 'off' ? 0 : (eff === 'low' ? 0.5 : 1);
    /* 视角过渡（2D ↔ 3D 交叉溶解） */
    if (this.view.blend !== this.view.target) {
      this.view.t += dt;
      var k = U.clamp(this.view.t / this.view.dur, 0, 1);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // easeInOutQuad
      this.view.blend = U.lerp(this.view.from, this.view.to, e);
      if (k >= 1) this.view.blend = this.view.target;
      this.mode = this.view.blend >= 0.5 ? '3d' : '2d';
    }
    /* 音乐呼吸：低频能量推动镜头上抬/下沉 */
    var bands = frame.bands || this.bands || [];
    var low = 0, n = Math.min(5, bands.length);
    for (var i = 0; i < n; i++) low += bands[i] || 0;
    low = n ? low / n : 0;
    d.bobTarget = (low * 0.55 + this.beatPulse * 0.45) * this.h * 0.016 * (0.5 + this.view.blend * 0.5);
    d.bob = U.approach(d.bob, d.bobTarget * scale, 9, dt);
    /* 倾斜：慢速摇摆 + 打击倾斜 + 踩雷抖动 */
    var bpm = (frame.music && frame.music.bpm) || 120;
    var barSec = (60 / bpm) * 4;
    var sway = Math.sin((this.bgT / (barSec * 2)) * Math.PI * 2) * 0.016;
    sway += Math.sin(this.bgT * 0.7) * 0.006;
    d.rollNoise = U.approach(d.rollNoise, 0, 4, dt);
    var noise = d.rollNoise * (Math.random() - 0.5) * 0.05;
    var targetRoll = (sway + d.lean + noise) * scale;
    d.roll = U.approach(d.roll, targetRoll, 6, dt);
    d.yaw = U.approach(d.yaw, d.roll * 0.35, 4, dt);      // 倾斜带一点摇头，更有立体感
    d.lean *= Math.pow(0.06, dt);
    /* 震动衰减 + 随机抖动 */
    d.shake *= Math.pow(0.004, dt);
    var amp = d.shake * scale * this.h * 0.02;
    d.shakeX = (Math.random() - 0.5) * amp * 2;
    d.shakeY = (Math.random() - 0.5) * amp * 2;
    /* 机位俯冲（切入 3D 时从远处冲进来） */
    d.dive = U.approach(d.dive, 0, 3.2, dt);
    /* 过渡闪光 / 速度线 */
    d.flash = Math.max(0, d.flash - dt * 1.5);
    d.streak = Math.max(0, d.streak - dt * 1.3);
    /* 每轨冲量衰减 */
    for (var l = 0; l < this.lanes; l++) {
      if (d.lane[l] > 0) d.lane[l] = Math.max(0, d.lane[l] - dt * 2.3);
      else d.lane[l] = 0;
    }
  };

  /* ---------------- 主绘制 ---------------- */
  Renderer.prototype.draw = function (frame) {
    var s = this.settings;
    // 画布可能在界面隐藏时被创建/改尺寸，这里做自愈式重排
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw && ch && (Math.abs(cw - this.w) > 0.5 || Math.abs(ch - this.h) > 0.5)) this.resize();
    this.lanes = frame.lanes || this.lanes;
    if (this._lanesLayout !== this.lanes) { this._lanesLayout = this.lanes; this._layout(); }
    this.time = frame.now || 0;
    var dt = Math.min(0.05, frame.dt || 0.016);
    this.bgT += dt;
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.6);
    if (frame.bands) this.bands = frame.bands;
    if (frame.music) this.music = frame.music;
    if (frame.viewNext !== undefined) this.pendingView = frame.viewNext;
    this.setTheme(frame.theme);
    this._updateDynamics(dt, frame);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this._drawBackground(frame);
    var b = this.view.blend;
    /* 切换后旧视角的轨道与音符继续画，并在 3 秒内淡出到完全消失 */
    if (this.linger) {
      this.linger.t += dt;
      if (this.linger.t >= this.linger.total) this.linger = null;
    }
    if (this.linger) {
      var la = U.clamp(1 - this.linger.t / this.linger.total, 0, 1);
      ctx.save();
      ctx.globalAlpha = la * la;                 // 后段更快地消失
      if (this.linger.is3d) this._draw3d(frame);
      else this._draw2dShaken(frame);
      ctx.restore();
    }
    if (b <= 0.002) {
      this._draw2dShaken(frame);
    } else if (b >= 0.998) {
      this._draw3d(frame);
    } else {
      /* 交叉溶解：2D 淡出 + 3D 淡入，配合速度线与闪光做成「视角切换环节」 */
      ctx.save();
      ctx.globalAlpha = 1 - b;
      this._draw2dShaken(frame);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = b;
      this._draw3d(frame);
      ctx.restore();
      this._drawTransition(frame, b);
    }
    /* 3D 时连击数画在路面上（与轨道同一平面） */
    this._drawComboOnRoad(frame);
    this._updateEffects(dt);
    this._drawEffects();
    this._drawPopups(dt);
    /* 切换预告：白色半透明区域沿轨道由下往上填满 */
    this._drawViewFill(dt);
  };

  /* ---------------- 点划键的尖顶（2D：屏幕坐标；3D：屏幕空间贴在音符上方） ----------------
   * 外形：和单点一样的方块，正上方隔着一点小空隙再加一个"尖顶"（实心三角，无柄），
   * 颜色与本体同材质（顶部带白色高光），不再是箭头。 */
  Renderer.prototype._flickPeak2d = function (cx, bottomY, scale, col, alpha, widthScale) {
    var ctx = this.ctx;
    var s = scale || 1;
    var hgt = 11 * s;                                   // 尖顶高度
    var wid = (widthScale === undefined ? 0.56 : widthScale) * 26 * s;   // 尖顶底边宽
    var top = bottomY - hgt;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var g = ctx.createLinearGradient(0, top, 0, bottomY);
    g.addColorStop(0, U.rgba('#ffffff', 0.95));
    g.addColorStop(0.55, col || '#ff9d3c');
    g.addColorStop(1, U.shade(col || '#ff9d3c', -0.35));
    ctx.fillStyle = g;
    ctx.shadowColor = col || '#ffffff';
    ctx.shadowBlur = 9 * s;
    ctx.beginPath();
    ctx.moveTo(cx, top);                                // 尖
    ctx.lineTo(cx + wid / 2, bottomY);                  // 右下
    ctx.lineTo(cx - wid / 2, bottomY);                  // 左下
    ctx.closePath();
    ctx.fill();
    /* 顶部高光，和本体的高光呼应 */
    ctx.shadowBlur = 0;
    ctx.fillStyle = U.rgba('#ffffff', 0.5);
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx + wid * 0.18, top + hgt * 0.42);
    ctx.lineTo(cx - wid * 0.18, top + hgt * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /** 2D 也带一点屏幕震动/呼吸，保持打击反馈一致 */
  Renderer.prototype._draw2dShaken = function (frame) {
    var d = this.dyn, ctx = this.ctx;
    ctx.save();
    ctx.translate(d.shakeX * 0.7, d.shakeY * 0.7 + d.bob * 0.35);
    this._draw2d(frame);
    ctx.restore();
  };

  /** 视角切换瞬间的过场动效：速度线 + 扫描环 + 闪光 */
  Renderer.prototype._drawTransition = function (frame, b) {
    var ctx = this.ctx, d = this.dyn, th = this.theme;
    var k = 1 - Math.abs(b - 0.5) * 2;         // 0..1 中间最亮
    if (d.streak > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(b > 0.5 ? th.b : th.a, 0.5 * d.streak);
      ctx.lineWidth = 2;
      var n = 16;
      for (var i = 0; i < n; i++) {
        var y = (i / n) * this.h + ((this.bgT * 900) % (this.h / n));
        var len = (40 + Math.random() * 200) * d.streak;
        ctx.globalAlpha = 0.35 * d.streak;
        ctx.beginPath();
        ctx.moveTo(this.cx - len, y);
        ctx.lineTo(this.cx + len, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (k > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var grd = ctx.createRadialGradient(this.cx, this.horizonY, 0, this.cx, this.horizonY, this.h * 0.75);
      grd.addColorStop(0, U.rgba(b > 0.5 ? th.b : th.a, 0.35 * k * d.flash));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.w, this.h);
      var ringR = (1 - d.flash) * this.h * 0.9;
      ctx.strokeStyle = U.rgba('#ffffff', 0.5 * d.flash);
      ctx.lineWidth = 4 * d.flash + 0.5;
      ctx.beginPath();
      ctx.ellipse(this.cx, this.horizonY + d.bob, ringR, ringR * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  /** 视角标识已移除：游玩时不显示当前是 2D 还是 3D */
  Renderer.prototype._drawViewBadge = function () { };

  /* ======================================================================
   * 视角切换预告：白色半透明区域沿着轨道从下往上填满
   *   从切换前 VIEW_LEAD 秒开始，到切换发生的那一帧刚好填满，然后淡出
   * ====================================================================== */
  var VIEW_LEAD = 5.0;      // 提前量（秒）
  var VIEW_FADE = 0.45;     // 到点后淡出时长（秒）

  /** 让渲染器知道下一次切换的时间/mode（在 draw 里传入）。
   *  当传进来的事件换了一个（说明上一个刚好到点），就把上一个记下来做淡出。 */
  Renderer.prototype.setPendingView = function (next) {
    var prev = this.pendingView;
    next = next || null;
    if (prev && prev.t !== undefined && this.time >= prev.t - 0.08 &&
      (!next || next.t !== prev.t || next.mode !== prev.mode)) {
      this._fadingView = prev;
    }
    this.pendingView = next;
    return this;
  };

  /** 当前填充进度：null = 不显示；否则 { fill: 0..1, alpha, mode, phase }
   *  淡出完全按时间算（now - 事件时刻），所以掉帧也不会变慢或卡住 */
  Renderer.prototype._viewFill = function (now) {
    var nx = this.pendingView;
    if (nx && nx.t !== undefined) {
      var left = nx.t - now;
      if (left > 0 && left <= VIEW_LEAD) {
        this._fadingView = null;
        /* 从下往上填：left = VIEW_LEAD → 0；幂函数让结尾更"顶到点" */
        return { fill: Math.pow(1 - left / VIEW_LEAD, 0.72), alpha: 0.30, mode: nx.mode, phase: 'fill' };
      }
      if (left <= 0 && (!this._fadingView || this._fadingView.t !== nx.t)) this._fadingView = nx;
    }
    /* 到点后的淡出（用刚过去的那个事件的颜色/方向） */
    var fv = this._fadingView;
    if (fv) {
      var after = Math.max(0, now - fv.t);
      if (after < VIEW_FADE) {
        return { fill: 1, alpha: 0.30 * Math.pow(1 - after / VIEW_FADE, 1.6), mode: fv.mode, phase: 'fade' };
      }
      this._fadingView = null;
    }
    return null;
  };

  /** 沿轨道由下往上填充的白色半透明区域（2D / 3D 都用同一套坐标语义） */
  Renderer.prototype._drawViewFill = function (dt) {
    var f = this._viewFill(this.time);
    if (!f) return;
    var ctx = this.ctx;
    var lanes = this.lanes, half = lanes / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 纯色半透明白：没有描边、没有任何渐变 */
    ctx.fillStyle = U.rgba('#ffffff', f.alpha);
    if (this.view.blend < 0.5) {
      /* ---- 2D：判定线到顶部的整块轨道区域被自下而上填满 ---- */
      var top = this.h * 0.06;
      var bottom = this.judgeY;
      var hgt = (bottom - top) * f.fill;
      if (hgt > 0) ctx.fillRect(this.fieldX, bottom - hgt, this.fieldW, hgt);
    } else {
      /* ---- 3D：贴着路面自下（判定线）往上（远处）铺满。
         路面本身就是世界坐标里的一个矩形，投影后仍是四边形 —— 一块就够，不用分段。 */
      var zMax = this.worldFar * 0.55;
      var zEnd = zMax * f.fill;
      var p00 = this._project(-half * this.laneWU, 0.002, 0);
      var p01 = this._project(half * this.laneWU, 0.002, 0);
      var p11 = this._project(half * this.laneWU, 0.002, zEnd);
      var p10 = this._project(-half * this.laneWU, 0.002, zEnd);
      if (p00 && p01 && p11 && p10) {
        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  };

  /* ======================================================================
   * 3D：连击数画在轨道上（与路面同一平面，随镜头一起倾斜/震动）
   * ====================================================================== */
  Renderer.prototype._drawComboOnRoad = function (frame) {
    if (this.view.blend < 0.5) return;         // 只在 3D 画
    var combo = frame.combo || 0;
    var ctx = this.ctx;
    if (combo < 2) return;
    /* 位置比之前更高一点（往远处挪），数字更大、加粗、白色半透明 */
    var zC = 6.4;                              // 判定线前方一点点的路面上
    var yC = 0.006;                            // 贴着地（与轨道同一平面）
    var o = this._project(0, yC, zC);          // 路中心
    var px = this._project(1, yC, zC);         // +1 世界单位（横向）
    var pz = this._project(0, yC, zC + 1);     // +1 世界单位（纵深）
    if (!o || !px || !pz) return;
    var ax = { x: px.x - o.x, y: px.y - o.y };
    var az = { x: pz.x - o.x, y: pz.y - o.y };
    /* 单位换算：文字坐标系里 1 单位 = 0.1 个世界单位 */
    var U2 = 0.1;
    ctx.save();
    ctx.transform(ax.x * U2, ax.y * U2, -az.x * U2, -az.y * U2, o.x, o.y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    /* 字号：原来 5.4 单位的 4 倍；位数变多时按路面宽度自动收缩 */
    var num = String(combo);
    var fs = Math.min(21.6, 63 / num.length);
    ctx.font = '900 ' + fs.toFixed(1) + 'px "Segoe UI",Consolas,sans-serif';
    var alpha = 0.55;
    /* 一点暗色投影，保证压在亮色路面上也读得清（不是描边） */
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillText(num, fs * 0.05, fs * 0.05);
    ctx.fillStyle = U.rgba('#ffffff', alpha);
    ctx.fillText(num, 0, 0);
    /* COMBO 字样 */
    var fs2 = Math.max(2.2, fs * 0.22);
    ctx.font = '800 ' + fs2.toFixed(1) + 'px Consolas,monospace';
    ctx.fillStyle = U.rgba('#ffffff', alpha * 0.8);
    ctx.fillText('COMBO', 0, fs2 * 1.6);
    ctx.restore();
  };

  /* ---------------- 背景 ---------------- */
  Renderer.prototype._drawBackground = function (frame) {
    var ctx = this.ctx, s = this.settings, th = this.theme;
    var dim = s.bgDim === undefined ? 0.55 : s.bgDim;
    var mode = s.background || 'auto';
    if (mode === 'auto') mode = this.mode === '3d' ? 'stars' : 'bars';

    var g = ctx.createLinearGradient(0, 0, this.w * 0.3, this.h);
    g.addColorStop(0, U.mix('#05070f', th.a, 0.22));
    g.addColorStop(0.55, U.mix('#05070f', th.b, 0.14));
    g.addColorStop(1, '#04050b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    if (mode === 'bars' || mode === 'auto') this._bgBars();
    if (mode === 'grid') this._bgGrid();
    if (mode === 'stars') this._bgStars();
    if (this.hitFlash > 0.01) {
      ctx.fillStyle = U.rgba('#ffffff', this.hitFlash * 0.05);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (dim > 0) {
      ctx.fillStyle = 'rgba(3,4,10,' + (dim * 0.92) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }
  };
  Renderer.prototype._bgBars = function () {
    var ctx = this.ctx, bands = this.bands, n = bands.length || 24;
    var bw = this.w / n;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < n; i++) {
      var v = (bands[i] || 0);
      var bh = Math.pow(v, 0.85) * this.h * 0.55 + 4;
      var grd = ctx.createLinearGradient(0, this.h, 0, this.h - bh);
      grd.addColorStop(0, U.rgba(this.theme.a, 0.55));
      grd.addColorStop(1, U.rgba(this.theme.b, 0.05));
      ctx.fillStyle = grd;
      ctx.fillRect(i * bw + 1, this.h - bh, bw - 2, bh);
    }
    ctx.restore();
  };
  Renderer.prototype._bgGrid = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = U.rgba(this.theme.a, 0.12);
    ctx.lineWidth = 1;
    var off = (this.bgT * 60) % 60;
    for (var y = -60 + off; y < this.h; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
    }
    for (var x = 0; x < this.w; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.h); ctx.stroke();
    }
    ctx.restore();
  };
  Renderer.prototype._bgStars = function () {
    var ctx = this.ctx;
    if (!this._starField || this._starField.length !== 150) {
      var rng = U.rng(9911);
      this._starField = [];
      for (var i = 0; i < 150; i++) this._starField.push({ x: rng.next(), y: rng.next(), z: rng.range(0.2, 1), s: rng.range(0.5, 2.1) });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < this._starField.length; k++) {
      var st = this._starField[k];
      var tw = 0.35 + 0.65 * Math.abs(Math.sin(this.bgT * st.z * 1.4 + st.x * 12));
      ctx.fillStyle = U.rgba(k % 3 ? this.theme.a : this.theme.b, 0.5 * tw);
      ctx.beginPath();
      ctx.arc(st.x * this.w, st.y * this.h * 0.75, st.s * st.z * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ======================================================================
   * 2D 模式
   * ====================================================================== */
  Renderer.prototype._noteRect2d = function (lane, t, dur) {
    var speed = this.h / this.approachTime();
    var y = this.judgeY - (t - this.time) * speed;
    var yEnd = this.judgeY - (t + (dur || 0) - this.time) * speed;
    return { y: y, yEnd: yEnd, speed: speed };
  };

  Renderer.prototype._draw2d = function (frame) {
    var ctx = this.ctx, s = this.settings, th = this.theme;
    var speed = this.h / this.approachTime();
    var skin = s.skin || 'neon';
    var size = s.noteSize || 1;
    var laneW = this.laneW;

    /* 轨道底 */
    ctx.save();
    var fg = ctx.createLinearGradient(0, this.judgeY - this.h * 0.9, 0, this.judgeY + 40);
    fg.addColorStop(0, U.rgba(th.a, 0.03 * (s.laneOpacity === undefined ? 1 : s.laneOpacity)));
    fg.addColorStop(1, U.rgba(th.a, 0.16));
    ctx.fillStyle = fg;
    ctx.fillRect(this.fieldX, 0, this.fieldW, this.judgeY + 40);
    for (var i = 0; i < this.lanes; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.022)';
        ctx.fillRect(this.fieldX + i * laneW, 0, laneW, this.judgeY + 40);
      }
      ctx.strokeStyle = U.rgba(th.a, 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.fieldX + i * laneW + 0.5, 0);
      ctx.lineTo(this.fieldX + i * laneW + 0.5, this.judgeY + 40);
      ctx.stroke();
    }
    ctx.strokeStyle = U.rgba(th.a, 0.14);
    ctx.beginPath();
    ctx.moveTo(this.fieldX + this.fieldW - 0.5, 0);
    ctx.lineTo(this.fieldX + this.fieldW - 0.5, this.judgeY + 40);
    ctx.stroke();
    ctx.restore();

    /* 命中光柱 */
    for (var l in this.beams) {
      var b = this.beams[l];
      var bx = this.fieldX + (+l + 0.5) * laneW;
      var bg2 = ctx.createLinearGradient(0, this.judgeY, 0, this.judgeY - this.h * 0.6);
      bg2.addColorStop(0, U.rgba(th.a, 0.55 * b * 3));
      bg2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg2;
      ctx.fillRect(bx - laneW / 2, this.judgeY - this.h * 0.6, laneW, this.h * 0.6);
    }

    /* 判定线 */
    ctx.save();
    ctx.shadowColor = th.a; ctx.shadowBlur = 18 + this.beatPulse * 16;
    ctx.fillStyle = U.rgba('#ffffff', 0.9);
    ctx.fillRect(this.fieldX, this.judgeY - 1.5, this.fieldW, 3);
    ctx.restore();

    /* 音符（远的先画） */
    var vis = this.approachTime() + 0.4;
    var notes = frame.notes;
    for (var k = notes.length - 1; k >= 0; k--) {
      var n = notes[k];
      if (n.state === 2 && n.judge !== '' && n.type !== 'hold' && n.type !== 'slide') continue;
      if (n.t - this.time > vis) continue;
      var end = n.endT || n.t;
      if (end - this.time < -0.35) continue;
      this._drawNote2d(n, laneW, skin, size, speed);
    }

    /* 轨道按键提示 */
    var binds = (RG.Store && RG.Store.lanesFor(this.lanes)) || [];
    ctx.save();
    ctx.font = '600 12px Consolas,monospace';
    ctx.textAlign = 'center';
    for (var j = 0; j < this.lanes; j++) {
      var x = this.fieldX + (j + 0.5) * laneW;
      ctx.fillStyle = U.rgba('#ffffff', 0.35);
      ctx.fillText(U.keyName(binds[j]), x, this.judgeY + 22);
    }
    ctx.restore();
  };

  Renderer.prototype._drawNote2d = function (n, laneW, skin, size, speed) {
    var ctx = this.ctx, th = this.theme;
    var T = RG.Chart.TYPES[n.type];
    var pad = 6 * size;
    var x = this.fieldX + n.lane * laneW + pad;
    var w = laneW - pad * 2;
    var y = this.judgeY - (n.t - this.time) * speed;
    var col = T.color;
    var dim = n.state === 2 ? 0.32 : 1;

    function roundRect(rx, ry, rw, rh, r) {
      r = Math.min(r, rw / 2, rh / 2);
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
      ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
      ctx.arcTo(rx, ry + rh, rx, ry, r);
      ctx.arcTo(rx, ry, rx + rw, ry, r);
      ctx.closePath();
    }

    ctx.save();
    ctx.globalAlpha = dim;
    if (n.type === 'hold' || n.type === 'slide') {
      /* 长条（HOLD / SLIDE）只画判定线以上的部分：判定线以下一律不展示 */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.w, this.judgeY);
      ctx.clip();
      var yEnd = this.judgeY - (n.endT - this.time) * speed;   // 尾端在更上方
      var bodyTop = Math.min(y, yEnd);
      var h = Math.max(6, Math.abs(y - yEnd));
      var isSlide = (n.type === 'slide');
      var tailLane = isSlide ? U.clamp(n.tail === undefined ? n.lane : n.tail, 0, this.lanes - 1) : n.lane;
      var xt = this.fieldX + tailLane * laneW + pad;          // 尾端所在的轨道 x
      var tilted = isSlide && xt !== x;

      if (tilted) {
        /* ---- 滑条：从起点轨道斜着连到终点轨道（倾斜光束） ---- */
        var path = function () {
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x + w, y);
          ctx.lineTo(xt + w, yEnd); ctx.lineTo(xt, yEnd);
          ctx.closePath();
        };
        var gs = ctx.createLinearGradient(x, y, xt, yEnd);
        gs.addColorStop(0, U.rgba(col, skin === 'solid' ? 0.9 : 0.62));
        gs.addColorStop(0.5, U.rgba('#ffffff', 0.3));
        gs.addColorStop(1, U.rgba(col, skin === 'solid' ? 0.9 : 0.62));
        path();
        ctx.fillStyle = gs; ctx.fill();
        if (skin !== 'minimal') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = col; ctx.shadowBlur = n.state === 1 ? 26 : 14;
          ctx.fillStyle = U.rgba(col, 0.42);
          path(); ctx.fill();
          ctx.restore();
        }
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = 2;
        path(); ctx.stroke();
        /* 轨道间的虚线导引，强调"要横着走" */
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = U.rgba('#ffffff', 0.28);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y - 2);
        ctx.lineTo(xt + w / 2, yEnd + 2);
        ctx.stroke();
        ctx.restore();
      } else {
        /* ---- 长按：竖直长条 ---- */
        var grd = ctx.createLinearGradient(x, y, x + w, y);
        grd.addColorStop(0, U.rgba(col, skin === 'solid' ? 0.85 : 0.5));
        grd.addColorStop(0.5, U.rgba('#ffffff', 0.16));
        grd.addColorStop(1, U.rgba(col, skin === 'solid' ? 0.85 : 0.5));
        ctx.fillStyle = grd;
        roundRect(x, bodyTop, w, h, 6);
        ctx.fill();
        if (skin !== 'minimal') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = col; ctx.shadowBlur = n.state === 1 ? 26 : 14;
          ctx.fillStyle = U.rgba(col, 0.5);
          roundRect(x + 2, bodyTop, w - 4, h, 6); ctx.fill();
          ctx.restore();
        } else {
          ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 2;
          roundRect(x, bodyTop, w, h, 6); ctx.stroke();
        }
      }
      /* 尾部标记（画在终点轨道上） */
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 10;
      ctx.fillStyle = U.rgba(col, 0.95);
      roundRect(xt + 2, yEnd - 3, w - 4, 7, 3); ctx.fill();
      ctx.restore();
      /* 滑条方向箭头：沿着光束指向终点轨道 */
      if (isSlide) {
        var dir = xt > x ? 1 : -1;
        ctx.save();
        ctx.translate(xt + w / 2 - dir * w * 0.3, yEnd + 14);
        ctx.rotate(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.fillStyle = U.rgba('#ffffff', 0.9);
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        /* 终点轨道上的落点环 */
        ctx.save();
        ctx.strokeStyle = U.rgba(col, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(xt + w / 2, yEnd, Math.max(6, w * 0.24), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    /* 头部 */
    var headH = 16 * size;
    var hy = y - headH / 2;
    if (n.type === 'mine') {
      ctx.save();
      ctx.translate(x + w / 2, y);
      ctx.rotate(this.bgT * 2.4);
      ctx.fillStyle = U.rgba(col, 0.9);
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.beginPath();
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2, r = i % 2 ? w * 0.22 : w * 0.34;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      /* 单点 / 点划：同一种外形（圆角方块 + 顶部高光），只有颜色不同 */
      var hg = ctx.createLinearGradient(0, hy, 0, hy + headH);
      hg.addColorStop(0, U.rgba('#ffffff', 0.92));
      hg.addColorStop(0.45, col);
      hg.addColorStop(1, U.shade(col, -0.45));
      ctx.fillStyle = skin === 'minimal' ? U.rgba(col, 0.25) : hg;
      if (skin === 'neon') { ctx.shadowColor = col; ctx.shadowBlur = 22; }
      roundRect(x, hy, w, headH, 5);
      ctx.fill();
      if (skin === 'minimal') { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
      if (skin !== 'minimal') {
        ctx.fillStyle = U.rgba('#ffffff', 0.5);
        roundRect(x + 3, hy + 2, w - 6, 3, 2); ctx.fill();
      }
      /* 点划键：方块正上方隔一点小空隙加一个尖顶 */
      if (n.type === 'flick') this._flickPeak2d(x + w / 2, hy - 3.5 * size, size, col, 1);
    }
    /* 长条：结束"只画判定线以上"的裁剪 */
    if (n.type === 'hold' || n.type === 'slide') ctx.restore();
    ctx.restore();
  };
  /* ======================================================================
   * 3D 模式
   * ====================================================================== */
  Renderer.prototype._draw3d = function (frame) {
    var ctx = this.ctx, th = this.theme, cam = this.cam;
    var zSpeed = this._zSpeed();
    var now = this.time;
    var half = this.lanes / 2;
    var laneWU = this.laneWU;

    /* 远处光晕 */
    var hg = ctx.createRadialGradient(this.cx, this.horizonY, 0, this.cx, this.horizonY, this.h * 0.5);
    hg.addColorStop(0, U.rgba(th.b, 0.35));
    hg.addColorStop(0.4, U.rgba(th.a, 0.1));
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();

    /* 地面 */
    var t0 = this._project(-half * laneWU, 0, 0), t1 = this._project(half * laneWU, 0, 0);
    var f0 = this._project(-half * laneWU, 0, this.worldFar), f1 = this._project(half * laneWU, 0, this.worldFar);
    if (t0 && t1 && f0 && f1) {
      var fg = ctx.createLinearGradient(0, this.horizonY, 0, t0.y);
      fg.addColorStop(0, U.rgba('#05070f', 0.2));
      fg.addColorStop(1, U.rgba(th.a, 0.14));
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(f0.x, f0.y); ctx.lineTo(f1.x, f1.y); ctx.lineTo(t1.x, t1.y); ctx.lineTo(t0.x, t0.y);
      ctx.closePath(); ctx.fill();

      /* 每轨地面条带：命中冲量会让该轨发光并轻微抖动（轨道震动） */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var d = this.dyn;
      for (var li = 0; li < this.lanes; li++) {
        var imp = d.lane[li] || 0;
        var lx0 = (li - half) * laneWU + laneWU * 0.06;
        var lx1 = (li + 1 - half) * laneWU - laneWU * 0.06;
        var zig = imp > 0.01 ? Math.sin(this.bgT * 46 + li) * imp * 0.03 : 0;
        var q0 = this._project(lx0 + zig, 0.004, 0);
        var q1 = this._project(lx1 + zig, 0.004, 0);
        var q2 = this._project(lx1 + zig, 0.004, this.worldFar * 0.5);
        var q3 = this._project(lx0 + zig, 0.004, this.worldFar * 0.5);
        if (!q0 || !q1 || !q2 || !q3) continue;
        var base = li % 2 ? 0.03 : 0.055;
        var lg = ctx.createLinearGradient(0, q3.y, 0, q0.y);
        lg.addColorStop(0, U.rgba(th.a, 0));
        lg.addColorStop(1, U.rgba(li % 2 ? th.b : th.a, base + imp * 0.55));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(q3.x, q3.y); ctx.lineTo(q2.x, q2.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q0.x, q0.y);
        ctx.closePath(); ctx.fill();
        /* 命中时的竖向光柱 */
        if (imp > 0.02) {
          var b0 = this._project((li + 0.5 - half) * laneWU + zig, 0, 0);
          var b1 = this._project((li + 0.5 - half) * laneWU + zig, 1.5 + imp, 0);
          if (b0 && b1) {
            var bg3 = ctx.createLinearGradient(0, b0.y, 0, b1.y);
            bg3.addColorStop(0, U.rgba('#ffffff', 0.34 * imp));
            bg3.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = bg3;
            var wdt = Math.max(2, (laneWU * this.focal) / Math.max(0.6, cam.dist + this.dyn.dive) * 0.55);
            ctx.fillRect(b0.x - wdt / 2, b1.y, wdt, b0.y - b1.y);
          }
        }
      }
      ctx.restore();

      /* 轨道分隔线 */
      ctx.strokeStyle = U.rgba(th.a, 0.3);
      ctx.lineWidth = 1.2;
      for (var i = 0; i <= this.lanes; i++) {
        var wx = (i - half) * laneWU;
        var a = this._project(wx, 0, 0), b = this._project(wx, 0, this.worldFar);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      /* 两侧护栏：立体隧道感（倾斜/震动时跟随投影） */
      var railH = 0.55 + this.beatPulse * 0.12;
      var self = this;
      [-1, 1].forEach(function (side) {
        var wxr = side * half * laneWU;
        var b0 = self._project(wxr, 0, 0);
        var b1 = self._project(wxr, railH, 0);
        var b2 = self._project(wxr, railH, self.worldFar * 0.62);
        var b3 = self._project(wxr, 0, self.worldFar * 0.62);
        if (!b0 || !b1 || !b2 || !b3) return;
        var rg2 = ctx.createLinearGradient(0, b3.y, 0, b0.y);
        var col = side < 0 ? th.a : th.b;
        rg2.addColorStop(0, U.rgba(col, 0.02));
        rg2.addColorStop(1, U.rgba(col, 0.16));
        ctx.fillStyle = rg2;
        ctx.beginPath();
        ctx.moveTo(b3.x, b3.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b0.x, b0.y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(b0.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      });

      /* 隧道环：小节线处的立体环，强化景深与动感 */
      var m2 = frame.music;
      if (m2 && m2.beatDur) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var barSec = m2.beatDur * 4;
        var firstBar = Math.ceil(now / barSec) * barSec;
        for (var bt2 = firstBar; bt2 < now + this.approachTime() * 1.1; bt2 += barSec) {
          var z2 = (bt2 - now) * zSpeed;
          if (z2 < 0.4 || z2 > this.worldFar * 0.75) continue;
          var r0 = this._project(-half * laneWU, 0, z2);
          var r1 = this._project(-half * laneWU, railH, z2);
          var r2b = this._project(half * laneWU, railH, z2);
          var r3 = this._project(half * laneWU, 0, z2);
          if (!r0 || !r1 || !r2b || !r3) continue;
          var pa = U.clamp(1 - z2 / (this.worldFar * 0.75), 0, 1);
          ctx.strokeStyle = U.rgba(th.a, 0.3 * pa);
          ctx.lineWidth = 1 + pa * 1.4;
          ctx.beginPath();
          ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.lineTo(r2b.x, r2b.y); ctx.lineTo(r3.x, r3.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 节拍网格 */
      var m = frame.music;
      if (m && m.beatDur) {
        var bd = m.beatDur * (this.settings.scrollSpeed > 8 ? 2 : 1);
        var first = Math.ceil(now / bd) * bd;
        ctx.lineWidth = 1;
        for (var bt = first; bt < now + this.approachTime(); bt += bd) {
          var z = (bt - now) * zSpeed;
          if (z < 0.2 || z > this.worldFar) continue;
          var p0 = this._project(-half * laneWU, 0, z), p1 = this._project(half * laneWU, 0, z);
          if (!p0 || !p1) continue;
          var down = Math.abs(bt / (m.beatDur * 4) - Math.round(bt / (m.beatDur * 4))) < 0.02;
          ctx.strokeStyle = U.rgba(down ? th.b : th.a, (down ? 0.34 : 0.14) * (1 - z / this.worldFar));
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      }
    }

    /* 判定面 */
    ctx.save();
    var jt0 = this._project(-half * laneWU, 0.012, 0), jt1 = this._project(half * laneWU, 0.012, 0);
    if (jt0 && jt1) {
      ctx.shadowColor = th.a; ctx.shadowBlur = 22 + this.beatPulse * 24;
      var jg = ctx.createLinearGradient(jt0.x, 0, jt1.x, 0);
      jg.addColorStop(0, U.rgba(th.a, 0.25));
      jg.addColorStop(0.5, U.rgba('#ffffff', 0.95));
      jg.addColorStop(1, U.rgba(th.b, 0.25));
      ctx.strokeStyle = jg;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(jt0.x, jt0.y); ctx.lineTo(jt1.x, jt1.y); ctx.stroke();
    }
    ctx.restore();

    /* 音符：由远及近 */
    var notes = frame.notes, visible = [];
    for (var k = 0; k < notes.length; k++) {
      var n = notes[k];
      var zHead = (n.t - now) * zSpeed;
      var zTail = ((n.endT || n.t) - now) * zSpeed;
      if (zHead > this.worldFar + 6) continue;
      if (zTail < -6) continue;
      visible.push({ n: n, zHead: zHead, zTail: zTail });
    }
    visible.sort(function (a, b) { return b.zHead - a.zHead; });
    for (var v = 0; v < visible.length; v++) {
      this._drawNote3d(visible[v].n, visible[v].zHead, visible[v].zTail, laneWU, half);
    }

    /* 按键提示：投影到判定线下方（跟随倾斜/震动） */
    var binds = (RG.Store && RG.Store.lanesFor(this.lanes)) || [];
    ctx.save();
    ctx.font = '600 12px Consolas,monospace';
    ctx.textAlign = 'center';
    for (var j = 0; j < this.lanes; j++) {
      var pj = this._project((j + 0.5 - half) * laneWU, 0, 0);
      if (!pj) continue;
      var imp2 = this.dyn.lane[j] || 0;
      ctx.fillStyle = U.rgba('#ffffff', 0.38 + imp2 * 0.5);
      ctx.fillText(U.keyName(binds[j]), pj.x, U.clamp(pj.y + 20, 0, this.h - 4));
    }
    ctx.restore();
  };

  Renderer.prototype._drawNote3d = function (n, zHead, zTail, laneWU, half) {
    var ctx = this.ctx;
    var T = RG.Chart.TYPES[n.type];
    var col = T.color;
    var x0 = (n.lane - half) * laneWU + laneWU * 0.08;
    var x1 = (n.lane - half) * laneWU + laneWU * 0.92;
    var fog = U.clamp(1 - zHead / (this.worldFar * 1.15), 0.12, 1);
    var alpha = (n.state === 2 ? 0.35 : 1) * fog;

    function poly(pts, fill, stroke) {
      if (!pts) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    function face(a, b, c, d) {
      if (!a || !b || !c || !d) return null;
      return [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]];
    }

    ctx.save();
    if (n.type === 'mine') {
      var c = this._project((n.lane + 0.5 - half) * laneWU, 0.28, zHead);
      if (c) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = U.rgba(col, 0.9);
        ctx.shadowColor = col; ctx.shadowBlur = 18 * fog;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(this.bgT * 2);
        ctx.beginPath();
        var r = 0.34 * c.s;
        for (var i = 0; i < 12; i++) {
          var a = (i / 12) * Math.PI * 2, rr = i % 2 ? r * 0.62 : r;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr * 0.7);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    var zN = zHead - 0.42, zF = zHead + 0.42;
    if (n.type === 'hold' || n.type === 'slide') { zF = zTail + 0.2; zN = zHead - 0.2; }
    /* 长条（HOLD / SLIDE）只画判定线以上的部分：判定线在 z = 0，
       所以把「更靠近相机」的那一端夹到 z = 0（判定线以下的部分不展示） */
    if (n.type === 'hold' || n.type === 'slide') {
      if (zF <= 0.01) return;                    // 整条都还在判定线以下 → 不画
      zN = Math.max(0.01, zN);
    }
    /* 点划与单点同样厚度（外观就是"换了颜色的 tap"） */
    var hTop = 0.36 * (this.settings.noteSize || 1);
    if (n.type === 'hold' || n.type === 'slide') hTop = 0.2;

    /* 近端（起点）与远端（终点）各自的轨道横向范围：
       滑条的终点在另一条轨道上 → 世界坐标里就是一条斜着的光束，
       投影后自然呈现倾斜（这是之前只画成一条直线的原因） */
    var nx0 = x0, nx1 = x1, fx0 = x0, fx1 = x1;
    if (n.type === 'slide' && n.tail !== undefined) {
      var tLane = U.clamp(n.tail, 0, this.lanes - 1);
      var tx0 = (tLane - half) * laneWU;
      fx0 = tx0 + laneWU * 0.08;
      fx1 = tx0 + laneWU * 0.92;
    }

    var a = this._project(nx0, 0, zN), b = this._project(nx1, 0, zN);
    var cc = this._project(fx1, 0, zF), d = this._project(fx0, 0, zF);
    var at = this._project(nx0, hTop, zN), bt = this._project(nx1, hTop, zN);
    var ct = this._project(fx1, hTop, zF), dtp = this._project(fx0, hTop, zF);

    ctx.globalAlpha = alpha;
    // 侧面 / 近面 / 远面 / 顶面（滑条时顶面是斜的）
    poly(face(a, b, bt, at), U.shade(col, -0.55), null);
    poly(face(a, at, dtp, d), U.shade(col, -0.3), null);
    poly(face(b, bt, ct, cc), U.shade(col, -0.4), null);
    if (this.settings.skin !== 'minimal') {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = (n.type === 'flick' ? 26 : 16) * fog;
      poly(face(at, bt, ct, dtp), U.rgba(col, 0.95), null);
      ctx.restore();
      poly(face(at, bt, ct, dtp), U.rgba('#ffffff', 0.35 * (1 - hTop)), null);
    } else {
      poly(face(at, bt, ct, dtp), U.rgba(col, 0.2), U.rgba(col, 0.95));
    }
    if (n.type === 'slide') {
      /* 起点 → 终点 的白色导引线 + 终点落点标记 */
      var midN = this._project((nx0 + nx1) / 2, hTop + 0.05, zN);
      var midF = this._project((fx0 + fx1) / 2, hTop + 0.05, zF);
      if (midN && midF) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = U.rgba('#ffffff', 0.55);
        ctx.lineWidth = Math.max(1.2, 2.4 * fog);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(midN.x, midN.y);
        ctx.lineTo(midF.x, midF.y);
        ctx.stroke();
        ctx.restore();
      }
      if (midF) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = U.rgba('#ffffff', 0.8 * fog);
        ctx.lineWidth = Math.max(1.2, 2.2 * fog);
        ctx.beginPath();
        ctx.ellipse(midF.x, midF.y, Math.max(2, 9 * fog), Math.max(1, 4 * fog), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
    /* 点划键：方块上方隔一点空隙加一个尖顶（屏幕空间，随透视缩放） */
    if (n.type === 'flick' && at && bt && a) {
      var boxH = Math.abs(a.y - at.y);                 // 音符方块在屏幕上的厚度
      var scale = U.clamp(boxH / 9, 0.5, 3.2);         // 随远近自动缩放
      this._flickPeak2d((at.x + bt.x) / 2, at.y - boxH * 0.35 - 2, scale, col, alpha);
    }
  };

  /* ======================================================================
   * 特效与弹字
   * ====================================================================== */
  Renderer.prototype._updateEffects = function (dt) {
    var i;
    for (i = this.p2.length - 1; i >= 0; i--) {
      var p = this.p2[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.vx *= 0.99;
      if (p.life <= 0) this.p2.splice(i, 1);
    }
    for (i = this.p3.length - 1; i >= 0; i--) {
      var q = this.p3[i];
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vy -= 3.4 * dt;
      if (q.life <= 0 || q.y < -0.2) this.p3.splice(i, 1);
    }
    for (i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].life -= dt;
      if (this.fx[i].life <= 0) this.fx.splice(i, 1);
    }
    for (var l in this.beams) {
      this.beams[l] -= dt * 2.2;
      if (this.beams[l] <= 0) delete this.beams[l];
    }
  };

  Renderer.prototype._drawEffects = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 屏幕空间粒子 */
    for (var i = 0; i < this.p2.length; i++) {
      var p = this.p2[i], a = U.clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = U.rgba(p.color, a);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 0.4, 0, Math.PI * 2); ctx.fill();
    }
    /* 世界空间粒子 */
    for (var j = 0; j < this.p3.length; j++) {
      var q = this.p3[j];
      var pr = this._project(q.x, q.y, Math.max(0.02, q.z));
      if (!pr) continue;
      var a2 = U.clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = U.rgba(q.color, a2);
      ctx.beginPath(); ctx.arc(pr.x, pr.y, Math.max(0.6, q.size * (pr.s / this.focal) * 8), 0, Math.PI * 2); ctx.fill();
    }
    /* 命中光环 */
    for (var k = 0; k < this.fx.length; k++) {
      var f = this.fx[k], prog = 1 - f.life / f.max, al = (1 - prog) * 0.8;
      if (this.mode === '2d') {
        var x = this.fieldX + (f.lane + 0.5) * this.laneW;
        ctx.strokeStyle = U.rgba(f.color, al);
        ctx.lineWidth = 3 * (1 - prog) + 0.6;
        ctx.beginPath();
        ctx.ellipse(x, this.judgeY, (12 + prog * this.laneW * 0.75 * f.scale), (8 + prog * 26 * f.scale), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        var wx = (f.lane + 0.5 - this.lanes / 2) * this.laneWU;
        var pj = this._project(wx, 0.02, 0.02);
        if (pj) {
          var rr = (0.12 + prog * 0.85 * f.scale) * pj.s;
          ctx.strokeStyle = U.rgba(f.color, al);
          ctx.lineWidth = 3 * (1 - prog) + 0.6;
          ctx.beginPath();
          ctx.ellipse(pj.x, pj.y, rr, rr * 0.36, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    /* 点划的滑动划痕 */
    for (var m = this.slashes.length - 1; m >= 0; m--) {
      var sl = this.slashes[m];
      sl.life -= 1 / 60;
      if (sl.life <= 0) { this.slashes.splice(m, 1); continue; }
      var prog2 = 1 - sl.life / sl.max;
      var al2 = (1 - prog2) * (sl.judged ? 0.85 : 0.4);
      var half2 = sl.len * (0.35 + prog2 * 0.65) / 2;
      var px2 = -sl.uy, py2 = sl.ux;               // 垂直方向（做划痕宽度）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#ffffff', al2);
      ctx.lineWidth = sl.w * (1 - prog2) * 0.5 + 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sl.x - sl.ux * half2, sl.y - sl.uy * half2);
      ctx.lineTo(sl.x + sl.ux * half2, sl.y + sl.uy * half2);
      ctx.stroke();
      ctx.strokeStyle = U.rgba(this.theme.a, al2 * 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sl.x - sl.ux * half2 + px2 * 7, sl.y - sl.uy * half2 + py2 * 7);
      ctx.lineTo(sl.x + sl.ux * half2 + px2 * 7, sl.y + sl.uy * half2 + py2 * 7);
      ctx.moveTo(sl.x - sl.ux * half2 - px2 * 7, sl.y - sl.uy * half2 - py2 * 7);
      ctx.lineTo(sl.x + sl.ux * half2 - px2 * 7, sl.y + sl.uy * half2 - py2 * 7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  Renderer.prototype._drawPopups = function (dt) {
    var ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = this.popups.length - 1; i >= 0; i--) {
      var p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) { this.popups.splice(i, 1); continue; }
      var prog = 1 - p.life / p.max;
      var x, y;
      if (this.mode === '2d') {
        x = this.fieldX + (p.lane + 0.5) * this.laneW;
        y = this.judgeY - 44 - prog * 26;
      } else {
        var wx = (p.lane + 0.5 - this.lanes / 2) * this.laneWU;
        var pj = this._project(wx, 0.55, 0.05);
        x = pj ? pj.x : this.cx;
        y = (pj ? pj.y : this.h * 0.72) - prog * 22;
      }
      ctx.globalAlpha = U.clamp(p.life / p.max * 1.6, 0, 1);
      ctx.font = '700 ' + (p.text.length > 6 ? 15 : 19) + 'px Consolas,monospace';
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.fillText(p.text, x, y);
      if (p.sub) {
        ctx.font = '600 12px Consolas,monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(p.sub, x, y - 16);
      }
    }
    ctx.restore();
  };

  /* ======================================================================
   * 选曲/标题界面的动画背景（与玩法共用主题色）
   * ====================================================================== */
  RG.Render.menuBackground = function (canvas, theme, t, bands) {
    var s = U.canvasSize(canvas, 2), ctx = s.ctx, w = s.w, h = s.h;
    var th = theme || { a: '#38e8ff', b: '#ff4fd8' };
    ctx.clearRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, U.mix('#05070f', th.a, 0.25));
    g.addColorStop(0.6, '#06080f');
    g.addColorStop(1, U.mix('#05070f', th.b, 0.22));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* 透视网格地面 */
    ctx.save();
    ctx.strokeStyle = U.rgba(th.a, 0.16);
    ctx.lineWidth = 1;
    var horizon = h * 0.62;
    for (var i = -14; i <= 14; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * 26, horizon);
      ctx.lineTo(w / 2 + i * w * 0.14, h + 40);
      ctx.stroke();
    }
    var off = (t * 0.35) % 1;
    for (var k = 0; k < 26; k++) {
      var p = (k + off) / 26;
      var y = horizon + Math.pow(p, 2.1) * (h - horizon) * 1.4;
      if (y > h + 40) continue;
      ctx.strokeStyle = U.rgba(th.b, 0.1 + 0.16 * p);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    /* 频谱柱 */
    if (bands && bands.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var n = bands.length, bw = w / n;
      for (var b = 0; b < n; b++) {
        var v = bands[b] || 0;
        var bh = Math.pow(v, 0.9) * h * 0.5;
        var bg2 = ctx.createLinearGradient(0, horizon, 0, horizon - bh);
        bg2.addColorStop(0, U.rgba(th.a, 0.5));
        bg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg2;
        ctx.fillRect(b * bw, horizon - bh, bw - 1, bh);
      }
      ctx.restore();
    }
    /* 漂浮光点 */
    var rng = U.rng(4242);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var d = 0; d < 40; d++) {
      var px = rng.next() * w;
      var sp = rng.range(0.2, 1);
      var py = (h - ((t * 22 * sp + rng.next() * h) % (h + 80)));
      ctx.fillStyle = U.rgba(d % 2 ? th.a : th.b, 0.28 * sp + 0.1);
      ctx.beginPath(); ctx.arc(px, py, 1.1 + sp * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };
})(typeof window !== 'undefined' ? window : globalThis);

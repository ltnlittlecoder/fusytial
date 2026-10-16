/* ==========================================================================
 * Resonance Engine · worldmap.js
 * 大地图：章节区域 + 曲目节点 + 路线 + 缩放平移 + 解锁/星级可视化
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  var WORLD_W = 2600, WORLD_H = 1700;

  function WorldMap(opts) {
    opts = opts || {};
    this.canvas = opts.canvas;
    this.ctx = U.canvasSize(this.canvas, 2).ctx;
    this.onPickSong = opts.onPickSong || function () { };
    this.onPickChapter = opts.onPickChapter || function () { };
    this.onPickWorkshop = opts.onPickWorkshop || function () { };
    this.cam = { x: 1250, y: 850, zoom: 0.72 };
    this.targetZoom = this.cam.zoom;
    this.active = false;
    this.time = 0;
    this.drag = null;
    this.hover = null;
    this.selected = null;       // {song, chapter}
    this.selectedChapter = null;
    this.hits = [];
    this.chapterHits = [];
    this._shapes = {};
    this._stars = null;
    this.flash = 0;
    this._bind();
    this.resize();
  }
  RG.WorldMap = WorldMap;

  WorldMap.prototype.resize = function () {
    var s = U.canvasSize(this.canvas, 2);
    this.ctx = s.ctx; this.w = s.w; this.h = s.h; this.dpr = s.dpr;
  };

  WorldMap.prototype.show = function () {
    this.active = true;
    this.resize();
    this.flash = 1;
  };
  WorldMap.prototype.hide = function () { this.active = false; };

  /* ---------------- 坐标变换 ---------------- */
  WorldMap.prototype.toScreen = function (wx, wy) {
    return {
      x: (wx - this.cam.x) * this.cam.zoom + this.w / 2,
      y: (wy - this.cam.y) * this.cam.zoom + this.h / 2
    };
  };
  WorldMap.prototype.toWorld = function (sx, sy) {
    return {
      x: (sx - this.w / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.h / 2) / this.cam.zoom + this.cam.y
    };
  };
  WorldMap.prototype.focus = function (wx, wy, zoom) {
    this.cam.x = wx; this.cam.y = wy;
    if (zoom) this.targetZoom = zoom;
  };
  WorldMap.prototype.focusChapter = function (ch) {
    if (!ch) return;
    this.selectedChapter = ch;
    this.cam.x = ch.x; this.cam.y = ch.y;
    this.targetZoom = ch.workshop ? 1.05 : 0.95;
  };
  WorldMap.prototype.setSelected = function (song, chapter) {
    this.selected = song ? { song: song, chapter: chapter } : null;
  };

  /* ---------------- 交互 ---------------- */
  WorldMap.prototype._bind = function () {
    var self = this, cv = this.canvas;
    U.on(cv, 'pointerdown', function (e) {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      self.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: self.cam.x, cy: self.cam.y, moved: 0 };
      cv.classList.add('dragging');
    });
    U.on(cv, 'pointermove', function (e) {
      var r = cv.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      if (self.drag && self.drag.id === e.pointerId) {
        var dx = e.clientX - self.drag.x, dy = e.clientY - self.drag.y;
        self.drag.moved = Math.max(self.drag.moved, Math.abs(dx) + Math.abs(dy));
        self.cam.x = self.drag.cx - dx / self.cam.zoom;
        self.cam.y = self.drag.cy - dy / self.cam.zoom;
      }
      self._pointer = { x: px, y: py };
      self._hoverTest(px, py);
    });
    U.on(cv, 'pointerup', function (e) {
      cv.classList.remove('dragging');
      var moved = self.drag ? self.drag.moved : 99;
      self.drag = null;
      if (moved > 6) return;
      var r = cv.getBoundingClientRect();
      self._click(e.clientX - r.left, e.clientY - r.top);
    });
    U.on(cv, 'pointerleave', function () { self._pointer = null; self.hover = null; });
    U.on(cv, 'wheel', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var before = self.toWorld(mx, my);
      self.targetZoom = U.clamp(self.targetZoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.34, 2.4);
      self.cam.zoom = self.targetZoom;
      var after = self.toWorld(mx, my);
      self.cam.x += before.x - after.x;
      self.cam.y += before.y - after.y;
    }, { passive: false });
    U.on(cv, 'dblclick', function (e) {
      var r = cv.getBoundingClientRect();
      self._click(e.clientX - r.left, e.clientY - r.top, true);
    });
  };

  WorldMap.prototype._nodeRadius = function (ch, song) {
    var base = ch.workshop ? 26 : 21;
    if (song && song.boss) base += 5;
    return base * U.clamp(this.cam.zoom, 0.45, 1.7);
  };

  WorldMap.prototype._hoverTest = function (px, py) {
    var best = null;
    for (var i = 0; i < this.hits.length; i++) {
      var h = this.hits[i];
      if (U.dist2(px, py, h.x, h.y) <= h.r + 8) { best = h; break; }
    }
    this.hover = best;
    this.canvas.style.cursor = best ? 'pointer' : (this.drag ? 'grabbing' : 'grab');
    if (this.onHover) this.onHover(best, px, py);
  };

  WorldMap.prototype._click = function (px, py, isDouble) {
    for (var i = 0; i < this.hits.length; i++) {
      var h = this.hits[i];
      if (U.dist2(px, py, h.x, h.y) <= h.r + 8) {
        this.selected = { song: h.song, chapter: h.chapter };
        this.selectedChapter = h.chapter;
        if (h.chapter.workshop) { this.onPickWorkshop(h.chapter); return; }
        this.onPickSong(h.song, h.chapter);
        return;
      }
    }
    if (isDouble) {
      for (var j = 0; j < this.chapterHits.length; j++) {
        var c = this.chapterHits[j];
        if (U.dist2(px, py, c.x, c.y) <= c.r) { this.focusChapter(c.chapter); return; }
      }
    }
  };

  WorldMap.prototype.zoomBy = function (f) { this.targetZoom = U.clamp(this.targetZoom * f, 0.34, 2.4); };
  WorldMap.prototype.resetView = function () { this.targetZoom = 0.72; this.cam.x = 1250; this.cam.y = 850; };

  /* ---------------- 绘制 ---------------- */
  WorldMap.prototype.render = function (dt) {
    if (!this.active) return;
    this.time += dt;
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw && ch && (Math.abs(cw - this.w) > 0.5 || Math.abs(ch - this.h) > 0.5)) this.resize();
    var ctx = this.ctx;
    /* 平滑缩放 */
    this.cam.zoom = U.approach(this.cam.zoom, this.targetZoom, 1.6, dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this._drawBackdrop();
    ctx.save();
    /* 世界边界提示 */
    this.hits.length = 0;
    this.chapterHits.length = 0;
    this._drawRoutes();
    RG.Songs.chapters.forEach(this._drawChapter, this);
    this._drawNodes();
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.12) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
  };

  WorldMap.prototype._drawBackdrop = function () {
    var ctx = this.ctx;
    var g = ctx.createLinearGradient(0, 0, this.w, this.h);
    g.addColorStop(0, '#05070f');
    g.addColorStop(0.5, '#0a0e1e');
    g.addColorStop(1, '#070510');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this._stars) {
      var rng = U.rng(20240);
      this._stars = [];
      for (var i = 0; i < 260; i++) this._stars.push({ x: rng.range(0, WORLD_W), y: rng.range(0, WORLD_H), r: rng.range(0.6, 1.9), a: rng.range(0.2, 0.8), p: rng.range(0, 6.28) });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < this._stars.length; k++) {
      var s = this._stars[k];
      var p = this.toScreen(s.x, s.y);
      if (p.x < -20 || p.x > this.w + 20 || p.y < -20 || p.y > this.h + 20) continue;
      var tw = 0.55 + 0.45 * Math.sin(this.time * 1.4 + s.p);
      ctx.fillStyle = 'rgba(190,220,255,' + (s.a * tw) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, s.r * U.clamp(this.cam.zoom, 0.5, 1.4), 0, Math.PI * 2); ctx.fill();
    }
    /* 世界网格 */
    var step = 200;
    ctx.strokeStyle = 'rgba(120,150,255,0.05)';
    ctx.lineWidth = 1;
    var tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    for (var gx = Math.floor(tl.x / step) * step; gx < br.x; gx += step) {
      var a = this.toScreen(gx, tl.y), b = this.toScreen(gx, br.y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (var gy = Math.floor(tl.y / step) * step; gy < br.y; gy += step) {
      var c = this.toScreen(tl.x, gy), d = this.toScreen(br.x, gy);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    ctx.restore();
  };

  /** 章节区域形状（确定性极坐标块） */
  WorldMap.prototype._chapterShape = function (ch) {
    if (this._shapes[ch.id]) return this._shapes[ch.id];
    var rng = U.rng('region-' + ch.id);
    var pts = [];
    var n = 26;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = ch.r * rng.range(0.78, 1.16);
      pts.push({ a: a, r: r });
    }
    this._shapes[ch.id] = pts;
    return pts;
  };

  WorldMap.prototype._drawChapter = function (ch) {
    var ctx = this.ctx;
    var p = this.toScreen(ch.x, ch.y);
    var zoom = this.cam.zoom;
    var R = ch.r * zoom;
    if (p.x + R < -60 || p.x - R > this.w + 60 || p.y + R < -60 || p.y - R > this.h + 60) return;
    var unlocked = RG.Songs.isChapterUnlocked(ch);
    var prog = RG.Songs.chapterProgress(ch);
    var isSel = this.selectedChapter === ch;
    var col = ch.color, acc = ch.accent;

    var pts = this._chapterShape(ch);
    ctx.save();
    /* 区域填充 */
    ctx.beginPath();
    for (var i = 0; i <= pts.length; i++) {
      var q = pts[i % pts.length];
      var x = p.x + Math.cos(q.a) * q.r * zoom;
      var y = p.y + Math.sin(q.a) * q.r * zoom * 0.88;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var rg = ctx.createRadialGradient(p.x, p.y, R * 0.1, p.x, p.y, R * 1.1);
    rg.addColorStop(0, U.rgba(col, unlocked ? (isSel ? 0.24 : 0.15) : 0.05));
    rg.addColorStop(1, U.rgba(acc, 0.02));
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.strokeStyle = U.rgba(unlocked ? col : '#4a5470', isSel ? 0.85 : 0.4);
    ctx.lineWidth = isSel ? 2.4 : 1.4;
    if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 26; }
    ctx.setLineDash(unlocked ? [] : [7, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* 标题 */
    ctx.save();
    ctx.textAlign = 'center';
    var titleY = p.y - R * 0.95 - 26;
    ctx.font = '700 ' + Math.max(15, 23 * zoom) + 'px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = unlocked ? '#eef3ff' : '#7c86a8';
    ctx.shadowColor = U.rgba(col, 0.8); ctx.shadowBlur = unlocked ? 16 : 0;
    ctx.fillText(ch.name, p.x, titleY);
    ctx.shadowBlur = 0;
    ctx.font = '600 ' + Math.max(9, 11 * zoom) + 'px Consolas,monospace';
    ctx.fillStyle = U.rgba(unlocked ? col : '#5b6480', 0.9);
    ctx.fillText(ch.sub, p.x, titleY + Math.max(12, 15 * zoom));
    if (!unlocked) {
      ctx.font = '600 ' + Math.max(10, 12 * zoom) + 'px "Segoe UI","PingFang SC",sans-serif';
      ctx.fillStyle = '#ffd35c';
      ctx.fillText('🔒 ' + RG.Songs.unlockHint(ch), p.x, p.y + R * 0.95 + 26);
    } else if (ch.workshop) {
      ctx.font = '600 ' + Math.max(10, 12 * zoom) + 'px "Segoe UI","PingFang SC",sans-serif';
      ctx.fillStyle = U.rgba(acc, 0.95);
      ctx.fillText('点击进入编辑器 / 游玩自制谱', p.x, p.y + R * 0.95 + 26);
    } else {
      ctx.font = '600 ' + Math.max(9.5, 11.5 * zoom) + 'px Consolas,monospace';
      ctx.fillStyle = '#9aa5cc';
      ctx.fillText(prog.cleared + '/' + prog.total + ' 通关 · ★' + prog.stars + '/' + prog.maxStars, p.x, p.y + R * 0.95 + 26);
    }
    ctx.restore();

    this.chapterHits.push({ chapter: ch, x: p.x, y: p.y, r: R });
  };

  WorldMap.prototype._drawRoutes = function () {
    var ctx = this.ctx;
    var route = ['origin', 'pixel', 'abyss', 'core', 'zenith'];
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 2.6 * this.cam.zoom);
    for (var i = 0; i < route.length - 1; i++) {
      var a = RG.Songs.chapter(route[i]), b = RG.Songs.chapter(route[i + 1]);
      if (!a || !b) continue;
      var pa = this.toScreen(a.x, a.y), pb = this.toScreen(b.x, b.y);
      var open = RG.Songs.isChapterUnlocked(b);
      var grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
      grad.addColorStop(0, U.rgba(a.color, open ? 0.6 : 0.16));
      grad.addColorStop(1, U.rgba(b.color, open ? 0.6 : 0.16));
      ctx.strokeStyle = grad;
      ctx.setLineDash(open ? [12, 10] : [5, 12]);
      ctx.lineDashOffset = -this.time * (open ? 34 : 8);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.quadraticCurveTo((pa.x + pb.x) / 2 + 40, (pa.y + pb.y) / 2 - 60, pb.x, pb.y);
      ctx.stroke();
    }
    /* 起点 → 工坊 的支线 */
    var o = RG.Songs.chapter('origin'), ws = RG.Songs.chapter('workshop');
    if (o && ws) {
      var po = this.toScreen(o.x, o.y), pw = this.toScreen(ws.x, ws.y);
      ctx.strokeStyle = U.rgba(ws.color, 0.4);
      ctx.setLineDash([4, 9]);
      ctx.lineDashOffset = -this.time * 18;
      ctx.beginPath();
      ctx.moveTo(po.x, po.y);
      ctx.quadraticCurveTo(po.x - 120, po.y - 160, pw.x, pw.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  };

  WorldMap.prototype._drawNodes = function () {
    var ctx = this.ctx;
    var zoom = this.cam.zoom;
    RG.Songs.chapters.forEach(function (ch) {
      if (ch.workshop) {
        this._drawWorkshopNode(ch);
        return;
      }
      var unlocked = RG.Songs.isChapterUnlocked(ch);
      var prev = null;
      ch.songs.forEach(function (song, i) {
        var p = this.toScreen(song.node.x, song.node.y);
        var r = this._nodeRadius(ch, song);
        var songUnlocked = RG.Songs.isSongUnlocked(song);
        var rec = RG.Store.record(song.id, 0);
        var cleared = rec && rec.clear;
        var isSel = this.selected && this.selected.song === song;
        var isHover = this.hover && this.hover.song === song;

        /* 节点之间的连线 */
        if (prev) {
          ctx.strokeStyle = U.rgba(ch.color, cleared ? 0.5 : 0.2);
          ctx.lineWidth = Math.max(1, 2.2 * zoom);
          ctx.setLineDash(cleared ? [] : [4, 6]);
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        prev = p;

        ctx.save();
        if (song.boss && songUnlocked) {
          /* 首领曲：外圈旋转 */
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(this.time * 0.5);
          ctx.strokeStyle = U.rgba(ch.accent, 0.75);
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 7]);
          ctx.beginPath(); ctx.arc(0, 0, r + 10, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        /* 呼吸光环 */
        if (isSel || isHover || (songUnlocked && !cleared)) {
          var pulse = 0.5 + 0.5 * Math.sin(this.time * (isSel ? 4 : 2.2));
          ctx.strokeStyle = U.rgba(isSel ? '#ffffff' : ch.color, 0.35 + pulse * 0.4);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
        }
        /* 主体 */
        var grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, r * 0.15, p.x, p.y, r);
        if (!songUnlocked) {
          grad.addColorStop(0, '#242a3d'); grad.addColorStop(1, '#12151f');
        } else if (cleared) {
          grad.addColorStop(0, U.shade(ch.color, 0.35)); grad.addColorStop(1, U.shade(ch.color, -0.4));
        } else {
          grad.addColorStop(0, U.shade(ch.color, -0.1)); grad.addColorStop(1, '#161b2b');
        }
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = songUnlocked ? U.rgba('#ffffff', isSel ? 0.95 : 0.45) : 'rgba(120,130,160,0.3)';
        ctx.lineWidth = isSel ? 3 : 1.6;
        ctx.stroke();
        this.hits.push({ song: song, chapter: ch, x: p.x, y: p.y, r: r });

        /* 图标 / 文字 */
        ctx.textAlign = 'center';
        if (!songUnlocked) {
          ctx.font = '600 ' + Math.max(11, 15 * zoom) + 'px sans-serif';
          ctx.fillStyle = 'rgba(200,210,240,0.5)';
          ctx.fillText('🔒', p.x, p.y + 5 * zoom);
        } else {
          var lvl = song.diffs[song.diffs.length - 1].level;
          ctx.font = '800 ' + Math.max(10, 14 * zoom) + 'px Consolas,monospace';
          ctx.fillStyle = cleared ? '#08111c' : '#e8ecff';
          ctx.fillText('LV' + lvl, p.x, p.y + 5 * zoom);
        }
        /* 星级 */
        var stars = 0, diffCount = song.diffs.length;
        song.diffs.forEach(function (d, di) {
          var r2 = RG.Store.record(song.id, di);
          if (r2) stars = Math.max(stars, r2.stars || 0);
        });
        if (songUnlocked && stars > 0) {
          ctx.font = '600 ' + Math.max(9, 11 * zoom) + 'px sans-serif';
          ctx.fillStyle = '#ffd35c';
          ctx.fillText('★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars), p.x, p.y + r + 14 * zoom);
        }
        /* 标题 */
        ctx.font = '600 ' + Math.max(10, 12.5 * zoom) + 'px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillStyle = songUnlocked ? '#dfe6ff' : 'rgba(160,170,200,0.55)';
        ctx.fillText(song.title, p.x, p.y - r - 8 * zoom);
        ctx.restore();
      }, this);
    }, this);
  };

  WorldMap.prototype._drawWorkshopNode = function (ch) {
    var ctx = this.ctx;
    var p = this.toScreen(ch.node.x, ch.node.y);
    var r = 34 * U.clamp(this.cam.zoom, 0.5, 1.6);
    var count = RG.Store.customCharts().length;
    ctx.save();
    var pulse = 0.5 + 0.5 * Math.sin(this.time * 2);
    ctx.strokeStyle = U.rgba(ch.color, 0.3 + pulse * 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 8 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    var grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    grad.addColorStop(0, U.shade(ch.color, 0.2));
    grad.addColorStop(1, U.shade(ch.accent, -0.45));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '700 ' + Math.max(14, 20 * this.cam.zoom) + 'px sans-serif';
    ctx.fillStyle = '#0b1018';
    ctx.fillText('🛠', p.x, p.y + 6 * this.cam.zoom);
    ctx.font = '600 ' + Math.max(10, 12 * this.cam.zoom) + 'px Consolas,monospace';
    ctx.fillStyle = '#e8ecff';
    ctx.fillText(count + ' 个自制谱面', p.x, p.y + r + 18 * this.cam.zoom);
    ctx.restore();
    this.hits.push({ song: null, chapter: ch, x: p.x, y: p.y, r: r });
  };
})(typeof window !== 'undefined' ? window : globalThis);

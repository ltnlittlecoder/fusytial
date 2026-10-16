/* ==========================================================================
 * Resonance Engine · main.js
 * 应用装配：屏幕路由、主循环、游玩会话（引擎+渲染+输入+音频联动）
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;
  var UI = RG.UI;

  var app = RG.app = {
    session: null,
    settingsReturn: 'title',
    currentSong: null,
    currentChapter: null,
    currentDiff: 0,
    titleTheme: { a: '#38e8ff', b: '#ff4fd8' },
    fps: 60
  };

  /* ======================================================================
   * 启动
   * ====================================================================== */
  function boot() {
    UI.init(app);
    RG.Editor.init(app);
    if (RG.Preview && RG.Preview.init) RG.Preview.init();
    RG.Front.init(app);
    RG.Tutorial.init(app);
    app.renderer = new RG.Render(document.getElementById('game-canvas'), { settings: RG.Store.settings() });
    app.map = new RG.WorldMap({
      canvas: document.getElementById('map-canvas'),
      onPickSong: function (song, chapter) { app.pickSong(song, chapter); },
      onPickWorkshop: function () { app.showWorkshop(); },
      onHover: function (hit, x, y) {
        if (!hit || !hit.song) { UI.mapTip(null); return; }
        var s = hit.song;
        var rec = RG.Store.record(s.id, 0);
        var unlocked = RG.Songs.isSongUnlocked(s);
        var html = '<b>' + s.title + '</b><br>' + s.artist +
          '<br>' + s.diffs.length + ' 个难度 · 最高 LV' + s.diffs[s.diffs.length - 1].level +
          (unlocked ? (rec ? '<br>已通关 · ' + U.fmtPct(rec.acc) + ' · ★' + rec.stars : '<br>尚未通关') : '<br><span style="color:#ffd35c">🔒 ' + RG.Songs.songUnlockHint(s) + '</span>');
        UI.mapTip(html, x, y);
      }
    });
    app.map.onHover = function (hit, x, y) {
      if (!hit || !hit.song) { UI.mapTip(null); return; }
      var s = hit.song, rec = RG.Store.record(s.id, 0);
      var unlocked = RG.Songs.isSongUnlocked(s);
      UI.mapTip('<b>' + s.title + '</b><br>' + s.artist + '<br>' + s.diffs.length + ' 难度 · 最高 LV' + s.diffs[s.diffs.length - 1].level +
        (unlocked ? (rec ? '<br>已通关 · ' + U.fmtPct(rec.acc) + ' · ★' + rec.stars : '<br>尚未通关') : '<br><span style="color:#ffd35c">🔒 ' + RG.Songs.songUnlockHint(s) + '</span>'), x, y);
    };
    app.input = new RG.Input({
      lanes: 4, bindings: RG.Store.lanesFor(4),
      clock: function () { return RG.audio.now(); },
      laneAt: function (x, y) { return app.renderer ? app.renderer.laneAt(x, y) : -1; }
    });
    app.input.attach(window);
    app.input.enabled = false;

    wireButtons();
    wireFront();
    wireResize();
    wireGameInput();
    wireImport();

    RG.audio.setVolumes(RG.Store.get('musicVol'), RG.Store.get('sfxVol'));
    U.on(window, 'pointerdown', function once() {
      RG.audio.unlock();
      window.removeEventListener('pointerdown', once);
    });
    U.on(window, 'keydown', function once() {
      RG.audio.unlock();
      window.removeEventListener('keydown', once);
    });

    showTitle();
    requestAnimationFrame(frame);
  }

  /* ======================================================================
   * 屏幕路由
   * ====================================================================== */
  function showTitle() {
    UI.overlaysOff();
    UI.hideSongPanel();
    app.map.hide();
    app.input.enabled = false;
    RG.Front.showAttract();
    RG.audio.stop();
  }
  app.showTitle = showTitle;

  function showModes() {
    UI.overlaysOff();
    UI.hideSongPanel();
    app.map.hide();
    app.input.enabled = false;
    RG.Front.showModes();
    RG.audio.stop();
  }
  app.showModes = showModes;

  function chapterPick(ch) {
    app.map.focusChapter(ch);
    UI.renderChapterBar(ch.id, chapterPick);
    UI.hideSongPanel();
  }

  function showMap() {
    UI.overlaysOff();
    UI.hideSongPanel();
    app.input.enabled = false;
    if (RG.Preview) RG.Preview.unmount();
    RG.Songs.refreshWorkshop();
    UI.updateMapHud();
    var active = app.map.selectedChapter || RG.Songs.chapter('origin');
    app.map.focusChapter(active);
    UI.renderChapterBar(active ? active.id : null, chapterPick);
    UI.show('screen-map');
    app.map.show();
    RG.audio.stop();
  }
  app.showMap = showMap;

  function showSettings(from, tab) {
    app.settingsReturn = from || (UI.current === 'screen-map' ? 'map'
      : (UI.current === 'screen-profile' ? 'profile'
        : (app.session && app.session.paused ? 'pause' : 'modes')));
    UI.renderSettings(tab || (app.settingsReturn === 'pause' ? 'gameplay' : UI.settingsTab));
    UI.show('screen-settings');
    app.map.hide();
    app.input.enabled = false;
  }
  app.showSettings = showSettings;

  /** 清除所有本地数据（两步确认） */
  app.confirmWipe = function () {
    var items = ['成绩、星级与游玩统计', '成就', '自制谱面', '全部设置（含键位）'];
    UI.modal({
      title: '清除所有存档',
      body: '<div class="md-body">这会<b>永久删除</b>本机上的以下数据，且无法恢复：' +
        '<ul style="margin:10px 0 0 18px;line-height:2">' +
        items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '<div style="margin-top:12px;color:#8f9ac4">建议先在「档案」里导出一次存档备份。</div></div>',
      buttons: [
        { label: '取消' },
        {
          label: '继续', primary: true, danger: true, keepOpen: true, onClick: function () {
            UI.modal({
              title: '真的确定吗？',
              body: '<div class="md-body">清除后将回到待机画面，并且会**重新进入新手教程**。</div>',
              buttons: [
                { label: '我再想想' },
                { label: '永久删除', primary: true, danger: true, onClick: function () { app.doWipe(); } }
              ]
            });
          }
        }
      ]
    });
  };
  app.doWipe = function () {
    UI.overlay('screen-modal', false);
    RG.Store.wipeAll();
    RG.Chart.clearCache();
    RG.Art.clearCache && RG.Art.clearCache();
    app.applySettings();
    RG.Front.expanded = 'free';
    RG.Front.showAttract();
    UI.toast('所有存档已清除 · 回到待机画面', 'ok');
  };

  function showWorkshop() {
    UI.overlaysOff();
    UI.hideSongPanel();
    app.map.hide();
    app.input.enabled = false;
    if (RG.Preview) RG.Preview.unmount();
    UI.renderWorkshop(app.workshopHandlers());
    UI.show('screen-workshop');
    RG.audio.stop();
  }
  app.showWorkshop = showWorkshop;

  /* ======================================================================
   * 地图选曲
   * ====================================================================== */
  app.pickSong = function (song, chapter) {
    app.currentSong = song;
    app.currentChapter = chapter;
    if (app.currentDiff >= song.diffs.length) app.currentDiff = 0;
    app.map.setSelected(song, chapter);
    renderSongPanel();
  };

  function renderSongPanel() {
    var song = app.currentSong, chapter = app.currentChapter;
    if (!song) return;
    UI.showSongPanel(song, chapter, app.currentDiff, {
      onDiff: function (i) { app.currentDiff = i; renderSongPanel(); },
      /* 判定难度从设置里搬到了选曲面板（与难度选择左右并排） */
      onJudgeDifficulty: function (d) {
        UI.toast(d === 'lenient' ? '宽松：判定更宽，但成绩不计入档案'
          : (d === 'strict' ? '困难：判定更窄，扣血 ×2' : '标准判定'), 'ok');
      },
      onPlay: function () { startGame({ song: song, diffIndex: app.currentDiff, custom: !!song.custom, returnTo: 'map' }); },
      onAutoplay: function () { startGame({ song: song, diffIndex: app.currentDiff, autoplay: true, custom: !!song.custom, returnTo: 'map' }); },
      onEdit: function () { RG.Editor.open(song.chart, { title: song.title, music: song.chart.meta.music }, null); },
      onDelete: function () {
        RG.Store.removeChart(song.id);
        UI.hideSongPanel();
        RG.Chart.clearCache();
        app.refreshWorkshopMap();
        showMap();
        UI.toast('已删除谱面', 'ok');
      }
    });
  }
  app.refreshWorkshopMap = function () {
    app.currentSong = null;
    RG.Songs.refreshWorkshop();
    UI.updateMapHud();
    UI.renderChapterBar(app.map.selectedChapter ? app.map.selectedChapter.id : null, chapterPick);
  };

  /* ======================================================================
   * 工坊
   * ====================================================================== */
  app.workshopHandlers = function () {
    return {
      onPlay: function (chart) {
        var song = { id: chart.meta.id, title: chart.meta.title, artist: chart.meta.artist || '我', custom: true, chart: chart, diffs: [{ name: chart.meta.difficulty || '自定义', level: chart.meta.level, lanes: chart.meta.lanes, seed: 0 }], theme: chart.meta.theme || { a: '#ffd35c', b: '#5cff9d' } };
        startGame({ song: song, diffIndex: 0, custom: true, returnTo: 'workshop' });
      },
      onEdit: function (chart) { RG.Editor.open(chart, { title: chart.meta.title, music: chart.meta.music }, null); },
      onDuplicate: function (chart) {
        var c = RG.Chart.clone(chart);
        c.meta.id = U.uid('custom');
        c.meta.title = chart.meta.title + ' 副本';
        RG.Store.upsertChart(c);
        UI.renderWorkshop(app.workshopHandlers());
        UI.toast('已复制', 'ok');
      },
      onExport: function (chart) {
        U.download((chart.meta.title || 'chart') + '.rgchart.json', RG.Chart.serialize(chart, true));
        UI.toast('已导出谱面 JSON', 'ok');
      },
      onDelete: function (chart) {
        RG.Store.removeChart(chart.meta.id);
        UI.renderWorkshop(app.workshopHandlers());
        UI.toast('已删除', 'ok');
      }
    };
  };

  /* ======================================================================
   * 游玩会话
   * ====================================================================== */
  function mirrorChart(chart) {
    var L = chart.meta.lanes - 1;
    RG.Chart.normalize(chart);
    chart.notes.forEach(function (n) {
      n.lane = L - n.lane;
      if (n.type === 'slide' && n.tail !== undefined) n.tail = L - n.tail;
    });
    chart.notes.sort(function (a, b) { return a.t - b.t; });
    return chart;
  }

  function startGame(opts) {
    opts = opts || {};
    UI.overlaysOff();
    UI.loading(true, '载入曲目与谱面…');
    RG.audio.unlock();

    setTimeout(function () {
      var song = opts.song;
      var diffIndex = opts.diffIndex || 0;
      var chart = opts.chart ? RG.Chart.clone(opts.chart) : RG.Songs.chartFor(song, diffIndex);
      // 乐曲定义（决定实际播放的音频事件）；自定义谱面内嵌 music 定义
      var musicDef = (song.custom || opts.chart)
        ? (chart.meta.music || (song.music || RG.Editor.defaultMusicDef()))
        : song.music;
      if (!musicDef) musicDef = RG.Editor.defaultMusicDef();
      var music = RG.Music.build(musicDef);
      if (RG.Store.get('mirror')) chart = mirrorChart(chart);
      chart.meta.length = chart.meta.length || Math.round(music.duration);

      var settings = RG.Store.settings();
      var autoplay = opts.autoplay !== undefined ? !!opts.autoplay : !!settings.autoplay;
      var renderer = app.renderer;
      renderer.resize();
      renderer.setLanes(chart.meta.lanes);
      renderer.setTheme(song.theme || chart.meta.theme || app.titleTheme);
      /* 开始 / 重开：清空画布里的音符与特效，并从 2D 起步
         （谱面内嵌的切换环节到点再切 3D；这次切换是"硬切"，不留残影） */
      renderer.clearEffects();
      renderer.setView('2d', 0, true);
      UI.resetHUD();

      app.input.setLanes(chart.meta.lanes, RG.Store.lanesFor(chart.meta.lanes));
      app.input.reset();

      var engine = new RG.Engine({
        chart: chart, settings: settings, autoplay: autoplay,
        noFail: opts.noFail !== undefined ? !!opts.noFail : !!settings.noFail,
        isHeld: function (l) { return app.input.held(l); },
        heldKeys: function () { return app.input.heldKeyCount(); },   // 点划的键盘规则要求 ≥2 个键
        hooks: {
          onJudge: function (j) {
            var res = j.result;
            renderer.judge(j.note.lane, res, j.delta);
            if (RG.Store.get('hitSound') && !autoplay) RG.audio.hit(res === 'mine' ? 'mine' : res, res === 'perfect' ? 1 : 0.8);
          },
          onHoldStart: function () { },
          onHoldEnd: function (h) { renderer.holdEnd(h.note.lane); },
          /* 点划：滑动/两键完成时的方向感特效 */
          onSwipe: function (s) {
            if (renderer.swipe) renderer.swipe(s.lane, s.dx || 0, s.dy || 0, !!s.judged);
            if (s.judged && RG.Store.get('hitSound') && !autoplay) RG.audio.hit('great', 0.7);
          },
          onFlickFail: function () { },
          onFail: function () { endSession(true); }
        }
      });
      RG.audio.load(musicDef, 'play:' + (song.custom ? chart.meta.id : song.id + '::' + diffIndex));

      var firstPlayable = null;
      for (var i = 0; i < chart.notes.length; i++) {
        if (chart.notes[i].type !== 'mine') { firstPlayable = chart.notes[i]; break; }
      }
      var startAt = Math.max(0, (firstPlayable ? firstPlayable.t : 2) - 2.2);

      app.session = {
        song: song, diff: song.diffs[diffIndex] || song.diffs[0], diffIndex: diffIndex,
        chart: chart, music: music, musicDef: musicDef, engine: engine, autoplay: autoplay,
        startAt: startAt, countdown: 3.4, started: false, paused: false, done: false,
        returnTo: opts.returnTo || 'map', offsetTimer: 0, elapsed: 0, resumeCountdown: 0,
        viewMode: '2d', viewNext: RG.Chart.nextViewEvent(chart, 0),
        tutorial: opts.tutorial || null
      };
      UI.setGameTitle(song.title, (app.session.diff.name || '') + ' · LV ' + app.session.diff.level);
      UI.autoBadge(autoplay);
      app.input.enabled = autoplay ? false : true;
      UI.show('screen-game');
      UI.loading(false);
      UI.countdown('3');
    }, 30);
  }
  app.startGame = startGame;

  function pauseGame() {
    var s = app.session;
    if (!s || s.paused || s.done || !s.started) return;
    s.paused = true;
    RG.audio.pause();
    app.input.enabled = false;
    app.input.reset();
    var snap = s.engine.snapshot();
    snap.avgOffset = s.engine.avgOffset();
    UI.showPause(snap);
  }
  function resumeGame() {
    var s = app.session;
    if (!s) return;
    UI.overlay('screen-pause', false);
    s.paused = false;
    app.input.reset();
    app.input.enabled = !s.autoplay;
    RG.audio.resume();
    UI.countdown('3');
    s.resumeCountdown = 1.2;
  }
  function restartGame() {
    var s = app.session;
    if (!s) return;
    UI.overlaysOff();
    var opts = {
      song: s.song, diffIndex: s.diffIndex, autoplay: s.autoplay,
      custom: !!s.song.custom, returnTo: s.returnTo
    };
    // 编辑器试玩：回到编辑器当前内容；自制谱面：使用已保存的谱面
    if (s.returnTo === 'editor') opts.chart = RG.Editor.chart;
    else if (s.song.custom) opts.chart = s.song.chart;
    startGame(opts);
  }
  function endSession(failed) {
    var s = app.session;
    if (!s || s.done) return;
    s.done = true;
    RG.audio.stop();
    var res = s.engine.finish();
    s.pendingResult = res;
    s.pendingFailed = !!failed;
    s.endTimer = failed ? 0.9 : 1.1;
  }
  function quitGame() {
    var s = app.session;
    UI.overlaysOff();
    RG.audio.stop();
    app.input.enabled = false;
    app.session = null;
    if (s && s.returnTo === 'workshop') showWorkshop();
    else if (s && s.returnTo === 'editor') { UI.show('screen-editor'); }
    else if (s && s.returnTo === 'tutorial') { RG.Tutorial.open(); }
    else showMap();
  }

  function finishSession() {
    var s = app.session;
    if (!s || !s.pendingResult) return;
    var res = s.pendingResult;
    var improved = null;
    /* 宽松判定（未排位）与自动演示都不写入成绩档案 */
    if (!res.autoplay && !s.tutorial && res.ranked !== false) {
      var sub = RG.Store.submitResult(s.song.id, s.diffIndex, res);
      improved = sub.improved;
    }
    /* 新手教程：只判定步骤，不进成绩 */
    if (s.tutorial) {
      RG.Tutorial.onResult(s.tutorial.step, res);
      app.lastResult = { result: res, song: s.song, diffIndex: s.diffIndex, returnTo: 'tutorial' };
      return;
    }
    UI.showResult(res, s.song, s.diff, improved);
    RG.Achievements.check({ result: res, song: s.song, diff: s.diff });
    RG.Front.buildModes();
    app.lastResult = { result: res, song: s.song, diffIndex: s.diffIndex, returnTo: s.returnTo };
    UI.overlaysOff();
    UI.overlay('screen-result', true);
  }

  /* ======================================================================
   * 主循环
   * ====================================================================== */
  var lastT = 0;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    var dt = lastT ? Math.min(0.05, (nowMs - lastT) / 1000) : 0.016;
    lastT = nowMs;
    app.fps = app.fps * 0.92 + (1 / Math.max(0.001, dt)) * 0.08;
    var bands = RG.audio.ctx ? RG.audio.getBands(26) : null;
    app.bands = bands;

    var scr = UI.current;
    /* 实时预览：设置页与首页手风琴里都可能在放 */
    if (RG.Preview && RG.Preview.mounted && (scr === 'screen-settings' || scr === 'screen-modes')) {
      RG.Preview.tick(dt);
    }
    if (scr === 'screen-title' || scr === 'screen-modes') {
      RG.Front.tick(dt, nowMs, bands);
    } else if (scr === 'screen-tutorial') {
      RG.Tutorial.tick(dt, bands);
    } else if (scr === 'screen-map') {
      app.map.render(dt);
    } else if (scr === 'screen-game') {
      gameStep(dt);
    }
  }

  function gameStep(dt) {
    var s = app.session;
    if (!s) return;
    var renderer = app.renderer;
    var bands = app.bands;
    var fps = Math.round(app.fps);

    /* 倒计时 */
    if (!s.started) {
      s.countdown -= dt;
      var n = Math.ceil(s.countdown);
      UI.countdown(n > 0 ? String(n) : 'GO');
      if (s.countdown <= 0) {
        s.started = true;
        UI.countdown(null);
        RG.audio.play(s.startAt);
      }
      renderer.draw({
        now: RG.audio.now() - s.chart.meta.offsetSec, dt: dt, notes: s.engine.notes,
        lanes: s.chart.meta.lanes, music: s.music, bands: bands
      });
      UI.updateHUD({ score: 0, acc: 1, life: 100, combo: 0, progress: 0, fps: fps });
      return;
    }
    if (s.resumeCountdown > 0) {
      s.resumeCountdown -= dt;
      UI.countdown(s.resumeCountdown > 0.4 ? String(Math.ceil(s.resumeCountdown / 0.4)) : 'GO');
      if (s.resumeCountdown <= 0) UI.countdown(null);
    }
    if (s.paused) {
      renderer.draw({
        now: RG.audio.now() - s.chart.meta.offsetSec, dt: 0, notes: s.engine.notes,
        lanes: s.chart.meta.lanes, music: s.music, bands: bands
      });
      return;
    }

    /* 输入 → 判定 → 更新 */
    if (!s.done) {
      var evs = app.input.consume();
      if (evs) s.engine.handleEvents(evs);
      var ct = RG.audio.now() - s.chart.meta.offsetSec;
      s.engine.update(ct);
      s.elapsed += dt;
      /* 谱面内嵌的 2D/3D 切换环节（HUD 与画布上都有提示，不弹 toast 干扰演奏） */
      var vCur = RG.Chart.viewAt(s.chart, ct);
      if (vCur.mode !== s.viewMode) {
        s.viewMode = vCur.mode;
        renderer.setView(vCur.mode, vCur.dur);
      }
      s.viewNext = RG.Chart.nextViewEvent(s.chart, ct);
      if (s.engine.finished) endSession(false);   // 自然打完整首
    } else {
      s.endTimer -= dt;
      if (s.endTimer <= 0) {
        finishSession();
        return;
      }
    }

    var now = RG.audio.now() - s.chart.meta.offsetSec;
    renderer.draw({
      now: now, dt: s.done ? dt * 0.35 : dt, notes: s.engine.notes, lanes: s.chart.meta.lanes,
      music: s.music, bands: bands, combo: s.engine.combo || 0,
      viewNext: s.viewNext || null
    });

    var snap = s.engine.snapshot();
    snap.fps = fps;
    snap.viewMode = s.viewMode;
    /* 不再有剧情目标条；底部也不显示任何文字（偏移/早晚统计已移除，只在结算里看） */
    UI.updateHUD(snap);
  }

  /* ======================================================================
   * 交互装配
   * ====================================================================== */
  function wireButtons() {
    U.on(document, 'click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!el) return;
      var a = el.getAttribute('data-action');
      RG.audio.ui(a === 'back-title' ? 'back' : 'confirm');
      switch (a) {
        case 'play': showMap(); break;
        case 'workshop': showWorkshop(); break;
        case 'settings': showSettings('modes'); break;
        case 'help': UI.showHelp(); break;
        case 'games': showModes(); break;
        case 'back-modes': showModes(); break;
        case 'back-title': showTitle(); break;
        case 'settings-back':
          if (app.settingsReturn === 'pause' && app.session) { UI.show('screen-game'); UI.overlay('screen-pause', true); }
          else if (app.settingsReturn === 'map') showMap();
          else if (app.settingsReturn === 'profile') RG.Front.showProfile();
          else showModes();
          break;
        case 'export-save':
          U.download('resonance-save.json', RG.Store.exportAll());
          UI.toast('已导出存档', 'ok');
          break;
        case 'import-save':
          var fi2 = document.getElementById('import-file');
          fi2.dataset.mode = 'save';
          fi2.click();
          break;
        case 'tut-skip': RG.Tutorial.close(true); break;
        case 'wipe-save': app.confirmWipe(); break;
        case 'open-settings': showSettings('map'); break;
        case 'reset-settings':
          UI.confirm('恢复默认设置', '所有设置项将恢复默认值（存档与谱面不受影响）。', function () {
            RG.Store.resetSettings();
            app.applySettings();
            UI.renderSettings();
            UI.toast('已恢复默认设置', 'ok');
          });
          break;
        case 'zoom-in': app.map.zoomBy(1.2); break;
        case 'zoom-out': app.map.zoomBy(1 / 1.2); break;
        case 'zoom-reset': app.map.resetView(); break;
        case 'new-chart': RG.Editor.open(null); break;
        case 'gen-chart': RG.Editor.generateDialog(); break;
        case 'import-chart':
          var fi = document.getElementById('import-file');
          fi.dataset.mode = 'chart';
          fi.click();
          break;
        case 'ed-save': RG.Editor.save(); break;
        case 'ed-save-back': RG.Editor.close(true); break;
        case 'ed-export':
          U.download((RG.Editor.chart.meta.title || 'chart') + '.rgchart.json', RG.Chart.serialize(RG.Editor.chart, true));
          UI.toast('已导出谱面 JSON', 'ok');
          break;
        case 'ed-playtest':
          RG.Editor.stop();
          startGame({
            song: {
              id: RG.Editor.chart.meta.id, title: RG.Editor.chart.meta.title, artist: '我', custom: true,
              chart: RG.Editor.chart, theme: RG.Editor.chart.meta.theme || { a: '#ffd35c', b: '#5cff9d' },
              diffs: [{ name: RG.Editor.chart.meta.difficulty || '自定义', level: RG.Editor.chart.meta.level, lanes: RG.Editor.chart.meta.lanes }]
            },
            diffIndex: 0, chart: RG.Editor.chart, custom: true, returnTo: 'editor'
          });
          break;
        case 'ed-undo': RG.Editor.undo(); break;
        case 'ed-redo': RG.Editor.redo(); break;
        case 'ed-copy': RG.Editor.copy(); break;
        case 'ed-paste': RG.Editor.paste(); break;
        case 'ed-del': RG.Editor.remove(RG.Editor.selection); break;
        case 'ed-mirror': RG.Editor.mirror(); break;
        case 'ed-quantize': RG.Editor.quantize(); break;
        case 'ed-clear': RG.Editor.clear(); break;
        case 'ed-toggle-play': RG.Editor.toggle(); break;
        case 'ed-stop': RG.Editor.stop(); RG.Editor.seek(0); break;
        case 'ed-metro':
          RG.Editor.metronome = !RG.Editor.metronome;
          RG.Store.set('editorMetronome', RG.Editor.metronome);
          el.classList.toggle('on', RG.Editor.metronome);
          break;
        case 'ed-generate': RG.Editor.generate(parseInt(document.getElementById('ed-gen-level').value, 10) || 8); break;
        case 'pause': pauseGame(); break;
        case 'resume': resumeGame(); break;
        case 'restart': UI.overlay('screen-pause', false); restartGame(); break;
        case 'quit': quitGame(); break;
        case 'res-retry': UI.overlay('screen-result', false); restartGame(); break;
        case 'res-back-map':
          UI.overlay('screen-result', false);
          if (app.lastResult && app.lastResult.returnTo === 'workshop') showWorkshop();
          else if (app.lastResult && app.lastResult.returnTo === 'editor') { app.session = null; UI.show('screen-editor'); }
          else { app.session = null; showMap(); }
          break;
      }
    });

    /* 设置返回 */
    document.getElementById('screen-settings').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-action="settings-back"]') : null;
      if (!el) return;
    });
    /* 用 Esc / 空格做屏幕级快捷操作 */
    U.on(window, 'keydown', function (e) {
      if (UI.current === 'screen-game') {
        if (e.code === 'Escape') { app.session && app.session.paused ? resumeGame() : pauseGame(); }
        return;
      }
      if (UI.current === 'screen-editor') return;
      if (e.code === 'Escape') {
        if (!document.getElementById('screen-modal').classList.contains('hidden')) { UI.overlay('screen-modal', false); return; }
        if (UI.current === 'screen-title') return;
        showTitle();
      }
    });
  }

  function wireGameInput() {
    var cv = document.getElementById('game-canvas');
    U.on(cv, 'pointerdown', function (e) {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      var r = cv.getBoundingClientRect();
      app.input.pointerDown(e.pointerId, e.clientX - r.left, e.clientY - r.top);
    });
    U.on(cv, 'pointermove', function (e) {
      if (!app.input.pointers[e.pointerId]) return;
      var r = cv.getBoundingClientRect();
      app.input.pointerMove(e.pointerId, e.clientX - r.left, e.clientY - r.top);
    });
    var up = function (e) {
      var r = cv.getBoundingClientRect();
      app.input.pointerUp(e.pointerId, e.clientX - r.left, e.clientY - r.top);
    };
    U.on(cv, 'pointerup', up);
    U.on(cv, 'pointercancel', up);
    U.on(cv, 'contextmenu', function (e) { e.preventDefault(); });
  }

  function wireImport() {
    var fi = document.getElementById('import-file');
    U.on(fi, 'change', function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      var mode = fi.dataset.mode;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (mode === 'save') {
            RG.Store.importAll(String(reader.result));
            app.applySettings();
            UI.renderSettings('data');
            UI.toast('存档已导入', 'ok');
          } else {
            var chart = RG.Chart.parse(String(reader.result));
            chart.meta.id = chart.meta.id || U.uid('custom');
            chart.meta.builtin = false;
            RG.Store.upsertChart(chart);
            if (UI.current === 'screen-workshop') UI.renderWorkshop(app.workshopHandlers());
            app.refreshWorkshopMap();
            UI.toast('已导入谱面「' + chart.meta.title + '」', 'ok');
          }
        } catch (err) {
          UI.toast('导入失败：' + (err.message || err), 'err');
        }
        fi.value = '';
      };
      reader.readAsText(f);
    });
  }

  function wireResize() {
    U.on(window, 'resize', function () {
      app.renderer.resize();
      app.map.resize();
      RG.Editor.resize();
      if (UI.current === 'screen-map') app.map.show();
    });
  }

  /* 设置变更的实时应用 */
  app.onSettingChanged = function (key, v) {
    if (key === 'musicVol' || key === 'sfxVol') {
      RG.audio.setVolumes(RG.Store.get('musicVol'), RG.Store.get('sfxVol'));
    }
    if (key === 'camera.fov' || key === 'camera.height' || key === 'camera.dist' ||
      key === 'camera.width' || key === 'camera.speed' || key === 'camera.curve' || key === 'judgeLine') {
      app.renderer._layout();
    }
    if (key === 'showCombo' || key === 'showFps') UI.resetHUDCache();
  };
  app.applySettings = function () {
    var s = RG.Store.settings();
    RG.audio.setVolumes(s.musicVol, s.sfxVol);
    app.renderer.settings = s;
    app.renderer._layout();
    if (app.session) {
      app.session.engine.settings = s;
      app.session.engine.noFail = !!s.noFail;
      app.session.engine.win = RG.Engine.PRESETS[s.judgeDifficulty] || RG.Engine.PRESETS.normal;
      if (s.judgeDifficulty === 'custom') app.session.engine.win = s.customWindows;
      app.input.setLanes(app.session.chart.meta.lanes, RG.Store.lanesFor(app.session.chart.meta.lanes));
    }
  };
  app.rebuildInput = function () {
    app.input.setLanes(RG.Store.get('defaultLanes') || 4, RG.Store.lanesFor(RG.Store.get('defaultLanes') || 4));
    if (app.session) app.input.setLanes(app.session.chart.meta.lanes, RG.Store.lanesFor(app.session.chart.meta.lanes));
  };

  /* 设置页「返回」由 data-action="settings-back" 处理（见 wireButtons） */

  /* 主页 / 模式选取 / 故事模式的键盘与点击 */
  function wireFront() {
    var titleEl = document.getElementById('screen-title');
    U.on(titleEl, 'pointerdown', function (ev) {
      if (UI.current !== 'screen-title') return;
      if (ev.target.closest && ev.target.closest('button')) return;
      RG.Front.tap();
    });
    U.on(window, 'keydown', function (ev) {
      var scr = UI.current;
      if (scr === 'screen-title') {
        if (/Shift|Control|Alt|Meta/.test(ev.code)) return;
        if (ev.preventDefault) ev.preventDefault();
        RG.Front.tap();
        return;
      }
      if (scr === 'screen-modes') {
        if (ev.code === 'ArrowUp') { ev.preventDefault(); RG.Front.moveSelection(-1); }
        else if (ev.code === 'ArrowDown') { ev.preventDefault(); RG.Front.moveSelection(1); }
        else if (ev.code === 'ArrowLeft') { ev.preventDefault(); RG.Front.expand('free', false); }
        else if (ev.code === 'ArrowRight') { ev.preventDefault(); RG.Front.moveOpen(1); }
        else if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'NumpadEnter') { ev.preventDefault(); RG.Front.enterSelected(); }
        else if (ev.code === 'Escape') showTitle();
        return;
      }
      if (scr === 'screen-tutorial') {
        if (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'NumpadEnter') {
          ev.preventDefault();
          var btns = RG.Tutorial.cardEl.querySelectorAll('.gbtn');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].classList.contains('accent')) { btns[i].click(); return; }
          }
        } else if (ev.code === 'Escape') { RG.Tutorial.close(true); }
        return;
      }
    });
  }

  if (typeof document === 'undefined') return;   // 无头测试环境：只暴露命名空间
  if (document.readyState === 'loading') U.on(document, 'DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);

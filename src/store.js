/* ==========================================================================
 * Resonance Engine · store.js
 * 设置与存档：默认值、读写、进度记录、自定义谱面、导入导出
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  var KEY_SETTINGS = 'rg.settings.v1';
  var KEY_SAVE = 'rg.save.v1';

  /* ---------------- 默认设置 ---------------- */
  var BIND_PRESETS = {
    4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
    6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
    8: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
    10: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
  };
  var BIND_PRESETS_ALT = {
    4: ['KeyF', 'KeyG', 'KeyH', 'KeyJ'],
    6: ['KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK', 'KeyL'],
    8: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyN', 'KeyM', 'Comma', 'Period'],
    10: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']
  };

  /* rev=2：3D 视野调高（FOV 62°→72°，机位 1.5→2.1，判定线不再随机位漂移）
     rev=3：取消全局 2D/3D 开关 —— 视角改由谱面内嵌的切换环节控制 */
  var SETTINGS_REV = 5;
  /* 3D 相机参数：完全内置，不属于设置（相机距离 2.4、速度系数 0.8、俯角 48°） */
  var CAMERA = { fov: 72, pitch: 48, height: 2.1, dist: 2.4, width: 4.2, speed: 0.8, curve: 0.0 };
  var DEFAULT_SETTINGS = {
    version: 1,
    rev: SETTINGS_REV,      // 设置结构版本（用于默认值迁移）
    /* 游玩 */
    scrollSpeed: 6.0,       // 1..12
    judgeDifficulty: 'normal',  // lenient | normal | strict | custom
    customWindows: { perfect: 40, great: 78, good: 122, miss: 155 }, // ms（仅 custom 生效）
    offsetMs: 0,            // 全局偏移（毫秒，正值=音符整体提前）
    laneOffsetMs: [],       // 每轨微调
    defaultLanes: 4,
    mirror: false,
    noFail: false,
    autoplay: false,
    hitSound: true,
    showCombo: true,
    showEarlyLate: true,
    /* 音频 */
    musicVol: 0.8,
    sfxVol: 0.6,
    musicLatencyComp: true,
    /* 外观 */
    skin: 'neon',           // neon | minimal | solid
    noteSize: 1.0,
    bgDim: 0.55,
    effects: 'high',        // off | low | high
    judgeLine: 0.82,        // 2D 判定线位置 0.55..0.93
    laneOpacity: 1.0,
    background: 'auto',     // auto | stars | grid | bars | none
    /* 编辑器 */
    editorSnap: 4,          // 1/4 拍
    editorZoom: 150,        // px per second
    editorMetronome: false,
    editorPlaybackRate: 1.0,
    /* 键位 */
    bindings: {
      4: BIND_PRESETS[4].slice(),
      6: BIND_PRESETS[6].slice(),
      8: BIND_PRESETS[8].slice(),
      10: BIND_PRESETS[10].slice()
    }
  };

  var DEFAULT_SAVE = {
    version: 1,
    progress: {},        // "songId::diffIndex" -> record
    editorDraft: null,
    customCharts: [],    // 自定义谱面（chart 对象）
    stats: { plays: 0, clears: 0, notes: 0, perfects: 0, playTime: 0, fullCombo: 0, allPerfect: 0 },
    lastSong: null,
    lastDiff: 0,
    seenHelp: false,
    /* 成就 */
    achievements: {},
    /* 新手教程 */
    tutorialDone: false,
    tutorialStep: 0
  };

  var rawSettings = U.loadJSON(KEY_SETTINGS, {}) || {};
  var settings = U.deepMerge(DEFAULT_SETTINGS, rawSettings);
  var save = U.deepMerge(DEFAULT_SAVE, U.loadJSON(KEY_SAVE, {}) || {});
  // 数组字段 deepMerge 会整体覆盖，这里保证键位表完整
  for (var lk in BIND_PRESETS) {
    if (!Array.isArray(settings.bindings[lk]) || settings.bindings[lk].length !== Number(lk)) {
      settings.bindings[lk] = BIND_PRESETS[lk].slice();
    }
  }

  /* ---------------- 默认值迁移 ---------------- *
   * 老存档里的旧默认值会被升级；玩家手动改过的值不会被覆盖。
   * 注意要看「存档里的 rev」，不能看合并后的。 */
  (function migrate() {
    /* rev6：剧情系统整体移除 —— 老存档里的 story 字段与剧情成就一起清掉 */
    var saveChanged = false;
    if (save.story !== undefined) { delete save.story; saveChanged = true; }
    if (save.achievements) {
      ['story-ch1', 'story-clear'].forEach(function (k) {
        if (save.achievements[k] !== undefined) { delete save.achievements[k]; saveChanged = true; }
      });
    }
    if (saveChanged) U.saveJSON(KEY_SAVE, save);
    /* rev5：3D 相机参数改为内置（不再暴露成设置），并移除帧率显示开关 */
    delete settings.camera;
    if (settings.showFps !== undefined) delete settings.showFps;
    /* rev4：移除 AI 生图相关的设置与缓存 */
    if (settings.aiArt !== undefined) delete settings.aiArt;
    if (settings.view3d !== undefined) delete settings.view3d;
    if ((rawSettings.rev || 1) >= SETTINGS_REV) return;
    settings.rev = SETTINGS_REV;
    U.saveJSON(KEY_SETTINGS, settings);
  })();

  var S = RG.Store = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_SAVE: DEFAULT_SAVE,
    CAMERA: CAMERA,              // 内置 3D 相机参数（渲染器直接读，不属于设置）
    BIND_PRESETS: BIND_PRESETS,
    BIND_PRESETS_ALT: BIND_PRESETS_ALT,

    settings: function () { return settings; },
    set: function (path, value) {
      var parts = String(path).split('.');
      var cur = settings;
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      S.saveSettings();
      return value;
    },
    get: function (path, dflt) {
      var parts = String(path).split('.'), cur = settings;
      for (var i = 0; i < parts.length; i++) {
        if (cur === null || cur === undefined) return dflt;
        cur = cur[parts[i]];
      }
      return cur === undefined ? dflt : cur;
    },
    saveSettings: function () { U.saveJSON(KEY_SETTINGS, settings); },
    resetSettings: function () {
      settings = U.deepClone(DEFAULT_SETTINGS);
      S.saveSettings();
      return settings;
    },
    lanesFor: function (n) {
      if (!settings.bindings[n] || settings.bindings[n].length !== n) {
        settings.bindings[n] = (BIND_PRESETS[n] || BIND_PRESETS[4]).slice(0, n);
        while (settings.bindings[n].length < n) settings.bindings[n].push('Key' + String.fromCharCode(65 + settings.bindings[n].length));
      }
      return settings.bindings[n];
    },
    setBinding: function (lanes, index, code) {
      var arr = S.lanesFor(lanes).slice();
      // 去重：同一键位不能绑定两个轨道
      for (var i = 0; i < arr.length; i++) if (i !== index && arr[i] === code) arr[i] = arr[index];
      arr[index] = code;
      settings.bindings[lanes] = arr;
      S.saveSettings();
    },

    /* ---------------- 存档 ---------------- */
    save: function () { return save; },
    persist: function () { U.saveJSON(KEY_SAVE, save); },
    recKey: function (songId, diffIndex) { return songId + '::' + diffIndex; },
    record: function (songId, diffIndex) {
      return save.progress[S.recKey(songId, diffIndex)] || null;
    },
    /** 提交一次游玩结果，返回 {record, improved:{score,acc,combo,clear,stars}} */
    submitResult: function (songId, diffIndex, result) {
      var k = S.recKey(songId, diffIndex);
      var old = save.progress[k] || { score: 0, acc: 0, stars: 0, maxCombo: 0, grade: '-', clear: false, plays: 0, fc: false, ap: false, miss: 0 };
      var improved = {
        score: result.score > old.score,
        acc: result.acc > old.acc,
        combo: result.maxCombo > old.maxCombo,
        clear: result.clear && !old.clear,
        stars: result.stars > old.stars
      };
      var rec = {
        score: Math.max(old.score, result.score),
        acc: Math.max(old.acc, result.acc),
        maxCombo: Math.max(old.maxCombo, result.maxCombo),
        stars: Math.max(old.stars, result.stars),
        grade: (result.acc >= old.acc) ? result.grade : old.grade,
        clear: old.clear || result.clear,
        fc: old.fc || !!result.fc,
        ap: old.ap || !!result.ap,
        miss: Math.min(old.miss === undefined ? 9999 : old.miss, result.miss),
        plays: (old.plays || 0) + 1,
        lastScore: result.score,
        lastAcc: result.acc,
        date: Date.now()
      };
      save.progress[k] = rec;
      var st = save.stats;
      st.plays++; st.notes += result.totalNotes || 0; st.perfects += result.perfect || 0;
      st.playTime += result.duration || 0;
      if (result.clear) st.clears++;
      if (result.fc) st.fullCombo++;
      if (result.ap) st.allPerfect++;
      S.persist();
      return { record: rec, improved: improved };
    },
    totalStars: function () {
      var n = 0;
      for (var k in save.progress) n += (save.progress[k].stars || 0);
      return n;
    },
    clearedCount: function () {
      var n = 0;
      for (var k in save.progress) if (save.progress[k].clear) n++;
      return n;
    },
    resetProgress: function () {
      save.progress = {};
      save.stats = U.deepClone(DEFAULT_SAVE.stats);
      S.persist();
    },
    /** 只重置成就（成绩、谱面保留） */
    resetAchievements: function () {
      save.achievements = {};
      S.persist();
    },
    /** 是否全新存档（决定 TAP TO START 后是否先进新手教程） */
    isFresh: function () {
      var anyProgress = Object.keys(save.progress || {}).length > 0;
      var anyCustom = (save.customCharts || []).length > 0;
      var anyAch = Object.keys(save.achievements || {}).length > 0;
      return !anyProgress && !anyCustom && !anyAch && !save.tutorialDone;
    },
    /** 彻底清除所有本地数据：进度、成就、自制谱面、设置 */
    wipeAll: function () {
      settings = U.deepClone(DEFAULT_SETTINGS);
      save = U.deepClone(DEFAULT_SAVE);
      U.storage.remove(KEY_SETTINGS);
      U.storage.remove(KEY_SAVE);
      U.storage.remove('rg.aiart.v1');      // 旧版本遗留的 AI 图片缓存，顺手清掉
      S.persist();
      S.saveSettings();
      return true;
    },

    /* ---------------- 自定义谱面 ---------------- */
    customCharts: function () { return save.customCharts; },
    getChart: function (id) {
      for (var i = 0; i < save.customCharts.length; i++) if (save.customCharts[i].meta.id === id) return save.customCharts[i];
      return null;
    },
    upsertChart: function (chart) {
      var list = save.customCharts;
      for (var i = 0; i < list.length; i++) {
        if (list[i].meta.id === chart.meta.id) { list[i] = chart; S.persist(); return chart; }
      }
      list.push(chart);
      S.persist();
      return chart;
    },
    removeChart: function (id) {
      save.customCharts = save.customCharts.filter(function (c) { return c.meta.id !== id; });
      S.persist();
    },
    exportAll: function () {
      return JSON.stringify({ kind: 'rg-save', version: 1, settings: settings, save: save }, null, 2);
    },
    importAll: function (text) {
      var data = JSON.parse(text);
      if (!data || data.kind !== 'rg-save') throw new Error('不是有效的存档文件');
      if (data.settings) { settings = U.deepMerge(DEFAULT_SETTINGS, data.settings); S.saveSettings(); }
      if (data.save) { save = U.deepMerge(DEFAULT_SAVE, data.save); S.persist(); }
      return true;
    },
    clearCustomCharts: function () { save.customCharts = []; S.persist(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);

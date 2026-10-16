/* ==========================================================================
 * Resonance Engine · screens.js
 * 界面层：标题 / 设置 / 选曲面板 / 章节栏 / 工坊列表 / 暂停 / 结算 / 弹窗
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  var UI = RG.UI = {
    app: null,
    current: null,
    settingsTab: 'gameplay',
    _cache: {}
  };

  UI.init = function (app) {
    UI.app = app;
    UI.el = {};
    ['screen-title', 'screen-map', 'screen-settings', 'screen-workshop', 'screen-editor', 'screen-game',
      'screen-pause', 'screen-result', 'screen-loading', 'screen-modal', 'map-chapter-bar', 'song-panel',
      'map-tip', 'toast-host', 'settings-tabs', 'settings-body', 'ws-grid', 'import-file',
      'countdown', 'auto-badge', 'gh-life', 'gh-combo', 'gh-pause-progress', 'gh-score', 'gh-acc',
      'gh-title', 'gh-diff', 'map-total-stars', 'map-progress', 'res-grade', 'res-title', 'res-diff',
      'res-stars', 'res-grid', 'load-text', 'modal-card',
      /* 主页 / 模式选取 / 档案 */
      'title-bg', 'tap-hint', 'title-meta', 'modes-bg', 'mode-list', 'mode-detail',
      'profile-tabs', 'profile-body', 'settings-preview', 'song-panel'].forEach(function (id) {
        UI.el[id] = document.getElementById(id);
      });
    return UI;
  };

  /* ---------------- 屏幕切换 ---------------- */
  UI.show = function (id) {
    U.$$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    UI.current = id;
  };
  UI.overlay = function (id, on) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !on);
  };
  UI.overlaysOff = function () {
    ['screen-pause', 'screen-result', 'screen-loading', 'screen-modal'].forEach(function (id) { UI.overlay(id, false); });
  };
  UI.loading = function (on, text) {
    if (text) UI.el['load-text'].textContent = text;
    UI.overlay('screen-loading', on);
  };

  /* ---------------- 提示 ---------------- */
  UI.toast = function (msg, kind) {
    var host = UI.el['toast-host'];
    var t = U.el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s,transform .3s';
      t.style.opacity = '0'; t.style.transform = 'translateY(10px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 2200);
  };

  UI.modal = function (cfg) {
    var card = U.clear(UI.el['modal-card']);
    card.appendChild(U.el('h2', { text: cfg.title || '提示' }));
    if (cfg.body) card.appendChild(U.el('div', { class: 'md-body', html: cfg.body }));
    var btns = U.el('div', { class: 'ov-btns' });
    (cfg.buttons || [{ label: '确定', primary: true }]).forEach(function (b) {
      btns.appendChild(U.el('button', {
        class: 'gbtn big' + (b.primary ? ' accent' : '') + (b.danger ? ' danger' : ''),
        text: b.label,
        onclick: function () { if (b.onClick) b.onClick(); if (b.keepOpen !== true) UI.overlay('screen-modal', false); }
      }));
    });
    card.appendChild(btns);
    UI.overlay('screen-modal', true);
  };
  UI.confirm = function (title, text, onYes) {
    UI.modal({
      title: title, body: text, buttons: [
        { label: '取消' },
        { label: '确定', primary: true, danger: true, onClick: onYes }
      ]
    });
  };

  /* ---------------- 标题界面 ---------------- */
  /** 主页底部的小统计条（待机画面用） */
  UI.renderTitleStats = function (hostId) {
    var st = RG.Store.save().stats;
    var host = U.clear(document.getElementById(hostId || 'title-meta'));
    if (!host) return;
    var rows = [
      ['★ 总星数', RG.Store.totalStars()],
      ['通关谱面', RG.Store.clearedCount()],
      ['游玩次数', st.plays],
      ['自制谱面', RG.Store.customCharts().length],
      ['累计音符', U.fmtScore(st.notes)]
    ];
    rows.forEach(function (r) {
      host.appendChild(U.el('div', { html: '<b>' + r[1] + '</b>' + r[0] }));
    });
  };

  /* ---------------- 章节栏 ---------------- */
  UI.renderChapterBar = function (activeId, onPick) {
    var host = U.clear(UI.el['map-chapter-bar']);
    RG.Songs.chapters.forEach(function (ch) {
      var unlocked = RG.Songs.isChapterUnlocked(ch);
      var prog = RG.Songs.chapterProgress(ch);
      var card = U.el('div', {
        class: 'chapter-card' + (activeId === ch.id ? ' sel' : '') + (unlocked ? '' : ' locked'),
        style: 'border-left-color:' + ch.color,
        onclick: function () { if (unlocked) onPick(ch); else UI.toast('章节未解锁：' + RG.Songs.unlockHint(ch), 'err'); }
      }, [
        U.el('div', { class: 'cc-name', html: (unlocked ? '' : '🔒 ') + ch.name + (ch.secret && !unlocked ? ' <span style="font-size:10px;color:#8f9ac4">隐藏</span>' : '') }),
        U.el('div', { class: 'cc-sub', text: ch.sub + (ch.workshop ? ' · ' + RG.Store.customCharts().length + ' 谱面' : ' · ★' + prog.stars + '/' + prog.maxStars) }),
        U.el('div', { class: 'cc-bar' }, [U.el('i', { style: 'width:' + Math.round((ch.workshop ? 1 : prog.ratio) * 100) + '%' })])
      ]);
      host.appendChild(card);
    });
  };

  UI.updateMapHud = function () {
    UI.el['map-total-stars'].innerHTML = '★ <b>' + RG.Store.totalStars() + '</b>';
    var total = 0, got = 0;
    RG.Songs.chapters.forEach(function (ch) {
      if (ch.workshop) return;
      var p = RG.Songs.chapterProgress(ch);
      total += p.total; got += p.cleared;
    });
    UI.el['map-progress'].textContent = '探索度 ' + (total ? Math.round(got / total * 100) : 0) + '%';
  };

  /* ---------------- 选曲面板 ---------------- */
  UI.showSongPanel = function (song, chapter, activeDiff, handlers) {
    var host = UI.el['song-panel'];
    host.classList.remove('hidden');
    U.clear(host);
    var isCustom = !!song.custom;
    host.appendChild(U.el('div', { class: 'sp-title', text: song.title }));
    host.appendChild(U.el('div', { class: 'sp-artist', text: song.artist + (isCustom ? ' · 自制' : '') }));
    var tags = U.el('div', { class: 'sp-tags' });
    tags.appendChild(U.el('span', { class: 'tag', text: chapter.name }));
    tags.appendChild(U.el('span', { class: 'tag', text: 'BPM ' + (isCustom ? song.chart.meta.bpm : song.music.bpm) }));
    if (song.boss) tags.appendChild(U.el('span', { class: 'tag', text: '★ 首领曲' }));
    if (isCustom) tags.appendChild(U.el('span', { class: 'tag', text: RG.Chart.stats(song.chart).total + ' 音符' }));
    host.appendChild(tags);
    if (song.desc) host.appendChild(U.el('div', { class: 'sp-desc', text: song.desc }));

    /* 难度选择 + 判定难度：左右并列 */
    var cols = U.el('div', { class: 'sp-cols' });

    var colL = U.el('div', { class: 'sp-col' });
    colL.appendChild(U.el('div', { class: 'sp-section', text: '难度选择' }));
    var list = U.el('div', { class: 'diff-list' });
    song.diffs.forEach(function (d, i) {
      var rec = RG.Store.record(song.id, i);
      var stars = rec ? (rec.stars || 0) : 0;
      var row = U.el('div', {
        class: 'diff-row' + (i === activeDiff ? ' sel' : ''),
        onclick: function () { handlers.onDiff(i); }
      }, [
        U.el('div', {}, [
          U.el('div', { class: 'diff-name', text: d.name }),
          U.el('div', { class: 'diff-rec', text: rec ? ('最高 ' + U.fmtScore(rec.score) + ' · ' + U.fmtPct(rec.acc) + (rec.fc ? ' · FC' : '') + (rec.ap ? ' · AP' : '')) : '尚无记录' })
        ]),
        U.el('div', { class: 'diff-lv', text: 'LV ' + d.level }),
        U.el('div', { class: 'diff-stars', text: '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars) })
      ]);
      list.appendChild(row);
    });
    colL.appendChild(list);
    cols.appendChild(colL);

    /* 判定难度（从设置里搬过来）：宽松不计成绩、困难扣血翻倍 */
    var colR = U.el('div', { class: 'sp-col' });
    colR.appendChild(U.el('div', { class: 'sp-section', text: '判定难度' }));
    var jd = RG.Store.get('judgeDifficulty');
    var jdList = U.el('div', { class: 'diff-list' });
    [
      ['lenient', '宽松', '±52ms · 不计入成绩'],
      ['normal', '标准', '±40ms'],
      ['strict', '困难', '±28ms · 扣血 ×2']
    ].forEach(function (o) {
      jdList.appendChild(U.el('div', {
        class: 'diff-row jd-row' + (jd === o[0] ? ' sel' : ''),
        onclick: function () {
          RG.Store.set('judgeDifficulty', o[0]);
          if (handlers.onJudgeDifficulty) handlers.onJudgeDifficulty(o[0]);
          UI.showSongPanel(song, chapter, activeDiff, handlers);
        }
      }, [
        U.el('div', {}, [
          U.el('div', { class: 'diff-name', text: o[1] }),
          U.el('div', { class: 'diff-rec', text: o[2] })
        ])
      ]));
    });
    colR.appendChild(jdList);
    cols.appendChild(colR);
    host.appendChild(cols);
    host.appendChild(U.el('div', {
      class: 'sp-note',
      text: '严格模式判定更窄但扣血翻倍；宽松模式判定更宽，成绩不计入档案。'
    }));

    var rec = RG.Store.record(song.id, activeDiff);
    if (rec) {
      host.appendChild(U.el('div', { class: 'sp-section', text: '本难度记录' }));
      var grid = U.el('div', { class: 'rec-grid' });
      [['分数', U.fmtScore(rec.score)], ['精度', U.fmtPct(rec.acc)], ['最大连击', rec.maxCombo],
      ['评级', rec.grade || '-'], ['游玩', rec.plays || 0], ['失误', rec.miss === undefined ? 0 : rec.miss]].forEach(function (c) {
        grid.appendChild(U.el('div', { class: 'rec-cell' }, [U.el('b', { text: c[1] }), U.el('span', { text: c[0] })]));
      });
      host.appendChild(grid);
    }

    var acts = U.el('div', { class: 'sp-actions' });
    var canPlay = RG.Songs.isSongUnlocked(song) || isCustom;
    var playBtn = U.el('button', {
      class: 'gbtn accent big', text: canPlay ? '▶ 开始游玩' : '🔒 未解锁',
      onclick: function () { canPlay ? handlers.onPlay() : UI.toast(RG.Songs.songUnlockHint(song), 'err'); }
    });
    if (!canPlay) playBtn.setAttribute('disabled', 'disabled');
    acts.appendChild(playBtn);
    if (isCustom) {
      acts.appendChild(U.el('button', { class: 'gbtn', text: '✎ 编辑', onclick: handlers.onEdit }));
      acts.appendChild(U.el('button', {
        class: 'gbtn danger', text: '删除', onclick: function () {
          UI.confirm('删除谱面', '确定删除「' + song.title + '」？该操作不可撤销。', handlers.onDelete);
        }
      }));
    } else {
      acts.appendChild(U.el('button', {
        class: 'gbtn', text: '👁 自动演示',
        onclick: function () { handlers.onAutoplay(); }
      }));
    }
    host.appendChild(acts);
  };
  UI.hideSongPanel = function () { UI.el['song-panel'].classList.add('hidden'); };
  UI.mapTip = function (html, x, y) {
    var tip = UI.el['map-tip'];
    if (!html) { tip.classList.add('hidden'); return; }
    tip.classList.remove('hidden');
    tip.innerHTML = html;
    tip.style.left = Math.min(x + 16, window.innerWidth - 260) + 'px';
    tip.style.top = Math.max(8, y - 10) + 'px';
  };

  /* ---------------- 设置 ---------------- */
  function fmtNum(v) { return (Math.round(v * 100) / 100).toString(); }

  var TABLES = [
    {
      id: 'gameplay', name: '游玩', rows: [
        { key: 'scrollSpeed', type: 'range', min: 1, max: 12, step: 0.5, label: '下落速度', hint: '数值越大音符越快，建议 4~8' },
        { key: 'offsetMs', type: 'range', min: -200, max: 200, step: 5, label: '判定偏移 (ms)', hint: '总是打出「晚」就调大，总是「早」就调小' },
        { key: 'defaultLanes', type: 'seg', label: '默认轨道数', hint: '新建谱面 / 生成草稿时使用的轨道数', options: [[4, '4 键'], [6, '6 键'], [8, '8 键']], numeric: true },
        { key: 'mirror', type: 'toggle', label: '镜像模式', hint: '轨道左右翻转' },
        { key: 'noFail', type: 'toggle', label: '不失败', hint: '血量归零也继续游玩' },
        { key: 'autoplay', type: 'toggle', label: '自动演示', hint: '引擎自动演奏，用于欣赏与检查谱面' },
        { key: 'hitSound', type: 'toggle', label: '打击音效' },
        { key: 'showCombo', type: 'toggle', label: '显示连击' },
        { key: 'showEarlyLate', type: 'toggle', label: '显示 EARLY / LATE 提示' },
        { key: '__help', type: 'custom', label: '帮助', hint: '音符表与玩法说明' }
      ]
    },
    {
      id: 'visual', name: '外观', rows: [
        {
          key: 'skin', type: 'seg', label: '音符皮肤',
          hint: '2D / 3D 视角由谱面内嵌的切换环节自动控制', options: [['neon', '霓虹'], ['minimal', '极简'], ['solid', '实心']]
        },
        { key: 'noteSize', type: 'range', min: 0.6, max: 1.6, step: 0.05, label: '音符大小' },
        { key: 'bgDim', type: 'range', min: 0, max: 0.9, step: 0.05, label: '背景压暗' },
        { key: 'effects', type: 'seg', label: '特效强度', options: [['off', '关闭'], ['low', '低'], ['high', '高']] },
        { key: 'judgeLine', type: 'range', min: 0.55, max: 0.93, step: 0.01, label: '判定线位置', hint: '2D 判定线高度，同时决定 3D 判定面落在屏幕的位置' },
        {
          key: 'background', type: 'seg', label: '背景样式',
          options: [['auto', '自动'], ['bars', '频谱'], ['grid', '网格'], ['stars', '星空'], ['none', '纯色']]
        }
      ]
    },
    {
      id: 'audio', name: '音频', rows: [
        { key: 'musicVol', type: 'range', min: 0, max: 1, step: 0.05, label: '音乐音量' },
        { key: 'sfxVol', type: 'range', min: 0, max: 1, step: 0.05, label: '音效音量' }
      ]
    },
    {
      id: 'keys', name: '键位', rows: [
        { key: '__keys', type: 'custom', label: '键位映射', hint: '点击格子后按下键盘按键即可改键' }
      ]
    },
    {
      id: 'data', name: '数据', rows: [
        { key: '__data', type: 'custom', label: '存档管理' }
      ]
    }
  ];

  UI.renderSettings = function (tab) {
    UI.settingsTab = tab || UI.settingsTab;
    var s = RG.Store.settings();
    var tabsHost = U.clear(UI.el['settings-tabs']);
    TABLES.forEach(function (t) {
      tabsHost.appendChild(U.el('div', {
        class: 'tab' + (t.id === UI.settingsTab ? ' on' : ''), text: t.name,
        onclick: function () { UI.renderSettings(t.id); }
      }));
    });
    var body = U.clear(UI.el['settings-body']);
    var table = TABLES.filter(function (t) { return t.id === UI.settingsTab; })[0];
    if (!table) return;

    if (table.id === 'keys') { UI._renderKeys(body); return; }
    if (table.id === 'data') { UI._renderData(body); return; }
    UI._mountPreview(body);

    var card = U.el('div', { class: 'set-card' });
    card.appendChild(U.el('h3', { text: table.name.toUpperCase() + ' · 设置' }));
    table.rows.forEach(function (row) {
      /* 设置页里的帮助入口：音符表 + 玩法说明 + 重看教程 */
      if (row.type === 'custom') {
        var hline = U.el('div', { class: 'set-row' });
        hline.appendChild(U.el('div', { class: 'set-label', html: row.label + (row.hint ? '<i>' + row.hint + '</i>' : '') }));
        var hseg = U.el('div', { class: 'seg' });
        hseg.appendChild(U.el('button', { text: '玩法说明', onclick: function () { UI.showHelp(); } }));
        hseg.appendChild(U.el('button', { text: '重看新手教程', onclick: function () { RG.Tutorial.open(); } }));
        hline.appendChild(hseg);
        hline.appendChild(U.el('div', { class: 'set-val' }));
        card.appendChild(hline);
        return;
      }
      var val = RG.Store.get(row.key);
      var line = U.el('div', { class: 'set-row' });
      line.appendChild(U.el('div', { class: 'set-label', html: row.label + (row.hint ? '<i>' + row.hint + '</i>' : '') }));
      var ctrl = U.el('div', { class: 'seg' });
      var valEl = U.el('div', { class: 'set-val', text: '' });

      function apply(v) {
        RG.Store.set(row.key, v);
        valEl.textContent = row.type === 'range' ? fmtNum(v) + (row.key === 'offsetMs' ? ' ms' : '') : '';
        if (UI.app && UI.app.onSettingChanged) UI.app.onSettingChanged(row.key, v);
        if (RG.Preview && RG.Preview.mounted) RG.Preview.refresh();     // 实时预览立刻更新读数
        if (row.type === 'seg' || row.type === 'toggle') UI.renderSettings(table.id);
      }
      if (row.type === 'range') {
        var input = U.el('input', {
          type: 'range', min: row.min, max: row.max, step: row.step, value: val,
          oninput: function () { apply(parseFloat(input.value)); }
        });
        ctrl.appendChild(input);
        valEl.textContent = fmtNum(val) + (row.key === 'offsetMs' ? ' ms' : '');
      } else if (row.type === 'seg') {
        (row.options || []).forEach(function (o) {
          var on = String(val) === String(o[0]);
          ctrl.appendChild(U.el('button', {
            class: on ? 'on' : '', text: o[1],
            onclick: function () { apply(row.numeric ? +o[0] : o[0]); }
          }));
        });
      } else if (row.type === 'toggle') {
        [['开', true], ['关', false]].forEach(function (o) {
          ctrl.appendChild(U.el('button', {
            class: (!!val === o[1]) ? 'on' : '', text: o[0],
            onclick: function () { apply(o[1]); }
          }));
        });
      } else if (row.type === 'text' || row.type === 'password') {
        var ti = U.el('input', {
          type: row.type === 'password' ? 'password' : 'text',
          placeholder: row.placeholder || '',
          value: val || '',
          onchange: function () { apply(ti.value); }
        });
        ctrl.appendChild(ti);
      }
      line.appendChild(ctrl);
      line.appendChild(valEl);
      card.appendChild(line);
    });
    body.appendChild(card);
  };

  /* ---------------- 设置页的实时预览：铺满整屏当背景 ---------------- */
  var PREVIEW_TABS = { gameplay: 1, visual: 1, audio: 1, keys: 1 };
  UI._mountPreview = function () {
    if (!PREVIEW_TABS[UI.settingsTab]) return null;
    var host = UI.el['settings-preview'] || document.getElementById('settings-preview');
    if (!host) return null;
    U.clear(host);
    if (RG.Preview) RG.Preview.mount(host);
    return host;
  };

  /** 设置改动后刷新预览读数 */
  UI.refreshPreview = function () { if (RG.Preview && RG.Preview.mounted) RG.Preview.refresh(); };

  UI._renderKeys = function (body) {
    var lanes = RG.Store.get('defaultLanes') || 4;
    var card = U.el('div', { class: 'set-card' });
    card.appendChild(U.el('h3', { text: '键位映射' }));
    var line = U.el('div', { class: 'set-row' });
    line.appendChild(U.el('div', { class: 'set-label', html: '当前轨道数<i>切换后可为每种轨道数分别配置键位</i>' }));
    var seg = U.el('div', { class: 'seg' });
    [4, 6, 8, 10].forEach(function (n) {
      seg.appendChild(U.el('button', {
        class: lanes === n ? 'on' : '', text: n + ' 键',
        onclick: function () { RG.Store.set('defaultLanes', n); UI.renderSettings('keys'); }
      }));
    });
    line.appendChild(seg);
    line.appendChild(U.el('div', { class: 'set-val' }));
    card.appendChild(line);

    var grid = U.el('div', { class: 'keys-grid', style: 'margin-top:12px' });
    var binds = RG.Store.lanesFor(lanes);
    binds.forEach(function (code, i) {
      var cell = U.el('div', { class: 'key-cell' }, [
        U.el('div', { class: 'kl', text: '轨道 ' + (i + 1) }),
        U.el('div', { class: 'kk', text: U.keyName(code) })
      ]);
      cell.onclick = function () {
        if (UI._listening) return;
        UI._listening = true;
        cell.classList.add('listening');
        cell.querySelector('.kk').textContent = '按下按键…';
        var handler = function (e) {
          e.preventDefault();
          window.removeEventListener('keydown', handler, true);
          UI._listening = false;
          if (e.code === 'Escape') { UI.renderSettings('keys'); return; }
          RG.Store.setBinding(lanes, i, e.code);
          UI.app && UI.app.rebuildInput && UI.app.rebuildInput();
          UI.renderSettings('keys');
          UI.toast('轨道 ' + (i + 1) + ' → ' + U.keyName(e.code), 'ok');
        };
        window.addEventListener('keydown', handler, true);
      };
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    var presets = U.el('div', { class: 'seg', style: 'margin-top:14px;max-width:420px' });
    presets.appendChild(U.el('button', {
      class: 'on', text: '预设 A',
      onclick: function () { RG.Store.settings().bindings[lanes] = RG.Store.BIND_PRESETS[lanes].slice(); RG.Store.saveSettings(); UI.app && UI.app.rebuildInput && UI.app.rebuildInput(); UI.renderSettings('keys'); }
    }));
    presets.appendChild(U.el('button', {
      text: '预设 B',
      onclick: function () { RG.Store.settings().bindings[lanes] = (RG.Store.BIND_PRESETS_ALT[lanes] || RG.Store.BIND_PRESETS[lanes]).slice(); RG.Store.saveSettings(); UI.app && UI.app.rebuildInput && UI.app.rebuildInput(); UI.renderSettings('keys'); }
    }));
    card.appendChild(presets);
    card.appendChild(U.el('div', { class: 'set-label', style: 'margin-top:12px', html: '<i>提示：鼠标 / 触屏也可以直接点击轨道演奏，SLIDE 支持按住拖动到目标轨道。</i>' }));
    body.appendChild(card);
  };

  UI._renderData = function (body) {
    var st = RG.Store.save().stats;
    var card = U.el('div', { class: 'set-card' });
    card.appendChild(U.el('h3', { text: '统计' }));
    [['游玩次数', st.plays], ['通关次数', st.clears], ['演奏音符', U.fmtScore(st.notes)],
    ['全连 (FC)', st.fullCombo], ['全完美 (AP)', st.allPerfect],
    ['游玩时长', U.fmtTime(st.playTime)], ['自制谱面', RG.Store.customCharts().length]].forEach(function (r) {
      var line = U.el('div', { class: 'set-row' });
      line.appendChild(U.el('div', { class: 'set-label', text: r[0] }));
      line.appendChild(U.el('div', { class: 'seg' }));
      line.appendChild(U.el('div', { class: 'set-val', text: String(r[1]) }));
      card.appendChild(line);
    });
    body.appendChild(card);

    var card2 = U.el('div', { class: 'set-card' });
    card2.appendChild(U.el('h3', { text: '存档操作' }));
    var row = U.el('div', { class: 'seg', style: 'max-width:640px' });
    row.appendChild(U.el('button', {
      text: '导出存档', onclick: function () {
        U.download('resonance-save.json', RG.Store.exportAll());
        UI.toast('已导出存档', 'ok');
      }
    }));
    row.appendChild(U.el('button', {
      text: '导入存档', onclick: function () { UI.el['import-file'].dataset.mode = 'save'; UI.el['import-file'].click(); }
    }));
    row.appendChild(U.el('button', {
      text: '重置进度', onclick: function () {
        UI.confirm('重置进度', '将清空所有成绩与星级（自定义谱面保留）。', function () {
          RG.Store.resetProgress(); UI.toast('进度已重置', 'ok'); UI.renderSettings('data');
        });
      }
    }));
    row.appendChild(U.el('button', {
      text: '清空自制谱面', onclick: function () {
        UI.confirm('清空自制谱面', '将删除全部自制谱面，无法恢复。', function () {
          RG.Store.clearCustomCharts(); UI.toast('已清空', 'ok'); UI.renderSettings('data');
        });
      }
    }));
    row.appendChild(U.el('button', {
      text: '重置成就', onclick: function () {
        UI.confirm('重置成就', '将清空全部成就记录（成绩与自制谱面保留）。', function () {
          RG.Store.resetAchievements();
          RG.Front.buildModes();
          UI.toast('成就已重置', 'ok');
          UI.renderSettings('data');
        });
      }
    }));
    row.appendChild(U.el('button', {
      class: 'danger', text: '⛔ 清除所有存档',
      onclick: function () { if (UI.app && UI.app.confirmWipe) UI.app.confirmWipe(); }
    }));
    card2.appendChild(row);
    card2.appendChild(U.el('div', {
      class: 'set-label', style: 'margin-top:10px',
      html: '<i>「清除所有存档」会一并删除：成绩与星级、成就、自制谱面、全部设置。清除后回到待机画面，并会重新进入新手教程。</i>'
    }));
    body.appendChild(card2);
  };

  /* ---------------- 工坊列表 ---------------- */
  UI.renderWorkshop = function (handlers) {
    var host = U.clear(UI.el['ws-grid']);
    var charts = RG.Store.customCharts();
    if (!charts.length) {
      host.appendChild(U.el('div', {
        class: 'ws-empty',
        html: '<b>还没有自制谱面</b><br>点击右上角「＋ 新建谱面」从零开始，<br>或用「由乐曲生成草稿」让引擎先替你铺一版，再手动精修。'
      }));
      return;
    }
    charts.forEach(function (c) {
      var st = RG.Chart.stats(c);
      var rec = RG.Store.record(c.meta.id, 0);
      var stars = rec ? (rec.stars || 0) : 0;
      var card = U.el('div', { class: 'ws-card' }, [
        U.el('h4', { text: c.meta.title }),
        U.el('div', {
          class: 'ws-meta',
          html: '轨道 ' + c.meta.lanes + ' · BPM ' + c.meta.bpm + ' · LV ' + c.meta.level + '<br>' +
            '音符 ' + st.total + '（TAP ' + st.counts.tap + ' · HOLD ' + st.counts.hold + ' · SLIDE ' + st.counts.slide + ' · FLICK ' + st.counts.flick + ' · MINE ' + st.counts.mine + '）<br>' +
            '时长 ' + U.fmtTime(c.meta.length) + ' · 最长连击 ' + st.maxCombo +
            ' · 视角 ' + (c.meta.view === '3d' ? '3D' : '2D') + ' 起始 / ' + st.switches + ' 次切换' +
            (rec ? '<br>最佳 ' + U.fmtScore(rec.score) + ' · ' + U.fmtPct(rec.acc) : '')
        }),
        U.el('div', { class: 'diff-stars', text: '★★★'.slice(0, stars) + '☆☆☆'.slice(0, 3 - stars) }),
        U.el('div', { class: 'ws-btns' }, [
          U.el('button', { class: 'gbtn accent', text: '▶ 游玩', onclick: function () { handlers.onPlay(c); } }),
          U.el('button', { class: 'gbtn', text: '✎ 编辑', onclick: function () { handlers.onEdit(c); } }),
          U.el('button', { class: 'gbtn', text: '复制', onclick: function () { handlers.onDuplicate(c); } }),
          U.el('button', { class: 'gbtn', text: '导出', onclick: function () { handlers.onExport(c); } }),
          U.el('button', {
            class: 'gbtn danger', text: '删除', onclick: function () {
              UI.confirm('删除谱面', '确定删除「' + c.meta.title + '」？', function () { handlers.onDelete(c); });
            }
          })
        ])
      ]);
      host.appendChild(card);
    });
  };

  /* ---------------- 结算（铺满整页 · 两列逐行 · 英文标签） ---------------- */
  /** 还原结算页的标准按钮（历史上剧情结算会临时换掉它们，这里确保每次结算都是标准两个键） */
  UI.resultButtons = function () {
    var btns = document.querySelector('#screen-result .ov-btns');
    if (!btns) return null;
    U.clear(btns);
    btns.className = 'ov-btns sym';
    btns.appendChild(U.el('button', { class: 'sym-btn', 'data-action': 'res-retry', title: '再来一次', text: '⟲' }));
    btns.appendChild(U.el('button', { class: 'sym-btn', 'data-action': 'res-back-map', title: '返回地图', text: '⌂' }));
    return btns;
  };

  UI.showResult = function (r, song, diff, improved) {
    var gradeEl = UI.el['res-grade'];
    gradeEl.textContent = r.grade;
    gradeEl.className = 'res-grade g-' + r.grade.replace(/[^A-Z]/g, '');
    UI.el['res-title'].textContent = song.title;
    /* 不显示是几 key */
    UI.el['res-diff'].textContent = diff.name + ' · LV ' + diff.level +
      (r.autoplay ? ' · AUTOPLAY' : '') + (r.ranked === false ? ' · UNRANKED（不计入档案）' : '');
    UI.el['res-stars'].textContent = '★★★'.slice(0, r.stars) + '☆☆☆'.slice(0, 3 - r.stars);
    /* 关键：每次结算都把按钮还原成标准两个符号键
       （曾经剧情结算会把它们换掉，不还原的话下一次普通结算就没有 ⟲ / ⌂ 了） */
    UI.resultButtons();
    var grid = U.clear(UI.el['res-grid']);
    var rows = [
      ['SCORE', U.fmtScore(r.score), improved && improved.score],
      ['ACCURACY', U.fmtPct(r.acc), improved && improved.acc],
      ['MAX COMBO', r.maxCombo, improved && improved.combo],
      ['LIFE', Math.round(r.life), false],
      ['PERFECT', r.counts.perfect, false],
      ['GREAT', r.counts.great, false],
      ['GOOD', r.counts.good, false],
      ['MISS', r.counts.miss, false],
      ['BREAK', r.counts.break, false],
      ['MINE', r.counts.mineHit, false],
      ['AVG OFFSET', U.fmtDelta(r.avgOffset), false],
      ['RESULT', r.fc ? (r.ap ? 'ALL PERFECT' : 'FULL COMBO') : (r.clear ? 'CLEAR' : 'FAILED'), improved && improved.clear]
    ];
    rows.forEach(function (c) {
      grid.appendChild(U.el('div', { class: 'res-row' + (c[2] ? ' new' : '') }, [
        U.el('span', { text: c[0] }),
        U.el('b', { text: String(c[1]) })
      ]));
    });
    UI.overlay('screen-result', true);
  };

  /* ---------------- 暂停（PAUSED · 无数据 · 只有符号按钮） ---------------- */
  UI.showPause = function () {
    UI.overlay('screen-pause', true);
  };

  /* ---------------- 游戏 HUD ---------------- */
  UI.updateHUD = function (st) {
    var c = UI._cache;
    /* 正上方：分数 + 实时精度 */
    if (c.score !== st.score) {
      UI.el['gh-score'].textContent = U.fmtScore(st.score);
      c.score = st.score;
    }
    var accTxt = U.fmtPct(st.acc);
    if (c.acc !== accTxt) {
      UI.el['gh-acc'].textContent = accTxt;
      c.acc = accTxt;
    }
    var lifeW = Math.round(U.clamp(st.life, 0, 100)) + '%';
    if (c.life !== lifeW) {
      UI.el['gh-life'].style.width = lifeW;
      UI.el['gh-life'].classList.toggle('low', st.life < 35);
      c.life = lifeW;
    }
    var comboShown = st.combo >= 3 && RG.Store.get('showCombo');
    /* 3D 时连击数由渲染器画在路面上（与轨道同一平面），平面 HUD 让位 */
    var comboOnRoad = st.viewMode === '3d';
    UI.el['gh-combo'].classList.toggle('show', !!comboShown && !comboOnRoad);
    UI.el['gh-combo'].classList.toggle('on-road', !!comboOnRoad);
    if (comboShown && c.combo !== st.combo) {
      UI.el['gh-combo'].querySelector('b').textContent = st.combo;
      UI.el['gh-combo'].classList.toggle('break', st.life < 35);
      c.combo = st.combo;
    }
    /* 暂停键周围一圈 = 曲目进度（圆周长 2πr ≈ 119.4） */
    var prog = U.clamp(st.progress || 0, 0, 1);
    var pw = Math.round(prog * 1000) / 1000;
    if (c.progress !== pw) {
      var ring = UI.el['gh-pause-progress'];
      if (ring) ring.style.strokeDashoffset = String(Math.round((1 - prog) * 119.4 * 10) / 10);
      c.progress = pw;
    }
    /* 底部不再显示任何文字（判定偏移/早晚统计已移除） */
  };
  UI.resetHUDCache = function () { UI._cache = {}; };
  /** 右下角的曲名与难度（不再显示是几 key） */
  UI.setGameTitle = function (title, diff) {
    UI.el['gh-title'].textContent = title;
    UI.el['gh-diff'].textContent = diff;
  };
  /** 开局/重开时把 HUD 复位（血量满、连击隐藏、进度环归零） */
  UI.resetHUD = function () {
    UI._cache = {};
    if (UI.el['gh-score']) UI.el['gh-score'].textContent = '0';
    if (UI.el['gh-acc']) UI.el['gh-acc'].textContent = '100.00%';
    if (UI.el['gh-life']) UI.el['gh-life'].style.width = '100%';
    if (UI.el['gh-combo']) { UI.el['gh-combo'].classList.remove('show', 'break', 'on-road'); }
    var ring = UI.el['gh-pause-progress'];
    if (ring) ring.style.strokeDashoffset = '119.4';
  };
  UI.countdown = function (text) {
    var el = UI.el['countdown'];
    if (text === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = text;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'pop .18s ease';
  };
  UI.autoBadge = function (on) { UI.el['auto-badge'].classList.toggle('hidden', !on); };

  /* ---------------- 帮助 ---------------- */
  UI.showHelp = function () {
    var T = RG.Chart.TYPES;
    var rows = RG.Chart.ORDER.map(function (k) {
      var t = T[k];
      return '<div class="nt"><div><div class="nname" style="color:' + t.color + '">' + t.label + '</div>' +
        '<div class="nkey">' + t.key + '</div></div><div>' + ({
          tap: '在判定线上按下对应轨道键（或点击轨道）。',
          hold: '按下后保持到长条结束；提前松手会断连并只拿部分分。',
          slide: '先按住起点轨道，在终点时刻同时按住目标轨道（键盘按目标键 / 鼠标按住拖过去）。',
          flick: '在判定时刻按下，然后朝任意方向滑动一下即可（不用松手）；键盘则和 TAP 一样按，但必须同时按下两个键。',
          mine: '绝对不能按！踩到会扣大量血量并断连。'
        }[k]) + '</div></div>';
    }).join('');
    UI.modal({
      title: '玩法说明', body:
        '<b>目标</b>：跟上音乐节奏，在音符到达判定线时准确击打。评级由精度决定（SS ≥ 99.5%，S ≥ 95%，A ≥ 90%）。<br>' +
        '<b>操作</b>：键盘 ' + RG.Store.lanesFor(4).map(U.keyName).join(' / ') + '（4 键）；鼠标与触屏可直接点击轨道，支持多点触控。<br><br>' +
        '<b>音符类型</b>' + rows +
        '<br><b>视角</b>：没有手动 2D/3D 开关 —— 视角由<b>谱面内嵌的切换环节</b>决定（副歌/高潮等段落会自动切到 3D 立体视角，' +
        '切换瞬间会有交叉溶解 + 速度线过场）。制谱时可在编辑器左侧「视角轨」自由摆放切换点。<br>' +
        '<b>模式</b>：<b>自由演奏</b>在大地图按章节选曲（攒星级解锁下一片区域）；<b>创作工坊</b>可自建谱面并试玩；' +
        '档案页可查看统计、章节进度与成就。<br>' +
        '<b>设置</b>：可切换皮肤、特效、判定线、键位与判定偏移，改动都有实时预览；判定难度在选曲面板里选。<br>' +
        '<b>背景与立绘</b>全部由内置程序化绘画实时生成（无外部素材、无网络请求，同 seed 同画面）。',
      buttons: [{ label: '明白了', primary: true }]
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*! Resonance Engine · 无头测试
 * 用最小 vm 沙箱按 index.html 的 <script> 顺序加载引擎脚本，
 * 断言「浏览器里跑的同一份代码」在纯逻辑层面正确。
 *   node tests/smoke.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'src/util.js', 'src/store.js', 'src/audio.js', 'src/chart.js',
  'src/songs.js', 'src/input.js', 'src/engine.js',
  'src/render.js', 'src/worldmap.js', 'src/art.js',
  'src/screens.js', 'src/preview.js', 'src/frontend.js', 'src/tutorial.js',
  'src/editor.js', 'src/main.js'
];

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null
  };
}

function createSandbox(files, preloaded) {
  const mem = memStorage();
  if (preloaded) for (const k in preloaded) mem.setItem(k, preloaded[k]);
  const sandbox = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp,
    Map, Set, Promise, Symbol, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN,
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: mem
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.navigator = { userAgent: 'node' };
  if (preloaded) sandbox.__mem = mem;
  vm.createContext(sandbox);
  for (const rel of (files || FILES)) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log('  (跳过未实现文件) ' + rel); continue; }
    const code = fs.readFileSync(p, 'utf8');
    try { vm.runInContext(code, sandbox, { filename: rel }); }
    catch (e) { console.error('\n[加载失败] ' + rel + '\n' + (e && e.stack || e)); process.exit(2); }
  }
  return sandbox;
}

/** 只加载 util+store，用于验证设置默认值迁移 */
function settingsSandbox(stored) {
  return createSandbox(['src/util.js', 'src/store.js'],
    stored ? { 'rg.settings.v1': JSON.stringify(stored) } : null);
}
/** 只加载 util+store，但把内容写进「存档」：用于验证存档迁移 */
function saveSandbox(stored) {
  return createSandbox(['src/util.js', 'src/store.js'],
    { 'rg.save.v1': JSON.stringify(stored) });
}
/** 带渲染器的沙箱：用来验证「设置 → 渲染器实际参数」的链路 */
function renderSandbox(stored) {
  return createSandbox(['src/util.js', 'src/store.js', 'src/chart.js', 'src/render.js'],
    stored ? { 'rg.settings.v1': JSON.stringify(stored) } : null);
}
const noopSB = () => { };
const gradSB = { addColorStop: noopSB };
function makeCanvasSB(w, h) {
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradSB;
      if (k === 'measureText') return () => ({ width: 42 });
      return noopSB;
    },
    set() { return true; }
  });
  return {
    clientWidth: w, clientHeight: h, width: w, height: h, style: {},
    classList: { add: noopSB, remove: noopSB, toggle: noopSB, contains: () => false },
    addEventListener: noopSB, removeEventListener: noopSB,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    getContext: () => ctx
  };
}

/* ---------------- 迷你断言 ---------------- */
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; failures.push([name, e]); console.log('  \u2717 ' + name + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ' 实际=' + a + ' 期望=' + b); }
function ok(v, msg) { if (!v) throw new Error(msg || '期望真值'); }
function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= (tol == null ? 1e-6 : tol))) throw new Error((msg || 'near') + ' 实际=' + a + ' 期望=' + b); }

const ctx = createSandbox();
const RG = ctx.RG;
const U = RG.U;

console.log('\n=== Resonance Engine · 逻辑测试 ===\n');

/* ---------------- util ---------------- */
test('util: 数值工具与确定性随机', () => {
  eq(U.clamp(5, 0, 3), 3);
  near(U.lerp(0, 10, 0.25), 2.5);
  const a = U.rng(42), b = U.rng(42);
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  eq(seqA.join(','), seqB.join(','), '同种子随机序列应一致');
  const arr = [{ t: 1 }, { t: 3 }, { t: 5 }];
  eq(U.lowerBound(arr, 3), 1);
  eq(U.lowerBound(arr, 4), 2);
  eq(U.hashStr('abc'), U.hashStr('abc'));
});

/* ---------------- store ---------------- */
test('store: 设置读写与结果提交', () => {
  const S = RG.Store;
  eq(S.get('scrollSpeed'), 6);
  S.set('scrollSpeed', 9);
  eq(S.get('scrollSpeed'), 9);
  eq(S.lanesFor(6).length, 6);
  S.setBinding(4, 0, 'KeyZ');
  eq(S.lanesFor(4)[0], 'KeyZ');
  S.setBinding(4, 0, 'KeyD');
  const r = S.submitResult('first-light', 0, { score: 900000, acc: 0.96, maxCombo: 100, grade: 'S', clear: true, stars: 3, fc: true, ap: false, miss: 0, perfect: 90, totalNotes: 100, duration: 60 });
  ok(r.record.clear, '应记录通关');
  eq(S.record('first-light', 0).stars, 3);
  eq(S.totalStars() >= 3, true);
  S.resetProgress();
  eq(S.totalStars(), 0);
});

test('store: 3D 相机参数已内置（设置里不再暴露，相机距离 2.4 / 速度系数 0.8）', () => {
  const SB = renderSandbox(null);
  /* 设置里不再有 camera 字段 */
  eq(SB.RG.Store.settings().camera, undefined, '设置里不应再暴露 3D 相机参数');
  /* 内置默认值仍在（渲染器直接读它） */
  const cam = SB.RG.Store.CAMERA;
  ok(cam, '应有内置相机默认值');
  eq(cam.dist, 2.4, '相机距离应为 2.4');
  eq(cam.speed, 0.8, '速度系数应为 0.8');
  eq(cam.fov, 72);
  eq(cam.pitch, 48);
  /* 渲染器实际用的就是内置值 */
  const r = new SB.RG.Render(makeCanvasSB(1280, 720), { settings: SB.RG.Store.settings() });
  near(r.cam.dist, 2.4, 1e-9, '渲染器相机距离应为 2.4');
  near(r.cam.speed, 0.8, 1e-9, '渲染器速度系数应为 0.8');
  eq(SB.RG.Store.settings().showFps, undefined, '不应再有帧率显示设置');
});

test('store: 老存档里的 3D 相机设置会被清掉（改为内置），其它自定义保留', () => {
  const old = renderSandbox({
    version: 1, scrollSpeed: 9, offsetMs: 30,
    showFps: false,
    camera: { fov: 95, height: 1.1, dist: 5, width: 6, speed: 1.4, curve: 1 }
  });
  eq(old.RG.Store.settings().camera, undefined, '存档里的相机设置应被清掉');
  eq(old.RG.Store.settings().showFps, undefined, 'showFps 应被清掉');
  eq(old.RG.Store.get('scrollSpeed'), 9, '玩家的其它自定义设置必须保留');
  eq(old.RG.Store.get('offsetMs'), 30, '玩家的其它自定义设置必须保留');
  const r = new old.RG.Render(makeCanvasSB(1280, 720), { settings: old.RG.Store.settings() });
  near(r.cam.dist, 2.4, 1e-9, '清除后应回到内置的相机距离');
});

/* ---------------- music ---------------- */
test('music: 六种风格均可生成且确定', () => {
  const styles = ['synthwave', 'chiptune', 'pop', 'dnb', 'hardcore', 'ambient'];
  styles.forEach((style) => {
    const m1 = RG.Music.build({ style, seed: 777, bpm: 150, sections: [{ name: 'a', intensity: 2, bars: 8 }, { name: 'b', intensity: 3, bars: 8 }] });
    const m2 = RG.Music.build({ style, seed: 777, bpm: 150, sections: [{ name: 'a', intensity: 2, bars: 8 }, { name: 'b', intensity: 3, bars: 8 }] });
    ok(m1.events.length > 20, style + ' 事件过少: ' + m1.events.length);
    eq(m1.events.length, m2.events.length, style + ' 应可确定复现');
    near(m1.duration, 16 * m1.barDur, 1e-6);
    let sorted = true;
    for (let i = 1; i < m1.events.length; i++) if (m1.events[i].t < m1.events[i - 1].t - 1e-9) sorted = false;
    ok(sorted, style + ' 事件未按时间排序');
    ok(m1.events.every((e) => e.t >= 0 && isFinite(e.f) && e.d > 0), style + ' 事件字段非法');
    ok(m1.events.some((e) => e.type === 'kick'), style + ' 缺少鼓组');
    ok(m1.events.some((e) => e.type === 'lead' || e.type === 'bass'), style + ' 缺少旋律/贝斯');
  });
});

test('music: 节拍网格与段落连续', () => {
  const m = RG.Music.build({ style: 'synthwave', seed: 5, bpm: 120, sections: [{ name: 'a', intensity: 3, bars: 4 }, { name: 'b', intensity: 3, bars: 4 }] });
  near(m.beatDur, 0.5, 1e-9);
  eq(m.sections.length, 2);
  near(m.sections[0].end, m.sections[1].start, 1e-9, '段落应首尾相接');
  near(m.duration, 8 * 2, 1e-9);
  ok(m.beats.length >= 32, '应有 16 分音符网格');
});

/* ---------------- chart ---------------- */
test('chart: 校验/序列化/统计', () => {
  const c = RG.Chart.create({ id: 'x', lanes: 4, bpm: 120, length: 30 });
  c.notes = [
    { t: 1, lane: 0, type: 'tap' }, { t: 2, lane: 1, type: 'hold', d: 0.5 },
    { t: 3, lane: 2, type: 'slide', d: 0.5, tail: 3 }, { t: 4, lane: 3, type: 'flick' },
    { t: 5, lane: 0, type: 'mine' }
  ];
  RG.Chart.normalize(c);
  const v = RG.Chart.validate(c);
  ok(v.ok, '应通过校验: ' + v.errors.join(','));
  const st = RG.Chart.stats(c);
  eq(st.total, 4, '地雷不计入可击打音符');
  eq(st.maxCombo, 4);
  const round = RG.Chart.parse(RG.Chart.serialize(c));
  eq(round.notes.length, 5);
  eq(round.meta.bpm, 120);
  // 越界应报错
  const bad = RG.Chart.create({ lanes: 4 });
  bad.notes = [{ t: 1, lane: 9, type: 'tap' }];
  ok(!RG.Chart.validate(bad).ok, '越界轨道应报错');
});

test('chart: 自动铺面覆盖全部曲目与难度', () => {
  const songs = RG.Songs.all();
  ok(songs.length >= 16, '曲目数量不足: ' + songs.length);
  let totalNotes = 0, npsSum = 0, n = 0;
  songs.forEach((song) => {
    song.diffs.forEach((d, di) => {
      const chart = RG.Songs.chartFor(song, di);
      const v = RG.Chart.validate(chart);
      ok(v.ok, song.id + '/' + d.name + ' 校验失败: ' + v.errors.slice(0, 3).join(';'));
      const st = RG.Chart.stats(chart);
      ok(st.total > 30, song.id + '/' + d.name + ' 音符过少: ' + st.total);
      ok(st.counts.tap > 0, song.id + '/' + d.name + ' 没有单点');
      ok(chart.meta.lanes === d.lanes, '轨道数应与难度一致');
      // 可玩性：同轨相邻音符间隔不小于最小间隔
      const byLane = {};
      chart.notes.forEach((note) => { (byLane[note.lane] = byLane[note.lane] || []).push(note); });
      Object.keys(byLane).forEach((l) => {
        const arr = byLane[l].slice().sort((a, b) => a.t - b.t);
        for (let i = 1; i < arr.length; i++) {
          const prevEnd = arr[i - 1].t + (arr[i - 1].d || 0);
          const gap = arr[i].t - prevEnd;
          if (arr[i].type === 'mine' || arr[i - 1].type === 'mine') continue;
          ok(gap > 0.01, song.id + '/' + d.name + ' 轨道' + l + ' 重叠: ' + gap.toFixed(4));
        }
      });
      // 难度递增：等级越高音符密度越高
      npsSum += st.nps; n++;
      totalNotes += st.total;
      // 时间必须在乐曲范围内
      chart.notes.forEach((note) => {
        ok(note.t < chart.meta.length + 1, song.id + ' 音符超出乐曲长度: ' + note.t);
      });
    });
  });
  ok(totalNotes > 3000, '总音符数偏少: ' + totalNotes);
  ok(npsSum / n > 2, '平均密度偏低: ' + (npsSum / n).toFixed(2));
});

test('chart: 难度越高越密集（抽样校验）', () => {
  const song = RG.Songs.byId('neon-drive');
  const a = RG.Chart.stats(RG.Songs.chartFor(song, 0)).nps;
  const b = RG.Chart.stats(RG.Songs.chartFor(song, 1)).nps;
  const c = RG.Chart.stats(RG.Songs.chartFor(song, 2)).nps;
  ok(a < b && b < c, '密度应递增: ' + [a, b, c].map((x) => x.toFixed(2)).join(' < '));
});

test('chart: 高难度应出现全部五种音符', () => {
  const seen = { tap: 0, hold: 0, slide: 0, flick: 0, mine: 0 };
  RG.Songs.all().forEach((song) => {
    const chart = RG.Songs.chartFor(song, song.diffs.length - 1);
    RG.Chart.stats(chart).counts && Object.keys(seen).forEach((k) => { seen[k] += RG.Chart.stats(chart).counts[k]; });
  });
  Object.keys(seen).forEach((k) => ok(seen[k] > 0, k + ' 类型从未出现'));
});

test('chart: 视角切换环节的规范化 / 查询 / 统计', () => {
  const c = RG.Chart.create({ id: 'v', lanes: 4, bpm: 120, length: 100, view: '2d' });
  c.meta.viewEvents = [
    { t: 30, mode: '3d', dur: 1 },
    { t: 10, mode: '3d', dur: 0.5 },      // 乱序
    { t: 10.05, mode: '3d', dur: 0.5 },   // 与上一个太近，应被去掉
    { t: 0.1, mode: '2d', dur: 0.5 },     // 与起始视角相同的开头冗余，应被去掉
    { t: 60, mode: 'bogus', dur: 1 },     // 非法模式，应被过滤
    { t: 70, mode: '2d', dur: 9 }         // dur 超范围，应被夹到 3
  ];
  RG.Chart.normalize(c);
  const evs = c.meta.viewEvents;
  eq(evs.length, 3, '应保留 3 个合法标记（非法/重复/冗余各去掉一个）：' + JSON.stringify(evs));
  eq(evs[0].mode, '3d'); near(evs[0].t, 10, 1e-9);
  eq(evs[1].mode, '3d'); near(evs[1].t, 30, 1e-9);
  eq(evs[2].mode, '2d'); near(evs[2].t, 70, 1e-9);
  eq(evs[2].dur, 3, 'dur 应被夹到上限');
  // 查询
  eq(RG.Chart.viewAt(c, 5).mode, '2d');
  eq(RG.Chart.viewAt(c, 10).mode, '3d');
  eq(RG.Chart.viewAt(c, 29.9).mode, '3d');
  eq(RG.Chart.viewAt(c, 69.9).mode, '3d');
  eq(RG.Chart.viewAt(c, 71).mode, '2d');
  eq(RG.Chart.viewAt(c, 10).dur, 0.5, '应带出过渡时长');
  eq(RG.Chart.nextViewEvent(c, 0).t, 10);
  eq(RG.Chart.nextViewEvent(c, 30).t, 70);
  eq(RG.Chart.nextViewEvent(c, 80), null, '末尾应没有下一次切换');
  const tot = RG.Chart.viewTotals(c);
  eq(tot.switches, 3);
  near(tot.two + tot.three, 100, 1e-6, '两种视角时长之和应等于曲长');
  near(tot.two, 40, 1e-6, '2D 段：0~10 与 70~100');
  near(tot.three, 60, 1e-6, '3D 段：10~70');
  // 统计
  const st = RG.Chart.stats(c);
  eq(st.switches, 3);
  eq(st.view, '2d');
  // 序列化保留
  const round = RG.Chart.parse(RG.Chart.serialize(c));
  eq(round.meta.viewEvents.length, 3);
  eq(round.meta.view, '2d');
  // 校验：非法模式只警告不报错
  const bad = RG.Chart.create({ id: 'b' });
  bad.meta.viewEvents = [{ t: 1, mode: 'x' }];
  const v = RG.Chart.validate(bad);
  ok(v.ok, '非法视角标记不应让谱面校验失败');
  ok(v.warnings.some((w) => w.indexOf('视角切换标记') >= 0), '应有警告');
});

test('chart: 自动铺面会按段落写入 2D/3D 切换环节', () => {
  const music = RG.Music.build({
    style: 'synthwave', seed: 31, bpm: 128,
    sections: [
      { name: 'intro', intensity: 0, bars: 8 }, { name: 'verse', intensity: 1, bars: 8 },
      { name: 'chorus', intensity: 2, bars: 8 }, { name: 'bridge', intensity: 1, bars: 8 },
      { name: 'chorus', intensity: 3, bars: 8 }, { name: 'outro', intensity: 0, bars: 4 }
    ]
  });
  const chart = RG.Chart.generate(music, { lanes: 4, level: 8, seed: 7, songId: 'g' });
  eq(chart.meta.view, '2d', '应从 2D 开始');
  ok(chart.meta.viewEvents.length >= 3, '应有多段切换：' + JSON.stringify(chart.meta.viewEvents));
  ok(chart.meta.viewEvents.every((e, i, a) => i === 0 || e.t > a[i - 1].t), '标记应按时间递增');
  // 每次切换都真的改变视角，且开场保持 2D
  let cur = chart.meta.view;
  chart.meta.viewEvents.forEach((e) => { ok(e.mode !== cur, '相邻切换不应同向'); cur = e.mode; });
  eq(RG.Chart.viewAt(chart, 1).mode, '2d', '开场应为 2D');
  const three = RG.Chart.viewTotals(chart).three;
  ok(three > 10, '3D 段应有足够时长：' + three.toFixed(1) + 's');
  // 可关闭
  const noSwitch = RG.Chart.generate(music, { lanes: 4, level: 8, seed: 7, viewSwitch: false });
  eq(noSwitch.meta.viewEvents.length, 0, 'viewSwitch:false 时不应写入切换');
  // 高难度会有额外的插入式切换
  const hard = RG.Chart.generate(music, { lanes: 4, level: 15, seed: 7 });
  ok(hard.meta.viewEvents.length >= chart.meta.viewEvents.length, '高难度切换不应更少');
});

/* ---------------- songs / 解锁 ---------------- */
test('songs: 章节结构与解锁规则', () => {
  const S = RG.Songs;
  ok(S.chapters.length === 6, '章节数应为 6');
  S.chapters.forEach((ch) => {
    ok(ch.songs.length > 0 || ch.workshop, ch.id + ' 没有曲目');
    ch.songs.forEach((s) => ok(s.node && isFinite(s.node.x) && isFinite(s.node.y), '节点坐标缺失'));
  });
  S.chapters.forEach((ch) => {
    ch.songs.forEach((s) => {
      ok(s.node.x > 0 && s.node.x < 2600 && s.node.y > 0 && s.node.y < 1700,
        s.id + ' 节点超出地图范围: ' + JSON.stringify(s.node));
    });
  });
  RG.Store.resetProgress();
  ok(S.isChapterUnlocked(S.chapter('origin')), '第一章应默认解锁');
  ok(S.isChapterUnlocked(S.chapter('workshop')), '工坊应默认解锁');
  ok(!S.isChapterUnlocked(S.chapter('core')), '第四章应锁定');
  const ch1 = S.chapter('origin');
  ok(S.isSongUnlocked(ch1.songs[0]), '首曲应解锁');
  ok(!S.isSongUnlocked(ch1.songs[1]), '次曲应锁定');
  RG.Store.submitResult(ch1.songs[0].id, 0, { score: 800000, acc: 0.9, maxCombo: 50, grade: 'A', clear: true, stars: 2, fc: false, ap: false, miss: 0, perfect: 50, totalNotes: 60, duration: 40 });
  ok(S.isSongUnlocked(ch1.songs[1]), '通关后应解锁下一曲');
  ok(S.next('first-light', 0) !== null, '应有下一首');
});

/* ---------------- engine：判定与计分 ---------------- */
function makeChart(notes, meta) {
  const c = RG.Chart.create(Object.assign({ id: 'test', songId: 'test', lanes: 4, bpm: 120, length: 30 }, meta || {}));
  c.notes = notes;
  return RG.Chart.normalize(c);
}
function newEngine(chart, settings, held, extra) {
  const s = Object.assign({ judgeDifficulty: 'normal', offsetMs: 0, noFail: false }, settings || {});
  const heldSet = held || new Set();
  return new RG.Engine(Object.assign({
    chart, settings: s, isHeld: (l) => heldSet.has(l),
    heldKeys: () => heldSet.size,
    hooks: {}
  }, extra || {}));
}

test('engine: 全 PERFECT 应得满分、SS、AP、三星', () => {
  const chart = makeChart([
    { t: 2, lane: 0, type: 'tap' }, { t: 2.5, lane: 1, type: 'tap' },
    { t: 3, lane: 2, type: 'hold', d: 0.5 }, { t: 4, lane: 3, type: 'flick' }
  ]);
  const held = new Set();
  const eng = newEngine(chart, {}, held);
  const pressed = [];
  chart.notes.forEach((n) => {
    if (n.type === 'mine') return;
    if (n.type === 'flick') {
      /* 点划：指针按下 + 滑动（不需要松手），或键盘两键同上 */
      pressed.push({ type: 'down', lane: n.lane, time: n.t, source: 'pointer' });
      pressed.push({ type: 'swipe', lane: n.lane, time: n.t + 0.04, dx: 0, dy: -30, dist: 30 });
      return;
    }
    pressed.push({ type: 'down', lane: n.lane, time: n.t });
    if (n.type === 'hold') { held.add(n.lane); }
  });
  eng.handleEvents(pressed);
  for (let t = 0; t <= 6; t += 0.01) eng.update(t);
  if (chart.notes.some((n) => n.type === 'hold')) held.forEach((l) => held.delete(l));
  eng.update(6.2);
  eng.finish();
  const r = eng.result();
  near(r.acc, 1, 1e-9, '全 PERFECT 精度应为 1');
  eq(r.score, 1000000);
  eq(r.grade, 'SS');
  eq(r.stars, 3);
  ok(r.ap, '应为 AP');
  ok(r.clear && !r.failed);
  near(r.life, 100, 1e-6, '血量应保持满');
});

test('engine: 不按任何键应全部 MISS 并失败', () => {
  const notes = [];
  for (let i = 0; i < 20; i++) notes.push({ t: 0.8 + i * 0.4, lane: i % 4, type: 'tap' });
  const chart = makeChart(notes, { length: 30 });
  const eng = newEngine(chart);
  for (let t = 0; t <= 12; t += 0.05) eng.update(t);
  eng.finish();
  const r = eng.result();
  ok(r.counts.miss >= 10, '漏击数应足以打空血量: ' + r.counts.miss);
  eq(r.score, 0);
  ok(r.failed, '血量归零应失败');
  eq(r.grade, 'F');
  eq(r.stars, 0);
});

test('engine: 判定窗口分级（perfect/great/good/miss）', () => {
  const mk = (dtMs) => {
    const chart = makeChart([{ t: 1, lane: 0, type: 'tap' }]);
    const eng = newEngine(chart);
    eng.handleEvents([{ type: 'down', lane: 0, time: 1 + dtMs / 1000 }]);
    eng.update(1 + dtMs / 1000);
    return eng.notes[0].judge;
  };
  eq(mk(0), 'perfect');
  eq(mk(35), 'perfect');
  eq(mk(-35), 'perfect');
  eq(mk(60), 'great');
  eq(mk(-60), 'great');
  eq(mk(100), 'good');
  eq(mk(-100), 'good');
  eq(mk(140), 'miss');
});

test('engine: 偏移设置会移动判定', () => {
  const mk = (offsetMs, dtMs) => {
    const chart = makeChart([{ t: 1, lane: 0, type: 'tap' }]);
    const eng = newEngine(chart, { offsetMs });
    eng.handleEvents([{ type: 'down', lane: 0, time: 1 + dtMs / 1000 }]);
    eng.update(1 + dtMs / 1000);
    return eng.notes[0].judge;
  };
  eq(mk(0, 60), 'great');
  eq(mk(60, 60), 'perfect', '偏移 +60ms 应让 +60ms 的击打变完美');
  const chart = makeChart([{ t: 1, lane: 0, type: 'tap' }]);
  const eng = newEngine(chart, { offsetMs: 61 });
  eng.handleEvents([{ type: 'down', lane: 0, time: 1 + 60 / 1000 }]);
  eng.update(1.1);
  near(eng.result().avgOffset, -1, 1e-6, '平均偏移应按设置折算');
});

test('engine: 长按提前松手会断连并只给部分分', () => {
  const chart = makeChart([{ t: 1, lane: 0, type: 'hold', d: 1 }]);
  const held = new Set();
  const eng = newEngine(chart, {}, held);
  held.add(0);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1 }]);
  eng.update(1.1);
  held.delete(0);
  eng.handleEvents([{ type: 'up', lane: 0, time: 1.4 }]);
  eng.update(1.5);
  eng.finish();
  const r = eng.result();
  eq(r.counts.break, 1);
  eq(r.maxCombo, 1, '断连后最大连击应停在头部那一次');
  ok(r.acc > 0.4 && r.acc < 0.9, '部分分区间: ' + r.acc.toFixed(3));
  ok(!r.fc, '不应算 FC');
});

test('engine: 长按完整保持应满连击', () => {
  const chart = makeChart([{ t: 1, lane: 0, type: 'hold', d: 1 }]);
  const held = new Set([0]);
  const eng = newEngine(chart, {}, held);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1 }]);
  for (let t = 1; t <= 2.4; t += 0.05) eng.update(t);
  eng.finish();
  const r = eng.result();
  eq(r.counts.break, 0);
  near(r.acc, 1, 1e-9);
  ok(r.fc);
});

test('engine: 滑条需要终点轨道同时按住', () => {
  // 未按终点轨道 -> 断
  let chart = makeChart([{ t: 1, lane: 0, type: 'slide', d: 0.6, tail: 2 }]);
  let held = new Set([0]);
  let eng = newEngine(chart, {}, held);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1 }]);
  for (let t = 1; t <= 2; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.break, 1, '未接终点应断');

  // 按住终点轨道 -> 完美
  chart = makeChart([{ t: 1, lane: 0, type: 'slide', d: 0.6, tail: 2 }]);
  held = new Set([0]);
  eng = newEngine(chart, {}, held);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1 }]);
  held.add(2);
  for (let t = 1; t <= 2; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.break, 0, '接住终点应完成');
  near(eng.result().acc, 1, 1e-9);
});

test('engine: 长条尾部有容错窗口（略晚按到终点轨道不断连）', () => {
  const mk = (tailPressAt) => {
    const chart = makeChart([{ t: 1, lane: 0, type: 'slide', d: 0.6, tail: 2 }]);
    const held = new Set([0]);
    const eng = newEngine(chart, {}, held);
    eng.handleEvents([{ type: 'down', lane: 0, time: 1 }]);
    for (let t = 1; t < 1.62; t += 0.01) eng.update(t);
    if (tailPressAt !== null) held.add(2);
    for (let t = 1.62; t <= 2.4; t += 0.01) eng.update(t);
    eng.finish();
    return eng.result();
  };
  eq(mk(null).counts.break, 1, '完全没按终点轨道应断连');
  const late = mk(1.62);   // 尾判点之后 20ms 才按住
  eq(late.counts.break, 0, '20ms 内补上终点轨道不应断连: ' + JSON.stringify(late.counts));
  ok(late.acc > 0.9, '容错命中仍应拿到大部分分: ' + late.acc.toFixed(3));
});

test('engine: 点划＝按下后滑动（无需松手）/ 键盘需要两键同上', () => {
  /* 1) 指针：按下 + 朝任意方向滑动一下 → 命中，而且不松手也不算漏 */
  let chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  let eng = newEngine(chart);
  eng.handleEvents([
    { type: 'down', lane: 0, time: 1, source: 'pointer' },
    { type: 'swipe', lane: 0, time: 1.03, dx: -28, dy: 12, dist: 30 }
  ]);
  for (let t = 1; t <= 1.6; t += 0.05) eng.update(t);     // 一直不松手
  eng.finish();
  eq(eng.result().counts.perfect, 1, '按下后滑动应命中');
  eq(eng.result().counts.miss, 0, '不松手不应算漏（旧版会因按住过久判漏）');

  /* 2) 指针：只按下不滑动（点了就松开）→ 漏 */
  chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  eng = newEngine(chart);
  eng.handleEvents([
    { type: 'down', lane: 0, time: 1, source: 'pointer' },
    { type: 'up', lane: 0, time: 1.05, source: 'pointer' }
  ]);
  for (let t = 1; t <= 1.6; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.miss, 1, '只点一下不滑动应判漏');

  /* 3) 指针：滑得太晚（超出判定窗口）→ 漏 */
  chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  eng = newEngine(chart);
  eng.handleEvents([
    { type: 'down', lane: 0, time: 1, source: 'pointer' },
    { type: 'swipe', lane: 0, time: 1.5, dx: 40, dy: 0, dist: 40 }
  ]);
  for (let t = 1; t <= 1.8; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.miss, 1, '滑得太晚应判漏');

  /* 4) 键盘：只按一个键 → 漏 */
  chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  const held1 = new Set();
  eng = newEngine(chart, {}, held1);
  held1.add(0);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1, source: 'key' }]);
  for (let t = 1; t <= 1.6; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.miss, 1, '键盘只按一个键应判漏');

  /* 5) 键盘：同一个音符同时按两个键 → 命中，且用最初那次按下的时机 */
  chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  const held2 = new Set();
  eng = newEngine(chart, {}, held2);
  held2.add(0);                                            // 第一个键（音符所在轨）
  eng.handleEvents([{ type: 'down', lane: 0, time: 1.01, source: 'key' }]);
  held2.add(2);                                            // 第二个键
  eng.handleEvents([{ type: 'down', lane: 2, time: 1.06, source: 'key' }]);
  for (let t = 1; t <= 1.6; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.perfect, 1, '两键同上应命中');
  ok(Math.abs(eng.result().avgOffset) <= 12, '应按最初按下的时机判定：' + eng.result().avgOffset);

  /* 6) 键盘：两键本来就都按着（先按住另一个键）→ 直接命中 */
  chart = makeChart([{ t: 1, lane: 0, type: 'flick' }]);
  const held3 = new Set([3]);
  eng = newEngine(chart, {}, held3);
  held3.add(0);
  eng.handleEvents([{ type: 'down', lane: 0, time: 1, source: 'key' }]);
  for (let t = 1; t <= 1.4; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.perfect, 1, '已有两键按住时按下点划应直接命中');
});

test('engine: 地雷被踩会扣血断连，避开则无事', () => {
  // 踩雷
  let chart = makeChart([{ t: 1, lane: 2, type: 'mine' }]);
  let eng = newEngine(chart);
  eng.handleEvents([{ type: 'down', lane: 2, time: 1.02 }]);
  eng.update(1.1);
  eng.finish();
  eq(eng.result().counts.mineHit, 1);
  ok(eng.result().life < 100, '踩雷应扣血');
  ok(eng.result().stars < 3, '踩雷不应三星');

  // 避开
  chart = makeChart([{ t: 1, lane: 2, type: 'mine' }]);
  eng = newEngine(chart);
  for (let t = 0; t <= 2; t += 0.05) eng.update(t);
  eng.finish();
  eq(eng.result().counts.avoided, 1);
  eq(eng.result().counts.mineHit, 0);
  ok(!eng.result().failed);
});

test('engine: 无失败模式与自动演示', () => {
  const chart = makeChart([{ t: 1, lane: 0, type: 'tap' }], {});
  const eng = newEngine(chart, { noFail: true });
  for (let t = 0; t <= 3; t += 0.05) eng.update(t);
  eng.finish();
  ok(!eng.result().failed, '无失败模式不应失败');
  ok(eng.result().clear, '无失败模式应算通关');

  const chart2 = makeChart([{ t: 1, lane: 0, type: 'tap' }, { t: 1.5, lane: 1, type: 'hold', d: 0.5 }, { t: 2.2, lane: 3, type: 'flick' }]);
  const auto = newEngine(chart2, { autoplay: true }, new Set());
  auto.autoplay = true;
  for (let t = 0; t <= 4; t += 0.05) auto.update(t);
  auto.finish();
  const r = auto.result();
  near(r.acc, 1, 1e-9, '自动演示应全完美');
  ok(r.ap, '自动演示应为 AP');
});

test('engine: 星级门槛', () => {
  const cases = [
    { acc: 0.99, stars: 3 }, { acc: 0.97, stars: 3 },
    { acc: 0.95, stars: 2 }, { acc: 0.90, stars: 2 }, { acc: 0.85, stars: 1 }
  ];
  cases.forEach((c) => {
    const total = 100;
    const count = Math.round(c.acc * total);
    const notes = [];
    for (let i = 0; i < total; i++) notes.push({ t: 0.5 + i * 0.2, lane: i % 4, type: 'tap' });
    const chart = makeChart(notes, { length: 30 });
    const eng = newEngine(chart, { noFail: true });
    const evs = [];
    for (let i = 0; i < total; i++) if (i < count) evs.push({ type: 'down', lane: i % 4, time: notes[i].t });
    eng.handleEvents(evs);
    for (let t = 0.4; t <= 25; t += 0.05) eng.update(t);
    eng.finish();
    const r = eng.result();
    ok(Math.abs(r.acc - c.acc) < 0.02, 'acc 计算偏差: ' + r.acc);
    eq(r.stars, c.stars, 'acc=' + c.acc + ' 星级应为 ' + c.stars + ' 实际 ' + r.stars);
  });
});

test('input: 键位/指针事件与按住状态', () => {
  const input = new RG.Input({ lanes: 4, bindings: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], clock: () => 0 });
  input._rebuildKeys();
  input.enabled = true;
  // 模拟内部事件推送
  input._push('down', 0, 'key'); input.keyHeld[0]++;
  ok(input.held(0), '键盘按住应生效');
  input.keyHeld[0]--;
  ok(!input.held(0), '松开后不应按住');
  input.queue.length = 0;
  // 指针拖动：起点与终点都应视为按住
  input.laneAt = (x) => Math.max(0, Math.min(3, Math.floor(x / 100)));
  input.pointerDown(1, 10, 10);              // 轨道 0
  ok(input.held(0), '指针按下应生效');
  input.pointerMove(1, 210, 10);            // 划到轨道 2（距离 200px，超过滑动阈值）
  ok(input.held(0) && input.held(2), '拖动时起点与终点都应按住');
  const evs = input.consume();
  eq(evs.length, 3);
  eq(evs[0].type, 'down'); eq(evs[0].lane, 0);
  eq(evs[1].type, 'swipe');                 // 点划：手指滑动时补发一个 swipe（起点轨道）
  eq(evs[1].lane, 0);
  ok(evs[1].dist >= 14, 'swipe 事件应带上滑动距离：' + evs[1].dist);
  eq(evs[2].type, 'down'); eq(evs[2].lane, 2);
  input.pointerUp(1, 210, 10);
  ok(!input.held(0) && !input.held(2), '抬起后都应释放');
  eq(input.consume().length, 2, '抬起应产生两个 up 事件');
  eq(input.consume(), null, '事件应被清空');
  /* 滑动只发一次（继续移动不会重复触发） */
  input.pointerDown(2, 10, 10);
  input.consume();
  input.pointerMove(2, 20, 10);             // 距离 10px，未达阈值
  eq((input.consume() || []).length, 0, '未达阈值的轻微移动不应触发滑动');
  input.pointerMove(2, 60, 10);             // 距离 50px
  const sw = input.consume();
  eq(sw.length, 1, '超过阈值应触发一次滑动');
  eq(sw[0].type, 'swipe');
  input.pointerMove(2, 120, 40);
  const sw2 = input.consume() || [];
  eq(sw2.filter((e) => e.type === 'swipe').length, 0, '同一次按下只算一次滑动');
  input.pointerUp(2, 120, 40);
  input.consume();
});

/* ---------------- 剧情移除 / 存档迁移 ---------------- */
test('store: 剧情系统已移除（设置与存档里都没有剧情痕迹）', () => {
  eq(RG.Story, undefined, '剧情引擎应已删除');
  eq(RG.Store.resetStory, undefined, '不应再有 resetStory');
  eq(typeof RG.Store.resetAchievements, 'function', '应有 resetAchievements');
  ok(RG.Store.save().story === undefined, '默认存档不应有 story 字段');
  ok(RG.Store.settings().storyBgm === undefined, '不应再有剧情环境音乐设置');
  ok(RG.Store.settings().textSpeed === undefined, '不应再有剧情文本速度设置');
});

test('store: 老存档里的剧情数据会被迁移清掉（成绩与设置保留）', () => {
  const old = saveSandbox({
    version: 1,
    progress: { 'song-a:0': { score: 900000, acc: 0.95, stars: 3, clear: true } },
    story: { scene: 'p7', chapter: 'ch3', flags: { warm: true }, cg: ['cg1'], chaptersDone: { ch1: true }, started: true },
    achievements: { 'first-clear': 1, 'story-ch1': 1, 'story-clear': 1 }
  });
  const save = old.RG.Store.save();
  ok(save.story === undefined, '老存档里的 story 应被清掉');
  eq(save.achievements['story-ch1'], undefined, '剧情成就应被清掉');
  eq(save.achievements['story-clear'], undefined, '通关剧情成就应被清掉');
  ok(save.achievements['first-clear'], '其它成就应保留');
  ok(save.progress['song-a:0'], '成绩应保留');
  /* 迁移结果应写回本地存储，刷新后不再带 story */
  const stored = JSON.parse(old.__mem.getItem('rg.save.v1'));
  eq(stored.story, undefined, '写回的存档里不应再有 story');
  eq(stored.achievements['story-ch1'], undefined, '写回的存档里不应再有剧情成就');
  ok(stored.achievements['first-clear'], '写回时其它成就应保留');
});

test('songs: 章节解锁只看星级（提示里不再提剧情）', () => {
  RG.Store.save().progress = {};
  RG.Store.persist();
  const pixel = RG.Songs.chapter('pixel');            // 需要 ★3
  eq(RG.Songs.isChapterUnlocked(pixel), false, '星数不足应锁定');
  ok(RG.Songs.unlockHint(pixel).indexOf('★') >= 0, '提示应给出所需星数');
  ok(RG.Songs.unlockHint(pixel).indexOf('剧情') < 0, '提示不应再提剧情');
  const origin = RG.Songs.chapter('origin');
  origin.songs[0].diffs.forEach((d, i) => {
    RG.Store.submitResult(origin.songs[0].id, i, {
      score: 900000, acc: 0.98, maxCombo: 100, grade: 'S', clear: true, stars: 3,
      fc: true, ap: false, miss: 0, perfect: 100, totalNotes: 100, duration: 60
    });
  });
  ok(RG.Store.totalStars() >= 3, '应拿到至少 3 星：' + RG.Store.totalStars());
  ok(RG.Songs.isChapterUnlocked(pixel), '星级够了应解锁下一片区域');
  eq(RG.Songs.unlockHint(pixel), '', '已解锁时不应有提示');
  /* 每片区域的解锁门槛都要有对应的星级提示 */
  RG.Songs.chapters.forEach((c) => {
    if (c.workshop || !c.unlock || !c.unlock.stars) return;
    ok(RG.Songs.unlockHint(c).indexOf('★' + c.unlock.stars) >= 0 || RG.Songs.isChapterUnlocked(c),
      c.name + ' 的解锁提示应包含需要星数');
  });
});

test('achievements: 成就列表里已无剧情项，且都能被正常判定', () => {
  const list = RG.Achievements.list;
  ok(list.length >= 6, '成就数量应足够：' + list.length);
  list.forEach((a) => {
    ok(a.id && a.name && a.desc, '成就字段应完整：' + JSON.stringify(a));
    ok(!/story|剧情|插画|cg/.test(a.id + a.name + a.desc), '不应再有剧情向成就：' + a.id);
  });
  RG.Store.save().achievements = {};
  const realToast = RG.UI && RG.UI.toast;
  if (RG.UI) RG.UI.toast = () => { };        // 无头环境没有 toast 容器
  RG.Achievements.check({
    result: {
      clear: true, fc: false, ap: false, mines: 2,
      counts: { perfect: 10, great: 0, good: 0, miss: 0, break: 0, mineHit: 0 }
    }
  });
  ok(RG.Achievements.unlocked()['first-clear'], '通关应解锁「初次共振」');
  ok(RG.Achievements.unlocked()['no-mine'], '带 MINE 且一颗没踩应解锁「排雷专家」');
  ok(!RG.Achievements.unlocked()['ap'], '没有 AP 不应解锁全完美');
  ok(RG.Achievements.progress().got >= 2, '应记录解锁数量：' + RG.Achievements.progress().got);
  if (RG.UI && realToast) RG.UI.toast = realToast;
});


/* ---------------- 默认值 / 存档 ---------------- */
test('util: deepMerge 不与默认对象共享嵌套引用（默认值被污染会让"恢复默认/清除存档"失效）', () => {
  const base = { a: 1, nested: { x: 1, deep: { y: 2 } }, list: [1, 2] };
  const merged = U.deepMerge(base, {});
  merged.nested.x = 99;
  merged.nested.deep.y = 99;
  merged.list.push(3);
  eq(base.nested.x, 1, '默认值的嵌套对象不应被改动');
  eq(base.nested.deep.y, 2, '深层嵌套也不应被改动');
  eq(base.list.length, 2, '数组应被复制');
  const merged2 = U.deepMerge(base, { nested: { x: 5 } });
  eq(merged2.nested.x, 5, '覆盖值应生效');
  eq(merged2.nested.deep.y, 2, '未覆盖的深层值应保留且独立');
  eq(base.nested.x, 1, 'base 仍不应被改动');
  eq(U.deepMerge({}, { k: { v: 1 } }).k.v, 1, '空 base 也应可用');
  eq(U.deepMerge(null, { k: 1 }).k, 1, 'base 为 null 也应可用');
});

test('store: 全新存档判定与彻底清除（含默认值不受污染）', () => {
  RG.Store.wipeAll();
  eq(RG.Store.isFresh(), true, '刚清除应是全新存档');
  RG.Store.set('scrollSpeed', 9);
  eq(RG.Store.get('scrollSpeed'), 9);
  eq(RG.Store.DEFAULT_SETTINGS.scrollSpeed, 6, '默认设置不应被运行时改动污染');
  RG.Store.submitResult('wipe-check', 0, {
    score: 800000, acc: 0.93, maxCombo: 50, grade: 'A', clear: true, stars: 3,
    fc: false, ap: false, miss: 0, perfect: 50, totalNotes: 60, duration: 40
  });
  eq(RG.Store.totalStars(), 3);
  eq(RG.Store.isFresh(), false, '有成绩后不再是全新存档');
  eq(Object.keys(RG.Store.DEFAULT_SAVE.progress).length, 0, 'DEFAULT_SAVE 不应被写入进度');
  RG.Store.wipeAll();
  eq(RG.Store.totalStars(), 0, '清除后成绩应归零');
  eq(RG.Store.get('scrollSpeed'), 6, '清除后设置应回默认');
  eq(RG.Store.save().story, undefined, '清除后存档里也不应有剧情字段');
  eq(RG.Store.isFresh(), true, '清除后应视为全新存档');
  /* 看过教程后不再算全新存档 */
  RG.Store.save().tutorialDone = true;
  eq(RG.Store.isFresh(), false, '看过教程后应直接进主页');
  RG.Store.wipeAll();
  eq(RG.Store.save().tutorialDone, false, '清除后教程标记也应重置');
});

test('store: 恢复默认设置不受运行时改动影响', () => {
  RG.Store.wipeAll();
  RG.Store.set('judgeLine', 0.6);
  RG.Store.set('skin', 'minimal');
  RG.Store.set('bindings.4', ['KeyZ', 'KeyX', 'KeyC', 'KeyV']);
  RG.Store.resetSettings();
  eq(RG.Store.get('judgeLine'), 0.82, '嵌套/数值设置应恢复默认（旧实现会保留被污染的默认值）');
  eq(RG.Store.get('skin'), 'neon', '皮肤应恢复默认');
  eq(RG.Store.lanesFor(4)[0], 'KeyD', '键位应恢复默认');
  /* 内置相机常量不应被设置改动污染 */
  eq(RG.Store.CAMERA.fov, 72, '内置相机 FOV 不应被改动');
  RG.Store.set('camera.fov', 100);                         // 往设置里写也不会影响内置常量
  eq(RG.Store.CAMERA.fov, 72, '内置相机常量与设置互不影响');
});

/* ---------------- 新手教程 ---------------- */
test('tutorial: 步骤数据完整（无文字说明、只有代号与动画）、每个上机步骤都能建出合法谱面', () => {
  const T = RG.Tutorial;
  ok(T.steps.length >= 6, '步骤数：' + T.steps.length);
  const ids = T.steps.map((s) => s.id);
  ['tap', 'hold', 'slide', 'flick', 'mine'].forEach((k) => {
    ok(ids.indexOf(k) >= 0, '应包含 ' + k + ' 步骤');
  });
  eq(ids[0], 'welcome', '第一步应是欢迎');
  eq(ids[ids.length - 1], 'done', '最后一步应是收尾');
  const demoNames = ['welcome', 'tap', 'hold', 'slide', 'flick', 'mine', 'done'];
  T.steps.forEach((s) => {
    ok(s.title, s.id + ' 缺少标题');
    ok(!s.body && !s.hint, s.id + ' 不应再有文字说明（改用动画演示）');
    ok(demoNames.indexOf(s.demo) >= 0, s.id + ' 的演示类型未知：' + s.demo);
    if (s.play) {
      ok(s.play.notes.length >= 1, s.id + ' 没有音符');
      ok(['noMiss', 'noBreak', 'clean'].indexOf(s.play.require) >= 0, s.id + ' 判定条件非法');
      ok(s.play.length > 5, s.id + ' 时长过短');
      ok(s.goal, s.id + ' 缺少目标（代号形式）');
      const chart = T.buildChart(s);
      const v = RG.Chart.validate(chart);
      ok(v.ok, s.id + ' 谱面校验失败：' + v.errors.slice(0, 2).join(';'));
      eq(chart.meta.lanes, 4, '教程统一 4 轨');
      ok(chart.notes.length === s.play.notes.length, s.id + ' 音符数应与定义一致');
      chart.notes.forEach((n) => ok(n.t < s.play.length + 1, s.id + ' 音符超出时长'));
      ok(chart.meta.music && chart.meta.music.style, s.id + ' 应带程序化乐曲定义');
    } else {
      ok(s.action, s.id + ' 非上机步骤应有 action 按钮文案');
    }
  });
  /* 上机步骤的标题只能是代号（不要在游戏里出现音符的中文名） */
  T.steps.filter((s) => s.play).forEach((s) => {
    eq(s.title, s.id.toUpperCase(), s.id + ' 的标题应只用代号：' + s.title);
    ok(!/[\u4e00-\u9fa5]/.test(s.title), s.id + ' 的标题不应含中文：' + s.title);
    ok(!/[\u4e00-\u9fa5]/.test(s.goal), s.id + ' 的目标不应含中文：' + s.goal);
  });
});

test('engine: 五种音符的代号只保留英文（游戏里不再出现中文名）', () => {
  RG.Chart.ORDER.forEach((k) => {
    const ty = RG.Chart.TYPES[k];
    ok(!/[\u4e00-\u9fa5]/.test(ty.label), k + ' 的名称不应含中文：' + ty.label);
    ok(!/[\u4e00-\u9fa5]/.test(ty.short), k + ' 的简称不应含中文：' + ty.short);
  });
  eq(RG.Chart.TYPES.tap.label, 'TAP');
  eq(RG.Chart.TYPES.hold.label, 'HOLD');
  eq(RG.Chart.TYPES.slide.label, 'SLIDE');
  eq(RG.Chart.TYPES.flick.label, 'FLICK');
  eq(RG.Chart.TYPES.mine.label, 'MINE');
  /* 章节/曲目描述等展示文案里也不应出现音符中文名 */
  const bad = [];
  RG.Songs.chapters.forEach((c) => {
    if (c.desc) bad.push(c.desc);
    if (c.name) bad.push(c.name);
    (c.songs || []).forEach((s) => { if (s.desc) bad.push(s.desc); if (s.title) bad.push(s.title); });
  });
  bad.forEach((txt) => {
    ['单点', '长按', '滑条', '点划', '地雷'].forEach((cn) => {
      ok(txt.indexOf(cn) < 0, '描述里不应出现音符中文名「' + cn + '」：' + txt);
    });
  });
});

test('tutorial: 通过条件判定（不许 MISS / 不许断连 / 不许踩雷）', () => {
  const T = RG.Tutorial;
  const mk = (counts, acc) => ({ counts: counts, acc: acc || 0, score: 0, maxCombo: 0, grade: 'D' });
  eq(T.check('noMiss', mk({ miss: 0 })).pass, true);
  eq(T.check('noMiss', mk({ miss: 1 })).pass, false);
  eq(T.check('noBreak', mk({ break: 1 })).pass, false);
  eq(T.check('noBreak', mk({ break: 0, miss: 0 })).pass, true);
  eq(T.check('clean', mk({ mineHit: 1 })).pass, false, '踩雷不算通过');
  eq(T.check('clean', mk({ mineHit: 0, miss: 0 })).pass, true);
  eq(T.check('clean', mk({ mineHit: 0, miss: 2 })).pass, false);
  ok(T.check('noMiss', mk({ miss: 1 })).detail.indexOf('MISS') >= 0, '应给出细节');
  eq(T.check('noMiss', null).pass, false, '空结果不应通过');
  ok(T.done() === false || T.done() === true);
});

test('ui: 结算统计是两列网格、无背景覆盖层、游玩界面无底部文字', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
  /* 结算：两列 */
  const resList = (css.match(/\.res-list\{[^}]*\}/) || [''])[0];
  ok(resList, '应有 .res-list 样式');
  ok(/grid-template-columns:\s*1fr\s+1fr/.test(resList), '结算统计应是两列：' + resList);
  ok(/grid-auto-flow:\s*column/.test(resList), '两列应按列优先填充（左边 6 行、右边 6 行）');
  /* 暂停 / 结算：没有任何背景 */
  ok(/\.ov-card\.bare\{[^}]*background:none/.test(css), '暂停框不应有背景');
  ok(/\.ov-card\.full\{[^}]*background:none/.test(css), '结算铺满时不应有背景');
  ok(/\.sym-btn\{[^}]*background:none/.test(css), '符号按钮不应有背景');
  /* 游玩界面：底部文字元素已从 HTML 移除；分数与实时精度改到正上方 */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(html.indexOf('gh-offset') < 0, 'index.html 不应再有 #gh-offset');
  ok(html.indexOf('gh-view') < 0 && html.indexOf('gh-fps') < 0, 'index.html 不应再有视角/帧率');
  ok(/gh-topcenter[\s\S]{0,240}gh-score[\s\S]{0,240}gh-acc/.test(html), '分数与实时精度应在顶部居中块里');
  ok(/\.gh-topcenter\{[^}]*left:50%[^}]*translateX\(-50%\)/.test(css), '顶部分数块应水平居中');
  ok(/\.gh-topcenter\{[^}]*top:\d+px/.test(css), '顶部分数块应贴在画面顶部');
});

/* ---------------- 报告 ---------------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('\n失败详情:');
  failures.forEach(([n, e]) => console.log('  - ' + n + ': ' + (e && e.message)));
  process.exit(1);
}
console.log('全部通过 ✅\n');

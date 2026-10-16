/*! Resonance Engine · 3D 视野布局报告
 * 用真实渲染代码算出 3D 模式的关键几何量，方便调视野/机位时对照。
 *   node tests/layout.cjs
 *   node tests/layout.cjs --fov 90 --height 2.8 --lanes 6
 *   node tests/layout.cjs --compare      # 只对比旧默认与新默认
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const noop = () => { };
const grad = { addColorStop: noop };
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if (k === 'measureText') return () => ({ width: 42 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return noop;
  },
  set() { return true; }
});
function makeCanvas(w, h) {
  return {
    clientWidth: w, clientHeight: h, width: w, height: h, style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, setPointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    getContext: () => ctxStub
  };
}
function load(settings) {
  const mem = new Map();
  const sandbox = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp, Map, Set,
    Promise, Symbol, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Uint8Array, Uint8ClampedArray,
    setTimeout, clearTimeout, setInterval, clearInterval, Proxy,
    performance: { now: () => Date.now() },
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k)
    },
    document: { createElement: () => makeCanvas(1280, 720), getElementById: () => null, addEventListener: noop },
    navigator: { userAgent: 'node' }, devicePixelRatio: 1, requestAnimationFrame: noop
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (settings) mem.set('rg.settings.v1', JSON.stringify(settings));
  ['src/util.js', 'src/store.js', 'src/audio.js', 'src/chart.js', 'src/songs.js', 'src/render.js']
    .forEach((rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel }));
  return sandbox.RG;
}

function report(RG, cam, opts) {
  const W = opts.w || 1280, H = opts.h || 720, lanes = opts.lanes || 4;
  const s = RG.Store.settings();
  s.judgeLine = opts.judgeLine || s.judgeLine;
  s.camera = Object.assign({}, s.camera, cam);
  const r = new RG.Render(makeCanvas(W, H), { settings: s });
  r.setView('3d', 0, true);      // 视角现在由谱面控制，这里直接进 3D
  r.setLanes(lanes);
  r._layout();
  const f = r.focal;
  const jl = r._project(0, 0, 0);
  const left = r._project(-lanes / 2 * r.laneWU, 0, 0);
  const right = r._project(lanes / 2 * r.laneWU, 0, 0);
  const roadW = right.x - left.x;
  const far = r._project(0, 0, r.worldFar);
  const topSpan = Math.abs(r._project(0, 0.36, 1.5).y - r._project(0, 0.36, 0).y);
  const pct = (v, base) => (v / base * 100).toFixed(1) + '%';
  console.log('  FOV ' + r.cam.fov + '° · 俯角 ' + r.cam.pitch + '° · 机位 ' + r.cam.height +
    ' · 距离 ' + r.cam.dist + ' · 路面宽 ' + r.cam.width + ' · ' + lanes + ' 轨');
  console.log('    焦距 f            : ' + f.toFixed(1) + ' px');
  console.log('    地平线 y          : ' + r.horizonY.toFixed(1) + ' px  (' + pct(r.horizonY, H) + ')');
  console.log('    判定线 y          : ' + jl.y.toFixed(1) + ' px  (' + pct(jl.y, H) + ')  设定值 ' + pct(H * s.judgeLine, H));
  console.log('    可见路面纵深带     : ' + (jl.y - r.horizonY).toFixed(1) + ' px');
  console.log('    判定线路面总宽     : ' + roadW.toFixed(1) + ' px  (' + pct(roadW, W) + ' )  每轨 ' + (roadW / lanes).toFixed(1) + ' px');
  console.log('    远端收敛 y        : ' + far.y.toFixed(1) + ' px（距地平线 ' + Math.abs(far.y - r.horizonY).toFixed(1) + ' px）');
  console.log('    音符顶面纵深       : ' + topSpan.toFixed(1) + ' px');
  console.log('    俯视程度          : 俯角 ' + r.cam.pitch + '°' +
    '（俯角越大越俯视；可见纵深带 / 画面高 = ' + pct(jl.y - r.horizonY, H) + '）');
  if (jl.y > H) console.log('    ⚠ 判定线已跑出画面');
  if (r.horizonY < 0) console.log('    ⚠ 地平线已跑出画面顶部（俯角偏大）');
  if (roadW < W * 0.2) console.log('    ⚠ 路面偏窄，建议加大「3D 路面宽度」');
  return r;
}

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? parseFloat(argv[i + 1]) : dflt;
}
const opts = { w: arg('w', 1280), h: arg('h', 720), lanes: arg('lanes', 4), judgeLine: arg('judge-line', null) || 0.82 };

console.log('\n=== 3D 视野布局报告 ===');
console.log('注：判定线由「判定线位置」设定固定（2D/3D 一致），调 FOV / 俯角 / 机位时地平线自动让位，判定线不会漂移。\n');
const RG = load(null);

if (argv.includes('--compare') || argv.length === 0) {
  console.log('[旧默认] fov 62 / 无俯角 / 机位 1.5 / 路面 3.4');
  report(RG, { fov: 62, pitch: 0, height: 1.5, dist: 3.6, width: 3.4 }, opts);
  console.log('\n[上一版默认] fov 72 / 无俯角 / 机位 2.1 / 路面 4.2');
  report(RG, { fov: 72, pitch: 0, height: 2.1, dist: 3.6, width: 4.2 }, opts);
  console.log('\n[当前默认 · 更俯视] fov 72 / 俯角 48° / 机位 2.1 / 路面 4.2');
  report(RG, { fov: 72, pitch: 48, height: 2.1, dist: 3.6, width: 4.2 }, opts);
  if (argv.length === 0) {
    console.log('\n[更俯视] fov 72 / 俯角 58° / 机位 2.1 / 路面 4.2');
    report(RG, { fov: 72, pitch: 58, height: 2.1, dist: 3.6, width: 4.2 }, opts);
    console.log('\n（可用 --fov/--pitch/--height/--dist/--width/--lanes 传入其它组合）');
  }
} else {
  report(RG, {
    fov: arg('fov', 72), pitch: arg('pitch', 48), height: arg('height', 2.1),
    dist: arg('dist', 3.6), width: arg('width', 4.2)
  }, opts);
}
console.log('');

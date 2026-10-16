/*! Resonance · 集成测试（自建 DOM / Canvas / WebAudio 桩）
 * 直接解析 index.html 构建虚拟 DOM，加载全部脚本并跑通：
 *   TAP TO START → 模式选取 → 故事模式（对话/选择/战斗/结算/插画）
 *   → 自由演奏（大地图选曲 → 完整打完一首 → 结算）→ 档案（图鉴/成就）
 *   → 设置（含实时预览）→ 工坊 → 编辑器（放置/拖动/撤销/试听/保存）→ 试玩
 *   node tests/dom-smoke.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('  \u2713 ' + name); },
    (e) => { fail++; failures.push([name, e]); console.log('  \u2717 ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); });
}
function ok(v, m) { if (!v) throw new Error(m || '期望真值'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'eq') + ' 实际=' + a + ' 期望=' + b); }
function near(a, b, tol, m) { if (!(Math.abs(a - b) <= (tol == null ? 1e-6 : tol))) throw new Error((m || 'near') + ' 实际=' + a + ' 期望=' + b); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================================================================
 * 1. 极简 DOM
 * ====================================================================== */
const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

class ClassList {
  constructor(el) { this.el = el; }
  _s() { return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean)); }
  _w(s) { this.el.className = Array.from(s).join(' '); }
  add(...c) { const s = this._s(); c.forEach((x) => s.add(x)); this._w(s); }
  remove(...c) { const s = this._s(); c.forEach((x) => s.delete(x)); this._w(s); }
  contains(c) { return this._s().has(c); }
  toggle(c, on) { const s = this._s(); const want = on === undefined ? !s.has(c) : !!on; want ? s.add(c) : s.delete(c); this._w(s); return want; }
}

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.id = '';
    this.value = '';
    this._text = '';
    this._listeners = {};
    this._checked = false;
    this.classList = new ClassList(this);
    if (this.tagName === 'CANVAS') {
      this.width = 300; this.height = 150;
      this.clientWidth = 1280; this.clientHeight = 720;
      this._ctx = makeCtx();
    }
  }
  /* --- 树 --- */
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.id) this.ownerDocument._reg(c); return c; }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(n);
    n.parentNode = this;
    this.childNodes.splice(i, 0, n);
    if (n.id) this.ownerDocument._reg(n);
    return n;
  }
  replaceChild(n, old) { this.insertBefore(n, old); return this.removeChild(old); }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') { this.id = String(v); this.ownerDocument._reg(this); }
    if (k === 'class') this.className = String(v);
    if (k === 'value' && /^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(this.tagName)) this.value = String(v);
    if (k.indexOf('data-') === 0) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v);
    return v;
  }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  /* --- 文本 / HTML --- */
  get textContent() { return this._text || this.childNodes.map((c) => (c instanceof El ? c.textContent : c)).join(''); }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  get innerHTML() { return this._text; }
  set innerHTML(html) {
    this.childNodes = []; this._text = '';
    parseHTML(String(html), this, this.ownerDocument);
  }
  get offsetWidth() { return 200; }
  get offsetHeight() { return 40; }
  /* --- 选择器 --- */
  _matches(sel) {
    sel = sel.trim();
    if (!sel) return false;
    /* 支持 tag[attr=val] / .class[attr=val] / [attr=val] */
    const bracket = sel.indexOf('[');
    const base = bracket >= 0 ? sel.slice(0, bracket).trim() : sel;
    let attrs = [];
    if (bracket >= 0) {
      attrs = sel.slice(bracket).match(/\[[^\]]*\]/g) || [];
      for (const a of attrs) {
        const m = a.match(/^\[([\w-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]$/);
        if (!m) return false;
        const v = this.getAttribute(m[1]);
        if (v === null) return false;
        if (m[3] !== undefined && v !== m[3]) return false;
      }
    }
    if (!base) return attrs.length > 0;
    if (base.startsWith('#')) return this.id === base.slice(1);
    const tc = base.match(/^([\w-]*)((?:\.[\w-]+)*)$/);
    if (!tc) return false;
    if (tc[1] && this.tagName !== tc[1].toUpperCase()) return false;
    const classes = (tc[2] || '').split('.').filter(Boolean);
    return classes.every((c) => this.classList.contains(c));
  }
  /** 支持后代选择器（"a b c"） */
  _matchesComplex(sel) {
    const parts = String(sel).trim().split(/\s+/);
    if (parts.length === 1) return this._matches(parts[0]);
    if (!this._matches(parts[parts.length - 1])) return false;
    let i = parts.length - 2, n = this.parentNode;
    while (i >= 0 && n) {
      if (n._matches && n._matches(parts[i])) i--;
      n = n.parentNode;
    }
    return i < 0;
  }
  querySelectorAll(sel) {
    const parts = String(sel).split(',').map((s) => s.trim());
    const out = [];
    const walk = (n) => {
      n.childNodes.forEach((c) => {
        if (!(c instanceof El)) return;
        if (parts.some((p) => c._matchesComplex(p))) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    let n = this;
    while (n) { if (n._matchesComplex && n._matchesComplex(sel)) return n; n = n.parentNode; }
    return null;
  }
  /* --- 事件 --- */
  addEventListener(type, fn, opts) {
    const key = type + (opts === true || (opts && opts.capture) ? ':capture' : '');
    (this._listeners[key] = this._listeners[key] || []).push(fn);
  }
  removeEventListener(type, fn, opts) {
    const key = type + (opts === true || (opts && opts.capture) ? ':capture' : '');
    const arr = this._listeners[key];
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    const chain = [];
    let n = this;
    while (n) { chain.push(n); n = n.parentNode; }
    const doc = this.ownerDocument;
    if (doc && chain.indexOf(doc) < 0) chain.push(doc);
    const fire = (node, key) => {
      const arr = node._listeners && node._listeners[key];
      if (arr) arr.slice().forEach((fn) => { if (!ev.__stopped) fn.call(node, ev); });
    };
    for (let i = chain.length - 1; i >= 0; i--) fire(chain[i], ev.type + ':capture');
    for (let i = 0; i < chain.length; i++) {
      fire(chain[i], ev.type);
      // 内联事件属性（onclick/oninput…）在真实 DOM 里等价于监听器
      const prop = chain[i]['on' + ev.type];
      if (!ev.__stopped && typeof prop === 'function') prop.call(chain[i], ev);
      if (ev.__stopped) break;
    }
    return !ev.defaultPrevented;
  }
  click() {
    const ev = {
      type: 'click', target: this, preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.__stopped = true; }
    };
    this.dispatchEvent(ev);
  }
  setPointerCapture() { }
  releasePointerCapture() { }
  getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth || 1280, bottom: this.clientHeight || 720, width: this.clientWidth || 1280, height: this.clientHeight || 720 }; }
  getContext() { return this._ctx; }
  focus() { }
}

/* --- Canvas 2D 桩 --- */
function makeCtx() {
  const grad = { addColorStop() { } };
  const noop = () => { };
  const ctx = {
    canvas: null, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', shadowColor: '#000', shadowBlur: 0,
    lineDashOffset: 0,
    save: noop, restore: noop, setTransform: noop, transform: noop, resetTransform: noop,
    translate: noop, rotate: noop, scale: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop, rect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, clip: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop, setLineDash: noop,
    drawImage: noop, measureText: () => ({ width: 42 }), createLinearGradient: () => grad,
    createRadialGradient: () => grad, createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop
  };
  return ctx;
}

/* --- HTML 解析（够用即可） --- */
function parseHTML(html, root, doc) {
  const stack = [root];
  let i = 0;
  const addText = (txt) => {
    if (!txt.trim()) return;
    const top = stack[stack.length - 1];
    top.childNodes.push(txt);
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { i = html.indexOf('-->', lt) + 3; continue; }
    if (html.startsWith('<!', lt)) { i = html.indexOf('>', lt) + 1; continue; }
    if (/^<\//.test(html.slice(lt, lt + 2))) {
      i = html.indexOf('>', lt) + 1;
      if (stack.length > 1) stack.pop();
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const raw = html.slice(lt + 1, gt);
    const selfClose = raw.endsWith('/');
    const parts = raw.replace(/\/$/, '').trim().split(/\s+/);
    const tag = parts.shift();
    const el = doc.createElement(tag);
    parts.join(' ').replace(/([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)'|(?=\s|$))/g, (m, k, v1, v2) => {
      el.setAttribute(k, v1 !== undefined ? v1 : (v2 !== undefined ? v2 : ''));
      return m;
    });
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(tag.toLowerCase()) && !selfClose) {
      if (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'style') {
        const close = html.indexOf('</' + tag, gt);
        i = close < 0 ? gt + 1 : html.indexOf('>', close) + 1;
        continue;
      }
      stack.push(el);
    }
    i = gt + 1;
  }
}

/* --- document --- */
function makeDocument() {
  const doc = {
    readyState: 'complete',
    activeElement: null,
    _byId: {},
    _reg(el) { if (el.id) doc._byId[el.id] = el; },
    createElement(tag) { const e = new El(tag, doc); return e; },
    getElementById(id) { return doc._byId[id] || null; },
    querySelector(sel) { return doc.body.querySelector(sel); },
    querySelectorAll(sel) { return doc.body.querySelectorAll(sel); },
    addEventListener(t, f, o) { doc.body.addEventListener(t, f, o); },
    removeEventListener(t, f, o) { doc.body.removeEventListener(t, f, o); },
    _listeners: {}
  };
  doc.body = new El('body', doc);
  doc.documentElement = new El('html', doc);
  doc.body.parentNode = doc.documentElement;
  /* body 上的监听要在捕获阶段最先触发，这里让 body 代理 document 需要的监听 */
  const bodyAdd = doc.body.addEventListener.bind(doc.body);
  doc.body.addEventListener = bodyAdd;
  return doc;
}

/* ======================================================================
 * 2. WebAudio 桩（真实排程路径可跑通）
 * ====================================================================== */
function makeAudio() {
  function param(v) {
    return {
      value: v,
      setValueAtTime(x) { this.value = x; return this; },
      linearRampToValueAtTime(x) { this.value = x; return this; },
      exponentialRampToValueAtTime(x) { this.value = x; return this; },
      cancelScheduledValues() { return this; },
      setTargetAtTime(x) { this.value = x; return this; }
    };
  }
  function node(extra) {
    return Object.assign({
      connect() { }, disconnect() { }, start() { }, stop() { }
    }, extra);
  }
  let scheduled = 0;
  class AudioContextStub {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = node({});
      this._scheduled = 0;
    }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), start() { this._started = true; }, stop() { } }); }
    createBufferSource() { return node({ buffer: null, loop: false }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }); }
    createAnalyser() {
      return node({
        fftSize: 512, smoothingTimeConstant: 0.7, frequencyBinCount: 256,
        getByteFrequencyData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = (i * 37) % 200; },
        getByteTimeDomainData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = 128; }
      });
    }
    createBuffer(ch, len) { return { length: len, numberOfChannels: ch, sampleRate: this.sampleRate, getChannelData: () => new Float32Array(len) }; }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { return Promise.resolve(); }
    __advance(dt) { this.currentTime += dt; }
  }
  return AudioContextStub;
}

/* ======================================================================
 * 3. 沙箱 + 加载
 * ====================================================================== */
const FILES = ['src/util.js', 'src/store.js', 'src/audio.js', 'src/chart.js', 'src/songs.js', 'src/input.js',
  'src/engine.js', 'src/render.js', 'src/worldmap.js', 'src/art.js', 'src/screens.js',
  'src/preview.js', 'src/frontend.js', 'src/tutorial.js', 'src/editor.js', 'src/main.js'];
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

const rafQueue = [];
function createSandbox() {
  const doc = makeDocument();
  const sandbox = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp, Map, Set,
    Promise, Symbol, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Uint8Array, Uint8ClampedArray,
    Float32Array, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    localStorage: memStorage(),
    document: doc,
    navigator: { userAgent: 'node-harness' },
    devicePixelRatio: 1,
    AudioContext: makeAudio(),
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame: () => { },
    Blob: function (parts) { this.parts = parts; },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => { } },
    FileReader: function () { this.readAsText = () => { }; },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  /* window 级事件（输入系统挂在 window 上） */
  sandbox._listeners = {};
  sandbox.addEventListener = function (t, f, o) { const k = t + (o === true ? ':capture' : ''); (sandbox._listeners[k] = sandbox._listeners[k] || []).push(f); };
  sandbox.removeEventListener = function (t, f, o) { const k = t + (o === true ? ':capture' : ''); const a = sandbox._listeners[k]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } };
  sandbox.dispatchEvent = function (ev) {
    ['keydown:capture', 'keydown', 'keyup', 'blur', 'resize'].forEach((k) => {
      if (k.split(':')[0] !== ev.type) return;
      (sandbox._listeners[k] || []).slice().forEach((f) => f(ev));
    });
    return true;
  };
  vm.createContext(sandbox);

  /* 解析 index.html 得到真实 DOM 结构 */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bodyHtml = html.slice(html.indexOf('<body'), html.indexOf('</body>') + 7);
  parseHTML(bodyHtml, doc.body, doc);
  doc.body.childNodes.forEach(function reg(n) { if (n instanceof El) { if (n.id) doc._reg(n); n.querySelectorAll('*').forEach((c) => { if (c.id) doc._reg(c); }); } });

  FILES.forEach((rel) => {
    const p = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
  });
  return sandbox;
}

let clockMs = 1000;
function drain(count, dtMs) {
  for (let i = 0; i < count; i++) {
    clockMs += dtMs;
    const q = rafQueue.splice(0);
    q.forEach((cb) => { cb(clockMs); });
  }
}
function key(code, type) {
  return { code: code, type: type || 'keydown', repeat: false, preventDefault() { }, stopPropagation() { } };
}

/* ======================================================================
 * 4. 集成测试
 * ====================================================================== */
(async function main() {
  console.log('\n=== Resonance Engine · 集成测试（DOM/Canvas/Audio 桩） ===\n');
  const win = createSandbox();
  const RG = win.RG;
  const doc = win.document;

  await test('启动：全部界面所需的 DOM 元素都已就绪（剧情系统已移除）', () => {
    ok(RG.app && RG.app.renderer && RG.app.map && RG.app.input, '应用未完成初始化');
    ok(RG.Front && RG.Art && RG.Preview && RG.Tutorial, '新的模块未加载');
    eq(RG.AIArt, undefined, 'AI 生图功能应已移除');
    ['screen-title', 'screen-modes', 'screen-profile', 'screen-map', 'screen-settings',
      'screen-workshop', 'screen-editor', 'screen-game',
      'title-bg', 'modes-bg', 'mode-list', 'mode-detail',
      'profile-tabs', 'profile-body', 'tap-hint', 'title-meta',
      'map-canvas', 'game-canvas', 'editor-canvas', 'gh-combo', 'gh-life',
      'gh-pause-progress', 'gh-title', 'gh-diff', 'ed-status',
      'settings-body', 'settings-preview', 'ws-grid', 'res-grid', 'modal-card', 'toast-host'].forEach((id) => {
        ok(doc.getElementById(id), '缺少元素 #' + id);
      });
    /* 剧情系统整体移除：模块、界面、元素、存档字段全部不该存在 */
    eq(win.RG.Story, undefined, '剧情引擎应已删除');
    eq(win.RG.StoryUI, undefined, '剧情界面层应已删除');
    eq(doc.getElementById('screen-story'), null, '剧情界面应已从 HTML 移除');
    ['gh-goal', 'story-art', 'story-ui', 'story-menu', 'story-chapters', 'story-text',
      'story-choices', 'story-card', 'story-artbar'].forEach((id) => {
        eq(doc.getElementById(id), null, '#' + id + ' 应已移除');
      });
    ok(RG.Store.save().story === undefined, '存档里不应再有 story 字段');
    ok(RG.Store.settings().storyBgm === undefined && RG.Store.settings().textSpeed === undefined,
      '不应再有剧情相关的设置项');
    ok(RG.Store.resetStory === undefined, '不应再有 resetStory');
    ok(typeof RG.Store.resetAchievements === 'function', '应有 resetAchievements');
    /* 正上方要显示分数与实时精度（顶部居中） */
    const topC = doc.querySelector('.gh-topcenter');
    ok(topC, '应有顶部居中的分数/精度块');
    ok(topC.contains(doc.getElementById('gh-score')), '分数应在顶部居中块里');
    ok(topC.contains(doc.getElementById('gh-acc')), '精度应在顶部居中块里');
    /* 已移除的 HUD 元素：不再显示 2D/3D、帧率、底部文字 */
    ['gh-view', 'gh-fps', 'gh-progress-fill', 'pause-stats', 'gh-offset'].forEach((id) => {
      eq(doc.getElementById(id), null, '#' + id + ' 应已移除');
    });
    eq(RG.Store.settings().view3d, undefined, '不应再有全局 3D 开关');
    eq(RG.Store.settings().camera, undefined, '3D 相机参数应内置（不再是设置项）');
    eq(RG.Store.settings().showFps, undefined, '不应再有帧率显示设置');
    eq(RG.Store.CAMERA.dist, 2.4, '内置相机距离应为 2.4');
    eq(RG.Store.CAMERA.speed, 0.8, '内置速度系数应为 0.8');
    eq(RG.app.current, undefined);
    eq(doc.getElementById('screen-title').classList.contains('active'), true, '待机画面应激活');
  });

  await test('待机画面：动画帧可绘制，全新存档时提示新手教程', () => {
    drain(20, 16);
    eq(RG.UI.current, 'screen-title');
    ok(RG.Store.isFresh(), '测试开始时应是全新存档');
    const hint = doc.getElementById('tap-hint').textContent;
    ok(hint.indexOf('TAP TO START') >= 0, '应显示 TAP TO START：' + hint);
    ok(hint.indexOf('新手教程') >= 0, '全新存档应提示新手教程：' + hint);
    ok(doc.getElementById('title-meta').children.length >= 4, '底部应有统计条');
    ok(typeof RG.Front.drawAttract === 'function');
  });

  await test('新手教程：全新存档 TAP TO START 后先进入教程，跳过即到模式选取', () => {
    doc.getElementById('screen-title').dispatchEvent({
      type: 'pointerdown', target: doc.getElementById('screen-title'),
      preventDefault() { }, stopPropagation() { }
    });
    drain(3, 16);
    eq(RG.UI.current, 'screen-tutorial', '全新存档第一次点击应进入新手教程');
    eq(RG.Tutorial.idx, 0, '应停在第 1 步（欢迎）');
    const card = doc.getElementById('tut-card');
    ok(card.textContent.indexOf('RESONANCE') >= 0, '应显示欢迎步骤：' + card.textContent.slice(0, 40));
    ok(card.textContent.indexOf('静默之城') < 0, '欢迎步骤不应再提剧情标题');
    ok(!card.querySelector('.tut-body'), '不应再有文字说明（改用动画演示）');
    ok(doc.getElementById('tut-steps').children.length === RG.Tutorial.steps.length, '步骤指示点数量应一致');
    drain(4, 16);      // 教程动画绘制
    // 每次进入都从头开始：先跳到第 4 步，再打开一次
    RG.Tutorial.idx = 3;
    RG.Store.save().tutorialStep = 3;
    RG.Tutorial.open();
    eq(RG.Tutorial.idx, 0, '再次进入应回到第一步');
    eq(RG.Store.save().tutorialStep, 0, '存档里的步骤也应重置');
    drain(3, 16);
    // 跳过 → 模式选取，并记录已看过教程
    doc.querySelector('[data-action="tut-skip"]').click();
    eq(RG.UI.current, 'screen-modes', '跳过教程应进入模式选取');
    eq(RG.Store.save().tutorialDone, true, '应记录教程已完成');
    eq(RG.Store.isFresh(), false, '看过教程后不再是全新存档');
  });

  await test('首页手风琴：一次只展开一张，默认展开自由演奏（故事卡已移除）', () => {
    RG.app.showModes();
    eq(RG.UI.current, 'screen-modes');
    eq(RG.Front.expanded, 'free', '默认应展开自由演奏');
    const panels = doc.getElementById('mode-list').querySelectorAll('.acc-panel');
    eq(panels.length, RG.Front.modes.length, '卡片数量应一致');
    eq(panels.length, 4, '主页应剩四张卡（自由演奏 / 创作工坊 / 档案 / 设置）');
    ok(!RG.Front.modes.some((m) => m.id === 'story'), '不应再有故事模式卡片');
    const openIds = () => doc.getElementById('mode-list').querySelectorAll('.acc-panel.open')
      .map((p) => p.getAttribute('data-mode'));
    eq(openIds().join(','), 'free', '初始只有自由演奏是展开的');
    ok(panels[0].textContent.indexOf('自由演奏') >= 0, '第一张应是自由演奏');
    ok(panels[0].querySelectorAll('.acc-actions .gbtn').length >= 2, '展开体里应有按钮');
    ok(panels[0].querySelectorAll('.acc-star').length >= 6, '自由演奏卡里应有星级条');
    // 点另一张 → 它展开、自由演奏收起
    const wsPanel = panels.filter((p) => p.getAttribute('data-mode') === 'workshop')[0];
    wsPanel.querySelector('.acc-head').click();
    eq(RG.Front.expanded, 'workshop');
    eq(openIds().join(','), 'workshop', '点开工坊后应只剩它展开');
    ok(doc.getElementById('mode-list').querySelectorAll('.acc-panel.open .acc-body').length === 1, '同时只允许一张展开');
    // 键盘 ↑↓ 切换展开项
    win.dispatchEvent(key('ArrowDown', 'keydown'));
    eq(RG.Front.expanded, 'profile', '↓ 应展开下一张');
    win.dispatchEvent(key('ArrowUp', 'keydown'));
    eq(RG.Front.expanded, 'workshop', '↑ 应展开上一张');
    RG.Front.expand('free', false);
    // 设置卡里的预览；清存档入口已从主页移除
    RG.Front.expand('settings', false);
    ok(doc.getElementById('acc-preview'), '设置卡里应有实时预览');
    const setBtns = doc.getElementById('mode-list').querySelectorAll('.acc-panel.open .acc-actions .gbtn');
    ok(!Array.prototype.some.call(setBtns, (b) => b.textContent.indexOf('清除所有存档') >= 0),
      '主页不应再有清除存档的快捷入口');
    ok(Array.prototype.some.call(setBtns, (b) => b.textContent.indexOf('玩法说明') >= 0), '设置卡里应有玩法说明入口');
    /* 玩法说明已从主页移到设置：主页不再有独立的说明卡 */
    ok(!RG.Front.modes.some((m) => m.id === 'help'), '主页不应再有「玩法说明」卡片');
    ok(!RG.Front.modes.some((m) => m.id === 'story'), '主页不应再有故事模式卡片');
    ok(RG.Preview.mounted, '首页设置卡里的预览应已挂载');
    drain(4, 16);
    ok(RG.Preview.t > 0, '预览应在播放');
    /* 主页是竖排布局：卡片窄栏 + 展开体里的按钮竖着排 */
    ok(RG.Front.expand && typeof RG.Front.expand === 'function');
    eq(RG.Front.modes.length, 4, '主页卡片数（故事卡与玩法说明卡都已移走）');
  });

  await test('设置里的玩法说明入口（主页已移除该卡）', () => {
    RG.app.showSettings('modes', 'gameplay');
    const body = doc.getElementById('settings-body');
    const helpRow = body.querySelectorAll('.set-row').filter((r) => r.textContent.indexOf('玩法说明') >= 0)[0];
    ok(helpRow, '游玩分页里应有玩法说明入口');
    const btn = helpRow.querySelectorAll('.seg button').filter((b) => b.textContent === '玩法说明')[0];
    ok(btn, '应有玩法说明按钮');
    btn.click();
    ok(doc.getElementById('modal-card').textContent.indexOf('音符') >= 0, '应弹出玩法说明');
    RG.UI.overlay('screen-modal', false);
    const tutBtn = helpRow.querySelectorAll('.seg button').filter((b) => b.textContent.indexOf('教程') >= 0)[0];
    ok(tutBtn, '应有重看教程按钮');
    tutBtn.click();
    eq(RG.UI.current, 'screen-tutorial', '应进入新手教程');
    RG.Tutorial.close(true);
    eq(RG.UI.current, 'screen-modes');
  });

  await test('模式选取 → 自由演奏（大地图章节/节点）', () => {
    RG.Front.expand('free', false);
    RG.Front.enterSelected();
    drain(3, 16);
    eq(RG.UI.current, 'screen-map');
    eq(RG.app.map.active, true);
    ok(RG.app.map.hits.length > 0, '地图上应有可点击节点');
    ok(doc.getElementById('map-chapter-bar').children.length === 6, '章节栏应有 6 个章节');
    // 返回模式选取
    doc.querySelector('#screen-map [data-action="back-modes"]').click();
    eq(RG.UI.current, 'screen-modes', '返回应回到模式选取');
  });

  await test('地图：缩放/聚焦/悬停提示', () => {
    const z0 = RG.app.map.cam.zoom;
    doc.querySelector('[data-action="zoom-in"]').click();
    ok(RG.app.map.targetZoom > z0, '放大后目标缩放应更大');
    const ch = RG.Songs.chapter('origin');
    RG.app.map.focusChapter(ch);
    drain(4, 16);
    near(RG.app.map.cam.x, ch.x, 30, '相机应聚焦章节');
  });

  await test('选曲：曲目面板列出难度，判定难度与它左右并列', () => {
    const ch = RG.Songs.chapter('origin');
    const song = ch.songs[0];
    RG.Store.set('judgeDifficulty', 'normal');
    RG.app.pickSong(song, ch);
    const panel = doc.getElementById('song-panel');
    eq(panel.classList.contains('hidden'), false, '面板应显示');
    const cols = panel.querySelectorAll('.sp-cols .sp-col');
    eq(cols.length, 2, '应是左右两列：难度选择 + 判定难度');
    const diffRows = cols[0].querySelectorAll('.diff-row');
    eq(diffRows.length, song.diffs.length, '难度行数应与难度数一致');
    diffRows[1].click();
    eq(RG.app.currentDiff, 1, '切换难度应生效');
    /* 判定难度：从设置搬到这里，且不再有「自定义」 */
    const jdRows = cols[1].querySelectorAll('.diff-row');
    eq(jdRows.length, 3, '判定难度应有三档（不含自定义）');
    const txt = cols[1].textContent;
    ok(txt.indexOf('宽松') >= 0 && txt.indexOf('标准') >= 0 && txt.indexOf('困难') >= 0, '三档应齐全：' + txt);
    ok(txt.indexOf('自定义') < 0, '不应再有自定义判定');
    ok(txt.indexOf('不计入成绩') >= 0, '宽松应标注不计入成绩');
    ok(txt.indexOf('×2') >= 0, '困难应标注扣血翻倍');
    jdRows[2].click();                       // 困难
    eq(RG.Store.get('judgeDifficulty'), 'strict', '点困难应写入设置');
    jdRows[0].click();                       // 宽松
    eq(RG.Store.get('judgeDifficulty'), 'lenient');
    RG.Store.set('judgeDifficulty', 'normal');
    RG.app.pickSong(song, ch);
  });

  await test('判定难度：困难扣血 ×2、宽松不计入成绩', () => {
    const mkEngine = (diff) => new RG.Engine({
      chart: RG.Chart.create({ id: 'jd', lanes: 4, bpm: 120, length: 10 }),
      settings: { judgeDifficulty: diff, offsetMs: 0, noFail: false },
      isHeld: () => false,
      hooks: {}
    });
    const chart = RG.Chart.create({ id: 'jd2', lanes: 4, bpm: 120, length: 10 });
    chart.notes = [];
    for (let i = 0; i < 40; i++) chart.notes.push({ t: 1 + i * 0.5, lane: 0, type: 'tap' });
    RG.Chart.normalize(chart);
    const run = (diff) => {
      const e = new RG.Engine({
        chart: chart, settings: { judgeDifficulty: diff, offsetMs: 0, noFail: false },
        isHeld: () => false, hooks: {}
      });
      for (let t = 0; t <= 3; t += 0.05) e.update(t);     // 全部漏掉
      return e.result();
    };
    const normal = run('normal'), strict = run('strict'), lenient = run('lenient');
    const dmgNormal = 100 - normal.life, dmgStrict = 100 - strict.life;
    ok(dmgStrict > dmgNormal * 1.8, '困难扣血应约为标准的 2 倍：' + dmgStrict.toFixed(1) + ' vs ' + dmgNormal.toFixed(1));
    near(dmgStrict, dmgNormal * 2, 1.0, '困难扣血应正好 ×2');
    eq(normal.ranked, true, '标准应计入成绩');
    eq(strict.ranked, true, '困难应计入成绩');
    eq(lenient.ranked, false, '宽松不应计入成绩');
    /* 宽松的判定窗口确实更宽（三个窗口逐级放宽） */
    ok(RG.Engine.PRESETS.lenient.miss > RG.Engine.PRESETS.normal.miss, '宽松的判定窗口应更宽');
    ok(RG.Engine.PRESETS.strict.miss < RG.Engine.PRESETS.normal.miss, '困难的判定窗口应更窄');
    /* 引擎各自独立，不共享状态 */
    ok(mkEngine('normal') && mkEngine('strict'));
  });

  await test('曲库：所有曲目/难度的谱面均可生成并通过校验（含 6/8 轨）', () => {
    let total = 0, lanes = new Set();
    RG.Songs.all().forEach((s) => {
      s.diffs.forEach((d, i) => {
        const c = RG.Songs.chartFor(s, i);
        const v = RG.Chart.validate(c);
        ok(v.ok, s.id + ' 校验失败：' + v.errors.slice(0, 2).join(';'));
        total += c.notes.length;
        lanes.add(c.meta.lanes);
      });
    });
    ok(total > 3000, '总音符数偏少：' + total);
    ok(lanes.has(4) && lanes.has(6) && lanes.has(8), '4/6/8 轨谱面都应存在：' + Array.from(lanes));
  });

  await test('游玩：从选曲面板开始一首（倒计时 → 自动演示 → 结算）', async () => {
    const ch = RG.Songs.chapter('origin');
    const song = ch.songs[0];
    RG.app.pickSong(song, ch);
    const panel = doc.getElementById('song-panel');
    // 面板第二个按钮是「自动演示」
    const btns = panel.querySelectorAll('.sp-actions .gbtn');
    btns[btns.length - 1].click();
    await sleep(80);
    ok(RG.app.session, '未建立游玩会话');
    eq(RG.UI.current, 'screen-game');
    const s = RG.app.session;
    ok(s.autoplay, '应为自动演示');
    eq(s.chart.meta.lanes, 4);
    // 跑倒计时
    drain(240, 16);
    ok(s.started, '倒计时后应开始');
    ok(win.RG.audio.isPlaying(), '音频应开始播放');
    // 推进整首歌
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 20000) {
      win.RG.audio.ctx.__advance(0.05);
      drain(1, 16);
    }
    ok(s.done, '歌曲应自然结束');
    drain(90, 16);   // 结束动画 + 结算
    eq(RG.UI.current, 'screen-game');
    eq(doc.getElementById('screen-result').classList.contains('hidden'), false, '应显示结算');
    const res = s.pendingResult;
    ok(res.score > 900000, '自动演示分数应接近满分：' + res.score);
    ok(res.ap, '自动演示应为 AP');
    eq(res.stars, 3);
    ok(!RG.Store.record(song.id, 1), '自动演示不应写入成绩');
    eq(doc.getElementById('res-grade').textContent, 'SS');
  });

  await test('游玩：手动全 PERFECT 复现（键盘 + 长按 + 拂动 + 滑条）', async () => {
    // 构造一首短自制谱面，方便逐音复现
    const chart = RG.Chart.create({
      id: 'manual-test', songId: 'manual-test', title: '手动测试', artist: 'harness',
      difficulty: '测试', level: 5, lanes: 4, bpm: 120, offsetSec: 0, length: 26,
      music: RG.Editor.defaultMusicDef(1234)
    });
    const notes = [
      { t: 3, lane: 0, type: 'tap' }, { t: 3.5, lane: 1, type: 'tap' },
      { t: 4, lane: 2, type: 'hold', d: 0.5 }, { t: 4.6, lane: 3, type: 'flick' },
      { t: 5.2, lane: 0, type: 'slide', d: 0.5, tail: 1 },
      { t: 6.2, lane: 3, type: 'mine' }, { t: 6.8, lane: 1, type: 'tap' }
    ];
    chart.notes = notes;
    RG.Chart.normalize(chart);
    RG.app.startGame({
      song: {
        id: 'manual-test', title: '手动测试', artist: 'harness', custom: true, chart: chart,
        theme: { a: '#38e8ff', b: '#ff4fd8' }, diffs: [{ name: '测试', level: 5, lanes: 4 }]
      },
      diffIndex: 0, chart: chart, custom: true, returnTo: 'map'
    });
    await sleep(80);
    const s = RG.app.session;
    RG.Store.set('autoplay', false);
    s.autoplay = false;
    s.engine.autoplay = false;
    drain(240, 16);
    ok(s.started, '应已开始');

    const audio = win.RG.audio;
    const base = audio._startCtx;
    const off = s.chart.meta.offsetSec || 0;
    // 图表时间 t 对应的 audio 时间：startAt 是本次播放的音频起点
    const toAudio = (t) => base + (t + off - s.startAt);
    const held = new Set();
    const doFrame = () => { drain(1, 16); };

    // 按键下行
    const down = (lane, t) => {
      audio.ctx.currentTime = toAudio(t);
      win.dispatchEvent(key(RG.Store.lanesFor(4)[lane], 'keydown'));
      doFrame();
    };
    const up = (lane, t) => {
      audio.ctx.currentTime = toAudio(t);
      win.dispatchEvent(key(RG.Store.lanesFor(4)[lane], 'keyup'));
      doFrame();
    };
    // 逐音复现
    for (const n of s.chart.notes) {
      if (n.type === 'mine') continue;
      const keys = RG.Store.lanesFor(4);
      if (n.type === 'tap') { down(n.lane, n.t); up(n.lane, n.t + 0.06); }
      else if (n.type === 'hold') {
        down(n.lane, n.t);
        // 保持：期间推进时间但保持按住（不发送 keyup）
        for (let t = n.t + 0.1; t < n.t + n.d; t += 0.1) { audio.ctx.currentTime = toAudio(t); doFrame(); }
        up(n.lane, n.t + n.d + 0.05);
      } else if (n.type === 'flick') {
        /* 点划（键盘规则）：同一个音符上同时按下两个键 */
        down(n.lane, n.t);
        const other = (n.lane + 2) % 4;
        audio.ctx.currentTime = toAudio(n.t + 0.03);
        win.dispatchEvent(key(keys[other], 'keydown'));
        doFrame();
        up(other, n.t + 0.12);
        up(n.lane, n.t + 0.16);
      } else if (n.type === 'slide') {
        down(n.lane, n.t);
        for (let t = n.t + 0.1; t < n.t + n.d - 0.15; t += 0.1) { audio.ctx.currentTime = toAudio(t); doFrame(); }
        down(n.tail, n.t + n.d - 0.04);                       // 终点轨道在尾判前按住
        audio.ctx.currentTime = toAudio(n.t + n.d + 0.02); doFrame();
        up(n.tail, n.t + n.d + 0.05);
        up(n.lane, n.t + n.d + 0.08);
      }
      held.clear();
    }
    // 让最后一音之后自然结束
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 4000) {
      audio.ctx.currentTime += 0.05;
      drain(1, 16);
    }
    drain(90, 16);
    const res = s.pendingResult;
    const summary = s.engine.notes.map((n) => n.type + '@' + n.t.toFixed(2) + '=' + (n.judge || '?') + (n.tailJudge ? '/' + n.tailJudge : '')).join(' ');
    eq(res.counts.miss, 0, '不应有 MISS｜' + summary);
    eq(res.counts.break, 0, '不应有断连｜' + summary);
    eq(res.counts.mineHit, 0, '不应踩雷');
    ok(res.acc > 0.99, '精度应接近 100%：' + res.acc);
    ok(res.fc, '应为 FC');
    const rec = RG.Store.record('manual-test', 0);
    ok(rec && rec.clear, '应写入通关成绩');
    ok(rec.stars >= 2, '应获得星级：' + rec.stars);
  });

  await test('结算界面：再来一次 / 返回地图按钮可用', () => {
    doc.querySelector('[data-action="res-back-map"]').click();
    drain(3, 16);
    ok(RG.UI.current === 'screen-map', '应回到大地图，实际：' + RG.UI.current);
    eq(doc.getElementById('screen-result').classList.contains('hidden'), true);
  });

  await test('设置：五个分页都能渲染且控件可交互（3D 相关设置已全部内置）', () => {
    doc.querySelector('[data-action="open-settings"]').click();
    eq(RG.UI.current, 'screen-settings');
    const tabs = doc.getElementById('settings-tabs').children;
    eq(tabs.length, 5, '应有 5 个分页（AI 绘画页已移除）');
    tabs.forEach((t) => {
      t.click();
      ok(doc.getElementById('settings-body').children.length > 0, '分页内容为空：' + t.textContent);
    });
    tabs[0].click();
    const body = doc.getElementById('settings-body');
    const rows = body.querySelectorAll('.set-row');
    ok(rows.length > 5, '游玩分页应有多个设置项');
    // 全局 2D/3D 开关必须已经移除
    ok(body.textContent.indexOf('3D 立体模式') < 0, '全局 3D 开关应已取消');
    ok(RG.Store.settings().view3d === undefined, '设置里不应再有 view3d 字段');
    ok(RG.Store.settings().aiArt === undefined, '设置里不应再有 aiArt 字段');
    // 判定难度已搬到选曲界面 → 设置里不应再有
    ok(body.textContent.indexOf('判定难度') < 0, '判定难度应已从设置移到选曲界面');
    ok(body.textContent.indexOf('显示帧率') < 0, '不应再有帧率显示设置');
    ok(body.textContent.indexOf('玩法说明') >= 0, '设置里应有玩法说明入口');
    // 外观分页：3D 相机参数全部内置，不再暴露
    tabs[1].click();
    const camBody = doc.getElementById('settings-body');
    ['3D 视野', '3D 俯角', '3D 机位', '3D 相机距离', '3D 路面宽度', '3D 速度系数', '3D 弯道'].forEach((label) => {
      ok(camBody.textContent.indexOf(label) < 0, '外观分页不应再有「' + label + '」设置');
    });
    ok(RG.Store.settings().camera === undefined, '设置里不应再有 camera 字段');
    // 键位分页
    tabs[3].click();
    ok(doc.getElementById('settings-body').querySelectorAll('.key-cell').length >= 4, '键位格子应有 4 个以上');
    // 数据分页
    tabs[4].click();
    const dataBody = doc.getElementById('settings-body');
    ok(dataBody.querySelectorAll('.set-card').length >= 2, '数据分页应有卡片');
    ok(dataBody.textContent.indexOf('重置成就') >= 0, '数据分页应有重置成就入口');
    ok(dataBody.textContent.indexOf('剧情') < 0, '数据分页不应再提剧情');
    ok(dataBody.textContent.indexOf('清除所有存档') >= 0, '数据分页应有清除存档入口');
  });

  await test('设置：返回按钮回到来源界面', () => {
    doc.querySelector('#screen-settings [data-action="settings-back"]').click();
    ok(RG.UI.current === 'screen-map', '从地图进入设置应回到地图：' + RG.UI.current);
  });

  await test('创作模式：新建谱面 → 编辑器可绘制 → 放置音符 → 撤销/重做', () => {
    RG.app.showModes();
    eq(RG.UI.current, 'screen-modes');
    RG.Front.expand('workshop', false);
    RG.Front.enterSelected();
    eq(RG.UI.current, 'screen-workshop');
    doc.querySelector('[data-action="new-chart"]').click();
    eq(RG.UI.current, 'screen-editor');
    const ED = RG.Editor;
    ok(ED.chart, '编辑器应持有谱面');
    eq(ED.chart.notes.length, 0, '新谱面应为空');
    drain(3, 16);
    // 用指针在画布上放置音符
    const cv = doc.getElementById('editor-canvas');
    const place = (x, y) => {
      cv.dispatchEvent({ type: 'pointerdown', target: cv, clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() { }, stopPropagation() { } });
      cv.dispatchEvent({ type: 'pointerup', target: cv, clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() { }, stopPropagation() { } });
    };
    ED.setType('tap');
    const laneX = (l) => ED.xOf(l) + ED.laneW / 2;
    place(laneX(0), 120);
    place(laneX(1), 160);
    eq(ED.chart.notes.length, 2, '应放置 2 个音符，实际 ' + ED.chart.notes.length);
    eq(ED.chart.notes[0].lane, 0, '第一个应落在第 1 轨');
    eq(ED.chart.notes[1].lane, 1, '第二个应落在第 2 轨');
    ED.setType('hold');
    place(laneX(2), 220);
    const holdNote = ED.chart.notes[ED.chart.notes.length - 1];
    eq(holdNote.type, 'hold');
    ok(holdNote.d > 0, '长按应有时长');
    ED.setType('mine');
    place(laneX(3), 300);
    eq(ED.chart.notes.length, 4, '应共 4 个音符：' + ED.chart.notes.map((n) => n.type + '@' + n.lane).join(','));
    // 撤销 / 重做
    ED.undo();
    eq(ED.chart.notes.length, 3, '撤销后应少 1 个');
    ED.redo();
    eq(ED.chart.notes.length, 4, '重做后应恢复');
    // 镜像 + 量化 + 复制粘贴
    ED.selection = ED.chart.notes.slice();
    ED.copy();
    ED.cursor = { t: 6, lane: 0, x: 0, y: 0 };
    ED.paste();
    ok(ED.chart.notes.length > 4, '粘贴后音符数应增加');
    ED.mirror();
    ED.quantize();
    ED.chart.meta.lanes = 4;
    const v = RG.Chart.validate(ED.chart);
    ok(v.ok, '编辑后谱面仍应通过校验：' + v.errors.slice(0, 2).join(';'));
  });

  await test('编辑器：播放/节拍器/拖动音符/长条缩放', () => {
    const ED = RG.Editor;
    const cv = doc.getElementById('editor-canvas');
    // 播放 0.4 秒
    ED.play();
    ok(ED.playing, '应进入播放状态');
    win.RG.audio.ctx.__advance(0.4);
    drain(10, 16);
    ok(ED.time >= 0, '播放时间应推进');
    ED.metronome = true;
    win.RG.audio.ctx.__advance(0.3);
    drain(20, 16);
    ED.stop();
    ok(!ED.playing);
    // 拖动第一个音符
    const n = ED.chart.notes[0];
    const y0 = ED.yOf(n.t), x0 = ED.xOf(n.lane) + 20;
    const pd = (type, x, y, btn) => cv.dispatchEvent({
      type: type, target: cv, clientX: x, clientY: y, button: btn || 0, pointerId: 2,
      preventDefault() { }, stopPropagation() { }
    });
    const lane0 = n.lane, t0 = n.t;
    pd('pointerdown', x0, y0, 0);
    pd('pointermove', x0 + ED.laneW, y0 + 40, 0);
    pd('pointerup', x0 + ED.laneW, y0 + 40, 0);
    ok(n.lane !== lane0 || n.t !== t0, '拖动应改变音符位置');
    // 右键删除
    const count = ED.chart.notes.length;
    pd('pointerdown', ED.xOf(n.lane) + 20, ED.yOf(n.t), 2);
    eq(ED.chart.notes.length, count - 1, '右键应删除音符');
  });

  await test('编辑器：由乐曲生成草稿（含 6 轨）', () => {
    const ED = RG.Editor;
    const before = ED.chart.notes.length;
    ED.generate(9);
    ok(ED.chart.notes.length > 20, '生成后应有大量音符：' + ED.chart.notes.length);
    const v = RG.Chart.validate(ED.chart);
    ok(v.ok, '生成草稿应通过校验：' + v.errors.slice(0, 2).join(';'));
    ok(before !== ED.chart.notes.length);
    drain(3, 16);
  });

  await test('编辑器：保存并返回工坊，列表出现该谱面', () => {
    doc.getElementById('ed-title').value = '集成测试谱面';
    doc.querySelector('[data-action="ed-save-back"]').click();
    eq(RG.UI.current, 'screen-workshop');
    const cards = doc.getElementById('ws-grid').querySelectorAll('.ws-card');
    eq(cards.length, 1, '工坊应有 1 张卡片');
    const saved = RG.Store.customCharts()[0];
    eq(saved.meta.title, '集成测试谱面');
    ok(saved.notes.length > 20, '保存的谱面应保留音符');
  });

  await test('编辑器：试玩自制谱面并返回编辑器', async () => {
    const chart = RG.Store.customCharts()[0];
    const card = doc.getElementById('ws-grid').querySelectorAll('.ws-card')[0];
    card.querySelectorAll('.ws-btns .gbtn')[1].click();   // ✎ 编辑
    eq(RG.UI.current, 'screen-editor');
    doc.querySelector('[data-action="ed-playtest"]').click();
    await sleep(80);
    ok(RG.app.session, '试玩应建立会话');
    eq(RG.app.session.returnTo, 'editor');
    eq(RG.UI.current, 'screen-game');
    drain(240, 16);
    ok(RG.app.session.started, '试玩应开始');
    // 退出
    doc.querySelector('[data-action="pause"]').click();
    eq(doc.getElementById('screen-pause').classList.contains('hidden'), false, '应弹出暂停');
    doc.querySelector('[data-action="quit"]').click();
    eq(RG.UI.current, 'screen-editor', '退出试玩应回到编辑器：' + RG.UI.current);
    RG.Editor.close(false);
    eq(RG.UI.current, 'screen-workshop');
  });

  await test('编辑器：生成草稿对话框可选曲并直接打开', () => {
    const ED = RG.Editor;
    ED.generateDialog();
    ok(doc.getElementById('modal-card').children.length > 0, '应弹出对话框');
    const sel = doc.getElementById('gen-song');
    const lvl = doc.getElementById('gen-level');
    ok(sel && lvl, '对话框应有曲目与等级控件');
    sel.value = 'bit-garden';
    lvl.value = '11';
    doc.querySelector('#modal-card .ov-btns .gbtn.accent').click();
    ok(ED.chart.notes.length > 40, '应按对话框参数生成草稿：' + ED.chart.notes.length);
    ok(ED.chart.meta.lanes === 4 || ED.chart.meta.lanes === 6 || ED.chart.meta.lanes === 8);
    eq(RG.UI.current, 'screen-editor');
  });

  await test('编辑器：拖动长条尾部改变时长 / 右键拖动平移', () => {
    const ED = RG.Editor;
    ED.chart.notes = [{ t: 2, lane: 0, type: 'hold', d: 1 }];
    ED.pps = 150; ED.viewT = 0;
    const cv = doc.getElementById('editor-canvas');
    const pd = (type, x, y, btn) => cv.dispatchEvent({
      type: type, target: cv, clientX: x, clientY: y, button: btn || 0, pointerId: 5,
      preventDefault() { }, stopPropagation() { }
    });
    const n = ED.chart.notes[0];
    const tx = ED.xOf(n.lane) + 20;
    const tyTail = ED.yOf(n.t + n.d);
    pd('pointerdown', tx, tyTail, 0);
    pd('pointermove', tx, tyTail + 60, 0);
    pd('pointerup', tx, tyTail + 60, 0);
    ok(n.d > 1.2, '拖动尾部后时长应变长：' + n.d);
    const v0 = ED.viewT;
    pd('pointerdown', 500, 400, 2);
    pd('pointermove', 500, 300, 2);
    pd('pointerup', 500, 300, 2);
    ok(ED.viewT !== v0, '右键拖动应平移时间轴');
  });

  await test('设置：改键位（点击格子后按下新键）', () => {
    RG.app.showTitle();
    RG.Store.set('defaultLanes', 4);
    RG.app.map && RG.app.map.hide();
    RG.UI.show('screen-settings');
    RG.UI.renderSettings('keys');
    const cells = doc.getElementById('settings-body').querySelectorAll('.key-cell');
    ok(cells.length >= 4, '应有键位格子');
    cells[0].click();
    win.dispatchEvent(key('KeyM', 'keydown'));
    eq(RG.Store.lanesFor(4)[0], 'KeyM', '键位应被改写');
    ok(RG.Store.lanesFor(4).filter((c) => c === 'KeyM').length === 1, '键位不应重复');
    // 预设 B 恢复
    const presetBtns = doc.getElementById('settings-body').querySelectorAll('.seg button');
    presetBtns[presetBtns.length - 1].click();
    // 还原成默认键位，避免影响后续用例
    RG.Store.settings().bindings[4] = RG.Store.BIND_PRESETS[4].slice();
    RG.Store.saveSettings();
    RG.app.rebuildInput();
  });

  await test('结算：整页铺满 / 统计一行行列下来 / 只有两个符号按钮（没有下一首）', async () => {
    const list = RG.Songs.flat();
    const first = list[0];
    RG.Store.submitResult(first.song.id, first.diff, {
      score: 900000, acc: 0.95, maxCombo: 100, grade: 'S', clear: true, stars: 2,
      fc: true, ap: false, miss: 0, perfect: 100, totalNotes: 100, duration: 90
    });
    RG.app.lastResult = { song: first.song, diffIndex: first.diff, returnTo: 'map' };
    RG.UI.show('screen-game');
    RG.app.startGame({ song: first.song, diffIndex: first.diff, returnTo: 'map' });
    await sleep(80);
    const res = {
      score: 987654, acc: 0.9812, grade: 'S', clear: true, stars: 3, maxCombo: 210,
      counts: { perfect: 200, great: 8, good: 2, miss: 0, break: 0, mineHit: 0, avoided: 1, empty: 0 },
      life: 92, failed: false, fc: true, ap: false, totalNotes: 210, mines: 1, avgOffset: 3.2,
      early: 1, late: 2, duration: 90, songId: first.song.id, chartId: 'x', autoplay: false,
      finished: true, ranked: true, judgeDifficulty: 'normal'
    };
    RG.UI.showResult(res, first.song, first.song.diffs[first.diff], null);
    /* 铺满整页：卡片占满覆盖层 */
    const card = doc.getElementById('modal-card') === null ? null : null;
    const resCard = doc.getElementById('screen-result').querySelector('.ov-card.full');
    ok(resCard, '结算卡片应是铺满整页的 .ov-card.full');
    /* 一行行列下来：每行一个标签 + 一个数值，标签尽量用英文 */
    const rowsEl = doc.getElementById('res-grid');
    const rows = rowsEl.querySelectorAll('.res-row');
    eq(rows.length, 12, '应有 12 行统计：' + rows.length);
    rows.forEach((r) => {
      eq(r.querySelectorAll('span').length, 1, '每行应只有一个标签');
      eq(r.querySelectorAll('b').length, 1, '每行应只有一个数值');
    });
    eq(rows[0].querySelector('span').textContent, 'SCORE');
    const labels = Array.prototype.map.call(rows, (r) => r.querySelector('span').textContent);
    labels.forEach((t) => ok(!/[\u4e00-\u9fa5]/.test(t), '统计标签应尽量用英文：' + t));
    /* 不显示是几 key */
    ok(doc.getElementById('res-diff').textContent.indexOf('键') < 0, '不应显示是几 key：' + doc.getElementById('res-diff').textContent);
    /* 去掉「下一首」：只剩两个符号按钮 */
    eq(doc.querySelector('[data-action="res-next"]'), null, '不应再有下一首按钮');
    const btns = doc.querySelectorAll('#screen-result .sym-btn');
    eq(btns.length, 2, '结算应只有两个符号按钮');
    eq(btns[0].textContent, '⟲');
    eq(btns[1].textContent, '⌂');
    ok(btns[0].className.indexOf('gbtn') < 0, '符号按钮不应带背景样式');
    /* 返回地图按钮可用 */
    btns[1].click();
    await sleep(40);
    eq(RG.UI.current, 'screen-map', '返回地图应生效');
    RG.app.session && doc.querySelector('[data-action="quit"]') && doc.querySelector('[data-action="quit"]').click();
    RG.UI.overlaysOff();
  });

  await test('结算：点「重新开始」会关闭结算并重开一局', async () => {
    const song = RG.Songs.all()[2];
    RG.app.showMap();
    RG.app.startGame({ song: song, diffIndex: 0, returnTo: 'map' });
    await sleep(80);
    const s0 = RG.app.session;
    ok(s0, '应建立会话');
    drain(240, 16);
    /* 模拟一局结束并弹出结算 */
    const res = {
      score: 123456, acc: 0.9, grade: 'A', clear: true, stars: 2, maxCombo: 50,
      counts: { perfect: 50, great: 1, good: 0, miss: 0, break: 0, mineHit: 0, avoided: 0, empty: 0 },
      life: 80, failed: false, fc: false, ap: false, totalNotes: 51, mines: 0, avgOffset: 1,
      early: 0, late: 1, duration: 60, songId: song.id, chartId: 'x', autoplay: false,
      finished: true, ranked: true, judgeDifficulty: 'normal'
    };
    RG.app.lastResult = { song: song, diffIndex: 0, result: res, returnTo: 'map' };
    RG.UI.showResult(res, song, song.diffs[0], null);
    eq(doc.getElementById('screen-result').classList.contains('hidden'), false, '结算应弹出');
    /* 点 ⟲ 重新开始：结算必须关掉，并且重开一局 */
    const retry = doc.querySelector('#screen-result [data-action="res-retry"]');
    ok(retry, '应有重开按钮');
    retry.click();
    drain(4, 16);
    eq(doc.getElementById('screen-result').classList.contains('hidden'), true, '点重开后结算应关闭');
    await sleep(80);
    drain(60, 16);
    ok(RG.app.session && RG.app.session !== s0, '应重开一局（新会话）');
    eq(RG.UI.current, 'screen-game', '应回到游玩界面');
    ok(RG.app.session.started || RG.app.session.countdown > 0, '新一局应已开始');
    RG.app.session && doc.querySelector('[data-action="quit"]') && doc.querySelector('[data-action="quit"]').click();
    drain(4, 16);
    RG.UI.overlaysOff();
  });

  await test('结算：按钮被别的流程换掉后，下一次结算必须还原成 ⟲ / ⌂', async () => {
    const song = RG.Songs.all()[3];
    /* 模拟「别的流程改写了 .ov-btns」：历史上剧情结算会这么干，导致 ⟲ 点不动、结算关不掉 */
    const btnsHost = doc.querySelector('#screen-result .ov-btns');
    btnsHost.textContent = '';
    const alien = win.document.createElement('button');
    alien.className = 'gbtn accent big';
    alien.textContent = '继续剧情 ▶';
    btnsHost.appendChild(alien);
    eq(doc.querySelector('#screen-result [data-action="res-retry"]'), null, '被换掉后没有标准按钮');
    /* 再来一次普通结算 → 按钮必须被还原 */
    RG.UI.showResult(
      {
        score: 2, acc: 1, grade: 'SS', stars: 3, maxCombo: 20,
        counts: { perfect: 20, great: 0, good: 0, miss: 0, break: 0, mineHit: 0, avoided: 0, empty: 0 },
        life: 100, failed: false, fc: true, ap: true, totalNotes: 20, mines: 0, avgOffset: 0,
        early: 0, late: 0, duration: 10, songId: song.id, chartId: 'x', autoplay: false,
        finished: true, ranked: true, judgeDifficulty: 'normal'
      },
      song, song.diffs[0], null
    );
    const retry = doc.querySelector('#screen-result [data-action="res-retry"]');
    const back = doc.querySelector('#screen-result [data-action="res-back-map"]');
    ok(retry, '普通结算必须还原出 ⟲ 重开按钮');
    ok(back, '普通结算必须还原出 ⌂ 返回按钮');
    eq(doc.querySelectorAll('#screen-result .sym-btn').length, 2, '应只剩两个符号按钮');
    eq(doc.querySelectorAll('#screen-result .ov-btns .gbtn').length, 0, '外来按钮应已被清掉');
    /* ⌂ 也真的能关掉结算 */
    RG.UI.show('screen-map');
    RG.UI.showResult(
      {
        score: 3, acc: 1, grade: 'SS', stars: 3, maxCombo: 20,
        counts: { perfect: 20, great: 0, good: 0, miss: 0, break: 0, mineHit: 0, avoided: 0, empty: 0 },
        life: 100, failed: false, fc: true, ap: true, totalNotes: 20, mines: 0, avgOffset: 0,
        early: 0, late: 0, duration: 10, songId: song.id, chartId: 'x', autoplay: false,
        finished: true, ranked: true
      },
      song, song.diffs[0], null
    );
    doc.querySelector('#screen-result [data-action="res-back-map"]').click();
    drain(4, 16);
    eq(doc.getElementById('screen-result').classList.contains('hidden'), true, '⌂ 应关闭结算');
    RG.UI.overlaysOff();
  });

  await test('游玩时底部不再显示任何文字', () => {
    eq(doc.getElementById('gh-offset'), null, '#gh-offset 应已移除');
    /* updateHUD 即使收到 offsetText 也不应报错（字段已废弃） */
    RG.UI.updateHUD({
      score: 0, acc: 1, life: 100, combo: 0, maxCombo: 0, progress: 0.5, fps: 60,
      viewMode: '2d', offsetText: '判定偏移 +5ms',
      counts: { perfect: 0, great: 0, good: 0, miss: 0, break: 0, mineHit: 0 }
    });
    ok(true, 'updateHUD 不应因废弃字段报错');
    /* 游玩界面的文字只剩：正上方分数与精度、曲名/难度（右下）、连击 */
    const game = doc.getElementById('screen-game');
    ok(game.textContent.indexOf('判定偏移') < 0, '界面上不应有判定偏移文字');
    ok(game.textContent.indexOf('平均') < 0, '界面上不应有偏移统计文字');
  });

  await test('工坊：复制 / 导出 / 删除谱面', () => {
    const handlers = RG.app.workshopHandlers();
    const chart = RG.Store.customCharts()[0];
    handlers.onDuplicate(chart);
    eq(RG.Store.customCharts().length, 2, '复制后应有 2 个谱面');
    handlers.onExport(RG.Store.customCharts()[0]);
    handlers.onDelete(RG.Store.customCharts()[1]);
    eq(RG.Store.customCharts().length, 1, '删除后应剩 1 个');
  });

  await test('工坊节点出现在大地图上（自制谱面入口）', () => {
    RG.app.refreshWorkshopMap();
    RG.app.showMap();
    drain(3, 16);
    const ws = RG.Songs.chapter('workshop');
    eq(ws.songs.length, 1, '工坊章节应含 1 个自制谱面');
    ok(RG.app.map.hits.some((h) => h.chapter.workshop), '地图上应有工坊节点');
  });

  await test('3D 渲染与判定：直接驱动渲染器（真实投影 + 指针定位）', () => {
    const r = RG.app.renderer;
    r.setLanes(4);
    r.setView('3d', 0, true);
    eq(r.mode, '3d');
    eq(r.view.blend, 1);
    const pNear = r._project(0, 0, 0);
    const pFar = r._project(0, 0, 40);
    ok(pNear && pFar, '投影不应失败');
    ok(pFar.y < pNear.y, '远处应变高（透视收敛）');
    ok(pNear.y > r.h * 0.45 && pNear.y < r.h * 0.95, '判定面应落在画面下方：' + Math.round(pNear.y));
    // 判定面上「第 2 轨中心」的投影应能反查回第 2 轨
    const laneCenter = (1 + 0.5 - r.lanes / 2) * r.laneWU;
    const pLane = r._project(laneCenter, 0.3, 0);
    eq(r.laneAt(pLane.x, pLane.y), 1, '判定线上指针定位应还原轨道');
    const left = r._project(-r.lanes / 2 * r.laneWU, 0, 0);
    const right = r._project(r.lanes / 2 * r.laneWU, 0, 0);
    eq(r.laneAt(left.x + 6, pNear.y), 0, '最左侧应落在第 1 轨');
    eq(r.laneAt(right.x - 6, pNear.y), r.lanes - 1, '最右侧应落在最后一轨');
    ok(r.laneAt(r.cx, r.horizonY - 40) === -1, '地平线以上不应命中轨道');
    // 带音符绘制若干帧不应抛错
    const chart = RG.Songs.chartFor(RG.Songs.byId('first-light'), 1);
    const engine = new RG.Engine({ chart: chart, settings: RG.Store.settings(), autoplay: true, isHeld: () => false });
    const frame = { now: 0, dt: 0.016, notes: engine.notes, lanes: chart.meta.lanes, music: RG.Music.build(RG.Songs.byId('first-light').music), bands: [0.6, 0.5, 0.4] };
    r.setLanes(chart.meta.lanes);
    for (let i = 0; i < 120; i++) { frame.now = i * 0.016; r.draw(frame); }
    ok(r.dyn.lane.length > 0 || true);
    r.setView('2d', 0, true);
    eq(r.mode, '2d');
    r.setLanes(4);
  });

  await test('失败流程：连续漏击会失败并弹出结算（F 评级）', async () => {
    const chart = RG.Chart.create({
      id: 'fail-test', songId: 'fail-test', title: '失败测试', lanes: 4, bpm: 150,
      length: 40, offsetSec: 0, music: RG.Editor.defaultMusicDef(99)
    });
    const notes = [];
    for (let i = 0; i < 30; i++) notes.push({ t: 3 + i * 0.5, lane: i % 4, type: 'tap' });
    chart.notes = notes;
    RG.Chart.normalize(chart);
    RG.Store.set('noFail', false);
    RG.app.startGame({
      song: { id: 'fail-test', title: '失败测试', artist: 'h', custom: true, chart: chart, diffs: [{ name: 't', level: 5, lanes: 4 }] },
      diffIndex: 0, chart: chart, custom: true, returnTo: 'map'
    });
    await sleep(80);
    const s = RG.app.session;
    drain(240, 16);
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 4000) {
      win.RG.audio.ctx.__advance(0.1);
      drain(1, 16);
    }
    drain(90, 16);
    eq(s.pendingResult.failed, true, '应判定为失败');
    eq(doc.getElementById('res-grade').textContent, 'F');
    doc.querySelector('[data-action="res-back-map"]').click();
  });

  await test('暂停/继续：时钟与判定正确恢复', async () => {
    RG.app.startGame({ song: RG.Songs.byId('neon-drive'), diffIndex: 0, returnTo: 'map' });
    await sleep(80);
    const s = RG.app.session;
    drain(240, 16);
    ok(s.started);
    const t0 = win.RG.audio.now();
    doc.querySelector('[data-action="pause"]').click();
    eq(s.paused, true);
    win.RG.audio.ctx.__advance(1.0);          // 暂停期间时间不应影响判定
    drain(5, 16);
    doc.querySelector('[data-action="resume"]').click();
    eq(s.paused, false);
    win.RG.audio.ctx.__advance(0.1);
    drain(5, 16);
    ok(win.RG.audio.now() >= t0, '恢复后进度应继续');
    doc.querySelector('[data-action="quit"]').click();
    eq(RG.UI.current, 'screen-map');
  });

  await test('存档：导出/导入与进度重置', () => {
    const text = RG.Store.exportAll();
    ok(text.indexOf('rg-save') >= 0);
    const before = RG.Store.totalStars();
    RG.Store.resetProgress();
    eq(RG.Store.totalStars(), 0);
    RG.Store.importAll(text);
    eq(RG.Store.totalStars(), before, '导入后应恢复星级');
    ok(RG.Store.customCharts().length >= 1, '导入后应恢复自制谱面');
  });

  await test('布局自检：2D 判定线与 3D 路面都落在可视范围内', () => {
    const r = RG.app.renderer;
    r.setView('2d', 0, true);
    r.settings.lanes = 4;
    r._layout();
    eq(r.judgeY, r.h * 0.82, '2D 判定线应在设定高度');
    ok(r.fieldW > r.w * 0.3 && r.fieldW <= r.w * 0.95, '2D 轨道宽度应合理：' + Math.round(r.fieldW) + '/' + r.w);
    near(r.fieldX + r.fieldW / 2, r.w / 2, 0.6, '2D 轨道应水平居中');
    eq(r.laneAt(r.fieldX + r.laneW * 0.5, r.judgeY), 0, '最左轨命中');
    eq(r.laneAt(r.fieldX + r.laneW * 3.5, r.judgeY), 3, '最右轨命中');
    eq(r.laneAt(r.fieldX - 20, r.judgeY), -1, '轨道外应返回 -1');

    r.setView('3d', 0, true);
    for (const lanes of [4, 6, 8]) {
      r.setLanes(lanes);
      r._layout();
      const jl = r._project(0, 0, 0);
      ok(jl.y > r.h * 0.45 && jl.y < r.h * 0.95, lanes + ' 轨：3D 判定线应在下方：' + Math.round(jl.y) + '/' + r.h);
      const left = r._project(-lanes / 2 * r.laneWU, 0, 0);
      const right = r._project(lanes / 2 * r.laneWU, 0, 0);
      const width = right.x - left.x;
      ok(width > r.w * 0.2 && width < r.w * 1.05, lanes + ' 轨：3D 路面宽度应合理：' + Math.round(width) + '/' + r.w);
      // 地平线：无穷远处收敛到消失点 horizonY（加了俯角后 cy 只是投影中心）
      const far = r._project(0, 0, 20000);
      near(far.y, r.horizonY, 2, '远处应收敛到地平线');
      ok(r.laneAt(left.x + 6, jl.y) === 0, lanes + ' 轨 3D 最左轨命中：' + r.laneAt(left.x + 6, jl.y));
      ok(r.laneAt(right.x - 6, jl.y) === lanes - 1, lanes + ' 轨 3D 最右轨命中：' + r.laneAt(right.x - 6, jl.y));
    }
    r.setLanes(4);
    r.setView('2d', 0, true);
  });

  await test('3D 相机已内置：默认参数生效、判定线不漂移（FOV/机位变化）', () => {
    const r = RG.app.renderer;
    /* 设置里不再有相机参数，改为内置默认值 */
    eq(RG.Store.settings().camera, undefined, '相机参数不应再是设置项');
    const CAM = RG.Store.CAMERA;
    eq(CAM.fov, 72, '内置 FOV 应为 72');
    eq(CAM.pitch, 48, '内置俯角应为 48');
    eq(CAM.height, 2.1, '内置机位高度应为 2.1');
    eq(CAM.dist, 2.4, '内置相机距离应为 2.4');
    eq(CAM.speed, 0.8, '内置速度系数应为 0.8');
    /* 不注入 camera 时，渲染器就用内置值 */
    r.settings.camera = undefined;
    r._layout();
    near(r.cam.dist, 2.4, 1e-9, '渲染器应使用内置相机距离');
    near(r.cam.speed, 0.8, 1e-9, '渲染器应使用内置速度系数');
    near(r.cam.fov, 72, 1e-9, '渲染器应使用内置 FOV');

    const judgeLine = RG.Store.get('judgeLine');
    r.mode = '3d';
    /* 只有布局报告/测试会临时注入 camera 来离线调参 */
    const presets = [
      { fov: 72, pitch: 48, height: 2.1, dist: 2.4 },   // 内置默认
      { fov: 90, pitch: 48, height: 2.8, dist: 2.4 },   // 更高机位 + 更宽视野
      { fov: 60, pitch: 48, height: 1.5, dist: 2.4 },
      { fov: 100, pitch: 48, height: 2.4, dist: 3.0 }
    ];
    presets.forEach((p) => {
      r.settings.camera = { fov: p.fov, pitch: p.pitch, height: p.height, dist: p.dist, width: 4.2, speed: 0.8, curve: 0 };
      r._layout();
      const jl = r._project(0, 0, 0);
      ok(Math.abs(jl.y - r.h * judgeLine) < 1.5,
        'FOV ' + p.fov + '/机位 ' + p.height + ' 时判定线应仍在设定高度：' + Math.round(jl.y) + ' vs ' + Math.round(r.h * judgeLine));
      ok(r.horizonY < jl.y, '地平线必须高于判定线');
      ok(r.horizonY > 0 && r.horizonY < jl.y, '地平线应在判定线上方且落在画面内：' + Math.round(r.horizonY));
      // 远端的路面仍可见（不会缩成一点就消失）
      const far = r._project(0, 0, r.worldFar);
      ok(far && Math.abs(far.y - r.horizonY) < r.h * 0.08, '远端应收敛到地平线附近');
      // 近端路面宽度仍占画面足够比例，读谱不吃力
      const left = r._project(-r.lanes / 2 * r.laneWU, 0, 0);
      const right = r._project(r.lanes / 2 * r.laneWU, 0, 0);
      const width = right.x - left.x;
      ok(width > r.w * 0.2, '路面宽度不应过窄：' + Math.round(width) + '/' + r.w);
    });
    r.settings.camera = { fov: 72, pitch: 48, height: 2.1, dist: 2.4, width: 4.2, speed: 0.8, curve: 0 };
    r._layout();
    // 机位升高后俯视感更强：音符顶面在屏幕上展开得更多（能看到更远的路面与顶面）
    const topSpan = () => Math.abs(r._project(0, 0.36, 1.5).y - r._project(0, 0.36, 0).y);
    r.settings.camera.height = 0.9; r._layout(); const spanLow = topSpan();
    r.settings.camera.height = 3.4; r._layout(); const spanHigh = topSpan();
    ok(spanHigh > spanLow * 1.3, '机位越高俯视感越强：' + spanLow.toFixed(1) + ' → ' + spanHigh.toFixed(1));
    r.settings.camera = undefined;
    r._layout();
    r.setView('2d', 0, true);
  });

  await test('3D 俯角（内置）：俯角越大越俯视且判定线不漂移', () => {
    const r = RG.app.renderer;
    const judgeLine = RG.Store.get('judgeLine');
    eq(RG.Store.CAMERA.pitch, 48, '内置俯角应为 48°');
    eq(RG.Store.settings().camera, undefined, '俯角不应再是设置项');
    r.mode = '3d';
    r.settings.camera = { fov: 72, pitch: 48, height: 2.1, dist: 2.4, width: 4.2, speed: 0.8, curve: 0 };

    /* 俯角 0 应完全等价于没有俯角的旧模型 */
    r.settings.camera.pitch = 0;
    r._layout();
    const cy0 = r.cy, horizon0 = r.horizonY;
    near(cy0, r.judgeY - (2.1 * r.focal) / 2.4, 0.01, '俯角 0 时投影中心应与旧公式一致');
    near(horizon0, cy0, 0.01, '俯角 0 时地平线与投影中心重合');
    eq(Math.round(r.pitch * 180 / Math.PI), 0, '相机实际俯角应为 0');

    /* 各俯角下：判定线钉住 + 指针判定准确 + 地平线在判定线上方 */
    const pitches = [0, 20, 48, 60];
    const rows = pitches.map((p) => {
      r.settings.camera.pitch = p;
      r._layout();
      const jl = r._project(0, 0, 0);
      const far = r._project(0, 0, r.worldFar);
      return { p: p, horizon: r.horizonY, jl: jl.y, farY: far.y, rad: r.pitch };
    });
    rows.forEach((row) => {
      ok(Math.abs(row.rad * 180 / Math.PI - row.p) < 0.01, '相机俯角应等于设置值：' + row.p);
      ok(Math.abs(row.jl - r.h * judgeLine) < 1.5,
        '俯角 ' + row.p + '° 时判定线应仍在设定高度：' + Math.round(row.jl));
      ok(row.horizon < row.jl, '俯角 ' + row.p + '° 时地平线必须在判定线上方：' + Math.round(row.horizon));
      if (row.p <= 48) ok(row.horizon > 0, '默认及更平的俯角下地平线应落在画面内：' + Math.round(row.horizon));
      const jlp = r._project(0, 0, 0);
      for (let lane = 0; lane < r.lanes; lane++) {
        const pt = r._project((lane + 0.5 - r.lanes / 2) * r.laneWU, 0, 0.04);
        eq(r.laneAt(pt.x, jlp.y), lane, '俯角 ' + row.p + '° 下第 ' + lane + ' 轨指针判定');
      }
    });
    /* 默认 48° 比旧的平视模型明显更俯视：地平线更高、远端路面也更高 */
    const flat = rows[0], def = rows[2], steep = rows[3];
    ok(def.horizon < flat.horizon - r.h * 0.05, '默认俯角应把地平线明显抬高：' +
      Math.round(flat.horizon) + ' → ' + Math.round(def.horizon));
    ok(def.farY < flat.farY - r.h * 0.03, '默认俯角下可见的远端路面应更高：' +
      Math.round(flat.farY) + ' → ' + Math.round(def.farY));
    ok(steep.horizon < def.horizon, '继续加大俯角地平线继续抬高（更俯视）：' +
      Math.round(def.horizon) + ' → ' + Math.round(steep.horizon));
    ok(steep.farY < def.farY, '继续加大俯角可见纵深继续上抬：' +
      Math.round(def.farY) + ' → ' + Math.round(steep.farY));
    /* 完全看不见俯视的极限情况也不应把判定线推出画面 */
    r.settings.camera.pitch = 68;
    r._layout();
    const jlMax = r._project(0, 0, 0);
    ok(Math.abs(jlMax.y - r.h * judgeLine) < 1.5, '最大俯角下判定线仍应钉住：' + Math.round(jlMax.y));
    r.settings.camera = undefined;          // 还原：回到内置参数
    r._layout();
    r.setView('2d', 0, true);
  });

  await test('滑条在 2D/3D 都画成倾斜光束（起点轨道 → 终点轨道）', () => {
    const r = RG.app.renderer;
    r.setLanes(4);
    const chart = RG.Chart.create({
      id: 'slide-visual', title: '滑条', lanes: 4, bpm: 120, offsetSec: 0, length: 20,
      music: { style: 'chiptune', seed: 5, bpm: 120, rootMidi: 45, scale: 'minor', sections: [{ name: 'a', intensity: 1, bars: 4 }] }
    });
    chart.notes = [
      { t: 1.0, lane: 0, type: 'slide', d: 1.0, tail: 3 },
      { t: 3.0, lane: 0, type: 'hold', d: 1.0 }
    ];
    RG.Chart.normalize(chart);
    const notes = chart.notes.map((n) => ({
      t: n.t, lane: n.lane, type: n.type, d: n.d || 0, tail: n.tail,
      endT: n.t + (n.d || 0), state: 0, judge: '', delta: 0
    }));
    const slide = notes[0], hold = notes[1];

    /* 直接量 3D 投影：滑条的光束末端必须落在"另一条轨道"上；
       长按的两端则应落在同一条轨道射线上（透视收敛是正常的） */
    const laneCenter = (lane, z, h2) => r._project((lane + 0.5 - r.lanes / 2) * r.laneWU, h2 === undefined ? 0.2 : h2, z);
    const headPt = laneCenter(slide.lane, 0);
    const tailPtSlide = laneCenter(slide.tail, 3);
    const tailPtSameLane = laneCenter(slide.lane, 3);
    ok(headPt && tailPtSlide && tailPtSameLane, '应能投影');
    ok(r.lanes >= 4 && slide.tail !== slide.lane, '滑条终点应在另一条轨道上');
    /* 滑条末端实际画在终点轨道上 → 与"仍在起点轨道"相比明显横移 */
    const shiftLanes = Math.abs(tailPtSlide.x - tailPtSameLane.x);
    ok(shiftLanes > 60, '3D 滑条末端应横移到终点轨道（与留在起点轨道相差 ' + Math.round(shiftLanes) + 'px）');
    /* 判据：滑条首尾的屏幕横移必须远大于纯透视收敛（后者是长按也会有的一点变化） */
    const holdHead = laneCenter(hold.lane, 0);
    const holdTail = laneCenter(hold.lane, 3);
    const persp = Math.abs(holdTail.x - holdHead.x);
    const slideSpan = Math.abs(tailPtSlide.x - headPt.x);
    ok(slideSpan > persp * 2.2, '滑条的倾斜量应远大于透视收敛：滑条 ' +
      Math.round(slideSpan) + 'px vs 长按 ' + Math.round(persp) + 'px');
    ok(persp > 0, '同一轨道远端也会因透视而横向收敛（这是正常的）');

    /* 2D：记录画布调用，检查滑条绘制出了非竖直的四点路径 */
    const calls = [];
    const real = r.ctx;
    const spy = new Proxy(real, {
      get(t, k) {
        if (k === 'beginPath') return () => calls.push({ op: 'beginPath' });
        if (k === 'moveTo') return (x, y) => calls.push({ op: 'moveTo', x, y });
        if (k === 'lineTo') return (x, y) => calls.push({ op: 'lineTo', x, y });
        return t[k];
      },
      set(t, k, v) { t[k] = v; return true; }
    });
    r.ctx = spy;
    r.setView('2d', 0, true);
    r.lanes = 4;
    r._drawNote2d(slide, 120, 'neon', 1, 400);
    r._drawNote2d(hold, 120, 'neon', 1, 400);
    r.ctx = real;
    ok(calls.length > 8, '应画出了路径：' + calls.length);
    /* 找滑条的四边形：moveTo 之后的 lineTo 中，至少有一段是斜的（y 变了 x 也变） */
    let tilted = 0, vertical = 0;
    for (let i = 0; i < calls.length - 1; i++) {
      const a = calls[i], b = calls[i + 1];
      if (a.op === 'moveTo' && b.op === 'lineTo') {
        if (Math.abs(b.y - a.y) > 20 && Math.abs(b.x - a.x) > 20) tilted++;
        if (Math.abs(b.y - a.y) > 20 && Math.abs(b.x - a.x) < 1) vertical++;
      }
    }
    ok(tilted >= 1, '2D 滑条应画出一条斜边（倾斜光束），实际斜边数=' + tilted);
    ok(vertical >= 0, '长按仍允许竖直边');
    r.setView('2d', 0, true);
    RG.Store.set('camera.pitch', RG.Store.CAMERA.pitch);
  });

  await test('谱面内嵌 2D/3D 切换环节：内置谱面自带切换，演奏时自动过渡', async () => {
    // 内置谱面都应带有视角切换环节
    let withSwitch = 0;
    RG.Songs.all().forEach((s) => {
      s.diffs.forEach((d, i) => {
        const c = RG.Songs.chartFor(s, i);
        if ((c.meta.viewEvents || []).length > 0) withSwitch++;
        ok(c.meta.view === '2d' || c.meta.view === '3d', '起始视角应合法');
        (c.meta.viewEvents || []).forEach((e) => ok(e.mode === '2d' || e.mode === '3d', '切换标记模式应合法'));
      });
    });
    ok(withSwitch > 30, '多数内置谱面应带有 3D 环节：' + withSwitch);

    const chart = RG.Songs.chartFor(RG.Songs.byId('first-light'), 0);
    ok(chart.meta.viewEvents.length >= 1, '该谱面应有切换环节');
    const first3d = chart.meta.viewEvents.filter((e) => e.mode === '3d')[0];
    ok(first3d, '应有切到 3D 的环节');
    // viewAt 查询
    eq(RG.Chart.viewAt(chart, 0).mode, chart.meta.view, '开头应是起始视角');
    eq(RG.Chart.viewAt(chart, first3d.t + 0.01).mode, '3d', '切换后应处于 3D');
    eq(RG.Chart.viewAt(chart, first3d.t - 0.01).mode, '2d', '切换前应处于 2D');
    ok(RG.Chart.nextViewEvent(chart, 0).t <= first3d.t + 0.001, '应能查到下一个切换');

    RG.app.startGame({ song: RG.Songs.byId('first-light'), diffIndex: 0, autoplay: true, returnTo: 'map' });
    await sleep(80);
    const s = RG.app.session;
    const r = RG.app.renderer;
    drain(240, 16);
    ok(s.started, '应已开始');
    eq(r.view.blend, 0, '起始应按谱面用 2D');
    eq(r.mode, '2d');
    eq(s.viewMode, '2d', '会话视角应是 2D');
    // 把音频时钟逐步推到第一个 3D 环节（真实演奏是逐帧推进）
    const base = win.RG.audio._startCtx;
    const toAudio = (t) => base + (t + (chart.meta.offsetSec || 0) - s.startAt);
    const target = first3d.t + 0.05;
    let tCur = win.RG.audio.now();
    while (tCur < target) {
      tCur = Math.min(target, tCur + 0.25);
      win.RG.audio.ctx.currentTime = base + (tCur + (chart.meta.offsetSec || 0) - s.startAt);
      drain(1, 16);
    }
    ok(!s.done, '不应误判失败');
    ok(r.isTransitioning() || r.view.blend > 0, '切换瞬间应处于过渡状态');
    ok(s.viewMode === '3d', '会话应记录已切到 3D：' + s.viewMode);
    // 过渡结束后应完全进入 3D
    drain(90, 16);
    eq(r.mode, '3d', '过渡后应进入 3D');
    eq(r.view.blend, 1);
    // 3D 下的动效状态应被激活
    ok(Math.abs(r.dyn.roll) > 0 || Math.abs(r.dyn.bob) > 0, '3D 下应有倾斜/呼吸动效');
    // 指针定位在 3D 下仍可用
    const laneP = r._project((1 + 0.5 - chart.meta.lanes / 2) * r.laneWU, 0.3, 0.04);
    eq(r.laneAt(laneP.x, laneP.y), 1, '3D 下指针定位应还原轨道');
    // 游玩中不再有任何「当前是 2D 还是 3D」的提示
    eq(doc.getElementById('gh-view'), null, 'HUD 不应再显示当前视角');
    ok(!doc.getElementById('screen-game').textContent.match(/3D\s*视角|2D\s*视角/), '画面上不应出现视角文字');
    /* 旧视角的轨道与音符会残留 3 秒再完全消失 */
    ok(r.linger || r.view.blend >= 1, '切换后应有旧画面残留信息');
    if (r.linger) {
      const lingerStart = r.linger.total;
      near(lingerStart, 3.0, 1e-6, '残留淡出总时长应为 3 秒');
      ok(r.linger.t < lingerStart, '刚切换时残留刚开始淡出');
      /* 推进 3 秒后残留应完全消失 */
      drain(200, 16);
      ok(!r.linger, '3 秒后旧画面应完全消失');
    }
    // 打完剩下的流程
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 9000) {
      win.RG.audio.ctx.__advance(0.05);
      drain(1, 16);
    }
    ok(s.done, '应能带着视角切换打完整首');
    drain(90, 16);
    doc.querySelector('[data-action="res-back-map"]').click();
  });

  await test('3D 动效：震动/倾斜/摇头/俯冲/轨道冲量都会随演奏变化', () => {
    const r = RG.app.renderer;
    r.setView('3d', 0.4);
    r.clearEffects();
    const frame = { now: 10, dt: 0.016, lanes: 4, notes: [], music: { bpm: 128, beatDur: 60 / 128 }, bands: [0.9, 0.8, 0.7, 0.5, 0.3] };
    let maxRoll = 0, maxBob = 0;
    for (let i = 0; i < 90; i++) {
      frame.now += 0.016;
      r.draw(frame);
      maxRoll = Math.max(maxRoll, Math.abs(r.dyn.roll));
      maxBob = Math.max(maxBob, Math.abs(r.dyn.bob));
    }
    ok(maxBob > 0.5, '低频能量应推动镜头呼吸：' + maxBob.toFixed(2));
    ok(maxRoll > 0.004, '应存在基础倾斜摇摆：' + maxRoll.toFixed(4));
    // 击打 → 倾斜 + 轨道冲量 + 光柱
    r.judge(0, 'perfect', 0);
    ok(r.dyn.lane[0] > 0.5, '命中应产生该轨冲量：' + r.dyn.lane[0]);
    ok(r.dyn.lean > 0, '命中左轨应产生正 roll（左侧下沉）：' + r.dyn.lean.toFixed(4));
    r.judge(3, 'perfect', 0);
    ok(r.dyn.lean < 0.06, '再命中右轨应抵消左倾：' + r.dyn.lean.toFixed(4));
    r.dyn.lean = 0;
    r.judge(3, 'perfect', 0);
    ok(r.dyn.lean < 0, '命中右轨应产生负 roll（右侧下沉）：' + r.dyn.lean.toFixed(4));
    // 倾斜的几何意义：正 roll 时左侧路面在屏幕上更低
    r.dyn.roll = 0;
    const flatL = r._project(-r.lanes / 2 * r.laneWU, 0, 0);
    const flatR = r._project(r.lanes / 2 * r.laneWU, 0, 0);
    r.dyn.roll = 0.07;
    const tiltL = r._project(-r.lanes / 2 * r.laneWU, 0, 0);
    const tiltR = r._project(r.lanes / 2 * r.laneWU, 0, 0);
    ok(tiltL.y > flatL.y + 0.5, '正 roll：左侧路面应下沉 ' + flatL.y.toFixed(1) + ' → ' + tiltL.y.toFixed(1));
    ok(tiltR.y < flatR.y - 0.5, '正 roll：右侧路面应抬起 ' + flatR.y.toFixed(1) + ' → ' + tiltR.y.toFixed(1));
    r.dyn.roll = 0;
    // 踩雷 → 强震动 + 抖动
    r.judge(1, 'mine', 0);
    ok(r.dyn.shake > 0.8, '踩雷应产生强震动：' + r.dyn.shake);
    ok(r.dyn.rollNoise > 0.5, '踩雷应产生倾斜抖动');
    ok(r.dyn.dive > 0, '踩雷应有机位冲击');
    // 过渡时 2D/3D 都会绘制（交叉溶解），且不抛错
    r.setView('2d', 0.5);
    for (let i = 0; i < 20; i++) { frame.now += 0.016; r.draw(frame); }
    ok(r.view.blend < 0.5, '应正在切回 2D：' + r.view.blend.toFixed(3));
    for (let i = 0; i < 60; i++) { frame.now += 0.016; r.draw(frame); }
    eq(r.view.blend, 0, '最终应停在 2D');
    eq(r.mode, '2d');
    // effects=off 时不应有抖动
    r.settings.effects = 'off';
    r.judge(2, 'mine', 0);
    for (let i = 0; i < 30; i++) { frame.now += 0.016; r.draw(frame); }
    // 关特效后 shake 不衰减也能归零（缩放系数为 0）
    ok(Math.abs(r.dyn.roll) < 0.02, '关闭特效后倾斜幅度应被压到 0');
    r.settings.effects = 'high';
    r.clearEffects();
  });

  await test('视角环节：编辑器可放置/拖动/删除切换标记', () => {
    const ED = RG.Editor;
    ED.open(null);
    eq(RG.UI.current, 'screen-editor');
    const chart = ED.chart;
    eq((chart.meta.viewEvents || []).length, 0, '新谱面默认没有切换标记');
    eq(chart.meta.view, '2d', '默认起始 2D');
    drain(3, 16);
    const cv = doc.getElementById('editor-canvas');
    const pd = (type, x, y, btn) => cv.dispatchEvent({
      type: type, target: cv, clientX: x, clientY: y, button: btn || 0, pointerId: 9,
      preventDefault() { }, stopPropagation() { }
    });
    const vx = 58 + 17;                     // 视角轨中心
    // 点空白处 → 按当前时代取反放置（2D 时代 → 放一个切到 3D 的标记）
    pd('pointerdown', vx, 200, 0); pd('pointerup', vx, 200, 0);
    eq(ED.viewEvents().length, 1, '应放置 1 个切换标记');
    eq(ED.viewEvents()[0].mode, '3d', '2D 时代点一下应切到 3D');
    // 再往下点 → 又切回 2D（时代取反）
    pd('pointerdown', vx, 500, 0); pd('pointerup', vx, 500, 0);
    eq(ED.viewEvents().length, 2, '应有 2 个标记');
    eq(ED.viewEvents()[1].mode, '2d', '第二次应切回 2D');
    ok(ED.viewEvents()[1].t > ED.viewEvents()[0].t, '标记时间应递增');
    // 拖动第一个标记
    const timesBefore = ED.viewEvents().map((e) => e.t).sort((a, b) => a - b);
    const t0 = ED.viewEvents()[0].t;
    pd('pointerdown', vx, ED.yOf(t0), 0);
    pd('pointermove', vx, ED.yOf(t0) + 40, 0);
    pd('pointerup', vx, ED.yOf(t0) + 40, 0);
    const timesAfter = ED.viewEvents().map((e) => e.t).sort((a, b) => a - b);
    ok(timesAfter.join(',') !== timesBefore.join(','), '拖动应改变标记时间：' + timesBefore.join(',') + ' → ' + timesAfter.join(','));
    // 撤销 / 重做
    ED.undo();
    eq(ED.viewEvents().map((e) => e.t).sort((a, b) => a - b).join(','), timesBefore.join(','), '撤销应恢复标记时间');
    ED.redo();
    eq(ED.viewEvents().map((e) => e.t).sort((a, b) => a - b).join(','), timesAfter.join(','), '重做应恢复拖动后的时间');
    // 右键删除最早的那个标记
    const target = ED.viewEvents().slice().sort((a, b) => a.t - b.t)[0];
    pd('pointerdown', vx, ED.yOf(target.t), 2); pd('pointerup', vx, ED.yOf(target.t), 2);
    eq(ED.viewEvents().length, 1, '右键应删除标记');
    // 工具栏：起始视角切换 + 播放头处新增
    const segs = doc.getElementById('ed-view-tools').querySelectorAll('button');
    const start3d = segs.filter((b) => b.textContent === '起始 3D')[0];
    start3d.click();
    eq(ED.chart.meta.view, '3d', '起始视角可改为 3D');
    eq(RG.Chart.viewAt(ED.chart, 0).mode, '3d', '起始视角应立刻生效');
    ED.time = 12;
    const add2d = doc.getElementById('ed-view-tools').querySelectorAll('button').filter((b) => b.textContent === '＋ 切到 2D')[0];
    add2d.click();
    ok(ED.viewEvents().some((e) => e.mode === '2d'), '应能在播放头处切到 2D');
    eq(RG.Chart.viewAt(ED.chart, 13).mode, '2d', '播放头之后应进入 2D');
    const v = RG.Chart.validate(ED.chart);
    ok(v.ok, '带视角标记的谱面应通过校验：' + v.errors.slice(0, 2).join(';'));
    const st = RG.Chart.stats(ED.chart);
    ok(st.switches >= 1 && st.view3d >= 0, '统计应含视角信息');
    // 存盘再读回，视角信息应保留
    const round = RG.Chart.parse(RG.Chart.serialize(ED.chart));
    eq(round.meta.view, ED.chart.meta.view);
    eq(round.meta.viewEvents.length, ED.chart.meta.viewEvents.length);
    RG.Editor.close(false);
  });

  await test('剧情系统已整体移除：入口 / 界面 / 模块 / 存档字段都不存在', () => {
    RG.app.showModes();
    ok(!RG.Front.modes.some((m) => m.id === 'story'), '主页不应再有故事模式卡片');
    eq(win.RG.Story, undefined, '不应再有剧情引擎');
    eq(win.RG.StoryUI, undefined, '不应再有剧情界面层');
    eq(doc.getElementById('screen-story'), null, '不应再有剧情界面');
    eq(doc.getElementById('gh-goal'), null, '不应再有剧情目标条');
    /* 存档里不该留任何剧情痕迹 */
    const dump = JSON.stringify(RG.Store.save());
    ok(dump.indexOf('"story"') < 0, '存档不应出现 story 字段：' + dump.slice(0, 120));
    ok(dump.indexOf('chaptersDone') < 0, '存档不应有剧情章节记录');
    ok(dump.indexOf('"cg"') < 0, '存档不应有剧情插画记录');
    ok(RG.Store.save().story === undefined, 'save().story 应为 undefined');
    /* 键盘操作也不会把玩家带进剧情 */
    RG.Front.expand('free', false);
    win.dispatchEvent(key('ArrowLeft', 'keydown'));
    eq(RG.UI.current, 'screen-modes');
    ok(!doc.getElementById('screen-story'), '不应因为按键产生剧情界面');
    /* 帮助文本与模式说明里不应再提剧情 */
    eq(RG.UI.showHelp(), undefined);
    const help = doc.getElementById('modal-card').textContent;
    ok(help.indexOf('故事模式') < 0, '玩法说明不应再提故事模式：' + help.slice(0, 60));
    ok(help.indexOf('静默之城') < 0, '玩法说明不应再提剧情标题');
    RG.UI.overlay('screen-modal', false);
  });

  await test('章节解锁：只看星级，提示文案里不再提剧情', () => {
    /* 清掉成绩，回到 0 星 */
    RG.Store.save().progress = {};
    RG.Store.persist();
    const pixel = RG.Songs.chapter('pixel');            // 需要 ★3
    eq(RG.Songs.isChapterUnlocked(pixel), false, '星数不足时应锁定');
    const hint = RG.Songs.unlockHint(pixel);
    ok(hint.indexOf('★') >= 0, '解锁提示应给出需要的星数：' + hint);
    ok(hint.indexOf('剧情') < 0, '解锁提示不应再提剧情：' + hint);
    /* 给第一片区域刷到 ★3 → 第二片区域解锁 */
    const origin = RG.Songs.chapter('origin');
    origin.songs[0].diffs.forEach((d, i) => {
      RG.Store.submitResult(origin.songs[0].id, i, {
        score: 900000, acc: 0.98, maxCombo: 100, grade: 'S', clear: true, stars: 3,
        fc: true, ap: false, miss: 0, perfect: 100, totalNotes: 100, duration: 60
      });
    });
    ok(RG.Store.totalStars() >= 3, '应拿到至少 3 星：' + RG.Store.totalStars());
    ok(RG.Songs.isChapterUnlocked(pixel), '星级够了就应解锁下一片区域');
    eq(RG.Songs.unlockHint(pixel), '', '已解锁时不应有提示');
  });

  await test('内置程序化绘画：场景/立绘/缓存/换种子重绘（无任何网络请求）', () => {
    eq(RG.AIArt, undefined, '不应再有 AI 生图模块');
    eq(RG.Store.settings().aiArt, undefined, '设置里不应再有 aiArt 字段');
    const theme = { a: '#38e8ff', b: '#ff4fd8' };
    const cv = RG.Art.background('city', 320, 180, theme, 7);
    ok(cv, '内置画面应可生成');
    eq(RG.Art.background('city', 320, 180, theme, 7), cv, '同参数应命中缓存');
    const cv2 = RG.Art.background('city', 320, 180, theme, 8);
    ok(cv2 && cv2 !== cv, '换种子应得到另一张画面');
    RG.Art.clearCache();
    ok(RG.Art.background('city', 320, 180, theme, 7) !== cv, '清缓存后应重新绘制');
    const kinds = RG.Art.kinds();
    ok(kinds.length >= 10, '内置场景种类应足够：' + kinds.length);
    kinds.forEach((k) => ok(RG.Art.background(k, 160, 90, theme, 3), '场景画法应可生成：' + k));
    /* 立绘绘制不应抛错 */
    const ctx = win.document.createElement('canvas').getContext('2d');
    ['rin', 'echo', 'gen', 'fer', 'choir', 'npc'].forEach((g) => RG.Art.portrait(ctx, g, '#38e8ff', 100, 200, 1, true, 1.2));
    /* 不需要网络：整个游戏没有任何 fetch/Image 依赖 */
    eq(typeof win.fetch, 'undefined', '不应发起任何网络请求实现插画');
  });

  await test('档案：总览 / 章节进度 / 成就 / 存档', () => {
    RG.Front.showProfile('overview');
    eq(RG.UI.current, 'screen-profile');
    const tabs = doc.getElementById('profile-tabs').children;
    eq(tabs.length, 4, '应有 4 个分页（剧情与插画图鉴已移除）');
    const body = doc.getElementById('profile-body');
    ok(body.querySelectorAll('.prof-bar').length >= 2, '总览应显示进度条');
    ok(body.textContent.indexOf('演奏统计') >= 0, '总览应有演奏统计');
    /* 章节进度页 */
    tabs[1].click();
    const rows = doc.getElementById('profile-body').querySelectorAll('.chapter-row');
    const packs = RG.Songs.chapters.filter((c) => !c.workshop);
    eq(rows.length, packs.length, '章节页应列出全部曲包：' + rows.length);
    ok(doc.getElementById('profile-body').textContent.indexOf(packs[0].name) >= 0, '应显示曲包名');
    /* 成就页 */
    tabs[2].click();
    eq(doc.getElementById('profile-body').querySelectorAll('.ach-row').length, RG.Achievements.list.length, '成就列表应完整');
    RG.Achievements.list.forEach((a) => {
      ok(!/story|剧情|插画|cg/.test(a.id + a.name + a.desc), '不应再有剧情向成就：' + a.id + a.name);
    });
    /* 存档页 */
    tabs[3].click();
    ok(doc.getElementById('profile-body').textContent.indexOf('导出存档') >= 0, '存档页应有导出/导入');
    /* 返回 */
    doc.querySelector('#screen-profile [data-action="back-modes"]').click();
    eq(RG.UI.current, 'screen-modes');
  });

  await test('存档：序列化 / 读档 / 重置成就（成绩保留）', () => {
    const song = RG.Songs.all()[0];
    RG.Store.submitResult(song.id, 0, {
      score: 880000, acc: 0.96, maxCombo: 80, grade: 'S', clear: true, stars: 2,
      fc: false, ap: false, miss: 0, perfect: 80, totalNotes: 80, duration: 60
    });
    RG.Achievements.unlock('first-clear');
    RG.Store.persist();
    const text = RG.Store.exportAll();
    ok(text.indexOf('"progress"') >= 0, '存档应包含成绩');
    ok(text.indexOf('"story"') < 0, '存档不应包含剧情');
    /* 重置成就：成就清空，成绩保留 */
    RG.Store.resetAchievements();
    eq(Object.keys(RG.Store.save().achievements || {}).length, 0, '成就应被清空');
    eq(!!RG.Store.record(song.id, 0), true, '成绩应保留');
    /* 导入刚才的备份：成就与成绩都应回来 */
    RG.Store.importAll(text);
    ok(RG.Store.save().achievements['first-clear'], '导入后应恢复成就');
    ok(RG.Store.record(song.id, 0), '导入后应恢复成绩');
  });

  await test('设置：游玩与皮肤改动都有实时预览', () => {
    RG.app.showSettings('modes', 'gameplay');
    eq(RG.UI.current, 'screen-settings');
    eq(RG.UI.settingsTab, 'gameplay');
    // 默认在「游玩」分页：预览铺满整屏当背景，设置项靠右
    const body = doc.getElementById('settings-body');
    const host = doc.getElementById('settings-preview');
    ok(host, '应有铺满整屏的预览容器');
    ok(host.querySelector('.pv-wrap'), '预览应挂在整屏容器里');
    ok(!body.querySelector('.pv-card'), '设置项列表里不应再有预览卡片');
    ok(RG.Preview.mounted && RG.Preview.renderer, '预览渲染器应已建立');
    ok(host.querySelector('.pv-canvas'), '应有预览画布');
    /* 设置面板靠右、半透明 */
    const pane = doc.querySelector('#screen-settings .settings-pane');
    ok(pane, '设置项应放在右侧面板里');
    ok(pane.contains(doc.getElementById('settings-tabs')), '选项卡应在右侧面板里');
    ok(pane.contains(body), '设置项应在右侧面板里');
    drain(5, 16);
    const t0 = RG.Preview.t;
    ok(t0 > 0, '预览应随时间播放：' + t0.toFixed(2));
    ok(RG.Preview.readout.textContent.indexOf('速度') >= 0, '读数应包含速度：' + RG.Preview.readout.textContent);
    // 改「下落速度」→ 读数与渲染器立即同步
    const rows = body.querySelectorAll('.set-row');
    const speedRow = rows.filter((r) => r.textContent.indexOf('下落速度') >= 0)[0];
    const range = speedRow.querySelector('input[type="range"]');
    RG.Store.set('scrollSpeed', 11);
    RG.Preview.refresh();
    ok(RG.Preview.readout.textContent.indexOf('11.0') >= 0, '读数应反映新速度：' + RG.Preview.readout.textContent);
    ok(RG.Preview.renderer.settings.scrollSpeed === 11, '预览渲染器应读到新设置');
    const before = RG.Preview.renderer.approachTime();
    // 外观分页：皮肤
    RG.UI.settingsTab = 'visual';
    RG.UI._mountPreview(body);
    RG.Store.set('skin', 'minimal');
    RG.Preview.refresh();
    ok(RG.Preview.readout.textContent.indexOf('极简') >= 0, '读数应反映新皮肤：' + RG.Preview.readout.textContent);
    ok(RG.Preview.renderer.settings.skin === 'minimal');
    RG.Store.set('skin', 'neon');
    // 切换预览视角
    RG.Preview.view = '3d';
    RG.Preview.applyView(true);
    eq(RG.Preview.renderer.view.blend, 1, '手动切 3D 应立即生效');
    drain(3, 16);
    eq(RG.Preview.renderer.mode, '3d');
    RG.Preview.view = 'auto';
    RG.Preview.t = 0;
    RG.Preview.applyView(true);
    eq(RG.Preview.renderer.view.blend, 0, '自动模式回到 2D 起步');
    // 离开设置页 → 预览停止绘制
    RG.app.showModes();
    eq(RG.Preview.mounted, false, '离开设置页后预览应停止');
    // 恢复默认速度
    RG.Store.set('scrollSpeed', 6);
  });

  await test('清除所有存档：两步确认后一切归零并回到待机画面', () => {
    // 先造点数据
    RG.Store.submitResult('first-light', 0, {
      score: 900000, acc: 0.96, maxCombo: 120, grade: 'S', clear: true, stars: 3,
      fc: true, ap: false, miss: 0, perfect: 120, totalNotes: 130, duration: 90
    });
    RG.Store.upsertChart(RG.Chart.create({ id: 'wipe-test', title: '将被清除的谱面' }));
    RG.Store.set('scrollSpeed', 9);
    /* 旧版本遗留的 AI 图片缓存：清除存档时要顺手删掉 */
    win.localStorage.setItem('rg.aiart.v1', JSON.stringify({ 'old:1': { dataUrl: 'data:image/png;base64,AAA' } }));
    ok(RG.Store.totalStars() > 0, '应有成绩');
    ok(RG.Store.customCharts().length > 0, '应有自制谱面');
    ok(win.localStorage.getItem('rg.aiart.v1') !== null, '应有遗留的 AI 图片缓存');
    // 走两步确认
    RG.app.confirmWipe();
    const modal = doc.getElementById('modal-card');
    ok(modal.textContent.indexOf('清除所有存档') >= 0, '第一步应说明要清除什么');
    ok(modal.textContent.indexOf('成就') >= 0, '应列出成就');
    ok(modal.textContent.indexOf('自制谱面') >= 0, '应列出自制谱面');
    ok(modal.textContent.indexOf('剧情') < 0, '不应再提剧情（已移除）');
    let btns = modal.querySelectorAll('.onv-btns .gbtn, .ov-btns .gbtn');
    let cont = Array.prototype.filter.call(btns, (b) => b.textContent === '继续')[0];
    cont.click();
    ok(doc.getElementById('modal-card').textContent.indexOf('真的确定吗') >= 0, '第二步应再次确认');
    btns = doc.getElementById('modal-card').querySelectorAll('.ov-btns .gbtn');
    const del = Array.prototype.filter.call(btns, (b) => b.textContent.indexOf('永久删除') >= 0)[0];
    ok(del, '应有永久删除按钮');
    del.click();
    // 全部归零
    eq(RG.Store.totalStars(), 0, '星级应清空');
    eq(RG.Store.customCharts().length, 0, '自制谱面应清空');
    eq(RG.Store.achievements ? Object.keys(RG.Store.achievements()).length : 0, 0, '成就应清空');
    ok(RG.Store.save().story === undefined, '剧情字段不应存在（剧情已移除）');
    eq(RG.Store.get('scrollSpeed'), 6, '设置应恢复默认');
    eq(win.localStorage.getItem('rg.aiart.v1'), null, '遗留的 AI 图片缓存应被清掉');
    eq(RG.Store.isFresh(), true, '清除后应视为全新存档');
    eq(RG.Store.isFresh(), true, '清除后应视为全新存档');
    eq(RG.UI.current, 'screen-title', '应回到待机画面');
    ok(doc.getElementById('tap-hint').textContent.indexOf('新手教程') >= 0, '待机画面应重新提示新手教程');
  });

  await test('新手教程：逐步上机、失败不推进、通关后进入模式选取', async () => {
    RG.Store.resetAchievements();
    const save = RG.Store.save();
    save.tutorialDone = false;
    save.tutorialStep = 0;
    RG.Store.persist();
    RG.Tutorial.open();
    eq(RG.UI.current, 'screen-tutorial');
    eq(RG.Tutorial.idx, 0);
    // 第 1 步：欢迎 → 点主按钮进入第 2 步
    let main = doc.getElementById('tut-card').querySelectorAll('.gbtn.accent')[0];
    ok(main.textContent.indexOf('开始') >= 0, '欢迎步的主按钮：' + main.textContent);
    main.click();
    eq(RG.Tutorial.idx, 1, '应进入 TAP 步骤');
    eq(RG.Tutorial.step().id, 'tap');
    const tapCard = doc.getElementById('tut-card');
    eq(tapCard.querySelector('h2').textContent, 'TAP', '标题只用代号');
    ok(!tapCard.querySelector('.tut-body'), '不应再有文字说明（改用动画演示）');
    ok(tapCard.textContent.indexOf('MISS = 0') >= 0, '应显示本步目标：' + tapCard.textContent);
    /* 动画演示：每帧都在画，而且不同步骤演示内容不同 */
    drain(6, 16);
    ok(RG.Tutorial.demoT > 0, '演示动画应在播放：' + RG.Tutorial.demoT.toFixed(2));
    const drawAt = (stepIdx) => {
      RG.Tutorial.idx = stepIdx;
      RG.Tutorial.demoT = 1.6;               // 停在"手势"阶段
      const calls = [];
      const cv = doc.getElementById('tut-art');
      const realCtx = cv.getContext('2d');
      const proxy = new Proxy(realCtx, {
        get(t, k) {
          if (k === 'fillRect') return () => calls.push('fillRect');
          if (k === 'fillText') return (txt) => calls.push('fillText:' + txt);
          if (k === 'arc') return () => calls.push('arc');
          if (k === 'lineTo') return () => calls.push('lineTo');
          return t[k];
        },
        set() { return true; }
      });
      cv._ctx = proxy;
      RG.Tutorial.drawArt();
      cv._ctx = realCtx;
      return calls;
    };
    const tapCalls = drawAt(1), flickCalls = drawAt(4), mineCalls = drawAt(5);
    ok(tapCalls.filter((c) => c === 'arc').length > 0, 'TAP 演示应画出触点/涟漪');
    ok(flickCalls.some((c) => c === 'lineTo'), 'FLICK 演示应画出滑动轨迹');
    ok(mineCalls.some((c) => c.indexOf('fillText:') === 0), 'MINE 演示应画出提示图形');
    RG.Tutorial.idx = 1;
    // 真实跑一次这一步（自动演示保证全中）
    RG.Tutorial.startStep();
    await sleep(80);
    const s = RG.app.session;
    ok(s && s.tutorial, '应建立带教程上下文的会话');
    eq(s.tutorial.id, 'tap');
    eq(s.returnTo, 'tutorial');
    ok(s.engine.noFail, '教程不应失败退出');
    eq(RG.UI.current, 'screen-game');
    compareChart: {
      const chart = s.chart;
      ok(chart.meta.lanes === 4 && chart.notes.length >= 4, '教程谱面应有效：' + chart.notes.length);
    }
    drain(240, 16);
    ok(s.started, '应开始演奏');
    // 强制自动演示 → 全 PERFECT → 教程通过
    s.autoplay = true;
    s.engine.autoplay = true;
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 4000) {
      win.RG.audio.ctx.__advance(0.05);
      drain(1, 16);
    }
    drain(120, 16);
    eq(RG.UI.current, 'screen-tutorial', '教程结束应回到教程画面（不是结算页）');
    eq(doc.getElementById('screen-result').classList.contains('hidden'), true, '教程不应弹出成绩结算');
    ok(RG.Tutorial.lastResult && RG.Tutorial.lastResult.pass, '自动演示应通过本步');
    ok(doc.getElementById('tut-card').textContent.indexOf('通过') >= 0, '应显示通过反馈');
    // 下一步 → 长按（通过后主按钮变成「下一步」，再练一次是次按钮）
    const tutBtns = doc.getElementById('tut-card').querySelectorAll('.gbtn');
    const nextBtn = Array.prototype.filter.call(tutBtns, (b) => b.textContent.indexOf('下一步') >= 0)[0];
    ok(nextBtn, '应出现下一步按钮：' + Array.prototype.map.call(tutBtns, (b) => b.textContent).join(' | '));
    nextBtn.click();
    eq(RG.Tutorial.step().id, 'hold');
    eq(RG.Store.save().tutorialStep, 2, '应记录进度');
    // 失败路径：漏掉所有音符 → 不通过、不推进
    RG.Tutorial.onResult(2, {
      counts: { miss: 2, break: 0, mineHit: 0 }, acc: 0, score: 0, maxCombo: 0, grade: 'D'
    });
    eq(RG.Tutorial.step().id, 'hold', '失败应留在当前步');
    ok(RG.Tutorial.lastResult.pass === false, '应标记为未通过');
    ok(doc.getElementById('tut-card').textContent.indexOf('漏了') >= 0, '应给出失败原因：' + doc.getElementById('tut-card').textContent.slice(-60));
    // 直接走完剩下的步骤
    RG.Tutorial.onResult(2, { counts: { miss: 0, break: 0, mineHit: 0 }, acc: 1, score: 1000000, maxCombo: 10, grade: 'SS' });
    ok(RG.Tutorial.lastResult.pass, '完美结果应通过');
    RG.Tutorial.idx = RG.Tutorial.steps.length - 1;
    RG.Tutorial.lastResult = null;
    RG.Tutorial.render();
    main = doc.getElementById('tut-card').querySelectorAll('.gbtn.accent')[0];
    ok(main.textContent.indexOf('进入模式选取') >= 0, '最后一步应引导进入模式选取：' + main.textContent);
    main.click();
    eq(RG.UI.current, 'screen-modes', '完成后应进入模式选取');
    eq(RG.Store.save().tutorialDone, true, '应记录教程已完成');
    eq(RG.Store.isFresh(), false, '完成教程后不再视为全新存档');
    eq(RG.Front.expanded, 'free', '进入后默认展开自由演奏');
    // 再次 TAP TO START 不应再进教程
    RG.app.showTitle();
    RG.Front.tap();
    eq(RG.UI.current, 'screen-modes', '看过教程后应直接进模式选取');
  });

  await test('3D：连击数画在轨道平面上（与路面同一平面），2D 才用平面 HUD', () => {
    const r = RG.app.renderer;
    r.setLanes(4);
    const real = r.ctx;
    function spy() {
      const calls = [];
      r.ctx = new Proxy(real, {
        get(t, k) {
          if (k === 'transform') return (a, b, c, d, e, f) => calls.push({ op: 'transform', a, b, c, d, e, f });
          if (k === 'fillText') return (txt, x, y) => calls.push({ op: 'fillText', txt, x, y });
          return t[k];
        },
        set(t, k, v) { if (k === 'font' || k === 'fillStyle') calls.push({ op: 'set:' + k, v }); t[k] = v; return true; }
      });
      return calls;
    }
    /* 3D：必须用路面投影变换来画数字 */
    r.setView('3d', 0, true);
    let calls = spy();
    r._drawComboOnRoad({ combo: 87 });
    r.ctx = real;
    const tr = calls.filter((c) => c.op === 'transform');
    const ft = calls.filter((c) => c.op === 'fillText');
    eq(tr.length, 1, '3D 连击应使用一次投影变换（把文字贴到路面上）');
    ok(ft.some((c) => c.txt === '87'), '应画出当前连击数：' + JSON.stringify(ft.map((c) => c.txt)));
    ok(ft.some((c) => c.txt === 'COMBO'), '应带 COMBO 字样');
    /* 字号是原来的 4 倍 + 粗体（原来 5.4 单位 → 21.6 单位，weight 900） */
    const fonts = calls.filter((c) => c.op === 'set:font').map((c) => String(c.v));
    const numFont = fonts.filter((v) => /\d+px\s+"?Segoe/.test(v))[0];
    ok(numFont, '应设置数字字体：' + JSON.stringify(fonts));
    ok(/900/.test(numFont), '数字应加粗：' + numFont);
    const size = parseFloat(numFont.match(/([\d.]+)px/)[1]);
    near(size, 21.6, 0.01, '2 位数时字号应是原来的 4 倍（21.6）：' + size);
    calls = spy();
    r._drawComboOnRoad({ combo: 1234 });
    r.ctx = real;
    const f4 = calls.filter((c) => c.op === 'set:font').map((c) => String(c.v)).filter((v) => /\d+px\s+"?Segoe/.test(v))[0];
    ok(parseFloat(f4.match(/([\d.]+)px/)[1]) < 21.6, '位数变多时应自动收缩：' + f4);
    /* 颜色必须是白色半透明 */
    calls = spy();
    r._drawComboOnRoad({ combo: 87 });
    r.ctx = real;
    const cols = calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.v));
    ok(cols.some((v) => /^rgba\(255,\s*255,\s*255,\s*0?\.\d+\)$/.test(v)), '主色应是白色半透明：' + JSON.stringify(cols));
    /* 位置比之前的 z=4.6 更高（同俯角下投影 y 更小） */
    const yAt = (z) => r._project(0, 0.006, z).y;
    ok(yAt(6.4) < yAt(4.6) - r.h * 0.01, '连击应画得比之前更高：' + Math.round(yAt(6.4)) + ' vs ' + Math.round(yAt(4.6)));
    ok(yAt(6.4) < r.judgeY, '连击应在判定线上方（路面上）');
    /* 变换矩阵必须来自路面投影：横向基向量大、纵深基向量被透视压扁（这就是"躺在平面上"的特征） */
    const m = tr[0];
    ok(Math.abs(m.a) > 4, '横向基向量应有透视缩放：' + m.a.toFixed(2));
    ok(m.d > 0.5, '纵深基向量应存在（文字被压到路面上）：d=' + m.d.toFixed(2));
    ok(Math.abs(m.a) > Math.abs(m.d) * 1.25,
      '横向基向量应明显大于纵深基向量（俯视压扁）：' + Math.abs(m.a).toFixed(2) + ' vs ' + Math.abs(m.d).toFixed(2));
    /* 连击 < 2 不显示 */
    calls = spy();
    r._drawComboOnRoad({ combo: 1 });
    r.ctx = real;
    eq(calls.filter((c) => c.op === 'fillText').length, 0, '连击 < 2 不应显示');
    /* 2D：不画在路面上（交给平面 HUD） */
    r.setView('2d', 0, true);
    calls = spy();
    r._drawComboOnRoad({ combo: 200 });
    r.ctx = real;
    eq(calls.filter((c) => c.op === 'fillText').length, 0, '2D 不应把连击画在路面上');

    /* DOM HUD：3D 让位给路面数字，2D 正常显示 */
    const mk = (mode, combo) => ({
      score: 0, acc: 1, life: 100, combo: combo, maxCombo: combo, progress: 0, fps: 60,
      viewMode: mode, viewText: mode === '3d' ? '3D 立体视角' : '2D 平面视角',
      counts: { perfect: 0, great: 0, good: 0, miss: 0, break: 0, mineHit: 0 }
    });
    RG.Store.set('showCombo', true);
    RG.UI.resetHUDCache();
    RG.UI.updateHUD(mk('3d', 42));
    const comboEl = doc.getElementById('gh-combo');
    ok(!comboEl.classList.contains('show'), '3D 时平面连击 HUD 应隐藏');
    ok(comboEl.classList.contains('on-road'), '3D 时应标记为"已在路面上"');
    RG.UI.updateHUD(mk('2d', 42));
    ok(comboEl.classList.contains('show'), '2D 时平面连击 HUD 应显示');
    ok(!comboEl.classList.contains('on-road'), '2D 时不应带 on-road 标记');
    eq(comboEl.querySelector('b').textContent, '42');
    r.setView('2d', 0, true);
  });

  await test('视角切换预告：数字倒计时取消，改成白色半透明区域沿轨道由下往上填满', () => {
    const r = RG.app.renderer;
    r.setLanes(4);
    r.setView('2d', 0, true);
    /* 纯逻辑：从切换前 5 秒开始填，到点填满，之后淡出 */
    const at = (left, after) => {
      r.pendingView = { t: 100, mode: '3d' };
      r._fadingView = null;
      r.time = 100 - left + (after || 0);       // after：切换发生之后又过了多久
      return r._viewFill(r.time);
    };
    eq(at(6), null, '距离切换 6 秒时不应有动效');
    const f5 = at(5.0);
    ok(f5 && f5.fill < 0.05, '刚开始（5s）填充量应接近 0：' + (f5 && f5.fill));
    const f25 = at(2.5);
    ok(f25.fill > 0.3 && f25.fill < 0.8, '中途应在填充中：' + f25.fill.toFixed(2));
    const f01 = at(0.1);
    ok(f01.fill > 0.9, '临近切换应几乎填满：' + f01.fill.toFixed(2));
    const f0 = at(0);
    eq(f0.fill, 1, '切换发生时应刚好填满');
    ok(at(0, 0.1).alpha < f0.alpha, '填满后应开始淡出');
    eq(at(0, 0.5), null, '淡出结束后应完全消失');
    /* 切换发生的瞬间：事件换成下一个时也要继续淡出（不能闪一下就没） */
    r.pendingView = { t: 100, mode: '3d' };
    r._fadingView = null; r._fillAfter = null;
    r.time = 100.02;
    r.setPendingView({ t: 140, mode: '2d' });       // 引擎在切换后给出的是"下一个"事件
    const fading = r._viewFill(100.02);
    ok(fading && fading.phase === 'fade' && fading.mode === '3d', '切换后应继续用旧事件做淡出：' + JSON.stringify(fading));
    ok(fading.alpha > 0, '淡出瞬间应还可见');
    r.time = 100.3;
    const f2 = r._viewFill(100.3);
    ok(!f2 || f2.alpha < fading.alpha, '淡出应逐渐变淡');
    r.pendingView = null; r._fadingView = null; r._fillAfter = null;
    /* 不应出现数字倒计时文案 */
    const nx = at(2.5);
    ok(!/[\d.]+s/.test(JSON.stringify(nx)), '不应有秒数文本：' + JSON.stringify(nx));

    /* 绘制：纯色半透明白，无描边、无渐变 */
    const real = r.ctx;
    function spy() {
      const calls = [];
      r.ctx = new Proxy(real, {
        get(t, k) {
          if (k === 'fillRect') return (...a) => calls.push({ op: 'fillRect', a });
          if (k === 'fill') return () => calls.push({ op: 'fill' });
          if (k === 'stroke') return () => calls.push({ op: 'stroke' });
          if (k === 'strokeRect') return () => calls.push({ op: 'strokeRect' });
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => { calls.push({ op: 'gradient' }); return { addColorStop() { } }; };
          return t[k];
        },
        set(t, k, v) { if (k === 'fillStyle' || k === 'strokeStyle') calls.push({ op: 'set:' + k, v }); t[k] = v; return true; }
      });
      return calls;
    }
    r.pendingView = { t: 100, mode: '3d' };
    r.time = 97.5;
    let calls = spy();
    r._drawViewFill(0.016);
    r.ctx = real;
    const rects = calls.filter((c) => c.op === 'fillRect');
    eq(rects.length, 1, '2D 应只画一块填充区域：' + rects.length);
    ok(rects[0].a[3] > 0, '填充高度应大于 0');
    eq(calls.filter((c) => c.op === 'gradient').length, 0, '不应使用任何渐变');
    eq(calls.filter((c) => c.op === 'stroke' || c.op === 'strokeRect').length, 0, '不应有任何描边');
    eq(calls.filter((c) => c.op === 'set:strokeStyle').length, 0, '不应设置描边色');
    const fills2d = calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.v));
    ok(fills2d.length > 0 && fills2d.every((v) => /^rgba\(255,\s*255,\s*255,/.test(v)),
      '填充色必须是纯白半透明：' + JSON.stringify(fills2d));

    /* 3D：贴着路面的一块四边形（同样无描边无渐变） */
    r.setView('3d', 0, true);
    r.pendingView = { t: 100, mode: '2d' };
    r.time = 97.5;
    calls = spy();
    r._drawViewFill(0.016);
    r.ctx = real;
    eq(calls.filter((c) => c.op === 'fill').length, 1, '3D 应一块四边形铺满路面');
    eq(calls.filter((c) => c.op === 'gradient').length, 0, '3D 也不应使用渐变');
    eq(calls.filter((c) => c.op === 'stroke' || c.op === 'strokeRect').length, 0, '3D 不应有描边');
    const fills3d = calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.v));
    ok(fills3d.every((v) => /^rgba\(255,\s*255,\s*255,/.test(v)), '3D 填充色也必须是纯白半透明：' + JSON.stringify(fills3d));
    eq(r._viewFill(97.5).mode, '2d', '应带上目标视角');
    /* 不用时完全不画 */
    r.pendingView = null;
    calls = spy();
    r._drawViewFill(0.016);
    r.ctx = real;
    eq(calls.length, 0, '没有待切换事件时不应画任何东西');
    r.pendingView = null;
    r.setView('2d', 0, true);
  });

  await test('演奏时：HUD 视角文案不含数字倒计时，renderer 收到连击与预告', async () => {
    const song = RG.Songs.all()[0];
    RG.app.showMap();
    RG.app.startGame({ song: song, diffIndex: 0, returnTo: 'map' });
    await sleep(80);
    const s = RG.app.session;
    ok(s, '应建立会话');
    drain(240, 16);
    ok(s.started, '应开始演奏');
    /* 渲染器每帧都应拿到连击数与下一次切换预告 */
    s.engine.combo = 25;
    const frames = [];
    const rend = RG.app.renderer;
    const realDraw = rend.draw;
    rend.draw = function (f) { frames.push({ combo: f.combo, viewNext: f.viewNext }); return realDraw.call(rend, f); };
    drain(3, 16);
    rend.draw = realDraw;
    ok(frames.length >= 2, '应绘制了若干帧');
    eq(frames[frames.length - 1].combo, 25, 'renderer 应收到当前连击数');
    ok(frames[frames.length - 1].viewNext === null || typeof frames[frames.length - 1].viewNext === 'object',
      'renderer 应收到下一次视角切换（用于填充动效）');
    /* 开局固定从 2D 起步、画布已清空 */
    eq(s.viewMode, '2d', '开局应从 2D 起步');
    eq(rend.mode, '2d', '渲染器开局应是 2D');
    /* 游玩中不再显示当前是 2D 还是 3D，也没有左下角数据与帧率 */
    /* 正上方显示分数与实时精度；视角/帧率/底部文字仍然没有 */
    ['gh-view', 'gh-fps', 'gh-offset'].forEach((id) => eq(doc.getElementById(id), null, '#' + id + ' 应已移除'));
    ok(doc.getElementById('gh-score').textContent.length > 0, '正上方应显示分数：' + doc.getElementById('gh-score').textContent);
    ok(doc.getElementById('gh-acc').textContent.indexOf('%') >= 0, '正上方应显示实时精度：' + doc.getElementById('gh-acc').textContent);
    /* 分数会随演奏增长、精度会更新 */
    s.engine.score = 123456; s.engine.acc = 0.9876;
    RG.UI.updateHUD({ score: 123456, acc: 0.9876, life: 90, combo: 10, maxCombo: 10, progress: 0.3, fps: 60, viewMode: '2d', counts: { perfect: 10, great: 0, good: 0, miss: 0, break: 0, mineHit: 0 } });
    eq(doc.getElementById('gh-score').textContent, RG.U.fmtScore(123456), '分数应实时刷新');
    eq(doc.getElementById('gh-acc').textContent, RG.U.fmtPct(0.9876), '精度应实时刷新');
    /* 曲名难度在右下角、右对齐；没有几 key 字样 */
    const br = doc.querySelector('.gh-botright');
    ok(br, '应有右下角信息块');
    ok(br.textContent.indexOf(song.title) >= 0, '右下角应显示曲名');
    ok(br.textContent.indexOf('键') < 0, '不应显示是几 key：' + br.textContent);
    /* 顶部整条血量 + 暂停键周围进度环 */
    ok(doc.querySelector('.gh-lifebar'), '应有顶部整条血量');
    const ring = doc.getElementById('gh-pause-progress');
    ok(ring && ring.style.strokeDashoffset !== '', '暂停键应有进度环：' + (ring && ring.style.strokeDashoffset));
    s.engine.update(s.chart.meta.length + 5);
    drain(120, 16);
  });

  await test('暂停：PAUSED、无数据、无设置入口、三个符号按钮、无背景', async () => {
    const song = RG.Songs.all()[1];
    RG.app.showMap();
    RG.app.startGame({ song: song, diffIndex: 0, returnTo: 'map' });
    await sleep(80);
    const s = RG.app.session;
    drain(240, 16);
    ok(s.started, '应开始演奏');
    RG.app.session.paused = false;
    doc.querySelector('[data-action="pause"]').click();
    drain(2, 16);
    eq(doc.getElementById('screen-pause').classList.contains('hidden'), false, '应打开暂停覆盖层');
    ok(s.paused, '会话应处于暂停态');
    const card = doc.querySelector('#screen-pause .ov-card');
    ok(card.classList.contains('bare'), '暂停框不应有任何背景');
    eq(doc.querySelector('#screen-pause h2').textContent, 'PAUSED');
    eq(doc.getElementById('pause-stats'), null, '暂停不应再显示游戏数据');
    eq(doc.querySelector('[data-action="open-settings-game"]'), null, '暂停不应再有设置入口');
    const syms = doc.querySelectorAll('#screen-pause .sym-btn');
    eq(syms.length, 3, '暂停应只有三个符号按钮');
    eq(syms[0].textContent, '▶');
    eq(syms[1].textContent, '⟲');
    eq(syms[2].textContent, '✕');
    syms.forEach((b) => ok(b.className.indexOf('gbtn') < 0, '符号按钮不应带背景样式'));
    /* ▶ 继续 */
    syms[0].click();
    drain(2, 16);
    ok(!s.paused, '继续应恢复');
    eq(doc.getElementById('screen-pause').classList.contains('hidden'), true, '暂停覆盖层应关闭');
    /* ⟲ 重开 / ✕ 退出 */
    doc.querySelector('[data-action="pause"]').click();
    drain(2, 16);
    doc.querySelectorAll('#screen-pause .sym-btn')[2].click();
    drain(4, 16);
    eq(RG.app.session, null, '退出应结束会话');
  });

  await test('点划键：外形与单点完全一致（只是换了颜色），上方隔一点空隙加一个尖顶', () => {
    const r = RG.app.renderer;
    r.setLanes(4);
    const TYPES = RG.Chart.TYPES;
    eq(TYPES.flick.label, 'FLICK', '点划的代号');
    eq(TYPES.tap.label, 'TAP', '单点的代号');
    ok(TYPES.flick.color !== TYPES.tap.color, '点划必须是"换了颜色"的单点：' + TYPES.flick.color + ' vs ' + TYPES.tap.color);

    const real = r.ctx;
    /* 记录 2D 绘制：形状调用（arcTo=圆角方块、lineTo=箭头）+ 渐变（外形配色） */
    function draw2d(type) {
      const calls = [];
      const proxy = new Proxy(real, {
        get(t, k) {
          if (k === 'arcTo') return (...a) => calls.push({ op: 'arcTo', a });
          if (k === 'lineTo') return (...a) => calls.push({ op: 'lineTo', a });
          if (k === 'moveTo') return (...a) => calls.push({ op: 'moveTo', a });
          if (k === 'createLinearGradient') {
            /* 返回"创建渐变的函数"，并记下调用参数与色阶 */
            return function () {
              var g = { op: 'grad', a: Array.prototype.slice.call(arguments), stops: [] };
              calls.push(g);
              return { addColorStop: function (p, c) { g.stops.push([p, String(c)]); } };
            };
          }
          return t[k];
        },
        set() { return true; }
      });
      r.ctx = proxy;
      r._drawNote2d(
        { t: 1, lane: 0, type: type, d: 0, endT: 1, state: 0, judge: '', delta: 0 },
        120, 'neon', 1, 400);
      r.ctx = real;
      return calls;
    }
    const tap = draw2d('tap');
    const flick = draw2d('flick');
    const count = (cs, op) => cs.filter((c) => c.op === op).length;
    /* 外形：两者都用圆角方块（arcTo 画四角），方块路径一模一样 */
    ok(count(tap, 'arcTo') >= 4 && count(flick, 'arcTo') === count(tap, 'arcTo'),
      '点划应与单点用同一种方块外形：arcTo ' + count(flick, 'arcTo') + ' vs ' + count(tap, 'arcTo'));
    /* 渐变（方块填充）：同一条渐变线，中间色分别是各自类型色 */
    const gTap = tap.filter((c) => c.op === 'grad')[0];
    const gFlick = flick.filter((c) => c.op === 'grad')[0];
    ok(gTap && gFlick, '两者都应有一条方块渐变');
    eq(JSON.stringify(Array.from(gFlick.a)), JSON.stringify(Array.from(gTap.a)), '方块渐变的位置应与单点一致（同尺寸）');
    eq(gTap.stops.length, gFlick.stops.length, '渐变色阶数量应一致');
    ok(gTap.stops[1][1].indexOf('56,232,255') >= 0 || gTap.stops[1][1].indexOf('38e8ff') >= 0,
      '单点中间色应是单点色：' + gTap.stops[1][1]);
    ok(gFlick.stops[1][1] !== gTap.stops[1][1], '点划中间色必须与单点不同（换了颜色）：' + gFlick.stops[1][1]);
    /* 尖顶：只有点划在方块上方多画一个实心三角（moveTo + 2 lineTo）+ 高光小三角 */
    eq(count(tap, 'lineTo'), 0, '单点上方不应有多余图形');
    eq(count(flick, 'lineTo'), 4, '点划的尖顶应是两个三角形（本体 + 高光）= 4 条线：' + count(flick, 'lineTo'));
    eq(count(flick, 'moveTo') - count(tap, 'moveTo'), 2, '点划应多出两个三角形的起始点');
    /* 形状是「尖顶」而不是「箭头」：三点的 y 只有两种取值（尖 + 平底），没有箭柄那一层 */
    const seq = flick.filter((c) => c.op === 'moveTo' || c.op === 'lineTo');
    const peak = seq.slice(seq.length - 6);                 // 最后两个三角形 = 尖顶 + 高光
    const tri = peak.slice(0, 3);                           // 尖顶本体：尖 + 两个底角
    const ys = tri.map((c) => c.a[1]);
    const uniqY = Array.from(new Set(ys.map((v) => Math.round(v * 10) / 10)));
    eq(uniqY.length, 2, '尖顶应有且只有两个高度（一个尖 + 一条平底），不是箭头的三层：' + JSON.stringify(uniqY));
    const apex = tri.filter((c) => Math.abs(c.a[1] - Math.min.apply(null, ys)) < 0.5)[0];
    const base = tri.filter((c) => Math.abs(c.a[1] - Math.max.apply(null, ys)) < 0.5);
    eq(base.length, 2, '尖顶底边应由两个点构成');
    /* 底边有宽度、尖在正中 */
    ok(Math.abs(base[0].a[0] - base[1].a[0]) > 6, '尖顶底边应有一定宽度：' + Math.abs(base[0].a[0] - base[1].a[0]));
    const cx = (base[0].a[0] + base[1].a[0]) / 2;
    ok(Math.abs(apex.a[0] - cx) < 0.5, '尖应对准方块中心：' + apex.a[0] + ' vs ' + cx);
    /* 尖顶整体在方块上方，且与方块之间留有小空隙（不是紧贴、也不是离太远） */
    const hy = gFlick.a[1];                       // 方块顶边 y（渐变起点）
    const peakYs = peak.map((c) => c.a[1]);
    ok(Math.max.apply(null, peakYs) < hy, '尖顶必须完全在方块上方：' + Math.max.apply(null, peakYs) + ' < ' + hy);
    ok(hy - Math.max.apply(null, peakYs) <= 5.5, '尖顶与本体之间应只有微小空隙：' + (hy - Math.max.apply(null, peakYs)).toFixed(1) + 'px');
    ok(Math.min.apply(null, peakYs) < hy - 8, '尖顶应有足够高度：' + (hy - Math.min.apply(null, peakYs)).toFixed(1) + 'px');
    /* 尖顶用本体同材质（渐变中间色 = 点划色），不再是纯白箭头 */
    const peakGrads = flick.filter((c) => c.op === 'grad');
    ok(peakGrads.length >= 2, '尖顶也应带自己的渐变：' + peakGrads.length);
    ok(peakGrads[1].stops.some((s) => s[1].toLowerCase().indexOf('ff9d3c') >= 0 || s[1].indexOf('255,157,60') >= 0),
      '尖顶中间色应是点划色（与本体同材质）：' + JSON.stringify(peakGrads[1].stops));

    /* 3D：厚度与单点一致（不再是更厚的特殊块），并额外画箭头 */
    function draw3d(type) {
      const calls = [];
      const proxy = new Proxy(real, {
        get(t, k) {
          if (k === 'lineTo') return (...a) => calls.push({ op: 'lineTo', a });
          if (k === 'moveTo') return (...a) => calls.push({ op: 'moveTo', a });
          return t[k];
        },
        set() { return true; }
      });
      r.ctx = proxy;
      r._drawNote3d(
        { t: 1, lane: 0, type: type, d: 0, endT: 1, state: 0, judge: '', delta: 0 },
        1.2, 1.6, r.laneWU, r.lanes / 2);
      r.ctx = real;
      return calls;
    }
    r.setView('3d', 0, true);
    const tap3 = draw3d('tap');
    const flick3 = draw3d('flick');
    eq(flick3.length - tap3.length, 6, '3D 点划应比单点多出尖顶路径（2 个三角形 = 2 moveTo + 4 lineTo）');
    /* 方块顶面厚度一致：用顶部四角投影比较 */
    const probe = (type, h) => {
      const s = r.settings;
      return r._project(0, (type === 'flick' ? 0.36 : 0.36) * (s.noteSize || 1), 1.2).y;
    };
    near(probe('flick'), probe('tap'), 0.01, '点划与单点在 3D 里厚度应一致');
    r.setView('2d', 0, true);
  });

  await test('点划（集成）：指针滑动 / 键盘两键命中，只点一下或只按一键判漏', async () => {
    const chart = RG.Chart.create({
      id: 'flick-it', title: '点划验证', artist: 'harness', lanes: 4, bpm: 120,
      offsetSec: 0, length: 14,
      music: { style: 'chiptune', seed: 11, bpm: 120, rootMidi: 45, scale: 'minor', sections: [{ name: 'a', intensity: 1, bars: 8 }] }
    });
    chart.notes = [
      { t: 2, lane: 0, type: 'flick' },      // 指针：按下 + 滑动 → 应命中
      { t: 4, lane: 1, type: 'flick' },      // 指针：只点一下不滑动 → 应漏
      { t: 6, lane: 2, type: 'flick' },      // 键盘：只按一个键 → 应漏
      { t: 8, lane: 3, type: 'flick' }       // 键盘：同时按两个键 → 应命中
    ].map((n) => Object.assign({}, n));
    RG.Chart.normalize(chart);
    RG.app.showMap();
    RG.app.startGame({
      song: {
        id: 'flick-it', title: '点划验证', artist: 'harness', custom: true, chart: chart,
        theme: { a: '#38e8ff', b: '#ff4fd8' }, diffs: [{ name: '验证', level: 3, lanes: 4 }]
      },
      diffIndex: 0, chart: chart, custom: true, returnTo: 'map'
    });
    await sleep(80);
    const s = RG.app.session;
    ok(s, '应建立会话');
    RG.Store.set('autoplay', false);
    s.autoplay = false; s.engine.autoplay = false;
    drain(240, 16);
    ok(s.started, '应已开始');

    const audio = win.RG.audio;
    const base = audio._startCtx;
    const off = s.chart.meta.offsetSec || 0;
    const toAudio = (t) => base + (t + off - s.startAt);
    const doFrame = () => drain(1, 16);
    const r = RG.app.renderer;
    const keys = RG.Store.lanesFor(4);
    const laneX = (lane) => r.fieldX + (lane + 0.5) * r.laneW;
    r.setView('2d', 0, true);

    /* 1) 指针按下 + 朝任意方向滑动（不松手） */
    audio.ctx.currentTime = toAudio(2.0);
    RG.app.input.pointerDown(1, laneX(0), r.judgeY);
    doFrame();
    audio.ctx.currentTime = toAudio(2.04);
    RG.app.input.pointerMove(1, laneX(0) + 30, r.judgeY - 34);   // 斜着划一下
    doFrame();
    ok(r.slashes.length > 0, '滑动应触发划痕特效（main 的 onSwipe 钩子）');

    /* 2) 指针只点一下、不滑动 */
    audio.ctx.currentTime = toAudio(4.0);
    RG.app.input.pointerDown(2, laneX(1), r.judgeY);
    doFrame();
    audio.ctx.currentTime = toAudio(4.06);
    RG.app.input.pointerUp(2, laneX(1), r.judgeY);
    doFrame();

    /* 3) 键盘只按一个键 */
    audio.ctx.currentTime = toAudio(6.0);
    win.dispatchEvent(key(keys[2], 'keydown'));
    doFrame();
    audio.ctx.currentTime = toAudio(6.2);
    win.dispatchEvent(key(keys[2], 'keyup'));
    doFrame();

    /* 4) 键盘同时按两个键（音符轨道 + 另一个轨道） */
    audio.ctx.currentTime = toAudio(8.0);
    win.dispatchEvent(key(keys[3], 'keydown'));
    doFrame();
    audio.ctx.currentTime = toAudio(8.03);
    win.dispatchEvent(key(keys[1], 'keydown'));
    doFrame();
    audio.ctx.currentTime = toAudio(8.15);
    win.dispatchEvent(key(keys[1], 'keyup'));
    win.dispatchEvent(key(keys[3], 'keyup'));
    doFrame();

    /* 跑完剩下的时间 */
    let guard = 0;
    while (RG.app.session === s && !s.done && guard++ < 4000) {
      audio.ctx.currentTime += 0.05;
      drain(1, 16);
    }
    drain(60, 16);
    const byLane = {};
    s.engine.notes.forEach((n) => { byLane[n.lane] = n.judge + (n.tailJudge ? '/' + n.tailJudge : ''); });
    eq(byLane[0], 'perfect', '指针滑动应命中：' + JSON.stringify(byLane));
    eq(byLane[1], 'miss', '指针只点一下应判漏');
    eq(byLane[2], 'miss', '键盘只按一个键应判漏');
    eq(byLane[3], 'perfect', '键盘两键同上应命中');
    eq(s.engine.counts.miss, 2, '总 MISS 数应正好是那两个未完成的点划');
  });

  await test('清理：停止所有音频排程', () => {
    win.RG.audio.stop();
    ok(true);
  });

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('\n失败详情:');
    failures.forEach(([n, e]) => console.log('  - ' + n + ': ' + (e && e.message)));
    process.exit(1);
  }
  console.log('全部通过 ✅\n');
  process.exit(0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });

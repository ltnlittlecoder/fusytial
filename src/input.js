/* ==========================================================================
 * Resonance Engine · input.js
 * 输入系统：键盘（可改键位）/ 鼠标 / 多点触控，统一输出 {down,up} 事件流
 *   - 按住状态由「键盘按住 + 指针按住」共同决定（滑条需要同时成立）
 *   - 指针拖动时：起点轨道持续视为按住，划过的轨道触发 down（滑条终点判定）
 * ========================================================================== */
(function (root) {
  'use strict';
  var RG = root.RG = root.RG || {};
  var U = RG.U;

  /* 点划的滑动阈值（像素）：按下后朝任意方向移动超过这个距离就算一次滑动 */
  var SWIPE_MIN = 14;

  function Input(opts) {
    opts = opts || {};
    this.lanes = opts.lanes || 4;
    this.bindings = opts.bindings || [];
    this.clock = opts.clock || function () { return U.now() / 1000; };
    this.laneAt = opts.laneAt || null;         // function(x, y) -> lane | -1
    this.enabled = false;
    this.ignoreWhenTyping = true;
    this.keys = {};                            // code -> lane
    this.keyHeld = new Array(this.lanes).fill(0);
    this.pointers = {};                        // id -> {lane, startLane, swept:{}}
    this.pointerHeld = new Array(this.lanes).fill(0);
    this.queue = [];
    this.hotkeys = [];
    this._bound = {};
    this._el = null;
  }

  Input.prototype.setLanes = function (n, bindings) {
    this.lanes = n;
    this.bindings = bindings || [];
    this._rebuildKeys();
    this.keyHeld = new Array(n).fill(0);
    this.pointerHeld = new Array(n).fill(0);
  };
  Input.prototype._rebuildKeys = function () {
    this.keys = {};
    var b = this.bindings || [];
    for (var i = 0; i < b.length && i < this.lanes; i++) if (b[i]) this.keys[b[i]] = i;
  };

  Input.prototype.attach = function (el) {
    this._el = el || root;
    var self = this;
    this._bound.keydown = function (e) { self._onKeyDown(e); };
    this._bound.keyup = function (e) { self._onKeyUp(e); };
    this._bound.blur = function () { self.releaseAll(); };
    U.on(root, 'keydown', this._bound.keydown);
    U.on(root, 'keyup', this._bound.keyup);
    U.on(root, 'blur', this._bound.blur);
  };
  Input.prototype.detach = function () {
    if (!this._el) return;
    U.on; // no-op 保持结构清晰
    root.removeEventListener('keydown', this._bound.keydown);
    root.removeEventListener('keyup', this._bound.keyup);
    root.removeEventListener('blur', this._bound.blur);
    this._el = null;
  };

  Input.prototype._typing = function () {
    if (!this.ignoreWhenTyping) return false;
    var a = root.document && root.document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || a.isContentEditable;
  };

  Input.prototype._onKeyDown = function (e) {
    if (this._typing()) return;
    for (var i = 0; i < this.hotkeys.length; i++) {
      if (this.hotkeys[i].code === e.code) { this.hotkeys[i].fn(e); }
    }
    if (!this.enabled) return;
    var lane = this.keys[e.code];
    if (lane === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keyHeld[lane]++;
    this._push('down', lane, 'key');
  };
  Input.prototype._onKeyUp = function (e) {
    var lane = this.keys[e.code];
    if (lane === undefined) return;
    if (this.keyHeld[lane] > 0) this.keyHeld[lane]--;
    if (this.enabled) this._push('up', lane, 'key');
  };

  /** 游戏画布上的指针事件 */
  Input.prototype.pointerDown = function (id, x, y) {
    if (!this.enabled || !this.laneAt) return;
    var lane = this.laneAt(x, y);
    if (lane < 0 || lane >= this.lanes) return;
    this.pointers[id] = { lane: lane, startLane: lane, x: x, y: y, pressX: x, pressY: y, swiped: false };
    this.pointerHeld[lane] = (this.pointerHeld[lane] || 0) + 1;
    this._push('down', lane, 'pointer');
  };
  Input.prototype.pointerMove = function (id, x, y) {
    var p = this.pointers[id];
    if (!p || !this.enabled || !this.laneAt) return;
    p.x = x; p.y = y;
    /* 点划：按下后朝任意方向滑过阈值就算一次滑动（不需要松手） */
    if (!p.swiped) {
      var dx = x - p.pressX, dy = y - p.pressY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= SWIPE_MIN) {
        p.swiped = true;
        this._push('swipe', p.startLane, 'pointer', { dx: dx, dy: dy, dist: dist });
      }
    }
    var lane = this.laneAt(x, y);
    if (lane < 0 || lane === p.lane) return;
    if (this.pointerHeld[p.lane] > 0) this.pointerHeld[p.lane]--;
    p.lane = lane;
    if (lane >= 0 && lane < this.lanes) {
      this.pointerHeld[lane] = (this.pointerHeld[lane] || 0) + 1;
      this._push('down', lane, 'pointer');   // 划到新轨道 = 该轨道被按下
    }
  };
  Input.prototype.pointerUp = function (id, x, y) {
    var p = this.pointers[id];
    if (!p) return;
    delete this.pointers[id];
    if (this.pointerHeld[p.lane] > 0) this.pointerHeld[p.lane]--;
    if (p.startLane !== p.lane && this.pointerHeld[p.startLane] > 0) this.pointerHeld[p.startLane]--;
    if (this.enabled) this._push('up', p.lane, 'pointer');
    if (this.enabled && p.startLane !== p.lane) this._push('up', p.startLane, 'pointer');
  };
  Input.prototype.releaseAll = function () {
    for (var i = 0; i < this.lanes; i++) { this.keyHeld[i] = 0; }
    this.pointers = {};
    this.pointerHeld = new Array(this.lanes).fill(0);
  };
  Input.prototype.reset = function () {
    this.releaseAll();
    this.queue.length = 0;
  };

  Input.prototype.held = function (lane) {
    if (lane < 0 || lane >= this.lanes) return false;
    if (this.keyHeld[lane] > 0) return true;
    if (this.pointerHeld[lane] > 0) return true;
    for (var id in this.pointers) if (this.pointers[id].startLane === lane) return true;
    return false;
  };
  Input.prototype.heldCount = function () {
    var n = 0;
    for (var i = 0; i < this.lanes; i++) if (this.held(i)) n++;
    return n;
  };
  /** 只算「键盘按键」的轨道数（点划的键盘规则要求 ≥2 个键，触摸不算） */
  Input.prototype.heldKeyCount = function () {
    var n = 0;
    for (var i = 0; i < this.lanes; i++) if (this.keyHeld[i] > 0) n++;
    return n;
  };

  Input.prototype._push = function (type, lane, source, extra) {
    var ev = { type: type, lane: lane, time: this.clock(), source: source };
    if (extra) for (var k in extra) ev[k] = extra[k];
    this.queue.push(ev);
  };
  Input.prototype.consume = function () {
    if (!this.queue.length) return null;
    var q = this.queue;
    this.queue = [];
    return q;
  };
  Input.prototype.onHotkey = function (code, fn) { this.hotkeys.push({ code: code, fn: fn }); };
  Input.prototype.clearHotkeys = function () { this.hotkeys.length = 0; };

  RG.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);

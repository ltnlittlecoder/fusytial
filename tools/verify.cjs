/*! RESONANCE · 交付自检
 * 检查：文件编码 / index.html 的脚本顺序 / 脚本引用的 DOM id 是否都存在 /
 *       模块语法 / 文档提到的测试数量与实际是否一致
 *   node tools/verify.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let problems = [];

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

/* 1. 编码：全部必须是合法 UTF-8 */
const files = ['index.html', 'README.md', 'styles/main.css'];
fs.readdirSync(path.join(ROOT, 'src')).forEach((f) => files.push('src/' + f));
fs.readdirSync(path.join(ROOT, 'tests')).forEach((f) => files.push('tests/' + f));
files.forEach((f) => {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return;
  try { new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(full)); }
  catch (e) { problems.push('非法 UTF-8：' + f); }
});
console.log('编码检查：' + files.length + ' 个文件');

/* 2. index.html 的脚本顺序：文件存在，且依赖顺序正确（screens 必须早于 frontend） */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/src="(src\/[^"]+)"/g)].map((m) => m[1]);
scripts.forEach((s) => { if (!fs.existsSync(path.join(ROOT, s))) problems.push('脚本不存在：' + s); });
const idx = (n) => scripts.findIndex((s) => s.endsWith('/' + n));
if (idx('screens.js') > idx('frontend.js')) {
  problems.push('脚本顺序错误：screens.js 必须早于 frontend.js（它加载时会取 RG.UI）');
}
['util', 'store', 'audio', 'chart', 'songs', 'input', 'engine', 'render', 'worldmap',
  'art', 'screens', 'preview', 'frontend', 'tutorial', 'editor', 'main'].forEach((n) => {
    if (idx(n + '.js') < 0) problems.push('index.html 缺少脚本：src/' + n + '.js');
  });
/* 剧情系统已整体移除：这两个文件不应再出现，也不应再被 index.html 引用 */
['story.js', 'storyui.js'].forEach((n) => {
  if (fs.existsSync(path.join(ROOT, 'src', n))) problems.push('剧情模块应已删除：src/' + n);
  if (idx(n) >= 0) problems.push('index.html 不应再引用：src/' + n);
});
console.log('脚本检查：' + scripts.length + ' 个（顺序 ' + (idx('screens.js') < idx('frontend.js') ? 'OK' : '错误') + '）');

/* 3. DOM id：index.html 里定义的 id 应能被 JS 找到（getElementById / UI.el 列表） */
const js = scripts.map((s) => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n');
const ids = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
const unused = ids.filter((id) => js.indexOf("'" + id + "'") < 0 && js.indexOf('"' + id + '"') < 0);
console.log('DOM 检查：' + ids.length + ' 个元素 id，其中 JS 未引用的 ' + unused.length + ' 个' +
  (unused.length ? '（' + unused.join(', ') + '）' : ''));

/* 4. JS 里 getElementById('x') 的 x 是否真的存在于 HTML
 *    （白名单：运行时动态创建的元素） */
const RUNTIME_IDS = [
  'ed-view-tools',            // 编辑器里动态追加的视角工具组
  'gen-song', 'gen-level', 'gen-lanes', 'gen-level-v',   // 「由乐曲生成草稿」弹窗动态内容
  'mode-keys'                 // 首页手风琴底部的按键提示
];
const wanted = [...js.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(wanted)].filter((id) => ids.indexOf(id) < 0 && RUNTIME_IDS.indexOf(id) < 0);
if (missing.length) problems.push('JS 引用了 HTML 中不存在的 id：' + missing.join(', '));
console.log('引用检查：JS 引用 ' + new Set(wanted).size + ' 个 id，缺失 ' + missing.length + ' 个（运行时动态 id ' + RUNTIME_IDS.length + ' 个）');

/* 4.5 CSS 结构：花括号平衡 + 不许出现明显坏 token */
const css = fs.readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
if (open !== close) problems.push('styles/main.css 花括号不平衡：{ ' + open + ' vs } ' + close);
const strayMedia = css.split('@media').length - 1;
console.log('样式检查：' + open + ' 组规则，' + strayMedia + ' 个媒体查询，花括号' + (open === close ? '平衡' : '不平衡'));

/* 5. 模块语法 */
let syntaxBad = 0;
scripts.forEach((s) => {
  try { new Function(fs.readFileSync(path.join(ROOT, s), 'utf8')); }
  catch (e) { syntaxBad++; problems.push('语法错误 ' + s + '：' + e.message); }
});
console.log('语法检查：' + scripts.length + ' 个模块，错误 ' + syntaxBad + ' 个');

/* 5.5 游戏里不应出现音符的中文名（只保留代号） */
const NOTE_NAMES = ['单点', '长按', '滑条', '点划', '地雷'];
const htmlHits = NOTE_NAMES.filter((cn) => html.indexOf(cn) >= 0);
if (htmlHits.length) problems.push('index.html 里出现了音符中文名：' + htmlHits.join('、') + '（只应保留代号）');
const uiHits = [];
['src/chart.js', 'src/songs.js', 'src/screens.js', 'src/tutorial.js', 'src/frontend.js'].forEach((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  /* 只看字符串字面量，跳过注释 */
  src.split(/\r?\n/).forEach((line) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/^\s*\*/.test(line)) return;                       // 块注释的行
    NOTE_NAMES.forEach((cn) => {
      if (code.indexOf("'" + cn) >= 0 || code.indexOf('"' + cn) >= 0) uiHits.push(rel + ':' + cn);
    });
  });
});
if (uiHits.length) problems.push('源码字符串里仍有音符中文名：' + uiHits.join('、'));
console.log('代号检查：index.html ' + htmlHits.length + ' 处 · 源码字符串 ' + uiHits.length + ' 处');

/* 6. README 里写的测试数量与实际用例数是否一致 */
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const countCases = (file) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return (src.match(/^\s*(test|await test)\(/gm) || []).length;
};
const nUnit = countCases('tests/smoke.cjs');
const nDom = countCases('tests/dom-smoke.cjs');
const mUnit = readme.match(/smoke\.cjs[^\n]*?（(\d+) 项）/);
const mDom = readme.match(/dom-smoke\.cjs[^\n]*?（(\d+) 项）/);
console.log('用例统计：smoke=' + nUnit + ' dom-smoke=' + nDom);
if (mUnit && Number(mUnit[1]) !== nUnit) problems.push('README 写的逻辑用例数（' + mUnit[1] + '）与实际（' + nUnit + '）不一致');
if (mDom && Number(mDom[1]) !== nDom) problems.push('README 写的集成用例数（' + mDom[1] + '）与实际（' + nDom + '）不一致');

/* 结果 */
console.log('');
if (problems.length) {
  console.log('发现 ' + problems.length + ' 个问题：');
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('自检通过 ✅  (文件 ' + files.length + ' 个 · 脚本 ' + scripts.length + ' 个 · 用例 ' + (nUnit + nDom) + ' 条)');

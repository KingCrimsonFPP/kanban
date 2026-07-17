const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban.proj#178 follow-up: minimal inline formatting for card bodies -----
// **bold** -> <strong>, `code` -> <code>. Nothing else (no headings, lists,
// links, or nesting inside a matched span); unmatched/unclosed markers render
// literally. The viewer has no separate viewer/*.js file to require() (all its
// JS lives inline in build_editor.py's TEMPLATE string) and no pre-existing
// test suite, so this file starts one, using the same extract-then-assert
// technique skills/web/test/notifications.test.js already uses for app.js's
// non-require-able DOM code: read the .py source as text and pull the
// function bodies out by brace-balanced scanning. Neither new function uses
// any character Python string-escapes (no backslashes), so the raw .py bytes
// ARE valid JS for this slice — extracting straight from source, not a
// generated HTML build, keeps the suite fast and dependency-free. fmtBodySegs
// is pure, so it gets real behavioral unit tests via `new Function`; bodyNode
// touches the DOM, so it gets the same source-level innerHTML-ban pin
// notifications.test.js uses for renderNotifList.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in build_editor.py`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i);
}

const fmtBodySegsSrc = extractFunction('fmtBodySegs');
const bodyNodeSrc = extractFunction('bodyNode');
const fmtBodySegs = new Function(`return (${fmtBodySegsSrc});`)();

test('fmtBodySegs: plain text with no markers is a single text segment', () => {
  assert.deepStrictEqual(fmtBodySegs('hello world'), [{ t: 'text', v: 'hello world' }]);
});

test('fmtBodySegs: empty string yields no segments', () => {
  assert.deepStrictEqual(fmtBodySegs(''), []);
});

test('fmtBodySegs: **bold** becomes a bold segment, markers stripped', () => {
  assert.deepStrictEqual(fmtBodySegs('**bold**'), [{ t: 'bold', v: 'bold' }]);
});

test('fmtBodySegs: `code` becomes a code segment, markers stripped', () => {
  assert.deepStrictEqual(fmtBodySegs('`code`'), [{ t: 'code', v: 'code' }]);
});

test('fmtBodySegs: a narrative-shaped bullet mixes a bold lead-in, plain text, and backticked identifiers', () => {
  assert.deepStrictEqual(
    fmtBodySegs('**Fixed the bug.** Root cause was `card-store.js` mishandling `waiting_for`.'),
    [
      { t: 'bold', v: 'Fixed the bug.' },
      { t: 'text', v: ' Root cause was ' },
      { t: 'code', v: 'card-store.js' },
      { t: 'text', v: ' mishandling ' },
      { t: 'code', v: 'waiting_for' },
      { t: 'text', v: '.' },
    ],
  );
});

test('fmtBodySegs: an unclosed ** renders literally, stars included', () => {
  assert.deepStrictEqual(fmtBodySegs('half **bold with no close'),
    [{ t: 'text', v: 'half **bold with no close' }]);
});

test('fmtBodySegs: an unclosed backtick renders literally, backtick included', () => {
  assert.deepStrictEqual(fmtBodySegs('started `a code span that never closes'),
    [{ t: 'text', v: 'started `a code span that never closes' }]);
});

test('fmtBodySegs: markers do not nest — a backtick inside a bold span stays literal text, not a code span', () => {
  assert.deepStrictEqual(fmtBodySegs('**`literal`**'), [{ t: 'bold', v: '`literal`' }]);
});

test('fmtBodySegs: markers do not nest the other way either — ** inside a code span stays literal text', () => {
  assert.deepStrictEqual(fmtBodySegs('`**literal**`'), [{ t: 'code', v: '**literal**' }]);
});

test('fmtBodySegs: adjacent marked spans with no gap between them both format', () => {
  assert.deepStrictEqual(fmtBodySegs('**a****b**'), [{ t: 'bold', v: 'a' }, { t: 'bold', v: 'b' }]);
});

test('fmtBodySegs: a lone unmatched backtick after a closed code span rejoins the trailing text', () => {
  assert.deepStrictEqual(fmtBodySegs('`a` and `b'),
    [{ t: 'code', v: 'a' }, { t: 'text', v: ' and `b' }]);
});

test('fmtBodySegs: newlines inside plain text survive untouched (line structure stays pre-wrap plain text)', () => {
  assert.deepStrictEqual(fmtBodySegs('line one\nline two'), [{ t: 'text', v: 'line one\nline two' }]);
});

// --- render-path guard: card bodies must be built via textContent, never innerHTML ---

test('bodyNode builds the card-body div out of el()/textContent nodes for every segment type, never innerHTML', () => {
  assert.match(bodyNodeSrc, /el\("div","bodytxt"\)/);
  assert.match(bodyNodeSrc, /el\("strong"/);
  assert.match(bodyNodeSrc, /el\("code"/);
  assert.match(bodyNodeSrc, /createTextNode/);
  assert.ok(!bodyNodeSrc.includes('innerHTML'), 'card body text must never be string-built HTML');
});

test('the card-sheet render path calls bodyNode(c.body) instead of dumping raw text straight into the bodytxt div', () => {
  assert.match(src, /d\.appendChild\(bodyNode\(c\.body\)\)/);
});

test('the .bodytxt code CSS rule is monospace and theme-consistent with the rest of the viewer', () => {
  assert.match(src, /\.bodytxt code\{[^}]*font-family:[^}]*monospace[^}]*\}/);
});

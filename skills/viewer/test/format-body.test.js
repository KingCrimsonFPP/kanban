const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- Minimal inline formatting for card bodies --------------------------------
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

test('fmtBodySegs: a triple-star run (***bold***) is not a valid 2-star marker — the extra stars fall through as literal text flanking a clean bold span, not glued inside it', () => {
  assert.deepStrictEqual(fmtBodySegs('***bold***'), [
    { t: 'text', v: '*' },
    { t: 'bold', v: 'bold' },
    { t: 'text', v: '*' },
  ]);
});

test('fmtBodySegs: a triple-backtick-adjacent run of stars only on the closing side still leaves the trailing star literal', () => {
  assert.deepStrictEqual(fmtBodySegs('**bold***'), [
    { t: 'bold', v: 'bold' },
    { t: 'text', v: '*' },
  ]);
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

// --- responsive layout: two width tiers + a capability query -----------------
// Tier 1 (560-899px) only bumps #scroll's max-width — the base (unreached
// below 560px) rule keeps phone widths pixel-identical. Tier 2 (>=900px)
// turns the board into a side-by-side column strip and centers modals.
// hnav hides on a (hover:hover) and (pointer:fine) CAPABILITY query, not a
// width breakpoint, so touch devices keep it regardless of screen size.

function extractStyleBlock() {
  const start = src.indexOf('<style>');
  const end = src.indexOf('</style>');
  assert.ok(start !== -1 && end !== -1, '<style> block not found');
  return src.slice(start + '<style>'.length, end);
}

function extractMediaBlocks(css) {
  const blocks = [];
  let idx = 0;
  while ((idx = css.indexOf('@media', idx)) !== -1) {
    const braceStart = css.indexOf('{', idx);
    let depth = 0, i = braceStart;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    blocks.push(css.slice(idx, i));
    idx = i;
  }
  return blocks;
}

const css = extractStyleBlock();
const mediaBlocks = extractMediaBlocks(css);
const nonMediaCss = mediaBlocks.reduce((acc, b) => acc.split(b).join(''), css);

test('the base (unconditional) #scroll rule keeps max-width:560px — phone widths below the first breakpoint stay pixel-identical', () => {
  assert.match(nonMediaCss, /#scroll\{[^}]*max-width:560px[^}]*\}/);
});

test('tier 1 (min-width:560px): #scroll max-width grows to ~720px, nothing else changes', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:560px\)/.test(b));
  assert.ok(block, 'no @media(min-width:560px) block found');
  assert.match(block, /#scroll\{max-width:720px\}/);
  // Single, narrowly-scoped rule — this tier touches #scroll only.
  assert.strictEqual((block.match(/\{/g) || []).length, 2, 'tier 1 should only style #scroll');
});

test('tier 2 (min-width:900px): board becomes a flex column strip with min-width ~260px', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.ok(block, 'no @media(min-width:900px) block found');
  assert.match(block, /#board\{[^}]*display:flex[^}]*\}/);
  assert.match(block, /\.boardcol\{[^}]*min-width:260px[^}]*flex:[^}]*\}/);
});

test('tier 2: a collapsed section narrows into a strip instead of holding the full min-width', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /\.boardcol\.collapsed\{[^}]*\}/);
});

test('tier 2: modals center with a ~640px cap instead of sheeting up from the bottom', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /#modal\{[^}]*align-items:center[^}]*\}/);
  assert.match(block, /#modalscroll\{[^}]*max-width:640px[^}]*\}/);
});

test('hnav hides on a (hover:hover) and (pointer:fine) capability query, not a width breakpoint', () => {
  const block = mediaBlocks.find(b => /^@media\(hover:hover\)/.test(b));
  assert.ok(block, 'no @media(hover:hover) block found');
  assert.match(block, /and\s*\(pointer:fine\)/);
  assert.match(block, /\.hnav\{display:none\}/);
  assert.ok(!/min-width|max-width/.test(block), 'hnav must hide on pointer/hover capability, never on viewport width');
});

test('the scroll-button stack CSS (#scrollbtns and its buttons) is never nested inside any @media block, at any width', () => {
  assert.match(nonMediaCss, /#scrollbtns\{/, '#scrollbtns should have unconditional CSS');
  assert.match(nonMediaCss, /#scrollbtns button\{/, '#scrollbtns button should have unconditional CSS');
  mediaBlocks.forEach(block => {
    assert.ok(!block.includes('scrollbtns'), '#scrollbtns must not appear inside a @media block');
  });
  // Every individual button id in the stack (#sup/#sdn/#stop/#sbot/#snew/
  // #sarch/#sdel/#mclose/#smore) is styled generically via "#scrollbtns
  // button" and shown/hidden by JS (syncStack), not by per-id CSS — so the
  // stronger, simpler invariant is just that none of them is ever
  // referenced from inside a @media block either.
  ['#sup', '#sdn', '#stop', '#sbot', '#snew', '#sarch', '#sdel', '#mclose', '#smore'].forEach(sel => {
    mediaBlocks.forEach(block => {
      assert.ok(!block.includes(sel), `${sel} must not appear inside a @media block`);
    });
  });
});

test("render() wraps each board section (header + cards) in a .boardcol container at every width, so tier 2's CSS can column-ize it without touching the DOM shape below 900px", () => {
  const matches = src.match(/el\("div","boardcol"/g) || [];
  assert.strictEqual(matches.length, 2, 'expected one .boardcol wrapper for status columns and one for the archive section');
  assert.match(src, /el\("div","colcards"\)/);
});

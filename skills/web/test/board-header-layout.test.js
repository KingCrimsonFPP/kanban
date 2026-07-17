const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban.proj #207: equal-length board columns + fixed page/column headers -
// Two independent CSS-only requirements pinned as structure tests (same
// convention as status-colors.test.js): (1) every board column stretches to
// the row's tallest member, regardless of its own card count; (2) the page
// header and each column's own header stay on screen while the page scrolls
// past a tall board, via position: sticky. A third piece (app.js keeping the
// sticky column header's offset in sync with the page header's real height)
// is pinned as a JS structure test since jsdom isn't wired into this suite.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');

test('main#board stretches its columns to equal height instead of sizing each to its own content', () => {
  assert.match(css, /main#board\s*\{[^}]*align-items:\s*stretch/, 'align-items: stretch replaces the old flex-start');
  assert.doesNotMatch(css, /main#board\s*\{[^}]*align-items:\s*flex-start/, 'the old per-column sizing rule is gone');
});

test('the page header is sticky to the viewport top, opaque, and layered above ordinary board content', () => {
  assert.match(css, /header\s*\{[^}]*position:\s*sticky/, 'header sticks');
  assert.match(css, /header\s*\{[^}]*top:\s*0/, 'sticks to the very top');
  assert.match(css, /header\s*\{[^}]*background:\s*#0d1117/, 'opaque background — matches <body> so scrolled cards do not show through');
  const zMatch = css.match(/header\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(zMatch, 'header declares a z-index');
  assert.ok(Number(zMatch[1]) < 30, 'header stacks below the modal backdrop (30) so popups still overlay it');
});

test('each column header is sticky, parked below the page header via the shared CSS var, and opaque', () => {
  assert.match(css, /\.column-header\s*\{[^}]*position:\s*sticky/, 'column header sticks');
  assert.match(css, /\.column-header\s*\{[^}]*top:\s*var\(--board-header-h/, 'offset comes from the shared --board-header-h var, not a guessed fixed px');
  assert.match(css, /\.column-header\s*\{[^}]*background:\s*#161b22/, 'opaque background — matches .column so scrolled cards do not show through');
  const headerZ = Number(css.match(/header\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  const colHeaderZ = Number(css.match(/\.column-header\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  assert.ok(colHeaderZ < headerZ, 'column header stacks below the page header so the two never fight while both are stuck');
});

test('--board-header-h has a sane CSS fallback for the instant before app.js\'s first measurement runs', () => {
  const m = css.match(/\.column-header\s*\{[^}]*top:\s*var\(--board-header-h,\s*(\d+)px\)/);
  assert.ok(m, 'a var() fallback value is present');
  assert.ok(Number(m[1]) > 0, 'fallback is a positive pixel value');
});

test('app.js defines syncBoardHeaderHeight, publishing the page header\'s real rendered height as --board-header-h', () => {
  assert.match(appJs, /function syncBoardHeaderHeight\s*\(/, 'the sync function exists');
  assert.match(appJs, /setProperty\(\s*['"]--board-header-h['"]/, 'it writes the exact CSS var app.css consumes');
  assert.match(appJs, /header\.offsetHeight/, 'it measures the header\'s real rendered height, not a guess');
});

test('syncBoardHeaderHeight is wired at DOMContentLoaded (static markup, no need to wait on the board fetch) and kept live via ResizeObserver', () => {
  assert.match(appJs, /DOMContentLoaded[\s\S]*?syncBoardHeaderHeight\(\)/, 'called eagerly at DOMContentLoaded');
  assert.match(appJs, /ResizeObserver\(syncBoardHeaderHeight\)\.observe\(headerEl\)/, 'kept current across wraps/resizes via ResizeObserver');
  assert.match(appJs, /window\.addEventListener\(\s*['"]resize['"]\s*,\s*syncBoardHeaderHeight\)/, 'falls back to a resize listener when ResizeObserver is unavailable');
});

// --- other views must be untouched (card ask: "other views must be unaffected") -

test('the sticky/stretch board-layout rules never touch #map-view/#calendar-view/#gantt-view', () => {
  for (const sel of ['.map-view', '.calendar-view', '.gantt-view']) {
    const rule = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*\\}`);
    const m = css.match(rule);
    assert.ok(m, `${sel} still has its own rule block`);
    assert.doesNotMatch(m[0], /position:\s*sticky/, `${sel} did not gain a sticky rule from this card`);
  }
});

test('app.html loads app.js after the header markup exists, so syncBoardHeaderHeight can measure it synchronously', () => {
  assert.ok(appHtml.indexOf('<header>') < appHtml.indexOf('<script src="/app.js">'), 'header markup precedes the app.js script tag');
});

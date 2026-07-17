const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban.proj #209: theme every visible scrollbar to match the dark page
// palette instead of default OS chrome (follow-up to #207's per-column
// scroll containers) --------------------------------------------------
// CSS-only, so pinned as structure tests against app.css's source text (same
// convention as status-colors.test.js / board-header-layout.test.js): every
// scrollable surface the app owns gets both the Firefox properties
// (scrollbar-width/scrollbar-color) and the Chromium/Edge pseudo-elements
// (::-webkit-scrollbar*), reusing existing palette hexes rather than
// introducing a new color family.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

// Every scrollable container the card calls out: the page itself, #207's
// per-column vertical lists and horizontal board strip, popup/modal scroll
// areas, the gantt/map horizontal scrollers, and the calendar hour grid.
const SCROLL_SELECTORS = [
  'html',
  'main#board',
  '.column-cards',
  '.modal',
  '.detail-body pre',
  '.map-view',
  '.gantt-scroll',
  '.cal-tg-scroll',
];

function escapeSelector(sel) {
  return sel.replace(/[.#]/g, '\\$&');
}

// A selector's rule may sit anywhere in a shared comma-separated group, so
// each match is anchored on the selector followed by either `,` (another
// selector follows) or `{` (it's the last one before the declaration block).
function selectorMatches(selector, property, valueFragment) {
  const escaped = escapeSelector(selector);
  const rule = new RegExp(`${escaped}\\s*[,{][\\s\\S]{0,600}?${property}:\\s*${valueFragment}`);
  return rule.test(css);
}

test('every scrollable surface sets Firefox scrollbar-width/scrollbar-color, thin and reusing an existing border tone', () => {
  for (const sel of SCROLL_SELECTORS) {
    assert.ok(selectorMatches(sel, 'scrollbar-width', 'thin'), `${sel} is in the scrollbar-width: thin group`);
  }
  assert.match(css, /scrollbar-color:\s*#30363d\s+transparent/, 'thumb reuses the existing #30363d border tone; track is transparent so it blends into whatever surface it sits on');
});

test('every scrollable surface gets the Chromium/Edge ::-webkit-scrollbar treatment (primary target incl. VSCode Simple Browser)', () => {
  for (const sel of SCROLL_SELECTORS) {
    const escaped = escapeSelector(sel);
    assert.match(css, new RegExp(`${escaped}::-webkit-scrollbar\\s*[,{]`), `${sel}::-webkit-scrollbar is styled`);
    assert.match(css, new RegExp(`${escaped}::-webkit-scrollbar-thumb\\s*[,{]`), `${sel}::-webkit-scrollbar-thumb is styled`);
  }
});

test('the webkit scrollbar is slim (narrower than the ~17px OS default) and the thumb brightens on hover without a new hex family', () => {
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width:\s*8px/, 'width is slim');
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*height:\s*8px/, 'height is slim (horizontal scrollers: main#board, .gantt-scroll)');
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*#30363d/, 'thumb rests at the existing border tone');
  assert.match(css, /::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*#6e7681/, 'thumb hover brightens to the existing muted-text tone — still no new hex');
});

test('the webkit scrollbar track is transparent, not a hardcoded fill (containers sit on different backgrounds: page #0d1117 vs column/modal/map/gantt #161b22)', () => {
  assert.match(css, /::-webkit-scrollbar-track\s*[,{][\s\S]{0,600}?background:\s*transparent/, 'track blends into whichever surface it is over');
});

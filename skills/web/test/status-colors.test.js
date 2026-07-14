const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  BUILTIN_STATUS_COLORS, STATUS_PALETTE, ARCHIVE_COLOR, EPIC_COLOR, isBuiltinStatus, statusColor, statusColorClass, statusColorSoft, epicBadge, statusBadge, archivedBadge,
} = require('../web/status-colors');

// --- card #31: deterministic status coloring for dynamic columns -------------

test('the built-in four keep their fixed board palette — backlog cyan since card #57', () => {
  assert.strictEqual(statusColor('backlog'), '#39c5cf'); // card #57: was grey #8b949e, read as archived
  assert.strictEqual(statusColor('todo'), '#58a6ff');
  assert.strictEqual(statusColor('doing'), '#3fb950');
  assert.strictEqual(statusColor('done'), '#a371f7');
});

test('STATUS_PALETTE has 8 distinct colors', () => {
  assert.strictEqual(STATUS_PALETTE.length, 8);
  assert.strictEqual(new Set(STATUS_PALETTE).size, 8);
});

test('a custom status hashes deterministically into the fixed 8-color palette', () => {
  const c1 = statusColor('review');
  assert.strictEqual(statusColor('review'), c1); // pure: same input, same output
  assert.ok(STATUS_PALETTE.includes(c1));
});

test('statusColor is case/whitespace-insensitive so hand-typed variants color alike', () => {
  assert.strictEqual(statusColor(' Review '), statusColor('review'));
  assert.strictEqual(statusColor('TODO'), '#58a6ff'); // built-in by name, any casing
});

test('statusColor never throws on hostile names (proto keys, empty, non-string)', () => {
  const legal = STATUS_PALETTE.concat(Object.values(BUILTIN_STATUS_COLORS));
  for (const s of ['constructor', '__proto__', 'hasOwnProperty', '', null, undefined, 42]) {
    assert.ok(legal.includes(statusColor(s)), `statusColor(${JSON.stringify(s)}) returned a non-palette value`);
  }
});

test('statusColorSoft is the same hue at 12% alpha — matches the gantt CSS for the built-ins', () => {
  assert.strictEqual(statusColorSoft('backlog'), 'rgba(57, 197, 207, 0.12)');
  assert.strictEqual(statusColorSoft('todo'), 'rgba(88, 166, 255, 0.12)');
  assert.strictEqual(statusColorSoft('doing'), 'rgba(63, 185, 80, 0.12)');
  assert.strictEqual(statusColorSoft('done'), 'rgba(163, 113, 247, 0.12)');
});

test('statusColorSoft of a custom status derives from its statusColor hex', () => {
  const hex = statusColor('review');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.strictEqual(statusColorSoft('review'), `rgba(${r}, ${g}, ${b}, 0.12)`);
});

test('isBuiltinStatus recognizes only the four (archive is a location, not a status)', () => {
  assert.ok(isBuiltinStatus('todo'));
  assert.ok(isBuiltinStatus('Done'));
  assert.ok(!isBuiltinStatus('archive'));
  assert.ok(!isBuiltinStatus('review'));
  assert.ok(!isBuiltinStatus(''));
});

// --- card #57: backlog vs archive must separate at a glance -------------------

test('ARCHIVE_COLOR is a neutral grey no built-in status shares (card #57)', () => {
  assert.strictEqual(ARCHIVE_COLOR, '#6e7681');
  // Neutral means near-grey: the RGB channels sit within a narrow band.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(ARCHIVE_COLOR.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 30, 'archive grey drifted into a hue');
  for (const [status, hex] of Object.entries(BUILTIN_STATUS_COLORS)) {
    assert.notStrictEqual(hex, ARCHIVE_COLOR, `${status} wears the archive grey`);
  }
});

test('backlog carries real hue — never a grey mistakable for archive (card #57)', () => {
  // The old backlog #8b949e sat one shade from archive's #6e7681 — the whole
  // card. Guard the PROPERTY, not just today's hex: a near-grey has a small
  // channel spread (the old value's was 19), a real hue a wide one.
  const hex = statusColor('backlog');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert.ok(spread > 60, `backlog ${hex} is near-grey (channel spread ${spread})`);
});

test("statusColor('archive') mutes to the neutral grey instead of hashing loud (card #57)", () => {
  // Archive is a location, so no column is ever named this — but an unlisted
  // on-disk `status: archive` is legal (cards are never validated) and must
  // read archived, not like a random accent-colored custom column.
  assert.strictEqual(statusColor('archive'), ARCHIVE_COLOR);
  assert.strictEqual(statusColor(' Archive '), ARCHIVE_COLOR);
  assert.strictEqual(statusColorSoft('archive'), 'rgba(110, 118, 129, 0.12)');
  assert.ok(!isBuiltinStatus('archive')); // still a location, not a status
});

test("statusColor('archived') mutes the same way — it's the folder's own name, the likelier hand-typed value (card #57)", () => {
  // Same never-validated rationale as 'archive' above, applied to the spelling
  // the kanban/archived/ folder actually teaches. It used to fall through to
  // the hash and land on done's exact purple — an effectively-archived card
  // read "done" while its sibling spelling read muted grey.
  assert.strictEqual(statusColor('archived'), ARCHIVE_COLOR);
  assert.strictEqual(statusColor(' Archived '), ARCHIVE_COLOR);
  assert.ok(!isBuiltinStatus('archived'));
});

test('no hashable palette slot is near-grey or the archive grey — grey means archived and NOTHING else (card #57)', () => {
  // The card ceded grey to archive, but the 8-slot hash palette kept the old
  // backlog grey #8b949e — 'review', 'frozen', 'icebox' all hashed one shade
  // from ARCHIVE_COLOR, reproducing for custom columns the exact confusion the
  // card was opened to kill. Guard the PROPERTY (channel spread, same measure
  // as the backlog test above), not just the evicted hex.
  assert.ok(!STATUS_PALETTE.includes('#8b949e'), 'the old backlog grey is out of the hash palette');
  for (const hex of STATUS_PALETTE) {
    assert.notStrictEqual(hex, ARCHIVE_COLOR, 'a hashed status must never wear the archive grey');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread > 60, `palette ${hex} is near-grey (channel spread ${spread}) — would read archived`);
  }
});

// --- card #59: the epic/wayfinder orange — reserved among the fixed colors ----

test('EPIC_COLOR is orange and no built-in status (or archive) wears it (card #59)', () => {
  assert.strictEqual(EPIC_COLOR, '#f0883e');
  for (const [status, hex] of Object.entries(BUILTIN_STATUS_COLORS)) {
    assert.notStrictEqual(hex, EPIC_COLOR, `${status} wears the epic orange`);
  }
  assert.notStrictEqual(ARCHIVE_COLOR, EPIC_COLOR);
});

// --- card #91: the epic border REPLACED by one shared dot glyph --------------

test('epicBadge is the one shared HTML glyph — an orange dot with an "Epic" tooltip (card #91)', () => {
  const html = epicBadge();
  assert.match(html, /class="epic-dot"/);
  assert.match(html, /title="Epic"/);
});

test('app.css paints ONE shared epic-dot glyph (card #91) — #59\'s four per-view borders are gone', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.epic-dot\s*\{[^}]*background:\s*#f0883e/, 'the shared HTML dot carries EPIC_COLOR');
  assert.ok(css.includes(`.map-epic-dot { fill: ${EPIC_COLOR};`), 'the map node has its own SVG twin, same color');
  // card #151: the membership edge + its arrowhead wear the same orange
  assert.ok(css.includes(`.map-edge.epic-edge { stroke: ${EPIC_COLOR};`), 'membership edge carries EPIC_COLOR');
  assert.ok(css.includes(`.map-edge.epic-chain { stroke: ${EPIC_COLOR}; }`), 'v3: the intra-epic chain edge carries EPIC_COLOR solid');
  assert.ok(css.includes(`.map-arrow-epic-head { fill: ${EPIC_COLOR}; }`), 'its arrowhead too');
  // #59's orange BORDER rules are gone from all four surfaces — nothing left
  // to layer or to gate priority/blocked/due around.
  assert.ok(!css.includes('.card.epic'), 'board tile border rule removed');
  assert.ok(!css.includes('.map-node.epic'), 'map node stroke rule removed');
  assert.ok(!css.includes('.gantt-bar.epic'), 'gantt bar border rule removed');
  assert.ok(!css.includes('.cal-chip.epic'), 'calendar chip border rule removed');
});

test('the map node border is one neutral weight for every status (card #91) — status moved to its own dot', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.map-node rect\s*\{[^}]*stroke:\s*#30363d/, 'one neutral stroke color, not per-status');
  for (const status of ['backlog', 'todo', 'doing', 'done', 'unknown']) {
    assert.ok(!css.includes(`.map-node.status-${status} rect`), `no more per-status rect stroke rule: ${status}`);
  }
  // Untouched by #91: selection glow, ghost dashing, the back-edge amber, and
  // archive's own border mute all keep their existing treatments.
  assert.match(css, /\.map-node\.selected\s*\{[^}]*filter:\s*drop-shadow/, 'selection glow untouched');
  assert.match(css, /\.map-node\.ghost rect\s*\{[^}]*stroke-dasharray/, 'ghost-stub dashing untouched');
  assert.match(css, /\.map-edge\.back-edge\s*\{[^}]*stroke:\s*#d29922/, 'cycle back-edge amber untouched');
  assert.ok(css.includes(`.map-node.archived rect { stroke: ${ARCHIVE_COLOR};`), 'archive dimming (the border exception) untouched');
});

// --- card #107: map node priority/waiting border — parity with the board
// tile (epic #137 renamed #107's amber "blocked" stroke to waiting; the
// manual blocked sticker is a red pill, not a border)

// verify finding: every other SKILL.md prose paragraph documenting a border/
// dot feature (card #97/#101/#102/#99) gets a phrase-pinning doc test here or
// in status-pill-docs.test.js, specifically to catch silent drift — #107's
// new bullet was missing one. Pinning it the same way.
test('SKILL.md documents the map node\'s priority/waiting border, citing card #107 (renamed by epic #137)', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const bullet = skill.match(/\*\*Card #107 — priority\/waiting border, board-tile parity:\*\*[\s\S]*?(?=\n  A \*\*status-filter row\*\*)/);
  assert.ok(bullet, 'the card #107 addendum exists in the Dependency map section, renamed to waiting');
  assert.match(bullet[0], /#f85149/, 'names the red high-priority color');
  assert.match(bullet[0], /#d29922/, 'names the amber waiting color');
  assert.match(bullet[0], /[Ww]aiting\s+wins over high/, 'states the declaration-order precedence rule');
  assert.match(bullet[0], /never gets the priority\/waiting stroke/, 'states the archived-mutual-exclusivity rule explicitly');
  assert.match(bullet[0], /red pill/, 'routes the manual blocked sticker to the pill, not the border channel');
  assert.ok(!bullet[0].includes('blocked_by'), 'no stale blocked_by vocabulary survives in the bullet');
});

test('.map-node.high/.waiting rect strokes match the board tile\'s red/amber exactly (card #107, renamed by epic #137)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.card\.high\s*\{[^}]*border-left:\s*3px solid #f85149/, 'board tile high-priority red (reference)');
  assert.match(css, /\.card\.waiting\s*\{[^}]*border-left:\s*3px solid #d29922/, 'board tile waiting amber (reference — epic #137 renamed the old blocked visual slot)');
  assert.match(css, /\.map-node\.high rect\s*\{[^}]*stroke:\s*#f85149/, 'map node reuses the same red for high priority');
  assert.match(css, /\.map-node\.waiting rect\s*\{[^}]*stroke:\s*#d29922/, 'map node reuses the same amber for waiting');
  // Declaration order: .waiting must come after .high, same convention as
  // .card.high/.card.waiting, so waiting wins the cascade when both apply.
  assert.ok(css.indexOf('.map-node.high rect') < css.indexOf('.map-node.waiting rect'), 'waiting declared after high');
  // epic #137: the amber slot belongs to waiting alone now — no surface keeps
  // a .blocked border/accent rule (the sticker is a pill, not a border).
  for (const stale of ['.card.blocked', '.map-node.blocked', '.cal-chip.blocked', '.gantt-bar.blocked']) {
    assert.ok(!css.includes(stale), `${stale} rule removed — renamed to .waiting`);
  }
});

test('the blocked sticker\'s red pill is styled on both surfaces it shows (tiles + map), same red as high priority (epic #137)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.blocked-pill\s*\{[^}]*border:\s*1px solid #f85149/, 'board tile pill — red border');
  assert.match(css, /\.blocked-pill\s*\{[^}]*color:\s*#f85149/, 'board tile pill — red text');
  assert.match(css, /\.map-blocked-pill rect\s*\{[^}]*stroke:\s*#f85149/, 'map SVG pill twin — same red');
  assert.match(css, /\.map-blocked-pill text\s*\{[^}]*fill:\s*#f85149/, 'map SVG pill text — same red');
  assert.match(css, /#f-blocked\.blocked-active\s*\{[^}]*border-color:\s*#f85149/, 'edit form input goes red only while the value passes the predicate');
});

// --- card #97: the shared HTML status dot, joining epicBadge() everywhere --

test('statusBadge colors a built-in status via a status-dot--* class, never inline style (card #97, revised card #49 verify finding)', () => {
  // card #49 verify finding: this used to write `style="background:..."` —
  // a literal inline-style HTML attribute — which a strict `style-src 'self'`
  // CSP (no unsafe-inline) blocks the browser from applying at all, rendering
  // every status dot colorless. It now writes a class (app.css's
  // `.status-dot--*` rules carry the actual color), so CSP has nothing to break.
  const html = statusBadge({ status: 'doing', archived: false });
  assert.match(html, /class="status-dot status-dot--doing"/);
  assert.doesNotMatch(html, /style=/, 'no inline style attribute anywhere — CSP style-src has no channel to break');
  assert.match(html, /title="doing"/);
});

test('statusBadge hashes a custom status into the same palette slot statusColorClass/statusColor agree on (card #97)', () => {
  const html = statusBadge({ status: 'review', archived: false });
  assert.match(html, new RegExp(`class="status-dot status-dot--${statusColorClass('review')}"`));
  assert.ok(statusColorClass('review').startsWith('palette-'), 'a non-built-in status hashes into the palette bucket, not a fixed name');
  assert.match(html, /title="review"/);
});

test('statusBadge NEVER mutes for an archived card — the true status color always wins (card #102 reopen)', () => {
  // card #102 reopen (locked design rule: STATUS DOTS NEVER MUTE): a headless
  // measurement of the real board found 18 map nodes, ALL archived-done, ALL
  // grey — archived chains dominate any mature board's map forever, so muting
  // the status dot emptied the dot channel of the exact information it exists
  // to carry. The archived cue now lives ONLY in the tile's dimmed body/grey
  // border, the "(archived)" tooltip, and ghost/selection treatments.
  const html = statusBadge({ status: 'doing', archived: true });
  assert.match(html, /class="status-dot status-dot--doing"/);
  assert.match(html, /title="doing"/);
});

test('statusBadge still mutes when the RAW on-disk status is the literal "archive"/"archived" string — that IS its true status color, archived flag or not (card #102 reopen)', () => {
  // Rule #4 of the reopen: the literal on-disk statuses keep ARCHIVE_COLOR —
  // that genuinely is statusColor's mapping for those names (card #57),
  // untouched by the "dots never mute" rule, which is about the `archived`
  // FLAG, not these two literal spellings.
  assert.match(statusBadge({ status: 'archive', archived: false }), /class="status-dot status-dot--archive"/);
  assert.match(statusBadge({ status: 'archived', archived: true }), /class="status-dot status-dot--archive"/);
});

test('statusBadge escapes hostile on-disk status text in the tooltip attribute (card #97)', () => {
  const html = statusBadge({ status: '"><script>x</script>', archived: false });
  assert.doesNotMatch(html, /<script>x<\/script>"/);
  assert.match(html, /title="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
});

// --- card #102 REOPEN: "wrong colors for done status" — the first pass called
// this working-as-designed (archive-mute wins over the status color on dots).
// A headless measurement of the real board overturned that: the map graph
// rendered 18 nodes, ALL archived-done, ALL grey — archived chains dominate
// any mature board's map forever, so muting the status dot emptied the dot
// channel of the exact information it exists to carry. NEW LOCKED RULE:
// STATUS DOTS NEVER MUTE — a dot always shows the card's true status color,
// on every surface. The archived cue moves entirely to the tile's dimmed
// body/grey border, the "(archived)" tooltip, and ghost/selection treatments.

test('statusBadge: a done card is done-purple whether live OR archived — the exact pair card #102 originally reported, now fixed instead of excused (card #102 reopen)', () => {
  const live = statusBadge({ status: 'done', archived: false });
  assert.match(live, /class="status-dot status-dot--done"/, 'a live done card keeps done\'s purple');
  const archived = statusBadge({ status: 'done', archived: true });
  assert.match(archived, /class="status-dot status-dot--done"/, 'an archived done card ALSO keeps done\'s purple — the dot never mutes (card #102 reopen)');
});

test('the map SVG dot carries NO archived-mute CSS override — every built-in status keeps its own fill on an archived node, "done" included (card #102 reopen)', () => {
  // buildMapSvg (app.js) emits the SAME class="map-status-dot status-<x>" for
  // a node whether or not it's archived. Card #102's first pass relied on a
  // higher-specificity `.map-node.archived .map-status-dot` rule to mute that
  // dot grey; the reopen removes that rule entirely so the per-status fill
  // always wins, on every surface, with no specificity contest left to referee.
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.ok(!css.includes('.map-node.archived .map-status-dot'), 'the archived status-dot mute rule is gone — status dots never mute (card #102 reopen)');
  for (const [status, hex] of Object.entries(BUILTIN_STATUS_COLORS)) {
    const statusSelector = `.map-status-dot.status-${status}`;
    assert.ok(css.includes(`${statusSelector} { fill: ${hex};`), `map-dot rule present: ${status}`);
  }
  // The archived cue lives ONLY in the node's rect border now (the "one
  // exception" #91/#102 both name) — untouched by this reopen.
  assert.ok(css.includes(`.map-node.archived rect { stroke: ${ARCHIVE_COLOR};`), 'archived border mute (the one exception) stays');
});

test('statusBadge tolerates a missing/null status without throwing (card #97)', () => {
  assert.doesNotThrow(() => statusBadge({ status: null, archived: false }));
  assert.doesNotThrow(() => statusBadge({}));
});

test('app.css paints a shape-only .status-dot rule, plus one .status-dot--* color rule per statusColorClass() outcome — no inline style (card #97, revised card #49 verify finding)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.status-dot\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;[^}]*border-radius:\s*50%/,
    'same 8px dot shape as .epic-dot');
  for (const [status, hex] of Object.entries(BUILTIN_STATUS_COLORS)) {
    assert.ok(css.includes(`.status-dot--${status} { background: ${hex};`), `status-dot color class present: ${status}`);
  }
  assert.ok(css.includes(`.status-dot--archive { background: ${ARCHIVE_COLOR};`), 'status-dot color class present: archive');
  STATUS_PALETTE.forEach((hex, i) => {
    assert.ok(css.includes(`.status-dot--palette-${i} { background: ${hex};`), `status-dot color class present: palette-${i}`);
  });
});

test('an epic dot immediately followed by a status dot gets a gap — the two 8px circles must not render fused (verify finding)', () => {
  // On the two dense surfaces without .card-head's flex gap (calendar chips,
  // gantt gutter labels), epicBadge()+statusBadge() are emitted with zero
  // whitespace between them and neither .epic-dot nor .status-dot carries a
  // margin — an epic card whose status is also circular (e.g. 'doing')
  // renders as one fused two-color blob with no visual separator.
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.epic-dot \+ \.status-dot\s*\{[^}]*margin-left:\s*4px/,
    'an adjacent-sibling rule restores a gap between the two dots wherever they land back-to-back, board tile\'s flex gap included');
});

// --- card #102 final design: "show the status color as shown in the
// frontmatter and an additional ball gray for archived" — a THIRD shared dot
// glyph, ARCHIVE_COLOR grey, joining epicBadge()/statusBadge() on every
// ARCHIVED-card surface only. Live cards never render it (cardEl/
// calendarChipEl never call it — pinned as served-asset absence tests in
// server.test.js). Order picked and applied everywhere it appears in
// sequence: epic, status, archived.

test('archivedBadge is the shared HTML glyph — a grey dot with an "Archived" tooltip (card #102 final design)', () => {
  const html = archivedBadge();
  assert.match(html, /class="archived-dot"/);
  assert.match(html, /title="Archived"/);
});

test('app.css paints the archived-dot glyph in ARCHIVE_COLOR, same 8px shape, plus its map SVG twin (card #102 final design)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, new RegExp(`\\.archived-dot\\s*\\{[^}]*width:\\s*8px;[^}]*height:\\s*8px;[^}]*border-radius:\\s*50%;[^}]*background:\\s*${ARCHIVE_COLOR}`),
    'the shared HTML dot is the same 8px shape as epic-dot/status-dot, carrying ARCHIVE_COLOR');
  assert.ok(css.includes(`.map-archived-dot { fill: ${ARCHIVE_COLOR};`), 'the map node has its own SVG twin, same grey');
});

test('a status dot immediately followed by an archived dot gets a gap — same fused-dot fix card #97 gave epic+status (card #102 final design)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.status-dot \+ \.archived-dot\s*\{[^}]*margin-left:\s*4px/,
    'archived always follows statusBadge() directly (epic, status, archived order) — needs the same adjacent-sibling gap');
});

test('SKILL.md documents the archived ball as its own bullet, citing card #102\'s final design (card #102 final design)', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const bullet = skill.match(/- \*\*Archived ball \(card #102's FINAL design\)\*\*[\s\S]*?(?=\n- \*\*)/);
  assert.ok(bullet, 'the Archived ball bullet exists');
  assert.match(bullet[0], /archivedBadge\(\)/, 'names the helper');
  assert.match(bullet[0], /ARCHIVE_COLOR/, 'names the fixed color it wears');
  // card #108: calendarChipEl now conditionally renders it (archived cards
  // are opt-in there since #108) — only cardEl (live board tiles) structurally
  // never can, so that's the absence rule left to state explicitly.
  assert.match(bullet[0], /`cardEl` never renders it/, 'states the absence rule for live board tiles explicitly');
  assert.match(bullet[0], /epic, status,\s*\n?\s*archived/, 'states the one glyph order used everywhere');
  assert.match(bullet[0], /46 to 58/, 'documents the map node height change that made room for the third dot');
});

test('SKILL.md\'s Dependency map section points from the #102 reopen narrative to the archived ball closing the loop (card #102 final design)', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /Card #102's FINAL design closes the loop/, 'the reopen paragraph is updated, not left stale');
});

test('app.css agrees with the JS palette on every status-colored surface (card #57)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  for (const [status, hex] of Object.entries(BUILTIN_STATUS_COLORS)) {
    assert.ok(css.includes(`.col-${status} .column-header { color: ${hex};`), `column header: ${status}`);
    assert.ok(css.includes(`.map-status-dot.status-${status} { fill: ${hex};`), `map status dot: ${status}`); // card #91: moved off the rect stroke
    assert.ok(css.includes(`.gantt-group-row.status-${status} { color: ${hex};`), `gantt group: ${status}`);
    assert.ok(css.includes(`.gantt-bar.status-${status} { border-color: ${hex}; background: ${statusColorSoft(status)};`), `gantt bar: ${status}`);
  }
  assert.ok(css.includes(`.col-archive .column-header { color: ${ARCHIVE_COLOR};`), 'archive column header stays neutral');
  assert.ok(css.includes(`.map-node.archived rect { stroke: ${ARCHIVE_COLOR};`), 'archived map nodes keep a neutral border');
  // card #102 reopen: status dots never mute — no CSS rule left to fire the
  // archived node's status dot grey. The border above is the ONLY archived cue.
  assert.ok(!css.includes('.map-node.archived .map-status-dot'), 'no archived status-dot mute rule (card #102 reopen)');
});

// --- card #49 verify finding: the CSP's `style-src 'self'` (no unsafe-inline)
// blocks the browser from applying an HTML `style="..."` attribute at all —
// statusBadge() and the map SVG's custom-status dot were the one channel that
// broke (every other statusColor() consumer in app.js sets style via the
// CSSOM, `el.style.x = ...`, which CSP does not restrict). Fixed by routing
// every status color through a class instead. Pin the absence directly so a
// future edit can't quietly reintroduce an inline style attribute here.

test('neither status-colors.js nor app.js emits a literal style="..." HTML attribute anywhere (card #49 verify finding)', () => {
  const statusColorsSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'status-colors.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.doesNotMatch(statusColorsSrc, /style="/, 'status-colors.js must never build an inline style="" attribute string — CSP style-src has no unsafe-inline');
  assert.doesNotMatch(appSrc, /style="/, 'app.js must never build an inline style="" attribute string — CSP style-src has no unsafe-inline (CSSOM .style.x assignments are fine, they do not match this pattern)');
});

test('statusColorClass covers the exact same value space as statusColor — every hashed slot has a matching CSS class both for .status-dot-- and .map-status-dot.status- (card #49 verify finding)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  STATUS_PALETTE.forEach((hex, i) => {
    assert.ok(css.includes(`.map-status-dot.status-palette-${i} { fill: ${hex};`), `map-status-dot palette rule present: palette-${i}`);
  });
  assert.ok(css.includes(`.map-status-dot.status-archive { fill: ${ARCHIVE_COLOR};`), 'map-status-dot archive rule present');
  // statusColorClass is deterministic and pure, same contract as statusColor.
  assert.strictEqual(statusColorClass('review'), statusColorClass('review'));
  assert.strictEqual(statusColorClass('TODO'), 'todo');
  assert.strictEqual(statusColorClass('archived'), 'archive');
});

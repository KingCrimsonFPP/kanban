'use strict';
// Pure status → color rules (card #31: dynamic columns). No DOM here — same
// dual-environment pattern as column-state.js/priority-badge.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND
// required directly by node --test.
//
// The built-in four have one fixed palette (the same hexes the CSS uses for
// column headers / map nodes / gantt bars). Any OTHER status — a custom
// column from config.yaml's `statuses` list or an unlisted value on disk —
// gets a deterministic color by hashing its (lowercased, trimmed) name into a
// fixed 8-color palette, so the same name colors the same everywhere,
// forever, with no state to store. Overlap with the built-in hues is fine:
// determinism, not uniqueness, is the contract.

const BUILTIN_STATUS_COLORS = {
  backlog: '#39c5cf', // card #57: cyan — the old grey #8b949e read as archived at a glance
  todo: '#58a6ff',
  doing: '#3fb950',
  done: '#a371f7',
};

// card #57: archive is a LOCATION, not a status (ADR 0002) — it gets the one
// neutral near-grey, ceded by backlog so grey now means "archived" and nothing
// else. NOT in BUILTIN_STATUS_COLORS (isBuiltinStatus stays a four-status
// answer), but statusColor maps the literal names anyway: cards are never
// validated, so an unlisted on-disk `status: archive` — or `archived`, the
// kanban/archived/ folder's own name and the likelier hand-typed spelling —
// must mute like the archive column instead of hashing into a loud accent
// ('archived' used to hash to done's exact purple). Orange is off the table
// for any of this — card #59 claims it for epics.
const ARCHIVE_COLOR = '#6e7681';

// card #59: the epic/wayfinder accent — orange, reserved among the fixed
// colors (no built-in status or archive ever wears it — card #57 ceded
// orange to epics). Same hex as STATUS_PALETTE's orange slot on purpose: a
// custom status can still hash there (determinism, not uniqueness, is the
// hash contract). card #91 turned the old per-view border (card #59) into a
// small shared dot glyph; card #45 retired the dot too — circles are
// reserved for STATUS alone now, so an epic instead paints a faint
// background wash on whatever surface it's on (epicColorSoft() below; each
// surface's `.epic` CSS rule in app.css carries the actual paint). EPIC_COLOR
// itself lives on unchanged: the map's epic-membership edges + arrowhead
// (lines, not circles) still wear it solid. This constant still pins the hex
// via status-colors.test.js so CSS and JS can't drift.
const EPIC_COLOR = '#f0883e';

// GitHub-dark accent scale — visually distinct from each other and legible on
// the app's dark background. No grey slot: card #57 ceded grey to archive, so
// no hashable status may land near it (the palette used to keep backlog's old
// #8b949e — 'review'/'frozen'/'icebox' hashed one shade from the archive grey,
// re-creating for custom columns the confusion the card was opened to kill).
// Swapping a slot's hex is fair game: the hash contract is determinism per
// name within one code version, never hue stability across versions.
const STATUS_PALETTE = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#d29922', // amber
  '#a371f7', // purple
  '#f778ba', // pink
  '#39c5cf', // cyan
  '#f0883e', // orange
  '#ff7b72', // red — replaced the grey slot (card #57)
];

function normalizeStatus(status) {
  return String(status == null ? '' : status).trim().toLowerCase();
}

function isBuiltinStatus(status) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, normalizeStatus(status));
}

// djb2-xor over the normalized name — tiny, dependency-free, stable across
// Node and every browser (no reliance on String hashing or crypto). Exported
// (card #183) so assignee-colors.js can hash handles into this SAME
// STATUS_PALETTE instead of forking the algorithm — one shared hash+palette
// pool, not two systems that happen to look alike.
function statusHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function statusColor(status) {
  const s = normalizeStatus(status);
  if (s === 'archive' || s === 'archived') return ARCHIVE_COLOR; // card #57: mute, never hash — both spellings (see ARCHIVE_COLOR)
  if (Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, s)) return BUILTIN_STATUS_COLORS[s];
  return STATUS_PALETTE[statusHash(s) % STATUS_PALETTE.length];
}

// card #49 (verify finding): the CSS class twin of statusColor() — same
// closed set of outcomes (the four built-ins, archive-mute, or one of the 8
// hashed palette slots), but named as a class suffix instead of a hex string.
// statusBadge() and the map SVG's custom-status dot (app.js buildMapSvg) both
// render this instead of writing the hex straight into an inline style
// attribute: a strict `style-src 'self'` CSP (no unsafe-inline) blocks the
// browser from applying HTML-attribute inline styles at all, silently
// leaving every status dot colorless. Because the value space is this same
// small fixed enum either way, a CSS class per outcome (app.css's
// `.status-dot--*` / `.map-status-dot.status-palette-N` rules) carries every
// case statusColor() can produce with zero inline style anywhere.
function statusColorClass(status) {
  const s = normalizeStatus(status);
  if (s === 'archive' || s === 'archived') return 'archive';
  if (Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, s)) return s;
  return `palette-${statusHash(s) % STATUS_PALETTE.length}`;
}

// The 12%-alpha wash the gantt bars use as their fill — derived from the same
// hex so the border/fill pair can never disagree.
function statusColorSoft(status) {
  const hex = statusColor(status);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

// card #45: epic's cue used to be epicBadge() — a shared HTML dot glyph
// (card #91) reused verbatim by every surface, plus the map's own SVG circle
// twin. Both are gone: circles are reserved for STATUS alone now, so an epic
// instead washes its whole surface in a faint EPIC_COLOR tint. Same 12%-alpha
// convention statusColorSoft above already uses for the gantt bar's
// per-status fill, so the two read as one consistent "soft wash" language.
// Every consuming surface just adds an `epic` class (app.js) — app.css
// carries the actual rgba() per surface (`.card.epic`/`.cal-chip.epic`
// share one rule; `.gantt-bar.epic`/`.map-node.epic rect` are their own
// twins, since the bar's `background` is already spoken for by its
// per-status fill and the map node paints via SVG `fill`, not CSS
// `background`) — this function exists only so CSS and JS can't drift on the
// exact value (pinned by status-colors.test.js).
function epicColorSoft() {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(EPIC_COLOR.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

// Tiny local HTML-attribute escape, same duplication call priority-badge.js's
// badgeEscape already made rather than requiring assignee-badge.js's
// escapeHtml cross-file for one line of logic — the raw on-disk status lands
// in a title="" attribute below and free text is never trusted there (same
// reasoning as every other card-derived string in app.js).
function statusEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// card #97: the shared status dot — renders on every card rendering (board
// tiles live+archived, the map's isolated-row tiles, calendar chips, gantt
// gutter rows — see app.js's cardEl/archiveCardEl/calendarChipEl and the
// gantt gutter label). Colored exactly like the map SVG's own status dot
// (buildMapSvg's <circle>, card #91).
//
// card #102 REOPEN ("wrong colors for done status"): the first pass here had
// archived MUTE to ARCHIVE_COLOR regardless of the raw status — called
// working-as-designed until a headless measurement of the real board found
// the map rendering 18 nodes, ALL archived-done, ALL grey: archived chains
// dominate any mature board's map forever, so muting the dot emptied the one
// channel that exists to carry status. LOCKED RULE: STATUS DOTS NEVER MUTE —
// the card's `archived` flag no longer touches this function's color at all;
// statusColor(status) alone decides it, live or archived. The literal on-disk
// statuses 'archive'/'archived' still mute (statusColor's own mapping, card
// #57 — that genuinely IS their status color), but that's keyed off the RAW
// status string, never off the archived flag. The archived cue moved entirely
// to the tile's dimmed body/grey border, the "(archived)" tooltip, and
// ghost/selection treatments — none of them this function's concern.
// Like the SVG twin (a CSS class per built-in status, custom ones now also a
// class — card #49 verify finding, see statusColorClass above), this writes
// a class, never an inline style: a strict CSP has no channel left to break.
// The tooltip names the RAW status, same contract as the SVG dot's own <title>.
function statusBadge(card) {
  const status = card && card.status;
  const cls = statusColorClass(status);
  const label = String(status == null ? '' : status);
  return `<span class="status-dot status-dot--${cls}" title="${statusEscape(label)}"></span>`;
}

// card #102 FINAL DESIGN ("show the status color as shown in the frontmatter
// and an additional ball gray for archived"): the second shared dot glyph — a
// small ARCHIVE_COLOR grey ball with an "Archived" tooltip, joining
// statusBadge() on every surface that renders an ARCHIVED card (board
// Archive-column tiles, the map's isolated-row archived tiles, the gantt
// Archive-group gutter rows). Live cards NEVER render this — cardEl and
// calendarChipEl never call it, pinned as served-asset ABSENCE tests in
// server.test.js, same discipline as every other locked contract here.
// ARCHIVE_COLOR never varies per-card, so this needs no inline style at all;
// a plain CSS class (.archived-dot, app.css) carries the fixed color. The map
// SVG node's own twin lives in buildMapSvg (app.js): SVG has no <span>, same
// pattern as card #91's old epic-dot circle (retired by card #45 — an epic is
// a background wash now, no longer a glyph in this sequence). Glyph order,
// applied identically on every surface that carries more than one dot:
// status, archived.
function archivedBadge() {
  return '<span class="archived-dot" title="Archived"></span>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUILTIN_STATUS_COLORS, STATUS_PALETTE, ARCHIVE_COLOR, EPIC_COLOR, isBuiltinStatus, statusHash, statusColor, statusColorClass, statusColorSoft, epicColorSoft, statusBadge, archivedBadge,
  };
} else {
  window.BUILTIN_STATUS_COLORS = BUILTIN_STATUS_COLORS;
  window.STATUS_PALETTE = STATUS_PALETTE;
  window.ARCHIVE_COLOR = ARCHIVE_COLOR;
  window.EPIC_COLOR = EPIC_COLOR;
  window.isBuiltinStatus = isBuiltinStatus;
  window.statusHash = statusHash;
  window.statusColor = statusColor;
  window.statusColorClass = statusColorClass;
  window.statusColorSoft = statusColorSoft;
  window.epicColorSoft = epicColorSoft;
  window.statusBadge = statusBadge;
  window.archivedBadge = archivedBadge;
}

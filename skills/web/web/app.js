'use strict';
const state = { active: [], archived: [], projectName: '', boardDir: '', notifications: [], priorities: [], tags: [], statuses: [], assignees: [] }; // card #46: assignees seeded empty — renderBoard's Assignee sort reads it before the first /api/board response lands. card #55: boardDir seeded empty — copyBoardPath toasts honestly on a pre-first-poll click.

const $ = (sel) => document.querySelector(sel);

// --- Dynamic columns (card #31): the live columns come from config.yaml's
// `statuses` list (via /api/board), the built-in four when unconfigured.
// column-state.js owns the pure rules (columnIdsFor/columnForStatus/
// columnLabel); status-colors.js owns the color rules (built-in four keep
// their exact palette, custom names hash into a fixed 8-color palette).
function boardStatuses() {
  return liveStatuses(state.statuses); // built-in four when unconfigured; a stray 'archive' entry is dropped
}

function boardColumnIds() {
  return columnIdsFor(state.statuses);
}

// Statuses arrive on every board payload. A changed list changes the COLUMN
// KEY SET, so the memoized collapse/sort states (merged against the old keys)
// must re-merge — same invalidation discipline as applyProjectName below.
function applyStatuses(list) {
  const next = Array.isArray(list) ? list : [];
  if (JSON.stringify(next) === JSON.stringify(state.statuses)) return;
  state.statuses = next;
  collapsedColumns = null;
  columnSort = null;
  mapStatusFilter = null; // card #56: keyed by the same column set
  ganttStatusFilter = null; // card #98: keyed by the LIVE statuses (no archive), same invalidation rule
  calendarStatusFilter = null; // card #99: same LIVE-statuses key as the gantt's
}

// column-state.js provides DEFAULT_STATUSES / columnIdsFor / columnForStatus /
// columnLabel / storageKey / mergeCollapsedState as bare globals (same dual-environment
// pattern as refresh-policy.js). Collapse state loads once from localStorage
// per page load and is mutated in place, so every renderBoard() call — manual,
// drag-driven, or the 5s auto-refresh poll — reads the same in-memory object
// and the collapsed/expanded layout never resets itself mid-session.
let collapsedColumns = null;

function loadCollapsedColumns() {
  if (collapsedColumns) return collapsedColumns;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'columns.collapsed'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  collapsedColumns = mergeCollapsedState(saved, boardColumnIds()); // card #31: merge against the board's current column set
  return collapsedColumns;
}

function saveCollapsedColumns() {
  try { localStorage.setItem(storageKey(state.projectName, 'columns.collapsed'), JSON.stringify(collapsedColumns)); }
  catch (e) { /* storage unavailable/full — collapse state just won't persist this session */ }
}

function toggleColumn(col) {
  const collapsed = loadCollapsedColumns();
  collapsed[col] = !collapsed[col];
  saveCollapsedColumns();
  renderBoard();
}

// column-sort.js provides SORT_FIELDS / SORT_FIELD_LABELS / DEFAULT_SORT /
// DEFAULT_SORT_DIRECTION / mergeSortState / compareCards / sortCards as bare
// globals (card #18, same dual-environment pattern). Loaded once from
// localStorage per page load and mutated in place — same discipline as
// collapsedColumns above — so the chosen sort survives every renderBoard()
// call (manual, drag, poll, toggle, search) without re-reading storage.
let columnSort = null;

function loadColumnSort() {
  if (columnSort) return columnSort;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'columns.sort'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  columnSort = mergeSortState(saved, boardColumnIds()); // card #31: merge against the board's current column set
  return columnSort;
}

function saveColumnSort() {
  try { localStorage.setItem(storageKey(state.projectName, 'columns.sort'), JSON.stringify(columnSort)); }
  catch (e) { /* storage unavailable/full — sort choice just won't persist this session */ }
}

// Changing the field resets direction to that field's natural default
// (id/due -> asc, priority -> desc/High-first, modified -> desc/newest-first,
// assignee -> asc/registry-order — card #46) rather than keeping whatever
// direction the previous field happened to be on.
function setColumnSortField(col, field) {
  if (!SORT_FIELDS.includes(field)) return;
  const sort = loadColumnSort();
  sort[col] = { field, direction: DEFAULT_SORT_DIRECTION[field] };
  saveColumnSort();
  renderBoard();
}

function toggleColumnSortDirection(col) {
  const sort = loadColumnSort();
  const current = sort[col];
  sort[col] = { field: current.field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  saveColumnSort();
  renderBoard();
}

// card #56: which columns' cards the MAP shows — one toggle per column
// (statuses in column order + archive, the location pseudo-column). Pure
// rules (defaults/merge/card→toggle mapping) live in column-state.js; same
// memoize-once-mutate-in-place discipline as collapsedColumns/columnSort
// above, own feature key, so the choice survives every renderBoard() call
// (manual, poll, drag, toggle, search) and page reloads, per board.
let mapStatusFilter = null;

function loadMapStatusFilter() {
  if (mapStatusFilter) return mapStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to all-ON
  mapStatusFilter = mergeMapStatusFilter(saved, boardColumnIds()); // merge against the board's current column set, same as collapse/sort
  return mapStatusFilter;
}

function saveMapStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.statusFilter'), JSON.stringify(mapStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleMapStatusFilter(col) {
  const filter = loadMapStatusFilter();
  if (!(col in filter)) return; // stale data-col from a column set that just changed under the row — ignore
  filter[col] = !filter[col];
  saveMapStatusFilter();
  renderBoard();
}

// card #101: right-click SOLO — that pill on, every other off; right-click
// again on an already-soloed pill restores all ON ("viceversa"). The pure
// rule (soloStatusFilter, column-state.js) is shared by all three views;
// this wrapper mirrors toggleMapStatusFilter's load/mutate-in-place/save/
// render shape exactly.
function soloMapStatusFilter(col) {
  const filter = loadMapStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveMapStatusFilter();
  renderBoard();
}

// card #98: which statuses the GANTT shows — one toggle per board status in
// column order, all ON by default. card #98's 2026 reopen ("we are missing
// archived status") added an Archive pseudo-pill, same id list as the map's
// row (boardColumnIds(): statuses + archive) — but DEFAULT OFF, unlike every
// live status and unlike the map's own Archive pill (#56, always ON — the
// map has always included archived cards): the base gantt view must stay
// exactly live-only until a human opts in. That one different default is why
// this reuses mergeGanttStatusFilter (its own archive-off-by-default merge
// helper, column-state.js) rather than the map's mergeMapStatusFilter, which
// would default the new key to true. Same memoize-once-mutate-in-place
// discipline as mapStatusFilter above, so the choice survives every
// renderGanttView() call (manual, poll, drag, toggle, search) and page
// reloads, per board.
let ganttStatusFilter = null;

function loadGanttStatusFilter() {
  if (ganttStatusFilter) return ganttStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'gantt.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults (archive OFF)
  ganttStatusFilter = mergeGanttStatusFilter(saved, boardColumnIds()); // card #98 reopen: statuses + archive, archive-off-by-default merge — a stale pre-reopen saved value (no 'archive' key) fills in OFF, never ON
  return ganttStatusFilter;
}

function saveGanttStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'gantt.statusFilter'), JSON.stringify(ganttStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleGanttStatusFilter(col) {
  const filter = loadGanttStatusFilter();
  if (!(col in filter)) return; // stale data-col from a status list that just changed under the row — ignore
  filter[col] = !filter[col];
  saveGanttStatusFilter();
  renderBoard();
}

// card #101: right-click SOLO, gantt-scoped — same rule/shape as
// soloMapStatusFilter above, own filter + id list. card #98 reopen: the id
// list now includes Archive (boardColumnIds), so soloing a status turns
// Archive off too (every-other-off), soloing Archive shows archived cards
// only, and right-clicking the already-soloed Archive pill restores all —
// soloStatusFilter is already fully generic over its id list, no change
// needed there.
function soloGanttStatusFilter(col) {
  const filter = loadGanttStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveGanttStatusFilter();
  renderBoard();
}

// card #99: which LIVE statuses the CALENDAR shows — one toggle per board
// status in column order, all ON by default. card #108 ("show/hide archived
// cards the same way we do in map view and gantt view") added an Archive
// pseudo-pill, same id list as the gantt's row (boardColumnIds(): statuses +
// archive) and the same DEFAULT OFF as the gantt (not the map's always-ON):
// the base calendar view must stay exactly live-only until a human opts in.
// That default is why this reuses mergeGanttStatusFilter (its own
// archive-off-by-default merge helper, column-state.js), not the map's
// mergeMapStatusFilter (which would default the new key to true). The
// calendar doesn't bucket cards into board columns any more than the gantt
// does (a chip renders off cardSchedule/dueMarker, not a column lookup), so
// it reuses ganttFilterVisibleIds verbatim (see renderCalendarMonthGrid/
// renderCalendarTimeGrid below) rather than growing a third near-identical
// visible-ids helper. Same memoize-once-mutate-in-place discipline as
// mapStatusFilter/ganttStatusFilter above, own feature key, so the choice
// survives every renderCalendarView() call (manual, poll, drag, toggle,
// search, sub-view switch) and page reloads, per board.
let calendarStatusFilter = null;

function loadCalendarStatusFilter() {
  if (calendarStatusFilter) return calendarStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'calendar.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults (archive OFF)
  calendarStatusFilter = mergeGanttStatusFilter(saved, boardColumnIds()); // card #108: statuses + archive, archive-off-by-default merge — a stale pre-#108 saved value (no 'archive' key) fills in OFF, never ON
  return calendarStatusFilter;
}

function saveCalendarStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'calendar.statusFilter'), JSON.stringify(calendarStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleCalendarStatusFilter(col) {
  const filter = loadCalendarStatusFilter();
  if (!(col in filter)) return; // stale data-col from a status list that just changed under the row — ignore
  filter[col] = !filter[col];
  saveCalendarStatusFilter();
  renderBoard();
}

// card #101: right-click SOLO, calendar-scoped — same rule/shape as
// soloGanttStatusFilter above. card #108: the id list is now boardColumnIds()
// (statuses + Archive), so soloing a status turns Archive off too, soloing
// Archive shows archived cards only, and right-clicking the already-soloed
// Archive pill restores all — soloStatusFilter is already fully generic over
// its id list, no change needed there.
function soloCalendarStatusFilter(col) {
  const filter = loadCalendarStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveCalendarStatusFilter();
  renderBoard();
}

// card #97: map section collapse — one boolean per section (the layered graph,
// the "No dependencies" list). column-state.js's MAP_SECTIONS/mergeMapSectionsCollapsed
// own the fixed two-key shape (not a dynamic column set, unlike collapse/sort/
// status-filter above); same memoize-once-mutate-in-place discipline and own
// feature key, so a collapsed/expanded section survives every renderMapView()
// call (manual, poll, drag, toggle, search) and page reloads, per board.
let mapSectionsCollapsed = null;

function loadMapSectionsCollapsed() {
  if (mapSectionsCollapsed) return mapSectionsCollapsed;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.sections.collapsed'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to both expanded
  mapSectionsCollapsed = mergeMapSectionsCollapsed(saved);
  return mapSectionsCollapsed;
}

function saveMapSectionsCollapsed() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.sections.collapsed'), JSON.stringify(mapSectionsCollapsed)); }
  catch (e) { /* storage unavailable/full — collapse choice just won't persist this session */ }
}

function toggleMapSection(key) {
  const sections = loadMapSectionsCollapsed();
  if (!(key in sections)) return; // defensive: an unrecognized data-section never crashes
  sections[key] = !sections[key];
  saveMapSectionsCollapsed();
  renderBoard();
}

const CHEVRON_LEFT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHEVRON_RIGHT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

// modal-fullscreen.js provides MODAL_TYPES / DEFAULT_FULLSCREEN /
// mergeFullscreenState as bare globals (card #20, same dual-environment
// pattern as column-state.js/column-sort.js). Loaded once from localStorage
// per page load and mutated in place — same discipline as collapsedColumns/
// columnSort above — so the chosen fullscreen state survives every popup
// close/reopen and page reload. Neither modal is ever rebuilt by
// renderBoard() (both live outside #board, static in the HTML), and any open
// modal already blocks the 5s auto-refresh poll entirely (see
// autoRefreshSkipState below), so there's no re-render to survive mid-session
// either — the class applied by applyModalFullscreen() just stays put.
const FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
const EXIT_FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>';

// Registry mapping a modal type (matches modal-fullscreen.js's MODAL_TYPES)
// to its DOM handles. Following the .modal-backdrop convention here (rather
// than hardcoding two call sites) is what the card means by a future popup —
// e.g. #13's AI-assist popup — getting fullscreen "mostly free": it only
// needs an entry here plus a toggle button of its own.
const FULLSCREEN_MODALS = {
  edit: { backdrop: '#modal', btn: '#modal-fullscreen-btn' },
  detail: { backdrop: '#detail-modal', btn: '#detail-fullscreen-btn' },
  bulkSingle: { backdrop: '#bulk-single', btn: '#bulk-single-fullscreen-btn' },
  bulkTags: { backdrop: '#bulk-tags', btn: '#bulk-tags-fullscreen-btn' },
  bulkSchedule: { backdrop: '#bulk-schedule', btn: '#bulk-schedule-fullscreen-btn' },
};

let modalFullscreen = null;

function loadModalFullscreen() {
  if (modalFullscreen) return modalFullscreen;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'modal.fullscreen'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  modalFullscreen = mergeFullscreenState(saved);
  return modalFullscreen;
}

function saveModalFullscreen() {
  try { localStorage.setItem(storageKey(state.projectName, 'modal.fullscreen'), JSON.stringify(modalFullscreen)); }
  catch (e) { /* storage unavailable/full — fullscreen choice just won't persist this session */ }
}

// Sets a modal's DOM (class + button icon/tooltip/aria) to an explicit on/off
// value WITHOUT touching the persisted preference. Card #20 originally split
// this out so Esc could exit fullscreen visually without downgrading an
// "always fullscreen" preference; card #96 removed Esc from the fullscreen
// picture entirely (Esc now closes the popup outright, first press, fullscreen
// or not — see the document keydown handler below), so the only two callers
// left are applyModalFullscreen (reflect the saved preference on every open)
// and toggleModalFullscreen (the button, which persists first and then calls
// this to update the DOM to match).
function setModalFullscreenVisual(type, on) {
  const cfg = FULLSCREEN_MODALS[type];
  if (!cfg) return;
  const backdrop = $(cfg.backdrop);
  const btn = $(cfg.btn);
  const panel = backdrop && backdrop.querySelector('.modal');
  if (!panel || !btn) return;
  panel.classList.toggle('fullscreen', on);
  btn.innerHTML = on ? EXIT_FULLSCREEN_ICON : FULLSCREEN_ICON;
  const label = on ? 'Exit full screen' : 'Expand to full screen';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(on));
}

// Applies the persisted preference to a modal's DOM — called every time a
// modal opens, so a popup that follows a poll/reopen/reload always renders in
// the state the user last explicitly chose via the toggle button.
function applyModalFullscreen(type) {
  setModalFullscreenVisual(type, !!loadModalFullscreen()[type]);
}

function toggleModalFullscreen(type) {
  const fs = loadModalFullscreen();
  if (!(type in fs)) return;
  fs[type] = !fs[type];
  saveModalFullscreen();
  applyModalFullscreen(type);
}

// The fullscreen-capable popup currently open, if any (card #145's Alt+Enter
// hotkey needs a target). At most one .modal-backdrop is ever visible at a
// time, so first match wins; the notifications popup isn't in the registry
// and correctly yields null.
function openFullscreenModalType() {
  for (const type of Object.keys(FULLSCREEN_MODALS)) {
    const backdrop = $(FULLSCREEN_MODALS[type].backdrop);
    if (backdrop && !backdrop.classList.contains('hidden')) return type;
  }
  return null;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  let json = null;
  if (isJson && text) {
    try { json = JSON.parse(text); } catch (e) { json = null; } // malformed JSON body falls back to status+text below
  }
  if (!res.ok) {
    const msg = (json && json.error) || `${res.status} — ${text || res.statusText}`;
    throw Object.assign(new Error(msg), { status: res.status, data: json });
  }
  return json;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

// epic #137: waiting (derived from waiting_for) and blocked (the manual
// sticker) are distinct words with distinct predicates — both live in
// waiting-blocked.js (bare globals here); these are the board-state wrappers.
// Waiting is location-independent: deps resolve against active + archived.
function waitingOn(card) {
  if (!card.waiting_for.length) return [];
  const byId = new Map(state.active.concat(state.archived).map((c) => [c.id, c]));
  return unresolvedWaits(card.waiting_for, byId);
}

function isWaiting(card) {
  return waitingOn(card).length > 0;
}

// The doing entry gate's combined client-side pre-check (server also
// enforces): refused while waiting OR blocked.
function refusesDoing(card) {
  return isWaiting(card) || isBlockedValue(card.blocked);
}

// Names WHICH gate refused, for per-card skip toasts.
function refusalWord(card) {
  return isWaiting(card) ? 'waiting' : 'blocked';
}

// Turn a 422 payload (server gate refusal) into the human sentence fragment:
// "waiting on #3 (todo), #4 (backlog)" or "blocked: <reason>". The server's
// own error message already carries the right wording for both cases; the
// waiting branch is rebuilt here only so the shape stays pinned client-side.
function gate422Text(data) {
  if (data && data.waiting) return `waiting on ${data.waiting.map((w) => `#${w.id} (${w.status})`).join(', ')}`;
  return (data && data.error) || 'blocked';
}

// assigneeBadge/escapeHtml come from assignee-badge.js (bare globals, same
// dual-environment pattern as refresh-policy.js/column-state.js — see #21).
// card #39: every card-representing element in every view carries `card-el` +
// data-id — the shared contract the document-level click/contextmenu grammar
// handlers key on (see the multi-select section).
function cardEl(card) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // card #30: emphasis by rank in the configured list, label pre-escaped
  // card #91: epic is a shared dot glyph (epicBadge(), status-colors.js), not
  // a border class anymore — #59's border-recoloring is gone, so priority/
  // blocked/column membership need no gating around it. Archived tiles never
  // call cardEl at all (archiveCardEl is a separate function that never grew
  // this markup), so an archived epic still shows no epic cue on the board —
  // unchanged from #59's behavior, just no longer border-shaped.
  // card #97: statusBadge() joins it unconditionally (every card has a
  // status; unlike epic there's no absent case) — status is already implied
  // by column placement here, but the card asks for the dot on every surface
  // regardless, so board tiles get it too, same helper as everywhere else.
  el.className = 'card card-el' + (pb.className ? ` ${pb.className}` : '') + (isWaiting(card) ? ' waiting' : '') + (selectedIds.has(card.id) ? ' selected' : '');
  el.draggable = true;
  el.dataset.id = card.id;
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  // epic #137: the amber badge lists the UNRESOLVED ids only — it disappears
  // on its own when every dep lands, so a fully-satisfied card never reads
  // as waiting anywhere.
  const waits = waitingOn(card);
  const waiting = waits.length ? `<div class="waiting-badge">Waiting on: ${escapeHtml(waits.map((w) => `#${w.id}`).join(', '))}</div>` : '';
  // card #31: an on-disk status that isn't in the board's statuses list parks
  // the card in the FIRST column with a small raw-status chip — the file is
  // NEVER rewritten. Promotion = the human adds the status to config.yaml;
  // the next poll files the card under its real column and the chip vanishes.
  const unlisted = !boardStatuses().includes(card.status);
  const statusChip = unlisted
    ? `<span class="status-chip" title="Status not in the board's statuses list — shown in the first column until promoted in config.yaml">${escapeHtml(card.status)}</span>`
    : '';
  // card #44: the schedule key (same precedence the Due date sort uses) top-right —
  // escaped: date fields are free text by contract, never trust them in HTML.
  const sched = scheduleLabel(card, localTodayStr());
  el.innerHTML =
    `<div class="card-head"><span class="card-id">#${card.id}${pb.label ? ` ${pb.label}` : ''}</span>${card.epic ? epicBadge() : ''}${statusBadge(card)}${statusChip}${assigneeBadge(card)}${sched ? `<span class="card-schedule">${escapeHtml(sched)}</span>` : ''}</div>` +
    `<div class="card-title">${escapeHtml(card.title)}</div>` +
    (tags ? `<div class="card-tags">${tags}</div>` : '') + waiting;
  // epic #137: the red blocked pill — the sticker is a human stop sign, so
  // it reads as its own glyph, not a border (borders stay priority/status
  // territory). The reason is USER DATA: it goes in via textContent/title
  // property assignment only, never through innerHTML.
  if (isBlockedValue(card.blocked)) {
    const pill = document.createElement('span');
    pill.className = 'blocked-pill';
    pill.textContent = 'blocked';
    pill.title = blockedLabel(card.blocked);
    el.querySelector('.card-head').appendChild(pill);
  }
  return el;
}

// Archived tiles (card #11's popup behavior, now inline in the Archive column
// instead of the old bottom drawer): no drag, no Edit/Archive actions (an
// already-archived card 404-ing on re-archive is exactly what the idempotency
// guard on the server exists for, but there's no reason to invite it from the
// UI) — Restore/Delete stay reachable as tile buttons, same as the drawer had.
// card #91 fix: the board's Archive column has never carried the epic cue
// (before or after #91) and still doesn't — its call site below passes no
// second argument. But this same function also renders archived tiles in the
// map's isolated row (buildIsolatedRow), and there epic is a durable identity
// that must keep showing even off the layered graph (same as the SVG node's
// epic dot) — so `opts.epicDot` is an explicit opt-in for that one caller,
// rather than a blanket change that would put the cue back on the Archive
// column too.
// card #97: statusBadge(card), unlike epicBadge, needs no opts gate here — it
// colors straight off the card's true status regardless of card.archived
// (card #102 reopen: status dots never mute), so the SAME call is correct
// whether this renders in the Archive column or the map's isolated row:
// "board tiles (live AND archived)" gets the dot always, true color always.
// card #102 FINAL DESIGN: archivedBadge() joins right after statusBadge(),
// same unconditional-no-opts-gate reasoning — archiveCardEl only ever
// renders an archived card (both call sites below pass one), so unlike
// epicBadge's opt-in flag, the archived ball needs no gate either. Glyph
// order everywhere it appears: epic, status, archived.
function archiveCardEl(card, opts) {
  const showEpicDot = !!(opts && opts.epicDot);
  const el = document.createElement('div');
  el.className = 'card card-el archived-card' + (selectedIds.has(card.id) ? ' selected' : '');
  el.draggable = true; // card #34: drag out of Archive restores to the drop column
  el.dataset.id = card.id;
  const sched = scheduleLabel(card, localTodayStr());
  el.innerHTML =
    `<div class="card-head"><span class="card-id">#${card.id}</span>${showEpicDot && card.epic ? epicBadge() : ''}${statusBadge(card)}${archivedBadge()}${assigneeBadge(card)}${sched ? `<span class="card-schedule">${escapeHtml(sched)}</span>` : ''}</div>` +
    `<div class="card-title">${escapeHtml(card.title)}</div>` +
    `<div class="card-menu">` +
      `<button type="button" data-act="restore" data-id="${card.id}">Restore</button>` +
      `<button type="button" data-act="delete-arch" data-id="${card.id}">Delete</button>` +
    `</div>`;
  return el;
}

// Fifth column, right of Done, populated from state.archived (the archived/
// folder — ADR 0002: archive is a LOCATION, not a status). Every column
// (including Archive) gets a collapse toggle; collapsed columns render as a
// narrow strip with just the toggle icon + card count, and skip building
// their .column-cards list entirely (nothing to wire drag/click on while
// hidden). Archive is excluded from drag/drop (see wireDrag): dropping a live
// card's status as "archive" would just 400 at the server, so that
// interaction doesn't "fall out naturally" per the card's optional scope.
// Search (card #17): the box lives in the header, outside #board, so it's never
// rebuilt by renderBoard() — reading its live .value here each call is how the
// query "survives" every re-render (manual, poll, drag, toggle) for free, with
// no separate state to keep in sync. Parsing/matching itself is search.js
// (pure, no DOM), loaded as a bare global same as refresh-policy.js.
function currentSearchTerms() {
  const input = $('#search-input');
  return parseSearchQuery(input ? input.value : '');
}

// --- View mode: board (columns) / dependency map (card #19) / calendar
// (card #37) / gantt (card #38). Was a plain in-memory 'board'|'map' var;
// #37 grew it to a closed set AND promoted it to the same lazy-loaded,
// localStorage-persisted discipline as collapsedColumns/columnSort above
// (feature key 'view.mode', validated by calendar-model.js's mergeViewMode —
// an unknown/corrupt saved value falls back to 'board'). Every state-changing
// call site in this file still funnels through renderBoard(), so making
// renderBoard() the dispatcher means every one of those call sites — drag,
// sort, collapse, search, the auto-refresh poll — composes with whichever
// view is active, with zero changes to any of them.
let viewMode = null;

function loadViewMode() {
  if (viewMode) return viewMode;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'view.mode')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to board
  viewMode = mergeViewMode(saved);
  return viewMode;
}

function saveViewMode() {
  try { localStorage.setItem(storageKey(state.projectName, 'view.mode'), viewMode); }
  catch (e) { /* storage unavailable/full — view choice just won't persist this session */ }
}

// Each header toggle flips between its own view and the board: map ⇄ board,
// calendar ⇄ board — and pressing one while the OTHER view is active jumps
// straight to the pressed view (no board stopover).
function toggleView(mode) {
  viewMode = loadViewMode() === mode ? 'board' : mode;
  saveViewMode();
  renderBoard();
}

// One mode→container map for everything that needs "which element hosts
// this view" — applyViewMode's hide/show and visibleCardIds' range scope
// (card #144 review) — so a fifth view is one entry here, not two edits.
const VIEW_CONTAINERS = { board: '#board', map: '#map-view', calendar: '#calendar-view', gantt: '#gantt-view' };

function applyViewMode() {
  const mode = loadViewMode();
  for (const [m, sel] of Object.entries(VIEW_CONTAINERS)) $(sel).classList.toggle('hidden', mode !== m); // card #38 added gantt
  const mapBtn = $('#map-toggle-btn');
  mapBtn.textContent = mode === 'map' ? '☰ Board view' : '🕸 Map view';
  mapBtn.setAttribute('aria-pressed', String(mode === 'map'));
  const calBtn = $('#calendar-toggle-btn');
  calBtn.textContent = mode === 'calendar' ? '☰ Board view' : '📅 Calendar';
  calBtn.setAttribute('aria-pressed', String(mode === 'calendar'));
  const ganttBtn = $('#gantt-toggle-btn');
  ganttBtn.textContent = mode === 'gantt' ? '☰ Board view' : '📊 Gantt';
  ganttBtn.setAttribute('aria-pressed', String(mode === 'gantt'));
  if (mode === 'map') renderMapView();
  if (mode === 'calendar') renderCalendarView();
  if (mode === 'gantt') renderGanttView();
}

function renderBoard() {
  renderBoardColumns();
  applyViewMode();
}

function renderBoardColumns() {
  const board = $('#board');
  board.innerHTML = '';
  const collapsed = loadCollapsedColumns();
  const colSort = loadColumnSort();
  const searchTerms = currentSearchTerms();
  const searchActive = searchTerms.length > 0;
  const clearBtn = $('#search-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchActive);
  // card #31: columns render FROM the configured statuses list (+ archive at
  // the far right). A card whose status isn't listed renders in the FIRST
  // column via columnForStatus — the catch-all — with cardEl's raw-status chip.
  const statuses = boardStatuses();
  for (const col of boardColumnIds()) {
    const isArchive = col === 'archive';
    const source = isArchive ? state.archived : state.active.filter((c) => columnForStatus(c.status, statuses) === col);
    const sortState = colSort[col];
    // card #46: the Assignee sort ranks by registry order, so the comparator
    // gets the config.yaml handles — plumbed exactly like priorities above.
    const allCards = sortCards(source, sortState, state.priorities, state.assignees.map((a) => a.handle));
    const cards = searchActive ? filterCards(allCards, searchTerms) : allCards;
    const isCollapsed = !!collapsed[col];
    const label = columnLabel(col);
    // Counts stay truthful whether or not the column is collapsed — column-count
    // renders in both states, so a collapsed column with hits signals them on its
    // strip (card #17's Behavior note) with no extra branching.
    const countLabel = searchActive ? `${cards.length}/${allCards.length}` : `${allCards.length}`;
    const colEl = document.createElement('div');
    // col-<name> only for css-safe names (the built-in five have color rules;
    // a custom name's rule wouldn't exist anyway — its color is inline below).
    const colClass = /^[a-zA-Z0-9_-]+$/.test(col) ? ` col-${col}` : '';
    colEl.className = `column${colClass}` +
      (isCollapsed ? ' collapsed' : '') +
      (isArchive ? ' archive-column' : '') +
      (searchActive && cards.length > 0 ? ' search-match' : '');
    colEl.dataset.col = col;
    colEl.title = label; // native tooltip, per #9's convention; matters most while collapsed
    // Sort controls (card #18) share the header with #15's collapse toggle —
    // hidden entirely while collapsed (no card list visible to sort, and no
    // room in the narrow strip), so the two never fight for space. The
    // dropdown's selected option and the direction glyph both reflect the
    // persisted per-column state, so a re-render (poll/drag/toggle/search)
    // never visually resets the control out from under the user.
    const sortControls = isCollapsed ? '' :
      `<select class="column-sort-field" data-col="${escapeHtml(col)}" ` +
        `aria-label="Sort ${escapeHtml(label)} column by" title="Sort by">` +
        SORT_FIELDS.map((f) =>
          `<option value="${f}"${sortState.field === f ? ' selected' : ''}>${escapeHtml(SORT_FIELD_LABELS[f])}</option>`
        ).join('') +
      `</select>` +
      `<button type="button" class="column-sort-dir" data-col="${escapeHtml(col)}" ` +
        `aria-label="Toggle sort direction, currently ${sortState.direction === 'desc' ? 'descending' : 'ascending'}" ` +
        `title="Sort direction: ${sortState.direction === 'desc' ? 'descending' : 'ascending'} (click to toggle)">` +
        (sortState.direction === 'desc' ? '&#8595;' : '&#8593;') +
      `</button>`;
    colEl.innerHTML =
      `<div class="column-header">` +
        `<button type="button" class="column-toggle" data-col="${escapeHtml(col)}" ` +
          `aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(label)} column" aria-expanded="${!isCollapsed}">` +
          (isCollapsed ? CHEVRON_RIGHT_ICON : CHEVRON_LEFT_ICON) +
        `</button>` +
        (isCollapsed ? '' : `<span class="column-name">${escapeHtml(label)}</span>`) +
        sortControls +
        `<span class="column-count">${escapeHtml(countLabel)}</span>` +
        // card #54: + quick-create, pre-aimed at this column. Live expanded
        // headers only (showsColumnAdd: archive never — you can't create an
        // archived card — and a collapsed strip has no room). Wired through
        // the delegated #board click listener, same as every header control.
        (showsColumnAdd(col, isCollapsed) ?
          `<button type="button" class="column-add" data-col="${escapeHtml(col)}" ` +
            `aria-label="New card in ${escapeHtml(label)}" title="New card in ${escapeHtml(label)}">+</button>` : '') +
      `</div>`;
    // card #31: custom columns get their deterministic hashed color inline
    // (there is no CSS rule for them); the built-in four keep their exact
    // .col-<name> CSS palette, archive keeps its neutral header.
    if (!isArchive && !isBuiltinStatus(col)) colEl.querySelector('.column-header').style.color = statusColor(col);
    if (!isCollapsed) {
      const list = document.createElement('div');
      list.className = 'column-cards';
      cards.forEach((c) => list.appendChild(isArchive ? archiveCardEl(c) : cardEl(c)));
      colEl.appendChild(list);
    }
    board.appendChild(colEl);
  }
  wireDrag();
}

// --- Dependency map rendering (card #19) ------------------------------------
// Graph-building (nodes/edges/ghost-stubs/isolated, filter-aware) lives in
// dependency-graph.js — pure, unit-tested, dual-environment like search.js.
// Everything below is presentation: laying the graph's nodes/edges out as an
// SVG and gluing it to the DOM. Nodes come from BOTH state.active and
// state.archived — waiting is location-independent (archive is a location,
// not a status; see isWaiting() above, same reasoning) — so the map shows the
// true dependency picture regardless of where a card currently lives.
const MAP_NODE_W = 176;
// card #102 final design: grew from 46 (card #91's two-dot height) to fit a
// third right-edge dot (the archived ball) stacked between status and epic
// without crowding either — see buildMapSvg's statusDot/archivedDot/epicDot.
const MAP_NODE_H = 58;
const MAP_GAP_X = 24;
const MAP_GAP_Y = 60;
const MAP_PAD = 24;
const MAP_STATUSES = ['backlog', 'todo', 'doing', 'done'];

function mapStatusClass(status) {
  const s = (status || '').toLowerCase();
  return MAP_STATUSES.includes(s) ? s : 'unknown';
}

function truncateLabel(s, max) {
  const str = String(s || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function renderMapView() {
  const container = $('#map-view');
  // Selection toggles re-render — don't dump the user's scroll position
  // (same fix class as the gantt timeline's keepScrollLeft).
  const keepLeft = container.scrollLeft, keepTop = container.scrollTop;
  container.innerHTML = '';
  const allCards = state.active.concat(state.archived);
  // card #56: the status-filter row renders first and UNCONDITIONALLY — if it
  // vanished with the graph on the everything-filtered-out state, there'd be
  // no control left to toggle a status back ON.
  container.appendChild(buildMapFilterRow());
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(allCards, searchTerms).map((c) => c.id)) : null;
  // card #56: status filter composes with search by INTERSECTION — a card is
  // visible only if BOTH say so, and buildDependencyGraph sees one combined
  // visibleIds so the ghost-stub semantics stay EXACTLY the search filter's,
  // for free. The rule (incl. either side's null "not filtering" pass-through)
  // is column-state.js's intersectVisibleIds — pure and unit-pinned, not glue.
  const statusIds = mapFilterVisibleIds(allCards, loadMapStatusFilter(), state.statuses);
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const graph = buildDependencyGraph(allCards, visibleIds);

  if (!graph.nodes.length && !graph.ghosts.length) {
    const empty = document.createElement('div');
    empty.className = 'map-empty';
    empty.textContent = 'No cards match the current search/status filters.';
    container.appendChild(empty);
    return;
  }

  // card #97: each section's collapse state persists per board (memoize-once-
  // mutate-in-place, same as loadMapStatusFilter above), so it survives every
  // renderMapView() call — manual, poll, drag, toggle, search.
  const sections = loadMapSectionsCollapsed();
  const isolatedSet = new Set(graph.isolated);
  const participantIds = graph.nodes.map((n) => n.id).filter((id) => !isolatedSet.has(id))
    .concat(graph.ghosts.map((g) => g.id));
  if (participantIds.length) container.appendChild(buildMapGraphSection(graph, participantIds, sections.graph));
  if (graph.isolated.length) container.appendChild(buildIsolatedRow(graph, allCards, sections.isolated));
  container.scrollLeft = keepLeft;
  container.scrollTop = keepTop;
}

// card #98: the status-filter pill row MECHANISM — one toggle per column,
// shared verbatim between the map (#56) and the gantt (#98) rather than each
// view duplicating the markup/build-loop. Only the filter state, the id list,
// the row/pill class (so each view's own delegated listener and its own
// poll-guard/Q0-exemption selector keep targeting just their own pills), and
// the tooltip wording differ per caller. The look itself is ALSO shared, not
// duplicated — app.css comma-joins the two views' pill classes onto one
// declaration each. Border color comes from statusColor() for EVERY pill —
// built-in, custom (their hashed hue; no CSS rule exists, same reasoning as
// the column headers), and archive's neutral grey (card #57) where the map's
// row includes it.
//
// card #101: the right-click SOLO/viceversa grammar rides here too — one
// line appended to every caller's tooltip (rather than repeating it in each
// titleFor closure) since the gesture is otherwise invisible; the per-view
// contextmenu wiring lives with each view's own click delegate.
function buildFilterPillRow(filter, columnIds, rowClass, pillClass, titleFor) {
  const row = document.createElement('div');
  row.className = rowClass;
  for (const col of columnIds) {
    const on = filter[col] !== false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = pillClass + (on ? '' : ' off');
    btn.dataset.col = col;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = titleFor(col, on) + ' Right-click to solo (right-click the soloed pill again to restore all).';
    btn.style.borderColor = statusColor(col);
    btn.textContent = columnLabel(col);
    row.appendChild(btn);
  }
  return row;
}

// card #56: one pill per board column in column order (statuses + Archive:
// the map always includes archived cards, so the location pseudo-column is
// always offered). Rebuilt by every renderMapView() call like the rest of
// #map-view; state lives in the memoized mapStatusFilter, so the row never
// visually resets across the 5s poll. Clicks ride #map-view's delegated
// listener (see the map wiring section).
function buildMapFilterRow() {
  return buildFilterPillRow(loadMapStatusFilter(), boardColumnIds(), 'map-filter-row', 'map-filter-toggle',
    (col, on) => `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the map (hidden cards ghost when a visible card references them)`);
}

// card #98: same mechanism, gantt-scoped — statuses + Archive (boardColumnIds(),
// same id list as the map's row; card #98's 2026 reopen added the Archive
// pseudo-pill back, default OFF — see loadGanttStatusFilter). No ghost
// wording either — the gantt has no dependency edges, so a filtered-out
// status just drops its group rows outright, and the rendered timeline
// window re-derives from whatever bars remain (may narrow). Archive gets its
// own tooltip: flipping it ON adds one more group, after the live status
// groups, for dated ARCHIVED cards (muted grey, same #57 mute as everywhere
// else archive shows up). Rebuilt by every renderGanttView() call; clicks
// ride #gantt-view's own delegated listener (see wireGanttPointerDrag).
function buildGanttFilterRow() {
  return buildFilterPillRow(loadGanttStatusFilter(), boardColumnIds(), 'gantt-filter-row', 'gantt-filter-toggle',
    (col, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the timeline (dated archived cards render in their own Archive group, muted grey)`
      : `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the timeline (the visible window re-derives from what's left)`);
}

// card #99: same mechanism again, calendar-scoped. card #108: statuses +
// Archive (boardColumnIds(), same id list as the gantt's row) — the calendar
// can now show dated ARCHIVED cards too, opt-in, default OFF, same shape as
// the gantt's own Archive pill. Rebuilt by every renderCalendarView() call
// (month AND every #58 sub-view share this one row); clicks ride
// #calendar-view's own delegated listener (see the calendar wiring section).
function buildCalendarFilterRow() {
  return buildFilterPillRow(loadCalendarStatusFilter(), boardColumnIds(), 'calendar-filter-row', 'calendar-filter-toggle',
    (col, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the calendar (dated archived cards render read-only, with the archived ball)`
      : `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the calendar`);
}

// card #97: the two collapsible map sections share this header shape — a
// chevron toggle (same CHEVRON_LEFT/RIGHT_ICON + .column-toggle look as the
// board's per-column collapse, card #15) plus a count label. data-section
// names which half of loadMapSectionsCollapsed() the click flips; the
// delegated #map-view listener (see the map wiring section) reads it.
function buildMapSectionHeader(section, label, collapsed) {
  const header = document.createElement('div');
  header.className = 'map-section-header';
  header.innerHTML =
    `<button type="button" class="map-section-toggle" data-section="${section}" ` +
      `aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(label)}" aria-expanded="${!collapsed}">` +
      (collapsed ? CHEVRON_RIGHT_ICON : CHEVRON_LEFT_ICON) +
    `</button>` +
    `<span>${escapeHtml(label)}</span>`;
  return header;
}

// card #97: the layered SVG, wrapped in a collapse/expand toggle — state
// persists per board (loadMapSectionsCollapsed) and survives the 5s poll like
// every other memoized view preference. Collapsed skips layerNodes()/
// buildMapSvg() entirely (nothing to lay out while hidden), not just a CSS
// hide — the graph is the expensive part of this view.
function buildMapGraphSection(graph, participantIds, collapsed) {
  const wrap = document.createElement('div');
  wrap.className = 'map-graph-section';
  wrap.appendChild(buildMapSectionHeader('graph', `Dependency graph (${participantIds.length}):`, collapsed));
  if (!collapsed) {
    const layer = layerNodes(participantIds, graph.edges);
    wrap.appendChild(buildMapSvg(graph, layer));
  }
  return wrap;
}

// Isolated cards (no waiting_for edge in either direction) render as a
// detached row below the layered graph rather than a "show isolated" toggle —
// implementer's judgment call per the card: a toggle is one more piece of UI
// state to persist/compose with view mode + search + sort + collapse, for a
// case (no dependencies at all) that's common on most boards and cheap to
// just always show. Reuses cardEl's board tile look so a card reads the same
// wherever it appears.
// card #97: NOW collapsible after all — the card asks for it explicitly, and
// loadMapSectionsCollapsed's own state (not a fresh toggle-per-view) is what
// makes it cheap: one more merged boolean, not new persisted UI state design.
function buildIsolatedRow(graph, allCards, collapsed) {
  const byId = new Map(allCards.map((c) => [c.id, c]));
  const wrap = document.createElement('div');
  wrap.className = 'map-isolated';
  wrap.appendChild(buildMapSectionHeader('isolated', `No dependencies (${graph.isolated.length}):`, collapsed));
  if (!collapsed) {
    const row = document.createElement('div');
    row.className = 'map-isolated-row';
    graph.isolated.forEach((id) => {
      const card = byId.get(id);
      if (!card) return;
      // card #91 fix: opt in to the epic dot here — the map is the one place an
      // archived card appears outside the graph proper, and epic (unlike status)
      // isn't supposed to mute or disappear just because a card has no edges.
      const tile = card.archived ? archiveCardEl(card, { epicDot: true }) : cardEl(card);
      tile.draggable = false; // the map isn't a drag surface
      // cardEl/archiveCardEl already stamp card-el + data-id (card #39), so the
      // shared grammar handlers cover these tiles with no extra wiring.
      row.appendChild(tile);
    });
    wrap.appendChild(row);
  }
  return wrap;
}

// Builds the layered SVG: nodes positioned by layerNodes()'s layer assignment
// (top-down, one row per layer, left-to-right by id within a row), edges as
// arrowed paths (dep -> waiter — same direction as the
// kanban-cli skill's Mermaid `n<depId> --> n<id>` output, so
// the two views read the same graph the same way). A "back edge" (target
// layer <= source layer — only possible when layerNodes had to force-break a
// cycle) routes as a side-bowed curve instead of a straight line, so a cycle
// stays visually distinct rather than overlapping the normal downward flow.
function buildMapSvg(graph, layer) {
  const allById = new Map();
  graph.nodes.forEach((n) => allById.set(n.id, Object.assign({ ghost: false }, n)));
  graph.ghosts.forEach((g) => allById.set(g.id, Object.assign({ ghost: true }, g)));

  const layers = new Map(); // layerIndex -> [ids] sorted ascending
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l).push(id);
  }
  for (const ids of layers.values()) ids.sort((a, b) => a - b);
  const numLayers = layers.size ? Math.max(...layers.keys()) + 1 : 0;

  const pos = new Map(); // id -> {x, y, cx}
  for (const [l, ids] of layers) {
    ids.forEach((id, i) => {
      const x = MAP_PAD + i * (MAP_NODE_W + MAP_GAP_X);
      const y = MAP_PAD + l * (MAP_NODE_H + MAP_GAP_Y);
      pos.set(id, { x, y, cx: x + MAP_NODE_W / 2 });
    });
  }

  const BACK_EDGE_BOW = MAP_NODE_W * 0.9;
  // Canvas width is the true rightmost extent in play, not just the widest
  // row of nodes — a back-edge's sideways bow (see below) can reach past
  // every node's right edge when its row has only one member (e.g. an
  // isolated 2-cycle, filtered down to just itself), and a width that only
  // accounted for node columns would clip that curve at the edge.
  let maxX = MAP_PAD;
  for (const p of pos.values()) maxX = Math.max(maxX, p.x + MAP_NODE_W);

  let edgesSvg = '';
  graph.edges.forEach((e) => {
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) return; // defensive: every edge endpoint is always laid out, but never let a mismatch crash the render
    const dimmed = e.fromGhost || e.toGhost;
    const backEdge = (layer.get(e.to) || 0) <= (layer.get(e.from) || 0);
    const x1 = from.cx, y1 = from.y + MAP_NODE_H, x2 = to.cx, y2 = to.y;
    let d;
    if (backEdge) {
      maxX = Math.max(maxX, x1 + BACK_EDGE_BOW, x2 + BACK_EDGE_BOW);
      d = `M${x1},${y1} C${x1 + BACK_EDGE_BOW},${y1} ${x2 + BACK_EDGE_BOW},${y2} ${x2},${y2}`;
    } else {
      const midY = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    }
    edgesSvg += `<path class="map-edge${backEdge ? ' back-edge' : ''}${dimmed ? ' ghost-edge' : ''}" d="${d}" marker-end="url(#map-arrow)"></path>`;
  });

  const width = maxX + MAP_PAD;
  const height = Math.max(MAP_NODE_H + MAP_PAD * 2, numLayers * (MAP_NODE_H + MAP_GAP_Y) - MAP_GAP_Y + MAP_PAD * 2);

  // card #91, groomed requirement 3 (investigate before changing): checked
  // this function at baseline (commit 7580da3, pre-#91) for any existing
  // priority/blocked border cue on a map node — there was none. The node's
  // group class there carried only ghost/missing/archived/selectable state,
  // same as below; the rect's stroke was 100% status color (card #57), with
  // no separate accent for priority or dependency edges. So requirement 3's
  // conditional ("if a border cue exists for blocked, leave it and note it")
  // never triggered at the time: nothing to preserve, nothing invented — that
  // card added exactly the two indicators requirement 1/2 called for (status
  // dot, epic dot) and no more. Card #107 later asked for the omitted cue
  // explicitly — see the `.high`/`.waiting` classes below (epic #137 renamed
  // #107's amber `.blocked` stroke to `.waiting`), one deliberate addition
  // to the rect's border channel, not a reopening of #91's dot work.
  let nodesSvg = '';
  for (const [id, p] of pos) {
    const n = allById.get(id);
    if (!n) continue;
    const missing = !!n.missing;
    // card #39: only REAL nodes join the shared card-el grammar (selection +
    // context menu). Ghost stubs stay click-through-to-detail only: a ghost
    // stands for a card the active search filter deliberately hid, and the
    // board never lets a filtered-out card join a selection (it isn't rendered
    // there at all) — so its stub must not smuggle hidden cards into a bulk
    // batch either. Archived cards that MATCH the filter render as real nodes
    // and are selectable (card #34). A `missing` stub has no card to act on.
    const selectable = !n.ghost && !missing;
    // card #91: the node border is one neutral weight for every node (see
    // .map-node rect in app.css) — status and epic no longer fight over that
    // single stroke channel with each other or with archive (card #57/#59's
    // old contract). `archived` still rides the group class: its neutral-grey
    // border mute is the one exception the card names, same as selection glow
    // / ghost dashing / the back-edge amber all keeping their own treatments.
    // card #107: priority/waiting join that same channel — same board-tile
    // parity `priorityBadge`+`isWaiting` gives cardEl (app.js), reused
    // straight off the node's own `priority`/`waiting` fields (computed once
    // in dependency-graph.js, structural — no config needed there) instead of
    // re-deriving from a full card lookup. Mutually exclusive with `archived`,
    // same as the board: archiveCardEl never applies pb.className/waiting
    // either, so an archived node keeps ONLY its grey mute, never both cues
    // fighting over one stroke. epic #137 renamed the amber cue: the stroke
    // marks WAITING (unresolved waiting_for deps — it inherits the old
    // blocked visual slot); the manual blocked sticker is the separate red
    // pill below, not a border.
    const pb = (!missing && !n.archived) ? priorityBadge(n, state.priorities) : { className: '' };
    const cls = `map-node${n.ghost ? ' ghost' : ''}${missing ? ' missing' : ''}${n.archived ? ' archived' : ''}` +
      `${pb.className ? ` ${pb.className}` : ''}${(!missing && !n.archived && n.waiting) ? ' waiting' : ''}` +
      `${selectable ? ' card-el' : ''}${selectable && selectedIds.has(id) ? ' selected' : ''}`;
    const idLabel = `#${id}`;
    const titleLine = missing ? '(not found)' : truncateLabel(n.title, 22);
    const tooltip = missing
      ? `#${id} — referenced but not found on the board`
      : `#${id} ${n.title}${n.archived ? ' (archived)' : ''}`;
    // card #91: status moved off the border onto its own dot — a filled
    // circle colored exactly like the old rect stroke. card #31's non-built-in
    // status (custom column or unlisted on-disk value) still has no CSS rule
    // to reach for, so it's inlined the same deterministic hash the rect used
    // to carry. card #102 REOPEN (STATUS DOTS NEVER MUTE): this used to gate
    // off archived nodes so the CSS mute rule beneath always won for a parked
    // pre-archive status (card #57) — that gate is GONE now, so a custom
    // status hashes its color on an archived node exactly like a live one; the
    // archived cue is carried by the rect border alone (the one exception).
    // The dot's OWN <title> — SVG-native tooltip — names the RAW on-disk
    // status for every node, not just custom ones (the old tooltip suffix
    // only covered the custom case; the dot is a strict superset).
    const customStatus = !missing && !isBuiltinStatus(n.status);
    const statusDotStyle = customStatus ? ` style="fill:${statusColor(n.status)}"` : '';
    const statusDot = missing ? '' :
      `<circle class="map-status-dot status-${mapStatusClass(n.status)}" cx="${MAP_NODE_W - 10}" cy="10" r="4"${statusDotStyle}><title>${escapeHtml(n.status)}</title></circle>`;
    // card #91: the epic dot REPLACES #59's orange border/stroke everywhere
    // epic showed on the map. Unlike the old single shared channel, this dot
    // doesn't compete with the archived border mute: epic is a durable
    // identity, not a location, so it keeps showing on an archived node —
    // and since card #102's reopen, the status dot beside it does too.
    const epicDot = n.epic ? `<circle class="map-epic-dot" cx="${MAP_NODE_W - 10}" cy="${MAP_NODE_H - 10}" r="4"><title>Epic</title></circle>` : '';
    // card #102 FINAL DESIGN ("an additional ball gray for archived"): the
    // third right-edge dot, only for a truly archived node — same x column as
    // status/epic (MAP_NODE_W - 10, already proven clear of the truncated
    // title text), vertically centered between them (MAP_NODE_H grew from 46
    // to 58 for exactly this — see the constant's own comment) so all three
    // sit ~19px apart, well past the "must not render fused" minimum #97
    // used for the HTML dots. Never set for a `missing` stub (its `archived`
    // is always false — dependency-graph.js's own stub shape).
    const archivedDot = n.archived ? `<circle class="map-archived-dot" cx="${MAP_NODE_W - 10}" cy="${MAP_NODE_H / 2}" r="4"><title>Archived</title></circle>` : '';
    // epic #137: the red blocked pill — the map twin of the board tile's
    // sticker glyph, bottom-left under the title where no dot column lives.
    // The pill's own <title> carries the reason (SVG-native tooltip; the
    // reason is user data, escaped like every other user string in this
    // SVG). Skipped for missing stubs (no card behind them) but NOT gated
    // off archived — a stop sign is identity, not location, and unlike
    // #107's stroke it doesn't share a channel with the archived grey mute.
    const blockedPill = (!missing && n.blocked)
      ? `<g class="map-blocked-pill"><title>${escapeHtml(n.blockedReason ? `blocked: ${n.blockedReason}` : 'blocked')}</title>` +
        `<rect x="8" y="${MAP_NODE_H - 18}" width="46" height="13" rx="6.5"></rect>` +
        `<text x="31" y="${MAP_NODE_H - 8}" text-anchor="middle">blocked</text></g>`
      : '';
    nodesSvg +=
      `<g class="${cls}" transform="translate(${p.x},${p.y})"${missing ? '' : ` data-id="${id}"`}>` +
        `<title>${escapeHtml(tooltip)}</title>` +
        `<rect width="${MAP_NODE_W}" height="${MAP_NODE_H}" rx="6"></rect>` +
        `<text x="10" y="18" class="map-node-id">${escapeHtml(idLabel)}</text>` +
        `<text x="10" y="34" class="map-node-title">${escapeHtml(titleLine)}</text>` +
        statusDot + epicDot + archivedDot + blockedPill +
      `</g>`;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'map-canvas');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML =
    `<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z"></path></marker></defs>` +
    edgesSvg + nodesSvg;
  return svg;
}

async function fetchBoard() {
  return api('GET', '/api/board');
}

// document.title is a plain-text property (never HTML-parsed), so the raw name goes
// there directly — running it through escapeHtml first would show literal "&amp;"
// entities in the tab instead of "&". The heading span IS DOM markup (innerHTML), so
// it gets escapeHtml like every other filesystem/card-derived string in this file.
// Project name leads the tab title (not the heading) because that's the field that
// gets truncated when several kanban tabs are open side by side — the whole point of
// card #16 is telling those tabs apart at a glance.
function applyProjectName(name) {
  const next = name || '';
  if (next !== state.projectName) {
    // The persisted-state caches (collapse/sort/fullscreen/view mode) memoize
    // on first access, and their storage key is namespaced by projectName. A
    // render that fires before the first /api/board response (typing in search,
    // an early "+ New card" click) would seed them from kanban.default.* and
    // then clobber the real per-project values on the next save — so any
    // projectName change invalidates all of them, forcing a re-load under the
    // correct key on next access.
    collapsedColumns = null;
    columnSort = null;
    modalFullscreen = null;
    viewMode = null; // card #37: view.mode joined the same discipline
    mapStatusFilter = null; // card #56: map.statusFilter too
    calendarSubview = null; // card #58: calendar.subview too
    mapSectionsCollapsed = null; // card #97: map.sections.collapsed too
    ganttStatusFilter = null; // card #98: gantt.statusFilter too (verify finding: this was missing — applyStatuses' own reset doesn't fire on a pure rename with an unchanged status list)
    calendarStatusFilter = null; // card #99: calendar.statusFilter too, same #98 review-fix precedent
  }
  state.projectName = next;
  document.title = name ? `${name} — Kanban` : 'Kanban App';
  $('#project-name').innerHTML = name ? ` — ${escapeHtml(name)}` : '';
}

function applyBoardData(data) {
  state.active = data.active;
  state.archived = data.archived;
  state.boardDir = data.boardDir || ''; // card #55: absolute board path for the header copy button (defensive ||: an old server without the field degrades to the honest empty-path toast)
  applyProjectName(data.projectName); // must run before renderBoard: collapse state's storage key is namespaced by projectName
  applyStatuses(data.statuses || []); // card #31: must also run before renderBoard — the column set drives every render below
  // card #27: the registry feeds the form's assignee suggestions — and since
  // card #46 it's a render input too (the Assignee sort ranks by registry
  // order), so it must ALSO run before renderBoard: a persisted Assignee sort
  // is live on the very first paint after reload, and rendering with the
  // seeded-empty registry degrades it to plain lexicographic until the next
  // poll silently reshuffles the column.
  applyAssignees(data.assignees || []);
  // card #30: official lists feed the form's comboboxes — before renderBoard
  // for the same reason: the Priority sort/badges read state.priorities at
  // render time (masked pre-move only by priorityRank's built-in fallback).
  applyLists(data.priorities || [], data.tags || []);
  selectedIds = pruneSelection(selectedIds, [...state.active, ...state.archived].map((c) => c.id)); // card #25: drop ghosts before render (archived joined the domain, #34)
  renderBoard();
  applyNotifications(data.notifications || []); // card #22: the board poll carries them — no separate timer
}

async function loadBoard() {
  applyBoardData(await fetchBoard());
}

// --- Auto-refresh: poll loadBoard() every 5s via the same path as the manual
// Refresh button, but never while the user is mid-interaction. The skip predicate
// itself lives in refresh-policy.js (pure, no DOM) so it's unit-testable from Node;
// this just gathers the current DOM/drag/visibility state and asks it.
const AUTO_REFRESH_MS = 5000;
let isDragging = false;
// Count of in-flight onDrop() calls: optimistic update applied, PATCH not yet
// settled. dragend already fires before the PATCH resolves, so isDragging alone
// leaves a window where a poll can land mid-flight and clobber the optimistic
// move; this closes it without being fooled by rapid back-to-back drops.
let pendingDrops = 0;
let autoRefreshStale = false;

// Any open modal — edit form, detail popup, or any future popup that follows the
// same .modal-backdrop + .hidden convention (e.g. an AI-assist popup) — blocks a poll.
function anyModalOpen() {
  return !!document.querySelector('.modal-backdrop:not(.hidden)');
}

// Card #18's sort controls live inside #board, which renderBoard() wipes
// (innerHTML = '') on every render, including unattended poll ticks. The
// search input was deliberately kept outside #board to dodge this exact
// class of bug (see currentSearchTerms() above); the sort controls can't be,
// since they're per-column. Losing focus mid-render is a paper cut, but a
// focused <select> is worse: removing it from the document while its native
// option popup is open silently closes that popup with no error, cancelling
// whatever the user was about to pick. Treat a focused sort control as
// blocking a refresh the same way an open modal does.
function boardControlFocused() {
  const el = document.activeElement;
  // .cal-nav: calendar nav (card #37/#58); .column-add: the #54 header +;
  // .map-filter-toggle/.map-section-toggle: the #56/#97 map pills; .gantt-
  // filter-toggle: the #98 gantt pills; .calendar-filter-toggle: the #99
  // calendar pills (their views are wiped by every render). All focusable,
  // all rebuilt per render — a poll landing while one is focused would
  // silently dump keyboard focus to <body>.
  return !!(el && el.closest && el.closest('.column-sort-field, .column-sort-dir, .cal-nav, .column-add, .map-filter-toggle, .map-section-toggle, .gantt-filter-toggle, .calendar-filter-toggle'));
}

function setStale(stale) {
  if (stale === autoRefreshStale) return;
  autoRefreshStale = stale;
  $('#stale-indicator').classList.toggle('hidden', !stale);
}

function autoRefreshSkipState() {
  return {
    modalOpen: anyModalOpen(),
    dragging: isDragging || pendingDrops > 0,
    hidden: document.visibilityState !== 'visible',
    boardControlFocused: boardControlFocused(),
  };
}

async function autoRefreshTick() {
  if (shouldSkipAutoRefresh(autoRefreshSkipState())) return;
  try {
    const data = await fetchBoard();
    // Re-check: a drag/modal/hide can start while this request was in flight.
    // Drop the response rather than render over an interaction that started
    // mid-poll — the next tick (or the interaction's own completion) catches up.
    if (shouldSkipAutoRefresh(autoRefreshSkipState())) return;
    applyBoardData(data);
    setStale(false);
  } catch (e) {
    setStale(true); // quiet: no toast storm on repeated failures, just a subtle indicator; recovers silently above
  }
}

// Card #34 (archive column parity): every tile drags and every column —
// Archive included — accepts drops. A drop on Archive archives the batch; a
// drop of archived cards on a live column restores them there. Routing
// happens at drop time: anything touching archive goes through dragPlan's
// confirm matrix, pure live→live keeps the old paths untouched.
function wireDrag() {
  $('#board').querySelectorAll('.card').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
      isDragging = true;
      // Card #25: dragging a selected card while others are selected drags the
      // whole selection. Captured at dragstart — the flag, not the live set,
      // decides at drop time, so a poll pruning the set mid-drag can't flip
      // a bulk drag into a single-card one halfway through.
      bulkDragIds = (selectedIds.has(Number(el.dataset.id)) && selectedIds.size > 1) ? [...selectedIds] : null;
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      isDragging = false;
      bulkDragIds = null; // drop (if any) already consumed it — this catches cancelled drags, which would otherwise replay a stale bulk move
    });
  });
  document.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const ids = bulkDragIds || [id];
      bulkDragIds = null;
      const dest = col.dataset.col;
      const touchesArchive = dest === 'archive' || ids.some((i) => state.archived.some((a) => a.id === i));
      if (touchesArchive) archiveAwareDrop(ids, dest);
      else if (ids.length > 1) onBulkDrop(ids, dest);
      else onDrop(ids[0], dest);
    });
  });
}

// Drops that touch archive in either direction (card #34). No optimistic
// render — a file move plus a status write isn't worth faking; the confirm
// already broke the gesture's flow, so the loadBoard round-trip is fine.
async function archiveAwareDrop(ids, dest) {
  const byId = new Map([...state.active, ...state.archived].map((c) => [c.id, c]));
  const plan = dragPlan(ids, byId, dest, refusesDoing);
  const actionable = plan.toArchive.length + plan.toRestore.length + plan.toMove.length;
  if (!actionable && !plan.refused.length) return;
  if (plan.confirmMessage && !confirm(plan.confirmMessage)) return;
  pendingDrops++;
  const failed = [];
  try {
    for (const c of plan.toArchive) {
      try { await api('POST', `/api/cards/${c.id}/archive`); }
      catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    for (const c of plan.toRestore) {
      try {
        await api('POST', `/api/cards/${c.id}/restore`);
        if (c.status !== dest) await api('PATCH', `/api/cards/${c.id}`, { status: dest });
      } catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    for (const c of plan.toMove) {
      try { await api('PATCH', `/api/cards/${c.id}`, { status: dest }); }
      catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    await loadBoard();
  } finally {
    pendingDrops--;
  }
  const parts = [];
  if (plan.toArchive.length) parts.push(`Archived ${plan.toArchive.length - failed.filter((f) => plan.toArchive.some((c) => f.startsWith(`#${c.id} `))).length} card(s)`);
  const landed = plan.toRestore.length + plan.toMove.length;
  if (landed) parts.push(`moved ${landed - failed.filter((f) => !plan.toArchive.some((c) => f.startsWith(`#${c.id} `))).length} to ${dest}${plan.toRestore.length ? ` (${plan.toRestore.length} restored)` : ''}`);
  if (plan.refused.length) parts.push(`skipped ${plan.refused.map((c) => `#${c.id} (${refusalWord(c)})`).join(', ')}`);
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  if (parts.length) toast(parts.join('; ') + '.');
}

async function onDrop(id, status) {
  const card = state.active.find((c) => c.id === id);
  // A drop onto the column the card already RENDERS in is a no-op — for a
  // parked unlisted status that also means never silently rewriting the raw
  // value the catch-all promised to preserve (card #31 verify finding).
  if (!card || columnForStatus(card.status, state.statuses) === status) return;
  if (status === 'doing' && refusesDoing(card)) { // client-side pre-check (server also enforces); names which gate (epic #137)
    toast(`#${id} is ${isWaiting(card)
      ? `waiting on ${waitingOn(card).map((w) => `#${w.id} (${w.status})`).join(', ')}`
      : blockedLabel(card.blocked)} — can't move to doing.`);
    return;
  }
  const prev = card.status;
  card.status = status;           // optimistic
  renderBoard();
  pendingDrops++;                 // keep auto-refresh skipping through the network round-trip too, not just the DOM gesture (dragend already fired by now)
  try {
    await api('PATCH', `/api/cards/${id}`, { status });
    await loadBoard();            // resync with disk immediately, in case a poll slipped through mid-flight and needs correcting
  } catch (e) {
    card.status = prev;           // revert
    renderBoard();
    if (e.status === 422) {
      toast(`#${id} is ${gate422Text(e.data)} — can't move to doing.`);
    } else {
      toast('Move failed: ' + e.message);
    }
  } finally {
    pendingDrops--;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadBoard().catch((e) => toast('Load failed: ' + e.message));
  $('#board-copy-btn').addEventListener('click', copyBoardPath); // card #55
  $('#refresh-btn').addEventListener('click', () =>
    loadBoard().then(() => setStale(false)).catch((e) => toast('Refresh failed: ' + e.message)));
  setInterval(autoRefreshTick, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoRefreshTick();
  });
});

// card #31: the status <select>'s options come from the board's statuses
// list, rebuilt on every open. A card whose on-disk status isn't listed gets
// that raw value appended (marked "unlisted") and selected — so opening and
// saving the form never silently rewrites an unpromoted status.
function renderStatusOptions(current) {
  const statuses = boardStatuses();
  const opts = statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`);
  if (current !== null && !statuses.includes(current)) {
    opts.push(`<option value="${escapeHtml(current)}">${escapeHtml(current)} (unlisted)</option>`);
  }
  $('#f-status').innerHTML = opts.join('');
}

// card #85: physically moves the assignee+dates row instead of faking its
// minimal-mode position with flex `order` — `order` only repaints, it does
// not retarget Tab, so DOM/tab order stayed Title -> "Show more fields" ->
// Assignee even though the row visually painted between them (a WCAG 2.4.3
// focus-order bug, audit #85 defect 2). assigneeRowHome is the row's ORIGINAL
// next sibling (the Description label), captured once before any move ever
// happens; re-inserting before it restores the exact #47 full-form slot,
// byte-identical, every time minimal lifts (expand or edit).
const assigneeRow = $('#row-assignee-dates');
const assigneeRowHome = assigneeRow.nextElementSibling;
function placeAssigneeRow(minimal) {
  if (minimal) $('#show-more-btn').before(assigneeRow);
  else assigneeRowHome.before(assigneeRow);
}

// epic #137: the blocked input wears a red border exactly while its value
// would gate (passes the shared predicate) — colorless otherwise, so
// `false` / whitespace / junk visibly read as "not a sticker" while typing.
function syncBlockedInputStyle() {
  $('#f-blocked').classList.toggle('blocked-active', isBlockedValue($('#f-blocked').value));
}

// card #54: presetStatus (a live column id — always a listed status, so
// renderStatusOptions already carries it) aims a new card at the column whose
// + was clicked. The hidden #f-status field submits it even while the form is
// minimal (#50), and "Show more fields" reveals the dropdown with it selected.
// No preset (the global "+ New card" button) keeps the first-column default.
function openModal(card, presetStatus) {
  $('#modal-title').textContent = card ? `Edit #${card.id}` : 'New card';
  $('#f-id').value = card ? card.id : '';
  $('#f-title').value = card ? card.title : '';
  renderStatusOptions(card ? card.status : null);
  $('#f-status').value = card ? card.status : (presetStatus || boardStatuses()[0]);
  $('#f-priority').value = card ? card.priority : 'Normal';
  $('#f-tags').value = card ? card.tags.join(', ') : '';
  $('#f-waiting').value = card ? card.waiting_for.join(', ') : '';
  $('#f-blocked').value = card && card.blocked ? card.blocked : '';
  syncBlockedInputStyle(); // epic #137: red border iff the value passes the predicate
  $('#f-assignee').value = card && card.assignee ? card.assignee : '';
  $('#f-start').value = card && card.start_date ? card.start_date : ''; // card #36
  $('#f-end').value = card && card.end_date ? card.end_date : ''; // card #40: the triad's "to"
  $('#f-due').value = card && card.due_date ? card.due_date : '';
  $('#f-epic').checked = card ? !!card.epic : false; // card #59: edit preserves the flag; create starts unchecked
  $('#f-body').value = card ? card.body : '';
  formSnapshot = snapshotFormFields(); // dirty baseline for backdrop-close (card #26)
  // card #50: create opens minimal (Title + "Show more fields"), edit always
  // full. expanded=false on EVERY open — the reveal is one-way per open and
  // never persisted. The hidden fields already hold the defaults set above,
  // so the snapshot and the save payload are the same as a full form's.
  const minimal = isMinimalCreate(Boolean(card), false);
  $('#card-form').classList.toggle('minimal', minimal);
  placeAssigneeRow(minimal); // card #85: re-place on EVERY open, so edit never inherits a prior create's move
  $('#modal').classList.remove('hidden');
  applyModalFullscreen('edit'); // re-apply the persisted per-modal-type preference on every open
  if (!card) $('#f-title').focus(); // card #50: quick capture — cursor lands ready to type (after unhide; focus is a no-op on display:none)
}

function closeModal() { $('#modal').classList.add('hidden'); }

// Backdrop-close for the edit/new-card form (card #26): silent when the form
// is untouched, one confirm when typed work would be lost. Cancel/Save keep
// their existing behavior — explicit buttons are deliberate, only the easy-to-
// fat-finger backdrop click gets the guard.
let formSnapshot = null;

function snapshotFormFields() {
  return {
    title: $('#f-title').value, status: $('#f-status').value, priority: $('#f-priority').value,
    tags: $('#f-tags').value, waiting: $('#f-waiting').value, blocked: $('#f-blocked').value, assignee: $('#f-assignee').value,
    start: $('#f-start').value, end: $('#f-end').value, due: $('#f-due').value, body: $('#f-body').value, // card #36/#40: the whole date triad joins the dirty baseline
    epic: $('#f-epic').checked, // card #59: a toggled checkbox is typed work too (isDirty compares booleans fine)
  };
}

function requestCloseModal() {
  if (isDirty(formSnapshot, snapshotFormFields()) &&
      !confirm('Discard unsaved changes to this card?')) return;
  closeModal();
}

function parseIds(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
}
function parseTags(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

async function submitModal(e) {
  e.preventDefault();
  const id = $('#f-id').value;
  const payload = {
    title: $('#f-title').value.trim(),
    status: $('#f-status').value,
    priority: $('#f-priority').value,
    tags: parseTags($('#f-tags').value),
    waiting_for: parseIds($('#f-waiting').value),
    // The sticker's raw text — the store's predicate-judged lean rule strips
    // an invalid/clear value (so a blank simply removes the line).
    blocked: $('#f-blocked').value.trim(),
    assignee: $('#f-assignee').value.trim(),
    start_date: $('#f-start').value.trim(), // card #36: empty string clears, same as due
    end_date: $('#f-end').value.trim(), // card #40: same clear contract
    due_date: $('#f-due').value.trim(),
    epic: $('#f-epic').checked, // card #59: false clears — the line is removed, never written as `epic: false`
    body: $('#f-body').value,
  };
  try {
    if (id) await api('PATCH', `/api/cards/${id}`, payload);
    else await api('POST', '/api/cards', payload);
    closeModal();
    await loadBoard();
  } catch (e2) {
    if (e2.status === 422) {
      toast(`Can't set doing — ${gate422Text(e2.data)}.`);
    } else {
      toast('Save failed: ' + e2.message);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('#new-btn').addEventListener('click', () => openModal(null));
  // X goes through the dirty guard (the retired Cancel button bypassed it —
  // backdrop-click and X now agree on the unsaved-changes speedbump)
  $('#modal-close').addEventListener('click', requestCloseModal);
  // card #50: revealing changes no field values, so the dirty baseline is untouched
  $('#show-more-btn').addEventListener('click', () => {
    const minimal = isMinimalCreate(false, true); // always false — expanding lifts minimal for the rest of the open
    $('#card-form').classList.toggle('minimal', minimal);
    placeAssigneeRow(minimal); // card #85: restore the row to its full-form #47 slot before Description
  });
  $('#card-form').addEventListener('submit', submitModal);
  $('#f-blocked').addEventListener('input', syncBlockedInputStyle); // epic #137: live red-border feedback
  $('#modal-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('edit'));
  // Single delegated listener on #board covers all five columns (renderBoard()
  // rebuilds the DOM every call — manual refresh, poll, drag, toggle — so
  // per-element listeners here would need constant rewiring; delegation on the
  // stable #board parent doesn't). Only board-specific controls live here since
  // card #39 — tile clicks (detail / selection gestures) moved to the document-level
  // shared card-el grammar in the multi-select section, one handler for all
  // four views. These button branches simply return; the shared handler
  // independently ignores clicks landing on buttons/selects, so a Restore
  // click inside a card-el tile never also opens its detail popup.
  $('#board').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.column-toggle');
    if (toggleBtn) { toggleColumn(toggleBtn.dataset.col); return; }
    const sortDirBtn = e.target.closest('.column-sort-dir');
    if (sortDirBtn) { toggleColumnSortDirection(sortDirBtn.dataset.col); return; }
    const addBtn = e.target.closest('.column-add');
    if (addBtn) { openModal(null, addBtn.dataset.col); return; } // card #54: create pre-aimed at this column

    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const id = Number(actBtn.dataset.id);
      if (actBtn.dataset.act === 'restore') doRestore(id);
      if (actBtn.dataset.act === 'delete-arch') doDelete(id);
    }
  });
  // Delegated 'change' listener (mirrors the click delegation above): the
  // sort-field <select> is rebuilt by every renderBoard() call same as
  // everything else in #board, so a per-element listener would need constant
  // rewiring — delegation on the stable #board parent doesn't.
  $('#board').addEventListener('change', (e) => {
    const sel = e.target.closest('.column-sort-field');
    if (sel) setColumnSortField(sel.dataset.col, sel.value);
  });
});

// Names the object in a confirm (card #26's speedbump policy): title when we
// know it, id otherwise.
function cardLabel(id) {
  const card = state.active.concat(state.archived).find((c) => c.id === id);
  return card ? `#${id} "${card.title}"` : `#${id}`;
}

// card #92: a done card archiving is completion, not a destructive act — skip
// the confirm when the card is already done (shared archiveNeedsConfirm rule,
// selection.js). A missing lookup (shouldn't happen — the button is only
// wired for live cards) falls back to confirming, the safe default.
async function doArchive(id, { onSuccess } = {}) {
  const card = state.active.find((c) => c.id === id);
  if ((!card || archiveNeedsConfirm([card])) && !confirm(`Archive ${cardLabel(id)}? (moves the file to archived/)`)) return;
  try { await api('POST', `/api/cards/${id}/archive`); if (onSuccess) onSuccess(); await loadBoard(); }
  catch (e) { toast('Archive failed: ' + e.message); }
}

// Restore is exempt from the speedbump policy (card #26): it's the reversible
// direction — archiving it back costs one click.
async function doRestore(id) {
  try { await api('POST', `/api/cards/${id}/restore`); await loadBoard(); }
  catch (e) { toast('Restore failed: ' + e.message); }
}

async function doDelete(id, { onSuccess } = {}) {
  if (!confirm(`Permanently delete ${cardLabel(id)}? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/cards/${id}`); if (onSuccess) onSuccess(); await loadBoard(); }
  catch (e) { toast('Delete failed: ' + e.message); }
}

// --- Card detail popup: rendered markdown body, frontmatter table, copy-path. ---
// Fetches the card's current on-disk content on open (server-backed, no snapshot
// staleness). Renderer + escaping ported from skills/dashboard's popup, which
// carries the fixes from that skill's XSS review: escapeHtml covers & < > " ',
// every interpolated value is escaped, and markdown link hrefs are scheme-checked.

// Minimal, dependency-free markdown -> HTML: headings, bold/italic, inline code,
// fenced code blocks, links, unordered lists (incl. `- [x]` task items), hr, paragraphs.
function mdToHtml(md) {
  const lines = escapeHtml(md).split('\n');
  let html = '';
  let inCode = false, codeBuf = [];
  let listOpen = false;
  let para = [];

  const flushPara = () => {
    if (para.length) { html += `<p>${para.join(' ')}</p>`; para = []; }
  };
  const closeList = () => {
    if (listOpen) { html += '</ul>'; listOpen = false; }
  };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, text, url) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(url.trim()) ? url : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

  for (const raw of lines) {
    const line = raw;

    if (line.trim().startsWith('```')) {
      if (inCode) { html += `<pre><code>${codeBuf.join('\n')}</code></pre>`; codeBuf = []; inCode = false; }
      else { flushPara(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^\s*---\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    const task = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    const item = line.match(/^\s*-\s+(.*)$/);
    if (task || item) {
      flushPara();
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        html += `<li class="task">${checked ? '&#9745;' : '&#9744;'} ${inline(task[2])}</li>`;
      } else {
        html += `<li>${inline(item[1])}</li>`;
      }
      continue;
    }
    closeList();

    if (line.trim() === '') { flushPara(); continue; }
    para.push(inline(line));
  }
  flushPara();
  closeList();
  if (inCode && codeBuf.length) html += `<pre><code>${codeBuf.join('\n')}</code></pre>`;
  return html;
}

// Frontmatter is flat `key: value` per line; split on the FIRST colon only so
// values that contain colons (e.g. URLs) survive intact. Handles extension
// fields (e.g. `parent:`) the same as any other key — nothing is allowlisted.
function parseFrontmatter(text) {
  return (text || '').split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const i = line.indexOf(':');
      return i === -1 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    });
}

function renderFrontmatterTable(pairs) {
  if (!pairs.length) return '';
  const rows = pairs.map(([k, v]) =>
    `<tr><td class="fm-key">${escapeHtml(k)}</td><td class="fm-value">${escapeHtml(formatFrontmatterValue(v))}</td></tr>`
  ).join('');
  return `<table>${rows}</table>`;
}

// navigator.clipboard needs a secure context; http://localhost qualifies, but the
// execCommand fallback is kept so the button never silently no-ops.
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.left = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

let copyResetTimer = null;

function resetCopyState() {
  if (copyResetTimer) { clearTimeout(copyResetTimer); copyResetTimer = null; }
  const btn = $('#detail-copy-btn');
  btn.textContent = 'Copy path';
  btn.classList.remove('copy-success', 'copy-failed');
}

function showCopyFeedback(success) {
  if (copyResetTimer) clearTimeout(copyResetTimer);
  const btn = $('#detail-copy-btn');
  btn.textContent = success ? 'Copied!' : 'Copy failed';
  btn.classList.toggle('copy-success', success);
  btn.classList.toggle('copy-failed', !success);
  copyResetTimer = setTimeout(resetCopyState, 1500);
}

function copyDetailPath() {
  const text = $('#detail-copy-btn').dataset.path || '';
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyFeedback(true),
      () => showCopyFeedback(fallbackCopy(text)),
    );
  } else {
    showCopyFeedback(fallbackCopy(text));
  }
}

// card #55: copy the board directory's ABSOLUTE path from the header title.
// Same clipboard ladder as copyDetailPath above — navigator.clipboard first,
// textarea+execCommand fallback second (VSCode's Simple Browser doesn't grant
// the async API a secure context, so the fallback is load-bearing there) —
// but feedback is a toast on BOTH outcomes: the header button is glyph-sized,
// no room for the detail button's "Copied!" label swap.
function copyBoardPath() {
  const text = state.boardDir || '';
  if (!text) { toast('Board path not loaded yet — Refresh.'); return; } // pre-first-poll click, or an old server payload without boardDir
  const done = (ok) => toast(ok ? `Copied: ${text}` : 'Copy failed — copy the path from a card popup instead.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    // Rejection (permissions, non-secure context) retries through the
    // fallback before reporting — same ladder as copyDetailPath above.
    navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  } else done(fallbackCopy(text));
}

let detailRequestId = 0;
let currentDetailId = null;
let currentDetailArchived = false;

// card #35: "Last modified" line — the `updated` frontmatter field when the
// card has one (machine-maintained, bumped on every write), else the file's
// mtime labeled as such (older cards predating the field). Both timestamps
// render local-time "YYYY-MM-DD | HH:MM:SS" (card #106); `updated` has no
// timezone suffix so it's already local, and `new Date(isoUtcMtime)` converts
// to the browser's local time same as any other Date getter.
function formatLocalDateTime(s) {
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} | ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// card #106: a raw local-datetime frontmatter value (e.g. `updated:
// 2026-07-10T09:36:31`, or a `start_date`/`end_date`/`due_date` carrying a
// time component) reads badly with its literal "T" separator — reuse
// formatLocalDateTime so every surface shows the same "YYYY-MM-DD | HH:MM:SS"
// shape. Date-only values (no "T") pass through untouched.
const LOCAL_DATETIME_VALUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function formatFrontmatterValue(v) {
  return LOCAL_DATETIME_VALUE_RE.test(v) ? formatLocalDateTime(v) : v;
}

function formatDetailModified(data) {
  if (data.updated) return `Last modified: ${escapeHtml(formatLocalDateTime(data.updated))}`;
  if (data.mtime) return `Last modified: ${escapeHtml(formatLocalDateTime(data.mtime))} (file mtime)`;
  return '';
}

async function openDetailModal(id) {
  const reqId = ++detailRequestId;
  let data;
  try { data = await api('GET', `/api/cards/${id}/detail`); }
  catch (e) { if (reqId === detailRequestId) toast('Load failed: ' + e.message); return; }
  if (reqId !== detailRequestId) return; // a newer openDetailModal call superseded this one
  currentDetailId = data.id;
  currentDetailArchived = !!data.archived;
  $('#detail-title').textContent = `#${data.id} ${data.title}`;
  $('#detail-path').textContent = data.path || '';
  $('#detail-copy-btn').dataset.path = data.path || '';
  resetCopyState();
  $('#detail-modified').innerHTML = formatDetailModified(data);
  $('#detail-frontmatter').innerHTML = renderFrontmatterTable(parseFrontmatter(data.frontmatter));
  $('#detail-body').innerHTML = mdToHtml(data.body || '');
  // Archived cards: Edit only knows about state.active, and Archive on an already-archived
  // card would rename the file again (never clobbers, but pointless/confusing) — hide both.
  // visibility, not .hidden: with the icons leading the header (card #61,
  // order:-1) the title's x-position is the group's width, so display:none
  // here would hop the title ~72px left between an active card's popup and an
  // archived one's. visibility keeps the two slots (and still drops the
  // buttons from hit-testing and tab order).
  $('#detail-edit-btn').style.visibility = currentDetailArchived ? 'hidden' : '';
  $('#detail-archive-btn').style.visibility = currentDetailArchived ? 'hidden' : '';
  $('#detail-modal').classList.remove('hidden');
  applyModalFullscreen('detail'); // re-apply the persisted per-modal-type preference on every open
}

function closeDetailModal() {
  detailRequestId++; // invalidate any in-flight fetch so it can't reopen the modal after close
  currentDetailId = null;
  currentDetailArchived = false;
  $('#detail-modal').classList.add('hidden');
}

// Edit layers the existing card-form modal over the (now closed) detail popup;
// closing first guarantees no stale detail view is left behind on return.
function editFromDetail() {
  if (currentDetailId == null || currentDetailArchived) return;
  const card = state.active.find((c) => c.id === currentDetailId);
  if (!card) { closeDetailModal(); toast('Card not found — Refresh.'); return; }
  closeDetailModal();
  openModal(card);
}

window.addEventListener('DOMContentLoaded', () => {
  $('#detail-close').addEventListener('click', closeDetailModal);
  $('#detail-copy-btn').addEventListener('click', copyDetailPath);
  $('#detail-edit-btn').addEventListener('click', editFromDetail);
  $('#detail-archive-btn').addEventListener('click', () => {
    // Belt-and-suspenders: the button is hidden for archived cards, but never
    // let this path reach doArchive on one even if that ever fails to apply.
    if (currentDetailId != null && !currentDetailArchived) doArchive(currentDetailId, { onSuccess: closeDetailModal });
  });
  $('#detail-delete-btn').addEventListener('click', () => {
    if (currentDetailId != null) doDelete(currentDetailId, { onSuccess: closeDetailModal });
  });
  $('#detail-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('detail'));
  $('#detail-modal').addEventListener('click', (e) => { if (e.target.id === 'detail-modal') closeDetailModal(); });
  // Esc priority (card #96, replacing #20's "first Esc exits fullscreen,
  // second Esc closes" chain): fullscreen is out of the picture entirely now.
  // An open detail popup closes on the very first Esc regardless of its
  // fullscreen state. The edit/new-card modal now closes on Esc too — through
  // requestCloseModal(), the exact same #26 unsaved-changes guard the X button
  // uses (card #20 left this modal's Esc as a no-op; #96 wires it up). Esc
  // never calls setModalFullscreenVisual any more, so the persisted preference
  // and the toggle button's state are untouched by it either way — the toggle
  // button is the only thing that changes fullscreen now. verify finding: the
  // three bulk-edit popups (bulkSingle/Tags/Schedule) are ALSO fullscreen-
  // capable (see FULLSCREEN_MODALS) and used to at least exit fullscreen on
  // the first Esc via the old (now-removed) step — closeAnyBulkPopup() closes
  // whichever one is open directly, matching the detail/edit popups above and
  // its own backdrop-click, so Esc is never a true no-op there. #95's
  // combobox menu still gets first crack at Esc when open — attachCombobox's
  // own keydown listener stops propagation before this document-level
  // listener ever sees the key, so nothing here needs to special-case it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#context-menu').classList.contains('hidden')) { hideContextMenu(); return; }
    if (!$('#notif-modal').classList.contains('hidden')) { closeNotifModal(); return; }
    if (!$('#detail-modal').classList.contains('hidden')) { closeDetailModal(); return; }
    if (!$('#modal').classList.contains('hidden')) { requestCloseModal(); return; }
    if (closeAnyBulkPopup()) return;
    if (anyModalOpen()) return; // defensive catch-all: any future .modal-backdrop popup not listed above
    clearSearch();
  });
  // Alt+Enter (card #145): toggle fullscreen on whichever fullscreen-capable
  // popup is open — the keyboard twin of that popup's toggle button, going
  // through the same toggleModalFullscreen so the persisted per-modal-type
  // preference updates identically. Works with focus anywhere inside the
  // popup (form fields included — preventDefault keeps the chord away from
  // implicit form submission); attachCombobox's Enter handling exempts
  // alt-chorded Enter, so the hotkey wins even while a suggestion menu is
  // open. No popup open = plain no-op.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const type = openFullscreenModalType();
    if (!type) return;
    e.preventDefault();
    toggleModalFullscreen(type);
  });
});

// --- Search box wiring (card #17): live filter-as-you-type, clear button,
// `/` focuses the box (skipped while any input/textarea/select/contentEditable
// already has focus, so it doesn't hijack typing elsewhere — including inside
// either modal, whose fields are all one of those tag names).
function clearSearch() {
  const input = $('#search-input');
  if (!input || !input.value) return;
  input.value = '';
  renderBoard();
}

window.addEventListener('DOMContentLoaded', () => {
  const input = $('#search-input');
  input.addEventListener('input', () => renderBoard());
  $('#search-clear-btn').addEventListener('click', clearSearch);
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    e.preventDefault();
    input.focus();
  });
});

// --- Map view wiring (card #19; reshaped by #39): top-bar toggle + the bits
// the shared card-el grammar does NOT cover. #map-view is rebuilt from
// scratch by every renderMapView() call (manual/poll/drag/toggle alike, same
// as #board's cards), so clicks use event delegation on the stable #map-view
// parent. Real nodes and the isolated row's tiles carry card-el + data-id
// (see buildMapSvg/buildIsolatedRow) and are handled by the document-level
// grammar handlers in the multi-select section — click-to-detail,
// ctrl/shift-click selection, right-click menu, all shared. What stays here:
// - an archived isolated tile's Restore/Delete buttons (data-act) — checked
//   FIRST, same ordering as #board's delegated listener, so a click on a
//   button nested inside a card-el tile triggers the action (the shared
//   handler independently ignores clicks landing on buttons);
// - ghost stubs with real card data behind them: click-through to detail
//   only, deliberately NOT card-el (see buildMapSvg's selectable note), so
//   "jump to a hidden dep's detail" still works straight from the stub.
//   A `missing` stub (a waiting_for id with no matching card at all) has
//   nothing to open and never gets data-id.
window.addEventListener('DOMContentLoaded', () => {
  $('#map-toggle-btn').addEventListener('click', () => toggleView('map'));
  $('#map-view').addEventListener('click', (e) => {
    // card #97: section collapse toggles — control-row buttons, checked first
    // for the same reason the #56 pills and data-act buttons are (never fall
    // through to card-el).
    const sectionBtn = e.target.closest('.map-section-toggle[data-section]');
    if (sectionBtn) {
      toggleMapSection(sectionBtn.dataset.section);
      return;
    }
    // card #56: status-filter pills — control-row buttons, checked first for
    // the same reason data-act buttons are (never fall through to card-el).
    const filterBtn = e.target.closest('.map-filter-toggle[data-col]');
    if (filterBtn) {
      toggleMapStatusFilter(filterBtn.dataset.col);
      return;
    }
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const id = Number(actBtn.dataset.id);
      if (actBtn.dataset.act === 'restore') doRestore(id);
      if (actBtn.dataset.act === 'delete-arch') doDelete(id);
      return;
    }
    const stub = e.target.closest('.map-node.ghost[data-id]');
    if (stub) openDetailModal(Number(stub.dataset.id));
  });
  // card #101: right-click a status-filter pill SOLOs it (every other pill
  // off); right-click the already-soloed pill again restores all ON. Own
  // listener (not folded into the click one above) so it can preventDefault
  // WITHOUT touching the browser's context menu anywhere else in #map-view —
  // a right-click that misses a pill falls through untouched to the #39
  // shared card-el contextmenu handler on document (map nodes/isolated tiles
  // keep their bulk-menu right-click exactly as before).
  $('#map-view').addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // same #39 guard (app.js ~3006) — a chorded right-click mid-drag must not re-render under the gesture
    const filterBtn = e.target.closest('.map-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloMapStatusFilter(filterBtn.dataset.col);
  });
});

// --- Calendar view (card #37; sub-views by card #58) ---------------------------
// Month grid + chips + drag-to-reschedule, plus the Outlook/Teams-style
// Month | Week | 3 days | Day switcher. All date math and layout construction
// live in calendar-model.js (pure, unit-tested, dual-environment); everything
// below is presentation and API glue. LIVE cards (state.active) by default —
// the calendar answers "when is work due", and archived cards aren't work —
// but dated ARCHIVED cards can join too, opt-in via the Archive pill (card
// #108), same "show it if the human asks" reasoning as the gantt's own #98
// reopen.
//
// The displayed window is ONE in-memory anchor day for all four sub-views
// (card #58 replaced #37's {year,monthIndex} cursor — the month view derives
// y/m from it, so the window carries across sub-view switches): it resets to
// today on page load and survives the 5s poll's re-render by construction
// (renderCalendarView reads it, nothing in the render path resets it — only
// the prev/next/Today controls write it).
let calendarAnchor = null;

function currentCalendarAnchor() {
  if (!calendarAnchor) calendarAnchor = localTodayStr();
  return calendarAnchor;
}

function currentCalendarMonth() {
  const [y, m] = currentCalendarAnchor().split('-').map(Number);
  return { year: y, monthIndex: m - 1 };
}

// card #58: the sub-view choice persists per board — same memoize-once
// localStorage discipline as viewMode above (feature key 'calendar.subview',
// validated by mergeCalendarSubview: unknown/corrupt saved values fall back
// to month).
let calendarSubview = null;

function loadCalendarSubview() {
  if (calendarSubview) return calendarSubview;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'calendar.subview')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to month
  calendarSubview = mergeCalendarSubview(saved);
  return calendarSubview;
}

function saveCalendarSubview() {
  try { localStorage.setItem(storageKey(state.projectName, 'calendar.subview'), calendarSubview); }
  catch (e) { /* storage unavailable/full — sub-view choice just won't persist this session */ }
}

function setCalendarSubview(subview) {
  if (!CALENDAR_SUBVIEWS.includes(subview) || subview === loadCalendarSubview()) return;
  calendarSubview = subview;
  saveCalendarSubview();
  renderCalendarView();
}

// Local time on purpose (matches the user's wall clock, same as card #35's
// formatLocalDateTime) — the grid itself is built with UTC math but its "is
// this cell today" check must agree with the calendar on the user's wall.
function localTodayStr() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function calendarChipEl(card, pos, time, isDue) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // same emphasis rules as the board tiles (card #30)
  // card #39: chips join the shared card-el grammar. Selection is by id, so
  // every chip of a multi-day run paints .selected together — they all read
  // the same selectedIds entry on this render. The #40 deadline chip keeps
  // its distinct class on top of the grammar.
  // card #91: epic is the shared dot glyph now, not a border class (#59) — the
  // priority/waiting/due rules below need no gating, nothing left to win over.
  // card #108: same for archived — priority/waiting keep applying regardless
  // (matching the gantt bar's precedent: colorStatus/mute is a SEPARATE
  // channel from the border accent, so an archived-and-high card still reads
  // high). archived rides the class list too, for the not-allowed cursor.
  // epic #137: the amber accent marks WAITING (renamed from the old blocked
  // visuals); the manual blocked sticker's red pill lives on tiles + map
  // only, per the card's display rules.
  el.className = `cal-chip card-el ${pos}` + (isDue ? ' cal-chip-due' : '') +
    (pb.className ? ` ${pb.className}` : '') + (isWaiting(card) ? ' waiting' : '') +
    (card.archived ? ' archived' : '') +
    (selectedIds.has(card.id) ? ' selected' : '');
  // defect fix (same class as the gantt's #98 reopen): an archived card is
  // read-only — native drag simply never starts (no fake-drag animation to
  // guard against, unlike the gantt's custom pointer-drag), so onCalendarDrop
  // never gets called for it in the first place.
  el.draggable = !card.archived;
  el.dataset.id = card.id;
  // card #40: the due marker is a DIFFERENT chip from the range run — the drop
  // handler must know which one was picked up (range drag moves the range pair,
  // due drag moves due_date alone), so the deadline chip flags itself.
  if (isDue) el.dataset.due = '1';
  // Time-of-day only where the chip represents the moment itself (single /
  // range-end / the due marker) — a range's start/mid days repeating the end
  // time would misread.
  const timeLabel = time && (pos === 'single' || pos === 'range-end') ? `${escapeHtml(time)} ` : '';
  const glyph = isDue ? '<span class="cal-chip-due-glyph">⚑</span> ' : ''; // ⚑ deadline flag before the text (card #40)
  // card #97: the status dot rides right after the epic dot, both still
  // before the title — the dense-chip width the card warns about is handled
  // exactly like #91's epic dot: nowrap+ellipsis on .cal-chip only ever crops
  // the TAIL (the title), never the id/dots near the front.
  // card #108: archived joins epic+status — same "epic, status, archived"
  // glyph order every other surface uses (Archived ball, card #102 final
  // design), gated on the chip's own card.archived flag.
  el.innerHTML = `${glyph}${timeLabel}<span class="cal-chip-id">#${card.id}</span>${card.epic ? epicBadge() : ''}${statusBadge(card)}${card.archived ? archivedBadge() : ''} ${escapeHtml(card.title)}`;
  const readOnlyHint = 'Archived — restore the card to reschedule';
  el.title = `#${card.id} ${card.title}${isDue ? ' — due' : ''}${card.archived ? ` — ${readOnlyHint}` : ''}`; // plain-text property — full title survives the CSS truncation
  return el;
}

// card #58: the sub-view label set for the switcher + the nav buttons' spans.
const CAL_SUBVIEW_LABELS = { month: 'Month', week: 'Week', '3day': '3 days', day: 'Day' };

function renderCalendarView() {
  const container = $('#calendar-view');
  const subview = loadCalendarSubview();
  // Preserve the time grid's scroll across re-renders (poll included) — same
  // keepLeft/keepTop discipline as renderMapView. null = first paint.
  const prevScroll = container.querySelector('.cal-tg-scroll');
  const keepScroll = prevScroll ? prevScroll.scrollTop : null;
  container.innerHTML = '';

  const spanNoun = { month: 'month', week: 'week', '3day': '3 days', day: 'day' }[subview];
  const controls = document.createElement('div');
  controls.className = 'cal-controls';
  controls.innerHTML =
    `<button type="button" id="cal-prev-btn" class="cal-nav" title="Previous ${spanNoun}" aria-label="Previous ${spanNoun}">&#8249;</button>` +
    `<button type="button" id="cal-today-btn" class="cal-nav" title="Jump back to today">Today</button>` +
    `<button type="button" id="cal-next-btn" class="cal-nav" title="Next ${spanNoun}" aria-label="Next ${spanNoun}">&#8250;</button>` +
    `<span class="cal-title">${escapeHtml(subviewTitle(subview, currentCalendarAnchor()))}</span>` +
    // card #58: the sub-view switcher. cal-nav class on purpose: it joins the
    // focused-control poll guard AND the Q0 clear-selection exemption, same
    // as prev/today/next (these buttons are rebuilt every render too).
    `<span class="cal-subview-switch" role="group" aria-label="Calendar span">` +
    CALENDAR_SUBVIEWS.map((sv) =>
      `<button type="button" class="cal-subview-btn cal-nav${sv === subview ? ' active' : ''}" ` +
        `data-subview="${sv}" aria-pressed="${sv === subview}">${CAL_SUBVIEW_LABELS[sv]}</button>`).join('') +
    `</span>`;
  container.appendChild(controls);
  // card #99: the status-filter row renders first and UNCONDITIONALLY — same
  // reasoning as the map's #56 row and the gantt's #98 row: if it vanished on
  // an everything-filtered-out empty grid, there'd be no control left to
  // toggle a status back ON. Shared by BOTH branches below (month and every
  // #58 sub-view read the same loadCalendarStatusFilter()).
  container.appendChild(buildCalendarFilterRow());

  if (subview === 'month') renderCalendarMonthGrid(container);
  else renderCalendarTimeGrid(container, subview, keepScroll);
  wireCalendarDrag();
}

// The month grid — #37's layout, untouched by #58 beyond moving into its own
// function (the sub-view switcher branches between this and the time grid).
function renderCalendarMonthGrid(container) {
  const { year, monthIndex } = currentCalendarMonth();
  // Same search composition as the board and map: read the live input value
  // each render (see currentSearchTerms), filter with the shared filterCards.
  // card #40: a card appears via its RANGE (cardSchedule) and/or its DUE
  // marker (dueMarker) — a due-only card has no schedule but still chips.
  // card #108: the search pool spans live + archived unconditionally, same as
  // the gantt — harmless while the Archive pill is off, since no archived
  // card is ever added to `cards` below regardless of whether its id lands
  // in searchIds.
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id)) : null;
  // card #99: status filter composes with search by INTERSECTION — same rule
  // as the map's #56 and the gantt's #98 composition. ganttFilterVisibleIds
  // (not mapFilterVisibleIds) is the right helper here too: the calendar
  // doesn't bucket cards into board columns any more than the gantt's group
  // rows do — a card whose status has no pill just stays ungoverned by any
  // toggle, rather than folding into a first-column pill that isn't its own.
  const statusIds = ganttFilterVisibleIds(state.active, loadCalendarStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  // card #108 ("show/hide archived cards the same way we do in ... gantt
  // view"): the Archive pill's OWN boolean (=== true, not !== false) decides
  // whether archived cards join the grid at all — its default is OFF, so a
  // missing/stale/false value must never render archived chips. Archived
  // cards aren't governed by the live status pills (same as the gantt's
  // Archive group), only by search + this one pill.
  const archiveOn = loadCalendarStatusFilter().archive === true;
  const allCards = archiveOn
    ? cards.concat(searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived)
    : cards;
  const scheduled = allCards
    .map((card) => ({ card, schedule: cardSchedule(card), due: dueMarker(card) }))
    .filter((s) => s.schedule.kind !== 'none' || s.due);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = dow;
    grid.appendChild(h);
  }
  const today = localTodayStr();
  for (const cell of monthGrid(year, monthIndex)) {
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day' + (cell.inMonth ? '' : ' outside') + (cell.date === today ? ' today' : '');
    dayEl.dataset.day = cell.date;
    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = cell.day;
    dayEl.appendChild(num);

    const chips = [];
    for (const { card, schedule, due } of scheduled) {
      const pos = chipPositionForDay(schedule, cell.date);
      if (pos) chips.push({ card, pos, time: schedule.time });
      // card #40: the due chip renders even when the range already covers the
      // day — the deadline is a different thing from the working range.
      if (due && due.day === cell.date) chips.push({ card, pos: 'single', time: due.time, due: true });
    }
    const { visible, overflow } = capChips(chips, CALENDAR_MAX_CHIPS_PER_DAY);
    visible.forEach((c) => dayEl.appendChild(calendarChipEl(c.card, c.pos, c.time, c.due)));
    if (overflow.length) {
      // Overflow is deliberately cheap (card #37's "nothing fancy"): a
      // tooltip-titled line listing the hidden cards — hover reads them, and
      // every card stays reachable via search or the board view.
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${overflow.length} more`;
      more.title = overflow.map((c) => `#${c.card.id} ${c.card.title}`).join('\n');
      dayEl.appendChild(more);
    }
    grid.appendChild(dayEl);
  }
  container.appendChild(grid);
}

// --- card #58: the sub-month time grid (week / 3 days / day) --------------------
// One column per day, an "all day" band on top, hour rows below. All the
// classification/packing math is calendar-model.js's timeGridLayout; this
// builds DOM from its output. Chips reuse calendarChipEl, so the shared #39
// card-el grammar (click/ctrl- or shift-click/right-click) and the month view's chip
// styling apply unchanged. The all-day band + month grid drag BETWEEN day
// columns via native HTML5 drag (onCalendarDrop: date moves, time preserved).
// card #109 supersedes #58's "retime is out of scope" deferral: the timed
// hour-grid blocks now retime + edge-resize at minute granularity via a custom
// pointer-drag (wireCalendarTimeDrag) — so they're draggable:false here.

// Pixel height of one hour row. Must match app.css's .cal-tg-col background
// gradient (40px stripes) — the JS positions blocks, the CSS draws the lines.
const CAL_HOUR_PX = 40;
const CAL_DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // getUTCDay order

function renderCalendarTimeGrid(container, subview, keepScroll) {
  const days = calendarSubviewDays(subview, currentCalendarAnchor());
  // Same live search + status-filter composition as the month grid above —
  // card #99: filtered-out statuses must drop their chips from the all-day
  // band AND the timed hour grid alike, not just the month view. card #108:
  // same live+archived search pool and Archive-pill composition as the month
  // grid too, so the toggle applies to both grids alike.
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id)) : null;
  const statusIds = ganttFilterVisibleIds(state.active, loadCalendarStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  const archiveOn = loadCalendarStatusFilter().archive === true;
  const allCards = archiveOn
    ? cards.concat(searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived)
    : cards;
  const layout = timeGridLayout(allCards, days);
  const today = localTodayStr();

  const grid = document.createElement('div');
  grid.className = 'cal-timegrid';
  grid.style.setProperty('--cal-day-cols', days.length);

  // Header row: weekday + day-of-month per column, today highlighted like the
  // month grid's cell.
  const head = document.createElement('div');
  head.className = 'cal-tg-head';
  head.appendChild(document.createElement('div')); // spacer over the hour gutter
  for (const day of days) {
    const h = document.createElement('div');
    h.className = 'cal-tg-dayhead' + (day === today ? ' today' : '');
    const dt = new Date(dayToUtc(day));
    h.textContent = `${CAL_DOW_SHORT[dt.getUTCDay()]} ${dt.getUTCDate()}`;
    head.appendChild(h);
  }
  grid.appendChild(head);

  // All-day band: date-only cards + multi-day ranges. Background day cells
  // (spanning every packed row) are the drop targets; chips lay over them via
  // explicit grid placement — a span occupies its real columns.
  const band = document.createElement('div');
  band.className = 'cal-tg-allday';
  const bandLabel = document.createElement('div');
  bandLabel.className = 'cal-tg-gutterlabel';
  bandLabel.textContent = 'all day';
  band.appendChild(bandLabel);
  const bandGrid = document.createElement('div');
  bandGrid.className = 'cal-tg-allday-grid';
  const bandRows = Math.max(1, layout.allDayRows); // at least one row of drop surface, even empty
  days.forEach((day, i) => {
    const cell = document.createElement('div');
    cell.className = 'cal-tg-allday-cell cal-drop' + (day === today ? ' today' : '');
    cell.dataset.day = day;
    cell.style.gridColumn = `${i + 1}`;
    cell.style.gridRow = `1 / ${bandRows + 1}`;
    bandGrid.appendChild(cell);
  });
  for (const entry of layout.allDay) {
    const chip = calendarChipEl(entry.card, 'single', '', entry.due);
    chip.classList.add('cal-allday-chip');
    // A span cut by the window edge squares off + dashes on the cut side,
    // same continuation cue as the gantt's clipped bars.
    if (entry.clipStart) chip.classList.add('clip-start');
    if (entry.clipEnd) chip.classList.add('clip-end');
    chip.style.gridColumn = `${entry.startIdx + 1} / ${entry.endIdx + 2}`;
    chip.style.gridRow = `${entry.row + 1}`;
    bandGrid.appendChild(chip);
  }
  band.appendChild(bandGrid);
  grid.appendChild(band);

  // The hour grid, in its own scroll container so the header + band stay put
  // (Outlook-style). 24 rows of CAL_HOUR_PX; blocks absolutely positioned by
  // minutes, side-by-side within their overlap cluster via lane/lanes.
  const scroll = document.createElement('div');
  scroll.className = 'cal-tg-scroll';
  const body = document.createElement('div');
  body.className = 'cal-tg-body';
  const gutter = document.createElement('div');
  gutter.className = 'cal-tg-gutter';
  gutter.style.height = `${24 * CAL_HOUR_PX}px`;
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'cal-tg-hour';
    lbl.style.top = `${h * CAL_HOUR_PX}px`;
    lbl.textContent = `${String(h).padStart(2, '0')}:00`;
    gutter.appendChild(lbl);
  }
  body.appendChild(gutter);
  for (const day of days) {
    const col = document.createElement('div');
    col.className = 'cal-tg-col cal-drop' + (day === today ? ' today' : '');
    col.dataset.day = day;
    col.style.height = `${24 * CAL_HOUR_PX}px`;
    for (const block of layout.timed[day]) {
      const el = calendarChipEl(block.card, 'single', block.time, block.due);
      el.classList.add('cal-timeblock');
      if (block.point) el.classList.add('point'); // default-height marker, not a real duration
      // card #109: timed blocks use a custom pointer-drag (wireCalendarTimeDrag)
      // for minute-granular retime/resize — native HTML5 drag can't give the
      // continuous pixel deltas that needs. draggable:false overrides
      // calendarChipEl's default so the two drag systems never both fire; the
      // all-day band + month chips keep native day-drag (they're day-granular).
      el.draggable = false;
      el.style.top = `${(block.startMin / 60) * CAL_HOUR_PX}px`;
      el.style.height = `${Math.max(18, ((block.endMin - block.startMin) / 60) * CAL_HOUR_PX - 2)}px`;
      el.style.left = `calc(${block.lane} * 100% / ${block.lanes})`;
      el.style.width = `calc(100% / ${block.lanes} - 4px)`;
      // card #109: only a REAL same-day duration (not a point/due placeholder,
      // whose height is a synthetic 60-min marker) gets resize handles — the
      // point/due block's own `point`/`due` flags answer "resizable?" with no
      // separate classifier. An archived block is read-only (guarded at
      // pointerdown), so it gets no handles either.
      if (!block.point && !block.due && !block.card.archived) {
        const top = document.createElement('span');
        top.className = 'cal-resize-handle top';
        const bottom = document.createElement('span');
        bottom.className = 'cal-resize-handle bottom';
        el.append(top, bottom);
      }
      col.appendChild(el);
    }
    body.appendChild(col);
  }
  scroll.appendChild(body);
  grid.appendChild(scroll);
  container.appendChild(grid);
  // First paint opens at 08:00 (the working morning, Outlook's default);
  // re-renders — poll ticks included — keep the user's scroll.
  scroll.scrollTop = keepScroll != null ? keepScroll : 8 * CAL_HOUR_PX;
}

// Same per-render wiring discipline as the board's wireDrag(): #calendar-view
// is rebuilt from scratch by every renderCalendarView() call, so drag
// listeners attach fresh each time. isDragging / pendingDrops reuse the
// board's poll guards, so the 5s auto-refresh never re-renders mid-gesture or
// mid-PATCH here either.
// card #40: whether the chip picked up was the DUE marker — captured at
// dragstart (same module-var discipline as bulkDragIds: the drop reads the
// flag, dragend clears it so a cancelled drag can't leak into the next one).
let calDragDue = false;

function wireCalendarDrag() {
  const container = $('#calendar-view');
  // card #109: exclude timed blocks — they're draggable:false now and handled
  // by the minute-granular pointer-drag (wireCalendarTimeDrag). The all-day
  // band + month chips keep native day-drag through this function.
  container.querySelectorAll('.cal-chip:not(.cal-timeblock)').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
      isDragging = true;
      calDragDue = el.dataset.due === '1';
      // card #58: while a drag is live, every chip yields hit-testing
      // (pointer-events:none via this class, see app.css). The sub-month
      // all-day chips are grid-overlay SIBLINGS of their .cal-tg-allday-cell
      // drop targets — a drag released over one never bubbled to any cell, so
      // preventDefault never fired and the browser refused the drop (month
      // chips are CHILDREN of .cal-day, which is why the same gesture worked
      // there). Falling through to the cell underneath restores the month
      // view's drop-anywhere-in-the-day semantics in week/3-day/day too.
      container.classList.add('cal-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      isDragging = false;
      calDragDue = false;
      container.classList.remove('cal-dragging');
    });
  });
  // card #58: the sub-month views' drop targets (time columns + all-day band
  // cells) carry .cal-drop and the same data-day contract as the month cells.
  container.querySelectorAll('.cal-day, .cal-drop').forEach((cell) => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', (e) => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('drag-over'); });
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      // Clear the drag flag HERE too, not just at dragend: the drop's
      // loadBoard() re-render removes the source chip, and a removed node may
      // never get its dragend — a stuck cal-dragging would leave every chip
      // click-dead (pointer-events:none) until the next drag.
      container.classList.remove('cal-dragging');
      const id = Number(e.dataTransfer.getData('text/plain'));
      onCalendarDrop(id, cell.dataset.day, calDragDue);
    });
  });
}

// Drop = reschedule (card #37, resemantic'd by card #40): dragging a RANGE
// chip moves the working range — the drop day becomes the range END day
// (time-of-day preserved) and the start shifts by the same delta so duration
// is preserved, writing the fields the range actually used (a compat range
// shifts start+due, never inventing an end_date); dragging the DUE chip moves
// due_date alone. The math is calendar-model.js's rescheduleChanges /
// rescheduleDueChanges — both return null for zero-delta drops, so a same-day
// drop never spends a PATCH (or an `updated` bump, card #35). No optimistic
// mutation on purpose: dates aren't positional like a drag between columns,
// so the loadBoard() round-trip re-render is cheap and honest; failures toast.
async function onCalendarDrop(id, day, isDue) {
  const card = state.active.find((c) => c.id === id);
  if (!card || !day) return;
  const changes = isDue ? rescheduleDueChanges(card, day) : rescheduleChanges(card, day);
  if (!changes) return; // no matching date to move, or a same-day drop — never let a stray drop 500
  pendingDrops++; // same poll guard as the board's onDrop
  try {
    await api('PATCH', `/api/cards/${id}`, changes); // `updated` bumps server-side (card #35)
    await loadBoard();
  } catch (e) {
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

// --- card #109: minute-granular pointer-drag on the sub-month TIME GRID -----------
// Card #58 deferred "drag-to-retime within a day's hour grid" — this is that v2,
// plus gantt-style edge-resize. Native HTML5 drag (wireCalendarDrag, still used
// by the all-day band + month grid) only gives discrete drop-target hits; the
// time grid needs a continuous 2-axis delta (day column × minute), so it uses
// pointer capture exactly like wireGanttPointerDrag. Timed blocks are
// draggable:false (renderCalendarTimeGrid); this owns them. Delegated ONCE on
// the stable #calendar-view (unlike wireCalendarDrag, which re-wires per render
// because it binds literal .cal-chip nodes torn down each render).
let calTimeDrag = null;

// A pointer-capture drag still fires a compatibility `click` on the block after
// pointerup — same phantom-click problem the gantt solves. This is its
// calendar-scoped twin (suppressGanttPhantomClick is hardcoded to #gantt-view):
// a one-shot capturing-phase document click swallower, armed only by a MOVED
// drag's pointerup and consumed by the very next click (self-disarms on a
// 0-timeout if none follows).
let calTimeClickSuppressed = false;
function suppressCalTimeClick() {
  calTimeClickSuppressed = true;
  setTimeout(() => { calTimeClickSuppressed = false; }, 0);
}

const CAL_PX_PER_MIN = CAL_HOUR_PX / 60;
const calTimeSnap = (min) => Math.round(min / CALENDAR_DRAG_SNAP_MIN) * CALENDAR_DRAG_SNAP_MIN;

// The day column under the pointer's x (clamped to the first/last column) and
// the raw (un-snapped) minute from its y. Rects are read FRESH every call — the
// grid scrolls vertically mid-gesture, so a rect cached at pointerdown would
// desync the y→minute math. Returns null when no time grid is mounted.
function calTimePointer(e) {
  const cols = Array.from($('#calendar-view').querySelectorAll('.cal-tg-col'));
  if (!cols.length) return null;
  let col = cols[0];
  for (const c of cols) { // rightmost column whose left edge is <= x (clamps past the last)
    if (e.clientX >= c.getBoundingClientRect().left) col = c; else break;
  }
  const r = col.getBoundingClientRect();
  return { day: col.dataset.day, col, rawMin: (e.clientY - r.top) / CAL_PX_PER_MIN };
}

function calTimeApplyPreview(drag) {
  const el = drag.blockEl;
  if (drag.mode === 'shift' || drag.mode === 'due') {
    // 2-axis translate: horizontal = target column's left minus the base
    // column's (equal-width cols, so this overlays the target slot), vertical =
    // the minute delta. Cosmetic only — onCalTimeDragEnd's PATCH is authoritative.
    const baseCol = el.closest('.cal-tg-col');
    const dxPx = drag.targetCol && baseCol ? drag.targetCol.getBoundingClientRect().left - baseCol.getBoundingClientRect().left : 0;
    const dyPx = (drag.targetMin - drag.baseStartMin) * CAL_PX_PER_MIN;
    el.style.transform = `translate(${dxPx}px, ${dyPx}px)`;
    return;
  }
  // resize: mutate top/height directly (mirrors the gantt's left/width split).
  if (drag.mode === 'resize-start') {
    const start = Math.max(0, Math.min(drag.targetMin, drag.baseEndMin - CALENDAR_DRAG_SNAP_MIN));
    el.style.top = `${start * CAL_PX_PER_MIN}px`;
    el.style.height = `${Math.max(4, (drag.baseEndMin - start) * CAL_PX_PER_MIN)}px`;
  } else { // resize-end
    const end = Math.min(1439, Math.max(drag.targetMin, drag.baseStartMin + CALENDAR_DRAG_SNAP_MIN));
    el.style.height = `${Math.max(4, (end - drag.baseStartMin) * CAL_PX_PER_MIN)}px`;
  }
}

async function onCalTimeDragEnd(drag) {
  const card = state.active.find((c) => c.id === drag.id);
  if (!card) return; // vanished mid-gesture (deleted elsewhere) — the next poll redraws
  const changes =
    drag.mode === 'due' ? rescheduleDueAtTime(card, drag.targetDay, drag.targetMin) :
    drag.mode === 'shift' ? rescheduleRangeAtTime(card, drag.targetDay, drag.targetMin) :
    resizeRangeAtTime(card, drag.mode === 'resize-start' ? 'start' : 'end', drag.targetMin);
  if (!changes) return; // zero-delta or not-applicable — finish() already restored the geometry
  pendingDrops++; // same poll guard as onCalendarDrop / the gantt
  try {
    await api('PATCH', `/api/cards/${drag.id}`, changes); // `updated` bumps server-side (card #35)
    await loadBoard();
  } catch (e) {
    renderCalendarView(); // snap back to disk truth
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

function wireCalendarTimeDrag() {
  const container = $('#calendar-view');
  // Phantom-click swallower (capturing phase at document, scoped to
  // #calendar-view targets), same shape as the gantt's.
  document.addEventListener('click', (e) => {
    if (!calTimeClickSuppressed) return;
    calTimeClickSuppressed = false;
    if (!e.target.closest || !e.target.closest('#calendar-view')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || calTimeDrag) return;
    const blockEl = e.target.closest('.cal-timeblock');
    if (!blockEl) return;
    const handleEl = e.target.closest('.cal-resize-handle');
    const mode = handleEl
      ? (handleEl.classList.contains('top') ? 'resize-start' : 'resize-end')
      : (blockEl.dataset.due === '1' ? 'due' : 'shift');
    const id = Number(blockEl.dataset.id);
    // Archived guard, BEFORE any capture/state (same as the gantt): an archived
    // card only lives in state.archived, so this find returns undefined.
    const card = state.active.find((c) => c.id === id);
    if (!card) { toast('Archived cards are read-only — restore the card to reschedule it.'); return; }
    const baseStartMin = (parseFloat(blockEl.style.top) || 0) / CAL_PX_PER_MIN;
    const drag = {
      id, mode, blockEl, pointerId: e.pointerId,
      originX: e.clientX, originY: e.clientY, moved: false,
      baseStartMin,
      baseDay: (blockEl.closest('.cal-tg-col') || {}).dataset ? blockEl.closest('.cal-tg-col').dataset.day : null,
      targetDay: null, targetMin: baseStartMin, targetCol: null,
    };
    if (mode === 'shift' || mode === 'due') {
      const p = calTimePointer(e); // grab-offset so the block doesn't jump to the cursor
      drag.grabOffsetMin = p ? baseStartMin - p.rawMin : 0;
      drag.targetDay = drag.baseDay;
    } else { // resize: derive the block's true start/end minutes from the card, not the DOM height
      const rf = rangeFields(card);
      drag.baseStartMin = timeToMinutes(timePart(card[rf.startField]));
      drag.baseEndMin = timeToMinutes(timePart(card[rf.endField]));
      drag.baseTop = parseFloat(blockEl.style.top) || 0;
      drag.baseHeight = parseFloat(blockEl.style.height) || 0;
      drag.targetMin = drag.mode === 'resize-start' ? drag.baseStartMin : drag.baseEndMin;
    }
    calTimeDrag = drag;
    blockEl.setPointerCapture(e.pointerId);
    blockEl.classList.add('dragging');
    isDragging = true; // poll guard for the whole gesture, cleared in finish()
    e.preventDefault();
  });

  container.addEventListener('pointermove', (e) => {
    if (!calTimeDrag || e.pointerId !== calTimeDrag.pointerId) return;
    const drag = calTimeDrag;
    const dx = e.clientX - drag.originX, dy = e.clientY - drag.originY;
    // resize is vertical-only, so x-jitter must not register as movement.
    if (drag.mode === 'resize-start' || drag.mode === 'resize-end') { if (Math.abs(dy) > 3) drag.moved = true; }
    else if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const p = calTimePointer(e);
    if (!p) return;
    if (drag.mode === 'shift' || drag.mode === 'due') {
      drag.targetDay = p.day;
      drag.targetCol = p.col;
      drag.targetMin = calTimeSnap(p.rawMin + drag.grabOffsetMin);
    } else { // resize: day fixed, one edge tracks the pointer
      drag.targetMin = calTimeSnap(p.rawMin);
    }
    calTimeApplyPreview(drag);
  });

  // pointerup commits a MOVED drag; an unmoved press is a click (its native
  // click bubbles to the shared #39 card-el grammar → detail popup, same as the
  // gantt). pointercancel never commits. Either way the block's inline preview
  // styles are cleared first — the authoritative move is the post-PATCH re-render.
  const finish = (commit) => {
    if (!calTimeDrag) return;
    const drag = calTimeDrag;
    calTimeDrag = null;
    isDragging = false;
    drag.blockEl.classList.remove('dragging');
    drag.blockEl.style.transform = '';
    if (drag.mode === 'resize-start' || drag.mode === 'resize-end') {
      drag.blockEl.style.top = `${drag.baseTop}px`;
      drag.blockEl.style.height = `${drag.baseHeight}px`;
    }
    if (!commit || !drag.moved) return;
    suppressCalTimeClick();
    onCalTimeDragEnd(drag);
  };
  container.addEventListener('pointerup', (e) => { if (calTimeDrag && e.pointerId === calTimeDrag.pointerId) finish(true); });
  container.addEventListener('pointercancel', (e) => { if (calTimeDrag && e.pointerId === calTimeDrag.pointerId) finish(false); });
}

// --- Calendar view wiring (card #37; reshaped by #39): header toggle + the
// prev/today/next nav. #calendar-view is rebuilt by every renderCalendarView()
// call, so clicks delegate to the stable parent — same pattern (and reason)
// as #map-view's delegated listener above. Chip clicks (detail/selection/
// context menu) are the shared card-el grammar's job now — nothing
// chip-specific left here. Clicking an empty day cell matches no card-el, so
// the document-level Q0 handler clears any selection, exactly like the
// board's background.
window.addEventListener('DOMContentLoaded', () => {
  $('#calendar-toggle-btn').addEventListener('click', () => toggleView('calendar'));
  wireCalendarTimeDrag(); // card #109: delegated once on the stable #calendar-view
  $('#calendar-view').addEventListener('click', (e) => {
    // card #99: status-filter pills — control-row buttons, checked first for
    // the same reason the map's #56 and the gantt's #98 pills are (never fall
    // through to the sub-view switcher/nav/card-el handling below).
    const filterBtn = e.target.closest('.calendar-filter-toggle[data-col]');
    if (filterBtn) { toggleCalendarStatusFilter(filterBtn.dataset.col); return; }
    // card #58: the sub-view switcher rides the same delegated listener as
    // prev/today/next — all four button sets are rebuilt every render.
    const sv = e.target.closest('.cal-subview-btn');
    if (sv) { setCalendarSubview(sv.dataset.subview); return; }
    if (e.target.closest('#cal-prev-btn')) { shiftCalendarWindow(-1); return; }
    if (e.target.closest('#cal-next-btn')) { shiftCalendarWindow(1); return; }
    if (e.target.closest('#cal-today-btn')) { calendarAnchor = null; renderCalendarView(); }
  });
  // card #101: right-click SOLO on the calendar's own pills — same reasoning
  // as the map's contextmenu listener above (own listener so a miss falls
  // through untouched to the #39 shared chip contextmenu on document).
  $('#calendar-view').addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // verify-fix: same #39 guard (app.js ~3006) — a chorded right-click mid-.cal-chip-drag must not re-render out from under the gesture
    const filterBtn = e.target.closest('.calendar-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloCalendarStatusFilter(filterBtn.dataset.col);
  });
});

// card #58: prev/next step by the ACTIVE sub-view's span (month / 7 / 3 / 1
// days) — shiftAnchorDay owns the math, one anchor cursor drives all four.
function shiftCalendarWindow(delta) {
  calendarAnchor = shiftAnchorDay(loadCalendarSubview(), currentCalendarAnchor(), delta);
  renderCalendarView();
}

// --- Gantt view (card #38; date triad by card #40) -------------------------------
// Dated LIVE cards on a day-granular timeline, rows grouped by status: the
// working range (start→end, or the #36 compat pair start→due) renders as a
// bar, the due date as an independent draggable diamond on the same row —
// a due-only card shows only its diamond.
// All window/row/drag math lives in gantt-model.js (pure, unit-tested,
// dual-environment); everything below is presentation and API glue. The
// window derives from the rendered cards each render, so a poll that changes
// cards may legitimately move it — deliberate: there's no month cursor to
// preserve (unlike the calendar), and the view mode itself persists via the
// shared 'view.mode' mechanism. No dependency arrows on purpose — the map
// view owns the waiting_for graph; here a waiting card just keeps the board's
// amber left-accent cue (epic #137 renamed the old blocked visuals). No focusable controls in here either (bars are divs,
// there's no prev/next nav), so boardControlFocused needs no new entry.

function ganttBarEl(bar, win) {
  // The window may be clamped (~180 days), so a bar can poke past either
  // edge: draw only the visible slice, squared off + dashed on the cut side;
  // a bar entirely outside draws nothing (its gutter label still lists it).
  if (bar.endDay < win.startDay || bar.startDay > win.endDay) return null;
  const from = bar.startDay < win.startDay ? win.startDay : bar.startDay;
  const to = bar.endDay > win.endDay ? win.endDay : bar.endDay;
  const el = document.createElement('div');
  const pb = priorityBadge(bar.card, state.priorities); // card #30 emphasis, same as tiles/chips
  // card #91: epic is the shared dot glyph now (in gantt-bar-text below), not
  // a border class (#59) — the status border/fill stays untouched.
  // card #98 reopen: an archived bar mutes to the neutral archive grey
  // regardless of its parked on-disk status — the BAR keeps this mute (card
  // #102 reopen: it's a row-level archived cue, like a board tile dimming,
  // not the status-dot channel that reopen locked to "never mutes"; the
  // gutter row's own dot, built lower down in renderGanttView, now colors off
  // the card's true status instead). 'archive' is also the literal key
  // ganttArchiveGroup uses for the group itself (gantt-model.js), so
  // statusColor/isBuiltinStatus already know it (card #57) with no extra
  // branching beyond this swap.
  const colorStatus = bar.card.archived ? 'archive' : bar.card.status;
  el.className = `gantt-bar card-el status-${mapStatusClass(colorStatus)}` + // card #39: bars join the shared card-el grammar
    (pb.className ? ` ${pb.className}` : '') + (isWaiting(bar.card) ? ' waiting' : '') +
    (selectedIds.has(bar.card.id) ? ' selected' : '') +
    (bar.card.archived ? ' archived' : '') + // defect fix: an archived bar is drag-read-only — CSS swaps the grab cursor for not-allowed
    (bar.startDay < win.startDay ? ' clip-start' : '') + (bar.endDay > win.endDay ? ' clip-end' : '');
  el.dataset.id = bar.card.id;
  el.dataset.archived = bar.card.archived ? '1' : ''; // read by wireGanttPointerDrag's pointerdown guard, same signal used to swap the tooltips below
  // card #31: non-built-in statuses (custom columns, unlisted values) color
  // inline from the deterministic hash — the .status-unknown class beneath
  // only supplies the shape defaults it overrides. card #91: no more .epic
  // border rule to lose to, so this write is unconditional now. card #98
  // reopen: 'archive' isn't built-in either, so an archived bar rides this
  // same inline-override path straight to ARCHIVE_COLOR.
  if (!isBuiltinStatus(colorStatus)) {
    el.style.borderColor = statusColor(colorStatus);
    el.style.background = statusColorSoft(colorStatus);
  }
  el.style.left = `${diffDays(win.startDay, from) * GANTT_DAY_PX}px`;
  el.style.width = `${(diffDays(from, to) + 1) * GANTT_DAY_PX}px`;
  // defect fix: an archived card's bar used to keep the LIVE handle tooltips
  // ("Drag to change...") even though the drag silently no-ops on release
  // (onGanttDragEnd's own state.active lookup can never find an archived
  // card) — the affordance invited a gesture that could never do anything.
  const readOnlyHint = 'Archived — restore the card to reschedule';
  const startHint = bar.card.archived ? readOnlyHint : 'Drag to change the start date';
  const endHint = bar.card.archived ? readOnlyHint : 'Drag to change the range end';
  // plain-text property — full title + true dates survive the CSS truncation/clipping
  el.title = `#${bar.card.id} ${bar.card.title} (${bar.startDay}${bar.endDay !== bar.startDay ? ` → ${bar.endDay}` : ''})` +
    (bar.card.archived ? ` — ${readOnlyHint}` : '');
  el.innerHTML =
    `<span class="gantt-handle start" title="${startHint}"></span>` +
    `<span class="gantt-bar-text"><span class="gantt-bar-id">#${bar.card.id}</span>${bar.card.epic ? epicBadge() : ''} ${escapeHtml(bar.card.title)}</span>` +
    `<span class="gantt-handle end" title="${endHint}"></span>`;
  return el;
}

function renderGanttView() {
  const container = $('#gantt-view');
  // The timeline is thousands of px wide — losing scroll on every 5s poll
  // would make horizontal position unusable. Carry it across the rebuild.
  const prevScroll = container.querySelector('.gantt-scroll');
  const keepScrollLeft = prevScroll ? prevScroll.scrollLeft : null;
  container.innerHTML = '';
  // card #98: the status-filter row renders first and UNCONDITIONALLY — same
  // reasoning as the map's #56 row: if it vanished on the everything-
  // filtered-out empty state, there'd be no control left to toggle a status
  // back ON. Everything from here on APPENDS (never innerHTML=, which would
  // wipe this row straight back out).
  container.appendChild(buildGanttFilterRow());
  // Same search composition as board/map/calendar: live input value each
  // render, shared filterCards. card #98: status filter composes with search
  // by INTERSECTION — a card is visible only if BOTH say so — same pure
  // helper and same rule as the map's #56 composition (never a union, never
  // one side dropped). card #98 reopen: the search pool spans live + archived
  // unconditionally (same as the map's own search pool) — harmless while the
  // Archive pill is off, since no archived bar is ever added to groups below
  // regardless of whether its id lands in searchIds.
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length
    ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id))
    : null;
  // verify finding: NOT mapFilterVisibleIds — that folds an unlisted status
  // into the FIRST column's toggle, correct for the map/board but wrong here.
  // ganttGroups (below) buckets cards by their RAW status and gives an
  // unlisted one its own separate group row, unrelated to any board column;
  // ganttFilterVisibleIds is the gantt's own rule, matching that grouping — a
  // status with no pill is never governed by one.
  const statusIds = ganttFilterVisibleIds(state.active, loadGanttStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  const groups = ganttGroups(cards, boardStatuses()); // card #31: group order follows the configured column list; card #98: a filtered-out status simply has no bucket, so its group row drops entirely (no ghost semantics — the gantt has no dependency edges)
  // card #98 reopen ("we are missing archived status"): the Archive pill's
  // OWN boolean (=== true, not !== false) decides whether archived cards
  // render at all — its default is OFF, unlike every live status pill, so a
  // missing/stale/false value must never render archived rows. When on, ONE
  // more group is appended AFTER the live status groups just computed above —
  // same "location after live columns" placement as the board's Archive
  // column (card #34) — search-filtered the same way the live groups were.
  const archiveOn = loadGanttStatusFilter().archive === true;
  if (archiveOn) {
    const archivedCards = searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived;
    const archiveGroup = ganttArchiveGroup(archivedCards);
    // Defect fix: a LIVE card's raw on-disk status can literally be
    // 'archive' (archive is a LOCATION, never validated per-card — same
    // tolerance liveStatuses/columnForStatus extend elsewhere), so
    // ganttGroups above may have already produced its own group keyed
    // 'archive'. Pushing this group unconditionally would then create two
    // adjacent rows sharing that exact label/color — appendArchiveGroup
    // (gantt-model.js) merges into the existing one instead of duplicating it.
    appendArchiveGroup(groups, archiveGroup);
  }
  if (!groups.length) {
    // card #98: distinguish "nothing is dated at all" from "the current
    // search/status filter hid everything" — the former keeps the original
    // #38 guidance message, the latter matches the map's #56 wording. card
    // #98 reopen: "nothing at all" also checks the archive group when the
    // pill is on, so an archive-only board doesn't misreport as fully empty.
    const noneAtAll = !ganttGroups(state.active, boardStatuses()).length && !(archiveOn && ganttArchiveGroup(state.archived));
    const empty = document.createElement('div');
    empty.className = 'gantt-empty';
    empty.textContent = noneAtAll
      ? 'No dated cards — give a card a start, end, or due date to chart it here.'
      : 'No cards match the current search/status filters.';
    container.appendChild(empty);
    return;
  }
  // card #40: the window covers each row's bar AND its due diamond (a
  // due-only row has no bar at all), hence rowWindowSpans between the rows
  // and ganttWindow.
  const rows = groups.flatMap((g) => g.bars);
  const win = ganttWindow(rowWindowSpans(rows), localTodayStr());

  const gutter = document.createElement('div');
  gutter.className = 'gantt-gutter';
  const scroll = document.createElement('div');
  scroll.className = 'gantt-scroll';
  const timeline = document.createElement('div');
  timeline.className = 'gantt-timeline';
  timeline.style.width = `${win.days * GANTT_DAY_PX}px`;
  scroll.appendChild(timeline);

  // Axis row: Monday week marks up top, matching full-height grid lines
  // behind the rows; the gutter gets an empty spacer of the same height so
  // both columns' row sequences line up 1:1 from there on.
  const head = document.createElement('div');
  head.className = 'gantt-axis';
  gutter.appendChild(head);
  const axis = document.createElement('div');
  axis.className = 'gantt-axis';
  timeline.appendChild(axis);
  const today = localTodayStr();
  for (let i = 0; i < win.days; i++) {
    const day = addDays(win.startDay, i);
    if (isMonday(day)) {
      const mark = document.createElement('div');
      mark.className = 'gantt-week-mark';
      mark.style.left = `${i * GANTT_DAY_PX}px`;
      mark.textContent = weekMarkLabel(day);
      axis.appendChild(mark);
      const line = document.createElement('div');
      line.className = 'gantt-week-line';
      line.style.left = `${i * GANTT_DAY_PX}px`;
      timeline.appendChild(line);
    }
  }
  if (today >= win.startDay && today <= win.endDay) {
    const line = document.createElement('div');
    line.className = 'gantt-today-line';
    line.style.left = `${diffDays(win.startDay, today) * GANTT_DAY_PX + GANTT_DAY_PX / 2}px`;
    line.title = `Today (${today})`;
    timeline.appendChild(line);
  }

  for (const group of groups) {
    const glabel = document.createElement('div');
    glabel.className = `gantt-row gantt-group-row status-${mapStatusClass(group.status)}`;
    if (!isBuiltinStatus(group.status)) glabel.style.color = statusColor(group.status); // card #31: hashed color for custom groups
    glabel.textContent = columnLabel(group.status);
    gutter.appendChild(glabel);
    const gstrip = document.createElement('div');
    gstrip.className = 'gantt-row gantt-group-row';
    timeline.appendChild(gstrip);
    for (const bar of group.bars) {
      const label = document.createElement('div');
      // card #39: gutter labels are card-el too — click opens detail,
      // ctrl/shift-click select, right-click menus, exactly like the bar itself
      // (they were inert before; cheap parity win, and the only way to reach
      // a bar that's entirely outside the clamped window).
      label.className = 'gantt-row gantt-label card-el' + (selectedIds.has(bar.card.id) ? ' selected' : '');
      label.dataset.id = bar.card.id;
      label.title = `#${bar.card.id} ${bar.card.title}`;
      // card #97: the gutter row carried NEITHER dot before this card (#91 only
      // reached the bar itself) — "all components" means both join here too.
      // The bar stays untouched: its status border/fill already reads the
      // status, so a redundant dot there would be a per-view one-off.
      // card #102 FINAL DESIGN (#98R): the Archive group's rows share this
      // exact label builder — no separate branch — so the conditional
      // archivedBadge() covers those gutter rows too, gated on the row's own
      // card.archived flag. The bar itself keeps its existing row-level mute
      // (card #98 reopen) instead of gaining a redundant second archived cue.
      label.innerHTML = `<span class="gantt-label-id">#${bar.card.id}</span>${bar.card.epic ? epicBadge() : ''}${statusBadge(bar.card)}${bar.card.archived ? archivedBadge() : ''} ${escapeHtml(bar.card.title)}`;
      gutter.appendChild(label);
      const row = document.createElement('div');
      row.className = 'gantt-row gantt-bar-row';
      const el = bar.startDay ? ganttBarEl(bar, win) : null; // due-only rows have no bar (card #40)
      if (el) row.appendChild(el);
      // Due diamond (card #40): the independent deadline marker, rendered
      // whether or not a bar exists on the row; outside the window = omitted
      // (nothing clips a point marker meaningfully).
      if (bar.dueDay && bar.dueDay >= win.startDay && bar.dueDay <= win.endDay) {
        const d = document.createElement('div');
        d.className = 'gantt-due-marker card-el' + (bar.card.archived ? ' archived' : ''); // joins the #39 grammar: still-click opens detail, shift/right-click select — the old finish()-opens-detail path is gone. defect fix: archived flag, same reasoning as ganttBarEl — the diamond is an equally dead drag surface on an archived row
        d.dataset.id = bar.card.id;
        d.dataset.archived = bar.card.archived ? '1' : ''; // read by wireGanttPointerDrag's pointerdown guard
        d.style.left = `${diffDays(win.startDay, bar.dueDay) * GANTT_DAY_PX + GANTT_DAY_PX / 2}px`; // centered on its day column
        d.title = bar.card.archived
          ? `#${bar.card.id} ${bar.card.title} — due ${bar.dueDay} (archived — restore the card to reschedule)`
          : `#${bar.card.id} ${bar.card.title} — due ${bar.dueDay} (drag to move the due date)`;
        row.appendChild(d);
      }
      timeline.appendChild(row);
    }
  }
  // card #98: gutter+scroll ride their OWN flex row (.gantt-body) now that the
  // filter row is a sibling above them — #gantt-view itself went back to a
  // plain block so the filter row stacks on top instead of joining the
  // side-by-side flex row as a third item.
  const body = document.createElement('div');
  body.className = 'gantt-body';
  body.appendChild(gutter);
  body.appendChild(scroll);
  container.appendChild(body);
  if (keepScrollLeft !== null) scroll.scrollLeft = keepScrollLeft;
}

// Pointer-event drag (pointerdown/move/up + setPointerCapture), NOT HTML5
// drag & drop like the board/calendar: a continuous horizontal drag needs a
// live per-move delta and a free visual offset, which dragover only gives
// against a grid of drop targets. One delegated set of listeners on the
// stable #gantt-view parent (wired once at DOMContentLoaded) — capture
// retargets moves to the bar, and they bubble back through the container, so
// per-render rewiring isn't needed. isDragging blocks the 5s poll for the
// gesture and pendingDrops for the PATCH round-trip, exactly like the
// calendar drag.
let ganttDrag = null;

function applyGanttDragVisual(drag) {
  const px = GANTT_DAY_PX;
  if (drag.mode === 'shift' || drag.mode === 'due') { // the due diamond translates like a body shift (card #40)
    drag.barEl.style.transform = `translateX(${drag.dayDelta * px}px)`;
    return;
  }
  // Visual mirror of the model's 1-day-minimum clamp, in rendered-bar days
  // (for a window-clipped bar that differs from its true length — the PATCH
  // math below stays authoritative, this only keeps the preview honest).
  const barDays = Math.max(1, Math.round(drag.baseWidth / px));
  if (drag.mode === 'start') {
    const d = Math.min(drag.dayDelta, barDays - 1);
    drag.barEl.style.left = `${drag.baseLeft + d * px}px`;
    drag.barEl.style.width = `${drag.baseWidth - d * px}px`;
  } else if (drag.relocates) {
    // due-only / reversed 1-day bars: the model MOVES due on an end-drag, so
    // an honest preview translates — stretching would show a range that will
    // never exist after the commit.
    drag.barEl.style.transform = `translateX(${drag.dayDelta * px}px)`;
  } else {
    const d = Math.max(drag.dayDelta, -(barDays - 1));
    drag.barEl.style.width = `${drag.baseWidth + d * px}px`;
  }
}

async function onGanttDragEnd(drag) {
  // Same-position drop: no PATCH, no `updated` bump (card #35) — the model's
  // null covers the clamped-away cases the delta alone can't see.
  if (!drag.dayDelta) return;
  const card = state.active.find((c) => c.id === drag.id);
  if (!card) return; // vanished mid-gesture (deleted elsewhere) — the next poll will redraw
  const changes = drag.mode === 'due'
    ? dueShiftChanges(card, drag.dayDelta) // diamond drag moves due_date alone (card #40)
    : drag.mode === 'shift'
      ? barShiftChanges(card, drag.dayDelta)
      : barResizeChanges(card, drag.mode, drag.dayDelta);
  if (!changes) return; // finish() already restored the pre-drag geometry
  pendingDrops++; // same poll guard as the board's onDrop / calendar's drop
  try {
    await api('PATCH', `/api/cards/${drag.id}`, changes); // `updated` bumps server-side (card #35)
    await loadBoard();
  } catch (e) {
    renderGanttView(); // snap back to disk truth
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

// A pointer-capture drag still dispatches a compatibility `click` on the bar
// after pointerup (mousedown/up land on the captured element, so their common
// ancestor is the bar — distance moved doesn't suppress it). Without this
// guard that phantom click would hit the shared card-el grammar (opening the
// detail popup after every drag) and the Q0 clear-selection handler. One-shot:
// armed only by a MOVED drag's pointerup, consumed by the very next click,
// and self-disarms on a 0-timeout in case no click follows (the click, when
// it comes, dispatches before any timer fires). pointercancel never fires a
// click, so the cancel path never arms it. Scoped to #gantt-view targets so a
// stale flag could never eat a click elsewhere.
let ganttClickSuppressed = false;

// Timing assumption (untestable under node:test): the compatibility click
// dispatches synchronously after pointerup and before this 0-timeout disarm
// (Pointer Events spec; holds in Chromium incl. VSCode's webview). If a
// browser ever defers it, worst case is one phantom click acting as a
// real one — re-verify with a manual smoke if gantt clicks misbehave.
function suppressGanttPhantomClick() {
  ganttClickSuppressed = true;
  setTimeout(() => { ganttClickSuppressed = false; }, 0);
}

function wireGanttPointerDrag() {
  const container = $('#gantt-view');
  document.addEventListener('click', (e) => {
    if (!ganttClickSuppressed) return;
    ganttClickSuppressed = false;
    if (!e.target.closest || !e.target.closest('#gantt-view')) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase at document — nothing else sees this click
  }, true);
  // card #98: status-filter pills — control-row buttons, checked first for
  // the same reason the map's #56 pills are (never fall through to the
  // pointer-drag/card-el handling below).
  container.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.gantt-filter-toggle[data-col]');
    if (filterBtn) toggleGanttStatusFilter(filterBtn.dataset.col);
  });
  // card #101: right-click SOLO on the gantt's own pills — same reasoning as
  // the map's contextmenu listener (own listener so a miss falls through
  // untouched to the #39 shared bar/gutter-label contextmenu on document).
  container.addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // verify-fix: same #39 guard (app.js ~3006) — a chorded right-click mid-bar-drag must not detach ganttDrag.barEl via re-render
    const filterBtn = e.target.closest('.gantt-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloGanttStatusFilter(filterBtn.dataset.col);
  });
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || ganttDrag) return;
    // card #40: the due diamond is its own drag surface — mode 'due' moves
    // due_date alone; bars keep their shift/resize modes. Same >3px
    // click-vs-drag rule applies to both (finish() below), so a still press
    // on the diamond opens the detail popup too.
    const diamondEl = e.target.closest('.gantt-due-marker');
    const barEl = diamondEl || e.target.closest('.gantt-bar');
    if (!barEl) return;
    const handle = diamondEl ? null : e.target.closest('.gantt-handle');
    const mode = diamondEl ? 'due' : handle ? (handle.classList.contains('start') ? 'start' : 'end') : 'shift';
    const card = state.active.find((c) => c.id === Number(barEl.dataset.id));
    // Defect fix: an archived bar/diamond's id only ever lives in
    // state.archived, so `card` is undefined here — before this guard the
    // gesture started identically to a live drag (pointer capture claimed,
    // .dragging class, the full pointermove preview), then silently
    // no-opped on release because onGanttDragEnd's OWN state.active lookup
    // (below) could never find the card either. Blocking here — with a
    // toast, since a fully-realized fake drag animation deserves an honest
    // reason it did nothing — replaces that with an upfront, visible signal.
    if (!card) {
      toast('Archived cards are read-only — restore the card to reschedule it.');
      return;
    }
    const rf = rangeFields(card); // triad-aware shape (card #40)
    ganttDrag = {
      id: Number(barEl.dataset.id),
      mode,
      // end-drag on an end-only or reversed card relocates its 1-day bar
      // instead of stretching (see barResizeChanges) — the preview must match
      relocates: mode === 'end' && !!rf && !!rf.endDay && (!rf.startDay || rf.startDay > rf.endDay),
      pointerId: e.pointerId, // a second touch/pen contact must not commit this drag
      barEl,
      originX: e.clientX,
      dayDelta: 0,
      moved: false,
      baseLeft: parseFloat(barEl.style.left) || 0,
      baseWidth: parseFloat(barEl.style.width) || 0,
    };
    barEl.setPointerCapture(e.pointerId);
    barEl.classList.add('dragging');
    isDragging = true; // poll guard for the whole gesture, released in finish()
    e.preventDefault(); // no text selection mid-drag
  });
  container.addEventListener('pointermove', (e) => {
    if (!ganttDrag || e.pointerId !== ganttDrag.pointerId) return;
    const dx = e.clientX - ganttDrag.originX;
    if (Math.abs(dx) > 3) ganttDrag.moved = true; // sub-day wiggle is still a drag, not a click
    ganttDrag.dayDelta = Math.round(dx / GANTT_DAY_PX);
    applyGanttDragVisual(ganttDrag);
  });
  // pointerup commits; pointercancel (touch scroll steal, window loss) never
  // does. Either way the bar snaps back to its pre-drag geometry first — on
  // commit the PATCH + loadBoard() re-render is what actually moves it.
  // A press without movement is a click (card #38) — since #39 that click is
  // NOT handled here: the native click event that follows the unmoved
  // pointerup bubbles to the shared card-el grammar handlers, so bars get
  // detail/selection/Q0 semantics identical to every other view. Only a
  // MOVED drag suppresses that following click (the >3px rule: a drag is not
  // a click).
  const finish = (commit) => {
    if (!ganttDrag) return;
    const drag = ganttDrag;
    ganttDrag = null;
    isDragging = false;
    drag.barEl.classList.remove('dragging');
    drag.barEl.style.transform = '';
    drag.barEl.style.left = `${drag.baseLeft}px`;
    if (drag.mode !== 'due') drag.barEl.style.width = `${drag.baseWidth}px`; // the diamond sizes itself in CSS — writing 0px would collapse it (card #40)
    if (!commit) return;
    if (!drag.moved) return;
    suppressGanttPhantomClick();
    onGanttDragEnd(drag);
  };
  container.addEventListener('pointerup', (e) => { if (ganttDrag && e.pointerId === ganttDrag.pointerId) finish(true); });
  container.addEventListener('pointercancel', (e) => { if (ganttDrag && e.pointerId === ganttDrag.pointerId) finish(false); });
}

window.addEventListener('DOMContentLoaded', () => {
  $('#gantt-toggle-btn').addEventListener('click', () => toggleView('gantt'));
  wireGanttPointerDrag();
});

// --- Notifications (card #22): agents append entries to the board's
// notifications.md; GET /api/board carries the parsed list on every load/poll.
// sortNotificationsDesc/unreadCount/unseenUnread come from notifications.js
// (bare globals, same dual-environment pattern as the other extracted modules).
const seenNotifIds = new Set(); // toast-once-per-session guard — NOT read state

function renderNotifBadge() {
  const unread = unreadCount(state.notifications || []);
  const badge = $('#notif-badge');
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function applyNotifications(list) {
  state.notifications = list;
  renderNotifBadge();
  const fresh = unseenUnread(list, seenNotifIds);
  if (fresh.length) {
    fresh.forEach((n) => seenNotifIds.add(n.id));
    const first = sortNotificationsDesc(fresh)[0];
    // toast() sets textContent — agent-written text is safe here without escapeHtml
    toast(fresh.length === 1
      ? `\u{1F514} ${first.from ? first.from + ': ' : ''}${first.message}`
      : `\u{1F514} ${fresh.length} new notifications`);
  }
  if (!$('#notif-modal').classList.contains('hidden')) renderNotifList();
}

function renderNotifList() {
  const list = sortNotificationsDesc(state.notifications || []);
  const el = $('#notif-list');
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No notifications.';
    el.replaceChildren(empty);
    return;
  }
  // Card #133: built as DOM nodes with textContent — agent-written text never
  // rides string-built HTML. The TLDR (text before the first "; more: ", splitTldr
  // from notifications.js) renders bold; the rest of the message — separator
  // included, so the entry stays verbatim — renders normally. level paints
  // the row (debug dimmed, warning amber, error red; absent = info).
  el.replaceChildren(...list.map((n) => {
    const row = document.createElement('div');
    row.className = `notif-row level-${notificationLevel(n)}${n.read ? '' : ' unread'}`;
    const text = document.createElement('div');
    text.className = 'notif-text';
    const meta = document.createElement('div');
    meta.className = 'notif-meta';
    meta.textContent = `${n.from || 'unknown'}${n.at ? ' · ' + n.at : ''}`;
    const msg = document.createElement('div');
    msg.className = 'notif-message';
    const strong = document.createElement('strong');
    strong.textContent = splitTldr(n.message).tldr;
    msg.appendChild(strong);
    const rest = String(n.message).slice(strong.textContent.length);
    if (rest) msg.appendChild(document.createTextNode(rest));
    text.append(meta, msg);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn danger notif-delete';
    del.dataset.id = String(n.id);
    del.title = 'Clear this notification (moves it to archived/notifications.md)';
    del.setAttribute('aria-label', del.title);
    del.textContent = '✕';
    row.append(text, del);
    return row;
  }));
}

async function openNotifModal() {
  renderNotifList(); // render BEFORE mark-read so this viewing keeps its unread styling
  $('#notif-modal').classList.remove('hidden');
  if (unreadCount(state.notifications || []) > 0) {
    // Opening the popup is the read acknowledgment (card #22) — persisted to the file.
    try {
      const { notifications } = await api('POST', '/api/notifications/mark-read');
      state.notifications = notifications;
      renderNotifBadge(); // badge clears; row styling stays until the next render
    } catch (e) { toast('Mark-read failed: ' + e.message); }
  }
}

function closeNotifModal() {
  $('#notif-modal').classList.add('hidden');
}

// Card #133 clear = archive: both removal paths MOVE entries to
// archived/notifications.md server-side — nothing is deleted, so the copy
// says "clear", not "delete".
async function deleteNotification(id) {
  const n = (state.notifications || []).find((x) => x.id === id);
  const snippet = n ? `"${n.message.slice(0, 50)}${n.message.length > 50 ? '…' : ''}"` : `#${id}`;
  if (!confirm(`Clear notification ${snippet}? It moves to archived/notifications.md.`)) return;
  try {
    const { notifications } = await api('DELETE', `/api/notifications/${id}`);
    state.notifications = notifications;
    renderNotifBadge();
    renderNotifList();
  } catch (e) { toast('Clear failed: ' + e.message); }
}

async function clearAllNotifications() {
  const count = (state.notifications || []).length;
  if (count === 0) return;
  if (!confirm(`Clear all ${count} notification(s)? They move to archived/notifications.md.`)) return;
  try {
    const { notifications } = await api('DELETE', '/api/notifications');
    state.notifications = notifications;
    renderNotifBadge();
    renderNotifList();
  } catch (e) { toast('Clear failed: ' + e.message); }
}

window.addEventListener('DOMContentLoaded', () => {
  $('#notif-btn').addEventListener('click', openNotifModal);
  $('#notif-close').addEventListener('click', closeNotifModal);
  // card #133: the button's static app.html tooltip predates clear-=-archive;
  // corrected here so the markup stays untouched by this change.
  $('#notif-clear-btn').addEventListener('click', clearAllNotifications);
  $('#notif-modal').addEventListener('click', (e) => { if (e.target.id === 'notif-modal') closeNotifModal(); });
  $('#notif-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.notif-delete');
    if (btn) deleteNotification(Number(btn.dataset.id));
  });
});

// --- Multi-select + bulk actions (card #25; view parity card #39). Selection
// lives as a Set of ids (toggleSelection/pruneSelection/contextSelection/
// partitionByMovable/rangeSelection from selection.js — pure, unit-tested);
// every view's renderer paints .selected from it on every render, so it
// survives polls AND view switches by construction. Card #25's board-only
// exclusion is retired: board tiles, map nodes + isolated-row tiles, calendar
// chips, and gantt bars + gutter labels all carry the card-el contract and
// share one interaction grammar — click opens detail, ctrl/cmd+click toggles
// one card in the selection, shift+click adds the whole range between the
// anchor and the target (card #144's file-manager grammar), right-click
// selects + opens the context menu (whose actions were already view-agnostic:
// they act on selectedIds, not on DOM). Only the map's ghost stubs opt out
// (see buildMapSvg).
let selectedIds = new Set();
// card #144: the range anchor — the last card a selection gesture landed on
// (ctrl+click, a range-starting shift+click, or a right-click that replaced
// the selection). Never persisted, and never trusted blindly: shift+click
// re-validates it against the rendered order and re-plants it when the card
// vanished (poll/delete) or left the active view (filter/view switch).
let selectionAnchor = null;
let bulkDragIds = null; // captured at dragstart; null = single-card drag

// The rendered order shift+click ranges over (card #144): every card-el in
// the ACTIVE view's container, document order, deduped to first occurrence
// (a multi-day calendar run repeats one id across chips; gantt rows pair a
// gutter label with a bar). Hidden views keep stale DOM — applyViewMode only
// toggles .hidden — so the query must scope to the active container, not the
// whole document.
function visibleCardIds() {
  const ids = [...$(VIEW_CONTAINERS[loadViewMode()]).querySelectorAll('.card-el')].map((el) => Number(el.dataset.id));
  return [...new Set(ids)];
}

function hideContextMenu() {
  $('#context-menu').classList.add('hidden');
}

function showContextMenu(x, y) {
  const menu = $('#context-menu');
  menu.classList.remove('hidden');
  // Clamp to the viewport so the menu never opens half off-screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

async function bulkArchive() {
  hideContextMenu();
  const skipped = selectedCards().filter((c) => c.archived).length; // already archived (card #34: mixed selections)
  const toArchive = selectedCards().filter((c) => !c.archived);
  const ids = toArchive.map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Everything selected is already archived.'); return; }
  // one speedbump for the batch, not one per card (#26) — skipped entirely
  // when every card being archived is already done (card #92)
  if (archiveNeedsConfirm(toArchive) && !confirm(`Archive ${ids.length} card(s)? (moves their files to archived/)`)) return;
  const failed = [];
  for (const id of ids) {
    try { await api('POST', `/api/cards/${id}/archive`); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  selectedIds = new Set();
  await loadBoard();
  const skipNote = skipped ? `; skipped ${skipped} already archived` : '';
  toast(failed.length ? `Archived ${ids.length - failed.length}${skipNote}; failed: ${failed.join(', ')}` : `Archived ${ids.length} card(s)${skipNote}.`);
}

// Restore selected (card #34): the reversible direction — no confirm, same
// exemption as the tile button; status stays untouched (drag names a
// destination, the menu doesn't). Live cards in a mixed selection skip.
async function bulkRestore() {
  hideContextMenu();
  const skipped = selectedCards().filter((c) => !c.archived).length;
  const ids = selectedCards().filter((c) => c.archived).map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Nothing selected is archived.'); return; }
  const failed = [];
  for (const id of ids) {
    try { await api('POST', `/api/cards/${id}/restore`); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  await loadBoard(); // selection survives — restored cards are still on the board
  const skipNote = skipped ? `; skipped ${skipped} not archived` : '';
  toast(failed.length ? `Restored ${ids.length - failed.length}${skipNote}; failed: ${failed.join(', ')}` : `Restored ${ids.length} card(s)${skipNote}.`);
}

async function bulkDelete() {
  hideContextMenu();
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Permanently delete ${ids.length} card(s)? This cannot be undone.`)) return;
  const failed = [];
  for (const id of ids) {
    try { await api('DELETE', `/api/cards/${id}`); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  selectedIds = new Set();
  await loadBoard();
  toast(failed.length ? `Deleted ${ids.length - failed.length}; failed: ${failed.join(', ')}` : `Deleted ${ids.length} card(s).`);
}

// Bulk move (drag): the doing entry gate (waiting + blocked, epic #137)
// stays per card — refused cards are skipped with one honest summary toast
// naming which gate, the rest move (card #25's no all-or-nothing rule).
async function onBulkDrop(ids, status) {
  const byId = new Map(state.active.map((c) => [c.id, c]));
  // same in-place rule as onDrop: cards already rendering in the target
  // column (incl. parked unlisted statuses) drop out of the batch untouched
  ids = ids.filter((i) => { const c = byId.get(i); return c && columnForStatus(c.status, state.statuses) !== status; });
  const { movable, refused } = partitionByMovable(ids, byId, status, refusesDoing);
  if (!movable.length && !refused.length) return;
  const prev = new Map(movable.map((c) => [c.id, c.status]));
  movable.forEach((c) => { c.status = status; }); // optimistic
  selectedIds = new Set();
  renderBoard();
  pendingDrops++; // same poll guard as single onDrop
  const failed = [];
  try {
    for (const c of movable) {
      try { await api('PATCH', `/api/cards/${c.id}`, { status }); }
      catch (e) { c.status = prev.get(c.id); failed.push(`#${c.id} (${e.message})`); }
    }
    await loadBoard();
  } finally {
    pendingDrops--;
  }
  const parts = [];
  if (movable.length - failed.length) parts.push(`Moved ${movable.length - failed.length} to ${status}`);
  if (refused.length) parts.push(`skipped ${refused.map((c) => `#${c.id} (${refusalWord(c)})`).join(', ')}`);
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  if (parts.length) toast(parts.join('; ') + '.');
}

// --- Bulk edits (card #32): assign / set-priority share one single-choice
// popup, tags get a workbench. N per-card PATCHes, per-card failures don't
// abort (bulk-move semantics). No confirm — the popup's Apply IS the
// speedbump (edits are reversible, unlike archive/delete) — and the
// selection survives so bulk actions chain on the same batch.
let bulkSingleMode = null; // 'assignee' | 'priority'

function selectedCards() {
  return [...state.active, ...state.archived].filter((c) => selectedIds.has(c.id));
}

function openBulkSingle(mode) {
  hideContextMenu();
  if (!selectedIds.size) return;
  bulkSingleMode = mode;
  $('#bulk-single-title').textContent = mode === 'assignee'
    ? `Assign ${selectedIds.size} card(s)` : `Set priority on ${selectedIds.size} card(s)`;
  $('#bulk-single-hint').textContent = mode === 'assignee' ? 'Leave empty to unassign.' : '';
  $('#bulk-single-input').value = '';
  $('#bulk-single-apply').disabled = mode === 'priority'; // priority requires a value
  applyModalFullscreen('bulkSingle'); // re-apply the persisted preference on every open
  $('#bulk-single').classList.remove('hidden');
  $('#bulk-single-input').focus();
}

async function bulkPatch(ids, changesFor, summary) {
  const failed = [];
  for (const id of ids) {
    try { await api('PATCH', `/api/cards/${id}`, changesFor(id)); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  await loadBoard(); // selection survives — pruneSelection only drops departed ids
  toast(failed.length ? `${summary(ids.length - failed.length)}; failed: ${failed.join(', ')}` : `${summary(ids.length)}.`);
}

async function applyBulkSingle() {
  const value = $('#bulk-single-input').value.trim();
  if (bulkSingleMode === 'priority' && !value) return;
  const mode = bulkSingleMode;
  $('#bulk-single').classList.add('hidden');
  const label = mode === 'assignee'
    ? (value ? `Assigned ${value} to` : 'Unassigned')
    : `Priority ${value} set on`;
  await bulkPatch([...selectedIds], () => (mode === 'assignee' ? { assignee: value } : { priority: value }), (n) => `${label} ${n} card(s)`);
}

function renderBulkTags() {
  const cards = selectedCards();
  $('#bulk-tags-title').textContent = `Edit tags on ${cards.length} card(s)`;
  const list = $('#bulk-tag-list');
  const union = tagUnion(cards);
  if (!union.length) { list.textContent = 'No tags on the selected cards yet.'; return; }
  list.replaceChildren(...union.map(({ tag, count }) => {
    const label = document.createElement('label');
    label.className = 'bulk-tag-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = tag;
    label.append(cb, ` ${tag} `);
    const badge = document.createElement('span');
    badge.className = 'bulk-tag-count';
    badge.textContent = `(${count})`;
    label.appendChild(badge);
    return label;
  }));
}

function openBulkTags() {
  hideContextMenu();
  if (!selectedIds.size) return;
  $('#bulk-tag-input').value = '';
  renderBulkTags();
  applyModalFullscreen('bulkTags'); // re-apply the persisted preference on every open
  $('#bulk-tags').classList.remove('hidden');
  // No autofocus: focusing would drop the suggestions open before the user
  // asked — the field opens its menu when deliberately clicked/tabbed into.
}

async function bulkAddTag() {
  const tag = $('#bulk-tag-input').value.trim();
  if (!tag) return;
  const changes = addTagChanges(selectedCards(), tag);
  $('#bulk-tag-input').value = '';
  if (!changes.length) { toast(`All selected cards already have "${tag}".`); return; }
  const byId = new Map(changes.map((c) => [c.id, c.tags]));
  await bulkPatch([...byId.keys()], (id) => ({ tags: byId.get(id) }), (n) => `Added "${tag}" to ${n} card(s)`);
  renderBulkTags(); // workbench stays open for the next operation
}

async function bulkRemoveTags() {
  const chosen = [...$('#bulk-tag-list').querySelectorAll('input:checked')].map((cb) => cb.value);
  if (!chosen.length) { toast('Tick the tags to remove first.'); return; }
  const changes = removeTagsChanges(selectedCards(), chosen);
  const byId = new Map(changes.map((c) => [c.id, c.tags]));
  await bulkPatch([...byId.keys()], (id) => ({ tags: byId.get(id) }), (n) => `Removed ${chosen.join(', ')} from ${n} card(s)`);
  renderBulkTags();
}

// --- Schedule… popup (card #42): bulk set/clear across the date triad, same
// contract as the other bulk edits — no confirm (Apply is the speedbump,
// dates are reversible), per-card failures don't abort, selection survives.
// The three rows reuse #41's date-picker through the shared .date-pick-btn
// loop below (the popup's buttons are static markup, so the loop wires them
// like the form's); the pure rules (scheduleChanges/scheduleSummary) live in
// bulk-edit.js.
const SCHEDULE_ROWS = [
  ['start', '#bs-start', '#bs-start-clear'],
  ['end', '#bs-end', '#bs-end-clear'],
  ['due', '#bs-due', '#bs-due-clear'],
];

function readScheduleFields() {
  const fields = {};
  for (const [key, inputSel, clearSel] of SCHEDULE_ROWS) {
    fields[key] = { value: $(inputSel).value, clear: $(clearSel).checked };
  }
  return fields;
}

// Clear wins over typing, so a field whose clear box is ticked has its input
// AND its 📅 button disabled — the popup never shows a value that won't
// apply. Apply stays disabled until something is touched (the priority
// popup's discipline): scheduleChanges() === null IS the untouched predicate,
// so the button and the PATCH can never disagree.
function refreshScheduleControls() {
  for (const [, inputSel, clearSel] of SCHEDULE_ROWS) {
    const off = $(clearSel).checked;
    $(inputSel).disabled = off;
    document.querySelector(`.date-pick-btn[data-date-input="${inputSel.slice(1)}"]`).disabled = off;
  }
  $('#bulk-schedule-apply').disabled = scheduleChanges(readScheduleFields()) === null;
}

function openBulkSchedule() {
  hideContextMenu();
  if (!selectedIds.size) return;
  $('#bulk-schedule-title').textContent = `Schedule ${selectedIds.size} card(s)`;
  for (const [, inputSel, clearSel] of SCHEDULE_ROWS) { // fresh slate on every open
    $(inputSel).value = '';
    $(clearSel).checked = false;
  }
  refreshScheduleControls(); // re-enables the inputs, disables Apply
  applyModalFullscreen('bulkSchedule'); // re-apply the persisted preference on every open
  $('#bulk-schedule').classList.remove('hidden');
  $('#bs-start').focus(); // plain input, no combobox — safe to focus (contrast openBulkTags)
}

async function applyBulkSchedule() {
  const changes = scheduleChanges(readScheduleFields());
  $('#bulk-schedule').classList.add('hidden');
  if (!changes) return; // untouched — Apply is disabled then, but belt-and-braces: just close
  await bulkPatch([...selectedIds], () => changes, (n) => `Scheduled ${n} card(s): ${scheduleSummary(changes)}`);
}

// verify finding: card #96's own doc comment called these three "unchanged —
// still no explicit Esc handling", leaving Esc a true no-op on a fullscreen
// bulk popup (the old fullscreen-exit step it relied on was removed and
// nothing replaced it here). Esc now closes whichever one is open, directly,
// same as its own backdrop-click — no confirm, since bulk edits are
// speedbump-exempt (Apply is the speedbump, same reasoning as backdrop-close).
function closeAnyBulkPopup() {
  for (const sel of ['#bulk-single', '#bulk-tags', '#bulk-schedule']) {
    const el = $(sel);
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return true; }
  }
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  // --- Shared card-el grammar (card #39): ONE delegated click + contextmenu
  // pair on document covers every card-representing element in every view —
  // board tiles, map nodes/isolated tiles, calendar chips, gantt bars/gutter
  // labels — instead of per-view duplicates that would drift. Document is the
  // stable ancestor (the view containers are all rebuilt-into, never
  // replaced, but one listener beats four). View-specific controls keep their
  // own per-view delegated handlers, which run FIRST (they're deeper in the
  // bubble path) and are excluded here by the interactive-control guard: a
  // click landing on a button/select inside or around a card-el (archive
  // tile's Restore/Delete, column sort controls, calendar nav) belongs to
  // that control, never to the card grammar. Registration order matters:
  // this runs before the Q0 clear-selection handler below, so a plain click
  // on a card empties the selection here and Q0 then no-ops.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.card-el');
    if (!el) return;
    if (e.target.closest('button, select, input, a')) return;
    const id = Number(el.dataset.id);
    // card #144: file-manager selection grammar (was: shift toggles one, #25).
    // Shift+click ADDS the whole range between the anchor and the target, in
    // the active view's rendered order; ctrl/cmd+click toggles one card and
    // plants the anchor. renderBoard() repaints whichever view is active —
    // board columns always, plus the active map/calendar/gantt.
    if (e.shiftKey) {
      const order = visibleCardIds();
      // no usable anchor (never set, card gone, or filtered out of this
      // view) — this click starts the range: select the target, anchor here
      if (!order.includes(selectionAnchor)) selectionAnchor = id;
      selectedIds = rangeSelection(selectedIds, order, selectionAnchor, id);
      renderBoard();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      selectedIds = toggleSelection(selectedIds, id);
      selectionAnchor = id;
      renderBoard();
      return;
    }
    // Plain click breaks any selection, then just opens the card as always.
    selectionAnchor = null;
    if (selectedIds.size) { selectedIds = new Set(); renderBoard(); }
    openDetailModal(id);
  });
  // Right-click on any card-el opens the bulk menu; anywhere else keeps the
  // browser's own context menu (card #25: don't hijack the whole page).
  // card #33 semantics via contextSelection: an unselected card becomes THE
  // selection in the same gesture; a selected one keeps the whole batch.
  document.addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // a chorded right-click mid-drag must not re-render under the gesture
    const el = e.target.closest('.card-el');
    if (!el) return;
    const next = contextSelection(selectedIds, Number(el.dataset.id));
    if (next !== selectedIds) {
      selectedIds = next;
      selectionAnchor = Number(el.dataset.id); // the gesture restarted the selection — ranges extend from here (card #144)
      renderBoard();
    }
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  $('#ctx-archive').addEventListener('click', bulkArchive);
  $('#ctx-restore').addEventListener('click', bulkRestore);
  $('#ctx-delete').addEventListener('click', bulkDelete);
  // Bulk edits (card #32)
  $('#ctx-assign').addEventListener('click', () => openBulkSingle('assignee'));
  $('#ctx-priority').addEventListener('click', () => openBulkSingle('priority'));
  $('#ctx-tags').addEventListener('click', openBulkTags);
  // Schedule… popup (card #42)
  $('#ctx-schedule').addEventListener('click', openBulkSchedule);
  $('#bulk-schedule-apply').addEventListener('click', applyBulkSchedule);
  $('#bulk-schedule-close').addEventListener('click', () => $('#bulk-schedule').classList.add('hidden'));
  $('#bulk-schedule-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkSchedule'));
  // Touched-state recompute: typing, picker writes (the popover dispatches a
  // bubbling 'input' — see the date-picker glue), and clear-checkbox flips
  // all funnel through these two delegated listeners; refresh is idempotent,
  // so a checkbox firing both events is harmless.
  $('#bulk-schedule').addEventListener('input', refreshScheduleControls);
  $('#bulk-schedule').addEventListener('change', refreshScheduleControls);
  $('#bulk-single-apply').addEventListener('click', applyBulkSingle);
  $('#bulk-single-close').addEventListener('click', () => $('#bulk-single').classList.add('hidden'));
  $('#bulk-single-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkSingle'));
  $('#bulk-tags-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkTags'));
  $('#bulk-single-input').addEventListener('input', () => {
    $('#bulk-single-apply').disabled = bulkSingleMode === 'priority' && !$('#bulk-single-input').value.trim();
  });
  $('#bulk-tag-add').addEventListener('click', bulkAddTag);
  $('#bulk-tags-remove').addEventListener('click', bulkRemoveTags);
  $('#bulk-tags-close').addEventListener('click', () => $('#bulk-tags').classList.add('hidden'));
  // Backdrop click closes a bulk popup (speedbump-exempt: edits are the
  // reversible direction) and deliberately keeps the selection.
  $('#bulk-single').addEventListener('click', (e) => { if (e.target.id === 'bulk-single') $('#bulk-single').classList.add('hidden'); });
  $('#bulk-tags').addEventListener('click', (e) => { if (e.target.id === 'bulk-tags') $('#bulk-tags').classList.add('hidden'); });
  $('#bulk-schedule').addEventListener('click', (e) => { if (e.target.id === 'bulk-schedule') $('#bulk-schedule').classList.add('hidden'); });
  // Popup comboboxes: same suggest-never-validate lists as the edit form.
  attachCombobox($('#bulk-single-input'), () => (bulkSingleMode === 'assignee'
    ? state.assignees.map((a) => ({ value: a.handle, label: `${a.handle}${a.name ? ` — ${a.name}` : ''}${a.kind ? ` (${a.kind})` : ''}` }))
    : (state.priorities.length ? state.priorities : DEFAULT_PRIORITIES).map((v) => ({ value: v }))));
  attachCombobox($('#bulk-tag-input'), () => state.tags.map((v) => ({ value: v })));
  // Any left-click outside the menu dismisses it (actions inside handle themselves).
  document.addEventListener('click', (e) => {
    if (!$('#context-menu').classList.contains('hidden') && !e.target.closest('#context-menu')) hideContextMenu();
  });
  // Q0 (card #32): any plain click that isn't inside the context menu or a
  // bulk popup drops the multi-selection. Ctrl-, cmd- and shift-clicks build
  // it (card #144); the menu and popups are exempt so they don't kill their
  // own target batch. The view toggle buttons are exempt too (card #39): the
  // selection must survive a view switch. Card #41's date-picker popover
  // renders into document.body (outside #modal), so it and #42's schedule
  // popup are exempt as well.
  document.addEventListener('click', (e) => {
    if (!selectedIds.size || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest('#context-menu, #bulk-single, #bulk-tags, #bulk-schedule, .date-picker-pop, #map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, .cal-nav, .map-filter-toggle, .map-section-toggle, .gantt-filter-toggle, .calendar-filter-toggle')) return; // curate-the-view controls: month paging (.cal-nav), the #56 map pills, the #97 section collapse toggles, the #98 gantt pills, and the #99 calendar pills must not wipe a building selection
    selectedIds = new Set();
    selectionAnchor = null; // a dead selection must not leave an invisible range anchor behind (card #144)
    renderBoard();
  });
  window.addEventListener('resize', hideContextMenu);
  // Backdrop click on the edit/new-card form goes through the dirty guard (#26).
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') requestCloseModal(); });
});

// --- Assignees registry (card #27): config.yaml's assignees feed the form's datalist.
// The registry suggests, it never validates — free text stays allowed, and an
// unregistered assignee on an existing card saves fine. Card #132: a board
// with NO registry falls back to the canonical @human/@hitl/@afk role trio
// (resolveAssignees/DEFAULT_ASSIGNEES, assignee-badge.js) — a configured
// registry still wins untouched, and free text stays legal either way.
function applyAssignees(list) {
  state.assignees = resolveAssignees(list); // the combobox menus read state live — nothing to render here
}

// --- Official lists (card #30): config.yaml's priorities/tags feed the form's
// datalists — same suggest-never-validate contract as the assignee registry.
// Priorities fall back to the built-in High/Normal/Low so the combobox is
// never empty; tags suggest one full value at a time (a comma-separated field
// only completes its current single entry — good enough on purpose).
function applyLists(priorities, tags) {
  state.priorities = priorities; // the combobox menus read state live
  state.tags = tags;
}

// --- Hand-rolled comboboxes (card #30): native <datalist> misrenders inside
// VSCode's Simple Browser (popup at wrong screen coordinates) and its
// filter-by-current-value hides every option on a prefilled field. The rules
// (which options to show, how a pick lands in the text) live in combobox.js;
// this is only the menu DOM. Focus/typing opens, mousedown picks (fires
// before blur), blur/Esc closes — Esc is swallowed so the modal stays open.
//
// card #95 adds keyboard grammar on top: Up/Down move a visible `highlightIndex`
// through the CURRENTLY RENDERED `items` (wrap math is nextHighlightIndex,
// combobox.js; the highlighted row is also scrolled into view — a menu longer
// than its 180px max-height must never leave the active row invisible). Enter
// falls through to the surrounding <form>'s native submit-on-Enter ONLY when
// the menu is CLOSED (card #95 AC1, verify finding) — an open menu always
// consumes Enter itself: picks the highlighted row, or (nothing highlighted)
// just closes the menu so the very next Enter is the one that reaches the
// form. #50/#85's minimal-create flow is unaffected: a mouse pick already
// closes the menu before Enter is ever pressed, and the plain title-only
// flow never opens the assignee menu at all — a keyboard-driven pick
// (ArrowDown+Enter) now takes a second Enter to submit, which is the
// literal reading of the AC. Esc keeps #96's contract: it closes the
// menu ONLY and stops propagation so the document-level popup-close handler
// never sees that keypress — the next Esc is the one that closes the popup.
function attachCombobox(input, getOptions, opts = {}) {
  const menu = document.createElement('div');
  menu.className = 'combobox-menu';
  menu.hidden = true;
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(menu);
  let items = [];          // options currently rendered, in menu order — keydown reads this
  let highlightIndex = -1; // -1 = nothing highlighted
  const close = () => { menu.hidden = true; items = []; highlightIndex = -1; };
  const setHighlight = (idx) => {
    highlightIndex = idx;
    [...menu.children].forEach((el, i) => el.classList.toggle('active', i === idx));
    // verify finding: .combobox-menu is max-height:180px/overflow-y:auto — a
    // classList toggle alone never scrolls an unfocused div into view, so a
    // menu with more rows than fit (8+ tags/assignees) left the highlight
    // invisible past the fold, wrap-around included.
    const active = menu.children[idx];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  };
  const pick = (choice) => {
    // browse-pick (nothing typed since focus) appends a tag; a pick while
    // typing completes the segment in progress
    input.value = applyChoice(input.value, choice.value, { ...opts, append: !typed });
    input.dispatchEvent(new Event('input', { bubbles: true })); // form-guard sees the change
    close();
  };
  // Focus always shows the FULL list (the text is pre-selected, so typing
  // replaces it) — filtering only applies while typing. A stale value that
  // matches nothing (e.g. an unregistered assignee on an old card) must not
  // leave the menu empty on click.
  const open = (filtered) => {
    items = filtered ? comboboxSuggestions(getOptions(), input.value, opts) : getOptions();
    if (!items.length) return close();
    highlightIndex = -1; // every (re)open starts with nothing highlighted, including re-filters mid-typing
    menu.replaceChildren(...items.map((o) => {
      const el = document.createElement('div');
      el.className = 'combobox-item';
      el.textContent = o.label || o.value;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in the input
        pick(o);
      });
      return el;
    }));
    menu.hidden = false;
  };
  let typed = false; // has the user typed since the menu opened?
  input.addEventListener('focus', () => { typed = false; input.select(); open(false); });
  input.addEventListener('input', (e) => { if (e.isTrusted) { typed = true; open(true); } });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { close(); e.stopPropagation(); return; }
    if (menu.hidden) return; // closed menu: Enter/Arrows are the form's or the browser's business, not ours
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // don't let the browser hunt for another focusable element
      setHighlight(nextHighlightIndex(items.length, highlightIndex, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      if (e.altKey) return; // Alt+Enter belongs to the fullscreen hotkey (card #145), never a pick
      // verify finding: card #95 AC1 says Enter falls through to the form's
      // native submit ONLY when the menu is closed — an open menu must always
      // consume it, never just the highlighted case. Without this, typing to
      // re-filter after an Arrow-highlight (open() resets highlightIndex to
      // -1 on every re-filter) let Enter silently reach the form instead of
      // picking. #50/#85 are unaffected: a mouse pick already closes the menu
      // (mousedown fires before Enter), and the plain title-only flow never
      // opens the assignee menu at all.
      e.preventDefault();
      if (highlightIndex >= 0) pick(items[highlightIndex]);
      else close(); // nothing highlighted — accept the typed text and close; a second Enter then submits, menu now closed
    }
  });
}

attachCombobox($('#f-priority'), () => (state.priorities.length ? state.priorities : DEFAULT_PRIORITIES).map((v) => ({ value: v })));
attachCombobox($('#f-assignee'), () => state.assignees.map((a) => ({
  value: a.handle, // stored value stays the bare handle — no card migration
  label: `${a.handle}${a.name ? ` — ${a.name}` : ''}${a.kind ? ` (${a.kind})` : ''}`,
})));
attachCombobox($('#f-tags'), () => state.tags.map((v) => ({ value: v })), { tagMode: true });

// --- Date-picker popover (card #41): every date field (f-start/f-end/f-due)
// pairs its free-text input with a 📅 button that opens a hand-rolled month
// grid. Native <input type="date"> is off the table for the same reason as
// <datalist> (card #30): native widgets misrender inside VSCode's Simple
// Browser. Manual typing stays fully legal — the picker only ever writes
// values the free-text contract already allows (pickDay reuses shiftValue, so
// a typed time tail survives a pick). The pure rules (pickDay/initialMonth)
// live in date-picker.js; month math is calendar-model.js's.
//
// ONE popover instance serves all fields (the combobox-menu discipline of one
// menu per anchor doesn't fit here — the grid is heavy, and only one can be
// open anyway), rendered into document.body with position:fixed computed from
// the button's getBoundingClientRect. NOT absolutely positioned inside the
// field's label like the combobox menus: the form modal is overflow:auto
// (.modal), so anything positioned inside it gets clipped at the modal edge
// and dragged along mid-scroll — fixed-in-body escapes every overflow context
// (nothing above body carries a transform/filter, the same reasoning that
// lets .modal.fullscreen position against the real viewport).

let datePickerFor = null;    // the <input> the popover is open for; null = closed
let datePickerAnchor = null; // the 📅 button that opened it (positioning anchor)
let datePickerMonth = null;  // { year, monthIndex } — per-opening nav state, lives in JS only

function datePickerPop() {
  let pop = document.querySelector('.date-picker-pop');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'date-picker-pop';
  pop.hidden = true;
  // One delegated listener outlives every re-render (renderDatePicker swaps
  // the children on each nav click) — same discipline as #calendar-view's.
  pop.addEventListener('click', (e) => {
    // Everything inside the popover is popover business: stop here so the
    // document outside-closer and Q0 never see these clicks. Critically, a
    // nav click re-renders via replaceChildren, DETACHING the clicked button
    // mid-dispatch — a detached target makes closest('.date-picker-pop')
    // return null downstream, which closed the popover on every nav press.
    e.stopPropagation();
    const nav = e.target.closest('.dp-nav');
    if (nav) {
      // type=button AND outside the form (the popover lives in body), so a
      // nav click can never submit the card form.
      datePickerMonth = nav.dataset.dp === 'today'
        ? initialMonth('', localTodayStr())
        : shiftMonth(datePickerMonth.year, datePickerMonth.monthIndex, Number(nav.dataset.dp));
      renderDatePicker();
      return;
    }
    const dayBtn = e.target.closest('.dp-day');
    if (dayBtn && datePickerFor) {
      const input = datePickerFor;
      input.value = pickDay(input.value, dayBtn.dataset.day);
      // bubbling like a real keystroke: the dirty guard's snapshot diff and
      // any other 'input' listeners must see the picker's write
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeDatePicker();
      input.focus();
    }
  });
  document.body.appendChild(pop);
  return pop;
}

function closeDatePicker() {
  if (!datePickerFor) return;
  datePickerFor = null;
  datePickerAnchor = null;
  datePickerPop().hidden = true;
}

function openDatePicker(input, btn) {
  datePickerFor = input;
  datePickerAnchor = btn;
  datePickerMonth = initialMonth(input.value, localTodayStr());
  renderDatePicker();
}

function renderDatePicker() {
  const pop = datePickerPop();
  const { year, monthIndex } = datePickerMonth;
  const controls = document.createElement('div');
  controls.className = 'date-picker-controls';
  controls.innerHTML =
    `<button type="button" class="dp-nav" data-dp="-1" title="Previous month" aria-label="Previous month">&#8249;</button>` +
    `<button type="button" class="dp-nav" data-dp="today" title="Jump back to the current month">Today</button>` +
    `<button type="button" class="dp-nav" data-dp="1" title="Next month" aria-label="Next month">&#8250;</button>` +
    `<span class="date-picker-title">${escapeHtml(monthTitle(year, monthIndex))}</span>`;
  const grid = document.createElement('div');
  grid.className = 'date-picker-grid';
  for (const dow of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) { // Monday-first, same as monthGrid/the calendar view
    const h = document.createElement('div');
    h.className = 'dp-dow';
    h.textContent = dow;
    grid.appendChild(h);
  }
  const today = localTodayStr();
  const selected = dayPart(datePickerFor.value); // '' when the field is empty/garbage — then nothing is marked selected
  for (const cell of monthGrid(year, monthIndex)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-day' + (cell.inMonth ? '' : ' outside') +
      (cell.date === today ? ' today' : '') + (selected && cell.date === selected ? ' selected' : '');
    b.dataset.day = cell.date;
    b.textContent = cell.day;
    b.title = cell.date;
    grid.appendChild(b);
  }
  pop.replaceChildren(controls, grid);
  pop.hidden = false;
  positionDatePicker();
}

// Fixed positioning from the anchor button's viewport rect: below it by
// default, flipped above when the grid wouldn't fit under (the date row sits
// low in the form), clamped to the viewport's horizontal edges. Measured
// AFTER render/unhide so offsetWidth/Height are real (5- vs 6-week months
// differ in height).
function positionDatePicker() {
  const pop = datePickerPop();
  const r = datePickerAnchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
  const below = r.bottom + 4;
  const top = (below + pop.offsetHeight > window.innerHeight && r.top - pop.offsetHeight - 4 > 0)
    ? r.top - pop.offsetHeight - 4 : below;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

document.querySelectorAll('.date-pick-btn').forEach((btn) => {
  const input = document.getElementById(btn.dataset.dateInput);
  // Toggle: same button closes; a different field's button MOVES the one
  // popover there (openDatePicker re-derives month + selection per opening).
  btn.addEventListener('click', () => {
    if (datePickerFor === input) closeDatePicker();
    else openDatePicker(input, btn);
  });
});

// Clicking anywhere outside closes it. The popover's own clicks and the 📅
// buttons are skipped — the buttons manage their own toggle/move above (this
// bubble listener also fires for the opening click; without the skip it
// would close what that click just opened).
document.addEventListener('click', (e) => {
  if (!datePickerFor) return;
  if (e.target.closest('.date-picker-pop, .date-pick-btn')) return;
  closeDatePicker();
});

// Esc closes the picker and ONLY the picker — the combobox Esc rule. Capture
// phase so this runs before the document-level bubble Esc handler (popup
// close / search clear — card #96 dropped the old fullscreen-exit step from
// that list) no matter where focus sits (input, 📅 button, or a popover
// button), and stopPropagation keeps that handler from also firing on the
// same press.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !datePickerFor) return;
  const input = datePickerFor;
  closeDatePicker();
  input.focus();
  e.stopPropagation();
}, true);

// position:fixed goes stale the moment the anchor moves under it: close on
// window resize (the context menu's rule) and on any scroll — capture phase
// because the form modal's overflow:auto scroll doesn't bubble to window.
window.addEventListener('resize', closeDatePicker);
document.addEventListener('scroll', closeDatePicker, true);

// Text-selection guard scoped to the gesture (card #25): tiles are only
// unselectable while shift is actually held, so their text stays copyable the
// rest of the time. blur clears the class in case keyup lands off-window.
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') document.body.classList.add('shift-held'); });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') document.body.classList.remove('shift-held'); });
window.addEventListener('blur', () => document.body.classList.remove('shift-held'));

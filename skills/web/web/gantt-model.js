'use strict';
// Pure row/window/drag math for the gantt view (card #38). No DOM/localStorage
// here on purpose — same dual-environment pattern as calendar-model.js:
// unit-testable from node --test AND loaded as a plain <script> in the browser
// (app.js calls these as bare globals).
//
// All date arithmetic is REUSED from calendar-model.js (dayPart/addDays/
// diffDays/cardSchedule/shiftValue/dayToUtc) — in Node via require, in the
// browser off window, where calendar-model.js loads first (app.html order,
// enforced by a server test). CAL is a namespace object rather than top-level
// destructured consts so this classic script can't shadow calendar-model's
// own global bindings for every script that loads after it.
const CAL = (typeof module !== 'undefined' && module.exports)
  ? require('./calendar-model')
  : window;

// The four live board columns, in board order — gantt rows group by these.
// Archive is a location, not a status (ADR 0002), and the gantt shows LIVE
// cards only, so it never appears here.
const GANTT_STATUS_ORDER = ['backlog', 'todo', 'doing', 'done'];

// Hard cap on the rendered window (see ganttWindow's clamp rule below).
const GANTT_MAX_DAYS = 180;

// Width of one day column in px. Lives here — not in the CSS — because the
// drag math divides by it (day delta = round(dx / GANTT_DAY_PX)); app.js
// writes all timeline geometry inline from this constant so layout and drag
// arithmetic can't drift apart.
const GANTT_DAY_PX = 24;

// --- bar span: which days does a card's bar cover? ---------------------------
// The bar is the WORKING RANGE (card #40), reusing cardSchedule's shapes
// verbatim: a range bar runs the range inclusive (start->end, or the #36
// compat pair start->due when end_date is absent); start-only and end-only
// are 1-day bars on their one date; a REVERSED range is a 1-day bar at the
// range end — the same collapse the calendar renders, so the two views never
// disagree. Due is an independent diamond marker now: a due-only card has NO
// bar (card #40 — that replaces #38's due-only 1-day bar rule).

function barSpan(card) {
  const s = CAL.cardSchedule(card);
  if (s.kind === 'range') return { startDay: s.startDay, endDay: s.endDay };
  if (s.kind === 'single') return { startDay: s.day, endDay: s.day };
  return null;
}

// --- row grouping --------------------------------------------------------------
// Only dated cards appear — a card earns a row with a bar span (working
// range), a dueDay (diamond marker, card #40), or both; startDay/endDay are
// null on a due-only row. Groups follow board column order — card #31: the
// configured `statuses` list when the caller passes one, the built-in four
// otherwise; a status with no dated cards is omitted entirely (no empty
// label rows). An unlisted status (legal on disk — cards are never
// validated) still shows, appended after the listed groups alphabetically —
// same tolerance as the map view's status-unknown nodes. Ids ascend within
// a group.

// One row's shape — card, startDay/endDay (barSpan) and dueDay (dueMarker) —
// or null when the card has neither (undated: dropped entirely by both
// ganttGroups and ganttArchiveGroup below, same rule for live and archived).
function ganttRow(card) {
  const span = barSpan(card);
  const due = CAL.dueMarker(card);
  if (!span && !due) return null;
  return {
    card,
    startDay: span ? span.startDay : null,
    endDay: span ? span.endDay : null,
    dueDay: due ? due.day : null,
  };
}

function ganttGroups(cards, statuses) {
  const order = statuses && statuses.length ? statuses : GANTT_STATUS_ORDER;
  const buckets = new Map();
  for (const card of cards) {
    const row = ganttRow(card);
    if (!row) continue;
    const status = String(card.status || '');
    if (!buckets.has(status)) buckets.set(status, []);
    buckets.get(status).push(row);
  }
  const known = order.filter((s) => buckets.has(s));
  const unknown = [...buckets.keys()].filter((s) => !order.includes(s)).sort();
  return known.concat(unknown).map((status) => ({
    status,
    bars: buckets.get(status).sort((a, b) => a.card.id - b.card.id),
  }));
}

// --- archive group (card #98 reopen: "we are missing archived status") ---------
// Every dated ARCHIVED card lands in ONE group keyed 'archive', regardless of
// its own on-disk status field — archive is a LOCATION, not a status (ADR
// 0002), so it never joins ganttGroups' per-status buckets above. The caller
// (renderGanttView, app.js) appends this AFTER the live status groups — same
// "location after live columns" placement as the board's Archive column
// (card #34) — and ONLY when the gantt's own Archive pill is on (default
// OFF: the original #98 close narrative said "no Archive pill"; this reopen
// adds it back opt-in, so the base gantt view stays unchanged). The literal
// 'archive' status key is deliberate, not a placeholder: the render layer's
// existing isBuiltinStatus/statusColor/columnLabel lookups already know that
// exact string (statusColor('archive') mutes to ARCHIVE_COLOR, card #57;
// columnLabel('archive') is 'Archive', column-state.js) — the group needs no
// special-cased rendering, just this one key. Returns null when there's
// nothing dated to show — same "no empty label rows" rule ganttGroups
// follows for a live status with no dated cards — so the caller only appends
// it when it isn't null.
function ganttArchiveGroup(cards) {
  const bars = [];
  for (const card of (cards || [])) {
    const row = ganttRow(card);
    if (row) bars.push(row);
  }
  if (!bars.length) return null;
  bars.sort((a, b) => a.card.id - b.card.id);
  return { status: 'archive', bars };
}

// --- appendArchiveGroup: append-or-merge the archive group into `groups` -------
// Defect fix: ganttGroups (above) buckets LIVE cards by their raw,
// never-validated on-disk status with no guard against the literal value
// 'archive' — a card sitting in kanban/ (archived: false) with a hand-typed
// `status: archive` earns its own group keyed 'archive', same tolerance the
// "unknown statuses append alphabetically" rule already grants any other
// unlisted value. The caller used to push ganttArchiveGroup's OWN
// 'archive'-keyed group unconditionally, which — combined with the above —
// could produce TWO group rows sharing one key: identical label
// (columnLabel('archive')), identical muted color (statusColor('archive')),
// indistinguishable in the DOM, one of them silently holding a live,
// draggable card. Merging into an existing 'archive'-keyed group instead of
// duplicating it matches the mute-everywhere precedent a raw 'archive'
// status already gets elsewhere (statusColor/statusBadge, card #57): that
// card already READS as archived, so one merged row — sorted by id like
// every other group — is the honest picture, not two adjacent copies of it.
// Mutates and returns `groups` (same contract the old `groups.push` call
// had); a null archiveGroup (nothing dated to show) is a no-op.
function appendArchiveGroup(groups, archiveGroup) {
  if (!archiveGroup) return groups;
  const existing = groups.find((g) => g.status === 'archive');
  if (existing) {
    existing.bars = existing.bars.concat(archiveGroup.bars).sort((a, b) => a.card.id - b.card.id);
  } else {
    groups.push(archiveGroup);
  }
  return groups;
}

// --- window extents (card #40) ---------------------------------------------------
// Each row's contribution to the window covers its bar AND its due diamond,
// so a due far outside the range — or a due-only row with no bar at all —
// still lands inside the rendered window. Feed the result to ganttWindow.

function rowWindowSpans(rows) {
  return rows.map((r) => {
    let lo = r.startDay || r.dueDay;
    let hi = r.endDay || r.dueDay;
    if (r.dueDay && r.dueDay < lo) lo = r.dueDay;
    if (r.dueDay && r.dueDay > hi) hi = r.dueDay;
    return { startDay: lo, endDay: hi };
  });
}

// --- window: which day range does the timeline show? ----------------------------
// Natural window = min(start)-3d .. max(due)+3d across the rendered bars.
// CLAMP RULE (card #38): when the natural window exceeds GANTT_MAX_DAYS, the
// window becomes exactly GANTT_MAX_DAYS days, ideally centered on today
// (today at index floor((max-1)/2)), then slid the minimum distance needed to
// stay fully inside the natural window. Consequences, all deliberate:
//   - data surrounding today -> today is visible, centered;
//   - data crowding one side -> the window hugs the data's near edge instead
//     of wasting columns on empty days around today;
//   - all data far in the past/future -> today itself falls outside the
//     window (there is nothing near today to show anyway).
// Days are compared as strings — zero-padded YYYY-MM-DD compares correctly.

function ganttWindow(spans, today, maxDays) {
  const max = maxDays || GANTT_MAX_DAYS;
  if (!spans.length) return null;
  let lo = spans[0].startDay;
  let hi = spans[0].endDay;
  for (const s of spans) {
    if (s.startDay < lo) lo = s.startDay;
    if (s.endDay > hi) hi = s.endDay;
  }
  const natStart = CAL.addDays(lo, -3);
  const natEnd = CAL.addDays(hi, 3);
  const natDays = CAL.diffDays(natStart, natEnd) + 1;
  if (natDays <= max) return { startDay: natStart, endDay: natEnd, days: natDays, clamped: false };
  let start = CAL.addDays(today, -Math.floor((max - 1) / 2));
  const latestStart = CAL.addDays(natEnd, -(max - 1));
  if (start > latestStart) start = latestStart;
  if (start < natStart) start = natStart;
  return { startDay: start, endDay: CAL.addDays(start, max - 1), days: max, clamped: true };
}

// --- week marks ------------------------------------------------------------------

function isMonday(day) {
  return new Date(CAL.dayToUtc(day)).getUTCDay() === 1;
}

const GANTT_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekMarkLabel(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${GANTT_MONTHS_SHORT[m - 1]} ${d}`;
}

// --- drag math (card #38) ----------------------------------------------------------
// Both return the PATCH changes object, or null for "don't PATCH" — a zero
// delta, a card with no parseable date, or a resize fully swallowed by the
// clamp. Null means no `updated` bump either (card #35), so an accidental
// twitch-drag never rewrites the file.

// Dragging the bar BODY shifts the WORKING RANGE by the whole-day delta,
// writing THE FIELDS THE RANGE ACTUALLY USED (rangeFields, card #40): a real
// range shifts start_date+end_date, a compat range shifts start_date+due_date
// — the used pair is KEPT, an end_date is never invented — and one-field
// ranges shift their one field (duration and times-of-day preserved via
// shiftValue). A REVERSED range moves the used end field only and leaves the
// nonsensical start untouched — identical reasoning to the calendar's
// rescheduleChanges (the bar the user sees sits at the range end; writing a
// field they never dragged would be a surprise write). Due is an independent
// marker: a bar drag never touches it unless due IS the compat range end —
// the diamond drags via dueShiftChanges below.
function barShiftChanges(card, dayDelta) {
  if (!dayDelta) return null;
  const rf = CAL.rangeFields(card);
  if (!rf.startDay && !rf.endDay) return null;
  if (rf.startDay && rf.endDay && rf.startDay <= rf.endDay) {
    return {
      [rf.startField]: CAL.shiftValue(card[rf.startField], CAL.addDays(rf.startDay, dayDelta)),
      [rf.endField]: CAL.shiftValue(card[rf.endField], CAL.addDays(rf.endDay, dayDelta)),
    };
  }
  if (rf.endDay) return { [rf.endField]: CAL.shiftValue(card[rf.endField], CAL.addDays(rf.endDay, dayDelta)) }; // end-only, or reversed
  return { [rf.startField]: CAL.shiftValue(card[rf.startField], CAL.addDays(rf.startDay, dayDelta)) };
}

// Dragging the DUE DIAMOND moves due_date alone (card #40), time-of-day
// preserved — the range fields are never touched. Same null contract as the
// other drag functions: zero delta or no parseable due = no PATCH.
function dueShiftChanges(card, dayDelta) {
  if (!dayDelta) return null;
  const due = CAL.dueMarker(card);
  if (!due) return null;
  return { due_date: CAL.shiftValue(card.due_date, CAL.addDays(due.day, dayDelta)) };
}

// Dragging an EDGE moves that RANGE endpoint alone: 'start' writes
// start_date, 'end' writes end_date — EXCEPT compat ranges (start+due, no
// end_date), where the end handle edits due_date, the field the range
// actually used (card #40). Time-of-day of the changed field is preserved
// (shiftValue on a field the card doesn't have yields a plain date — that's
// how an end-only bar's start handle CREATES a start_date, and a start-only
// bar's end handle an end_date; under #38 the latter created a due_date, but
// a start-only card is NOT a compat range, so the triad's "to" is what the
// end handle writes now).
// CLAMP RULE (card #38): deltas apply to the RENDERED bar's edges (barSpan),
// and the moved edge stops at the other rendered edge — a 1-day bar is the
// minimum, so any inward resize of a 1-day bar clamps to a no-op (null).
// Notable corners, all tested:
//   - end-only 'end' MOVES the end date (the only range date there is) — the
//     1-day bar relocates rather than stretches; stretching is the start
//     handle's job (writing two fields would exceed "change one field alone");
//   - reversed range 'start' dragged left writes a sensible start_date below
//     the range end (its time-of-day kept), repairing the reversed pair;
//   - due-only cards have no bar at all (only the diamond), so both edges are
//     null by the !span guard.
function barResizeChanges(card, edge, dayDelta) {
  if (!dayDelta) return null;
  const span = barSpan(card);
  if (!span) return null;
  if (edge === 'start') {
    let day = CAL.addDays(span.startDay, dayDelta);
    if (day > span.endDay) day = span.endDay; // clamp: never past the range end — 1-day minimum
    if (day === span.startDay) return null;
    return { start_date: CAL.shiftValue(card.start_date, day) };
  }
  if (edge === 'end') {
    let day = CAL.addDays(span.endDay, dayDelta);
    if (day < span.startDay) day = span.startDay; // clamp: never before start
    if (day === span.endDay) return null;
    const endField = CAL.rangeFields(card).endField || 'end_date'; // null endField = start-only bar: the end handle CREATES the triad's "to"
    return { [endField]: CAL.shiftValue(card[endField], day) };
  }
  return null; // unknown edge — defensive, never throw from a drag handler
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GANTT_STATUS_ORDER, GANTT_MAX_DAYS, GANTT_DAY_PX,
    barSpan, ganttGroups, ganttArchiveGroup, appendArchiveGroup, rowWindowSpans, ganttWindow, isMonday, weekMarkLabel,
    barShiftChanges, barResizeChanges, dueShiftChanges,
  };
} else {
  window.GANTT_STATUS_ORDER = GANTT_STATUS_ORDER;
  window.GANTT_MAX_DAYS = GANTT_MAX_DAYS;
  window.GANTT_DAY_PX = GANTT_DAY_PX;
  window.barSpan = barSpan;
  window.ganttGroups = ganttGroups;
  window.ganttArchiveGroup = ganttArchiveGroup; // pre-existing gap: called bare in app.js (renderGanttView) but never exposed here — every Archive-pill toggle threw ReferenceError in a real browser
  window.appendArchiveGroup = appendArchiveGroup;
  window.rowWindowSpans = rowWindowSpans; // card #40
  window.ganttWindow = ganttWindow;
  window.isMonday = isMonday;
  window.weekMarkLabel = weekMarkLabel;
  window.barShiftChanges = barShiftChanges;
  window.barResizeChanges = barResizeChanges;
  window.dueShiftChanges = dueShiftChanges; // card #40
}

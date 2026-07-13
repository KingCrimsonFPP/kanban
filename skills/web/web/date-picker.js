'use strict';
// Pure rules for the date-picker popover (card #41). No DOM here — same
// dual-environment pattern as combobox.js: unit-testable from node --test AND
// loaded as a plain <script> in the browser (app.js calls these as bare
// globals). All date parsing/normalizing is REUSED from calendar-model.js
// via the same namespace-require pattern as gantt-model.js — no month math is
// duplicated here. Named DP_CAL, not CAL: gantt-model.js already owns the
// top-level name CAL, and all web/*.js share ONE page scope as classic
// <script>s — a second `const CAL` killed this whole file at parse and every
// 📅 button with it (card #60; test/global-scope.test.js now guards the
// entire blind-spot class).
const DP_CAL = (typeof module !== 'undefined' && module.exports)
  ? require('./calendar-model')
  : window;

// The input's value after picking `dayStr` in the popover: the picked day,
// KEEPING whatever time tail the field already carried ('2026-07-09T14:30' +
// pick 2026-08-01 → '2026-08-01T14:30', THH:MM:SS tails included) so the
// picker never destroys a typed time. That is exactly calendar-model's
// shiftValue contract, tolerance included: a plain-date, empty, or garbage
// current value just becomes the day — the picker only ever writes values the
// free-text contract (card #36) already allows.
function pickDay(currentValue, dayStr) {
  return DP_CAL.shiftValue(currentValue, dayStr);
}

// Which month the popover opens on: the current value's month when it parses
// (date or datetime — dayPart handles both), else today's. `todayStr` is
// injected by the glue (localTodayStr()) so this stays a pure function.
function initialMonth(currentValue, todayStr) {
  const day = DP_CAL.dayPart(currentValue) || String(todayStr);
  let [y, m] = day.split('-').map(Number);
  // never-validate lets impossible months ('2026-13-05') through dayPart's
  // shape regex — a monthIndex outside 0..11 would render a broken grid, so
  // fall back to today rather than trusting it
  if (!(m >= 1 && m <= 12)) [y, m] = String(todayStr).split('-').map(Number);
  return { year: y, monthIndex: m - 1 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickDay, initialMonth };
} else {
  window.pickDay = pickDay;
  window.initialMonth = initialMonth;
}

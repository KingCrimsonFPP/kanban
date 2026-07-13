'use strict';
// Waiting vs blocked predicates (epic #137, web card #139) — the ONE place
// both `doing`-gate semantics live, shared by the store AND the UI. Pure and
// dual-environment, same pattern as calendar-model.js: required directly by
// scripts/card-store.js and node --test, loaded as a plain <script> in the
// browser (app.js / dependency-graph.js read these as bare globals).
//
// Vocabulary (CONTEXT.md glossary):
// - WAITING is derived, never stored: a card is waiting while any id in its
//   `waiting_for` list names a card that is not `done`. A dangling id (no
//   matching card) is non-blocking. A dependency is sequencing, not an
//   impediment.
// - BLOCKED is the manual impediment sticker: `blocked: <reason>`. Blocked
//   iff the trimmed value contains >= 1 alphanumeric character, with the
//   YAML boolean special-case: `false`/`no` -> not blocked; `true` ->
//   blocked, reason unspecified. Tolerant any-case reads, same stance as
//   the epic flag's reader.

// The blocked-sticker predicate. Takes the RAW field value (string from
// frontmatter/JSON, or a real boolean from an API body) — never a card.
function isBlockedValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const t = String(value).trim();
  const low = t.toLowerCase();
  if (low === 'false' || low === 'no') return false;
  return /[a-z0-9]/i.test(t);
}

// The human-readable reason behind a valid sticker: the trimmed text, with
// the bare boolean `true` (reason unspecified) mapping to ''. An invalid /
// clear value has no reason at all.
function blockedReason(value) {
  if (!isBlockedValue(value)) return '';
  if (value === true) return '';
  const t = String(value).trim();
  return t.toLowerCase() === 'true' ? '' : t;
}

// The refusal/tooltip label the epic fixes: "blocked: <reason>", or the bare
// "blocked" when the reason is unspecified. One writer so every surface
// (server 422 message, board pill tooltip, map pill tooltip, toasts) names
// the sticker identically.
function blockedLabel(value) {
  const reason = blockedReason(value);
  return reason ? `blocked: ${reason}` : 'blocked';
}

// The waiting predicate's working half: the cards a `waiting_for` list is
// still waiting ON — every listed id whose card exists and is not `done`,
// in list order. Dangling ids drop out (non-blocking by contract). `byId` is
// the caller's full active+archived lookup (waiting is location-independent,
// same as the old blocked_by check). Returns the card objects so callers can
// format "#3 (todo)" refusals and unresolved-only tooltips.
function unresolvedWaits(waitingFor, byId) {
  return (waitingFor || [])
    .map((id) => byId.get(typeof id === 'number' ? id : Number(id)))
    .filter((c) => c && c.status !== 'done');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isBlockedValue, blockedReason, blockedLabel, unresolvedWaits };
} else {
  window.isBlockedValue = isBlockedValue;
  window.blockedReason = blockedReason;
  window.blockedLabel = blockedLabel;
  window.unresolvedWaits = unresolvedWaits;
}

'use strict';
// ?card=<id>&view=<board|map|gantt|calendar> deep links: parses
// location.search into which card to open and which view to switch to.
// Pure parse-only logic, same dual-environment export pattern as
// search-hotkey.js/refresh-policy.js — app.js's DOMContentLoaded handler
// does the DOM part (switching viewMode, calling openDetailModal,
// scrollIntoView) exactly once, right after the first loadBoard() resolves;
// nothing here holds state, so there's nothing that could re-fire on the 5s
// poll or fight the localStorage-persisted view mode.

const DEEP_LINK_VIEWS = new Set(['board', 'map', 'gantt', 'calendar']);

// `search` is location.search ("?card=194&view=board"), a plain string so
// this stays testable from Node without a DOM. No `card` key at all (the
// overwhelming common case — every normal load) is "no deep link in play",
// returned as null so callers can skip the whole flow with one falsy check.
// A `card` value that isn't a positive integer resolves to id: null rather
// than making the whole link disappear — callers still owe that request a
// "not found" toast, same as an id that parses fine but matches no card. An
// unrecognized/missing `view` resolves to null too: no view switch, normal
// load's persisted view stands.
function parseDeepLink(search) {
  if (typeof search !== 'string' || !search) return null;
  let params;
  try { params = new URLSearchParams(search); } catch (e) { return null; }
  if (!params.has('card')) return null;
  const id = Number(params.get('card'));
  const view = params.get('view');
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    view: DEEP_LINK_VIEWS.has(view) ? view : null,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDeepLink, DEEP_LINK_VIEWS };
} else {
  window.parseDeepLink = parseDeepLink;
  window.DEEP_LINK_VIEWS = DEEP_LINK_VIEWS;
}

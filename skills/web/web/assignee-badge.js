'use strict';
// Pure helpers for the assignee badge (card #21) and the shared HTML-escaping
// used everywhere a card-derived string is interpolated into innerHTML. No DOM
// access here on purpose — same dual-environment pattern as refresh-policy.js/
// column-state.js: loaded as a plain <script> in the browser (app.js calls
// escapeHtml/assigneeBadge as bare globals) AND required directly by
// node --test, without needing a DOM/jsdom shim.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Empty string when unset (server sends null) so no "undefined"/blank badge
// ever renders; escaped like every other card-derived string.
function assigneeBadge(card) {
  return card.assignee ? `<span class="card-assignee">${escapeHtml(card.assignee)}</span>` : '';
}

// Card #132: the @human/@hitl/@afk role trio is THE canonical default — a
// board whose config.yaml has NO assignees registry still suggests exactly
// these three. Shapes mirror config-store registry entries. Suggest, never
// validate: free-text handles stay legal everywhere.
const DEFAULT_ASSIGNEES = [
  { handle: '@human', name: 'Human', kind: 'human', description: 'A human can grab it. Final say on trusted and destructive calls.' },
  { handle: '@hitl', name: 'AI (HITL)', kind: 'ai-hitl', description: 'AI will grab it but needs a human in the loop (grilling, spec, tickets, approval) — it should make the AI think twice.' },
  { handle: '@afk', name: 'AI (AFK)', kind: 'ai-afk', description: 'The AI can execute fully autonomously.' },
];

// A configured registry always wins untouched; only empty/absent falls back.
function resolveAssignees(list) {
  return list && list.length ? list : DEFAULT_ASSIGNEES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml, assigneeBadge, resolveAssignees, DEFAULT_ASSIGNEES };
} else {
  window.escapeHtml = escapeHtml;
  window.assigneeBadge = assigneeBadge;
  window.resolveAssignees = resolveAssignees;
  window.DEFAULT_ASSIGNEES = DEFAULT_ASSIGNEES;
}

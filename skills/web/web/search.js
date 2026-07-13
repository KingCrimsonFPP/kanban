'use strict';
// Pure query parser + matcher for the board search box (card #17). No DOM here —
// same dual-environment pattern as refresh-policy.js/column-state.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND required
// directly by node --test.
//
// Syntax (space-separated terms AND together; each prefix binds to its own term):
//   #42 / id:42   exact card id
//   title:foo     substring on title
//   body:foo      substring on markdown body
//   status:doing  substring on status
//   priority:high substring on priority
//   tags:ui       substring on any one tag
//   file:0011     substring on the card's filename (basename)
//   bare text     substring on title OR body OR any tag — the "don't remember
//                 which field" fallback. An unrecognized `foo:bar` prefix also
//                 lands here (searched as the literal string "foo:bar") rather
//                 than silently matching nothing on a typo'd field name.
// All matching is case-insensitive except the id's exact comparison.
//
// A recognized prefix with nothing after the colon yet (e.g. "status:" mid-
// keystroke, before the value is typed) is not-yet-a-term and is dropped
// entirely — same as an empty query yields no terms (see filterCards below).
// Without this, String.prototype.includes('') would make that term match
// every card, flashing a false "everything matched" state for one keystroke.

const KNOWN_FIELDS = ['title', 'body', 'status', 'priority', 'tags', 'file'];

function parseTerm(token) {
  const idShorthand = token.match(/^#(\d+)$/);
  if (idShorthand) return { field: 'id', value: idShorthand[1] };

  const prefixed = token.match(/^([A-Za-z]+):(.*)$/);
  if (prefixed) {
    const key = prefixed[1].toLowerCase();
    if (key === 'id') {
      const value = prefixed[2].trim();
      return value ? { field: 'id', value } : null;
    }
    if (KNOWN_FIELDS.includes(key)) {
      const value = prefixed[2].trim().toLowerCase();
      return value ? { field: key, value } : null;
    }
  }

  return { field: null, value: token.toLowerCase() };
}

function parseSearchQuery(raw) {
  return String(raw || '').trim().split(/\s+/).filter(Boolean).map(parseTerm).filter(Boolean);
}

function termMatchesCard(term, card) {
  const title = (card.title || '').toLowerCase();
  const body = (card.body || '').toLowerCase();
  const tags = card.tags || [];
  switch (term.field) {
    case 'id': return String(card.id) === term.value;
    case 'title': return title.includes(term.value);
    case 'body': return body.includes(term.value);
    case 'status': return (card.status || '').toLowerCase().includes(term.value);
    case 'priority': return (card.priority || '').toLowerCase().includes(term.value);
    case 'tags': return tags.some((t) => t.toLowerCase().includes(term.value));
    case 'file': return (card.file || '').toLowerCase().includes(term.value);
    default: // bare term: title + body + tags
      return title.includes(term.value) || body.includes(term.value)
        || tags.some((t) => t.toLowerCase().includes(term.value));
  }
}

function cardMatchesQuery(card, terms) {
  return terms.every((term) => termMatchesCard(term, card));
}

// Convenience: empty terms means "no active query" — everything matches.
function filterCards(cards, terms) {
  if (!terms.length) return cards;
  return cards.filter((card) => cardMatchesQuery(card, terms));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSearchQuery, cardMatchesQuery, filterCards };
} else {
  window.parseSearchQuery = parseSearchQuery;
  window.cardMatchesQuery = cardMatchesQuery;
  window.filterCards = filterCards;
}

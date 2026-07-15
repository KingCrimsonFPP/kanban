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
//   assignee:@afk substring on the card's assignee handle. `A:`/`a:` (kanban.proj
//                 #186) is a thin alias for this same scope — resolved to
//                 'assignee' at parse time, before the KNOWN_FIELDS value/
//                 lowercasing logic runs, so it shares every rule below with
//                 the long form (case-insensitive substring, dropped when
//                 valueless mid-typing).
//   tree:74 / tree:#74   card #74's dependency tree — the connected component
//                 (undirected) reachable from card 74 over the SAME edges the
//                 map draws (waiting_for + #151 parent: membership).
//   path:74 / path:#74   card #74's dependency path — the directed cone:
//                 everything transitively upstream + downstream through card
//                 74, over the same edges. Narrower than tree: (excludes
//                 sibling branches with no directed relation to 74).
//   bare text     substring on title OR body OR any tag — the "don't remember
//                 which field" fallback. An unrecognized `foo:bar` prefix also
//                 lands here (searched as the literal string "foo:bar") rather
//                 than silently matching nothing on a typo'd field name.
// All matching is case-insensitive except the id's exact comparison; tree:/
// path: compare numerically (leading zeros/whitespace normalize the same way
// dependency-graph.js's treeIds/pathIds normalize their id argument).
//
// A recognized prefix with nothing after the colon yet (e.g. "status:" mid-
// keystroke, before the value is typed) is not-yet-a-term and is dropped
// entirely — same as an empty query yields no terms (see filterCards below).
// Without this, String.prototype.includes('') would make that term match
// every card, flashing a false "everything matched" state for one keystroke.
//
// tree:/path: resolution needs the full card graph, which a single (term,
// card) pair doesn't have — see filterCards below for where that happens.
const DG = (typeof module !== 'undefined' && module.exports) ? require('./dependency-graph') : window;

const KNOWN_FIELDS = ['title', 'body', 'status', 'priority', 'tags', 'file', 'assignee'];
// tree:/path: are deliberately NOT in KNOWN_FIELDS — that array drives the
// lowercased-substring value semantics, which don't apply to a numeric id.
const GRAPH_FIELDS = ['tree', 'path'];
// kanban.proj #186: `A:`/`a:` is a thin alias for `assignee:` — resolved here,
// before the KNOWN_FIELDS check, so the alias falls through the exact same
// value/lowercasing path as the long form rather than duplicating it.
const FIELD_ALIASES = { a: 'assignee' };

function parseTerm(token) {
  const idShorthand = token.match(/^#(\d+)$/);
  if (idShorthand) return { field: 'id', value: idShorthand[1] };

  const prefixed = token.match(/^([A-Za-z]+):(.*)$/);
  if (prefixed) {
    const key = FIELD_ALIASES[prefixed[1].toLowerCase()] || prefixed[1].toLowerCase();
    if (key === 'id') {
      const value = prefixed[2].trim();
      return value ? { field: 'id', value } : null;
    }
    if (GRAPH_FIELDS.includes(key)) {
      // card #74: id accepts an optional leading '#' (tree:74 and tree:#74
      // are the same term) — kept case-verbatim like id:, no lowercasing.
      const value = prefixed[2].trim().replace(/^#/, '');
      return value ? { field: key, value } : null;
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
    case 'assignee': return (card.assignee || '').toLowerCase().includes(term.value);
    // card #74: pre-resolved by filterCards (below) into an id Set — a raw,
    // unresolved 'tree'/'path' term has no graph to resolve against here (a
    // single (term, card) pair isn't enough), so it matches nothing rather
    // than throwing. Always goes through filterCards in practice.
    case 'tree': case 'path': return false;
    case 'ids': return term.ids.has(Number(card.id));
    default: // bare term: title + body + tags
      return title.includes(term.value) || body.includes(term.value)
        || tags.some((t) => t.toLowerCase().includes(term.value));
  }
}

function cardMatchesQuery(card, terms) {
  return terms.every((term) => termMatchesCard(term, card));
}

// card #74: tree:/path: terms need the FULL card graph to resolve (connected
// component / directed cone), not just the one card being tested — so they're
// resolved ONCE here, up front, against `cards` (the same array filterCards
// was called with), via dependency-graph.js's treeIds/pathIds — which in turn
// build their adjacency from buildDependencyGraph(cards, null).edges, the
// exact edge set (waiting_for + #151 membership) the map draws. Each 'tree'/
// 'path' term becomes an 'ids' term (an already-resolved Set) before the
// per-card cardMatchesQuery pass runs, so termMatchesCard's 'ids' case stays a
// pure, cheap Set.has() with no graph access of its own.
//
// Contract note: `cards` here doubles as "the cards to filter down" AND (only
// when a tree:/path: term is present) "the universe to build the graph from".
// Every filterCards call site MUST pass the full board (active + archived),
// never a pre-filtered subset — traversal is always over live + archived
// cards, per card #74's design. A subset would silently produce a
// wrong/smaller graph with no error.
function resolveGraphTerms(cards, terms) {
  if (!terms.some((t) => t.field === 'tree' || t.field === 'path')) return terms;
  return terms.map((term) => {
    if (term.field === 'tree') return { field: 'ids', value: term.value, ids: DG.treeIds(cards, term.value) };
    if (term.field === 'path') return { field: 'ids', value: term.value, ids: DG.pathIds(cards, term.value) };
    return term;
  });
}

// Convenience: empty terms means "no active query" — everything matches.
function filterCards(cards, terms) {
  if (!terms.length) return cards;
  const resolved = resolveGraphTerms(cards, terms);
  return cards.filter((card) => cardMatchesQuery(card, resolved));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSearchQuery, cardMatchesQuery, filterCards };
} else {
  window.parseSearchQuery = parseSearchQuery;
  window.cardMatchesQuery = cardMatchesQuery;
  window.filterCards = filterCards;
}

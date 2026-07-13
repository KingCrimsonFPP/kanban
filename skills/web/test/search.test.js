const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, cardMatchesQuery, filterCards } = require('../web/search');

// --- parseSearchQuery: syntax table from card #17 -------------------------

test('parseSearchQuery on empty/blank input yields no terms', () => {
  assert.deepStrictEqual(parseSearchQuery(''), []);
  assert.deepStrictEqual(parseSearchQuery('   '), []);
  assert.deepStrictEqual(parseSearchQuery(undefined), []);
  assert.deepStrictEqual(parseSearchQuery(null), []);
});

test('#42 shorthand parses as an exact id term', () => {
  assert.deepStrictEqual(parseSearchQuery('#42'), [{ field: 'id', value: '42' }]);
});

test('id:42 parses as an exact id term, same as #42', () => {
  assert.deepStrictEqual(parseSearchQuery('id:42'), [{ field: 'id', value: '42' }]);
});

test('title: / body: / status: / priority: / tags: / file: parse as their own scoped term', () => {
  assert.deepStrictEqual(parseSearchQuery('title:foo'), [{ field: 'title', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('body:foo'), [{ field: 'body', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('status:doing'), [{ field: 'status', value: 'doing' }]);
  assert.deepStrictEqual(parseSearchQuery('priority:high'), [{ field: 'priority', value: 'high' }]);
  assert.deepStrictEqual(parseSearchQuery('tags:ui'), [{ field: 'tags', value: 'ui' }]);
  assert.deepStrictEqual(parseSearchQuery('file:0011'), [{ field: 'file', value: '0011' }]);
});

test('bare text (no prefix) parses as a null-field term', () => {
  assert.deepStrictEqual(parseSearchQuery('foo'), [{ field: null, value: 'foo' }]);
});

test('multiple space-separated terms parse independently, each keeping its own prefix', () => {
  assert.deepStrictEqual(parseSearchQuery('status:todo tags:app'), [
    { field: 'status', value: 'todo' },
    { field: 'tags', value: 'app' },
  ]);
});

test('extra/irregular whitespace between terms is collapsed', () => {
  assert.deepStrictEqual(parseSearchQuery('  status:todo    tags:app  '), [
    { field: 'status', value: 'todo' },
    { field: 'tags', value: 'app' },
  ]);
});

test('field prefix name is case-insensitive; the value is lowercased for substring fields', () => {
  assert.deepStrictEqual(parseSearchQuery('TITLE:Foo'), [{ field: 'title', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('Status:Doing'), [{ field: 'status', value: 'doing' }]);
});

test('id: value is kept verbatim (not lowercased) — exact numeric compare needs no case folding', () => {
  assert.deepStrictEqual(parseSearchQuery('ID:42'), [{ field: 'id', value: '42' }]);
});

test('an unrecognized field prefix falls back to a bare term over the whole token', () => {
  assert.deepStrictEqual(parseSearchQuery('assignee:bob'), [{ field: null, value: 'assignee:bob' }]);
});

test('#-prefixed non-numeric token is not id shorthand — falls back to a bare term', () => {
  assert.deepStrictEqual(parseSearchQuery('#42abc'), [{ field: null, value: '#42abc' }]);
  assert.deepStrictEqual(parseSearchQuery('#abc'), [{ field: null, value: '#abc' }]);
});

test('a scoped prefix with no value yet (mid-typing, e.g. "status:") is dropped, not a matches-everything term', () => {
  assert.deepStrictEqual(parseSearchQuery('status:'), []);
  assert.deepStrictEqual(parseSearchQuery('id:'), []);
  assert.deepStrictEqual(parseSearchQuery('title:'), []);
  assert.deepStrictEqual(parseSearchQuery('body:'), []);
  assert.deepStrictEqual(parseSearchQuery('priority:'), []);
  assert.deepStrictEqual(parseSearchQuery('tags:'), []);
  assert.deepStrictEqual(parseSearchQuery('file:'), []);
});

test('a valueless scoped prefix mixed with a real term keeps only the real term', () => {
  assert.deepStrictEqual(parseSearchQuery('status:todo tags:'), [{ field: 'status', value: 'todo' }]);
});

// --- cardMatchesQuery / filterCards: matching semantics --------------------

const CARDS = [
  { id: 1, title: 'Fix login bug', body: 'Users cannot log in with SSO.', status: 'todo', priority: 'High', tags: ['bug', 'auth'], file: '0001.fix-login-bug.card.md' },
  { id: 2, title: 'Add search box', body: 'Field-scoped query syntax for the board.', status: 'doing', priority: 'Normal', tags: ['app', 'feature', 'search'], file: '0002.add-search-box.card.md' },
  { id: 42, title: 'Refactor auth module', body: 'Split token refresh into its own file.', status: 'backlog', priority: 'Normal', tags: ['auth', 'refactor'], file: '0042.refactor-auth-module.card.md' },
];

function idsFor(query) {
  return filterCards(CARDS, parseSearchQuery(query)).map((c) => c.id);
}

test('#42 matches only that card id, exactly', () => {
  assert.deepStrictEqual(idsFor('#42'), [42]);
});

test('id:42 matches only that card id, exactly', () => {
  assert.deepStrictEqual(idsFor('id:42'), [42]);
});

test('id search never partial-matches (id:4 does not match card 42)', () => {
  assert.deepStrictEqual(idsFor('id:4'), []);
});

test('title: substring-matches the title, case-insensitively', () => {
  assert.deepStrictEqual(idsFor('title:search'), [2]);
  assert.deepStrictEqual(idsFor('title:SEARCH'), [2]);
});

test('body: substring-matches the markdown body', () => {
  assert.deepStrictEqual(idsFor('body:token'), [42]);
});

test('status: is substring, not exact — "do" matches both todo and doing', () => {
  assert.deepStrictEqual(idsFor('status:do').sort(), [1, 2]);
});

test('priority: substring-matches, case-insensitively', () => {
  assert.deepStrictEqual(idsFor('priority:high'), [1]);
  assert.deepStrictEqual(idsFor('priority:HIGH'), [1]);
});

test('tags: matches if ANY one tag contains the substring', () => {
  assert.deepStrictEqual(idsFor('tags:auth').sort(), [1, 42]);
});

test('file: substring-matches the basename', () => {
  assert.deepStrictEqual(idsFor('file:0042'), [42]);
});

test('bare text hits title + body + tags, not status/priority', () => {
  assert.deepStrictEqual(idsFor('auth').sort(), [1, 42]); // tag/title/body hits
  assert.deepStrictEqual(idsFor('high'), []); // only appears in priority — bare term must NOT match it
});

test('multiple space-separated terms AND together (status:todo tags:app = todo cards tagged app)', () => {
  assert.deepStrictEqual(idsFor('status:todo tags:bug'), [1]);
  assert.deepStrictEqual(idsFor('status:todo tags:search'), []); // card1 has no "search" tag, card2 isn't todo
});

test('multiple bare terms AND together across fields', () => {
  assert.deepStrictEqual(idsFor('auth module'), [42]); // card1 has "auth" tag but no "module" anywhere
});

test('an empty query matches every card (no filtering)', () => {
  assert.deepStrictEqual(filterCards(CARDS, parseSearchQuery('')), CARDS);
});

test('cardMatchesQuery with zero terms is vacuously true (Array.every on [])', () => {
  assert.strictEqual(cardMatchesQuery(CARDS[0], []), true);
});

test('typing "status:" with no value yet does not flash a false all-match — same as an empty query', () => {
  assert.deepStrictEqual(idsFor('status:'), CARDS.map((c) => c.id));
});

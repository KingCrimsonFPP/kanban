const { test } = require('node:test');
const assert = require('node:assert');
const { parseDeepLink, DEEP_LINK_VIEWS } = require('../web/deep-link');

// ?card=<id>&view=<board|map|gantt|calendar> deep links. Pure querystring
// parse only — app.js's DOMContentLoaded handler does the DOM part (view
// switch, openDetailModal, scrollIntoView), consumed exactly once right
// after the first loadBoard() resolves.

test('the recognized view set is exactly board/map/gantt/calendar', () => {
  assert.deepStrictEqual([...DEEP_LINK_VIEWS].sort(), ['board', 'calendar', 'gantt', 'map']);
});

test('?card=<id>&view=<view> parses both fields', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194&view=board'), { id: 194, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=map'), { id: 7, view: 'map' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=gantt'), { id: 7, view: 'gantt' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=calendar'), { id: 7, view: 'calendar' });
});

test('no "card" key at all — not a deep link, even with a view present', () => {
  assert.strictEqual(parseDeepLink('?view=board'), null);
  assert.strictEqual(parseDeepLink(''), null);
  assert.strictEqual(parseDeepLink('?foo=bar'), null);
});

test('missing/unrecognized "view" resolves to view: null — id still parses', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194'), { id: 194, view: null });
  assert.deepStrictEqual(parseDeepLink('?card=194&view=kanban'), { id: 194, view: null });
  assert.deepStrictEqual(parseDeepLink('?card=194&view='), { id: 194, view: null });
});

test('a non-numeric or non-positive-integer "card" value resolves to id: null, not a dropped link', () => {
  assert.deepStrictEqual(parseDeepLink('?card=abc&view=board'), { id: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=&view=board'), { id: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=0&view=board'), { id: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=-3&view=board'), { id: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=3.5&view=board'), { id: null, view: 'board' });
});

test('leading zeros / extra params / order do not matter', () => {
  assert.deepStrictEqual(parseDeepLink('?card=007&view=board'), { id: 7, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?view=board&card=194&extra=1'), { id: 194, view: 'board' });
});

test('non-string input never throws — resolves to null', () => {
  assert.strictEqual(parseDeepLink(null), null);
  assert.strictEqual(parseDeepLink(undefined), null);
  assert.strictEqual(parseDeepLink(42), null);
});

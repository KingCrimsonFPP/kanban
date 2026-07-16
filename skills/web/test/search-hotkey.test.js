const { test } = require('node:test');
const assert = require('node:assert');
const { searchHotkeyPrefill } = require('../web/search-hotkey');

// kanban.proj #198: Ctrl+F / Cmd+F focuses the search box instead of the
// browser's own find bar, pre-filling "#" (caret right after) so digits
// immediately form the #<id> exact-match term. Pure chord + value-decision
// logic; the DOM wiring in app.js is a thin preventDefault + focus/value/
// setSelectionRange shim, same split as save-hotkey.js/#172.

const outsideModal = { modalOpen: false, currentValue: '' };

test('Ctrl+F on an empty box prefills "#" with the caret right after it', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, outsideModal),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('Cmd+F (mac) matches identically', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }, outsideModal),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('uppercase F (CapsLock) still matches', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'F', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, outsideModal),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('both Ctrl and Meta held still matches (either modifier suffices)', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false }, outsideModal),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('bare f without a modifier never matches (typing in a field)', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, outsideModal),
    null,
  );
});

test('Shift chord is excluded', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, outsideModal),
    null,
  );
});

test('Alt chord is excluded', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }, outsideModal),
    null,
  );
});

test('a different key never matches', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'g', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, outsideModal),
    null,
  );
});

test('a box with an existing query gets select-all, not clobbered with "#"', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.deepStrictEqual(
    searchHotkeyPrefill(chord, { modalOpen: false, currentValue: 'status:doing' }),
    { value: 'status:doing', selectionStart: 0, selectionEnd: 12 },
  );
});

test('an already-typed bare "#" (mid #<id> entry) still selects, never re-clobbers', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.deepStrictEqual(
    searchHotkeyPrefill(chord, { modalOpen: false, currentValue: '#4' }),
    { value: '#4', selectionStart: 0, selectionEnd: 2 },
  );
});

test('suppressed while a modal/popup is open: valid chord returns null (browser find stands)', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.strictEqual(searchHotkeyPrefill(chord, { modalOpen: true, currentValue: '' }), null);
  assert.strictEqual(searchHotkeyPrefill(chord, { modalOpen: true, currentValue: 'status:doing' }), null);
});

test('missing arguments resolve to null, never throw', () => {
  assert.strictEqual(searchHotkeyPrefill(null, outsideModal), null);
  assert.strictEqual(searchHotkeyPrefill({ key: 'f', ctrlKey: true }, null), null);
  assert.strictEqual(searchHotkeyPrefill({ ctrlKey: true }, outsideModal), null);
});

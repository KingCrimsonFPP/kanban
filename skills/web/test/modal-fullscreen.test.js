const { test } = require('node:test');
const assert = require('node:assert');
const { MODAL_TYPES, DEFAULT_FULLSCREEN, mergeFullscreenState } = require('../web/modal-fullscreen');

test('MODAL_TYPES lists the five fullscreen-capable popups (card #32 added the bulk pair, #42 the schedule popup)', () => {
  assert.deepStrictEqual(MODAL_TYPES, ['edit', 'detail', 'bulkSingle', 'bulkTags', 'bulkSchedule']);
});

test('DEFAULT_FULLSCREEN starts every modal type out of fullscreen', () => {
  assert.deepStrictEqual(DEFAULT_FULLSCREEN, { edit: false, detail: false, bulkSingle: false, bulkTags: false, bulkSchedule: false });
});

test('mergeFullscreenState returns defaults for undefined/null saved value', () => {
  assert.deepStrictEqual(mergeFullscreenState(undefined), DEFAULT_FULLSCREEN);
  assert.deepStrictEqual(mergeFullscreenState(null), DEFAULT_FULLSCREEN);
});

test('mergeFullscreenState overrides only the known boolean keys from a partial object', () => {
  const result = mergeFullscreenState({ detail: true });
  assert.deepStrictEqual(result, { edit: false, detail: true, bulkSingle: false, bulkTags: false, bulkSchedule: false });
});

test('mergeFullscreenState falls back to defaults for a non-object saved value (string/array/number)', () => {
  assert.deepStrictEqual(mergeFullscreenState('corrupt'), DEFAULT_FULLSCREEN);
  assert.deepStrictEqual(mergeFullscreenState(['edit', true]), DEFAULT_FULLSCREEN);
  assert.deepStrictEqual(mergeFullscreenState(42), DEFAULT_FULLSCREEN);
});

test('mergeFullscreenState ignores non-boolean values for a known key, keeping the default', () => {
  const result = mergeFullscreenState({ edit: 'yes', detail: 1 });
  assert.deepStrictEqual(result, DEFAULT_FULLSCREEN);
});

test('mergeFullscreenState drops unknown/stale modal-type keys (e.g. a since-removed popup)', () => {
  const result = mergeFullscreenState({ detail: true, ai: true });
  assert.deepStrictEqual(result, { edit: false, detail: true, bulkSingle: false, bulkTags: false, bulkSchedule: false });
  assert.strictEqual('ai' in result, false);
});

test('mergeFullscreenState never returns the same object identity as DEFAULT_FULLSCREEN (callers mutate their copy in place)', () => {
  const result = mergeFullscreenState(null);
  assert.notStrictEqual(result, DEFAULT_FULLSCREEN);
});

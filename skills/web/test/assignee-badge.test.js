const { test } = require('node:test');
const assert = require('node:assert');
const { assigneeBadge, escapeHtml, resolveAssignees, DEFAULT_ASSIGNEES } = require('../web/assignee-badge');

test('assigneeBadge renders an escaped span when assignee is set', () => {
  assert.strictEqual(assigneeBadge({ assignee: '@alex' }), '<span class="card-assignee">@alex</span>');
});

test('assigneeBadge escapes &, <, >, ", and \' in the assignee value', () => {
  assert.strictEqual(
    assigneeBadge({ assignee: '<b>&"\'' }),
    '<span class="card-assignee">&lt;b&gt;&amp;&quot;&#39;</span>',
  );
});

test('assigneeBadge returns empty string when assignee is null (server sends null for unset)', () => {
  assert.strictEqual(assigneeBadge({ assignee: null }), '');
});

test('assigneeBadge returns empty string when assignee is undefined', () => {
  assert.strictEqual(assigneeBadge({}), '');
});

test('assigneeBadge returns empty string when assignee is an empty string', () => {
  assert.strictEqual(assigneeBadge({ assignee: '' }), '');
});

test('escapeHtml escapes all five reserved characters', () => {
  assert.strictEqual(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

// --- card #132: registry-less boards fall back to the @human/@hitl/@afk trio ---

test('resolveAssignees falls back to the canonical role trio on an empty or absent registry (card #132)', () => {
  assert.strictEqual(resolveAssignees([]), DEFAULT_ASSIGNEES);
  assert.strictEqual(resolveAssignees(null), DEFAULT_ASSIGNEES);
  assert.strictEqual(resolveAssignees(undefined), DEFAULT_ASSIGNEES);
});

test('DEFAULT_ASSIGNEES is exactly @human/@hitl/@afk with the canonical kinds, shaped like config-store entries (card #132)', () => {
  assert.deepStrictEqual(DEFAULT_ASSIGNEES.map((a) => a.handle), ['@human', '@hitl', '@afk']);
  assert.deepStrictEqual(DEFAULT_ASSIGNEES.map((a) => a.kind), ['human', 'ai-hitl', 'ai-afk']);
  for (const a of DEFAULT_ASSIGNEES) {
    assert.deepStrictEqual(Object.keys(a).sort(), ['description', 'handle', 'kind', 'name']);
    assert.ok(a.name && a.description, `${a.handle} carries a name and description for the combobox label`);
  }
  assert.ok(!DEFAULT_ASSIGNEES.some((a) => a.handle === '@ai'), '"@ai" is retired as ambiguous');
});

test('resolveAssignees returns a configured registry untouched — registry wins, suggest-never-validate (card #132)', () => {
  const registry = [{ handle: '@alex', name: 'Alex', kind: 'human', description: '' }];
  assert.strictEqual(resolveAssignees(registry), registry);
});

// applyAssignees itself lives in app.js (DOM code, not require-able) — pin the
// wiring at source level so the fallback can't silently detach from the form.
test('app.js applyAssignees routes the registry through resolveAssignees (card #132)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.match(src, /state\.assignees = resolveAssignees\(list\)/);
});

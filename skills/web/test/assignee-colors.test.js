const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { STATUS_PALETTE, statusHash } = require('../web/status-colors');
const { assigneeColor, assigneeColorClass, findAssigneeEntry } = require('../web/assignee-colors');

// --- card #183: assignee colors mirror status-colors.js's contract ------------

test('a reserved config.yaml color wins over the hash', () => {
  const assignees = [{ handle: '@alex', color: '#ff00ff' }];
  assert.strictEqual(assigneeColor('@alex', assignees), '#ff00ff');
});

test('an unreserved handle hashes deterministically into STATUS_PALETTE — the SAME palette custom statuses use, not a forked one', () => {
  const c1 = assigneeColor('@alex', []);
  assert.strictEqual(assigneeColor('@alex', []), c1); // pure: same input, same output
  assert.ok(STATUS_PALETTE.includes(c1));
  assert.strictEqual(c1, STATUS_PALETTE[statusHash('@alex') % STATUS_PALETTE.length]);
});

test('assigneeColor is stable across repeated calls and across an absent/empty registry', () => {
  assert.strictEqual(assigneeColor('@bot', undefined), assigneeColor('@bot', []));
  assert.strictEqual(assigneeColor('@bot', null), assigneeColor('@bot', []));
});

test('an entry with an empty/absent color falls back to the hash — "reserve a color" is opt-in', () => {
  const assignees = [{ handle: '@alex', color: '' }, { handle: '@bob' }];
  assert.strictEqual(assigneeColor('@alex', assignees), assigneeColor('@alex', []));
  assert.strictEqual(assigneeColor('@bob', assignees), assigneeColor('@bob', []));
});

test('registry lookup is exact-match on the handle — same contract column-sort.js\'s assignee sort already uses (unlike statusColor\'s case-folded match)', () => {
  const assignees = [{ handle: '@Alex', color: '#111111' }];
  assert.strictEqual(assigneeColor('@alex', assignees), assigneeColor('@alex', [])); // no case-insensitive match
  assert.strictEqual(assigneeColor('@Alex', assignees), '#111111'); // exact match wins
});

test('assigneeColor tolerates a missing/null/empty handle without throwing', () => {
  assert.strictEqual(assigneeColor(null, []), null);
  assert.strictEqual(assigneeColor(undefined, []), null);
  assert.strictEqual(assigneeColor('', []), null);
  assert.strictEqual(assigneeColor('   ', []), null);
});

test('assigneeColor never throws on hostile handles (proto keys, non-string)', () => {
  for (const h of ['constructor', '__proto__', 'hasOwnProperty', 42]) {
    assert.doesNotThrow(() => assigneeColor(h, []));
  }
});

test('findAssigneeEntry returns the exact-match entry or null', () => {
  const alex = { handle: '@alex', color: '#123456' };
  assert.strictEqual(findAssigneeEntry('@alex', [alex]), alex);
  assert.strictEqual(findAssigneeEntry('@nope', [alex]), null);
  assert.strictEqual(findAssigneeEntry('@alex', null), null);
  assert.strictEqual(findAssigneeEntry('', [alex]), null);
});

// --- the CSS-class twin (card #49-style CSP compliance) -----------------------

test('assigneeColorClass reuses the exact palette-N slot statusColorClass would give the same string, for the hashed case', () => {
  const cls = assigneeColorClass('@alex', []);
  assert.match(cls, /^palette-\d$/);
  assert.strictEqual(cls, `palette-${statusHash('@alex') % STATUS_PALETTE.length}`);
});

test('assigneeColorClass returns null when a reserved color applies — no fixed class covers an arbitrary hex', () => {
  const assignees = [{ handle: '@alex', color: '#ff00ff' }];
  assert.strictEqual(assigneeColorClass('@alex', assignees), null);
});

test('assigneeColorClass returns null for a missing/empty handle', () => {
  assert.strictEqual(assigneeColorClass('', []), null);
  assert.strictEqual(assigneeColorClass(null, []), null);
});

test('assigneeColorClass is deterministic and pure, same contract as statusColorClass', () => {
  assert.strictEqual(assigneeColorClass('@bot', []), assigneeColorClass('@bot', []));
});

// --- doc pin: SKILL.md documents the Assignee dot glyph (card #183) -----------

test('SKILL.md documents the Assignee dot, citing card #183 and the reserved/hashed contract', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const bullet = skill.match(/- \*\*Assignee dot \(card #183\)\*\*[\s\S]*?(?=\n- \*\*|\n## )/);
  assert.ok(bullet, 'the Assignee dot bullet exists');
  assert.match(bullet[0], /assigneeBadge\(\)/, 'names the helper');
  assert.match(bullet[0], /status-dot--palette-N/, 'states the hashed case reuses the status-dot classes verbatim');
  assert.match(bullet[0], /data-assignee-color/, 'states the reserved-color CSSOM hook');
  assert.match(bullet[0], /paintAssigneeDots/, 'names the CSSOM-painting function');
  assert.match(bullet[0], /syncAssigneeDot/, 'names the modal live-sync function');
});

test('SKILL.md documents the OPTIONAL assignees[].color config field, citing card #183', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /\*\*`assignees\[\]\.color`\*\* \(card #183, OPTIONAL\)/);
  assert.match(skill, /color: "#58a6ff"\s+# card #183: OPTIONAL/, 'the config.yaml example shows the field');
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- card #74 fixer: tree:/path: focus is web-only but the two parity docs
// (CONTEXT.md's "Surfaces and parity" table and skills/cli/SKILL.md's
// "Parity with kanban-web" section) both carry an explicit "a feature added
// to one editor lands in the other, or gets a line in this table saying why
// not" commitment and both already list "dependency view" as full parity.
// Guard that the web-only tree:/path: gap has a line in each, pointing at
// the deferred cli/viewer parity cards, so a reader trusting either doc
// doesn't conclude cli is at parity today.

const repoRoot = path.join(__dirname, '..', '..', '..');
const contextDoc = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf8');
const cliSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'cli', 'SKILL.md'), 'utf8');

test('CONTEXT.md parity table notes tree:/path: as web-only, pointing at cards #152/#153', () => {
  assert.match(contextDoc, /tree:.*path:.*card #74/s);
  assert.ok(contextDoc.includes('#152'));
  assert.ok(contextDoc.includes('#153'));
});

test('skills/cli/SKILL.md parity section notes tree:/path: as not yet mirrored, pointing at cards #152/#153', () => {
  assert.match(cliSkill, /tree:.*path:.*card #74/s);
  assert.ok(cliSkill.includes('#152'));
  assert.ok(cliSkill.includes('#153'));
});

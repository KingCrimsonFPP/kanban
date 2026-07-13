const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- card #74/#152 fixer: tree:/path: focus started web-only; cli reached
// parity via card #152 (scoped "Dependencies tree/path for #id" Mermaid
// views). The two parity docs (CONTEXT.md's "Surfaces and parity" table and
// skills/cli/SKILL.md's "Parity with kanban-web" section) both carry an
// explicit "a feature added to one editor lands in the other, or gets a line
// in this table saying why not" commitment. Guard that both docs (a) still
// reference card #74 for the tree:/path: origin, and (b) still name card
// #153 as the remaining pending surface (the viewer), so a reader trusting
// either doc doesn't conclude the viewer is at parity today.

const repoRoot = path.join(__dirname, '..', '..', '..');
const contextDoc = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf8');
const cliSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'cli', 'SKILL.md'), 'utf8');

test('CONTEXT.md parity table notes tree:/path: (card #74) mirrored in cli (#152), viewer (#153) still pending', () => {
  assert.match(contextDoc, /tree:.*path:.*card #74/s);
  assert.ok(contextDoc.includes('#152'));
  assert.ok(contextDoc.includes('#153'));
});

test('skills/cli/SKILL.md parity section notes tree:/path: (card #74) mirrored via #152, viewer (#153) still pending', () => {
  assert.match(cliSkill, /tree:.*path:.*card #74/s);
  assert.ok(cliSkill.includes('#152'));
  assert.ok(cliSkill.includes('#153'));
});

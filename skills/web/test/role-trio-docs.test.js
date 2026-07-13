const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- card #100: assignee registry becomes the @human/@hitl/@afk role trio ----
// kanban/config.yaml's registry itself is board data (dispatcher-owned, not
// under test here) — this guards the three SKILL.md docs that teach AI
// writers the registry shape and the kind-driven grab semantics, so a future
// edit can't silently reintroduce the old single-human @alex example or drop
// the @hitl "think twice" contract.

const repoRoot = path.join(__dirname, '..', '..', '..');
const kanbanSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'kanban', 'SKILL.md'), 'utf8');
const webSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'web', 'SKILL.md'), 'utf8');
const cliSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'cli', 'SKILL.md'), 'utf8');

test('skills/kanban/SKILL.md\'s config.yaml example shows the @human/@hitl/@afk trio, not the old lone @alex', () => {
  assert.ok(kanbanSkill.includes('handle: "@human"'));
  assert.ok(kanbanSkill.includes('handle: "@hitl"'));
  assert.ok(kanbanSkill.includes('handle: "@afk"'));
  // "@alex" may still appear in prose as a legacy-handle example (suggest-
  // never-validate — old handles stay legal), just not as a registry entry.
  assert.ok(!kanbanSkill.includes('handle: "@alex"'));
});

test('skills/kanban/SKILL.md codifies kind-driven grab semantics for AI writers', () => {
  assert.ok(kanbanSkill.includes('kind: human'));
  assert.ok(kanbanSkill.includes('kind: ai-hitl'));
  assert.ok(kanbanSkill.includes('kind: ai-afk'));
  // @hitl must make the AI "think twice" — a human checkpoint before closing.
  assert.match(kanbanSkill, /think twice/);
  // @human means the AI leaves it alone.
  assert.match(kanbanSkill, /@human[\s\S]{0,200}(leaves? it alone|only a human|human (only )?grabs)/i);
});

test('skills/web/SKILL.md\'s config.yaml example shows the @human/@hitl/@afk trio, not the old lone @alex', () => {
  assert.ok(webSkill.includes('handle: "@human"'));
  assert.ok(webSkill.includes('handle: "@hitl"'));
  assert.ok(webSkill.includes('handle: "@afk"'));
  assert.ok(!webSkill.includes('@alex'));
});

test('skills/cli/SKILL.md\'s bulk-assign example no longer hardcodes the old @alex handle', () => {
  assert.ok(!cliSkill.includes('@alex'));
});

// verify finding: the "Creating a Card" worked example (the doc's only
// full card-creation template) must not assign a pre-trio handle — #100's
// own grab-semantics section a few lines below says such a handle "carries
// no special meaning", so a future session copying the template verbatim
// would produce a card that bypasses the @human/@hitl/@afk gate entirely.
test('skills/kanban/SKILL.md\'s "Creating a Card" template assigns a trio handle, not a legacy pre-trio one like @claude/@alex', () => {
  const example = kanbanSkill.match(/```markdown\r?\n---\r?\nid: 1\r?\n[\s\S]*?\r?\n---\r?\n/);
  assert.ok(example, 'the worked card-creation frontmatter example is present');
  assert.match(example[0], /assignee: "@(human|hitl|afk)"/);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- card #101: pill interaction grammar (left toggle, right solo/viceversa)
// documented ONCE, where the shared status-filter pill row is first described
// (card #56's map section) — guards against the doc drifting out of sync with
// the shared soloStatusFilter behavior (column-state.js).

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the right-click SOLO grammar once, alongside the pill row description (card #101)', () => {
  assert.match(webSkill, /right-click SOLOs it/);
  assert.match(webSkill, /viceversa/);
});

test('SKILL.md ties the solo grammar to left-click toggle staying unchanged (card #101)', () => {
  assert.match(webSkill, /left-click toggles that one pill on\/off, unchanged/);
});

test('SKILL.md documents contextmenu suppression as scoped to the pill row only, not the #39 card-el menu (card #101)', () => {
  assert.match(webSkill, /suppressed only[\s\S]{0,80}pill row/);
  assert.match(webSkill, /#39 shared right-click bulk\s*\n?\s*menu untouched/);
});

// verify finding: the #99 calendar status-filter row's own write-up was left
// out of an earlier batch — the Gantt's #98 row got a dedicated
// "Status-filter row" paragraph, but the Calendar section never mentioned
// filtering at all. Pinning its contract here the same way, in the Calendar
// section specifically, so this doesn't silently regress the way it silently
// went missing the first time.
test('SKILL.md gives the calendar\'s #99 status-filter row its own dedicated write-up, in the Calendar view section (card #99, reopened by #108)', () => {
  const calendarSection = webSkill.match(/- \*\*Calendar view\*\*[\s\S]*?\n- \*\*Gantt view\*\*/);
  assert.ok(calendarSection, 'the Calendar view bullet is present');
  assert.match(calendarSection[0], /\*\*Status-filter row \(card #99/, 'the calendar gets its own dedicated status-filter paragraph, like the map\'s #56 and gantt\'s #98');
  // card #108 reopened the original "no Archive pill" decision — the calendar
  // now gets one too, default OFF like the gantt's.
  assert.match(calendarSection[0], /Archive pseudo-pill/, 'the Archive pill is documented in prose, not just left to the code');
  assert.match(calendarSection[0], /defaults \*\*OFF\*\*/, 'the archive-off-by-default rule is stated in prose');
  assert.match(calendarSection[0], /calendar\.statusFilter/, 'the persistence key is named');
  assert.match(calendarSection[0], /\*\*intersection\*\* rule the map\/gantt use/, 'search+status composition is documented');
});

'use strict';
const fs = require('fs');
const path = require('path');
const { allocateId } = require('./config-store');
// The ONE home of both `doing`-gate predicates (epic #137): waiting (derived
// from waiting_for) and blocked (the manual sticker) — plus review (ADR
// 0009, card #181), blocked's sibling sticker that does NOT gate `doing`.
// Dual-environment — the browser loads the same file as a plain <script>, so
// store and UI can never drift on what "waiting"/"blocked"/"review" means.
const { isBlockedValue, blockedReason, isReviewValue, unresolvedWaits } = require('../web/waiting-blocked');

// values[k] = substring after the FIRST ':' (including its leading space), kept verbatim.
function parseFrontmatter(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n'); // tolerate CRLF (core.autocrlf=true)
  if (lines[0] !== '---') return { order: [], values: {}, body: raw };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { order: [], values: {}, body: raw };
  const order = [];
  const values = {};
  for (let i = 1; i < close; i++) {
    const colon = lines[i].indexOf(':');
    if (colon === -1) continue;
    const key = lines[i].slice(0, colon);
    if (key in values) continue; // first-occurrence wins; never duplicate a key in `order`
    order.push(key);
    values[key] = lines[i].slice(colon + 1); // includes leading space
  }
  const body = lines.slice(close + 1).join('\n');
  return { order, values, body };
}

function serializeCard({ order, values }, body) {
  const fm = order.map((k) => `${k}:${values[k]}`).join('\n');
  return `---\n${fm}\n---\n${body}`;
}

function splitTitleBody(body) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => /^#\s+/.test(l));
  if (i === -1) return { title: '', description: body.replace(/^\n+/, '') };
  const title = lines[i].replace(/^#\s+/, '').trim();
  const description = lines.slice(i + 1).join('\n').replace(/^\n+/, '');
  return { title, description };
}

function joinTitleBody(title, description) {
  return `\n# ${title}\n\n${description}`;
}

function parseList(raw) {
  const s = (raw || '').trim();
  if (!s || s === '[]') return [];
  return s.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
}

function formatList(arr) {
  return `[${(arr || []).join(', ')}]`;
}

// card #51: element-level no-data. The server hands the raw JSON body to
// create/update, so an API caller can send tags: [''] (or [' '], [null]) —
// a plain length gate passes those through formatList and serializes exactly
// the `tags: []` / `tags: [, ]` boilerplate the card bans. Drop blank entries
// BEFORE gating so the empty-list rule judges the real content. (The web form
// can't produce these — parseTags/parseIds filter — this closes the API path.)
function cleanList(arr) {
  return (arr || []).filter((x) => x != null && String(x).trim() !== '');
}

function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// card #86: NTFS caps a filename COMPONENT at 255 chars — a ~270-char monster
// slug made writeAtomic's `.tmp` open die with ENOENT and the save fail
// (burning an id per retry, card #77). Cap any slug bound for a filename here:
// cut at the last hyphen at/before the cap (never mid-word), strip any
// trailing hyphen; a slug with no hyphen inside the cap hard-truncates. 160
// leaves the `NNNN.` prefix (5), `.card.md` (8), `.tmp` (4), and
// uniqueFilePath's `-N` dedup suffix >70 chars of headroom under 255.
// Truncation is safe by design: the filename is cosmetic — frontmatter id is
// identity and every reader globs *.card.md. slugify() itself stays uncapped
// (general exported helper); use capSlug at EVERY slug->filename call site,
// including any future updateCard title-change rename.
const FILENAME_SLUG_MAX = 160;
function capSlug(slug, max = FILENAME_SLUG_MAX) {
  const s = String(slug);
  if (s.length <= max) return s;
  const cut = s.lastIndexOf('-', max);
  return (cut > 0 ? s.slice(0, cut) : s.slice(0, max)).replace(/-+$/, '');
}

// Project name for the app heading/tab title: the folder ABOVE the given board dir,
// whatever the board dir itself is named. resolve() first so a relative arg (the
// server's default `kanbanDir = 'kanban'`) derives from the real parent, not '.'.
// Rule is a plain parent-basename, uniformly — including when the board dir isn't
// literally named "kanban" (e.g. a nested `work/planning/kanban` yields
// "planning", not "kanban" or "work"). The card flagged that case as implementer's
// judgment with "parent/boarddir" as an acceptable alternative; plain parent-basename
// was kept for simplicity and because it already satisfies the common
// layout (my-project/kanban -> "my-project").
function projectName(dir) {
  return path.basename(path.dirname(path.resolve(dir)));
}

function stripQuotes(s) {
  const t = (s || '').trim();
  return t.replace(/^"(.*)"$/, '$1');
}

// card #59: epic is a boolean managed field but arrives as raw JSON — accept
// true / 'true' (any case, matching the reader's tolerance) and treat
// everything else (false, 'false', '', null, junk) as unset. A plain truthy
// gate would let an API string 'false' write a literal `epic: true` line.
function wantsEpic(v) {
  return v === true || String(v == null ? '' : v).trim().toLowerCase() === 'true';
}

// card #35: machine-maintained "updated" stamp — local time, no timezone suffix,
// same shape as notifications.md's "at" field (YYYY-MM-DDTHH:MM:SS).
function nowLocalISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// card #52: date-only local stamp (YYYY-MM-DD) for the auto start/end dates —
// a card landing in 'todo' starts today, one landing in 'done' ends today.
function todayLocalDate() {
  return nowLocalISO().slice(0, 10);
}

function readCardFile(file, archived = false) {
  const raw = fs.readFileSync(file, 'utf8');
  const { order, values, body } = parseFrontmatter(raw);
  const get = (k) => (values[k] === undefined ? '' : values[k].trim());
  const { title, description } = splitTitleBody(body);
  return {
    id: parseInt(get('id'), 10),
    status: get('status') || 'backlog',
    priority: get('priority') || 'Normal',
    // Hard cutover (epic #137): waiting_for replaced blocked_by — no reader
    // honors the old name. An unmigrated blocked_by line survives verbatim as
    // unmanaged frontmatter (card #141 owns the migration), it just carries
    // no edges here.
    waiting_for: parseList(get('waiting_for')).map(Number).filter((n) => !Number.isNaN(n)),
    // The raw sticker value, verbatim (quotes stripped, like assignee) — the
    // shared predicate decides blockedness at read time, so `blocked: false`
    // round-trips for display without ever gating.
    blocked: stripQuotes(get('blocked')) || null,
    // review sticker (ADR 0009): same raw-verbatim contract as blocked, but
    // it never gates `doing` entry — see the entry-gate check in updateCard/
    // createCard below, which reads only waiting_for/blocked.
    review: stripQuotes(get('review')) || null,
    tags: parseList(get('tags')),
    assignee: stripQuotes(get('assignee')) || null,
    start_date: get('start_date') || null, // card #36: range start ("from"), date or local datetime, never validated
    end_date: get('end_date') || null, // card #40: range end ("to"), same tolerant contract
    due_date: get('due_date') || null, // deadline marker; also the compat range end when end_date is absent (card #40)
    epic: get('epic').toLowerCase() === 'true', // card #59: epic/wayfinder flag — tolerant read (any-case 'true'), missing line = false, never validated
    // card #151: epic membership — the id of the epic this card belongs to.
    // Tolerant read (non-numeric -> null, no membership), never validated,
    // form-unmanaged (an existing line survives edits via the unmanaged-key
    // machinery). The map draws it as an epic->child membership edge.
    parent: (() => { const v = get('parent'); return /^\d+$/.test(v) ? parseInt(v, 10) : null; })(),
    updated: get('updated') || null, // card #35: machine-maintained, form-unmanaged
    title,
    body: description,
    file,
    archived,
    unparseable: Number.isNaN(parseInt(get('id'), 10)), // no frontmatter / no id
    _order: order,
    _values: values,
    _rawBody: body,
  };
}

function cardFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).map((f) => path.join(dir, f));
}

function listActive(dir) {
  return cardFiles(dir).map((f) => readCardFile(f, false));
}

function listArchived(dir) {
  return cardFiles(path.join(dir, 'archived')).map((f) => readCardFile(f, true));
}

function findCardFile(dir, id) {
  const want = Number(id);
  for (const f of [...cardFiles(dir), ...cardFiles(path.join(dir, 'archived'))]) {
    if (readCardFile(f).id === want) return f;
  }
  return null;
}

function nextId(dir) {
  const ids = [...listActive(dir), ...listArchived(dir)].map((c) => c.id).filter((n) => !Number.isNaN(n));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

// The `doing` entry gate refuses for two distinct reasons (epic #137), and
// the refusal must name which — so two error types, one per vocabulary word.
// WaitingError is the rename of the old BlockedError (dependency edges);
// BlockedError now belongs to the manual sticker.
class WaitingError extends Error {
  constructor(waiting) {
    super(`waiting on ${waiting.map((w) => `#${w.id} (${w.status})`).join(', ')}`);
    this.name = 'WaitingError';
    this.waiting = waiting;
  }
}

class BlockedError extends Error {
  constructor(reason) {
    super(reason ? `blocked: ${reason}` : 'blocked');
    this.name = 'BlockedError';
    this.reason = reason;
  }
}

// Unresolved deps among a waiting_for list (checks the EFFECTIVE/post-change
// ids) — the shared predicate over this board's full active+archived lookup.
function waitsFor(dir, waitingIds) {
  const byId = new Map([...listActive(dir), ...listArchived(dir)].map((c) => [c.id, c]));
  return unresolvedWaits(waitingIds, byId).map((b) => ({ id: b.id, status: b.status }));
}

function setField(order, values, key, rawValue) {
  if (!(key in values)) order.push(key);
  values[key] = ` ${rawValue}`;
}

function removeField(order, values, key) {
  const i = order.indexOf(key);
  if (i !== -1) order.splice(i, 1);
  delete values[key];
}

function updateCard(dir, id, changes) {
  const file = findCardFile(dir, id);
  if (!file) throw new Error(`no card #${id}`);
  const card = readCardFile(file, false);

  // ENTRY gate only (epic #137): a card already in `doing` is never evicted
  // and never re-gated — so blocking (or adding a dep to) a doing card via a
  // same-status form save goes through; only a real transition INTO the
  // literal `doing` is refused. Both checks use the EFFECTIVE post-change
  // values: a single PATCH may change status AND waiting_for/blocked together.
  if (changes.status === 'doing' && card.status !== 'doing') {
    const effWaiting = changes.waiting_for !== undefined ? changes.waiting_for : card.waiting_for;
    const waiting = waitsFor(dir, effWaiting);
    if (waiting.length) throw new WaitingError(waiting);
    const effBlocked = changes.blocked !== undefined ? changes.blocked : card.blocked;
    if (isBlockedValue(effBlocked)) throw new BlockedError(blockedReason(effBlocked));
  }

  const order = card._order.slice();
  const values = { ...card._values };
  if (changes.status !== undefined) setField(order, values, 'status', changes.status);
  // card #51: a blank/null priority is no data — clearing it on edit removes
  // the line (readers default a missing priority to Normal), the same
  // blank-clears rule every managed field below follows. createCard differs on
  // purpose: at birth priority is always given a value (a defaulted "Normal"
  // is data, not absence).
  if (changes.priority !== undefined) {
    if (String(changes.priority || '').trim()) setField(order, values, 'priority', changes.priority);
    else removeField(order, values, 'priority');
  }
  // card #51: an empty (or null) list is no data — clearing tags/waiting_for
  // removes the line instead of writing `tags: []`, the same blank-clears rule
  // the assignee/date fields below already follow. cleanList drops blank
  // entries first so an API-supplied [''] can't sneak past the gate as
  // `tags: []` boilerplate.
  if (changes.tags !== undefined) {
    const tags = cleanList(changes.tags);
    if (tags.length) setField(order, values, 'tags', formatList(tags));
    else removeField(order, values, 'tags');
  }
  if (changes.waiting_for !== undefined) {
    const waitingFor = cleanList(changes.waiting_for);
    if (waitingFor.length) setField(order, values, 'waiting_for', formatList(waitingFor));
    else removeField(order, values, 'waiting_for');
  }
  // Blocked sticker (epic #137): the lean rule judged by the shared
  // predicate, not mere emptiness — an invalid value (blank, `false`, `no`,
  // no-alphanumeric junk) is "clear", so the line is stripped rather than
  // ever writing `blocked: false` boilerplate. A valid value writes the
  // trimmed reason verbatim (an API boolean true writes the bare `true`,
  // reason unspecified).
  if (changes.blocked !== undefined) {
    if (isBlockedValue(changes.blocked)) setField(order, values, 'blocked', String(changes.blocked).trim());
    else removeField(order, values, 'blocked');
  }
  // Review sticker (ADR 0009, card #181): blocked's sibling — same predicate-
  // judged lean rule, but no `doing`-gate check (review overlays any status,
  // including doing, without refusing entry).
  if (changes.review !== undefined) {
    if (isReviewValue(changes.review)) setField(order, values, 'review', String(changes.review).trim());
    else removeField(order, values, 'review');
  }
  // Optional fields: non-empty sets, empty string CLEARS (removes the line —
  // bulk unassign, card #32; also makes the edit form's blank actually clear),
  // undefined leaves the card alone. A blank never injects an empty line —
  // guard on the TRIMMED value (card #51): quoteAssignee trims anyway, so a
  // whitespace-only assignee would otherwise serialize a no-data `assignee: `.
  if (changes.assignee !== undefined) {
    if (String(changes.assignee || '').trim()) setField(order, values, 'assignee', quoteAssignee(changes.assignee));
    else removeField(order, values, 'assignee');
  }
  // Date triad (card #40) processed in start, end, due order so a PATCH that
  // introduces several at once appends them in natural range-reading order.
  if (changes.start_date !== undefined) { // card #36: same clear pattern as due_date
    if (changes.start_date) setField(order, values, 'start_date', changes.start_date);
    else removeField(order, values, 'start_date');
  }
  if (changes.end_date !== undefined) { // card #40: same clear pattern
    if (changes.end_date) setField(order, values, 'end_date', changes.end_date);
    else removeField(order, values, 'end_date');
  }
  if (changes.due_date !== undefined) {
    if (changes.due_date) setField(order, values, 'due_date', changes.due_date);
    else removeField(order, values, 'due_date');
  }
  // card #59: epic — checked writes exactly `epic: true`, unchecked removes
  // the line (false is no data, card #51's lean rule — never a literal
  // `epic: false`). wantsEpic normalizes API strings on the way in.
  if (changes.epic !== undefined) {
    if (wantsEpic(changes.epic)) setField(order, values, 'epic', 'true');
    else removeField(order, values, 'epic');
  }
  // card #52: a transition INTO the literal 'todo' stamps start_date; into
  // 'done' stamps end_date (date-only local) — the working range builds itself
  // from board flow. Pinned to the literal lowercase values, same precedent as
  // the 'doing' blocked-gate; a same-status write is not a transition. Checked
  // AFTER the explicit triad changes above, so an explicit date in the same
  // PATCH wins (never clobbered) while a form-style blank — which just cleared
  // the line — still gets stamped by its own move into todo/done. Every
  // status-writing client path (form edit, drag, bulk edit, restore-then-move)
  // funnels through here.
  if (changes.status !== undefined && changes.status !== card.status) {
    if (changes.status === 'todo' && !(values.start_date || '').trim()) setField(order, values, 'start_date', todayLocalDate());
    if (changes.status === 'done' && !(values.end_date || '').trim()) setField(order, values, 'end_date', todayLocalDate());
  }
  // card #35: bump on EVERY updateCard call (single edits, status drags, bulk
  // edits all go through PATCH -> updateCard) — never conditioned on `changes`.
  setField(order, values, 'updated', nowLocalISO());

  let body = card._rawBody;
  if (changes.title !== undefined || changes.body !== undefined) {
    body = joinTitleBody(
      changes.title !== undefined ? changes.title : card.title,
      changes.body !== undefined ? changes.body : card.body,
    );
  }

  writeAtomic(file, serializeCard({ order, values }, body));
  return readCardFile(file, false);
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function uniqueFilePath(dir, slug) {
  let candidate = path.join(dir, `${slug}.card.md`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${slug}-${n}.card.md`);
    n += 1;
  }
  return candidate;
}

function quoteAssignee(v) {
  const t = String(v).trim();
  return /^[@`]/.test(t) ? `"${t}"` : t;
}

function createCard(dir, input) {
  // config.yaml's nextId counter when present (ids stay unique across deletes
  // and racing writers); scan-only max+1 behavior when the board has no config.
  const id = allocateId(dir, nextId(dir));
  // Birth directly into the literal `doing` counts as entry — both gates
  // apply (epic #137), same refusals as updateCard.
  if ((input.status || 'backlog') === 'doing') {
    const waiting = waitsFor(dir, input.waiting_for || []);
    if (waiting.length) throw new WaitingError(waiting);
    if (isBlockedValue(input.blocked)) throw new BlockedError(blockedReason(input.blocked));
  }
  // card #51: no-data fields (empty array, blank string, null) write NO
  // frontmatter line — no `tags: []`/`waiting_for: []` boilerplate. id, status,
  // and the card #35 updated stamp are always written; priority always carries
  // a value (a chosen/defaulted "Normal" is data, not absence).
  const order = ['id', 'status', 'priority'];
  const values = {
    id: ` ${id}`,
    status: ` ${input.status || 'backlog'}`,
    priority: ` ${input.priority || 'Normal'}`,
  };
  const waitingFor = cleanList(input.waiting_for); // card #51: blank entries dropped before the gate — [''] is no data
  if (waitingFor.length) { order.push('waiting_for'); values.waiting_for = ` ${formatList(waitingFor)}`; }
  // Blocked sticker: same predicate-judged lean rule as updateCard — an
  // invalid value writes no line at all.
  if (isBlockedValue(input.blocked)) { order.push('blocked'); values.blocked = ` ${String(input.blocked).trim()}`; }
  // Review sticker (ADR 0009): same lean rule; birth into `doing` is never
  // refused by it (only waiting_for/blocked gate entry, above).
  if (isReviewValue(input.review)) { order.push('review'); values.review = ` ${String(input.review).trim()}`; }
  // card #51: trimmed guard — a whitespace-only assignee is no data (quoteAssignee trims it to '')
  if (String(input.assignee || '').trim()) { order.push('assignee'); values.assignee = ` ${quoteAssignee(input.assignee)}`; }
  // card #52: a card born directly in literal 'todo'/'done' counts as a
  // transition in — stamp the flow date unless the caller supplied one.
  // Computed before the triad writes so start, end, due still land in order.
  const start = input.start_date || ((input.status || 'backlog') === 'todo' ? todayLocalDate() : '');
  const end = input.end_date || ((input.status || 'backlog') === 'done' ? todayLocalDate() : '');
  if (start) { order.push('start_date'); values.start_date = ` ${start}`; } // card #36
  if (end) { order.push('end_date'); values.end_date = ` ${end}`; } // card #40: triad writes start, end, due so ranges read naturally
  if (input.due_date) { order.push('due_date'); values.due_date = ` ${input.due_date}`; }
  const tags = cleanList(input.tags); // card #51: same blank-entry drop as waiting_for above
  if (tags.length) { order.push('tags'); values.tags = ` ${formatList(tags)}`; }
  if (wantsEpic(input.epic)) { order.push('epic'); values.epic = ' true'; } // card #59: unset writes NO line (#51 lean rule)
  order.push('updated'); values.updated = ` ${nowLocalISO()}`; // card #35: machine-maintained stamp
  const body = joinTitleBody(input.title || 'Untitled', input.body || '');
  // <0000-id>.<slug>.card.md — id zero-padded to 4 digits so files sort by
  // card id; frontmatter id stays the source of truth, this prefix is
  // cosmetic. Ids past 9999 skip the prefix entirely (mirrors
  // migrate_card_names.sh's own "id > 9999 exceeds 4-digit prefix" guard):
  // padStart alone can't widen past 4 digits without breaking lexicographic
  // sort against already-4-digit-prefixed files (e.g. "10000." would sort
  // before "9999."), and fixing that would require reflowing every existing
  // filename, which is out of scope here.
  // capSlug (card #86): keep the slug component under the NTFS 255 limit —
  // covers both branches below (prefixed and prefix-less past id 9999).
  const slug = capSlug(slugify(input.title || `card-${id}`));
  const file = id <= 9999
    ? uniqueFilePath(dir, `${String(id).padStart(4, '0')}.${slug}`)
    : uniqueFilePath(dir, slug);
  writeAtomic(file, serializeCard({ order, values }, body));
  return readCardFile(file, false);
}

// Read-only detail view for the card popup: the raw frontmatter block
// (byte-identical to what's between the `---` fences) plus title/body/absolute
// path/archived flag. `id` is always numeric here (route regex enforces \d+),
// and findCardFile only ever matches against parsed frontmatter ids within
// `dir`/`dir/archived` — it never builds a path from the id, so this can't be
// used for traversal.
function cardDetail(dir, id) {
  const file = findCardFile(dir, id);
  if (!file) throw new Error(`no card #${id}`);
  const archived = path.dirname(file) === path.join(dir, 'archived');
  const card = readCardFile(file, archived);
  const frontmatter = card._order.map((k) => `${k}:${card._values[k]}`).join('\n');
  return {
    id: card.id, title: card.title, path: path.resolve(file), frontmatter, body: card.body,
    archived: card.archived, updated: card.updated, // card #35
  };
}

// `file` is the basename only (never the full/absolute path) — card #17's
// file: search term matches against filenames the user can actually read off
// the board (`0011.foo.card.md`), not a filesystem path that would leak the
// board's on-disk location to every client of this JSON.
function toJSON(card) {
  const { id, status, priority, waiting_for, blocked, review, tags, assignee, start_date, end_date, due_date, epic, parent, updated, title, body, archived, file } = card;
  return { id, status, priority, waiting_for, blocked, review, tags, assignee, start_date, end_date, due_date, epic, parent, updated, title, body, archived, file: path.basename(file) };
}

function archiveCard(dir, id) {
  const file = findCardFile(dir, id);
  if (!file) throw new Error(`no card #${id}`);
  const archivedDir = path.join(dir, 'archived');
  // Idempotency guard: without this, re-archiving an already-archived card (a stale
  // detail popup, a second tab, a double-click) has `uniqueFilePath` collide with the
  // file's own current path and silently rename it AGAIN (e.g. `foo.card.md` ->
  // `foo-2.card.md`), duplicating the -N suffix on every repeat call with no error
  // surfaced to the caller. No-op instead: already-archived is a valid terminal state.
  if (path.dirname(file) === archivedDir) return readCardFile(file, true);
  fs.mkdirSync(archivedDir, { recursive: true });
  const base = path.basename(file).replace(/\.card\.md$/, '');
  const dest = uniqueFilePath(archivedDir, base); // never clobber a same-basename archived card
  fs.renameSync(file, dest);
  return readCardFile(dest, true);
}

function restoreCard(dir, id) {
  const file = findCardFile(dir, id);
  if (!file) throw new Error(`no card #${id}`);
  const base = path.basename(file).replace(/\.card\.md$/, '');
  const dest = uniqueFilePath(dir, base); // never clobber a same-basename active card
  fs.renameSync(file, dest);
  return readCardFile(dest, false);
}

function deleteCard(dir, id) {
  const file = findCardFile(dir, id);
  if (!file) throw new Error(`no card #${id}`);
  fs.unlinkSync(file);
}

module.exports = {
  parseFrontmatter, serializeCard, splitTitleBody, joinTitleBody,
  parseList, formatList, slugify, capSlug, projectName,
  readCardFile, listActive, listArchived, findCardFile, nextId,
  createCard, updateCard, archiveCard, restoreCard, deleteCard,
  WaitingError, BlockedError, toJSON, cardDetail,
};

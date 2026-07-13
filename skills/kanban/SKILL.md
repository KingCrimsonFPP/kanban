---
name: kanban
description: Manage a Markdown-based Kanban board using card files in a kanban/ directory (including kanban/archived/ for completed cards). Use when the user asks to create, move, view, list, or manage tasks or cards on a kanban board, or when tracking work items across statuses like backlog, todo, doing, done, or archive. Defines every board file contract (cards, config.yaml ids/assignees, notifications.md) and when the AI must notify the human.
---

# Kanban AI Skill

Manage a Kanban board as Markdown files in the `kanban/` directory. Each file is a card. The board state is derived by reading all card files and grouping by `status`.

## Narrative Record (Required)

Treat cards as durable source material for future review. Do not rewrite or delete prior narrative content unless explicitly asked. When updating a card, append a brief narrative note to a `## Narrative` section at the end of the file. Focus on reasons, discoveries, insights, and decisions. Avoid transactional status-change logs unless they matter to the story. Use ISO dates.

Narrative entry format:

```markdown
## Narrative
- 2026-02-05: Discovered the auth flow must support device-based MFA; shifted approach to use WebAuthn. (by @assistant)
```

If the card has no `## Narrative` section, add it. If a change is minor (e.g., typo), skip the narrative note unless it carries meaningful insight.

When a card is moved to `done`, add enough narrative detail that a future reader can understand the card's story and outcome. Keep it coherent and complete without being verbose.

## Card Fields

Each card's frontmatter supports the following fields:

- `id` — Unique numeric identifier. If the board has a `config.yaml` with a `nextId` counter, use `max(nextId, scan-max + 1)` and write the advanced counter back — this keeps ids unique across deletions and concurrent writers. Otherwise scan existing `*.card.md` files in `kanban/` (including `kanban/archived/`) and take max + 1, starting at `1` if empty. Reference cards by this number.
- `status` — Column. The board's official column list is `config.yaml`'s `statuses` (ordered = column order); absent, the built-in four apply: `backlog`, `todo`, `doing`, `done`. Free text is legal on disk — a value not in the list renders in the list's **first** column (the catch-all) with its raw value shown, and is **never rewritten**; promotion = the human adds the value to the list (card #31). `archive` is a location, not a status. Prefer listed values when creating cards.
- `priority` — one of the board's official `priorities` list in `config.yaml` (built-in default: `High`, `Normal`, `Low` — ordered highest first). Free text is allowed but sorts after all official values. Defaults to `Normal` if omitted.
- `waiting_for` — List of card IDs this card depends on (dependency edges). Example: `[3, 7]`. Replaces `blocked_by` (hard cutover, card #137 — no reader honors the old name). **Waiting is derived at read time, never stored:** the card is *waiting* while any listed card is not `done`; when every dep lands, the waiting state disappears on its own. A listed id with no matching card (dangling) is **non-blocking** — it never makes the card waiting. A dependency is sequencing, not an impediment; don't call it "blocked". Omit if empty — an empty `[]` stays legal on read, but it's no-data boilerplate the `kanban-web` app strips on its next managed write (card #51), so don't write it.
- `blocked` — (optional) Manual impediment sticker, human stop sign; the value is the **reason** as free text. Example: `blocked: legal sign-off pending`. The card is *blocked* iff the trimmed value contains ≥ 1 alphanumeric character; YAML boolean special-case: `false`/`no` → not blocked, `true` → blocked with reason unspecified. Lean rule (card #51): omit the field entirely when the card is clear — never write `blocked: false`. **No eviction:** blocking a card already in `doing` leaves it there; the gate below is entry-only. **Agents never grab a blocked card, in any column** — clearing the sticker is the human's call.
- `assignee` — (optional) Owner of the card. If the board's `config.yaml` has an `assignees` registry, prefer those handles (it suggests, never validates — free text is fine).
- `start_date` — (optional) The working range's **from**: a date (`YYYY-MM-DD`) or a local datetime (`YYYY-MM-DDTHH:MM`). Pairs with `end_date` as the from–to working range; alone = a 1-day range at start. The `kanban-web` app auto-stamps it with today's local date when a card lands in the literal status `todo` and the field is empty (card #52) — mirror that stamp when moving a card into `todo` by hand (see Moving a Card below); never overwrite an existing value.
- `end_date` — (optional) The working range's **to**: same date/datetime forms. Alone = a 1-day range at end. Nothing validates ordering — a reversed range (start after end) is tolerated (date-aware views treat it as a 1-day event at the range end). **Compat fallback:** when `end_date` is absent but `start_date` AND `due_date` are both present, the range is start→due, so pre-triad cards keep reading as ranges. The `kanban-web` app auto-stamps it with today's local date when a card lands in the literal status `done` and the field is empty (card #52) — mirror that stamp when moving a card into `done` by hand; never overwrite an existing value.
- `due_date` — (optional) The **deadline**: same date/datetime forms. Independent of the working range (date-aware views draw it as its own marker, even inside the range) — it only stands in as the range end via the compat fallback above. Write the triad in `start_date`, `end_date`, `due_date` order so ranges read naturally.
- `tags` — (optional) List of labels.
- `parent` — (optional) Epic membership: the card id of the epic this card belongs to (card #151). Example: `parent: 146`. A single id, tolerant read (non-numeric = no membership), never validated; a dangling id renders a ghost stub on the map, a self-id is ignored. Membership is not sequencing — it never makes the card *waiting* and the `doing` gate ignores it; use `waiting_for` for ordering. The web map draws epic→child membership edges (orange, dashed) from this field, laying the epic out above its children while the epic still lists in the no-dependencies row (membership isn't a dependency). Form-unmanaged in v1: write it by hand; every managed write preserves the line verbatim.
- `epic` — (optional) `epic: true` marks the card as an **epic/wayfinder** — a marker for a stretch of work rather than a single task (card #59). Boolean with the lean rule (card #51): write exactly `epic: true` when set and **omit the line entirely** when not — never write `epic: false`. Never validated; the `kanban-web` app reads any-case `true` as set and gives epics an orange identity layered on top of the status color in every view (the status/column itself is unchanged).
- `updated` — (optional, machine-maintained) ISO local datetime, `YYYY-MM-DDTHH:MM:SS` (no timezone suffix — same shape as `notifications.md`'s `at` field). The `kanban-web` app stamps it on card creation and bumps it on every content write (single edits, drag-driven status changes, bulk edits); it does NOT change on archive/restore (those only move the file, they don't touch its content). AI writers editing a card's frontmatter by hand should bump `updated` to the current local datetime too, so the timestamp stays meaningful regardless of which tool made the change.

## Creating a Card

Create a new card file in `kanban/` named `<0000-id>.<kebab-case-name>.card.md` — the card's `id` zero-padded to 4 digits, so filenames sort by card id (e.g. `0008.card-filename-id-prefix.card.md`). The frontmatter `id` field remains the source of truth; the filename prefix is cosmetic (visibility + sorting) and scripts never parse identity from it. **Only `*.card.md` files are treated as cards** — any other `.md` (a generated `board.md`, a `README.md`, `CLAUDE.md`, `AGENTS.md`, etc.) is ignored by the board scripts, so meta files can live alongside cards safely.

Older boards may still contain unprefixed `<kebab-case-name>.card.md` files — readers treat both identically (everything globs `*.card.md`); `scripts/migrate_card_names.sh` renames a board to the prefixed format in place.

If possible, include a Job Story using the structure "When [situation], I want to [motivation], so I can [expected outcome]." Do not force it; only add when it fits. If you add one, share it with the requester to confirm.

```markdown
---
id: 1
status: todo
priority: Normal
assignee: "@hitl"
due_date: 2026-02-28
tags: [auth, backend]
---

# Implement User Authentication

Set up user authentication using JWTs.

## Acceptance Criteria
- Users can register for a new account.
- Users can log in with their credentials.
- Authenticated users receive a JWT.
```

## Moving a Card

Update the `status` field in frontmatter.

Landing in the literal status `todo` stamps `start_date`; landing in `done` stamps `end_date` — today's local date (`YYYY-MM-DD`), only when the field is empty, never overwriting an existing value (card #52). The `kanban-web` app stamps this on every status-changing path; when moving a card by hand, stamp it the same way (same reason as the `updated` bump — the working range stays meaningful regardless of which tool made the move).

**Entry gate to the literal status `doing` (card #137):** before moving a card to `doing`, verify it is neither **waiting** (some `waiting_for` id names a card not `done`; dangling ids don't count) nor **blocked** (`blocked` holds a valid reason — trimmed value with ≥ 1 alphanumeric character, or YAML `true`). If either holds, refuse and name which: "waiting on #34" / "blocked: <reason>". No eviction — the gate applies on entry only; a card already in `doing` that gets blocked stays there. And regardless of column, agents never grab a blocked card.

Cards with `status: done` may be moved into `kanban/archived/` to keep the main board tidy. This is a file-location move only; the card should remain a normal card with `status: done` unless explicitly changed.
If `kanban/archived/` does not exist, create it under the active cards folder (`kanban/`) before moving the card.

## Board files that aren't cards

Only `*.card.md` files are cards. Two other files in `<kanban-dir>/` are levers you are expected to use:

### `config.yaml` — ids and assignees

```yaml
nextId: 29        # monotonic id counter — use max(nextId, scan-max + 1), then write the advanced counter back
assignees:        # registry of who can own cards; suggests handles, never validates
  - handle: "@human"
    name: "Human"
    kind: human   # suggested: human | ai-hitl | ai-afk (free string)
    description: "A human can grab it. Final say on trusted and destructive calls."
  - handle: "@hitl"
    name: "AI (HITL)"
    kind: ai-hitl
    description: "AI will grab it but needs a human in the loop (grilling, spec, tickets, approval) — it should make the AI think twice."
  - handle: "@afk"
    name: "AI (AFK)"
    kind: ai-afk
    description: "The AI can execute fully autonomously."
priorities: [High, Normal, Low]   # official list, ordered highest first
tags: [skills, config]            # curated tag vocabulary
statuses: [backlog, todo, doing, done]   # official COLUMN list, in board order (card #31)
```

**Grab semantics for AI writers (card #100):** the registry's `kind` isn't
cosmetic — it tells *you*, the AI, how to treat a card based on its
`assignee` handle:

- **`@human`** (`kind: human`) — a human owns this. The AI leaves it alone;
  don't grab it, don't move it, don't close it.
- **`@hitl`** (`kind: ai-hitl`) — the AI may work it, but MUST route a human
  checkpoint before closing (grilling, spec review, ticket-writing, approval
  — whatever the card calls for). The handle exists to make the AI think
  twice, not to block it outright.
- **`@afk`** (`kind: ai-afk`) — fully autonomous execution; no human
  checkpoint required to close it.

Same suggest-never-validate rule as every other registry list applies: a
card's `assignee` is free text, and only a handle whose registered `kind` is
`human` / `ai-hitl` / `ai-afk` triggers the behavior above — an unrecognized
handle (including handles predating the trio, which stay legal
on existing cards) carries no special meaning.

This `@human`/`@hitl`/`@afk` trio is the canonical default on every board
and surface (card #132; `@ai` is retired as ambiguous) — the one write-up
lives in CONTEXT.md's Role trio glossary, and when a board's `config.yaml`
has no `assignees` registry, every surface suggests exactly this trio.

Status values are **case-sensitive** — the `doing` entry gate (waiting + blocked, card #137) applies to the literal lowercase `doing` only; a column named `Doing` is just another custom column the gate ignores. Curate accordingly.

The `priorities`/`tags` lists (card #30) are **HITL-curated suggestions**: prefer official values when creating cards, free text stays legal, and only the human adds new values to the lists. Absent file = fall back to the max+1 scan and freeform values; never create `config.yaml` yourself. **Rescan ids in the same turn you create a card** — the web app or another session may be writing concurrently.

The `statuses` list (card #31) is different in kind: it drives the **column layout** of every board surface (web columns, cli board print, form options, gantt group order), in list order — but like the other lists it never validates a card's on-disk value. A card with an unlisted status renders in the list's **first column** (the catch-all — `backlog` under the default list) with its raw value shown; the file is never rewritten. **Promotion is the draft→trusted mechanic applied to columns:** only the human adds a status to the list; on the next read the card files under its real column. Archive is excluded — it stays a location-column at the far right, never a list entry. The `doing` entry gate (waiting + blocked) stays pinned to the **literal** status `doing`, custom list or not.

### `notifications.md` — messaging the human (contract v2, card #133)

Append an entry to `<kanban-dir>/notifications.md` (create if absent) and the human sees it in the web app's bell and the cli's inbox. YAML list, every field on its own single line:

```yaml
- id: 4
  at: 2026-07-12T09:15:00
  from: "afk-run:#131"
  level: info
  message: "Card #131 closed; more: payload applied, 3 cards moved to done."
  read: false
```

- `id`: max existing + 1. `at`: local ISO datetime, no timezone.
- `from`: the writer's handle (e.g. `afk-run:#131`, `skill:kanban-viewer`).
- `level`: one of `debug` | `info` | `warning` | `error`; **absent = `info`** (back-compat). Renderers show all levels — debug dimmed, warning amber-tinted, error red-tinted; no filtering for now.
- `message`: single line only; quote values containing `:` or `#`. **TLDR-first shape:** the text before `; more: ` is a single plain sentence (no "TLDR" label) — renderers emphasize (bold) it; everything after is detail. A message without `; more: ` is all-TLDR.
- `read`: always write `false` — the reader flips it (flipping to `read: true` stays an in-place edit). Entries missing a numeric `id` or non-empty `message` are skipped by readers and moved verbatim to `archived/notifications.md` on the next managed rewrite — never deleted, same rule as clearing.

**Discipline (this is a rule, not a suggestion):** every AI mutation of the board — create, move, edit, archive, delete, payload-apply — must be reconstructable from the tray. Write either **one entry per action** or **ONE grouped entry per coherent batch/turn** that enumerates what changed. This replaces the old interactive-session exemption — moves the user watched you make get an entry too (grouped is fine). The old tie-breaker keeps its spirit: **unsure → notify.** A spurious notification costs one click; a silent mutation costs a re-derivation.

**Clear = archive:** clearing/removing entries from the tray MOVES them verbatim (append) to `<kanban-dir>/archived/notifications.md`, creating the file/dir if absent. Deletion never happens. No rotation or cap yet.

Generated leftovers from retired skills (`board.md`, `dashboard.html`) may also sit in the folder — stale artifacts, not cards; ignore them.

## Human surfaces (routing)

This skill is the **AI's** lever set. When the human wants to see or work the board themselves, point them to (or launch) the right surface instead of narrating files:

- **kanban-web** — live browser editor, desktop/localhost.
- **kanban-cli** — conversational editor, works under remote control on mobile.
- **kanban-viewer** — generated single-file HTML board for phone/tablet/Cowork; read-only, queued changes come back as an "Apply kanban changes" payload.

## Viewing the Board

Helper scripts are bundled in the `scripts/` directory alongside this skill file. To locate them, find this skill's directory within the installed plugin (e.g., using `glob` for `**/kanban/scripts/view_board.sh`).

Run the board view script:

```bash
bash <SCRIPTS_DIR>/view_board.sh kanban/
```

Outputs cards grouped by status column, with priority, waiting (unresolved `waiting_for` ids only), and blocked (reason) flags inline.

## Searching and Filtering

### Search by Tag
```bash
bash <SCRIPTS_DIR>/search_by_tag.sh kanban/ <tag>
```
Output: Cards with that tag (ID, status, title)

### Search Content
```bash
bash <SCRIPTS_DIR>/search_content.sh kanban/ "<search term>"
```
Output: Cards matching the search term with context lines

### Show Blocked Cards (manual sticker)
```bash
bash <SCRIPTS_DIR>/show_blocked.sh kanban/
```
Output: Cards whose `blocked` sticker passes the predicate, reason inline.

### Show Waiting Cards (unresolved dependencies)
```bash
bash <SCRIPTS_DIR>/show_waiting.sh kanban/
```
Output: Cards that are **waiting** — some `waiting_for` id not `done` — with the unresolved ids listed; deps all `done` = not shown.

### List All Tags
```bash
bash <SCRIPTS_DIR>/list_tags.sh kanban/
```
Output: All tags sorted by usage count (most used first)

### List All Cards
```bash
bash <SCRIPTS_DIR>/list_all_cards.sh kanban/
```
Output: All cards in pipe-delimited format (id|status|waiting_for|blocked|title), sorted by ID. Useful for parsing, debugging dependencies, or exporting board state.

**Note:** `<SCRIPTS_DIR>` refers to the `scripts/` directory next to this SKILL.md file. All scripts take the kanban directory as the first argument. If omitted, they default to the current directory.

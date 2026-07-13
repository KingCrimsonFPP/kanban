# kanban

A plugin for managing a kanban board stored as Markdown files. The board has no
database: a directory of `*.card.md` files **is** the board, and the file on disk
is the single source of truth. This glossary fixes the language every skill in the
plugin must use.

## Language

**Board**:
The whole kanban — every `*.card.md` file in a `kanban/` directory, grouped by status. There is no board file; the board is derived by reading the cards.
_Avoid_: project, list.

**Card**:
One work item, stored as a single `<0000-id>.<slug>.card.md` file (frontmatter + Markdown body; the 4-digit-padded id prefix makes files sort by card id — the frontmatter `id` stays the source of truth, and unprefixed legacy names still work). The card file is the unit of identity, source of truth, and persistence.
_Avoid_: task, ticket, item, issue.

**Status** (a.k.a. **Column**):
A card's place in the workflow. The four built-ins — `backlog`, `todo`, `doing`, `done` — are the **default** live columns; a board may configure its own list via `config.yaml`'s `statuses` (ordered = column order, card #31), and that list then IS the live column set everywhere (web columns and drag targets, cli board print (view_board.sh honors the inline `[a, b]` form only; a block-form list falls back to the default four there), form options, gantt group order). "Status" is the frontmatter field; "column" is how that status renders on the board. A status value not in the list stays legal on disk — it renders in the list's **first** column with its raw value shown, and is never rewritten; promotion = the human adds it to the list. The `doing` entry gate (waiting + blocked, card #137) is pinned to the literal status `doing` regardless of the list. `archive` is **not** a status and never a list entry.
_Avoid_: stage, state, lane, swimlane.

**Archive**:
A *location*, not a status — the `kanban/archived/` folder. Archiving a card moves its file there, out of the active board, leaving its `status` untouched (almost always `done`). Restoring moves the file back. Since card #34 the web app's Archive *column* has full UI parity (drag in/out, selection) — a presentation change only; on disk archive is still the folder, never a status value.
_Avoid_: using "archive" as a status/column value; close, trash.

**Delete**:
Permanent removal of a card's file. Distinct from Archive, which is recoverable. Delete is the only destructive, non-recoverable operation.
_Avoid_: remove, archive (for the destructive sense).

**Waiting** (derived, via **waiting_for**):
A card is waiting while any card listed in its `waiting_for` is not `done`. Derived at read time, never stored; a listed id with no matching card (dangling) does not count. A waiting card cannot enter the literal status `doing` — enforced, not advisory ("waiting on #34") — and stops reading as waiting the moment its last dep lands. A dependency is sequencing, not an impediment.
_Avoid_: blocked (that's the sticker below), blocked_by (retired field name, card #137), gated.

**Blocked** (manual, via **blocked**):
A human-placed impediment sticker whose value is the reason: `blocked: <text>`. A card is blocked iff the trimmed value contains ≥ 1 alphanumeric character; YAML boolean special-case: `false`/`no` → not blocked, `true` → blocked with reason unspecified. Omit the field entirely when clear (lean rule). A blocked card cannot enter `doing` ("blocked: <reason>"), and agents never grab it in any column; blocking a card already in `doing` does not evict it.
_Avoid_: waiting, dependency, blocked_by.

**Web** (skill `kanban-web`, formerly `kanban-app`):
The human's live editor — localhost Node server + browser SPA, desktop only. "App" and "dashboard" in older docs/cards both refer to this skill (the static `kanban-dashboard` was deprecated 2026-07-08, retired 2026-07-09, and deleted 2026-07-10 — card #53; recoverable from git history).
_Avoid_: app, dashboard (in new writing).

**CLI** (skill `kanban-cli`, formerly `kanban-browse`):
The human's conversational editor — Claude-driven printed board + typed actions, works under remote control on mobile. Full CRUD as of 2026-07-09 (card #28); write contracts are defined once, in the `kanban` skill.
_Avoid_: browse, TUI.

**Viewer** (skill `kanban-viewer`, formerly `kanban-remote` — card #110):
The human's read-only tap surface — a generated single-file HTML board that works where web can't reach (phone, tablet, Cowork). Changes don't touch disk: they queue in a tray and come back as an "Apply kanban changes" payload that Claude applies under the `kanban` skill's write contracts.
_Avoid_: remote, editor (it renders and queues; Claude writes).

## Role trio (card #132)

The canonical assignee tiers on every board and surface — this is the ONE
write-up in this repo; every skill points here:

- **`@human`** (`kind: human`): human-owned; AI never grabs, moves, or closes it.
- **`@hitl`** (`kind: ai-hitl`): AI may work it, but a human checkpoint gates the close (grilling/spec/approval).
- **`@afk`** (`kind: ai-afk`): AI executes fully autonomously; completion announced via notifications.

`@ai` is retired as ambiguous. Registries suggest, never validate — free text
stays legal. When a board's `config.yaml` has NO `assignees` registry, every
surface suggests exactly this trio as its default.

## Surfaces and parity

Four skills, one board (card #28 is the restructure record; #110 added the viewer):

| Surface | For | Medium |
| --- | --- | --- |
| `kanban` | the AI | file contracts + scripts; also defines `config.yaml` and `notifications.md` and when the AI must notify |
| `kanban-web` | the human, desktop | live browser editor |
| `kanban-cli` | the human, anywhere | printed board + `AskUserQuestion` |
| `kanban-viewer` | the human, phone/tablet/Cowork | generated single-file HTML, read-only + queued-change payload |

**Parity rule:** web and cli implement the *same operations under the same rules*
(CRUD, hard `doing` entry gate (waiting + blocked), bulk actions with per-card skips, speedbumps on every
destructive action, notifications inbox, dependency view, assignee/priority/tag
suggestions from `config.yaml`'s official lists).
Deliberately unmirrored in cli (medium mismatch): the calendar, gantt, and map
views (a printed board has no continuous surfaces; ask cli for dated-card lists
instead), the date-picker popover (cli input is already free text), drag & drop, collapse state,
`localStorage` persistence, per-column persisted sort, the SVG map, the 5s poll,
search-as-you-type, the header copy-board-path button (card #55 — a browser needs
a clipboard affordance; a terminal transcript is already selectable text, and cli
prints the board path on request), popup fullscreen and its Alt+Enter hotkey
(card #145 — a printed board has no popups or keyboard chords). A feature added to one editor lands in the other (or gets a
line in this table saying why not). Retired skills are deleted outright (git
history keeps them recoverable — card #53).
Web's `tree:<id>`/`path:<id>` dependency-focus search terms (card #74) are
mirrored in cli as scoped "Dependencies tree/path for #id" Mermaid views (card
#152); the context-menu sugar has no cli equivalent (no search box to write a
term into). Not yet mirrored, pending rather than deliberate: the viewer
(card #153) — its dependency view still stops at the existing whole-board
Mermaid graph.

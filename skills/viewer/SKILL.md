---
name: kanban-viewer
description: (Claude Only) Generate a self-contained interactive HTML editor for a kanban board, and apply the change payloads it produces. The editor works where kanban-web can't reach — phone, tablet, or any remote Claude session — with tappable cards (move, priority, assignee, rename, description, archive, delete, create) and a queued-changes tray whose "Copy changes" button emits an "Apply kanban changes (...)" payload the user pastes back into chat. Use whenever the user wants to edit the board away from kanban-web, asks for a "board editor", "editable board", "editable artifact", "board I can use from my phone", or wants to change cards from a remote/Cowork session. ALSO use (read references/apply-protocol.md first) whenever a user message starts with "Apply kanban changes" — that is this editor's payload and must be applied to the card files. For a desktop browser editor use kanban-web; for pure conversational editing use kanban-cli; for AI-initiated card management use kanban.
---

# Kanban Editor

Generate a single-file HTML board editor the human can open anywhere — including
the Claude mobile app's file preview — and use to queue real board changes. This
is the third leg of the surface family: `kanban-web` (desktop editor),
`kanban-cli` (conversational editor), `kanban-viewer` (read-only tap viewer —
changes queue as a payload; Claude is the write path).

The editor is read-write but indirect: nothing touches disk until the human
pastes the payload back to Claude. Claude is the write path and enforces the
board contracts (the `doing` entry gate — waiting + blocked, card #137 — id
allocation, archive-as-location).

## Generating the editor

```bash
python3 <SCRIPTS_DIR>/build_editor.py <kanban-directory> [--out kanban-viewer.html] \
    [--base-label "Jul 11, 3:08 pm CT"] [--base-iso 2026-07-11T20:08Z]
```

- `kanban-directory` — path to the card files. In a Cowork/remote session, stage
  the board first (all root `*.card.md` + `config.yaml` + `notifications.md`)
  and point the script at the staged copy.
- `--base-label` / `--base-iso` — the snapshot moment shown in the header and
  embedded in payloads. Use the human's local timezone for the label. Defaults
  to now (UTC).

Then deliver the file to the human (in Cowork: SendUserFile with display
"render"). Record each staged file's `mtimeMs` at generation time — they are the
conflict guard when the payload comes back.

A search box under the header filters every view at once (card #143 — same
query grammar as kanban-web: terms AND together, `#id`/`id:` exact,
`title:`/`body:`/`status:`/`priority:`/`tags:`/`file:` scoped substrings,
bare terms hit title+body+tags). `review:`/`blocked:` (ADR 0009, card #181)
are their own family: UNLIKE every scope above, a bare `review:`/`blocked:`
(no value) is itself a complete term — "the sticker is present" (the shared
predicate) — never dropped as mid-typing; `review:PR`/`blocked:vendor` is a
case-insensitive substring match on the sticker's own text. Cards #74/#153 add `tree:<id>`/`path:<id>`
(`#`-tolerant, e.g. `tree:#153`): tree is the card's whole dependency
component (undirected flood-fill over `waiting_for` + `parent:` epic
membership — the same edges the Map view draws); path is the narrower
directed cone through the card (everything transitively upstream +
downstream). An unknown id matches nothing; an isolated card is a component
of one; traversal always runs over the full live + archived snapshot
regardless of the current query or status pills (the Archive pill still
gates *display* of an archived member, never whether it counts for
connectivity), and the resolved id set intersects normally with every other
term and pill, same as any other search term.

Every view carries a status-pill row (card #129): statuses default on,
**Archive defaults off** — toggling the Archive pill reveals archived cards
(embedded display-only, bodies stripped, never tappable; archive is a
location, not a status) as a muted trailing board section, a muted gantt
group, dimmed map nodes, and gray calendar chips. The "N pending" header
indicator is tappable and jumps to the tray (card #130).

A card wears a gold "review" badge (card tile head, or a "review: `<text>`"
line on the detail sheet) whenever its `review` field passes the shared
sticker predicate — blocked's sibling (ADR 0009, card #181): "finished,
approve me" rather than blocked's "stuck, act so I can proceed", and unlike
blocked it never gates `doing` entry. Both stickers are set/cleared the same
way, through the "All fields" grid (`fm-review`/`fm-blocked`, live
gold/red border feedback while the value passes the predicate) — there's no
dedicated form field for either. **Deliberate gap:** unlike kanban-web's
card #189 (clicking an assignee cue or tag appends a scoped search term),
neither badge is tap-to-filter here — this editor has no additive
query-append affordance for any badge yet (the tree:/path: buttons overwrite
the whole query box instead), so it isn't mirrored for review/blocked either.

The create form's assignee suggestions come from the board registry
(`config.yaml` `assignees`); with no registry it suggests the
`@human`/`@hitl`/`@afk` role trio (card #132 — CONTEXT.md's Role trio glossary).
Every place an assignee handle shows (board tile meta line, the archived
sheet's read-only pill, the editable sheet's assignee pill) has its TEXT
tinted in that assignee's color — card #183, parity with kanban-web's own
assignee text tint (kanban.proj #191 replaced the original small colored dot
on both surfaces with this text treatment): an `assignees[].color`
reservation in `config.yaml` wins, else the handle hashes into the same
fixed 8-color palette kanban-web's `status-colors.js` `STATUS_PALETTE` uses
(same djb2-xor hash, same hexes — `acol()`/`APALETTE`/`ahash()` in this
skill's embedded JS), so a handle colors identically on both surfaces. An
unregistered handle just hashes, same as an unlisted status.

Besides the board, the editor ships three read-only views over the same
embedded snapshot (cards #111–#113): **Map** (`waiting_for` dependency graph,
ghost stubs for off-board references), **Gantt** (working-range bars + due
diamonds per the date-triad semantics, grouped in `statuses` order, undated
cards in a chip row below), and **Calendar** (Monday-start month grid, range
chips + due markers, tap month navigation, and month/week/3-day/day sub-views
— the sub-month views are stacked tap-friendly day rows, card #117). Tapping a
card in any view opens its detail pop-up in place (card #115) with the full
action set; edits always queue through the tray. Cards #74/#153: the sheet
also carries two read-only "Dependency tree"/"Dependency path" buttons (any
card with a real id, including archived read-only sheets) — tapping one
writes `tree:<id>`/`path:<id>` into the search box and closes the sheet, no
view switch; the view underneath re-filters itself immediately (Map redraws
the pruned graph with ghost stubs where a cone edge exits the focus, Board
shows only the focused cards in their columns, same machinery every other
search term uses).

## The change loop

1. Human taps cards, queues changes; the tray shows every pending op with a
   remove button. Two-tap confirm on delete is the speedbump.
2. Human taps "Copy changes" and pastes the payload into chat:
   `Apply kanban changes (N ops, base <ISO>):` followed by a JSON op array.
3. Claude applies the ops to the card files. **Read
   `references/apply-protocol.md` before applying** — it defines op semantics,
   validation order, conflict policy, date-landing rules, id allocation, and the
   write mechanics for both local and Cowork (device-bridge) sessions.
4. Reply with a per-op result (applied / skipped + reason), append one entry to
   `notifications.md` per the v2 contract (card #133: TLDR-first `message`,
   `level`, enumerate what changed — see `/kanban`'s SKILL.md), then regenerate
   and redeliver a fresh editor with a new base stamp so the loop continues.

## Mobile viewer notes (learned the hard way)

- The Claude mobile app dismisses the HTML viewer on swipe-down, so the editor
  ships a fixed scroll-button stack — do not remove it. The stack IS the
  context menu (card #121), and the ⋯ cycles THREE modes (card #135):
  **medium** (default: ▲ ▼ ⋯) → **extended** (the full context — no pop-up:
  ＋ ⤒ ⤓, cards #118/#122/#123; card pop-up open: Archive/Delete SVG buttons
  ⤒ ⤓, no ＋; delete arms red on first tap, fires on second) → **off** (only
  ⋯, everything hidden incl. the ✕ — backdrop/Esc still close) → medium. An ✕
  rides above the ⋯ in medium/extended whenever a pop-up is open (card #116)
  and the scroll buttons drive the pop-up's scroll area instead of the board.
  The header also carries a 🔔 with an unread badge (card #134): tapping it
  opens a read-only notifications sheet rendered per contract v2 (TLDR bold,
  level tints, unread accent) from the embedded notifications.md snapshot —
  read-flips/clears stay conversational board writes. The "N pending" pill
  scrolls to the page bottom, same as ⤓ (card #136). The card pop-up leads with a
  status/assignee/priority pill row — tap a pill to edit that field, tap the
  title to rename (card #121 removed the old bottom action row) — and keeps
  the description dead last (card #120). New-card creation happens in the same
  sheet via Accept/Cancel; nothing joins the board until Accept (card #123). Board status sections are tap-collapsible and start collapsed —
  name + count only — so the board opens as a compact overview (card #119);
  queueing a create auto-expands the section the new card lands in.
- Inline chat widgets don't render on all clients; the HTML-file route is the
  reliable one. Clipboard access can fail in embedded viewers, so the payload is
  always also visible in a selectable text box under the Copy button.
- All card text is rendered via `textContent` (never string-built HTML) — card
  titles and bodies are user data; keep it XSS-safe by construction (see the
  board's own card #10 history).

## What the editor deliberately does not do

Archived cards are read-only in the tap UI — restore or edit them
conversationally or in kanban-web. Everything else on a live card is tap-
editable now, including dates/tags/`waiting_for` and unknown frontmatter keys
via the "All fields" grid (card #126, raw strings, `edit.fm` op). The payload
format still has room to grow; extend the op vocabulary in
`references/apply-protocol.md` first, then the UI.

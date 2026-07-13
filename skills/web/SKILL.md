---
name: kanban-web
description: Stand up a local web app (Node server + browser SPA) to edit a Markdown kanban board live — drag-drop cards between columns and full CRUD (create, edit, archive, delete), writing straight back to the *.card.md files. Use when the user wants an interactive, editable board in a browser (incl. VSCode's Simple Browser). Desktop/localhost only — for remote/mobile use kanban-cli; for AI-driven card management use kanban.
---

# Kanban Web (live editor)

Stand up a localhost web server whose **source of truth and persistence layer is the
`kanban/` folder itself**. It serves a vanilla-JS SPA that renders the board and writes
every drag-drop / create / edit / archive / delete straight back to the `*.card.md`
files. Desktop/localhost only (see ADR 0002); open it in any browser or VSCode's
**Simple Browser**.

## Locating the board

Default to `./kanban/` relative to the current working directory. If the user names a
board, resolve its path (a board is any directory of `*.card.md` files,
conventionally `<project>/kanban/`). The scripts live with this skill — find them with glob
`**/web/scripts/server.js` and use that `scripts/` dir.

## Launching

Start the server **in the background** (it runs until stopped):

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> [port]
```

- Default port `7777`; it auto-increments if busy and **prints the actual URL** on
  stdout (`Kanban app: http://localhost:<port> ...`). Read that line for the real port.
- It writes `<kanban-dir>/.kanban-app.pid` (line 1 = pid, line 2 = port). This dotfile
  is ignored by the board scripts (only `*.card.md` are cards).

Then open the URL. On Windows: `start http://localhost:<port>`. Tell the user they can
also paste the URL into VSCode's **Simple Browser** (Command Palette → "Simple Browser").

## Stopping

```bash
# read the pid from the first line of the pidfile and kill it
kill "$(head -1 <kanban-dir>/.kanban-app.pid)"
```

(On Windows without a POSIX `kill`, use `taskkill //PID <pid> //F`.) The server is
bound to `127.0.0.1` only.

## What the app does

- **Config-driven columns (card #31)** — the live columns come from `config.yaml`'s
  `statuses` list (ordered = column order), defaulting to `backlog → todo → doing → done`
  when the list is absent; **Archive** is always the extra location-column at the far
  right, never part of the list. Drag a card between any live columns to move it.
  A card landing in **todo** auto-stamps `start_date` (landing in **done** stamps
  `end_date`) with today's local date-only value when it doesn't already have one —
  every status-changing path stamps the same way (drag, form edit, bulk edit,
  restore-into-column, creating directly into the column), pinned to the literal
  lowercase statuses like the doing-gate, and an existing date is never overwritten
  (card #52).
  Dragging a card into **doing** while it is **waiting** (some `waiting_for` id
  names a card not `done`; dangling ids don't count) or **blocked** (a valid
  `blocked` sticker, see below) is **rejected** (the card snaps back with a toast
  naming which gate refused — "waiting on #3 (todo)" / "blocked: <reason>",
  epic #137) — the gate is pinned to the literal status `doing`, custom list or
  not, and is entry-only: **no eviction**, blocking a card already in `doing`
  leaves it there. A waiting card wears the amber left-accent plus a
  "Waiting on:" badge listing **unresolved ids only** (deps resolve against
  active + archived cards; a dangling id never shows; the badge disappears on
  its own when every dep lands); a blocked card wears a red "blocked" pill
  whose tooltip carries the reason. A card whose on-disk
  status isn't in the list renders in the **first** column (the catch-all) with a
  small dashed raw-status chip; the file is **never rewritten** — promotion = the
  human adds the status to `config.yaml`, and the next poll files the card under its
  real column. **Colors:** the built-in four each have one fixed color used everywhere
  (backlog cyan, todo blue, doing green, done purple — card #57 moved backlog off its
  historical grey, which read as archived; the neutral grey now belongs to Archive
  alone — no hashable palette slot is near-grey, and an unlisted on-disk
  `status: archive` **or `archived`** mutes to the archive grey instead of hashing);
  a custom status gets a deterministic color (its name hashed into a fixed 8-color
  palette) used by the board column header, the map node's status dot (card #91 —
  see the Dependency map section), gantt group/bar, and — since card #97 — the
  shared status-dot glyph on board tiles, calendar chips, and gantt gutter rows
  too (see Status dot below).
  Orange is reserved for epics (card #59) among the FIXED colors — no built-in
  status or archive ever wears it — but a custom status can still hash to the
  palette's orange slot (determinism, not uniqueness, is the hash contract).
  The form's status dropdown offers the list's values (an unlisted status on the card
  being edited is appended as "(unlisted)" so saving never silently rewrites it), and
  new cards default to the first column (a column header's **+** pre-selects its own
  column instead — card #54).
- **Collapsible columns** — every column header has a collapse/expand toggle. Collapsed
  = a narrow strip showing just the toggle icon and the card count; hovering it tooltips
  the full column name. Live columns default expanded, Archive defaults collapsed.
  Collapse state persists per column in `localStorage` (namespaced per board) and survives
  both a page reload and the 5s auto-refresh poll.
- **Per-column sorting** — each (expanded) column header has a sort-field dropdown
  (ID / Priority / Due date / Last modified / Assignee) and a direction toggle. "Due date" sorts
  by the card's schedule — `due_date`, else `end_date`, else `start_date` (card #43) —
  honoring time within a day (a date-only value reads as start-of-day); truly dateless
  cards always sort last, in either direction. Under a Due date sort the key driving a
  card's position is visible top-right on every tile (`⚑` marks a deadline; range dates
  show bare) — card #44. "Last modified" sorts by the machine-maintained `updated` stamp
  (card #35), newest-first by default; unstamped cards always sort last (card #45 —
  split from the ambiguous pre-#45 "Date", whose saved sort choices silently migrate to
  "Due date"). The `updated` stamp itself isn't shown on tiles (only in the card modal),
  so the #44 what-you-see-is-what-sorted promise holds for Due date only.
  "Assignee" groups cards by owner, ranked by config.yaml's assignees registry ORDER
  (not alphabetically — human, then HITL, then AFK reads better); unregistered handles
  follow all registered ones alphabetically, and unassigned cards always sort last, in
  either direction (card #46). Priority defaults High-first;
  ties on any field break by id, ascending, so order doesn't reshuffle when you flip
  direction. Each column remembers its own choice independently, defaulting to the
  original behavior (priority-desc for the four live columns, id-asc for Archive)
  until you pick something — persisted in `localStorage` alongside collapse state,
  surviving reload, the auto-refresh poll, and composing with search filtering and
  collapsed columns. Hidden while a column is collapsed (nothing to sort there).
- **Create** — "+ New card" opens a modal (title, status, priority, epic checkbox, tags,
  waiting-for ids, blocked reason, assignee, start date, end date, due date,
  description). Epic #137 split the old single dependency input in two:
  `f-waiting` ("Waiting for (ids, comma-sep)") takes the `waiting_for`
  dependency edges, and `f-blocked` ("Blocked (reason)") takes the manual
  impediment sticker's reason as free text — that input wears a red border
  exactly while its value passes the blocked predicate (trimmed value with
  ≥ 1 alphanumeric character; `false`/`no` → not blocked, `true` → blocked
  with reason unspecified), live as you type. Every live
  **expanded column header also carries a small "+"** (card #54) opening the same
  modal pre-aimed at that column — the hidden status field submits the preset even
  while the form is minimal, and "Show more fields" reveals the dropdown with it
  selected; Archive never shows the + (you can't create an archived card) and
  collapsed strips don't either. The global button keeps the first-column default.
  The modal opens **minimal-first**
  (card #50): just Title (autofocused) plus a "Show more fields" button that reveals the
  rest — one-way per open, nothing persisted, and hidden fields still submit their
  untouched defaults, so a minimal save produces the same card a full-form save would.
  Assignee joins Title in the minimal form (card #85, with its combobox suggestions
  still working) so a three-click flow — column "+", type title, pick an assignee,
  Enter — is enough to queue a card straight to a specific assignee (e.g. `@afk`)
  without ever opening "Show more fields"; the full form's assignee+dates row (#47)
  is unchanged, Assignee just also renders ahead of the reveal button while minimal.
  The date triad (card #40):
  start/end form the from-to **working range**, due is the independent **deadline**;
  each takes a date (`YYYY-MM-DD`) or local datetime (`YYYY-MM-DDTHH:MM`), never
  validated. Every date field also has a 📅 calendar-picker button (card #41) —
  manual entry stays fully legal, and picking a day preserves a typed time tail.
  Compat: a card with start + due but no end still ranges start→due.
  The server assigns the next id and writes a new
  `<0000-id>.<slug>.card.md` (id zero-padded to 4 digits, e.g. `0009.new-thing.card.md`).
- **Edit** — click a card's "Edit" to change its fields, title, and description. The body
  (incl. `## Narrative`) and any frontmatter keys the form doesn't manage are preserved
  verbatim; the form-managed fields (status, priority, epic, tags, waiting_for, blocked, assignee,
  start date, end date, due date) are re-written from the form — clearing any managed field
  (a blank priority/assignee/start/end/due, empty tags or waiting_for, a blocked
  value failing the sticker predicate — blank, `false`, `no` — an unchecked Epic) removes its
  frontmatter line entirely (card #51: no-data fields — empty string, null, empty
  array — are never written, so no `tags: []` boilerplate; id, status, and `updated`
  are always written, any real value including priority "Normal" stays, and readers
  default a missing priority to Normal), and each date field's 📅
  picker works here too (manual entry stays; time tails survive a picked day).
  `updated` is machine-managed (card #35, see below) and never shown as a form field.
- **Epic/wayfinder (card #59; glyph redesigned by card #91)** — the form's Epic
  checkbox (inside the #50 "Show more fields" section) writes the optional
  `epic: true` frontmatter field — a MANAGED boolean: unchecked (or a blank/false
  API value) removes the line entirely per the #51 lean rule, so `epic: false` is
  never written; never validated (the reader takes any-case `true`). A hand-typed
  non-`true` value (e.g. `epic: yes`) reads as **not**-epic, so the checkbox opens
  unchecked and the next form save — however unrelated — removes that line:
  deliberate (unlike the free-text priority/date inputs, a checkbox has no way to
  re-emit junk verbatim), and pinned by a card-store test. Epics wear ONE shared
  glyph — a small orange dot (`#f0883e`, `EPIC_COLOR` in status-colors.js) with an
  "Epic" tooltip — on every surface it shows: board tile, gantt bar, gantt gutter
  row (card #97), calendar chip (all four via the shared `epicBadge()` helper),
  and the map node (its own SVG circle, same color, same tooltip text). Card #91 replaced the four per-view
  orange BORDER treatments card #59 originally shipped (board tile border, map
  node stroke, gantt bar border, calendar chip border) — those fought priority,
  the amber waiting cue (pre-#137 still labeled "blocked"), due, and status
  for the same border channel; a presence-based dot
  doesn't compete with any of them, so nothing needs to win or lose anymore, and
  archive no longer needs to mute it either. The map always shows archived cards;
  the gantt and calendar can too, each opt-in via its own Archive pill (card #98's
  2026 reopen for the gantt, card #108 for the calendar). Every
  archived card on the map keeps its epic dot — whether laid out in the graph proper
  (the SVG circle) or, having no `waiting_for` edge in either direction, in the
  isolated row below the graph (`archiveCardEl`'s HTML `epicBadge()`, the same
  glyph a live board tile wears, opted in via an `epicDot` flag that only that
  one map caller sets): epic is a durable identity, not a location, unlike the
  old border-sharing arrangement that let card #57's archive-mutes rule suppress
  it. The board's own Archive column is a separate matter — it renders through
  that same `archiveCardEl` function but never sets the flag, so it still shows
  no epic cue at all, before or after #91 (that column isn't the map, and #91
  never touched it).
- **Status dot (card #97; NEVER mutes for archive, card #102 reopen)** — `statusBadge()`
  (status-colors.js) joins `epicBadge()` on every card rendering: board tiles (live
  AND archived, unlike the epic dot the Archive column gets this one too), the map's
  isolated-row tiles, calendar chips, and gantt gutter rows. A small dot colored via
  `statusColor()` off the card's RAW on-disk status — **the `archived` flag never
  touches this color** (card #102's 2026 reopen locked this: "status dots never
  mute"), tooltipped with that same raw status. The one exception is the literal
  on-disk status strings `archive`/`archived` themselves, which still mute to the
  neutral archive grey — that genuinely IS `statusColor()`'s mapping for those two
  names (card #57), keyed off the raw status string, not the `archived` flag. This
  is the HTML twin of the map SVG node's own status dot (card #91/#102). The map's
  own SVG nodes, column headers, gantt bar fills, and the calendar's priority/due
  cues are untouched — this is one more glyph, not a recoloring. See the card #102
  reopen narrative below (Dependency map section) for why the old mute was wrong.
- **Archived ball (card #102's FINAL design)** — the reopen above fixed the status
  dot's color; this closes the card's other half, "an additional ball gray for
  archived": a THIRD shared dot, `archivedBadge()` (status-colors.js) — a fixed
  `ARCHIVE_COLOR` grey circle, tooltipped "Archived" — joining `epicBadge()`/
  `statusBadge()` on every surface that renders an **archived** card, and *only*
  those: the board's Archive-column tiles, the map's isolated-row archived tiles
  (both through `archiveCardEl`, which unconditionally calls it — like `statusBadge`,
  no opts gate, since that function never renders a live card in the first place),
  the map's own SVG nodes (`buildMapSvg`'s own `<circle class="map-archived-dot">`
  twin, gated on `n.archived`), the gantt's Archive-group gutter rows (the same
  `renderGanttView` label builder every group's rows share, gated on the row's own
  `bar.card.archived`), and — since card #108 let the calendar render archived
  cards, opt-in via its own Archive pill — `calendarChipEl`, gated on the chip's
  own `card.archived`. **`cardEl` never renders it** — a live board tile is the
  one surface that structurally can't show an archived card, so there is nothing
  archived for it to ever mark there. Glyph order, applied
  identically everywhere more than one dot lands together: **epic, status,
  archived** — `.status-dot + .archived-dot { margin-left: 4px; }` gives the pair
  the same anti-fuse gap card #97 gave epic+status. On the map SVG, the node grew
  from `MAP_NODE_H` 46 to 58 (card #91's two-dot height) to fit a third dot
  vertically stacked in the same right-edge x column as status/epic (already
  proven clear of the truncated title text) with no overlap. The gantt bar itself
  and the board tile's existing dim/grey-border cues are all untouched — this is
  one more glyph on top of them, not a replacement.
- **Last modified (card #35)** — the detail popup shows a "Last modified" line: the
  card's `updated` frontmatter timestamp when present, else the file's on-disk mtime
  labeled `(file mtime)` as a fallback for cards written before the field existed.
  `updated` is stamped by the server on `createCard` and bumped on every `updateCard`
  call — single edits, drag-driven status changes, and bulk edits alike, since all of
  them go through the same PATCH endpoint — and is left untouched by archive/restore
  (those only move the file, they don't rewrite its content).
- **Archive** — moves the card's file into `kanban/archived/` (a *location*, not a
  status; status is left as-is). Archived cards live in the Archive column, right of Done;
  clicking a tile opens the same detail popup as a live card (no Edit/Archive actions,
  since those don't apply to an already-archived card), and each tile keeps **Restore**
  and **Delete** buttons.
- **Delete** — permanently removes the card file (after a confirm).

- **Multi-select** — one interaction grammar, uniform across **all four views** (card
  #39; file-manager gestures since card #144): click a card's representation to open
  its detail popup, ctrl+click (cmd on mac) to toggle it in/out of the selection,
  shift+click to ADD the whole range between the last toggled/range-started card (the
  anchor) and the target — in the active view's rendered order, additive, never
  deselecting — right-click for the bulk context menu — on board tiles
  (live and archived), map nodes and the map's isolated-row tiles, calendar chips
  (every chip of a multi-day run highlights together — selection is by card id), and
  gantt bars **and their gutter labels** alike. Each view paints its own selected
  marker (board/calendar/gantt: blue outline + dark wash; map: dark wash + blue glow —
  the node's neutral border and its status/epic dots, card #91, are unaffected).
  Right-click: an unselected card becomes the selection in
  the same gesture; an already-selected one keeps the whole batch as the target. The
  menu — **Assign…**, **Set priority…**, **Edit tags…**, **Schedule…**, **Dependency
  tree**, **Dependency path**, Archive, Restore, Delete —
  acts on the selection regardless of which view opened it. **Dependency tree**/
  **Dependency path** (card #74) are sugar over the `tree:<id>`/`path:<id>` search
  terms (see the Dependency map section below for the grammar): clicking one
  replaces the search box's content with `tree:<id>`/`path:<id>` for the single
  selected card and runs the normal search — no view switch. They're the first
  menu items ever conditionally hidden: unlike the other seven, which always
  render (mixed-selection handling lives inside each click handler instead),
  these two are hidden outright whenever the effective selection is more than
  one card. Any plain click outside
  the context menu / bulk popups clears the selection (empty calendar day cells and
  map/gantt whitespace included); the view-toggle buttons are exempt, so the
  selection **survives switching views**, as well as the auto-refresh poll.
  Exceptions: the map's dimmed ghost stubs are click-through-to-detail only, never
  selectable — they stand for cards the active search/status filters hid; a dangling-id stub (no such card) is fully inert,
  and a filtered-out card can't join a selection anywhere else either. Assign/priority
  open a single-choice popup with the usual combobox suggestions (empty assignee +
  Apply = bulk unassign); Edit tags is a workbench — add a tag to every selected card
  (deduped), or tick tags in the union-with-counts list and bulk-remove them. Schedule… edits
  the date triad in one popup (From/To/Due, each with the form's free-text input +
  📅 picker): per field, a typed/picked value sets it on every selected card,
  ticking *clear* blanks it (clear wins over a typed value), and an untouched
  field leaves each card's own value alone. Bulk
  edits take no confirm (Apply is the speedbump; edits are reversible) and the
  selection survives, so actions chain on the same batch. Dragging a selected card
  moves the whole selection **on the board only** (cards the doing gate refuses —
  waiting or blocked — are skipped per card, with one summary toast naming which
  gate); calendar/gantt drags always move the single card under the
  pointer, selected or not.

- **Speedbumps** — every destructive action confirms first, naming its object: archive,
  delete, bulk archive/delete (one confirm per batch, with the count), notification
  delete and clear-all. Restore is exempt (it's the reversible direction). Clicking the
  backdrop closes any popup; the create/edit form interposes a confirm only when it has
  unsaved changes. Card #92: archiving skips the confirm when EVERY card in the action
  is already `done` — the tile's Archive button, drag-to-Archive (single or batch), and
  the bulk menu's Archive selected all share one pure rule (`archiveNeedsConfirm`,
  selection.js); a single non-done card in the batch keeps the confirm, unchanged.
  **Esc (card #96)** closes whichever popup is open, on the very first press, regardless
  of fullscreen state — gone is #20's old "first Esc exits fullscreen, second Esc
  closes" two-step; only the fullscreen toggle button changes fullscreen now. The
  detail popup and the create/edit form (through the same #26 unsaved-changes guard
  the X button uses) both close directly on Esc, and so do the three bulk-edit popups
  (Assign/priority, Edit tags, Schedule…) — speedbump-exempt, same as their own
  backdrop-click. The #95 combobox menu gets first crack at Esc while it's open: it
  closes the MENU only, one level at a time, before this popup-level handling ever
  sees the key.
  **Alt+Enter (card #145)** toggles fullscreen on whichever fullscreen-capable popup
  is open (detail, create/edit, and the three bulk-edit popups) — the keyboard twin
  of that popup's fullscreen toggle button, updating the same persisted per-modal-type
  preference (card #20). Works with focus anywhere inside the popup, form fields
  included; an open #95 combobox menu exempts alt-chorded Enter, so the hotkey wins
  there too (plain Enter keeps the menu's pick grammar). No popup open = no-op; the
  notifications popup isn't fullscreen-capable and is unaffected.
- **Comboboxes (card #30; keyboard grammar by card #95)** — the form's Assignee
  (and Priority/Tags, incl. the bulk-edit popups' copies) fields suggest values from
  `config.yaml`'s lists (see below) while still accepting free text. Tab/click
  focuses and opens the full list; typing filters it. ArrowDown/ArrowUp move a
  wrapping highlight through the open menu (scrolled into view so it's never hidden
  past the menu's 180px-max-height fold), Enter picks the highlighted row, Esc closes
  the menu only (never bubbling into the popup-level Esc above). Enter reaches the
  surrounding form's native submit-on-Enter ONLY when the menu is closed — any other
  Enter is consumed by the menu itself (picks if something's highlighted, else just
  closes it) — so the #85 keyboard flow ("type title, ArrowDown+Enter to pick @afk,
  Enter to submit") takes two Enters, one to pick and one to submit; the original
  mouse-pick flow (click a suggestion, then Enter) still submits on one Enter, since
  the mousedown pick already closed the menu before Enter is pressed.
- **Refresh** — re-reads the folder from disk, surfacing edits made by `/kanban`, hand
  edits, or another tool.
- **Copy board path (card #55)** — a small ⧉ button inside the header title copies
  the board directory's **absolute path** (the `GET /api/board` payload carries it
  as `boardDir`, `path.resolve`d server-side — a relative path is useless pasted
  elsewhere). Same clipboard ladder as the detail popup's "Copy path" button:
  async clipboard API first, textarea+execCommand fallback on rejection or absence
  (load-bearing in VSCode's Simple Browser, which doesn't grant the async API a
  secure context) — with a toast on BOTH outcomes (the glyph-sized button has no
  room for the detail button's label swap). Web-only by design — see CONTEXT.md's
  parity table.
- **Notifications** — the header bell surfaces entries from `<kanban-dir>/notifications.md`
  (see the writer contract below): unread-count badge, a toast once per session when new
  unread entries arrive on the poll, and a popup listing all entries newest-first with
  per-entry remove and clear-all. Opening the popup marks everything read, persisted back
  to the file. Entries render per the v2 contract (card #133, `/kanban`): the TLDR
  segment (the message text before `; more: `) is emphasized (bold), and `level` tints
  the entry — `debug` dimmed, `warning` amber, `error` red, absent = `info`; all levels
  show, no filtering. Per-entry remove and clear-all ARCHIVE, never delete: entries move
  verbatim (append) to `<kanban-dir>/archived/notifications.md`, created if absent.
- **Dependency map** — a top-bar "🕸 Map view" button swaps the board for a hand-rolled
  layered SVG graph: nodes are cards (id + title), edges are `waiting_for` (arrow
  from the depended-on card to the card waiting on it, same direction as the
  `kanban-cli` skill's Mermaid dependency printout). **Membership rendering (card
  #151, v3 after two regrills):** the epic is the SINK, not the root — it
  closes only when its children close, so under the map's down-is-later
  convention it lays out BELOW its children. The epic's color flows ALONG the
  chain rather than fanning from every member: a `waiting_for` edge whose two
  endpoints share the same `parent: <epic-id>` draws SOLID EPIC_COLOR orange
  (still a real, gate-enforced dependency — only tinted), while ONLY the
  chain's terminal members (no other member of the same epic waits on them;
  a chainless member counts as its own one-card chain) draw the dashed orange
  membership hop into the epic, orange arrowhead on both kinds. Terminality
  is computed on the full board — a search filter never reroutes membership.
  Mixed edges (one endpoint outside the epic) and cross-epic edges stay plain
  grey, and every epic shares the one EPIC_COLOR (the color says "epic work
  flowing to its sink", not which epic). Membership gets the same ghost-stub
  courtesy as `waiting_for` (hidden endpoint → dimmed stub; dangling id →
  "not found" stub; self-parent ignored), but it is NOT a dependency: it
  never makes a card waiting, the `doing` gate ignores it, and the isolated
  row below stays keyed off `waiting_for` edges only — so an epic whose only
  edges are membership appears in the graph AND the no-dependencies row,
  both. A dep edge between terminal and epic in either direction suppresses
  the membership hop (sequencing wins the pair: same-direction overlap would
  hide a real dependency under the orange; opposite-direction would
  fabricate a 2-cycle bow). Card #91: the node's border is one neutral weight for every node — status
  no longer strokes it (that fought epic and archive for the same channel, card #59's
  original contract). Instead, a small dot in the node's corner carries the status
  color (same palette as the column headers and that Mermaid printout), with its own
  tooltip naming the **raw on-disk status** (SVG `<title>`, not the bucketed class);
  an epic card gets a second dot, orange, tooltipped "Epic" (see Epic/wayfinder above).
  Nodes come from both live and archived cards (blocking is location-independent).
  **Card #102 REOPEN — STATUS DOTS NEVER MUTE:** card #102 first reported "wrong
  colors for done status" on the map; the first pass called it working-as-designed
  (an archived node's dot muted to the neutral archive grey instead of its parked
  status color, "by design, not a bug" — the same rule #57 gave the border). A
  headless measurement of the real board overturned that verdict: the map graph
  rendered 18 nodes, **ALL** archived-done, **ALL** grey — on any board mature enough
  to have archived history, archived chains dominate the map forever, so muting the
  status dot emptied the one channel that exists to carry status information; the
  dot became permanently useless the moment a board grew up. The locked rule now:
  a status dot **always** shows the card's true status color, live or archived, on
  every surface (map SVG, board/isolated tiles, calendar chips, gantt gutter — see
  Status dot above). The old CSS mute rule (`.map-node.archived .map-status-dot`,
  which out-specificity'd the plain `.map-status-dot.status-<x>` rules) is deleted
  entirely — there's no specificity contest left to referee. The archived cue now
  lives ONLY in the node's border: it strokes a visibly lighter grey (`#6e7681`)
  than the plain neutral every other node wears (`#30363d`) — the one exception to
  #91's "one border weight for every node" rule, unchanged by this reopen — plus the
  "(archived)" SVG tooltip suffix and the ghost/selection treatments. Check the
  border or the tooltip to tell an archived node from a live one; the dot's color no
  longer carries that signal. Selection glow, ghost-stub dashing, and the cycle
  back-edge amber below all keep their own pre-#91 treatments too, untouched
  by #91 same as the archive border. Card #102's FINAL design closes the loop the
  reopen above started: an archived node also gets a third dot, the grey
  **Archived ball** (see that entry above) — so an archived node now carries THREE
  cues at once (true status color on the dot, grey border, grey ball), not just
  the border/tooltip pair this paragraph originally left as the only signal.
  **Card #107 — priority/waiting border, board-tile parity:** the node's border
  gains a second pair of exceptions to #91's "one neutral weight" rule (the
  archived grey mute above stays the first): a high-priority card strokes the
  node red (`#f85149`), and a **waiting** card (any `waiting_for` id naming a
  card not yet `done`; dangling ids don't count) strokes it amber (`#d29922`)
  — card #107 shipped that amber as a "blocked" stroke over the old
  single-gate dependency field; epic #137 renamed the derived state to
  waiting (a dependency is sequencing, not an impediment) and the amber slot
  now belongs to waiting alone. The exact colors the board tile
  (`.card.high`/`.card.waiting`), calendar chips, and gantt bars already use,
  reused via the same `priorityBadge()`/node's own precomputed `waiting` flag
  (`dependency-graph.js`) rather than a map-only reclassification. Waiting
  wins over high when a node is both, same declaration-order convention as
  every other surface. Mutually exclusive with the archived mute — an
  archived node never gets the priority/waiting stroke, matching how the
  board's own `archiveCardEl` never applies those classes either, so there's
  no cascade fight between the two exceptions. The manual **blocked** sticker
  (epic #137) is no border at all: a node whose `blocked` value passes the
  predicate (trimmed ≥ 1 alphanumeric character; `false`/`no` → not blocked,
  `true` → blocked with reason unspecified) wears a red pill
  (`.map-blocked-pill`, same `#f85149` as high priority) — the map twin of
  the board tile's `blocked-pill`, tooltipped "blocked: <reason>" (bare
  "blocked" when the reason is unspecified) — shown on archived nodes too: a
  stop sign is identity, not location, and unlike the stroke it doesn't
  share a channel with the archived grey mute.
  A **status-filter row** (card #56) sits above the graph: one toggle pill per board
  column (the configured statuses in column order + Archive, the location
  pseudo-column), each bordered in its column's color — all ON by default, and the
  row renders even when everything is filtered out (so a toggle can always be turned
  back on). **Pill interaction grammar (card #101), shared by every status-filter
  row in the app** (this one, the gantt's #98 row, and the calendar's #99 row):
  left-click toggles that one pill on/off, unchanged; right-click SOLOs it — that
  pill on, every other pill in the row off — and right-clicking the already-soloed
  pill again restores ALL pills on ("viceversa"). `contextmenu` is suppressed only
  while the pointer is over the pill row itself; everywhere else (map nodes,
  isolated tiles, calendar chips, gantt bars) keeps the #39 shared right-click bulk
  menu untouched. A pill OFF hides that column's cards from the map: an unlisted on-disk
  status follows the FIRST column's pill (the catch-all — exactly where the board
  files the card) and archived cards follow the Archive pill regardless of their
  parked status. The choice persists per board in `localStorage`
  (`map.statusFilter`, merged defensively like collapse/sort state) and composes
  with search by **intersection** — a card stays visible only when both agree. The
  active search query filters the map exactly as it filters the board: matching cards
  are full nodes; a card hidden by either filter that's still referenced by a visible
  one's `waiting_for`
  (in either direction) renders as a dimmed, dashed ghost stub — never silently dropped —
  and is itself clickable through to its detail popup. A `waiting_for` id with no matching
  card at all renders as a "not found" ghost. Cards with no dependencies in either
  direction always render in a detached row below the graph — never hidden behind a
  membership filter (the row's own collapse/expand control, card #97 below, compresses
  its display; it doesn't decide which cards join it). Cycles in `waiting_for` render as a visibly distinct amber curved "back edge"
  rather than hanging the layout. Composes with search, survives the 5s auto-refresh
  poll (view mode, query, and status filter all persist across a re-render, same
  discipline as collapse/
  sort state), and real nodes + isolated-row tiles carry the full shared grammar
  (card #39): click for the detail popup (#7), ctrl-click to toggle / shift-click to
  range-select (dark wash +
  blue glow), right-click for the bulk menu. Ghost stubs stay click-through only.
  **Collapsible sections (card #97)** — the layered graph and the "No dependencies"
  row are each their own collapse/expand toggle (same chevron + look as the board's
  per-column collapse, card #15), sharing one header builder
  (`buildMapSectionHeader`). State persists per board in `localStorage`
  (`map.sections.collapsed`, merged defensively like every other view preference)
  and survives the 5s poll; collapsing skips the expensive `layerNodes`/`buildMapSvg`
  work entirely rather than just hiding it via CSS.
  **Dependency tree / Dependency path (card #74)** — a second way to populate the
  map's `visibleIds`, alongside typed search and the status pills: two new search
  terms, `tree:<id>` and `path:<id>` (`#` optional — `tree:#74` and `tree:74` parse
  identically), resolved over the SAME edge set the map draws (`waiting_for` +
  #151's `parent:` membership, with its sequencing-wins-the-pair/terminal-only
  suppression already applied — see `dependency-graph.js`'s `treeIds`/`pathIds`
  for the grammar, not restated here). `tree:` is the connected component (every
  card the id's dependency web touches, undirected); `path:` is the narrower
  directed cone — everything transitively upstream and downstream through the
  id, excluding sibling branches. Traversal is ALWAYS over live + archived cards;
  an archived member's visibility on screen still follows the Archive pill, same
  as any other search hit. Composes with the rest of the query, bare text, and the
  status pills by the usual intersection rule; an unknown id matches nothing (no
  error), and a card with no edges resolves to a component/cone of one — itself.
  Focusing hides everything outside the result and re-lays-out, exactly like a
  typed search — a cone edge that exits the focused set renders as the map's
  existing ghost stub, no new rendering path. The right-click bulk menu offers
  these as sugar — **Dependency tree** / **Dependency path** — see Multi-select
  above; this is a web-only feature today (cards #152/#153 track cli/viewer parity).
- **Calendar view** — a top-bar "📅 Calendar" button swaps the board for a month grid
  (weeks start Monday; prev/next/Today controls; outside-month days dimmed, today

  highlighted). Live cards by default; dated ARCHIVED cards join too, opt-in via
  the Archive pill below (card #108). The date triad (card #40): the
  **working range** (start→end inclusive; compat: start→due when there's no end date)
  renders as a linked chip run (start/mid/end styling; rows may shift between
  differently-stacked days); a one-date range (start-only or end-only) is a single
  chip on that day; a reversed range collapses to one chip at the range end. The
  **due date** renders as its own deadline chip (amber border + ⚑ flag) on its due
  day — even when the range already covers that day. Datetime values show their
  time in the chip. Days with more than 4 chips collapse the rest into a
  tooltip-titled "+N more" line. Chips carry the shared grammar (card #39): click
  opens the detail popup, ctrl-click toggles / shift-click range-selects (all chips
  of that card highlight
  together), right-click opens the bulk menu; clicking an empty day cell clears
  the selection. Dragging a
  **range chip** moves the range: the drop day becomes the range end and the start
  shifts by the same delta (duration + times-of-day preserved), writing the fields
  the range actually used — a compat range shifts start + due and never invents an
  end date. One-date ranges move their one field (a start-only chip drop writes the start). Dragging the **due chip** moves the due date alone (time preserved) — on a compat card that also moves the rendered range's end, since due IS that range's end field.
  Same-day drops don't write. Composes with search exactly like the board, and the
  displayed month + query survive the 5s poll. Board/map/calendar/gantt is a
  four-way switch persisted per board in `localStorage` (unknown saved values fall
  back to board).
  **Status-filter row (card #99; Archive pill added by card #108 — "show/hide
  archived cards the same way we do in map view and gantt view")** — a pill row
  above the grid (month AND every #58 sub-view alike — both read the same
  `loadCalendarStatusFilter()`), sharing the map's #56 pill-row MECHANISM (one
  builder, comma-joined CSS) rather than a duplicate: one toggle per LIVE board
  status in column order, all ON by default, PLUS an Archive pseudo-pill (same
  id list as the gantt's row, `boardColumnIds()`) that defaults **OFF** — the
  base calendar view stays exactly live-only until a human opts in, same
  reasoning and same `mergeGanttStatusFilter` merge helper as the gantt's own
  #98 reopen (a value saved before #108 has no `archive` key, which merges in
  OFF, never ON). Flipping Archive ON adds every dated ARCHIVED card (search-
  filtered, ungoverned by the live status pills — same as the gantt's Archive
  group) to BOTH the month grid and the #58 time grid's all-day band/hour
  rows alike. An archived chip gets the shared **Archived ball** (see that
  entry above) right after its status dot, is not draggable (`el.draggable =
  !card.archived` — native drag never starts, so unlike the gantt's
  pointer-drag there's no fake-drag animation to guard against), and shows a
  not-allowed cursor. Its priority/waiting left-accent keeps showing
  regardless — that's a separate channel from the archived cue, same
  precedent as the gantt bar (an archived-and-high-priority card still reads
  high). Persists per board in `localStorage` under its own key
  (`calendar.statusFilter`, same defensive-merge discipline as
  `map.statusFilter`/`gantt.statusFilter`) and composes with search by the same
  **intersection** rule the map/gantt use (the search pool itself spans live +
  archived unconditionally, same as the gantt — harmless while the pill is
  off). A live-status pill OFF drops that status's chips from the grid
  outright via the gantt's `ganttFilterVisibleIds` helper (not the map's
  column-bucketing one) — the calendar doesn't bucket cards into board
  columns any more than the gantt does, so an on-disk status the board's
  `statuses` list doesn't include stays ungoverned by any pill, same as the
  gantt, rather than riding an unrelated toggle. Renders unconditionally, same
  "always leave a control to turn a pill back on" reasoning as the map/gantt
  rows, and shares the pill interaction grammar (card #101) with them.
  **Sub-views (card #58)** — the calendar header carries an Outlook/Teams-style
  Month | Week | 3 days | Day switcher (persisted per board under `calendar.subview`;
  unknown saved values fall back to Month, which stays exactly the grid above).
  Sub-month views show one column per day (week starts Monday; 3 days = anchor day +
  the next two; today's column highlighted): an **"all day" band** on top holds
  date-only cards and multi-day ranges (spans cover their real columns and pack into
  shared rows; a span cut by the window edge squares off + dashes on the cut side),
  and a scrollable **24-hour grid** below places datetime-carrying cards at their
  time — a same-day datetime start→end spans its real duration, a lone time-point
  (datetime start/end/due without a counterpart) gets a default 60-minute block, and
  overlapping blocks share the column side-by-side. prev/next/Today step by the
  active view's span; ONE anchor day drives all four sub-views, so the displayed
  window carries across switches and survives the poll. Chips keep the shared #39
  grammar. The all-day band and month grid keep the native day-granular drag
  (date moves, time-of-day preserved).
  **Time-grid drag/resize (card #109)** — the hour-grid timed blocks (week/3day
  /day) get minute-granular retiming, superseding #58's deferral. They use a
  custom pointer-drag (like the gantt's, but in MINUTES within a day — native
  HTML5 drag can't give the continuous pixel deltas), so a timed block is
  `draggable:false` and this system owns it; the all-day/month chips keep native
  drag. **Body-drag** moves the block on BOTH axes — the column under the pointer
  is the new day, the y-position (snapped to `CALENDAR_DRAG_SNAP_MIN` = 15 min)
  the new start time; a real duration keeps its length (clamped inside the day),
  a one-time point moves its timed field (its date-only sibling follows the day
  so a same-day range never splits), the due block moves `due_date` alone. **Edge
  handles** (a thin strip top and bottom, `ns-resize`) appear ONLY on a real
  same-day duration block: the top handle changes the start time, the bottom the
  end time, each clamped to a 15-min minimum span and the `[00:00, 23:59]` day
  bounds — a compat range's bottom handle edits `due_date` and never invents an
  `end_date`, same `rangeFields` contract as every other drag. All math is the
  pure `rescheduleRangeAtTime`/`rescheduleDueAtTime`/`resizeRangeAtTime`
  (calendar-model.js), null on a zero-delta so an accidental twitch never spends
  a PATCH or `updated` bump (card #35). The gesture reuses the gantt's proven
  interaction grammar: `>3px` before a drag commits (an unmoved press is a click
  → detail popup), a one-shot phantom-click suppressor, `isDragging`/`pendingDrops`
  poll guards, and the archived-read-only guard (a toast, before any pointer
  capture). Deliberately out of scope for v1: resize handles on point/due blocks
  (that would *create* a missing field, a distinct feature), dragging a timed
  block into the all-day band or vice-versa, cross-midnight/multi-day resize, and
  auto-scroll near the grid edge.
- **Gantt view** — a top-bar "📊 Gantt" button swaps the board for a day-granular
  timeline: each dated live card gets a row (dated ARCHIVED cards join too, opt-in
  via the Archive pill below, card #98's 2026 reopen) — the **working range** as a bar
  (start→end inclusive; compat start→due; one-date and reversed ranges collapse to
  a 1-day bar — same shapes as the calendar) and/or its **due date** as an amber
  diamond marker (card #40; a due-only card shows only the diamond, no bar) —
  grouped by status in board column order with a slim label row per non-empty
  group, ids ascending within it. A fixed left gutter lists #id + title per row;
  only the timeline half scrolls horizontally. Mondays are labeled with the date
  and a vertical "today" line marks the current day. The window spans the rendered
  bars AND diamonds, padded 3 days each side, clamped to at most 180 days centered
  on today (slid to stay inside the data's range) when a board sprawls wider. Bars
  use the map view's status palette plus the board's priority/waiting left-accent
  cues. Bars, diamonds, **and gutter labels** carry the
  shared grammar (card #39): click opens the detail popup (the label is the only
  click target for a bar scrolled or clipped out of view), ctrl-click toggles /
  shift-click range-selects,
  right-click opens the bulk menu — a drag is never treated as a click (>3px of
  movement commits the drag and suppresses the click). Drag the bar body to
  shift the range by whole days (duration + times-of-day preserved), writing the
  fields the range actually used — a compat range shifts start + due, never
  inventing an end date; drag an edge to move that range endpoint alone (start
  handle → start date, end handle → end date, EXCEPT compat ranges where the end
  handle edits the due date — the field the range used), clamped at a 1-day bar
  minimum (an end-only bar's start handle *creates* a start date; a start-only
  bar's end handle *creates* an end date); drag the diamond horizontally to move
  the due date alone — on a compat card that also moves the rendered range's
  end, since due IS that range's end field. Same-position drops don't write. Dragging a bar clipped by
  the window edge edits the card's true dates — the visible clip edge may not
  appear to move until the window re-derives. No dependency arrows — the map view
  owns the `waiting_for` graph.
  **Status-filter row (card #98; Archive pill added by card #98's 2026 reopen —
  "we are missing archived status")** — a pill row above the timeline, sharing
  the map's #56 pill-row MECHANISM (one builder, comma-joined CSS) rather than a
  duplicate: one toggle per LIVE board status in column order, all ON by
  default, PLUS an Archive pseudo-pill (same id list as the map's row,
  `boardColumnIds()`) that defaults **OFF**. The original #98 close narrative
  said "no Archive pill" because the gantt rendered dated *live* cards only
  (ADR 0002 keeps archive a location, not a status); this reopen adds the pill
  back opt-in instead, so the base gantt view is unchanged from before.
  Flipping Archive ON appends ONE more group AFTER the live status groups —
  every dated ARCHIVED card, regardless of its own parked on-disk status
  (`ganttArchiveGroup`, gantt-model.js) — same "location after live columns"
  placement as the board's Archive column (card #34). Archived rows split
  across two channels, deliberately different since card #102's reopen: the
  BAR's border/fill and the group label both key off the literal `'archive'`
  string, which `statusColor()` mutes to the neutral archive grey (card #57)
  — that mute stays, it's a row-level archived cue like a board tile's
  dimming, same as the bar's not-allowed drag cursor. The gutter row's own
  status dot (`statusBadge(bar.card)`, card #91/#97) does **NOT** follow that
  mute anymore — card #102's reopen locked "status dots never mute" across
  every surface, gantt gutter included, so it colors off the card's true
  on-disk status regardless of `card.archived`. The rendered window (card #40's padded
  min-start/max-due span) includes archived bars/diamonds ONLY while the pill
  is on — turning it off narrows the window back to the live data alone, same
  re-derive-from-what's-rendered rule below. Persists per board in
  `localStorage` under its own key (`gantt.statusFilter`, same defensive-merge
  discipline as `map.statusFilter` — but its own default-shape merge helper,
  `mergeGanttStatusFilter`, not the map's: a value saved before this reopen
  has no `archive` key at all, which merges in the new OFF default, never ON,
  so an old session's timeline doesn't suddenly grow archived rows on its
  own) and composes with search by the same **intersection** rule the map
  uses — search spans live + archived cards alike, though only archived ones
  that also survive the Archive pill (and any status pills) ever render. A
  live-status pill OFF drops that status's rows from the timeline outright —
  there's no dependency graph here for a hidden row to ghost into, so the
  window simply re-derives from whatever bars remain (may narrow); everything
  filtered out shows "No cards match the current search/status filters.",
  distinct from the plain "No dated cards" message. An on-disk status the
  board's `statuses` list doesn't include gets no pill of its own and is
  **never governed by one** — unlike the map/board's catch-all-first-column
  rule, `ganttGroups` gives an unlisted status its own separate labeled group
  row, so it stays visible regardless of every pill's state rather than
  silently riding an unrelated toggle. **Pill interaction grammar (card
  #101)** applies here too, Archive pill included: left-click toggles it;
  right-click SOLOs it (soloing a live status turns Archive off too, every
  other pill off; soloing Archive shows archived rows only, every live status
  off); right-clicking the already-soloed pill again restores ALL pills on,
  Archive included ("viceversa") — `soloStatusFilter` (column-state.js) is
  already fully generic over its id list, so the new pill needed no rule
  changes, only joining the id list the gantt feeds it. View mode persists
  via the shared switch; the window re-derives from the cards on each 5s poll
  while the timeline's horizontal scroll position is carried across
  re-renders.


## Board config: `config.yaml` (cards #27, #30, #31)

Optional, human-edited, per board:

```yaml
nextId: 28                # monotonic id counter; ids stay unique even when the
                          # max card is deleted or two writers race a max+1 scan
assignees:                # who can own cards; feeds the form's assignee combobox
  - handle: "@human"
    name: "Human"
    kind: human           # suggested: human | ai-hitl | ai-afk (free string)
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
tags: [skills, config, design]    # curated tag vocabulary
statuses: [backlog, todo, doing, done]   # official COLUMN list, in board order (card #31)
```

The role trio's grab semantics for AI writers (`@human` = leave it alone,
`@hitl` = work it but route a human checkpoint before closing, `@afk` =
fully autonomous) are codified in `/kanban`'s `SKILL.md`, not duplicated
here (card #100) — this app is config-driven and doesn't enforce them.

- **`priorities`** (ordered, highest first) drives everything positional:
  sort rank (unknown values sort after all known ones, ties by id), the form's
  priority combobox, and badge emphasis (first = hot red, last of a 3+ list =
  muted, middle/unknown = neutral). Absent = built-in `[High, Normal, Low]`.
- **`tags`** feeds the form's tag suggestions. Both lists are HITL-curated —
  the human edits them; the app only reads.
- **`statuses`** (card #31, inline or block form) IS the live column set, in
  order — board columns, drag targets, per-column sort/collapse defaults
  (priority-desc / expanded for live columns, id-asc / collapsed for Archive),
  the form's status dropdown, and the gantt's group order all follow it.
  Absent = the built-in four. Unlike the other lists it shapes layout, but it
  still never validates a card: an unlisted on-disk status parks the card in
  the **first** column with a raw-status chip until the human promotes it by
  adding it to the list (the file is never rewritten). Archive is not a list
  entry, and the `doing` entry gate (waiting + blocked, epic #137) is pinned
  regardless of the list.

- **Absent file = old behavior**: ids from a max+1 scan; with no `assignees`
  registry the assignee combobox falls back to suggesting the
  `@human`/`@hitl`/`@afk` role trio (card #132 — the canonical write-up is
  CONTEXT.md's Role trio glossary; `@ai` is retired). The app never creates
  `config.yaml` on its own.
- With a counter, new-card ids come from `max(nextId, scanMax+1)` (a stale counter
  self-heals rather than re-issuing a taken id) and the advanced counter is written
  back atomically. Agents creating cards by hand should use and advance it too.
- All three lists **suggest, never validate** — the form's comboboxes offer
  the registered values but free text still saves fine. (Hand-rolled menus,
  not `<datalist>`: native datalists misrender inside VSCode's Simple Browser.)
- Like `board.md`/`notifications.md`, not a card.

## Notifications writer contract (for agents)

Any agent or script can message the human by **appending** an entry to
`<kanban-dir>/notifications.md` (create the file if absent). The app picks it up on its
next 5-second poll. Format — a YAML list, one entry per notification, every field on its
own single line:

```yaml
- id: 4
  at: 2026-07-12T09:15:00
  from: "afk-run:#131"
  level: info
  message: "Card #131 closed; more: payload applied, 3 cards moved to done."
  read: false
```

- `id`: positive integer, unique within the file — max existing + 1 (same rule as card ids).
- `at`: ISO timestamp; `from`: who's writing; `message`: **single line only** (no
  multi-line support); quote values containing `:` or `#`. The text before `; more: `
  is the TLDR sentence the popup bolds; no separator = all-TLDR.
- `level`: optional, one of `debug` | `info` | `warning` | `error` (absent = `info`).
- `read`: write `false`; the app flips it when the human opens the notifications popup.
- Entries missing a numeric `id` or a non-empty `message` are skipped by the reader
  (never fatal); the next time the app rewrites the file (mark-read / remove /
  clear-all) their raw blocks are **moved verbatim to `archived/notifications.md`**,
  not deleted — the card #133 rule (deletion never happens) covers malformed
  writes too.
- The full v2 contract — when to write (per-action-or-grouped discipline), message
  shape, clear = archive — lives in `/kanban`'s SKILL.md (card #133); this is the
  same file shape, not a second contract.
- Like `board.md`, this file is not a card (only `*.card.md` files are cards).

## Boundaries

- This is the **only** skill that runs a server / is desktop-only. The plugin has exactly
  three surfaces: **kanban** (AI-driven card management), **kanban-web** (this — the
  human's live editor, desktop), **kanban-cli** (the human's conversational editor,
  works under remote control). The old `board`/`dashboard`/`dependencies` skills are
  retired and deleted (card #53; git history keeps them recoverable). "App" and
  "dashboard" in older docs both mean this skill.
- `archive` here is a *location* (the `archived/` folder), not a status — ADR 0002's
  data model is unchanged, but since card #34 the column has full UI parity: drag a
  batch onto Archive to archive it (one confirm, skipped when the whole batch is
  already `done` — card #92), drag archived cards onto a live
  column to restore them **with that column's status** (confirms when the batch
  contains archived cards; the `doing` entry gate — waiting + blocked — applies per card), and archived
  tiles join ctrl/shift-click and right-click selection. Mixed live+archived selections are
  fine — every action skips what doesn't apply, with one summary toast. The tile's
  Restore button keeps the old semantics (status untouched, no confirm), as does the
  menu's Restore selected.

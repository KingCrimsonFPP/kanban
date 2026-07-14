# kanban

Markdown kanban boards for [Claude Code](https://claude.com/claude-code).

A directory of `*.card.md` files **is** the board — no database, no daemon,
just plain git-friendly Markdown. Four surfaces sit on top of it, so you (or
the AI) can work the same board from a browser, a terminal, a phone, or a
Claude Code session.

## Why

Your task list already lives next to your code, versioned in the same repo,
diffable in the same PRs. Claude can create and move cards as part of its own
work; you can drag them around in a browser, chat through them at a terminal,
or tap through them on a phone. One set of files, no export/import step,
nothing to host.

## What it looks like

A board is just a folder of cards — edit it from a browser, a terminal, or your
phone. A guide for each editing surface:

- **[Web editor (desktop)](docs/web.md)** — the live browser app: board,
  dependency map, gantt, calendar, and full drag-drop CRUD.
- **[CLI (conversational)](docs/cli.md)** — work the board by chatting with
  Claude; the same operations, at a terminal or under remote control.
- **[Mobile viewer](docs/viewer.md)** — a tap-through board for your phone that
  queues its edits back to Claude to apply.

## Install

Two paths, depending on your harness.

### Plugin (Claude Code)

```
/plugin marketplace add KingCrimsonFPP/kanban
/plugin install kanban@kanban
```

Installs all four skills at once, plus the `.claude-plugin/` marketplace
wiring. Claude Code only.

### Individual skills (any harness)

Each skill under `skills/` is a self-contained `SKILL.md` — no cross-skill
file references — following the Agent Skills format, which cross-harness
installers such as `npx skills` can install one at a time into other coding
agents (e.g. GitHub Copilot).

> **Not live-verified.** The commands below are our best-effort reading of
> how `npx skills` addresses a skill inside a GitHub repo (owner/repo plus
> the in-repo subpath); we have not run them end-to-end against this repo.
> Treat the exact subcommand/flags as provisional — confirm the real syntax
> with `npx skills --help` (or its docs) before relying on this, and expect
> to adjust the path shown here if it resolves skills differently (by
> frontmatter `name` rather than folder path, a top-level index, etc.).

| Skill | Frontmatter `name` | Repo path | Install (unverified) |
| --- | --- | --- | --- |
| AI card management | `kanban` | `skills/kanban/` | `npx skills add KingCrimsonFPP/kanban/skills/kanban` |
| Web editor | `kanban-web` | `skills/web/` | `npx skills add KingCrimsonFPP/kanban/skills/web` |
| CLI editor | `kanban-cli` | `skills/cli/` | `npx skills add KingCrimsonFPP/kanban/skills/cli` |
| Mobile viewer | `kanban-viewer` | `skills/viewer/` | `npx skills add KingCrimsonFPP/kanban/skills/viewer` |

Note the on-disk folder name (`skills/web`) doesn't match the skill's
frontmatter `name` (`kanban-web`). That's harmless for Claude Code — it reads
`name:` out of `SKILL.md`, not the folder — but if `npx skills` turns out to
key off folder name instead of frontmatter, these folders may need a
follow-up rename to `skills/kanban-web` etc. This wasn't changed speculatively
pending that live check.

#### Cross-harness caveats — what doesn't port cleanly

Not every skill degrades gracefully outside Claude Code:

- **`kanban`** — portable. Plain file-contract instructions (card
  frontmatter, `config.yaml`, `notifications.md`); no Claude-specific tool
  calls.
- **`kanban-web`** — portable. A Node-stdlib-only local server + vanilla-JS
  SPA (`node skills/web/scripts/server.js <board-dir>`); works from any
  harness that can run a shell command and open a browser.
- **`kanban-cli`** — **Claude Code-only as written.** It's built entirely on
  `AskUserQuestion`, a Claude Code built-in tool with no stand-in named here
  for other harnesses. Porting it means replacing every `AskUserQuestion`
  call with that harness's own prompt/confirmation mechanism (or plain
  free-text Q&A) — not done in this repo.
- **`kanban-viewer`** — **partially portable.** The generator
  (`build_editor.py`) and the static HTML it produces are plain Python +
  browser code with no Claude dependency. But the SKILL.md's delivery/apply
  loop names Claude-specific tools and surfaces (`SendUserFile`, "Cowork",
  the Claude mobile app) — another harness can reuse the underlying idea (run
  the script, hand back the HTML, read a pasted payload back into the chat)
  but not those exact tool calls.

## Quick start

Run the bundled demo board from the repo root:

```bash
node skills/web/scripts/server.js examples/demo-board
```

This prints `Kanban app: http://localhost:7777` (or the next free port if
7777 is busy). Open that URL in a browser, or paste it into VSCode's Simple
Browser — it's desktop/localhost-only by design (see ADR 0002). `examples/demo-board/`
is a self-contained sample board; point the same command at any directory of
`*.card.md` files to run your own.

## The four surfaces

| Surface | For | What it is |
| --- | --- | --- |
| `kanban` | the AI | AI-driven card management — every file contract (card frontmatter, `config.yaml`, `notifications.md`) and when the AI must notify the human lives here. |
| `kanban-web` | the human, desktop | A live browser editor: a localhost Node server (stdlib-only) + vanilla-JS SPA with drag-drop board, full CRUD, bulk actions, search, a notifications inbox, and four views (board, dependency map, gantt, calendar). Bound to `127.0.0.1` only. |
| `kanban-cli` | the human, anywhere | A conversational editor — Claude prints the board and drives typed actions and `AskUserQuestion`, with the same operations and rules as `kanban-web`. Works identically at a terminal or under remote control on mobile. |
| `kanban-viewer` | the human, phone/tablet/Cowork | Generates a self-contained single-file HTML board — a read-only tap UI (move, edit, archive, delete, create) whose edits queue into an "Apply kanban changes" payload you paste back into chat for Claude to apply. |

Web and CLI implement the same operations under the same rules (the `doing`
entry gate, bulk actions, speedbumps, notifications); a few things are
deliberately unmirrored where the medium doesn't support them (drag & drop,
`localStorage` persistence, the SVG map, and so on). See `CONTEXT.md` for the
full parity table.

## The board data model

- **Cards** — one file per card: `<0000-id>.<kebab-case-slug>.card.md`. The
  4-digit-padded id prefix is cosmetic (sorting/visibility only); the
  frontmatter `id` field is the actual source of truth for identity.
  Frontmatter holds fields like `status`, `priority`, `assignee`, `tags`,
  dates, and dependency links; the Markdown body (including a `## Narrative`
  section) is free text. Only `*.card.md` files are treated as cards —
  `config.yaml`, `notifications.md`, and any other `.md` file are ignored by
  board scripts.
- **Status vs. archive** — `status` is a card's column (`backlog`, `todo`,
  `doing`, `done` by default, or a custom list from `config.yaml`). Archive is
  a *location*, not a status: moving a card into `kanban/archived/` takes it
  off the active board without touching its `status` field (almost always
  left as `done`). Restoring moves the file back.
- **Waiting vs. blocked** — these are two distinct concepts:
  - `waiting_for` is a **derived** dependency list. A card is waiting while
    any id it lists is not `done`; there's nothing to set or clear by hand —
    it disappears on its own once every dependency lands. A dangling id
    doesn't count.
  - `blocked` is a **manual** sticker: `blocked: <reason>`. It's a human stop
    sign, independent of dependencies, and it stays until a human clears it.
  - Both gate entry into the literal status `doing` — a waiting or blocked
    card can't move there — but neither evicts a card already sitting in
    `doing`.
- **The date triad** — `start_date` + `end_date` form a working range;
  `due_date` is an independent deadline that renders as its own marker even
  inside the range. As a compat fallback, a card with `start_date` and
  `due_date` but no `end_date` still reads as a `start_date` → `due_date`
  range.

## config.yaml

Optional, human-edited, one per board:

```yaml
nextId: 29 # monotonic id counter
assignees: # role-trio registry
  - handle: "@human"
    name: "Human"
    kind: human
    description: "A human can grab it. Final say on trusted and destructive calls."
  - handle: "@hitl"
    name: "AI (HITL)"
    kind: ai-hitl
    description: "AI will grab it but needs a human in the loop (grilling, spec, tickets, approval)."
  - handle: "@afk"
    name: "AI (AFK)"
    kind: ai-afk
    description: "The AI can execute fully autonomously."
priorities: [High, Normal, Low] # ordered highest first
tags: [skills, config, design] # curated tag vocabulary
statuses: [backlog, todo, doing, done] # official column list, in board order
```

Every list here **suggests, never validates** — free text still saves and
renders fine everywhere. An unlisted on-disk `status` renders under the list's
first column with its raw value shown, never rewritten; promotion is a human
adding it to the list.

## More docs

- [`docs/adr/`](docs/adr/) — architecture decision records (ADR 0001–0008),
  covering why the CLI is Claude-driven, why `kanban-web` gets a scoped
  local-server exception, hand-rolled widgets, tolerant vocabulary registries,
  archive-column UI parity, the shared interaction grammar, the date triad,
  and the machine-managed `updated` field.
- [`CONTEXT.md`](CONTEXT.md) — the ubiquitous-language glossary for every term
  used across the four surfaces (board, card, status, waiting, blocked, the
  role trio, and more).
- [`SECURITY.md`](SECURITY.md) — `kanban-web`'s threat model: the board files
  are the trust boundary, not HTTP auth.

## License

MIT. See [LICENSE](LICENSE).

Created by Francisco Pablo Perri.

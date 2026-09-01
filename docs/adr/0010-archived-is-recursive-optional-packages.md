# 0010. archived/ is scanned recursively; packages are optional folders

Date: 2026-08-31 · Status: accepted · Amends: 0002's archive location

## Context

`kanban/archived/` was a flat directory: every reader listed it once, one
level deep. On a long-lived board that becomes one big bag — hundreds of
finished cards with no way to say "these belong together" beyond the card
text. The obvious grouping tool is a folder, but a folder was unreadable:
one `readdir` per reader meant a card moved into a subfolder vanished from
the board, from id allocation, and from dependency resolution.

## Decision

`kanban/archived/` is scanned **recursively**. An archived card is any
`*.card.md` anywhere under it, at any depth.

`kanban/archived/<package>/` folders are optional grouping, nothing more. A
package name is free-form text kept verbatim (existing folders must match
byte-for-byte, so no slug pass), constrained only to one plain path
component — a separator or a `.`/`..` hop is refused rather than resolved.
Packages carry no meaning for status, ids, or dependencies; a card's identity
and every gate are unchanged by which folder holds it. Restore returns a card
to the board root regardless of depth, and leaves the emptied package folder
behind.

`kanban/archived/notifications.md` stays at the `archived/` root and is never
filed into a package — it is not a card, so the recursive walk (which only
ever collects `*.card.md`) does not see it either way.

Archive stays a LOCATION, never a status (ADR 0002). Packages are a second
axis of that same location, not a status, not a tag, and not a board.

## Considered options

- **A `package:` frontmatter field.** Rejected: it re-encodes location as card
  content, so the file tree and the field can disagree, and every writer has
  to keep them in sync. The folder IS the grouping; a second copy of it is a
  bug waiting to happen.
- **Sibling `archived-<name>/` directories at the board root.** Rejected: it
  puts non-board directories next to the live cards and forces every reader to
  learn a directory-name convention instead of one recursive walk.
- **Slugifying package names.** Rejected: autocomplete must offer the folders
  that actually exist, and a normalizing pass makes a typed name silently
  create a near-duplicate folder next to the one the user meant.

## Consequences

- Every archived reader walks the tree: the app's card store (listing, detail,
  find-by-id, restore, delete), the board scripts that resolve dependency
  status against archived cards, the migration scripts, and the viewer's
  generated editor.
- The app's archive endpoint takes an optional package; the board payload
  carries the existing package names so the bulk Archive popup can complete
  against them. A new name creates the folder.
- Archiving without a package is unchanged in every path — the card lands at
  the `archived/` root, and a package-less re-archive never demotes a card
  that is already filed in one.
- Nothing migrates: a flat `archived/` is a valid tree with zero packages.

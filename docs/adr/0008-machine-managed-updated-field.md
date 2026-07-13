# 0008. Machine-managed `updated` frontmatter timestamp

Date: 2026-07-09 · Status: accepted · Card: #35

## Context

"When was this card last touched?" — file mtimes lie across git checkouts
and machines; boards live on two machines.

## Decision

Optional `updated` field, local `YYYY-MM-DDTHH:MM:SS` (same shape as
notifications' `at`). The server stamps it on create and bumps it on every
content write (all PATCH paths); archive/restore never touch it (rename-only
moves). It is form-unmanaged — no UI ever edits it directly. Every writer
(AI included, per the kanban skill) shares the bump-on-content-write
contract. Display falls back to mtime, labeled as such.

## Consequences

A second machine-owned frontmatter line (after id) in hand-editable files —
tolerated drift: a hand edit that forgets the bump just leaves a stale
timestamp, never an error.

# 0009. Review and human-attention are stickers, not columns

Date: 2026-07-16 · Status: accepted (amended 2026-07-20, amendment NOT yet implemented) · Cards: kanban.proj#181, #185, #190

## Context

Card #181 asked for a `review` column — "an extra column to see, at a glance,
what's waiting for my review." Grilling it (/grill-with-docs, 2026-07-16) split
"waiting for me" into two cases: A — work is finished, approve/verify it; B —
work is mid-flight and needs my decision before it continues. Modeling either as
a column forced a `doing → review → done` lifecycle, redefined `done` to mean
"merged," and collided with the AFK dispatcher's corpse-sweep, where an `@afk`
card parked in `doing` awaiting a human is indistinguishable from one whose
worker died.

## Decision

Neither case is a column. Both are overlay sticker fields, siblings of `blocked`:

- `review: <text>` (new) = A, "finished, awaiting your approval." A PR-shaped
  value (`review: PR #6`) is polled by the dispatcher each tick; free text is
  cleared by the human.
- `blocked: <text>` (existing) also = B: "stuck until you act" already covers
  "waiting on your decision to proceed." `blocked` stays the superset — an
  external impediment or an awaited human decision, both "needs your action
  before work resumes." `review` is A only.

Statuses stay `backlog, todo, doing, done`; `done` stays terminal ("truly
finished," not "PR opened"). Both stickers overlay any status, render as pills,
are skipped by agents and the corpse-sweep, and are surfaced by search
(`review:`/`blocked:` = present, `review:PR` = substring) and click-to-filter on
the pill (card #189's mechanism) — which recovers "at a glance," on demand and
from anywhere.

## Considered options

- A `review` column (the literal #181 ask): rejected. It forces a `done`=merged
  redefinition, new column-default/color code across web + cli + viewer, and a
  status-transition machine — and a column cannot overlay `doing`, so "actively
  working, and part needs your eyes" is inexpressible.

## Consequences

- AFK green-path changes: an `@afk` code card, on green, opens its PR and gets
  `review: PR #N` while staying in `doing`; it is NOT stamped `done` at PR-open.
  Card #185 flips it to `done` on merge, or re-works it on changes-requested.
- The corpse-sweep gains a clause (card #190): an `@afk` card in `doing` with no
  live worker is a corpse only if it wears neither `blocked` nor `review`.
- `doing` now legitimately holds a mix (running, awaiting-review, blocked); pills
  and filters, not columns, separate them.
- If glance-via-filter proves insufficient, a `review:`-filtered virtual section
  in kanban-web is a cheap future add.

## Amendment (2026-07-20) — poll ownership moves to kanban-lint. NOT YET IMPLEMENTED

The kanban-afk decomposition (kanban.proj#213; #214 session-archetype
resolution; kanban-afk repo ADR 0001) re-homes this ADR's polling
consequences. Ratified, and recorded here so the design survives context
loss — but **nothing below is built yet**; today's monolithic `kanban-afk`
skill still behaves exactly as the Consequences above describe. Lands with
the `kanban-lint` build (implementation ticket: kanban.proj#224).

- **PR-poll + close-on-merge migrate dispatcher → `kanban-lint`** (the
  infrequent reconcile loop). The dispatcher sheds them; its only "review"
  is its build-time QA.
- **A PR-open card flips to `@hitl`/`@human`, not `@afk`** — the
  approve/merge owner is never the dispatcher. The machine-shaped `review`
  sticker contract itself (shape, stamp, re-work trigger) is unchanged.
- Same-looking states (PR open vs merged) disambiguate only by external
  reality — that reconcile job is why kanban-lint exists.

When kanban-lint ships: implement the above, update this ADR's status line
to "amendment implemented", and update the sticker-polling references in
this repo's skills to name lint as the poller.

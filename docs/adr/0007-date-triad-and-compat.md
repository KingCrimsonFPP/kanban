# 0007. Date triad: working range (start/end) + independent deadline (due)

Date: 2026-07-09 · Status: accepted · Cards: #36 → #40 (supersedes #36's range)

## Context

Card #36 shipped start_date→due_date as THE range. Same-day user feedback:
"when I'll do it" and "when it's owed" are different concepts.

## Decision

Three optional fields, each date or local datetime, never validated:
`start_date` (from) → `end_date` (to) = the working range; `due_date` = the
deadline, rendered as an independent marker (calendar deadline chip, gantt
diamond) and moved independently. COMPAT FALLBACK: end absent + start & due
present = the range reads start→due (#36-era cards keep rendering). The
fallback lives in ONE pure decider (rangeFields, calendar-model.js); every
renderer and drag writer flows through it, so compat drags shift start+due
by construction and can never invent an end_date.

## Consequences

On compat cards, due IS the range end — moving one moves the other; that
coupling is inherent to the fallback, not a bug. Date math is UTC-string
arithmetic throughout (TZ/DST-proof, verified under UTC+14 and UTC-9).
Column "Date" sort stays due-based.

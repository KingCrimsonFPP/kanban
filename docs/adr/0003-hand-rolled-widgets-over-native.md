# 0003. Hand-rolled form widgets over native browser widgets

Date: 2026-07-09 · Status: accepted

## Context

The app's primary browser is VSCode's Simple Browser (an Electron webview).
Native `<datalist>` renders its popup at wrong screen coordinates there and
its filter-by-current-value hides every option on a prefilled field.
Native `<input type="date">` would also forbid the
board's mixed date/datetime free-text contract.

## Decision

Form affordances that need a popup are hand-rolled: the combobox menus
(assignee/priority/tags) and the date-picker popover. Native
widgets are treated as suspect in this codebase. Free text stays legal in
every field the widgets serve — widgets only ever write values typing
already could.

## Consequences

More code we own, full styling control, and two disciplines to follow:
popovers that live inside modals render in-flow or body-mounted fixed
(escaping overflow contexts), and popover-internal clicks stopPropagation at
the boundary — re-renders can detach the clicked node mid-dispatch, which
breaks `closest()` in document-level handlers.

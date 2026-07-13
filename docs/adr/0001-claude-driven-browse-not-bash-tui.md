# ADR 0001 — Kanban browse is Claude-driven, not a standalone bash TUI

*Status: Accepted · Date: 2026-06-26*

## Context

We want to navigate a kanban board interactively — board overview → open a card → read it → see blockers — with a rich option-picker UX. It must work in **two contexts**: the user at their local terminal, and the user driving Claude Code via **remote control on the cloud mobile app**. Environment: Windows + Git Bash (mintty); the plugin is currently zero-dependency bash; `fzf`/`dialog`/`whiptail`/`gum` are not installed and Python `curses` is unavailable on Windows.

## Decision drivers

- Must work under remote control (mobile), not just at a local TTY.
- Keep the plugin's zero-dependency, pure-bash philosophy if possible.
- Match the "Claude option-picker" UX the user asked for.

## Options considered

1. **Standalone pure-bash arrow-key TUI** — `read -rsn1` keypress loop + ANSI redraw.
2. **Claude-driven** — Claude runs non-interactive view commands and drives navigation with `AskUserQuestion` + printed output.
3. **Python/Node TUI** (rich/textual/ink) — a "real" TUI framework.

## Decision

**Option 2 — Claude-driven.**

## Rationale

An interactive TUI **cannot run under remote control**: Claude executes commands non-interactively and captures their output, so a TUI blocking on `read` for a keypress has no live stdin and simply hangs until timeout. This is true even locally whenever *Claude* launches it — a bash TUI only works when the **user** runs it by hand in their own terminal, which is exactly the context unavailable on mobile. So Option 1 satisfies only one of the two required contexts, and the wrong one.

`AskUserQuestion` already renders as a rich arrow-key picker in the desktop terminal **and** as a tappable list on mobile — the exact UX the user pointed at — and works identically in both contexts. It requires zero TUI code and removes the mintty escape-sequence/redraw/resize risk entirely. Option 3 adds a runtime dependency and a second language to a bash-only plugin for no gain over Option 2.

## Consequences

- **Positive:** works on both surfaces; tiny build (a skill doc, no new scripts); no dependencies; no terminal-portability risk.
- **Negative:** navigation is Claude-mediated — there is no zero-Claude standalone browsing, and each hop is a round-trip (a tool call + a question) rather than an instant keypress, which costs tokens. Acceptable for boards of a handful of cards.
- **Mitigation if a no-Claude path is ever needed:** a local-only bash TUI can be added later as an optional wrapper over the same non-interactive view commands, without disturbing the Claude-driven path.

## Related constraint

`AskUserQuestion` is capped at 4 options, so it cannot enumerate an arbitrary-length card list. Navigation therefore uses a **printed markdown board + type-a-card-id + ≤4 targetless action options** (see the design spec, decision D2).

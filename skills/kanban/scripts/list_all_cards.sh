#!/bin/bash
# Export all kanban cards in pipe-delimited format
# Output: id|status|waiting_for|blocked|title
#   waiting_for — raw dependency ids from frontmatter (edges only; whether the
#     card is actually waiting is derived — see show_waiting.sh / view_board.sh)
#   blocked — the impediment reason when the manual `blocked:` sticker passes
#     the epic #137 predicate, empty otherwise

KANBAN_DIR="${1:-.}"

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

blocked_reason() {
    local v="$1"
    v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    case "$v" in
        \"*\") v="${v#\"}"; v="${v%\"}" ;;
        \'*\') v="${v#\'}"; v="${v%\'}" ;;
    esac
    local lower
    lower=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
        false|no) return 1 ;;
        true) printf 'reason unspecified'; return 0 ;;
    esac
    case "$v" in
        *[[:alnum:]]*) printf '%s' "$v"; return 0 ;;
    esac
    return 1
}

for f in "$KANBAN_DIR"/*.card.md; do
  [ -f "$f" ] || continue
  id=$(field "$f" id)
  status=$(field "$f" status)
  waiting=$(field "$f" waiting_for | tr -d '[]' | sed 's/^ *//; s/ *$//')
  blocked=$(blocked_reason "$(field "$f" blocked)")
  title=$(awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$f")
  echo "$id|$status|$waiting|$blocked|$title"
done | sort -n

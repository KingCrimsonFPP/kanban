#!/usr/bin/env bash
# Display kanban cards grouped by status.
# Card #31: column set + order follow config.yaml's `statuses:` list when
# present. Supported here: the INLINE flow form only — `statuses: [a, b, c]`
# (quotes/comments tolerated, single-word statuses only). The block (`- item`)
# form is NOT parsed by this bash script and falls back to the default four —
# use the inline form if the CLI board print should follow a custom list.
# A card whose status isn't in the list groups under the FIRST column
# (the catch-all) with its raw status shown inline as [status: <raw>].
# Epic #137 flags:
#   [waiting: #x #y] — UNRESOLVED `waiting_for` ids only: a listed card that
#     exists (live or archived) and is not `done`. Dangling ids are
#     non-blocking; no flag at all when every dep is done.
#   [BLOCKED] — the manual `blocked:` sticker passes the predicate (trimmed
#     value contains >=1 alphanumeric; false/no -> not blocked; true ->
#     blocked, reason unspecified).
# Usage: bash view_board.sh [kanban-directory]

KANBAN_DIR="${1:-kanban}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

# Extract a YAML frontmatter field value
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

# Extract first H1 title from body (after frontmatter)
title() {
    awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$1"
}

# Blocked predicate (epic #137): trimmed value has >=1 alphanumeric char;
# YAML boolean special-case: false/no -> not blocked, true -> blocked.
# Prints the reason and returns 0 when blocked; returns 1 otherwise.
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

# id -> status map across live + archived, so waiting flags are done-aware.
declare -A dep_status
shopt -s nullglob
all_cards=("$KANBAN_DIR"/*.card.md "$KANBAN_DIR"/archived/*.card.md)
shopt -u nullglob
if [ "${#all_cards[@]}" -gt 0 ]; then
    while read -r cid cst; do
        [ -n "$cid" ] && dep_status[$cid]="$cst"
    done < <(awk '
        FNR==1{fm=0; id=""; st=""}
        /^---$/{fm++; if(fm==2 && id!="") print id, st; next}
        fm==1 && /^id:/{sub(/^id:[ \t]*/,""); gsub(/[ \t\r]/,""); id=$0}
        fm==1 && /^status:/{sub(/^status:[ \t]*/,""); gsub(/[ \t\r]/,""); st=$0}
    ' "${all_cards[@]}")
fi

# Column order: config.yaml's inline statuses list, default four otherwise.
STATUSES="backlog todo doing done"
if [ -f "$KANBAN_DIR/config.yaml" ]; then
    inline=$(sed -n 's/^statuses:[[:space:]]*\[\([^]]*\)\].*$/\1/p' "$KANBAN_DIR/config.yaml" | head -1)
    if [ -n "$inline" ]; then
        parsed=$(printf '%s' "$inline" | tr ',' '\n' | sed 's/["'"'"']//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | tr '\n' ' ')
        parsed=$(echo $parsed) # squeeze whitespace
        [ -n "$parsed" ] && STATUSES="$parsed"
    fi
fi
FIRST="${STATUSES%% *}"

declare -A cols
for s in $STATUSES; do cols[$s]=""; done

for f in "$KANBAN_DIR"/*.card.md; do
    [ -f "$f" ] || continue

    id=$(field "$f" id)
    status=$(field "$f" status)
    priority=$(field "$f" priority)
    waiting_raw=$(field "$f" waiting_for)
    blocked_raw=$(field "$f" blocked)
    t=$(title "$f")
    [ -z "$t" ] && t=$(basename "$f" .md)

    line="  #${id} ${t}"
    [ "$priority" = "High" ] && line="$line [HIGH]"

    # Waiting: list unresolved deps only (done deps and dangling ids drop out).
    unresolved=""
    for dep in $(printf '%s' "$waiting_raw" | tr '[],' '   '); do
        depst="${dep_status[$dep]:-}"
        [ -n "$depst" ] && [ "$depst" != "done" ] && unresolved="$unresolved #$dep"
    done
    [ -n "$unresolved" ] && line="$line [waiting:$unresolved]"

    # Blocked flag carries the reason inline — the docs' promised shape
    # ([blocked: <reason>]; blocked_reason prints "reason unspecified" for a
    # bare true sticker).
    if reason=$(blocked_reason "$blocked_raw"); then
        line="$line [blocked: $reason]"
    fi

    # Unknown status -> first column, raw status shown (card #31's promotion
    # mechanic: the human adds it to config.yaml; the file is never rewritten).
    case " $STATUSES " in
        *" $status "*) col="$status" ;;
        *) col="$FIRST"; line="$line [status: $status]" ;;
    esac

    cols[$col]+="$line"$'\n'
done

for s in $STATUSES; do
    printf "=== %-8s ===\n" "$(echo "$s" | tr '[:lower:]' '[:upper:]')"
    if [ -z "${cols[$s]}" ]; then
        echo "  (empty)"
    else
        printf "%s" "${cols[$s]}"
    fi
    echo
done

# Archive trailer kept for output compatibility (pre-#31 always printed it;
# archived/ is listed by the app, not this script)
echo ""
echo "=== ARCHIVE ==="
echo "(see kanban/archived/ — not scanned by this script)"

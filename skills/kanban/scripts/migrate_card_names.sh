#!/usr/bin/env bash
# Rename a board's card files to the <0000-id>.<slug>.card.md convention, in place.
# Covers <dir> and <dir>/archived. Dry-run by default; pass --apply to rename.
# Usage: bash migrate_card_names.sh <kanban-directory> [--apply]

KANBAN_DIR="${1:-.}"
MODE="${2:-}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

renames=0
errors=0

for dir in "$KANBAN_DIR" "$KANBAN_DIR/archived"; do
    [ -d "$dir" ] || continue
    for f in "$dir"/*.card.md; do
        [ -f "$f" ] || continue
        bname=$(basename "$f")

        # already in <0000-id>. form
        case "$bname" in
            [0-9][0-9][0-9][0-9].*) continue ;;
        esac

        id=$(field "$f" id | tr -d '[:space:]')
        if ! [[ "$id" =~ ^[0-9]+$ ]]; then
            echo "SKIP (no numeric id): $f" >&2
            errors=$((errors + 1))
            continue
        fi
        if [ "$id" -gt 9999 ]; then
            echo "SKIP (id > 9999 exceeds 4-digit prefix): $f" >&2
            errors=$((errors + 1))
            continue
        fi

        # strip any pre-existing unpadded/differently-padded numeric id prefix:
        # only when everything before the FIRST dot is digits. Must NOT match a
        # digit-leading slug (e.g. "9x-weird-title.card.md"), only an actual
        # "<digits>." id prefix.
        slugpart="$bname"
        digits="${slugpart%%.*}"
        case "$digits" in
            ''|*[!0-9]*) ;;
            *) slugpart="${slugpart#*.}" ;;
        esac

        target="$dir/$(printf '%04d' "$id").$slugpart"
        if [ -e "$target" ]; then
            echo "SKIP (target exists): $f -> $target" >&2
            errors=$((errors + 1))
            continue
        fi

        if [ "$MODE" = "--apply" ]; then
            mv "$f" "$target" && echo "RENAMED: $bname -> $(basename "$target")"
        else
            echo "would rename: $bname -> $(basename "$target")"
        fi
        renames=$((renames + 1))
    done
done

if [ "$MODE" != "--apply" ]; then
    echo "(dry run — $renames rename(s) planned, $errors skip(s); rerun with --apply)"
else
    echo "done — $renames renamed, $errors skipped"
fi
[ "$errors" -eq 0 ]
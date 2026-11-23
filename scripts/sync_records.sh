#!/bin/bash
# Pull records produced by `tessera push` on a data host and register them.
#
# Idempotent: `tessera import` skips runs that already exist, so this can run on
# a timer and simply re-attempt everything.
set -uo pipefail

REMOTE="${TESSERA_RECORD_HOST:-pckr258}"
REMOTE_DIR="${TESSERA_RECORD_REMOTE_DIR:-/home/POLY/diazd/tessera-src/records}"
LOCAL_DIR="${TESSERA_RECORD_LOCAL_DIR:-/home/deo/.local/share/tessera/records}"
PYTHON="${TESSERA_PYTHON:-/home/deo/.venvs/tessera-py312/bin/python}"
APP_DIR="${TESSERA_APP_DIR:-/home/deo/Documents/tessera-dashboard}"

mkdir -p "$LOCAL_DIR"

if ! rsync -a --ignore-existing -e "ssh -o BatchMode=yes -o ConnectTimeout=10" \
        "$REMOTE:$REMOTE_DIR/" "$LOCAL_DIR/" 2>/dev/null; then
    echo "$(date -Is) could not reach $REMOTE; skipping"
    exit 0
fi

cd "$APP_DIR" || exit 1

shopt -s nullglob
mkdir -p "$LOCAL_DIR/.failed" "$LOCAL_DIR/.done"

for record in "$LOCAL_DIR"/*.json; do
    name=$(basename "$record")

    # A record that has already been imported is not re-parsed on every tick.
    if [ -f "$LOCAL_DIR/.done/$name" ]; then
        continue
    fi

    output=$("$PYTHON" -m mddatalake.cli.main import "$record" 2>&1)
    status=$?
    printf '%s\n' "$output" | sed "s|^|$(date -Is) |" | grep -v "already exists" || true

    if [ "$status" -eq 0 ] || printf '%s' "$output" | grep -q "already exists"; then
        touch "$LOCAL_DIR/.done/$name"
    else
        # A failure used to be swallowed by the pipeline above; keep the record
        # and its error where a person can find them.
        printf '%s\n' "$output" > "$LOCAL_DIR/.failed/$name.error"
        echo "$(date -Is) FAILED $name (see .failed/$name.error)"
    fi
done

# Imported runs have no preview yet. Build a few per tick so the dashboard
# fills in on its own without hammering Drive.
"$PYTHON" -m mddatalake.cli.main previews --limit "${TESSERA_PREVIEWS_PER_TICK:-2}" 2>&1 \
    | sed "s|^|$(date -Is) |"

# Fill in what the import could not: re-parse the stored logs of newly
# arrived runs and derive composition from their data files.
"$PYTHON" "$APP_DIR/scripts/enrich_runs.py" --recent-minutes 30 \
    | grep -E "enriched|\+ " | sed "s|^|$(date -Is) |"

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
for record in "$LOCAL_DIR"/*.json; do
    # Skip records already imported (the importer reports it, but this keeps
    # the log quiet on a 2-minute timer).
    "$PYTHON" -m mddatalake.cli.main import "$record" 2>&1 \
        | grep -v "already exists" \
        | sed "s|^|$(date -Is) |"
done

# Imported runs have no preview yet. Build a few per tick so the dashboard
# fills in on its own without hammering Drive.
"$PYTHON" -m mddatalake.cli.main previews --limit "${TESSERA_PREVIEWS_PER_TICK:-2}" 2>&1 \
    | sed "s|^|$(date -Is) |"

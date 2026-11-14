#!/bin/bash
# Install the Tessera skill + control client for every agent harness on this box.
#
#   ./scripts/install_skills.sh
#
# Claude Code reads ~/.claude/skills (and ~/.claude-fcc/skills); opencode and
# AGY both read a global AGENTS.md, so a short pointer is appended there with
# markers so re-running is safe and the section can be removed cleanly.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$REPO/skills/tessera"
CTL_SRC="$REPO/scripts/tessera_ctl.py"
SHARE="$HOME/.local/share/tessera"
BIN="$HOME/.local/bin"

mkdir -p "$SHARE" "$BIN"

# 1. Control client
install -m 0755 "$CTL_SRC" "$SHARE/tessera_ctl.py"
ln -sf "$SHARE/tessera_ctl.py" "$BIN/tessera-ctl"
echo "installed $BIN/tessera-ctl"

# 2. Claude Code skills (both config roots that exist here)
for root in "$HOME/.claude/skills" "$HOME/.claude-fcc/skills"; do
    if [ -d "$root" ]; then
        rm -rf "$root/tessera"
        ln -s "$SKILL_SRC" "$root/tessera"
        echo "linked skill into $root/tessera"
    fi
done

# 3. Harnesses that read a global AGENTS.md
block_start="<!-- tessera-skill:start -->"
block_end="<!-- tessera-skill:end -->"
section="$block_start
## Tessera data lake

To file simulations into Tessera (projects, run metadata, trajectory uploads),
read $SKILL_SRC/SKILL.md and use \`tessera-ctl\` (installed at $BIN/tessera-ctl).
Set TESSERA_URL, and TESSERA_EMAIL/TESSERA_PASSWORD or TESSERA_TOKEN, before use.
$block_end"

for agents in "$HOME/.config/opencode/AGENTS.md" "$HOME/.gemini/AGENTS.md"; do
    mkdir -p "$(dirname "$agents")"
    touch "$agents"
    if grep -q "$block_start" "$agents" 2>/dev/null; then
        # Replace the existing block.
        python3 - "$agents" "$block_start" "$block_end" "$section" <<'PY'
import sys
path, start, end, section = sys.argv[1:5]
text = open(path).read()
before = text.split(start)[0]
after = text.split(end)[-1] if end in text else ''
open(path, 'w').write(before + section + after)
PY
    else
        printf '\n%s\n' "$section" >> "$agents"
    fi
    echo "pointed $agents at the skill"
done

echo
echo "Done. Try:"
echo "  export TESSERA_URL=https://bigmsi.tail500ddf.ts.net:8420 TESSERA_EMAIL=... TESSERA_PASSWORD=..."
echo "  tessera-ctl projects list"

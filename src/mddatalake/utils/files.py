"""File-level helpers shared by ingestion and push."""

from __future__ import annotations

# Bookkeeping files Tessera writes itself, plus editor/OS noise. None of these
# are simulation data, and ingesting them pollutes the artifact list.
IGNORED_NAMES = {
    ".mddatalake_ingested",
    ".DS_Store",
    "Thumbs.db",
}


def is_ingestable(name: str) -> bool:
    """Return True when a file name should become an artifact."""
    base = name.rsplit("/", 1)[-1]
    if base in IGNORED_NAMES:
        return False
    # Hidden files, editor backups (#x#), and rclone/rsync temporaries
    # (.name.XXXX) are not data.
    if base.startswith(".") or base.startswith("#") or base.endswith("~"):
        return False
    return True

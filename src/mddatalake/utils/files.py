"""File-level helpers shared by ingestion and push."""

from __future__ import annotations

from pathlib import Path

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


def resolve_for_read(path: Path) -> Path | None:
    """Return the real file behind a path, following symlinks.

    Simulation directories link shared data files from elsewhere
    (``data.lmpdata -> ../bulk/data.lmpdata``). rclone will not copy a symlink
    as a file source, and a data lake should store the bytes rather than a
    pointer that breaks as soon as the original moves. Returns None for broken
    links or non-files.
    """
    path = Path(path)
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return resolved if resolved.is_file() else None

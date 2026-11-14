"""Storage key conventions shared by every backend.

Blobs are content addressed, so the same file ingested in ten runs is stored
once. The key is backend independent: it is a relative path under the storage
root (local directory, bucket prefix, or Google Drive folder).

Layout::

    cas/sha256/ab/cd/abcdef...1234.lammpstrj
"""

from pathlib import Path


def cas_key(checksum: str, filename: str | None = None) -> str:
    """Return the content-addressed key for a blob.

    Args:
        checksum: Full SHA-256 hex digest of the file.
        filename: Original file name, used only to preserve its extensions.

    Returns:
        Relative storage key such as ``cas/sha256/ab/cd/<sha>.xtc``.
    """
    if len(checksum) < 4:
        raise ValueError(f"Checksum too short: {checksum}")

    extension = "".join(Path(filename).suffixes) if filename else ""
    return f"cas/sha256/{checksum[:2]}/{checksum[2:4]}/{checksum}{extension}"

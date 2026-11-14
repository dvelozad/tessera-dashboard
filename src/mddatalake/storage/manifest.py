"""Run manifests written next to the artifacts on the cold tier.

Blobs on Google Drive are content addressed, so a bare Drive listing shows
``cas/sha256/ab/cd/<sha>.lammpstrj`` and nothing about which run a file belongs
to. Each run therefore gets a small ``manifest.json`` under a human-readable
path::

    tessera/projects/LJ_GC/PROD_MUT7b/manifest.json

The manifest maps the original file names to their blob keys, checksums and
sizes, and carries the run's metadata. It is the answer to "I am looking at
Drive, which of these blobs is the trajectory for run X?".
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mddatalake.storage.backend import StorageBackend

MANIFEST_VERSION = 1


def slugify(name: str) -> str:
    """Make a project/run name safe for a Drive path segment."""
    cleaned = "".join(c if (c.isalnum() or c in "-_. ") else "_" for c in name).strip()
    cleaned = cleaned.replace(" ", "_").strip("._-")
    return cleaned or "unnamed"


def build_manifest(
    *,
    run_id: int,
    project_name: str,
    run_name: str,
    engine: str | None,
    description: str | None,
    artifacts: list[dict[str, Any]],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the manifest payload for one run."""
    files = []
    for artifact in artifacts:
        files.append(
            {
                "name": artifact["file_name"],
                "type": artifact["artifact_type"],
                "size_bytes": artifact["file_size_bytes"],
                "sha256": artifact["checksum_sha256"],
                "blob": artifact["storage_key"],
                "original_path": artifact.get("file_path"),
            }
        )

    payload: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "project": project_name,
        "run": run_name,
        "engine": engine,
        "description": description,
        "total_bytes": sum(f["size_bytes"] for f in files),
        "files": files,
    }
    if extra:
        payload.update(extra)
    return payload


def manifest_key(project_name: str, run_name: str, run_id: int | None = None) -> str:
    """Return the storage key for a run manifest.

    ``run_id`` is only used by callers that already know the run collides with
    another run of the same name in the same project.
    """
    project = slugify(project_name)
    run = slugify(run_name)
    if run_id is not None:
        run = f"{run}--{run_id}"
    return f"projects/{project}/{run}/manifest.json"


async def resolve_manifest_key(
    storage: StorageBackend, project_name: str, run_name: str, run_id: int
) -> str:
    """Pick a manifest key that does not clobber a different run's manifest."""
    key = manifest_key(project_name, run_name)
    if not await storage.exists(key):
        return key

    with tempfile.TemporaryDirectory(prefix="tessera-manifest-") as tmp:
        target = Path(tmp) / "manifest.json"
        try:
            await storage.download(key, target)
            existing = json.loads(target.read_text())
        except Exception:
            # Unreadable manifest: do not risk overwriting someone else's data.
            return manifest_key(project_name, run_name, run_id)

    if existing.get("run_id") == run_id:
        return key
    return manifest_key(project_name, run_name, run_id)


async def write_manifest(
    storage: StorageBackend,
    *,
    run_id: int,
    project_name: str,
    run_name: str,
    engine: str | None,
    description: str | None,
    artifacts: list[dict[str, Any]],
    extra: dict[str, Any] | None = None,
) -> str:
    """Write the run manifest through the storage backend. Returns its key."""
    payload = build_manifest(
        run_id=run_id,
        project_name=project_name,
        run_name=run_name,
        engine=engine,
        description=description,
        artifacts=artifacts,
        extra=extra,
    )
    key = await resolve_manifest_key(storage, project_name, run_name, run_id)

    with tempfile.TemporaryDirectory(prefix="tessera-manifest-") as tmp:
        source = Path(tmp) / "manifest.json"
        source.write_text(json.dumps(payload, indent=2, sort_keys=False))
        await storage.upload(source, key)

    return key

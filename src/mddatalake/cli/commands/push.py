"""Push a run from the machine that holds it straight into the cold tier.

The usual path (``tessera pull``) copies the run to the server and lets the
transfer worker upload it. For a workstation that already has rclone access to
the same Drive, that moves every trajectory twice over a slow link. ``push``
inverts it: parse and upload locally, then hand the server a small JSON record
that it imports without touching the data.

    # on pckr258
    tessera push /data/.../LJ_GC/PROD -p LJ_GC --record PROD.json

    # on bigmsi
    tessera import PROD.json
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rich.console import Console

console = Console()
logger = logging.getLogger(__name__)


def _jsonable(value: Any) -> Any:
    """Make parser metadata JSON serialisable (numpy scalars, arrays, paths)."""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None  # type: ignore[assignment]

    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if np is not None:
        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


async def push_command(
    directory: Path,
    project_name: str,
    run_name: str | None = None,
    description: str | None = None,
    record_path: Path | None = None,
    source_label: str | None = None,
    analyze: bool = False,
) -> Path:
    """Parse a run, upload its blobs to the cold tier, and emit a record."""
    from mddatalake.core.config import settings
    from mddatalake.ingestion.scenario_detector import ScenarioDetector
    from mddatalake.parsers import GromacsParser, LammpsParser, detect_engine
    from mddatalake.storage.manifest import write_manifest
    from mddatalake.storage.rclone import RcloneBackend
    from mddatalake.utils.checksum import compute_checksum

    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise RuntimeError(f"Not a directory: {directory}")

    run_name = run_name or directory.name
    source = source_label or str(directory)

    # Upload straight to the remote: no hot cache, no local second copy.
    storage = RcloneBackend(
        remote=settings.gdrive_remote,
        root=settings.gdrive_root,
        config_path=settings.rclone_config_path,
        bandwidth_limit=settings.rclone_bwlimit,
        retries=settings.rclone_retries if hasattr(settings, "rclone_retries") else 3,
        timeout=float(settings.rclone_timeout_seconds),
    )

    engine_name = detect_engine(directory)
    parser = LammpsParser(directory) if engine_name == "lammps" else GromacsParser(directory)
    metadata = parser.parse()

    from mddatalake.utils.files import is_ingestable

    artifacts: list[dict[str, Any]] = []
    for info in metadata.get("artifacts", []):
        file_path = Path(info["file_path"])
        if not file_path.exists() or not is_ingestable(file_path.name):
            continue

        size = file_path.stat().st_size
        console.print(f"  hashing {file_path.name} ({size / 1e9:.2f} GB)")
        checksum = compute_checksum(file_path)

        from mddatalake.storage.keys import cas_key

        key = cas_key(checksum, file_path.name)
        console.print(f"  uploading {file_path.name} -> {key}")
        await storage.upload(file_path, key, checksum)

        artifacts.append(
            {
                "file_name": info["file_name"],
                "file_path": f"{source.rstrip('/')}/{file_path.name}",
                "artifact_type": info["artifact_type"],
                "storage_key": key,
                "checksum_sha256": checksum,
                "file_size_bytes": size,
                "compression": None,
            }
        )

    if not artifacts:
        raise RuntimeError(f"No artifacts found in {directory}")

    # Human-readable index next to the blobs.
    await write_manifest(
        storage,
        run_id=0,  # unknown until the server imports the record
        project_name=project_name,
        run_name=run_name,
        engine=metadata.get("engine"),
        description=description,
        artifacts=artifacts,
        extra={"source": source, "pushed_from": source_label or "unknown"},
    )

    # Analyse here, on the machine that holds the data: obleas reads the
    # trajectory in place, so no bytes move for this.
    analyses: list[dict[str, Any]] = []
    if analyze and settings.obleas_enabled:
        from mddatalake.analysis.service import analyze_directory, runner_from_settings

        runner = runner_from_settings()
        if not runner.available():
            console.print(
                f"[yellow]obleas not found at {runner.binary!r}; skipping analysis[/yellow]"
            )
        else:
            console.print("[bold]Running obleas analyses...[/bold]")
            try:
                series = await analyze_directory(
                    directory,
                    metadata,
                    runner,
                    max_trajectory_bytes=int(settings.obleas_max_trajectory_gb * 1e9)
                    or None,
                )
                analyses = [item.as_record() for item in series]
                console.print(f"  {len(analyses)} series from obleas")
            except Exception as e:  # noqa: BLE001 - analysis must not lose the push
                console.print(f"[yellow]analysis failed: {e}[/yellow]")

    payload = {
        "record_version": 1,
        "project": project_name,
        "run": run_name,
        "description": description,
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "metadata": _jsonable(metadata),
        "artifacts": artifacts,
        "analyses": analyses,
    }

    record_path = record_path or Path(f"{run_name}.json")
    record_path.write_text(json.dumps(payload, indent=2))
    console.print(
        f"[green]Pushed {len(artifacts)} artifact(s); record written to {record_path}[/green]"
    )
    return record_path

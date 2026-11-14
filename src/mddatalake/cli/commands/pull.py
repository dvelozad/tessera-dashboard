"""Pull a simulation directory from a remote host and ingest it."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from rich.console import Console

from mddatalake.core.config import settings

console = Console()


def parse_source(source: str) -> tuple[str | None, str]:
    """Split ``host:/path`` into its parts.

    A plain path (no colon) is treated as local.
    """
    if ":" not in source:
        return None, source

    host, path = source.split(":", 1)
    if not host or not path:
        raise ValueError(f"Invalid source {source!r}; expected host:/absolute/path")
    return host, path


def rsync_from(host: str, remote_path: str, destination: Path) -> None:
    """Copy a remote directory into the local staging area."""
    destination.mkdir(parents=True, exist_ok=True)
    remote = f"{host}:{remote_path.rstrip('/')}/"

    command = [
        "rsync",
        "-a",
        "--partial",
        "--info=progress2",
        "-e",
        "ssh -o BatchMode=yes",
        remote,
        f"{destination}/",
    ]
    console.print(f"[bold]Pulling[/bold] {remote} -> {destination}")
    result = subprocess.run(command)
    if result.returncode != 0:
        raise RuntimeError(f"rsync failed with exit code {result.returncode}")


async def pull_command(
    source: str,
    project_name: str,
    run_name: str | None = None,
    description: str | None = None,
    staging_dir: Path | None = None,
    keep_staged: bool = False,
):
    """Pull (when remote) and ingest one simulation directory."""
    from mddatalake.db.session import AsyncSessionLocal
    from mddatalake.ingestion import IngestionService

    host, remote_path = parse_source(source)

    if host is None:
        directory = Path(remote_path)
    else:
        name = Path(remote_path.rstrip("/")).name or "run"
        root = staging_dir or Path(settings.staging_root)
        directory = root / project_name / name
        rsync_from(host, remote_path, directory)

    if not directory.is_dir():
        raise RuntimeError(f"Not a directory: {directory}")

    # Short-lived process: previews must finish before it exits.
    settings.preview_async_extraction = False

    async with AsyncSessionLocal() as session:
        service = IngestionService(session)
        run_id = await service.ingest(
            directory=directory,
            project_name=project_name,
            run_name=run_name,
            description=description,
        )

    console.print(f"[green]Ingested run {run_id} from {directory}[/green]")

    if host is not None and not keep_staged:
        # The bytes now live in the storage tier; the staged copy is redundant.
        import shutil

        shutil.rmtree(directory, ignore_errors=True)
        console.print(f"[dim]Removed staged copy {directory}[/dim]")

    return run_id


def run_pull(*args, **kwargs):  # pragma: no cover - thin sync wrapper
    return asyncio.run(pull_command(*args, **kwargs))

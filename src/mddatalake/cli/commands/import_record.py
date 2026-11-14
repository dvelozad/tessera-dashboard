"""Register a run whose blobs were pushed to the cold tier from another host."""

from __future__ import annotations

import json
from pathlib import Path

from rich.console import Console

console = Console()


async def import_command(record: Path, run_name: str | None = None) -> int:
    """Create the database rows for a record produced by ``tessera push``."""
    from sqlalchemy import select

    from mddatalake.core.config import settings
    from mddatalake.db.models import Project, SimulationRun
    from mddatalake.db.session import AsyncSessionLocal
    from mddatalake.ingestion import IngestionService
    from mddatalake.storage import get_storage_backend
    from mddatalake.storage.manifest import write_manifest

    payload = json.loads(Path(record).read_text())
    project_name = payload["project"]
    name = run_name or payload["run"]

    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            select(SimulationRun.id)
            .join(Project, Project.id == SimulationRun.project_id)
            .where(Project.name == project_name, SimulationRun.run_name == name)
        )
        if existing.first() is not None:
            console.print(
                f"[yellow]Run {project_name}/{name} already exists; nothing to do[/yellow]"
            )
            return 0

        service = IngestionService(session)
        run_id = await service.import_record({**payload, "run": name})

    # The manifest was written by the pushing host, which did not know the run
    # id yet. Rewrite it now so the Drive copy points at a real run.
    if settings.storage_manifest_enabled:
        try:
            await write_manifest(
                get_storage_backend(),
                run_id=run_id,
                project_name=project_name,
                run_name=name,
                engine=payload.get("metadata", {}).get("engine"),
                description=payload.get("description"),
                artifacts=payload["artifacts"],
                extra={"source": payload.get("source")},
            )
        except Exception as e:  # noqa: BLE001 - the DB row is already correct
            console.print(f"[yellow]Could not update manifest: {e}[/yellow]")

    console.print(
        f"[green]Imported run {run_id} ({project_name}/{name}) "
        f"with {len(payload['artifacts'])} artifact(s)[/green]"
    )
    return run_id

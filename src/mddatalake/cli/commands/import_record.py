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

    analyses = payload.get("analyses") or []

    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            select(SimulationRun.id)
            .join(Project, Project.id == SimulationRun.project_id)
            .where(Project.name == project_name, SimulationRun.run_name == name)
        )
        row = existing.first()

        if row is not None:
            # The run is already here; attach any analyses that are new, which
            # is how a re-push adds obleas results without duplicating the run.
            added = await _store_analyses(session, row[0], analyses)
            await session.commit()
            if added:
                console.print(
                    f"[green]Attached {added} analysis series to "
                    f"{project_name}/{name}[/green]"
                )
            else:
                console.print(
                    f"[yellow]Run {project_name}/{name} already exists; nothing to do[/yellow]"
                )
            return row[0]

        service = IngestionService(session)
        run_id = await service.import_record({**payload, "run": name})
        added = await _store_analyses(session, run_id, analyses)
        await session.commit()

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
        f"with {len(payload['artifacts'])} artifact(s) "
        f"and {added} analysis series[/green]"
    )
    return run_id


async def _store_analyses(session, run_id: int, analyses: list[dict]) -> int:
    """Add analysis series that the run does not already carry."""
    from sqlalchemy import select as _select

    from mddatalake.analysis.obleas import AnalysisSeries
    from mddatalake.analysis.service import store_series
    from mddatalake.db.models import Observable

    if not analyses:
        return 0

    existing = await session.execute(
        _select(Observable.observable_name).where(Observable.simulation_run_id == run_id)
    )
    known = {name for (name,) in existing.all()}

    series = []
    for payload in analyses:
        if payload.get("name") in known:
            continue
        series.append(AnalysisSeries.from_record(payload))

    return await store_series(session, run_id, series)

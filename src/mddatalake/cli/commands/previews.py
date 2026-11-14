"""Generate previews for runs that arrived without one.

Runs imported from a pushed record never pass through ingestion's post-stage,
and the API only builds a preview lazily when someone opens the page. This walks
the pending (and previously failed) trajectories in the background instead.
"""

from __future__ import annotations

import logging

from rich.console import Console

console = Console()
logger = logging.getLogger(__name__)


async def previews_command(limit: int = 0, retry_failed: bool = True) -> int:
    """Extract previews for trajectory artifacts that do not have one."""
    from sqlalchemy import select

    from mddatalake.core.enums import ArtifactType
    from mddatalake.db.models import Artifact
    from mddatalake.db.session import AsyncSessionLocal
    from mddatalake.ingestion.preview_service import PreviewExtractionService
    from mddatalake.storage import get_storage_backend

    states = ["pending"]
    if retry_failed:
        states.append("failed")

    storage = get_storage_backend()
    done = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Artifact)
            .where(Artifact.artifact_type == ArtifactType.TRAJECTORY)
            .where(Artifact.preview_status.in_(states))
            .order_by(Artifact.id)
        )
        artifacts = list(result.scalars().all())

        if limit:
            artifacts = artifacts[:limit]

        console.print(f"Processing {len(artifacts)} trajectory artifact(s)")

        for artifact in artifacts:
            try:
                ok = await PreviewExtractionService(db, storage).extract_preview(artifact)
                if ok:
                    done += 1
                    console.print(f"  [green]ok[/green] artifact {artifact.id}")
                else:
                    console.print(
                        f"  [yellow]skip[/yellow] artifact {artifact.id} "
                        f"({artifact.preview_status})"
                    )
            except Exception as e:  # noqa: BLE001 - one bad artifact must not stop the pass
                console.print(f"  [red]fail[/red] artifact {artifact.id}: {e}")

    console.print(f"Generated {done} preview(s)")
    return done

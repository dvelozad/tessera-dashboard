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


async def previews_command(limit: int = 0, retry_failed: bool = True, force: bool = False) -> int:
    """Extract previews for trajectory artifacts that do not have one."""
    from sqlalchemy import select

    from mddatalake.core.enums import ArtifactType
    from mddatalake.db.models import Artifact
    from mddatalake.db.session import AsyncSessionLocal
    from mddatalake.ingestion.preview_service import PreviewExtractionService
    from mddatalake.storage import get_storage_backend

    from datetime import datetime, timedelta, timezone

    states = ["pending"]
    if retry_failed:
        states.append("failed")
    if force:
        # Regenerate previews that already exist, e.g. after the frame count
        # or the extraction changed.
        states.append("ready")

    # "processing" older than this means the attempt died (crash, restart).
    stale_before = datetime.now(timezone.utc) - timedelta(minutes=30)

    storage = get_storage_backend()
    done = 0

    async with AsyncSessionLocal() as db:
        from sqlalchemy import or_

        result = await db.execute(
            select(Artifact)
            .where(Artifact.artifact_type == ArtifactType.TRAJECTORY)
            .where(
                or_(
                    Artifact.preview_status.in_(states),
                    # Stuck mid-attempt: retry it.
                    (Artifact.preview_status == "processing")
                    & (
                        Artifact.preview_generated_at.is_(None)
                        | (Artifact.preview_generated_at < stale_before)
                    ),
                )
            )
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

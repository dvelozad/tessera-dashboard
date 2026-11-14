"""Background transfer worker: pushes hot-tier artifacts to the cold tier."""

from __future__ import annotations

import asyncio

from rich.console import Console

console = Console()


async def worker_command(once: bool = False, poll_interval: float = 5.0) -> int:
    """Drain the transfer queue, once or forever."""
    import logging

    from mddatalake.core.config import settings
    from mddatalake.storage import get_transfer_worker

    # Without this the worker's progress/information logs are discarded.
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    worker = get_transfer_worker()
    worker.poll_interval = poll_interval

    console.print(
        f"[bold]Transfer worker[/bold] remote={settings.gdrive_remote}:"
        f"{settings.gdrive_root} hot={settings.hot_root} "
        f"daily_cap={settings.gdrive_daily_upload_gb} GB"
    )

    if once:
        processed = await worker.run_once()
        console.print(f"Processed {processed} job(s)")
        return processed

    try:
        await worker.run_forever()
    except (KeyboardInterrupt, asyncio.CancelledError):
        console.print("\n[yellow]Worker stopped[/yellow]")
    return 0

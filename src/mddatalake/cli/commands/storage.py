"""CLI commands for storage management."""

import asyncio
import logging

import typer
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from mddatalake.core.config import settings
from mddatalake.db.session import AsyncSessionLocal
from mddatalake.storage.cleanup import StorageCleanup
from mddatalake.storage import get_storage_backend

logger = logging.getLogger(__name__)
console = Console()


async def scan_storage(verbose: bool = False):
    """Scan storage implementation."""
    console.print("\n[bold cyan]Scanning storage...[/bold cyan]\n")

    # Initialize storage and database
    storage_backend = get_storage_backend()
    async with AsyncSessionLocal() as db:
        cleanup_service = StorageCleanup(storage_backend, db)

        # Scan storage
        result = await cleanup_service.scan_storage()

        # Display results
        _display_scan_results(result, verbose, cleanup_service)


async def cleanup_storage(dry_run: bool = True, skip_confirmation: bool = False):
    """Cleanup storage implementation."""
    if dry_run:
        console.print("\n[bold yellow]DRY RUN MODE[/bold yellow] - No files will be deleted\n")
    else:
        console.print(
            "\n[bold red]CLEANUP MODE[/bold red] - Files will be PERMANENTLY deleted\n"
        )

    # Initialize storage and database
    storage_backend = get_storage_backend()
    async with AsyncSessionLocal() as db:
        cleanup_service = StorageCleanup(storage_backend, db)

        # First scan to show what will be deleted
        scan_result = await cleanup_service.scan_storage()

        if scan_result["orphaned_files"] == 0:
            console.print("[green]✓[/green] No orphaned files found. Storage is clean!")
            return

        # Display scan results
        console.print(f"[yellow]Found {scan_result['orphaned_files']} orphaned files[/yellow]")
        console.print(
            f"[yellow]Total size: {cleanup_service.format_size(scan_result['orphaned_size_bytes'])}[/yellow]\n"
        )

        # Show breakdown by extension
        table = Table(title="Orphaned Files by Type")
        table.add_column("Extension", style="cyan")
        table.add_column("Count", justify="right", style="yellow")
        table.add_column("Size", justify="right", style="magenta")

        for ext, info in scan_result["orphaned_by_extension"].items():
            table.add_row(
                ext,
                str(info["count"]),
                cleanup_service.format_size(info["size_bytes"]),
            )

        console.print(table)
        console.print()

        # Confirmation prompt
        if not dry_run and not skip_confirmation:
            console.print(
                "[bold red]WARNING:[/bold red] This will permanently delete orphaned files!"
            )
            confirm = typer.confirm("Do you want to proceed?", default=False)
            if not confirm:
                console.print("\n[yellow]Cleanup cancelled[/yellow]")
                return

        # Perform cleanup
        cleanup_result = await cleanup_service.cleanup(dry_run=dry_run)

        # Display cleanup results
        _display_cleanup_results(cleanup_result, cleanup_service)


async def storage_stats():
    """Display storage statistics."""
    console.print("\n[bold cyan]Storage Statistics[/bold cyan]\n")

    # Initialize storage and database
    storage_backend = get_storage_backend()
    async with AsyncSessionLocal() as db:
        cleanup_service = StorageCleanup(storage_backend, db)

        # Scan storage
        result = await cleanup_service.scan_storage()

        # Create statistics panel
        stats_text = f"""
[cyan]Storage Backend:[/cyan] {settings.storage_backend} ({settings.storage_root})

[bold]Files:[/bold]
  Total files:       {result['total_files']:>10,}
  Referenced files:  {result['referenced_files']:>10,}
  Orphaned files:    {result['orphaned_files']:>10,}

[bold]Storage Usage:[/bold]
  Total size:        {cleanup_service.format_size(result['total_size_bytes']):>10}
  Used size:         {cleanup_service.format_size(result['used_size_bytes']):>10}
  Orphaned size:     {cleanup_service.format_size(result['orphaned_size_bytes']):>10}

[bold]Usage Percentage:[/bold]
  Active data:       {(result['used_size_bytes'] / result['total_size_bytes'] * 100) if result['total_size_bytes'] > 0 else 0:>9.1f}%
  Orphaned data:     {(result['orphaned_size_bytes'] / result['total_size_bytes'] * 100) if result['total_size_bytes'] > 0 else 0:>9.1f}%
"""

        panel = Panel(stats_text, title="Storage Statistics", border_style="cyan")
        console.print(panel)

        # Show recommendations
        if result['orphaned_files'] > 0:
            console.print(
                f"\n[yellow]💡 Tip:[/yellow] Run [cyan]mdrepo storage cleanup --force[/cyan] "
                f"to free {cleanup_service.format_size(result['orphaned_size_bytes'])}\n"
            )


def _display_scan_results(result: dict, verbose: bool, cleanup_service: StorageCleanup):
    """Display scan results in a formatted table."""
    # Summary statistics
    console.print(
        Panel(
            f"""[bold]Storage Scan Results[/bold]

Total files:       {result['total_files']:>10,}
Referenced files:  {result['referenced_files']:>10,}
Orphaned files:    {result['orphaned_files']:>10,}

Total size:        {cleanup_service.format_size(result['total_size_bytes']):>10}
Orphaned size:     {cleanup_service.format_size(result['orphaned_size_bytes']):>10}
""",
            border_style="cyan",
        )
    )

    if result['orphaned_files'] == 0:
        console.print("\n[green]✓[/green] No orphaned files found. Storage is clean!\n")
        return

    # Orphaned files by extension
    if result['orphaned_by_extension']:
        table = Table(title="\nOrphaned Files by Extension")
        table.add_column("Extension", style="cyan")
        table.add_column("Count", justify="right", style="yellow")
        table.add_column("Size", justify="right", style="magenta")

        for ext, info in sorted(result['orphaned_by_extension'].items()):
            table.add_row(
                ext,
                str(info["count"]),
                cleanup_service.format_size(info["size_bytes"]),
            )

        console.print(table)

    # Detailed file list
    if verbose and result['orphaned_files_list']:
        console.print("\n[bold]Orphaned Files:[/bold]\n")
        for file_info in result['orphaned_files_list'][:50]:  # Limit to first 50
            size_str = cleanup_service.format_size(file_info['size'])
            console.print(f"  [dim]{file_info['storage_key']}[/dim] ({size_str})")

        if len(result['orphaned_files_list']) > 50:
            console.print(f"\n  ... and {len(result['orphaned_files_list']) - 50} more files")

    console.print(
        f"\n[yellow]💡 Tip:[/yellow] Run [cyan]mdrepo storage cleanup --force[/cyan] to delete these files\n"
    )


def _display_cleanup_results(result: dict, cleanup_service: StorageCleanup):
    """Display cleanup results."""
    if result["dry_run"]:
        console.print(
            f"\n[yellow]DRY RUN:[/yellow] Would delete {result['orphaned_files_found']} files "
            f"({cleanup_service.format_size(result['orphaned_size_bytes'])})\n"
        )
        console.print("[cyan]Run with --force flag to actually delete these files[/cyan]\n")
    else:
        console.print(
            f"\n[green]✓[/green] Deleted {result['deleted_files_count']} files "
            f"({cleanup_service.format_size(result['deleted_size_bytes'])})\n"
        )

        if result["errors"]:
            console.print(f"[red]✗[/red] Encountered {len(result['errors'])} errors:\n")
            for error in result["errors"]:
                console.print(f"  [red]{error}[/red]")


async def reconcile_storage(dry_run: bool = False) -> dict:
    """Align artifact rows with what actually exists on the cold tier.

    The transfer worker records successful uploads, but rows created before
    that existed (or by a worker that crashed between the upload and the
    update) stay marked 'pending' forever. This checks the cold tier directly
    and fixes them.
    """
    from datetime import datetime, timezone

    from sqlalchemy import select

    from mddatalake.db.models import Artifact
    from mddatalake.storage import get_storage_backend

    storage = get_storage_backend()
    cold = getattr(storage, "cold", storage)

    checked = 0
    fixed = 0
    missing = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Artifact).where(Artifact.storage_state != "stored")
        )
        artifacts = list(result.scalars().all())

        for artifact in artifacts:
            checked += 1
            if await cold.exists(artifact.storage_key):
                if not dry_run:
                    artifact.storage_state = "stored"
                    artifact.remote_path = artifact.storage_key
                    artifact.last_verified_at = datetime.now(timezone.utc)
                fixed += 1
            else:
                missing += 1

        if not dry_run:
            await db.commit()

    console.print(
        f"Checked {checked} artifact(s): [green]{fixed}[/green] on the cold tier"
        f"{' (would update)' if dry_run else ''}, "
        f"[yellow]{missing}[/yellow] not found there"
    )
    return {"checked": checked, "fixed": fixed, "missing": missing}

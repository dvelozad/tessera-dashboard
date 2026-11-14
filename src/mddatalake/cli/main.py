"""Main CLI application using Typer."""

import asyncio
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from mddatalake.__version__ import __version__

app = typer.Typer(
    name="tessera",
    help="Tessera - molecular dynamics data lake",
    add_completion=False,
)

console = Console()


@app.command()
def version():
    """Show version information."""
    console.print(f"Tessera v{__version__}")


@app.command()
def ingest(
    directory: Path = typer.Argument(..., help="Directory containing simulation files"),
    project: str = typer.Option(..., "--project", "-p", help="Project name"),
    name: str = typer.Option(None, "--name", "-n", help="Run name (defaults to directory name)"),
    description: str = typer.Option(None, "--description", "-d", help="Run description"),
):
    """
    Ingest a simulation directory into the database.

    Example:
        tessera ingest /path/to/run --project my_project
    """
    from mddatalake.cli.commands.ingest import ingest_command

    asyncio.run(
        ingest_command(
            directory=directory, project_name=project, run_name=name, description=description
        )
    )


@app.command()
def pull(
    source: str = typer.Argument(..., help="host:/path/to/run, or a local directory"),
    project: str = typer.Option(..., "--project", "-p", help="Project name"),
    name: str = typer.Option(None, "--name", "-n", help="Run name (defaults to the directory name)"),
    description: str = typer.Option(None, "--description", "-d", help="Run description"),
    staging: Path = typer.Option(
        None, "--staging", help="Local staging directory (defaults to TESSERA staging root)"
    ),
    keep: bool = typer.Option(False, "--keep", help="Keep the staged copy after ingestion"),
):
    """
    Pull a run from a remote host over rsync and ingest it.

    Examples:
        tessera pull pckr258:/data/bee14/diazd/projects/LJ_GC/PROD_MUT7b -p LJ_GC
        tessera pull /data/runs/local_run -p LJ_GC
    """
    from mddatalake.cli.commands.pull import pull_command

    asyncio.run(
        pull_command(
            source=source,
            project_name=project,
            run_name=name,
            description=description,
            staging_dir=staging,
            keep_staged=keep,
        )
    )


@app.command()
def push(
    directory: Path = typer.Argument(..., help="Run directory on this machine"),
    project: str = typer.Option(..., "--project", "-p", help="Project name"),
    name: str = typer.Option(None, "--name", "-n", help="Run name (defaults to the directory)"),
    description: str = typer.Option(None, "--description", "-d", help="Run description"),
    record: Path = typer.Option(
        None, "--record", help="Where to write the import record (default <run>.json)"
    ),
    source: str = typer.Option(
        None, "--source", help="Provenance label; defaults to the absolute directory path"
    ),
):
    """
    Upload a run to the cold tier from the machine that holds it.

    Use this on a data host that already has rclone access to the same Drive:
    the trajectories go straight there instead of being copied to the server
    first. Move the emitted JSON record to the server and import it.

    Example:
        tessera push /data/.../LJ_GC/PROD -p LJ_GC --record PROD.json
    """
    from mddatalake.cli.commands.push import push_command

    asyncio.run(
        push_command(
            directory=directory,
            project_name=project,
            run_name=name,
            description=description,
            record_path=record,
            source_label=source,
        )
    )


@app.command("import")
def import_record(
    record: Path = typer.Argument(..., help="JSON record produced by `tessera push`"),
    run_name: str = typer.Option(None, "--name", "-n", help="Override the run name"),
):
    """
    Register a run pushed from another machine.

    Example:
        tessera import PROD.json
    """
    from mddatalake.cli.commands.import_record import import_command

    asyncio.run(import_command(record=record, run_name=run_name))


@app.command()
def worker(
    once: bool = typer.Option(False, "--once", help="Process the queue once and exit"),
    poll_interval: float = typer.Option(5.0, "--poll-interval", help="Seconds between polls"),
):
    """
    Push queued artifacts from the hot cache to the cold tier (Google Drive).

    Example:
        tessera worker
        tessera worker --once
    """
    from mddatalake.cli.commands.worker import worker_command

    asyncio.run(worker_command(once=once, poll_interval=poll_interval))


@app.command()
def previews(
    limit: int = typer.Option(0, "--limit", help="Stop after N artifacts (0 = all)"),
    retry_failed: bool = typer.Option(
        True, "--retry-failed/--no-retry-failed", help="Retry artifacts whose preview failed"
    ),
):
    """
    Build 3D previews for trajectories that do not have one.

    Example:
        tessera previews
    """
    from mddatalake.cli.commands.previews import previews_command

    asyncio.run(previews_command(limit=limit, retry_failed=retry_failed))


@app.command()
def doctor():
    """
    Check configuration, storage tiers, transfer queue and database.

    Example:
        tessera doctor
    """
    from mddatalake.cli.commands.doctor import doctor_command

    if not doctor_command():
        raise typer.Exit(code=1)


@app.command()
def query(
    entity: str = typer.Argument("runs", help="Entity to query (runs, projects, systems)"),
    ensemble: str = typer.Option(None, "--ensemble", "-e", help="Filter by ensemble"),
    min_temp: float = typer.Option(None, "--min-temperature", help="Minimum temperature (K)"),
    max_temp: float = typer.Option(None, "--max-temperature", help="Maximum temperature (K)"),
    project: str = typer.Option(None, "--project", "-p", help="Filter by project name"),
    limit: int = typer.Option(20, "--limit", "-l", help="Maximum results to show"),
):
    """
    Query the database.

    Example:
        tessera query runs --ensemble NPT --min-temperature 296 --max-temperature 300
    """
    from mddatalake.cli.commands.query import query_command

    asyncio.run(
        query_command(
            entity=entity,
            ensemble=ensemble,
            min_temp=min_temp,
            max_temp=max_temp,
            project=project,
            limit=limit,
        )
    )


# User management commands
users_app = typer.Typer(help="User management commands")
app.add_typer(users_app, name="users")


@users_app.command("create-admin")
def create_admin(
    email: str = typer.Option(..., "--email", "-e", prompt=True, help="Admin email"),
    password: str = typer.Option(
        ..., "--password", "-p", prompt=True, hide_input=True, confirmation_prompt=True, help="Admin password"
    ),
    full_name: str = typer.Option(None, "--name", "-n", help="Full name"),
):
    """Create the initial admin user account."""
    async def _run():
        from sqlalchemy import select
        from mddatalake.auth.security import hash_password
        from mddatalake.db.models.user import User
        from mddatalake.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            existing = await db.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                console.print(f"[red]Error:[/red] User with email {email!r} already exists.")
                raise typer.Exit(1)
            user = User(
                email=email,
                full_name=full_name,
                role="admin",
                hashed_password=hash_password(password),
            )
            db.add(user)
            await db.commit()
            console.print(f"[green]Admin user created:[/green] {email}")

    asyncio.run(_run())


# Storage management commands
storage_app = typer.Typer(help="Storage management commands")
app.add_typer(storage_app, name="storage")


@storage_app.command("scan")
def storage_scan(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show detailed file information"),
):
    """
    Scan storage and identify orphaned files.

    Example:
        tessera storage scan
        tessera storage scan --verbose
    """
    from mddatalake.cli.commands.storage import scan_storage

    asyncio.run(scan_storage(verbose=verbose))


@storage_app.command("cleanup")
def storage_cleanup(
    force: bool = typer.Option(False, "--force", help="Actually delete files (disables dry-run)"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
):
    """
    Clean up orphaned files from storage.

    By default, runs in dry-run mode showing what would be deleted.
    Use --force to actually delete files.

    Examples:
        # Preview what would be deleted
        tessera storage cleanup

        # Delete with confirmation
        tessera storage cleanup --force

        # Delete without confirmation
        tessera storage cleanup --force --yes
    """
    from mddatalake.cli.commands.storage import cleanup_storage

    dry_run = not force
    asyncio.run(cleanup_storage(dry_run=dry_run, skip_confirmation=yes))


@storage_app.command("reconcile")
def storage_reconcile(
    dry_run: bool = typer.Option(False, "--dry-run", help="Report without changing rows"),
):
    """
    Mark artifacts as stored when their blob is already on the cold tier.

    Example:
        tessera storage reconcile
        tessera storage reconcile --dry-run
    """
    from mddatalake.cli.commands.storage import reconcile_storage

    asyncio.run(reconcile_storage(dry_run=dry_run))


@storage_app.command("stats")
def storage_statistics():
    """
    Show storage statistics.

    Example:
        tessera storage stats
    """
    from mddatalake.cli.commands.storage import storage_stats

    asyncio.run(storage_stats())


if __name__ == "__main__":
    app()

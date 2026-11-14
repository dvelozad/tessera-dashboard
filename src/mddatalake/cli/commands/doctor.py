"""Environment and storage diagnostics."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from rich.console import Console
from rich.table import Table

console = Console()


def _check(rows: list[tuple[str, bool | None, str]], name: str, ok: bool | None, detail: str) -> None:
    rows.append((name, ok, detail))


def doctor_command() -> bool:
    """Run diagnostics and return True when every check passed."""
    from mddatalake.core.config import settings

    rows: list[tuple[str, bool | None, str]] = []

    # Configuration
    _check(rows, "storage_backend", True, settings.storage_backend)

    if settings.storage_backend == "gdrive":
        rclone = shutil.which("rclone")
        _check(rows, "rclone binary", rclone is not None, rclone or "not found in PATH")

        if rclone:
            try:
                out = subprocess.run(
                    ["rclone", "about", f"{settings.gdrive_remote}:"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                ok = out.returncode == 0
                detail = (out.stdout or out.stderr).strip().replace("\n", "; ")[:160]
                _check(rows, "remote reachable", ok, detail)
            except Exception as e:  # noqa: BLE001 - diagnostics must not raise
                _check(rows, "remote reachable", False, str(e))

        hot = Path(settings.hot_root)
        try:
            hot.mkdir(parents=True, exist_ok=True)
            probe = hot / ".tessera_write_test"
            probe.write_text("ok")
            probe.unlink()
            _check(rows, "hot cache writable", True, str(hot))
        except Exception as e:  # noqa: BLE001
            _check(rows, "hot cache writable", False, f"{hot}: {e}")

        try:
            usage = shutil.disk_usage(hot)
            capacity_ok = usage.total / 1e9 > settings.hot_max_gb
            _check(
                rows,
                "hot cache capacity",
                capacity_ok,
                f"free {usage.free / 1e9:.1f} GB, cap {settings.hot_max_gb:.1f} GB",
            )
        except Exception as e:  # noqa: BLE001
            _check(rows, "hot cache capacity", None, str(e))

        queue = hot / ".queue"
        pending = len(list(queue.glob("*.json"))) if queue.is_dir() else 0
        _check(rows, "pending transfers", pending == 0, f"{pending} job(s) queued")

    # Database
    try:
        import asyncio

        from sqlalchemy import text

        from mddatalake.db.session import AsyncSessionLocal

        async def _ping() -> str:
            async with AsyncSessionLocal() as session:
                version = await session.execute(text("select version()"))
                return str(version.scalar())[:80]

        detail = asyncio.run(_ping())
        _check(rows, "database", True, detail)
    except Exception as e:  # noqa: BLE001
        _check(rows, "database", False, str(e)[:160])

    table = Table(title="Tessera doctor")
    table.add_column("Check")
    table.add_column("Result")
    table.add_column("Detail", overflow="fold")
    for name, ok, detail in rows:
        mark = "[green]ok[/green]" if ok else ("[yellow]warn[/yellow]" if ok is None else "[red]fail[/red]")
        table.add_row(name, mark, detail)
    console.print(table)

    return all(ok is not False for _, ok, _ in rows)

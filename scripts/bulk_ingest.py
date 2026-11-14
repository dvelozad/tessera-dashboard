#!/usr/bin/env python3
"""Ingest many simulation directories from a list, safely and resumably.

Reads one ``host:/absolute/path`` (or plain path) per line, pulls it with the
same code path as ``tessera pull``, and moves on. Safe to stop and restart:
runs already present in the database are skipped.

Between runs it waits for the transfer queue to fall below a threshold, so a
slow Drive upload never fills the hot tier.

Usage:
    python scripts/bulk_ingest.py --project LJ_GC --runs-file runs.txt
    python scripts/bulk_ingest.py --project LJ_GC --runs-file runs.txt --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def parse_source(line: str) -> tuple[str | None, str]:
    line = line.strip()
    if not line:
        raise ValueError("empty line")
    if ":" not in line:
        return None, line
    host, path = line.split(":", 1)
    return host, path


async def already_ingested(project: str, run_name: str) -> bool:
    from sqlalchemy import select

    from mddatalake.db.models import Project, SimulationRun
    from mddatalake.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(SimulationRun.id)
            .join(Project, Project.id == SimulationRun.project_id)
            .where(Project.name == project, SimulationRun.run_name == run_name)
        )
        return result.first() is not None


async def queue_bytes() -> int:
    from mddatalake.core.config import settings

    hot = Path(settings.hot_root) / ".queue"
    if not hot.is_dir():
        return 0
    total = 0
    for job in hot.glob("*.json"):
        try:
            import json

            total += int(json.loads(job.read_text()).get("size", 0))
        except Exception:  # noqa: BLE001
            continue
    return total


async def wait_for_queue(max_bytes: int, poll: float = 30.0) -> None:
    while True:
        pending = await queue_bytes()
        if pending <= max_bytes:
            return
        print(f"  waiting for uploads: {pending / 1e9:.1f} GB queued", flush=True)
        await asyncio.sleep(poll)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--runs-file", required=True)
    parser.add_argument("--max-pending-gb", type=float, default=40.0)
    parser.add_argument("--keep-staged", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N runs")
    args = parser.parse_args()

    from mddatalake.cli.commands.pull import pull_command

    lines = [ln.strip() for ln in Path(args.runs_file).read_text().splitlines()]
    sources = [ln for ln in lines if ln and not ln.startswith("#")]

    done = skipped = failed = 0
    started = time.time()

    for index, source in enumerate(sources, 1):
        if args.limit and done >= args.limit:
            break

        host, path = parse_source(source)
        run_name = Path(path.rstrip("/")).name
        label = f"[{index}/{len(sources)}] {run_name}"

        if await already_ingested(args.project, run_name):
            print(f"{label}: already ingested, skipping", flush=True)
            skipped += 1
            continue

        if args.dry_run:
            print(f"{label}: would pull {source}", flush=True)
            continue

        await wait_for_queue(int(args.max_pending_gb * 1e9))
        print(f"{label}: pulling {source}", flush=True)
        try:
            await pull_command(
                source=source,
                project_name=args.project,
                run_name=run_name,
                keep_staged=args.keep_staged,
            )
            done += 1
        except Exception as e:  # noqa: BLE001 - one bad run must not stop the batch
            failed += 1
            print(f"{label}: FAILED {e}", flush=True)

    elapsed = time.time() - started
    print(
        f"\nDone in {elapsed / 60:.1f} min - ingested {done}, skipped {skipped}, "
        f"failed {failed}",
        flush=True,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

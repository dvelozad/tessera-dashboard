#!/usr/bin/env python3
"""Fill in each run's unit system from the input script it was ingested with.

The unit system is what makes a timestep mean something, so runs recorded
before it was stored have an unknown unit system and a simulated time that
was computed on the assumption that every timestep was a femtosecond.

    python scripts/backfill_units.py --dry-run
    python scripts/backfill_units.py
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from mddatalake.db.models import Artifact, SimulationRun  # noqa: E402
from mddatalake.db.session import AsyncSessionLocal  # noqa: E402
from mddatalake.storage import get_storage_backend  # noqa: E402
from mddatalake.utils.units import normalise_units, simulated_time_ns  # noqa: E402

UNITS_RE = re.compile(r"^\s*units\s+(\w+)", re.MULTILINE)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    storage = get_storage_backend()
    changed = 0

    async with AsyncSessionLocal() as db:
        runs = (
            await db.execute(
                select(SimulationRun)
                .options(selectinload(SimulationRun.engine))
                .where(SimulationRun.units.is_(None))
                .order_by(SimulationRun.id)
            )
        ).scalars().all()

        print(f"{len(runs)} run(s) without a unit system")

        for run in runs:
            artifacts = (
                await db.execute(
                    select(Artifact).where(Artifact.simulation_run_id == run.id)
                )
            ).scalars().all()

            engine = (run.engine.name if run.engine else "") or ""
            units: str | None = None

            if engine.lower() == "gromacs":
                units = "gromacs"
            else:
                inputs = [
                    a for a in artifacts
                    if a.artifact_type.value == "input"
                ]
                # Smallest first: the run script, not a data file.
                for artifact in sorted(inputs, key=lambda a: a.file_size_bytes or 0):
                    try:
                        with tempfile.TemporaryDirectory() as tmp:
                            target = Path(tmp) / artifact.file_name
                            await storage.download(artifact.storage_key, target)
                            text = target.read_text(errors="replace")
                        match = UNITS_RE.search(text)
                        if match:
                            units = normalise_units(match.group(1))
                            if units:
                                break
                    except Exception as error:  # noqa: BLE001
                        print(f"  {run.id:>3} {run.run_name:<18} {artifact.file_name}: {error}")

            if not units:
                print(f"  {run.id:>3} {run.run_name:<18} no unit system found")
                continue

            total = simulated_time_ns(units, run.timestep, run.n_steps, run.lj_time_ps)
            print(
                f"  {run.id:>3} {run.run_name:<18} units={units:<8} "
                f"total_time {run.total_time} -> {total}"
            )
            if not args.dry_run:
                run.units = units
                run.total_time = total
                changed += 1

        if args.dry_run:
            print("\nNothing written. Re-run without --dry-run to apply.")
        else:
            await db.commit()
            print(f"\nUpdated {changed} run(s)")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

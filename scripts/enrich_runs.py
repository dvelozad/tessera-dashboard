#!/usr/bin/env python3
"""Fill missing metadata on runs already in the lake.

Downloads the small artifacts of each run (logs, input decks), re-parses them
with the current parser, and writes back what is missing: thermodynamic
observables (temperature, pressure, energies) and the run's numeric fields.

    .venv/bin/python scripts/enrich_runs.py [--run-id N] [--dry-run]

Safe to re-run: it only adds observables to runs that have none, and only fills
fields that are empty.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from mddatalake.db.models import Artifact, Observable, SimulationRun  # noqa: E402
from mddatalake.db.session import AsyncSessionLocal  # noqa: E402
from mddatalake.ingestion import IngestionService  # noqa: E402
from mddatalake.parsers import detect_engine  # noqa: E402
from mddatalake.parsers.lammps import LammpsParser  # noqa: E402
from mddatalake.storage import get_storage_backend  # noqa: E402

MAX_LOG_BYTES = 200 * 1024 * 1024


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    storage = get_storage_backend()
    enriched = skipped = failed = 0

    async with AsyncSessionLocal() as db:
        query = select(SimulationRun).options(selectinload(SimulationRun.engine)).order_by(SimulationRun.id)
        if args.run_id:
            query = query.where(SimulationRun.id == args.run_id)
        runs = (await db.execute(query)).scalars().all()

        for run in runs:
            artifacts = (
                await db.execute(
                    select(Artifact).where(Artifact.simulation_run_id == run.id)
                )
            ).scalars().all()

            has_observables = (
                await db.execute(
                    select(Observable.id)
                    .where(Observable.simulation_run_id == run.id)
                    .limit(1)
                )
            ).first() is not None

            logs = [
                a
                for a in artifacts
                if "log" in a.file_name.lower()
                or a.file_name.lower().endswith((".out", ".txt"))
                or (a.artifact_type and a.artifact_type.value == "LOG")
            ]
            if not logs:
                skipped += 1
                print(f"{run.id:>3} {run.run_name:<20} no log artifact")
                continue

            with tempfile.TemporaryDirectory(prefix="tessera-enrich-") as tmp:
                work = Path(tmp)
                got = 0
                for artifact in logs[:4]:
                    if artifact.file_size_bytes and artifact.file_size_bytes > MAX_LOG_BYTES:
                        continue
                    try:
                        await storage.download(artifact.storage_key, work / artifact.file_name)
                        got += 1
                    except Exception as error:  # noqa: BLE001
                        print(f"    could not fetch {artifact.file_name}: {error}")

                for artifact in artifacts:
                    if artifact.artifact_type and artifact.artifact_type.value == "INPUT":
                        try:
                            await storage.download(artifact.storage_key, work / artifact.file_name)
                        except Exception:  # noqa: BLE001
                            pass

                if not got:
                    skipped += 1
                    continue

                try:
                    # The run already knows its engine; detection needs the
                    # input script's name, which a partial download lacks.
                    declared = (run.engine.name or "").lower() if run.engine else ""
                    if "lammps" in declared:
                        engine = "lammps"
                    elif "gromacs" in declared:
                        engine = "gromacs"
                    else:
                        engine = detect_engine(work)

                    if engine != "lammps":
                        skipped += 1
                        print(f"{run.id:>3} {run.run_name:<20} engine={engine}, skipped")
                        continue
                    metadata = LammpsParser(work).parse()
                except Exception as error:  # noqa: BLE001
                    failed += 1
                    print(f"{run.id:>3} {run.run_name:<20} parse failed: {error}")
                    continue

                thermo = metadata.get("thermodynamic_data")
                changed = []

                if thermo and not has_observables:
                    if not args.dry_run:
                        IngestionService(db)._create_observables(run.id, thermo)
                    changed.append(f"{len(thermo)} observables")

                for field in (
                    "timestep",
                    "n_steps",
                    "total_time",
                    "temperature_target",
                    "pressure_target",
                    "thermostat",
                    "barostat",
                    "coulomb_method",
                ):
                    value = metadata.get(field)
                    if value is None:
                        continue
                    current = getattr(run, field)
                    if current is None:
                        if not args.dry_run:
                            setattr(run, field, value)
                        changed.append(field)

                if changed:
                    enriched += 1
                    print(f"{run.id:>3} {run.run_name:<20} + {', '.join(changed)}")
                else:
                    skipped += 1
                    print(f"{run.id:>3} {run.run_name:<20} nothing new")

                if not args.dry_run:
                    await db.commit()

    print(f"\nenriched {enriched}, skipped {skipped}, failed {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

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
from mddatalake.utils.composition import lammps_composition  # noqa: E402

MAX_LOG_BYTES = 200 * 1024 * 1024


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--recent-minutes",
        type=int,
        help="only runs created within this many minutes (used by the import timer)",
    )
    args = parser.parse_args()

    storage = get_storage_backend()
    enriched = skipped = failed = 0

    async with AsyncSessionLocal() as db:
        query = select(SimulationRun).options(
            selectinload(SimulationRun.engine), selectinload(SimulationRun.system)
        ).order_by(SimulationRun.id)
        if args.run_id:
            query = query.where(SimulationRun.id == args.run_id)
        if args.recent_minutes:
            from datetime import datetime, timedelta, timezone

            cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.recent_minutes)
            query = query.where(SimulationRun.created_at >= cutoff)
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

            declared_engine = (run.engine.name or "").lower() if run.engine else ""

            # GROMACS thermodynamics live in the .edr files; obleas reads them
            # directly, so no trajectory is needed for this part.
            if "gromacs" in declared_engine and not has_observables:
                from dataclasses import replace

                from mddatalake.analysis.obleas import ObleasRunner
                from mddatalake.analysis.service import store_series
                from mddatalake.core.config import settings as cfg

                edrs = [a for a in artifacts if a.file_name.lower().endswith(".edr")]
                if edrs:
                    runner = ObleasRunner(cfg.obleas_bin, timeout=600)
                    collected = []
                    with tempfile.TemporaryDirectory(prefix="tessera-edr-") as tmp2:
                        work2 = Path(tmp2)
                        for artifact in edrs:
                            target = work2 / artifact.file_name
                            try:
                                await storage.download(artifact.storage_key, target)
                                series = await runner.energy_from_edr(work2, target)
                            except Exception as error:  # noqa: BLE001
                                print(f"    {artifact.file_name}: {error}")
                                continue
                            if len(edrs) > 1:
                                series = [
                                    replace(item, name=f"{target.stem}/{item.name}")
                                    for item in series
                                ]
                            collected.extend(series)
                    if collected:
                        if not args.dry_run:
                            await store_series(db, run.id, collected)
                            await db.commit()
                        enriched += 1
                        print(f"{run.id:>3} {run.run_name:<20} + {len(collected)} gromacs observables ({len(edrs)} edr)")
                    else:
                        skipped += 1
                    continue

            logs = [
                a
                for a in artifacts
                if "log" in a.file_name.lower()
                or a.file_name.lower().endswith((".out", ".txt"))
                or (a.artifact_type and (a.artifact_type.value or "").lower() == "log")
            ]

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
                    if artifact.artifact_type and artifact.artifact_type.value.lower() == "input":
                        try:
                            await storage.download(artifact.storage_key, work / artifact.file_name)
                        except Exception:  # noqa: BLE001
                            pass

                # A LAMMPS data file also tells us the composition.
                topology = [
                    a
                    for a in artifacts
                    if a.artifact_type
                    and (a.artifact_type.value or "").lower() == "topology"
                    and (a.file_size_bytes or 0) < 200 * 1024 * 1024
                ]
                data_path = None
                if topology:
                    data_path = work / topology[0].file_name
                    try:
                        await storage.download(topology[0].storage_key, data_path)
                    except Exception:  # noqa: BLE001
                        data_path = None

                if not got and not topology:
                    skipped += 1
                    print(f"{run.id:>3} {run.run_name:<20} no log or topology artifact")
                    continue

                try:
                    if not got:
                        raise RuntimeError("no log artifact")
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

                if data_path is not None and run.system is not None:
                    current = (run.system.composition_description or "").strip()
                    if current in ("", "Unknown"):
                        formula = lammps_composition(data_path)
                        if formula and formula != "Unknown":
                            if not args.dry_run:
                                run.system.composition_description = formula
                            changed.append(f"composition={formula}")

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
